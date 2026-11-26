import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import {
  isPlatformAdminEmail,
  normaliseAllowlistEmail,
  parseAccountAction,
  parsePlanUpdate,
  parsePlatformSettings,
  platformAdminEmails,
  subscriptionPatch,
} from './admin'

describe('platform admin emails', () => {
  it('parses a comma list, case-insensitively, ignoring junk', () => {
    expect([...platformAdminEmails(' Owner@Example.com, ,x, partner@example.com ')]).toEqual([
      'owner@example.com',
      'partner@example.com',
    ])
  })

  it('only matches configured emails, and nobody when unset', () => {
    expect(isPlatformAdminEmail('OWNER@example.com', 'owner@example.com')).toBe(true)
    expect(isPlatformAdminEmail('someone@example.com', 'owner@example.com')).toBe(false)
    expect(isPlatformAdminEmail('owner@example.com', '')).toBe(false)
    expect(isPlatformAdminEmail(null, 'owner@example.com')).toBe(false)
  })
})

describe('account actions', () => {
  it('validates each action', () => {
    expect(parseAccountAction({ action: 'extend_trial', days: 7 })).toEqual({ action: 'extend_trial', days: 7 })
    expect(parseAccountAction({ action: 'extend_trial', days: 0 })).toHaveProperty('error')
    expect(parseAccountAction({ action: 'extend_trial', days: 1.5 })).toHaveProperty('error')
    expect(parseAccountAction({ action: 'set_plan', plan_id: 'growth' })).toEqual({ action: 'set_plan', planId: 'growth' })
    expect(parseAccountAction({ action: 'set_plan', plan_id: 'Growth; drop' })).toHaveProperty('error')
    expect(parseAccountAction({ action: 'suspend', reason: '  ' })).toHaveProperty('error')
    expect(parseAccountAction({ action: 'suspend', reason: 'unpaid' })).toEqual({ action: 'suspend', reason: 'unpaid' })
    expect(parseAccountAction({ action: 'set_comped', value: 'yes' })).toHaveProperty('error')
    expect(parseAccountAction({ action: 'delete_everything' })).toHaveProperty('error')
    expect(parseAccountAction(null)).toHaveProperty('error')
  })

  it('extends a running trial from its current end, and an expired one from now', () => {
    const now = new Date('2026-12-01T00:00:00Z')
    const running = subscriptionPatch(
      { action: 'extend_trial', days: 7 },
      { trial_ends_at: '2026-12-05T00:00:00Z', status: 'trialing' },
      now,
    )
    expect(running).toMatchObject({ status: 'trialing', trial_ends_at: '2026-12-12T00:00:00.000Z' })
    const expired = subscriptionPatch(
      { action: 'extend_trial', days: 7 },
      { trial_ends_at: '2026-11-01T00:00:00Z', status: 'trialing' },
      now,
    )
    expect(expired).toMatchObject({ trial_ends_at: '2026-12-08T00:00:00.000Z' })
  })

  it('suspends with a reason and reactivates to trial or active', () => {
    expect(subscriptionPatch({ action: 'suspend', reason: 'abuse' }, { trial_ends_at: null, status: 'active' })).toEqual({
      status: 'suspended',
      suspended_reason: 'abuse',
    })
    expect(
      subscriptionPatch({ action: 'reactivate' }, { trial_ends_at: '2026-12-10T00:00:00Z', status: 'suspended' }),
    ).toMatchObject({ status: 'trialing', suspended_reason: null })
    expect(subscriptionPatch({ action: 'reactivate' }, { trial_ends_at: null, status: 'suspended' })).toMatchObject({
      status: 'active',
    })
  })
})

describe('plan and settings validation', () => {
  it('accepts valid plan edits and rejects bad numbers', () => {
    expect(parsePlanUpdate({ id: 'starter', price_inr_monthly: 799, max_members: 2 })).toEqual({
      id: 'starter',
      patch: { price_inr_monthly: 799, max_members: 2 },
    })
    expect(parsePlanUpdate({ id: 'starter', price_inr_monthly: -1 })).toHaveProperty('error')
    expect(parsePlanUpdate({ id: 'starter', max_members: 0 })).toHaveProperty('error')
    expect(parsePlanUpdate({ id: 'starter' })).toHaveProperty('error')
    expect(parsePlanUpdate({ id: '../x', name: 'X' })).toHaveProperty('error')
  })

  it('accepts valid platform settings and rejects bad ones', () => {
    expect(parsePlatformSettings({ signup_mode: 'invite_only', trial_days: 14 })).toEqual({
      signup_mode: 'invite_only',
      trial_days: 14,
    })
    expect(parsePlatformSettings({ signup_mode: 'everyone' })).toHaveProperty('error')
    expect(parsePlatformSettings({ grace_days: 99 })).toHaveProperty('error')
    expect(parsePlatformSettings({})).toHaveProperty('error')
  })

  it('normalises allowlist emails', () => {
    expect(normaliseAllowlistEmail('  Owner@Shop.IN ')).toBe('owner@shop.in')
    expect(normaliseAllowlistEmail('not-an-email')).toBeNull()
    expect(normaliseAllowlistEmail(42)).toBeNull()
  })
})
