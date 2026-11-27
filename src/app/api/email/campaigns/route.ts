import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { assertWritable, getEntitlements, planErrorFromDb } from '@/lib/billing/entitlements'
import { parseCampaignInput } from '@/lib/email/campaign-input'
import { emailErrorResponse } from '@/lib/email/email-errors'
import { getT } from '@/lib/i18n/translate'

const t = getT('Api')

/** GET /api/email/campaigns — newest first (any member). */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const { data, error } = await supabase
      .from('email_campaigns')
      .select('id, name, subject, body_text, audience, status, recipient_count, sent_count, failed_count, sent_at, created_at')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(100)
    if (error) {
      console.error('[email/campaigns GET] error:', error)
      return NextResponse.json({ error: t('email.errors.loadFailed') }, { status: 500 })
    }
    return NextResponse.json({ campaigns: data ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** POST /api/email/campaigns (agent+) — save a draft. */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')
    const limit = checkRateLimit(`email-campaign:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)
    assertWritable(await getEntitlements(supabase, accountId))

    const input = parseCampaignInput((await request.json().catch(() => null)) as Record<string, unknown> | null)
    if (!input) return NextResponse.json({ error: t('email.errors.invalidCampaign') }, { status: 400 })

    const { data, error } = await supabase
      .from('email_campaigns')
      .insert({ account_id: accountId, created_by: userId, ...input })
      .select('id')
      .single()
    if (error || !data) {
      const planErr = planErrorFromDb(error)
      if (planErr) throw planErr
      console.error('[email/campaigns POST] error:', error)
      return NextResponse.json({ error: t('email.errors.saveFailed') }, { status: 500 })
    }
    return NextResponse.json({ id: (data as { id: string }).id })
  } catch (err) {
    return emailErrorResponse(err) ?? toErrorResponse(err)
  }
}
