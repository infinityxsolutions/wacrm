import { NextResponse } from 'next/server'
import { toErrorResponse } from '@/lib/auth/account'
import {
  auditPlatformAction,
  normaliseAllowlistEmail,
  platformDb,
  requirePlatformAdmin,
} from '@/lib/platform/admin'

/** GET /api/platform/allowlist — emails pre-approved to sign up in invite-only mode. */
export async function GET() {
  try {
    await requirePlatformAdmin()
    const { data, error } = await platformDb()
      .from('platform_signup_allowlist')
      .select('email, note, created_at')
      .order('created_at', { ascending: false })
    if (error) throw error
    return NextResponse.json({ emails: data ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** POST /api/platform/allowlist { email, note? } */
export async function POST(request: Request) {
  try {
    const admin = await requirePlatformAdmin()
    const body = (await request.json().catch(() => null)) as { email?: unknown; note?: unknown } | null
    const email = normaliseAllowlistEmail(body?.email)
    if (!email) return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 })
    const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 200) || null : null
    const db = platformDb()
    const { error } = await db.from('platform_signup_allowlist').upsert({ email, note })
    if (error) throw error
    await auditPlatformAction(db, { actorEmail: admin.email, action: 'allowlist_add', details: { email } })
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** DELETE /api/platform/allowlist?email= */
export async function DELETE(request: Request) {
  try {
    const admin = await requirePlatformAdmin()
    const email = normaliseAllowlistEmail(new URL(request.url).searchParams.get('email'))
    if (!email) return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 })
    const db = platformDb()
    const { error } = await db.from('platform_signup_allowlist').delete().eq('email', email)
    if (error) throw error
    await auditPlatformAction(db, { actorEmail: admin.email, action: 'allowlist_remove', details: { email } })
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
