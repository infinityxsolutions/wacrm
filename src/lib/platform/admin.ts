// ============================================================
// Platform owner (super-admin) access.
//
// The GrowthXAi owner manages every business from /admin. Who counts as
// a platform admin is configured on the server only:
//
//   PLATFORM_ADMIN_EMAILS=owner@example.com,partner@example.com
//
// There is deliberately no database flag a user could set on themselves.
// All platform reads/writes go through the service-role client after this
// check, and every change is written to platform_audit_log.
// ============================================================

import { createClient as createServiceClient, type SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { ForbiddenError, UnauthorizedError } from '@/lib/auth/account'

/** Parse PLATFORM_ADMIN_EMAILS into a normalised set. */
export function platformAdminEmails(raw: string | undefined = process.env.PLATFORM_ADMIN_EMAILS): Set<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.length > 3 && e.includes('@')),
  )
}

export function isPlatformAdminEmail(email: string | null | undefined, raw?: string): boolean {
  if (!email) return false
  return platformAdminEmails(raw).has(email.trim().toLowerCase())
}

let _service: SupabaseClient | null = null

/** Service-role client for platform-wide reads/writes. Server only. */
export function platformDb(): SupabaseClient {
  if (!_service) {
    _service = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    )
  }
  return _service
}

/**
 * Resolve the signed-in user and require them to be a platform admin.
 * Throws UnauthorizedError (no session) or ForbiddenError (not an admin).
 */
export async function requirePlatformAdmin(): Promise<{ email: string; userId: string }> {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error || !user) throw new UnauthorizedError()
  if (!isPlatformAdminEmail(user.email)) throw new ForbiddenError()
  return { email: user.email!.toLowerCase(), userId: user.id }
}

/** Best-effort audit entry; never blocks the action it records. */
export async function auditPlatformAction(
  db: SupabaseClient,
  entry: { actorEmail: string; action: string; accountId?: string | null; details?: Record<string, unknown> },
): Promise<void> {
  const { error } = await db.from('platform_audit_log').insert({
    actor_email: entry.actorEmail,
    action: entry.action,
    account_id: entry.accountId ?? null,
    details: entry.details ?? {},
  })
  if (error) console.error('[platform audit] insert failed:', error)
}

// ------------------------------------------------------------
// Account actions — validated here so the route stays thin and the
// rules are unit-testable.
// ------------------------------------------------------------

export type AccountAction =
  | { action: 'extend_trial'; days: number }
  | { action: 'set_plan'; planId: string }
  | { action: 'suspend'; reason: string }
  | { action: 'reactivate' }
  | { action: 'set_comped'; value: boolean }

export function parseAccountAction(body: unknown): AccountAction | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'Invalid request body' }
  const b = body as Record<string, unknown>
  switch (b.action) {
    case 'extend_trial': {
      const days = Number(b.days)
      if (!Number.isInteger(days) || days < 1 || days > 365) {
        return { error: 'days must be a whole number from 1 to 365' }
      }
      return { action: 'extend_trial', days }
    }
    case 'set_plan': {
      const planId = typeof b.plan_id === 'string' ? b.plan_id.trim() : ''
      if (!/^[a-z0-9_]{2,32}$/.test(planId)) return { error: 'plan_id is invalid' }
      return { action: 'set_plan', planId }
    }
    case 'suspend': {
      const reason = typeof b.reason === 'string' ? b.reason.trim().slice(0, 500) : ''
      if (!reason) return { error: 'A reason is required to suspend a business' }
      return { action: 'suspend', reason }
    }
    case 'reactivate':
      return { action: 'reactivate' }
    case 'set_comped':
      if (typeof b.value !== 'boolean') return { error: 'value must be true or false' }
      return { action: 'set_comped', value: b.value }
    default:
      return { error: 'Unknown action' }
  }
}

/**
 * The subscription update an action produces, given the current row.
 * Extending a trial counts from the later of now and the current trial
 * end, so a still-running trial is lengthened rather than reset.
 */
export function subscriptionPatch(
  action: AccountAction,
  current: { trial_ends_at: string | null; status: string },
  now: Date = new Date(),
): Record<string, unknown> {
  switch (action.action) {
    case 'extend_trial': {
      const currentEnd = current.trial_ends_at ? new Date(current.trial_ends_at) : now
      const base = currentEnd > now ? currentEnd : now
      return {
        status: 'trialing',
        trial_ends_at: new Date(base.getTime() + action.days * 86_400_000).toISOString(),
        suspended_reason: null,
      }
    }
    case 'set_plan':
      return { plan_id: action.planId }
    case 'suspend':
      return { status: 'suspended', suspended_reason: action.reason }
    case 'reactivate':
      // Back to a trial if it was never paid, otherwise to active; the
      // writability rules then apply the dates as usual.
      return {
        status: current.trial_ends_at && current.status !== 'active' ? 'trialing' : 'active',
        suspended_reason: null,
      }
    case 'set_comped':
      return { is_comped: action.value }
  }
}

// ------------------------------------------------------------
// Plan + platform settings validation
// ------------------------------------------------------------

const PLAN_INT_FIELDS = [
  'price_inr_monthly',
  'max_members',
  'max_contacts',
  'max_broadcast_messages_monthly',
  'max_ai_replies_monthly',
  'max_voice_minutes_monthly',
  'sort_order',
] as const

export function parsePlanUpdate(body: unknown): { id: string; patch: Record<string, unknown> } | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'Invalid request body' }
  const b = body as Record<string, unknown>
  const id = typeof b.id === 'string' ? b.id.trim() : ''
  if (!/^[a-z0-9_]{2,32}$/.test(id)) return { error: 'Plan id is invalid' }
  const patch: Record<string, unknown> = {}
  if (typeof b.name === 'string') {
    const name = b.name.trim()
    if (!name || name.length > 60) return { error: 'Name must be 1–60 characters' }
    patch.name = name
  }
  if (typeof b.description === 'string') patch.description = b.description.trim().slice(0, 300) || null
  if (typeof b.is_public === 'boolean') patch.is_public = b.is_public
  for (const field of PLAN_INT_FIELDS) {
    if (b[field] === undefined) continue
    const value = Number(b[field])
    if (!Number.isInteger(value) || value < 0 || value > 10_000_000) {
      return { error: `${field} must be a whole number of 0 or more` }
    }
    if (field === 'max_members' && value < 1) return { error: 'max_members must be at least 1' }
    patch[field] = value
  }
  // Yearly price: a whole number of rupees, or empty/null to use 10 x monthly.
  if (b.price_inr_yearly !== undefined) {
    if (b.price_inr_yearly === null || b.price_inr_yearly === '') {
      patch.price_inr_yearly = null
    } else {
      const value = Number(b.price_inr_yearly)
      if (!Number.isInteger(value) || value < 0 || value > 10_000_000) {
        return { error: 'price_inr_yearly must be a whole number of 0 or more' }
      }
      patch.price_inr_yearly = value
    }
  }
  if (Object.keys(patch).length === 0) return { error: 'Nothing to update' }
  return { id, patch }
}

export function parsePlatformSettings(body: unknown): Record<string, unknown> | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'Invalid request body' }
  const b = body as Record<string, unknown>
  const patch: Record<string, unknown> = {}
  if (b.signup_mode !== undefined) {
    if (b.signup_mode !== 'open' && b.signup_mode !== 'invite_only') return { error: 'signup_mode must be open or invite_only' }
    patch.signup_mode = b.signup_mode
  }
  for (const [field, max] of [['trial_days', 365], ['grace_days', 60]] as const) {
    if (b[field] === undefined) continue
    const value = Number(b[field])
    if (!Number.isInteger(value) || value < 0 || value > max) return { error: `${field} must be 0–${max}` }
    patch[field] = value
  }
  if (b.default_plan_id !== undefined) {
    if (typeof b.default_plan_id !== 'string' || !/^[a-z0-9_]{2,32}$/.test(b.default_plan_id)) {
      return { error: 'default_plan_id is invalid' }
    }
    patch.default_plan_id = b.default_plan_id
  }
  if (Object.keys(patch).length === 0) return { error: 'Nothing to update' }
  return patch
}

export function normaliseAllowlistEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const email = raw.trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : null
}
