// ============================================================
// SaaS entitlements — what an account's plan allows and how much of
// it has been used this month.
//
// The single source of truth is the database function
// `get_account_entitlements(account_id)` (migration 062); this module
// reads it and turns it into checks API routes can call before they
// send messages or spend platform AI.
//
// Failure policy: if the entitlements cannot be loaded (for example the
// migration has not been applied yet on an environment), enforcement
// FAILS OPEN and logs. A billing bookkeeping problem must never take
// down a business's live WhatsApp inbox. The database's own RLS and
// triggers still enforce read-only mode and contact/member limits.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { getT } from '@/lib/i18n/translate'

const t = getT('Billing')

export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'suspended'

export interface PlanLimits {
  members: number
  contacts: number
  broadcast_messages_monthly: number
  ai_replies_monthly: number
  voice_minutes_monthly: number
}

export interface PlanUsage {
  members: number
  pending_invitations: number
  contacts: number
  broadcast_messages_monthly: number
  ai_replies_monthly: number
  voice_minutes_monthly: number
}

export interface Entitlements {
  account_id: string
  plan: { id: string; name: string; price_inr_monthly: number }
  status: SubscriptionStatus
  is_comped: boolean
  trial_ends_at: string | null
  current_period_end: string | null
  grace_days: number
  writable: boolean
  limits: PlanLimits
  usage: PlanUsage
}

export type PlanLimitCode =
  | 'read_only'
  | 'broadcast_limit'
  | 'ai_limit'
  | 'member_limit'
  | 'contact_limit'

/** Thrown when a plan limit blocks an action. Maps to HTTP 402. */
export class PlanLimitError extends Error {
  readonly status = 402 as const
  constructor(
    readonly code: PlanLimitCode,
    message: string,
  ) {
    super(message)
    this.name = 'PlanLimitError'
  }
}

/**
 * Load an account's entitlements. Returns `null` (and logs) when they
 * cannot be read, so callers fail open — see the header comment.
 */
export async function getEntitlements(
  db: SupabaseClient,
  accountId: string,
): Promise<Entitlements | null> {
  try {
    const { data, error } = await db.rpc('get_account_entitlements', {
      target_account_id: accountId,
    })
    if (error) {
      console.error('[billing] get_account_entitlements failed:', error)
      return null
    }
    return (data as Entitlements | null) ?? null
  } catch (err) {
    console.error('[billing] get_account_entitlements threw:', err)
    return null
  }
}

/** Units left this month for a metered limit; never negative. Comped accounts are unlimited. */
export function remaining(
  ent: Entitlements,
  key: 'broadcast_messages_monthly' | 'ai_replies_monthly' | 'voice_minutes_monthly',
): number {
  if (ent.is_comped) return Number.POSITIVE_INFINITY
  return Math.max(0, ent.limits[key] - ent.usage[key])
}

/** Seats left (members + pending invitations count against the plan). */
export function seatsRemaining(ent: Entitlements): number {
  if (ent.is_comped) return Number.POSITIVE_INFINITY
  return Math.max(0, ent.limits.members - ent.usage.members - ent.usage.pending_invitations)
}

/** Throw unless the account may change data (trial, paid, grace or comped). */
export function assertWritable(ent: Entitlements | null): void {
  if (ent && !ent.writable) {
    throw new PlanLimitError('read_only', t('readOnly'))
  }
}

/** Throw unless `count` more broadcast messages fit in this month's allowance. */
export function assertBroadcastQuota(ent: Entitlements | null, count: number): void {
  if (!ent) return
  assertWritable(ent)
  const left = remaining(ent, 'broadcast_messages_monthly')
  if (count > left) {
    throw new PlanLimitError(
      'broadcast_limit',
      t('broadcastLimit', {
        remaining: Number.isFinite(left) ? left : 0,
        limit: ent.limits.broadcast_messages_monthly,
        requested: count,
      }),
    )
  }
}

/** Throw unless one more platform-AI reply fits in this month's allowance. */
export function assertAiQuota(ent: Entitlements | null): void {
  if (!ent) return
  assertWritable(ent)
  if (remaining(ent, 'ai_replies_monthly') < 1) {
    throw new PlanLimitError(
      'ai_limit',
      t('aiLimit', { limit: ent.limits.ai_replies_monthly }),
    )
  }
}

/** Throw unless another team member (invitation) fits in the plan. */
export function assertSeat(ent: Entitlements | null): void {
  if (!ent) return
  assertWritable(ent)
  if (seatsRemaining(ent) < 1) {
    throw new PlanLimitError('member_limit', t('memberLimit', { limit: ent.limits.members }))
  }
}

/**
 * Map a Postgres error raised by the 062 limit triggers to a
 * PlanLimitError, so a direct database rejection still produces a clear
 * message. Returns null for unrelated errors.
 */
export function planErrorFromDb(err: { message?: string } | null | undefined): PlanLimitError | null {
  const msg = err?.message ?? ''
  if (msg.includes('plan_limit_contacts')) {
    return new PlanLimitError('contact_limit', t('contactLimit'))
  }
  if (msg.includes('plan_limit_members')) {
    return new PlanLimitError('member_limit', t('memberLimitGeneric'))
  }
  if (msg.includes('saas_writable_')) {
    return new PlanLimitError('read_only', t('readOnly'))
  }
  return null
}

/** Days left in the trial (0 when ended or not trialing). */
export function trialDaysLeft(ent: Entitlements, now: Date = new Date()): number {
  if (ent.status !== 'trialing' || !ent.trial_ends_at) return 0
  const ms = new Date(ent.trial_ends_at).getTime() - now.getTime()
  return ms <= 0 ? 0 : Math.ceil(ms / 86_400_000)
}
