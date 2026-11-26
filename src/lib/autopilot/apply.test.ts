import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { applyAutopilotSetup, AutopilotApplyError } from './apply'
import type { AutopilotSetup } from './types'

type Row = Record<string, unknown>

/** Minimal in-memory stand-in for the Supabase query builder used by apply. */
function fakeDb(seed: Record<string, Row[]> = {}, failOn?: string) {
  const tables: Record<string, Row[]> = structuredClone(seed)
  let n = 0
  const from = (table: string) => {
    tables[table] ??= []
    const filters: [string, unknown][] = []
    let op: 'select' | 'insert' | 'update' = 'select'
    let payload: Row | Row[] = {}
    const match = (r: Row) => filters.every(([k, v]) => r[k] === v)
    const run = () => {
      if (failOn === `${table}.${op}`) return { data: null, error: { message: 'boom' } }
      const rows = tables[table]!
      if (op === 'insert') {
        const list = (Array.isArray(payload) ? payload : [payload]).map((r) => ({ id: `id${++n}`, ...r }))
        rows.push(...list)
        return { data: list, error: null }
      }
      if (op === 'update') {
        const hit = rows.filter(match)
        hit.forEach((r) => Object.assign(r, payload))
        return { data: hit, error: null }
      }
      return { data: rows.filter(match), error: null }
    }
    const b = {
      select: () => b,
      insert: (p: Row | Row[]) => ((op = 'insert'), (payload = p), b),
      update: (p: Row) => ((op = 'update'), (payload = p), b),
      eq: (k: string, v: unknown) => (filters.push([k, v]), b),
      maybeSingle: async () => {
        const r = run()
        return { data: (r.data as Row[] | null)?.[0] ?? null, error: r.error }
      },
      single: async () => {
        const r = run()
        return { data: (r.data as Row[] | null)?.[0] ?? null, error: r.error }
      },
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve(run()).then(res, rej),
    }
    return b
  }
  return { db: { from } as unknown as SupabaseClient, tables }
}

const setup: AutopilotSetup = {
  systemPrompt: 'PROMPT',
  knowledge: [
    { title: 'Services and prices', content: 'new prices' },
    { title: 'FAQ', content: 'faq' },
  ],
  quickReplies: [
    { title: 'Welcome', content_text: 'hi' },
    { title: 'Book', content_text: 'book' },
  ],
  pipeline: { name: 'Detailing jobs', stages: [{ name: 'New', color: '#000' }, { name: 'Done', color: '#fff' }] },
  tags: [{ name: 'SUV', color: '#111' }, { name: 'Hot lead', color: '#222' }],
  templates: [],
}

const ctx = (over = {}) => ({
  accountId: 'A',
  userId: 'U',
  platformAiProvider: 'anthropic' as string | null,
  ingest: vi.fn(async () => {}),
  ...over,
})

describe('applyAutopilotSetup', () => {
  it('builds everything on a fresh account', async () => {
    const { db, tables } = fakeDb()
    const c = ctx()
    const r = await applyAutopilotSetup(db, c, setup)
    expect(r).toEqual({
      agent: 'created',
      knowledge: { created: 2, updated: 0, indexFailed: 0 },
      quickReplies: { created: 2, skipped: 0 },
      tags: { created: 2, skipped: 0 },
      pipeline: 'created',
    })
    expect(tables.ai_configs![0]).toMatchObject({ account_id: 'A', use_platform_key: true, system_prompt: 'PROMPT' })
    expect(tables.pipeline_stages!.map((s) => s.position)).toEqual([0, 1])
    expect(c.ingest).toHaveBeenCalledTimes(2)
  })

  it('is idempotent and never touches other accounts', async () => {
    const { db, tables } = fakeDb({
      ai_configs: [{ id: 'c1', account_id: 'A', system_prompt: 'old' }],
      ai_knowledge_documents: [
        { id: 'd1', account_id: 'A', title: 'services and prices', content: 'old' },
        { id: 'd2', account_id: 'B', title: 'FAQ', content: 'other tenant' },
      ],
      quick_replies: [{ account_id: 'A', title: 'welcome' }, { account_id: 'B', title: 'Book' }],
      tags: [{ account_id: 'A', name: 'suv' }],
      pipelines: [{ account_id: 'A', name: 'Detailing Jobs' }],
    })
    const r = await applyAutopilotSetup(db, ctx(), setup)
    expect(r.agent).toBe('updated')
    expect(r.knowledge).toEqual({ created: 1, updated: 1, indexFailed: 0 })
    expect(r.quickReplies).toEqual({ created: 1, skipped: 1 })
    expect(r.tags).toEqual({ created: 1, skipped: 1 })
    expect(r.pipeline).toBe('skipped')
    expect(tables.ai_knowledge_documents!.find((d) => d.id === 'd2')!.content).toBe('other tenant')
    expect(tables.ai_configs![0]!.system_prompt).toBe('PROMPT')
  })

  it('reports needs_key without a platform key and survives indexing failure', async () => {
    const { db, tables } = fakeDb()
    const r = await applyAutopilotSetup(
      db,
      ctx({ platformAiProvider: null, ingest: vi.fn(async () => Promise.reject(new Error('x'))) }),
      setup,
    )
    expect(r.agent).toBe('needs_key')
    expect(tables.ai_configs).toHaveLength(0)
    expect(r.knowledge.indexFailed).toBe(2)
  })

  it('stops with the failing step on a database error', async () => {
    const { db } = fakeDb({}, 'tags.insert')
    await expect(applyAutopilotSetup(db, ctx(), setup)).rejects.toMatchObject({
      step: 'tags_insert',
    })
    await expect(applyAutopilotSetup(fakeDb({}, 'tags.insert').db, ctx(), setup)).rejects.toBeInstanceOf(
      AutopilotApplyError,
    )
  })
})
