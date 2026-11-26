import { NextResponse } from 'next/server'
import { toErrorResponse } from '@/lib/auth/account'
import { platformDb, requirePlatformAdmin } from '@/lib/platform/admin'
import type { Entitlements } from '@/lib/billing/entitlements'

const MAX_ACCOUNTS = 500

/**
 * GET /api/platform/accounts — every business on the platform with its
 * plan, status, owner and this month's usage. Platform admins only.
 */
export async function GET() {
  try {
    await requirePlatformAdmin()
    const db = platformDb()

    const { data: accounts, error } = await db
      .from('accounts')
      .select('id, name, owner_user_id, created_at')
      .order('created_at', { ascending: false })
      .limit(MAX_ACCOUNTS)
    if (error) throw error

    const ownerIds = (accounts ?? []).map((a) => a.owner_user_id)
    const { data: owners } = ownerIds.length
      ? await db.from('profiles').select('user_id, email, full_name').in('user_id', ownerIds)
      : { data: [] }
    const ownerById = new Map((owners ?? []).map((o) => [o.user_id, o]))

    const rows = await Promise.all(
      (accounts ?? []).map(async (a) => {
        const { data: ent, error: entErr } = await db.rpc('get_account_entitlements', {
          target_account_id: a.id,
        })
        if (entErr) console.error('[platform/accounts] entitlements failed for', a.id, entErr)
        const owner = ownerById.get(a.owner_user_id)
        return {
          id: a.id,
          name: a.name,
          created_at: a.created_at,
          owner_email: owner?.email ?? null,
          owner_name: owner?.full_name ?? null,
          entitlements: (ent as Entitlements | null) ?? null,
        }
      }),
    )
    return NextResponse.json({ accounts: rows, truncated: (accounts ?? []).length === MAX_ACCOUNTS })
  } catch (err) {
    return toErrorResponse(err)
  }
}
