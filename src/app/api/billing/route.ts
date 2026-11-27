import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { getEntitlements } from '@/lib/billing/entitlements'
import { createRazorpay } from '@/lib/billing/razorpay'

/**
 * GET /api/billing — the caller's own plan, status, limits and usage,
 * plus the public plans they could move to. Any member may read it.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const razorpay = createRazorpay()
    const [entitlements, subscription, payments, plans] = await Promise.all([
      getEntitlements(supabase, accountId),
      supabase
        .from('account_subscriptions')
        .select('billing_interval, cancel_at_period_end, razorpay_subscription_id')
        .eq('account_id', accountId)
        .maybeSingle(),
      // RLS returns payments to admins of the account only; others get none.
      supabase
        .from('billing_payments')
        .select('id, amount_paise, currency, status, method, plan_id, billing_interval, paid_at')
        .eq('account_id', accountId)
        .order('paid_at', { ascending: false })
        .limit(24),
      supabase
        .from('plans')
        .select(
          'id, name, description, price_inr_monthly, price_inr_yearly, max_members, max_contacts, max_broadcast_messages_monthly, max_ai_replies_monthly, max_voice_minutes_monthly, max_emails_monthly, sort_order',
        )
        .eq('is_public', true)
        .order('sort_order'),
    ])
    const sub = subscription.data as {
      billing_interval: string | null
      cancel_at_period_end: boolean
      razorpay_subscription_id: string | null
    } | null
    return NextResponse.json({
      entitlements,
      plans: plans.data ?? [],
      subscription: sub
        ? {
            billing_interval: sub.billing_interval,
            cancel_at_period_end: sub.cancel_at_period_end,
            has_paid_subscription: !!sub.razorpay_subscription_id,
          }
        : null,
      payments: payments.data ?? [],
      payments_enabled: razorpay.enabled,
      payments_test_mode: razorpay.testMode,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
