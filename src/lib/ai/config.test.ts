import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

// decrypt is identity in tests so we don't depend on real ciphertext.
vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (v: string) => `plain:${v}`,
}))

import { loadAiConfig } from './config'

function dbReturning(row: Record<string, unknown> | null): SupabaseClient {
  const chain = {
    from: () => chain,
    select: () => chain,
    eq: () => chain,
    maybeSingle: () => Promise.resolve({ data: row, error: null }),
  }
  return chain as unknown as SupabaseClient
}

const ROW = {
  provider: 'openai',
  model: 'gpt-x',
  base_url: null,
  api_key: 'enc-key',
  system_prompt: null,
  is_active: false,
  auto_reply_enabled: false,
  auto_reply_max_per_conversation: 3,
  embeddings_api_key: null,
}

describe('loadAiConfig requireActive', () => {
  it('returns null for an inactive config by default', async () => {
    expect(await loadAiConfig(dbReturning(ROW), 'acct')).toBeNull()
  })

  it('returns the config when requireActive is false (Playground path)', async () => {
    const config = await loadAiConfig(dbReturning(ROW), 'acct', {
      requireActive: false,
    })
    expect(config).not.toBeNull()
    expect(config!.provider).toBe('openai')
    expect(config!.baseUrl).toBeNull()
    expect(config!.apiKey).toBe('plain:enc-key')
  })

  it('returns null when there is no row', async () => {
    expect(
      await loadAiConfig(dbReturning(null), 'acct', { requireActive: false }),
    ).toBeNull()
  })
})

describe('loadAiConfig platform AI (SaaS)', () => {
  const PLATFORM_ROW = { ...ROW, is_active: true, api_key: null, model: null, use_platform_key: true }
  const ENV = ['PLATFORM_AI_API_KEY', 'PLATFORM_AI_PROVIDER', 'PLATFORM_AI_MODEL', 'PLATFORM_AI_BASE_URL'] as const

  function withEnv(values: Partial<Record<(typeof ENV)[number], string>>, fn: () => Promise<void>) {
    return async () => {
      const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]))
      for (const k of ENV) delete process.env[k]
      Object.assign(process.env, values)
      try {
        await fn()
      } finally {
        for (const k of ENV) {
          if (saved[k] === undefined) delete process.env[k]
          else process.env[k] = saved[k]
        }
      }
    }
  }

  it(
    "uses GrowthXAi's key and model, marked as platform usage",
    withEnv({ PLATFORM_AI_API_KEY: 'platform-secret' }, async () => {
      const config = await loadAiConfig(dbReturning(PLATFORM_ROW), 'acct')
      expect(config).toMatchObject({
        provider: 'anthropic',
        model: 'claude-haiku-5-5',
        apiKey: 'platform-secret',
        keySource: 'platform',
        isActive: true,
      })
    }),
  )

  it(
    'honours a configured platform provider and model',
    withEnv(
      { PLATFORM_AI_API_KEY: 'k', PLATFORM_AI_PROVIDER: 'openai', PLATFORM_AI_MODEL: 'gpt-small' },
      async () => {
        const config = await loadAiConfig(dbReturning(PLATFORM_ROW), 'acct')
        expect(config).toMatchObject({ provider: 'openai', model: 'gpt-small', keySource: 'platform' })
      },
    ),
  )

  it(
    'treats platform AI as unavailable when the platform key is not configured',
    withEnv({}, async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      expect(await loadAiConfig(dbReturning(PLATFORM_ROW), 'acct')).toBeNull()
      spy.mockRestore()
    }),
  )

  it(
    "keeps using the business's own key when platform AI is off",
    withEnv({ PLATFORM_AI_API_KEY: 'platform-secret' }, async () => {
      const config = await loadAiConfig(
        dbReturning({ ...ROW, is_active: true, use_platform_key: false }),
        'acct',
      )
      expect(config).toMatchObject({ apiKey: 'plain:enc-key', keySource: 'own' })
    }),
  )

  it(
    'returns null for an own-key row that has lost its key',
    withEnv({}, async () => {
      expect(
        await loadAiConfig(dbReturning({ ...ROW, is_active: true, api_key: null }), 'acct'),
      ).toBeNull()
    }),
  )
})
