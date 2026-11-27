import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { assertWritable, getEntitlements } from '@/lib/billing/entitlements'
import { createEmailSender } from '@/lib/email'
import { publicBaseUrl } from '@/lib/email/base-url'
import { emailErrorResponse } from '@/lib/email/email-errors'
import { loadSettings, sendTestEmail } from '@/lib/email/send'
import { EmailError } from '@/lib/email'
import { getT } from '@/lib/i18n/translate'

const t = getT('Api')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** POST /api/email/campaigns/[id]/test (agent+) — send one preview to the signed-in user's own address. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: t('common.notFound') }, { status: 404 })
    const { supabase, accountId, userId } = await requireRole('agent')
    const limit = checkRateLimit(`email-test:${userId}`, { limit: 10, windowMs: 60_000 })
    if (!limit.success) return rateLimitResponse(limit)
    assertWritable(await getEntitlements(supabase, accountId))

    const { data: userData } = await supabase.auth.getUser()
    const to = userData.user?.email
    if (!to) return NextResponse.json({ error: t('email.errors.testNoEmail') }, { status: 400 })

    const { data: c, error } = await supabase
      .from('email_campaigns')
      .select('subject, body_text')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (error) throw error
    if (!c) throw new EmailError('campaign_not_found', 'Campaign not found', 404)

    const settings = await loadSettings(supabase, accountId)
    const result = await sendTestEmail(createEmailSender(), settings, c as { subject: string; body_text: string }, to, publicBaseUrl(request))
    if (!result.ok) {
      console.error('[email/test] provider error:', result.error)
      return NextResponse.json({ error: t('email.errors.testFailed') }, { status: 502 })
    }
    return NextResponse.json({ success: true, sent_to: to })
  } catch (err) {
    return emailErrorResponse(err) ?? toErrorResponse(err)
  }
}
