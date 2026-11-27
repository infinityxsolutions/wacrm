import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { getEntitlements } from '@/lib/billing/entitlements'
import { createEmailSender } from '@/lib/email'
import { getEmailQuota } from '@/lib/email/quota'
import { getT } from '@/lib/i18n/translate'

const t = getT('Api')

/** GET /api/email/status — is email switched on, the sender settings and this month's allowance (any member). */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const ent = await getEntitlements(supabase, accountId)
    const [settings, quota] = await Promise.all([
      supabase
        .from('email_settings')
        .select('from_name, reply_to_email, business_address')
        .eq('account_id', accountId)
        .maybeSingle(),
      getEmailQuota(supabase, accountId, ent),
    ])
    if (settings.error) {
      console.error('[email/status] settings error:', settings.error)
      return NextResponse.json({ error: t('email.errors.loadFailed') }, { status: 500 })
    }
    return NextResponse.json({
      enabled: createEmailSender().enabled,
      settings: settings.data ?? null,
      quota: {
        limit: quota.limit,
        used: quota.used,
        remaining: Number.isFinite(quota.remaining) ? quota.remaining : null,
        unlimited: !Number.isFinite(quota.remaining),
      },
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
