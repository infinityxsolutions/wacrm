import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import type { AiConfig } from './types'

interface AiConfigRow {
  provider: 'openai' | 'anthropic' | 'openai_compatible'
  model: string
  base_url: string | null
  api_key: string | null
  system_prompt: string | null
  is_active: boolean
  auto_reply_enabled: boolean
  auto_reply_max_per_conversation: number
  handoff_agent_id: string | null
  embeddings_api_key: string | null
  use_platform_key: boolean | null
}

const CONFIG_COLUMNS =
  'provider, model, base_url, api_key, system_prompt, is_active, auto_reply_enabled, auto_reply_max_per_conversation, handoff_agent_id, embeddings_api_key, use_platform_key'

const PLATFORM_PROVIDERS = ['openai', 'anthropic', 'openai_compatible'] as const

/**
 * GrowthXAi's own AI key (server environment), used for accounts that
 * chose "use GrowthXAi AI" instead of bringing a key. Returns null when
 * the platform key is not configured, which callers treat as "AI not
 * available" rather than an error.
 */
export function platformAiSettings(): {
  provider: AiConfig['provider']
  model: string
  baseUrl: string | null
  apiKey: string
} | null {
  const apiKey = process.env.PLATFORM_AI_API_KEY?.trim()
  if (!apiKey) return null
  const rawProvider = process.env.PLATFORM_AI_PROVIDER?.trim() || 'anthropic'
  const provider = (PLATFORM_PROVIDERS as readonly string[]).includes(rawProvider)
    ? (rawProvider as AiConfig['provider'])
    : 'anthropic'
  const model =
    process.env.PLATFORM_AI_MODEL?.trim() ||
    (provider === 'anthropic' ? 'claude-haiku-5-5' : '')
  if (!model) return null
  const baseUrl = process.env.PLATFORM_AI_BASE_URL?.trim() || null
  if (provider === 'openai_compatible' && !baseUrl) return null
  return { provider, model, baseUrl, apiKey }
}

/**
 * Load and decrypt the account's AI config for *use* (draft or
 * auto-reply). Returns `null` when there's no row or the master switch
 * (`is_active`) is off — both mean "AI is not available", which callers
 * treat identically. Throws only if the stored key can't be decrypted
 * (mismatched `ENCRYPTION_KEY`), so that distinct failure surfaces
 * rather than looking like "not configured".
 *
 * Works with any client: pass the RLS-scoped SSR client from a
 * dashboard route, or the service-role admin client from the webhook.
 */
export async function loadAiConfig(
  db: SupabaseClient,
  accountId: string,
  opts: { requireActive?: boolean } = {},
): Promise<AiConfig | null> {
  const { requireActive = true } = opts
  const { data, error } = await db
    .from('ai_configs')
    .select(CONFIG_COLUMNS)
    .eq('account_id', accountId)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  const row = data as AiConfigRow
  // The Playground passes requireActive:false so an admin can test the
  // agent before flipping the master switch on.
  if (requireActive && !row.is_active) return null

  // Platform AI: the business uses GrowthXAi's key; usage is metered
  // against its plan by the caller (see assertAiQuota).
  const platform = row.use_platform_key ? platformAiSettings() : null
  if (row.use_platform_key && !platform) {
    console.error(
      `[ai config] account ${accountId} uses platform AI but PLATFORM_AI_API_KEY / PLATFORM_AI_MODEL are not configured.`,
    )
    return null
  }
  // Own key: a missing key/model means "not configured" rather than
  // letting decrypt() throw on null.
  if (!platform && (!row.api_key || !row.model)) return null

  // The embeddings key is optional and independent of the chat key —
  // a corrupt/undecryptable one should downgrade to lexical KB, not
  // take down draft/auto-reply, so decrypt failures are swallowed here.
  let embeddingsApiKey: string | null = null
  if (row.embeddings_api_key) {
    try {
      embeddingsApiKey = decrypt(row.embeddings_api_key)
    } catch {
      // Not silent — a rotated/mismatched ENCRYPTION_KEY here means
      // semantic search quietly stops working, so leave a breadcrumb.
      console.error(
        `[ai config] embeddings key for account ${accountId} could not be decrypted — check ENCRYPTION_KEY; semantic search is disabled until it is re-entered.`,
      )
      embeddingsApiKey = null
    }
  }

  if (platform) {
    return {
      provider: platform.provider,
      model: platform.model,
      baseUrl: platform.baseUrl,
      apiKey: platform.apiKey,
      systemPrompt: row.system_prompt,
      isActive: row.is_active,
      autoReplyEnabled: row.auto_reply_enabled,
      autoReplyMaxPerConversation: row.auto_reply_max_per_conversation,
      handoffAgentId: row.handoff_agent_id,
      embeddingsApiKey,
      keySource: 'platform',
    }
  }

  return {
    provider: row.provider,
    model: row.model as string,
    baseUrl: row.base_url,
    apiKey: decrypt(row.api_key as string),
    systemPrompt: row.system_prompt,
    isActive: row.is_active,
    autoReplyEnabled: row.auto_reply_enabled,
    autoReplyMaxPerConversation: row.auto_reply_max_per_conversation,
    handoffAgentId: row.handoff_agent_id,
    embeddingsApiKey,
    keySource: 'own',
  }
}

/**
 * Load + decrypt just the embeddings key, independent of `is_active`.
 * Used by the knowledge-base ingest routes so the KB gets embedded (and
 * semantic search works) whenever an embeddings key is present, even if
 * the assistant's master switch is currently off.
 *
 * Returns `{ key, corrupt }`: `key` is null when there's no key OR it
 * can't be decrypted; `corrupt` distinguishes those cases so callers can
 * warn ("a key is set but unusable") rather than silently indexing
 * lexical-only and reporting success.
 */
export async function loadEmbeddingsKey(
  db: SupabaseClient,
  accountId: string,
): Promise<{ key: string | null; corrupt: boolean }> {
  const { data, error } = await db
    .from('ai_configs')
    .select('embeddings_api_key')
    .eq('account_id', accountId)
    .maybeSingle()
  if (error || !data?.embeddings_api_key) return { key: null, corrupt: false }
  try {
    return { key: decrypt(data.embeddings_api_key), corrupt: false }
  } catch {
    console.error(
      `[ai config] embeddings key for account ${accountId} could not be decrypted — check ENCRYPTION_KEY.`,
    )
    return { key: null, corrupt: true }
  }
}
