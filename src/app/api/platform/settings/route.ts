import { NextResponse } from 'next/server'
import { toErrorResponse } from '@/lib/auth/account'
import { auditPlatformAction, parsePlatformSettings, platformDb, requirePlatformAdmin } from '@/lib/platform/admin'

/** GET /api/platform/settings — sign-up mode, trial length, grace period, default plan. */
export async function GET() {
  try {
    await requirePlatformAdmin()
    const { data, error } = await platformDb().from('platform_settings').select('*').maybeSingle()
    if (error) throw error
    return NextResponse.json({ settings: data })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** PATCH /api/platform/settings */
export async function PATCH(request: Request) {
  try {
    const admin = await requirePlatformAdmin()
    const parsed = parsePlatformSettings(await request.json().catch(() => null))
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
    const db = platformDb()
    if (typeof parsed.default_plan_id === 'string') {
      const { data: plan } = await db.from('plans').select('id').eq('id', parsed.default_plan_id).maybeSingle()
      if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 400 })
    }
    const { error } = await db
      .from('platform_settings')
      .update({ ...parsed, updated_at: new Date().toISOString() })
      .eq('id', true)
    if (error) throw error
    await auditPlatformAction(db, { actorEmail: admin.email, action: 'update_settings', details: parsed })
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
