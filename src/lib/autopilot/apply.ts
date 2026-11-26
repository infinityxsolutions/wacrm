// ============================================================
// Autopilot: write a generated setup into one business account.
//
// Runs on the caller's RLS-scoped client, so every row is checked by
// the database against the caller's own account (tenant isolation and
// SaaS read-only mode stay enforced by Postgres, not by this code).
//
// Idempotent: re-running after editing the answers updates the AI
// instructions and the knowledge docs it created (matched by title) and
// skips quick replies, tags and pipelines that already exist by name, so
// nothing the business added or renamed by hand is duplicated or lost.
// WhatsApp templates are NOT sent to Meta here; the owner reviews and
// submits them from the Autopilot page.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import type { AutopilotSetup } from './types'

export interface ApplyContext {
  accountId: string
  userId: string
  /** GrowthXAi's own AI provider when its key is configured on the server, else null. */
  platformAiProvider: string | null
  /** Index a knowledge doc for retrieval; failures are reported, not fatal. */
  ingest: (docId: string, content: string) => Promise<void>
}

export interface ApplyReport {
  agent: 'created' | 'updated' | 'needs_key'
  knowledge: { created: number; updated: number; indexFailed: number }
  quickReplies: { created: number; skipped: number }
  tags: { created: number; skipped: number }
  pipeline: 'created' | 'skipped'
}

export class AutopilotApplyError extends Error {
  constructor(
    readonly step: string,
    readonly cause: unknown,
  ) {
    super(`Autopilot apply failed at ${step}`)
    this.name = 'AutopilotApplyError'
  }
}

function check(step: string, error: unknown): void {
  if (error) throw new AutopilotApplyError(step, error)
}

const norm = (s: string) => s.trim().toLowerCase()

export async function applyAutopilotSetup(
  db: SupabaseClient,
  ctx: ApplyContext,
  setup: AutopilotSetup,
): Promise<ApplyReport> {
  const { accountId, userId } = ctx

  // 1. AI agent instructions.
  const { data: cfg, error: cfgErr } = await db
    .from('ai_configs')
    .select('id')
    .eq('account_id', accountId)
    .maybeSingle()
  check('ai_config_read', cfgErr)
  let agent: ApplyReport['agent']
  if (cfg) {
    const { error } = await db
      .from('ai_configs')
      .update({ system_prompt: setup.systemPrompt })
      .eq('account_id', accountId)
    check('ai_config_update', error)
    agent = 'updated'
  } else if (ctx.platformAiProvider) {
    const { error } = await db.from('ai_configs').insert({
      account_id: accountId,
      created_by: userId,
      use_platform_key: true,
      provider: ctx.platformAiProvider,
      system_prompt: setup.systemPrompt,
      is_active: true,
      auto_reply_enabled: false,
    })
    check('ai_config_insert', error)
    agent = 'created'
  } else {
    // No platform key and no own key yet: the prompt is kept in the
    // business profile and applied once they connect a key.
    agent = 'needs_key'
  }

  // 2. Knowledge base (upsert by title).
  const knowledge = { created: 0, updated: 0, indexFailed: 0 }
  const { data: docs, error: docsErr } = await db
    .from('ai_knowledge_documents')
    .select('id, title')
    .eq('account_id', accountId)
  check('knowledge_read', docsErr)
  const byTitle = new Map(
    ((docs ?? []) as { id: string; title: string }[]).map((d) => [norm(d.title), d.id]),
  )
  for (const doc of setup.knowledge) {
    let id = byTitle.get(norm(doc.title))
    if (id) {
      const { error } = await db
        .from('ai_knowledge_documents')
        .update({ content: doc.content })
        .eq('id', id)
        .eq('account_id', accountId)
      check('knowledge_update', error)
      knowledge.updated++
    } else {
      const { data, error } = await db
        .from('ai_knowledge_documents')
        .insert({ account_id: accountId, created_by: userId, title: doc.title, content: doc.content })
        .select('id')
        .single()
      check('knowledge_insert', error)
      id = (data as { id: string }).id
      knowledge.created++
    }
    try {
      await ctx.ingest(id, doc.content)
    } catch (err) {
      console.error('[autopilot] knowledge indexing failed:', err)
      knowledge.indexFailed++
    }
  }

  // 3. Quick replies (skip existing titles).
  const { data: qrs, error: qrErr } = await db
    .from('quick_replies')
    .select('title')
    .eq('account_id', accountId)
  check('quick_replies_read', qrErr)
  const qrTitles = new Set(((qrs ?? []) as { title: string }[]).map((q) => norm(q.title)))
  const newQrs = setup.quickReplies.filter((q) => !qrTitles.has(norm(q.title)))
  if (newQrs.length) {
    const { error } = await db.from('quick_replies').insert(
      newQrs.map((q) => ({
        account_id: accountId,
        user_id: userId,
        title: q.title,
        kind: 'text',
        content_text: q.content_text,
      })),
    )
    check('quick_replies_insert', error)
  }

  // 4. Tags (skip existing names).
  const { data: tags, error: tagErr } = await db
    .from('tags')
    .select('name')
    .eq('account_id', accountId)
  check('tags_read', tagErr)
  const tagNames = new Set(((tags ?? []) as { name: string }[]).map((t) => norm(t.name)))
  const newTags = setup.tags.filter((t) => !tagNames.has(norm(t.name)))
  if (newTags.length) {
    const { error } = await db
      .from('tags')
      .insert(newTags.map((t) => ({ account_id: accountId, user_id: userId, name: t.name, color: t.color })))
    check('tags_insert', error)
  }

  // 5. Pipeline (create once by name).
  const { data: pipes, error: pipeErr } = await db
    .from('pipelines')
    .select('name')
    .eq('account_id', accountId)
  check('pipelines_read', pipeErr)
  let pipeline: ApplyReport['pipeline'] = 'skipped'
  const pipeExists = ((pipes ?? []) as { name: string }[]).some(
    (p) => norm(p.name) === norm(setup.pipeline.name),
  )
  if (!pipeExists) {
    const { data, error } = await db
      .from('pipelines')
      .insert({ account_id: accountId, user_id: userId, name: setup.pipeline.name })
      .select('id')
      .single()
    check('pipeline_insert', error)
    const pipelineId = (data as { id: string }).id
    const { error: stErr } = await db.from('pipeline_stages').insert(
      setup.pipeline.stages.map((s, position) => ({
        pipeline_id: pipelineId,
        name: s.name,
        color: s.color,
        position,
      })),
    )
    check('pipeline_stages_insert', stErr)
    pipeline = 'created'
  }

  return {
    agent,
    knowledge,
    quickReplies: { created: newQrs.length, skipped: setup.quickReplies.length - newQrs.length },
    tags: { created: newTags.length, skipped: setup.tags.length - newTags.length },
    pipeline,
  }
}
