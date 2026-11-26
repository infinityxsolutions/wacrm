import { NextResponse } from 'next/server'
import { toErrorResponse } from '@/lib/auth/account'
import { auditPlatformAction, parsePlanUpdate, platformDb, requirePlatformAdmin } from '@/lib/platform/admin'

/** GET /api/platform/plans — the full plan catalogue (including hidden plans). */
export async function GET() {
  try {
    await requirePlatformAdmin()
    const { data, error } = await platformDb().from('plans').select('*').order('sort_order')
    if (error) throw error
    return NextResponse.json({ plans: data ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** PATCH /api/platform/plans — edit one plan's name, price or limits. */
export async function PATCH(request: Request) {
  try {
    const admin = await requirePlatformAdmin()
    const parsed = parsePlanUpdate(await request.json().catch(() => null))
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
    const db = platformDb()
    const { data, error } = await db.from('plans').update(parsed.patch).eq('id', parsed.id).select('id')
    if (error) throw error
    if (!data || data.length === 0) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
    await auditPlatformAction(db, { actorEmail: admin.email, action: 'update_plan', details: parsed })
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
