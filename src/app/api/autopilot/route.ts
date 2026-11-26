import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { assertWritable, getEntitlements, planErrorFromDb } from '@/lib/billing/entitlements'
import { loadEmbeddingsKey, platformAiSettings } from '@/lib/ai/config'
import { ingestDocument } from '@/lib/ai/knowledge'
import {
  buildCarDetailingSetup,
  CAR_DETAILING_PACK,
  parseCarDetailingAnswers,
} from '@/lib/autopilot/car-detailing'
import { applyAutopilotSetup, AutopilotApplyError } from '@/lib/autopilot/apply'
import { getT } from '@/lib/i18n/translate'

const t = getT('Api')

/** GET /api/autopilot — the account's saved questionnaire and last generated setup (any member). */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const { data, error } = await supabase
      .from('business_profiles')
      .select('pack, answers, generated, applied_at, updated_at')
      .eq('account_id', accountId)
      .maybeSingle()
    if (error) {
      console.error('[autopilot GET] error:', error)
      return NextResponse.json({ error: t('autopilot.loadFailed') }, { status: 500 })
    }
    return NextResponse.json({ profile: data ?? null })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/autopilot  (admin+)
 * Body: { answers, mode: 'preview' | 'apply' }
 *
 * preview — validate and return the generated setup, nothing saved.
 * apply   — save the answers and build the setup into this account.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`autopilot:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = (await request.json().catch(() => null)) as { answers?: unknown; mode?: unknown } | null
    if (!body) return NextResponse.json({ error: t('common.invalidJson') }, { status: 400 })

    const parsed = parseCarDetailingAnswers(body.answers)
    if (!parsed.ok) {
      return NextResponse.json({ error: t('autopilot.invalidAnswers'), errors: parsed.errors }, { status: 400 })
    }
    const setup = buildCarDetailingSetup(parsed.value)
    if (body.mode !== 'apply') return NextResponse.json({ setup })

    assertWritable(await getEntitlements(supabase, accountId))

    const { error: saveErr } = await supabase.from('business_profiles').upsert(
      {
        account_id: accountId,
        pack: CAR_DETAILING_PACK,
        answers: parsed.value,
        generated: setup,
      },
      { onConflict: 'account_id' },
    )
    if (saveErr) {
      const planErr = planErrorFromDb(saveErr)
      if (planErr) throw planErr
      console.error('[autopilot POST] profile save error:', saveErr)
      return NextResponse.json({ error: t('autopilot.applyFailed') }, { status: 500 })
    }

    const { key: embeddingsApiKey } = await loadEmbeddingsKey(supabase, accountId)
    let report
    try {
      report = await applyAutopilotSetup(
        supabase,
        {
          accountId,
          userId,
          platformAiProvider: platformAiSettings()?.provider ?? null,
          ingest: async (docId, content) => {
            await ingestDocument(supabase, accountId, { embeddingsApiKey }, docId, content)
          },
        },
        setup,
      )
    } catch (err) {
      if (err instanceof AutopilotApplyError) {
        const planErr = planErrorFromDb(err.cause as { message?: string })
        if (planErr) throw planErr
        console.error(`[autopilot POST] ${err.step}:`, err.cause)
        return NextResponse.json({ error: t('autopilot.applyFailed'), step: err.step }, { status: 500 })
      }
      throw err
    }

    await supabase
      .from('business_profiles')
      .update({ applied_at: new Date().toISOString(), applied_by: userId })
      .eq('account_id', accountId)

    return NextResponse.json({ setup, report })
  } catch (err) {
    return toErrorResponse(err)
  }
}
