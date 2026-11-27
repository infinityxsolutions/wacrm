import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { assertWritable, getEntitlements, planErrorFromDb } from '@/lib/billing/entitlements'
import { emailErrorResponse } from '@/lib/email/email-errors'
import { getT } from '@/lib/i18n/translate'
import { parseCampaignInput } from '@/lib/email/campaign-input'

const t = getT('Api')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** PATCH /api/email/campaigns/[id] (agent+) — edit a draft. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: t('common.notFound') }, { status: 404 })
    const { supabase, accountId } = await requireRole('agent')
    assertWritable(await getEntitlements(supabase, accountId))

    const input = parseCampaignInput((await request.json().catch(() => null)) as Record<string, unknown> | null)
    if (!input) return NextResponse.json({ error: t('email.errors.invalidCampaign') }, { status: 400 })

    const { data, error } = await supabase
      .from('email_campaigns')
      .update(input)
      .eq('id', id)
      .eq('account_id', accountId)
      .eq('status', 'draft')
      .select('id')
    if (error) {
      const planErr = planErrorFromDb(error)
      if (planErr) throw planErr
      console.error('[email/campaigns PATCH] error:', error)
      return NextResponse.json({ error: t('email.errors.saveFailed') }, { status: 500 })
    }
    if (!data || data.length === 0) {
      return NextResponse.json({ error: t('email.errors.notDraft'), code: 'not_draft' }, { status: 409 })
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    return emailErrorResponse(err) ?? toErrorResponse(err)
  }
}

/** DELETE /api/email/campaigns/[id] (admin+) — remove a campaign and its recipient rows. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: t('common.notFound') }, { status: 404 })
    const { supabase, accountId } = await requireRole('admin')
    const { error } = await supabase.from('email_campaigns').delete().eq('id', id).eq('account_id', accountId)
    if (error) {
      console.error('[email/campaigns DELETE] error:', error)
      return NextResponse.json({ error: t('email.errors.saveFailed') }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
