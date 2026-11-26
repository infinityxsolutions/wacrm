import { NextResponse } from 'next/server'
import { getT } from '@/lib/i18n/translate'
import { BillingError } from './razorpay/subscribe'
import { BillingNotConfiguredError, RazorpayApiError } from './razorpay'

const t = getT('Api')

/**
 * Turn a billing failure into an HTTP response with a stable `code`.
 * Returns null for anything else so the caller falls back to
 * `toErrorResponse`.
 */
export function billingErrorResponse(err: unknown): NextResponse | null {
  if (err instanceof BillingError) {
    return NextResponse.json({ error: t(`billing.errors.${err.code}`), code: err.code }, { status: err.status })
  }
  if (err instanceof BillingNotConfiguredError) {
    return NextResponse.json({ error: t('billing.errors.notConfigured'), code: 'billing_not_configured' }, { status: 503 })
  }
  if (err instanceof RazorpayApiError) {
    console.error('[billing] Razorpay API error:', err.status, err.message)
    return NextResponse.json({ error: t('billing.errors.providerFailed'), code: 'provider_error' }, { status: 502 })
  }
  return null
}
