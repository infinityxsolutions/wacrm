import type { SupabaseClient } from '@supabase/supabase-js'
import { planPriceInr, toPaise, totalCount } from './pricing'
import type { BillingInterval, RazorpayClient } from './razorpay.types'

export type BillingErrorCode =
  | 'plan_not_found'
  | 'free_plan'
  | 'comped'
  | 'suspended'
  | 'already_subscribed'
  | 'not_subscribed'

export class BillingError extends Error {
  constructor(
    readonly code: BillingErrorCode,
    message: string,
    readonly status: number = 400,
  ) {
    super(message)
    this.name = 'BillingError'
  }
}

interface PlanRow {
  id: string
  name: string
  price_inr_monthly: number
  price_inr_yearly: number | null
  is_public: boolean
  razorpay_plans: Partial<Record<BillingInterval, { id: string; amount_inr: number }>> | null
}

interface SubRow {
  status: string
  is_comped: boolean
  razorpay_subscription_id: string | null
}

/**
 * Create a hosted Razorpay checkout for `planId`. Runs on the service-role
 * client (plans and subscriptions are not writable by members). Returns the
 * URL the customer pays on; the webhook activates the plan once paid.
 */
export async function startCheckout(
  db: SupabaseClient,
  razorpay: RazorpayClient,
  input: { accountId: string; planId: string; interval: BillingInterval },
): Promise<{ url: string; subscriptionId: string }> {
  const [{ data: plan, error: planErr }, { data: sub, error: subErr }] = await Promise.all([
    db
      .from('plans')
      .select('id, name, price_inr_monthly, price_inr_yearly, is_public, razorpay_plans')
      .eq('id', input.planId)
      .maybeSingle(),
    db
      .from('account_subscriptions')
      .select('status, is_comped, razorpay_subscription_id')
      .eq('account_id', input.accountId)
      .maybeSingle(),
  ])
  if (planErr) throw planErr
  if (subErr) throw subErr
  const p = plan as PlanRow | null
  const s = sub as SubRow | null
  if (!p || !p.is_public) throw new BillingError('plan_not_found', 'That plan is not available', 404)
  if (s?.is_comped) throw new BillingError('comped', 'This account is on a complimentary plan')
  if (s?.status === 'suspended') throw new BillingError('suspended', 'This account is suspended. Contact support', 403)
  if (s && (s.status === 'active' || s.status === 'past_due') && s.razorpay_subscription_id) {
    throw new BillingError('already_subscribed', 'You already have a paid subscription. Cancel it first to change plan', 409)
  }

  const amountInr = planPriceInr(p, input.interval)
  if (amountInr <= 0) throw new BillingError('free_plan', 'This plan has no price set')

  // Razorpay plans are immutable: reuse the one matching the current price,
  // otherwise create a new one and remember it.
  let razorpayPlanId = p.razorpay_plans?.[input.interval]?.id
  if (!razorpayPlanId || p.razorpay_plans?.[input.interval]?.amount_inr !== amountInr) {
    const created = await razorpay.createPlan({
      interval: input.interval,
      name: `${p.name} (${input.interval})`,
      description: `GrowthXAi ${p.name} plan, billed ${input.interval}`,
      amountPaise: toPaise(amountInr),
      notes: { plan_id: p.id, interval: input.interval },
    })
    razorpayPlanId = created.id
    const { error } = await db
      .from('plans')
      .update({
        razorpay_plans: { ...(p.razorpay_plans ?? {}), [input.interval]: { id: created.id, amount_inr: amountInr } },
      })
      .eq('id', p.id)
    if (error) throw error
  }

  const subscription = await razorpay.createSubscription({
    razorpayPlanId,
    totalCount: totalCount(input.interval),
    notes: { account_id: input.accountId, plan_id: p.id, interval: input.interval },
  })

  const { error: saveErr } = await db
    .from('account_subscriptions')
    .update({ razorpay_subscription_id: subscription.id })
    .eq('account_id', input.accountId)
  if (saveErr) throw saveErr

  return { url: subscription.shortUrl, subscriptionId: subscription.id }
}

/** Stop renewals. An active plan runs to the end of the paid period; a failing one stops now. */
export async function cancelSubscription(
  db: SupabaseClient,
  razorpay: RazorpayClient,
  accountId: string,
): Promise<{ cancelAtPeriodEnd: boolean }> {
  const { data, error } = await db
    .from('account_subscriptions')
    .select('status, razorpay_subscription_id')
    .eq('account_id', accountId)
    .maybeSingle()
  if (error) throw error
  const s = data as { status: string; razorpay_subscription_id: string | null } | null
  if (!s?.razorpay_subscription_id || (s.status !== 'active' && s.status !== 'past_due')) {
    throw new BillingError('not_subscribed', 'There is no active paid subscription to cancel', 409)
  }
  const atCycleEnd = s.status === 'active'
  await razorpay.cancelSubscription(s.razorpay_subscription_id, atCycleEnd)
  if (atCycleEnd) {
    const { error: upErr } = await db
      .from('account_subscriptions')
      .update({ cancel_at_period_end: true })
      .eq('account_id', accountId)
    if (upErr) throw upErr
  }
  return { cancelAtPeriodEnd: atCycleEnd }
}
