import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { getEntitlements } from '@/lib/billing/entitlements'
import { createEmailSender } from '@/lib/email'
import { publicBaseUrl } from '@/lib/email/base-url'
import { emailErrorResponse } from '@/lib/email/email-errors'
import { sendCampaign } from '@/lib/email/send'
import { getT } from '@/lib/i18n/translate'

export const maxDuration = 60

const t = getT('Api')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** POST /api/email/campaigns/[id]/send (agent+) — send a draft to its audience. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: t('common.notFound') }, { status: 404 })
    const { supabase, accountId, userId } = await requireRole('agent')
    const limit = checkRateLimit(`email-send:${userId}`, { limit: 5, windowMs: 60_000 })
    if (!limit.success) return rateLimitResponse(limit)

    const report = await sendCampaign(
      supabase,
      createEmailSender(),
      { accountId, baseUrl: publicBaseUrl(request), entitlements: await getEntitlements(supabase, accountId) },
      id,
    )
    return NextResponse.json({ success: true, ...report })
  } catch (err) {
    return emailErrorResponse(err) ?? toErrorResponse(err)
  }
}
