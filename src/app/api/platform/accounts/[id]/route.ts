import { NextResponse } from 'next/server'
import { toErrorResponse } from '@/lib/auth/account'
import {
  auditPlatformAction,
  parseAccountAction,
  platformDb,
  requirePlatformAdmin,
  subscriptionPatch,
} from '@/lib/platform/admin'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * POST /api/platform/accounts/:id — change one business's subscription:
 * extend trial, change plan, suspend, reactivate, comp. Platform admins
 * only; every change is audit-logged.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requirePlatformAdmin()
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'Invalid account id' }, { status: 400 })

    const parsed = parseAccountAction(await request.json().catch(() => null))
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })

    const db = platformDb()
    if (parsed.action === 'set_plan') {
      const { data: plan } = await db.from('plans').select('id').eq('id', parsed.planId).maybeSingle()
      if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 400 })
    }

    const { data: current, error: curErr } = await db
      .from('account_subscriptions')
      .select('account_id, status, trial_ends_at')
      .eq('account_id', id)
      .maybeSingle()
    if (curErr) throw curErr

    const patch = subscriptionPatch(parsed, current ?? { trial_ends_at: null, status: 'trialing' })
    const { error: saveErr } = current
      ? await db.from('account_subscriptions').update(patch).eq('account_id', id)
      : await db.from('account_subscriptions').insert({ account_id: id, plan_id: 'starter', ...patch })
    if (saveErr) {
      console.error('[platform/accounts/:id] save failed:', saveErr)
      return NextResponse.json({ error: 'Could not update the subscription' }, { status: 500 })
    }

    await auditPlatformAction(db, {
      actorEmail: admin.email,
      action: parsed.action,
      accountId: id,
      details: { ...parsed, before: current ?? null },
    })
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
