import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  PlanLimitError,
  assertAiQuota,
  assertBroadcastQuota,
  assertSeat,
  assertWritable,
  getEntitlements,
  planErrorFromDb,
  remaining,
  seatsRemaining,
  trialDaysLeft,
  type Entitlements,
} from './entitlements'

function ent(overrides: Partial<Entitlements> = {}, usage: Partial<Entitlements['usage']> = {}): Entitlements {
  return {
    account_id: 'acct-1',
    plan: { id: 'starter', name: 'Starter', price_inr_monthly: 999 },
    status: 'trialing',
    is_comped: false,
    trial_ends_at: '2026-12-10T00:00:00Z',
    current_period_end: null,
    grace_days: 3,
    writable: true,
    limits: {
      members: 2,
      contacts: 1000,
      broadcast_messages_monthly: 1000,
      ai_replies_monthly: 300,
      voice_minutes_monthly: 0,
    },
    usage: {
      members: 1,
      pending_invitations: 0,
      contacts: 10,
      broadcast_messages_monthly: 0,
      ai_replies_monthly: 0,
      voice_minutes_monthly: 0,
      ...usage,
    },
    ...overrides,
  }
}

function code(fn: () => void): string | null {
  try {
    fn()
    return null
  } catch (err) {
    expect(err).toBeInstanceOf(PlanLimitError)
    expect((err as PlanLimitError).status).toBe(402)
    return (err as PlanLimitError).code
  }
}

describe('entitlement checks', () => {
  it('fails open when entitlements could not be loaded', () => {
    expect(code(() => assertWritable(null))).toBeNull()
    expect(code(() => assertBroadcastQuota(null, 10_000))).toBeNull()
    expect(code(() => assertAiQuota(null))).toBeNull()
    expect(code(() => assertSeat(null))).toBeNull()
  })

  it('blocks everything on a read-only account', () => {
    const e = ent({ writable: false })
    expect(code(() => assertWritable(e))).toBe('read_only')
    expect(code(() => assertBroadcastQuota(e, 1))).toBe('read_only')
    expect(code(() => assertAiQuota(e))).toBe('read_only')
    expect(code(() => assertSeat(e))).toBe('read_only')
  })

  it('allows a broadcast that exactly fits and rejects one that does not', () => {
    const e = ent({}, { broadcast_messages_monthly: 990 })
    expect(remaining(e, 'broadcast_messages_monthly')).toBe(10)
    expect(code(() => assertBroadcastQuota(e, 10))).toBeNull()
    expect(code(() => assertBroadcastQuota(e, 11))).toBe('broadcast_limit')
  })

  it('stops platform AI at the monthly allowance', () => {
    expect(code(() => assertAiQuota(ent({}, { ai_replies_monthly: 299 })))).toBeNull()
    expect(code(() => assertAiQuota(ent({}, { ai_replies_monthly: 300 })))).toBe('ai_limit')
  })

  it('counts pending invitations against seats', () => {
    expect(seatsRemaining(ent({}, { members: 1, pending_invitations: 1 }))).toBe(0)
    expect(code(() => assertSeat(ent({}, { members: 1, pending_invitations: 1 })))).toBe('member_limit')
    expect(code(() => assertSeat(ent({}, { members: 1 })))).toBeNull()
  })

  it('never limits a comped account', () => {
    const e = ent({ is_comped: true }, { broadcast_messages_monthly: 5000, ai_replies_monthly: 5000, members: 50 })
    expect(remaining(e, 'ai_replies_monthly')).toBe(Number.POSITIVE_INFINITY)
    expect(code(() => assertBroadcastQuota(e, 100_000))).toBeNull()
    expect(code(() => assertAiQuota(e))).toBeNull()
    expect(code(() => assertSeat(e))).toBeNull()
  })

  it('never reports negative remaining usage', () => {
    expect(remaining(ent({}, { ai_replies_monthly: 900 }), 'ai_replies_monthly')).toBe(0)
  })

  it('maps database limit errors to plan errors', () => {
    expect(planErrorFromDb({ message: 'plan_limit_contacts: your plan allows 1 contacts' })?.code).toBe('contact_limit')
    expect(planErrorFromDb({ message: 'plan_limit_members: your plan allows 2 team members' })?.code).toBe('member_limit')
    expect(planErrorFromDb({ message: 'new row violates row-level security policy "saas_writable_insert" for table "contacts"' })?.code).toBe('read_only')
    expect(planErrorFromDb({ message: 'duplicate key value' })).toBeNull()
    expect(planErrorFromDb(null)).toBeNull()
  })

  it('computes trial days left', () => {
    const now = new Date('2026-12-08T00:00:00Z')
    expect(trialDaysLeft(ent(), now)).toBe(2)
    expect(trialDaysLeft(ent(), new Date('2026-12-11T00:00:00Z'))).toBe(0)
    expect(trialDaysLeft(ent({ status: 'active' }), now)).toBe(0)
  })
})

describe('getEntitlements', () => {
  it('calls the database function for the account', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: ent(), error: null })
    const result = await getEntitlements({ rpc } as unknown as SupabaseClient, 'acct-1')
    expect(rpc).toHaveBeenCalledWith('get_account_entitlements', { target_account_id: 'acct-1' })
    expect(result?.plan.id).toBe('starter')
  })

  it('returns null (fail open) on a database error or exception', async () => {
    const errored = { rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'not a member' } }) }
    const thrown = { rpc: vi.fn().mockRejectedValue(new Error('network')) }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await getEntitlements(errored as unknown as SupabaseClient, 'a')).toBeNull()
    expect(await getEntitlements(thrown as unknown as SupabaseClient, 'a')).toBeNull()
    spy.mockRestore()
  })
})
