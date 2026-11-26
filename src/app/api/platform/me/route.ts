import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isPlatformAdminEmail } from '@/lib/platform/admin'

/** GET /api/platform/me — whether the signed-in user is a platform admin (drives the Admin link). */
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return NextResponse.json({ isPlatformAdmin: isPlatformAdminEmail(user?.email) })
}
