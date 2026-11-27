import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { createRazorpay } from '@/lib/billing/razorpay'
import { isInterval } from '@/lib/billing/razorpay/pricing'
import { startCheckout } from '@/lib/billing/razorpay/subscribe'
import { billingErrorResponse } from '@/lib/billing/billing-errors'
import { platformDb } from '@/lib/platform/admin'
import { getT } from '@/lib/i18n/translate'

const t = getT('Api')

/**
 * POST /api/billing/checkout  (admin+)
 * Body: { plan_id, interval: 'monthly' | 'yearly' }
 * Returns { url }: the hosted Razorpay page to pay on.
 */
export async function POST(request: Request) {
  try {
    const { accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`billing-checkout:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = (await request.json().catch(() => null)) as { plan_id?: unknown; interval?: unknown } | null
    if (typeof body?.plan_id !== 'string' || !/^[a-z0-9_]{2,32}$/.test(body.plan_id) || !isInterval(body.interval)) {
      return NextResponse.json({ error: t('billing.errors.invalidRequest') }, { status: 400 })
    }

    const razorpay = createRazorpay()
    if (!razorpay.enabled) {
      return NextResponse.json({ error: t('billing.errors.notConfigured'), code: 'billing_not_configured' }, { status: 503 })
    }
    const { url } = await startCheckout(platformDb(), razorpay, {
      accountId,
      planId: body.plan_id,
      interval: body.interval,
    })
    return NextResponse.json({ url })
  } catch (err) {
    return billingErrorResponse(err) ?? toErrorResponse(err)
  }
}
