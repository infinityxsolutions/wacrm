import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { createRazorpay } from '@/lib/billing/razorpay'
import { cancelSubscription } from '@/lib/billing/razorpay/subscribe'
import { billingErrorResponse } from '@/lib/billing/billing-errors'
import { platformDb } from '@/lib/platform/admin'

/** POST /api/billing/cancel  (admin+) — stop renewals; access continues to the end of the paid period. */
export async function POST() {
  try {
    const { accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`billing-cancel:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)
    const result = await cancelSubscription(platformDb(), createRazorpay(), accountId)
    return NextResponse.json({ success: true, ...result })
  } catch (err) {
    return billingErrorResponse(err) ?? toErrorResponse(err)
  }
}
