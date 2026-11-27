import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { planErrorFromDb } from '@/lib/billing/entitlements'
import { getT } from '@/lib/i18n/translate'

const t = getT('Api')
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** PUT /api/email/settings (admin+) — sender name, reply-to address and postal address for the footer. */
export async function PUT(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`email-settings:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const b = (await request.json().catch(() => null)) as Record<string, unknown> | null
    const clean = (v: unknown) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '')
    const from_name = clean(b?.from_name)
    const reply_to_email = clean(b?.reply_to_email)
    const business_address = clean(b?.business_address)
    if (
      from_name.length < 1 || from_name.length > 80 ||
      !EMAIL.test(reply_to_email) || reply_to_email.length > 254 ||
      business_address.length < 5 || business_address.length > 300
    ) {
      return NextResponse.json({ error: t('email.errors.invalidSettings') }, { status: 400 })
    }

    const { error } = await supabase
      .from('email_settings')
      .upsert({ account_id: accountId, from_name, reply_to_email, business_address }, { onConflict: 'account_id' })
    if (error) {
      const planErr = planErrorFromDb(error)
      if (planErr) throw planErr
      console.error('[email/settings PUT] error:', error)
      return NextResponse.json({ error: t('email.errors.saveFailed') }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
