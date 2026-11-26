import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { getEntitlements } from '@/lib/billing/entitlements'

/**
 * GET /api/billing — the caller's own plan, status, limits and usage,
 * plus the public plans they could move to. Any member may read it.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const [entitlements, plans] = await Promise.all([
      getEntitlements(supabase, accountId),
      supabase
        .from('plans')
        .select(
          'id, name, description, price_inr_monthly, max_members, max_contacts, max_broadcast_messages_monthly, max_ai_replies_monthly, max_voice_minutes_monthly, sort_order',
        )
        .eq('is_public', true)
        .order('sort_order'),
    ])
    return NextResponse.json({ entitlements, plans: plans.data ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}
