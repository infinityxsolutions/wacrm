import type { SupabaseClient } from '@supabase/supabase-js'
import { PlanLimitError, type Entitlements } from '@/lib/billing/entitlements'
import { getT } from '@/lib/i18n/translate'

const t = getT('Billing')

export interface EmailQuota {
  limit: number
  used: number
  /** Infinity for complimentary accounts. */
  remaining: number
}

function monthStartIso(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
}

/**
 * This month's email allowance. Emails count once they were handed to the
 * provider (anything except queued/failed), so a failed send is free.
 * Unknown plan data fails open, like the rest of the entitlement checks.
 */
export async function getEmailQuota(
  db: SupabaseClient,
  accountId: string,
  ent: Entitlements | null,
  now: Date = new Date(),
): Promise<EmailQuota> {
  const [{ count, error }, plan] = await Promise.all([
    db
      .from('email_recipients')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .gte('created_at', monthStartIso(now))
      .not('status', 'in', '(queued,failed)'),
    ent
      ? db.from('plans').select('max_emails_monthly').eq('id', ent.plan.id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])
  if (error) throw error
  const used = count ?? 0
  const limit = (plan.data as { max_emails_monthly?: number } | null)?.max_emails_monthly ?? 0
  if (!ent || ent.is_comped) return { limit, used, remaining: Number.POSITIVE_INFINITY }
  return { limit, used, remaining: Math.max(0, limit - used) }
}

/** Throw unless `count` more emails fit this month. */
export function assertEmailQuota(quota: EmailQuota, count: number): void {
  if (count > quota.remaining) {
    throw new PlanLimitError(
      'email_limit',
      t('emailLimit', { limit: quota.limit, remaining: Number.isFinite(quota.remaining) ? quota.remaining : 0 }),
    )
  }
}
