import type { SupabaseClient } from '@supabase/supabase-js'
import { EmailError } from './email.types'

export type Audience = { kind: 'all' } | { kind: 'tags'; tag_ids: string[] }

export interface AudienceContact {
  id: string
  name: string | null
  email: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PAGE = 1000

export function parseAudience(raw: unknown): Audience {
  if (!raw || typeof raw !== 'object') return { kind: 'all' }
  const a = raw as { kind?: unknown; tag_ids?: unknown }
  if (a.kind === 'all') return { kind: 'all' }
  if (a.kind === 'tags') {
    const ids = Array.isArray(a.tag_ids) ? a.tag_ids.filter((x): x is string => typeof x === 'string' && UUID.test(x)) : []
    if (ids.length === 0 || ids.length > 50) throw new EmailError('invalid_audience', 'Choose at least one tag')
    return { kind: 'tags', tag_ids: [...new Set(ids)] }
  }
  throw new EmailError('invalid_audience', 'Unknown audience')
}

/**
 * Contacts to email: have a valid address, have not opted out, optionally
 * carry one of the chosen tags. Duplicate addresses are collapsed. Runs on
 * the caller's RLS client, so it can only see its own account. Stops after
 * `cap` contacts (callers pass the quota + 1 to detect overflow).
 */
export async function resolveAudience(
  db: SupabaseClient,
  accountId: string,
  audience: Audience,
  cap: number,
): Promise<AudienceContact[]> {
  let allowedIds: Set<string> | null = null
  if (audience.kind === 'tags') {
    allowedIds = new Set()
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await db
        .from('contact_tags')
        .select('contact_id')
        .in('tag_id', audience.tag_ids)
        .range(from, from + PAGE - 1)
      if (error) throw error
      for (const r of (data ?? []) as { contact_id: string }[]) allowedIds.add(r.contact_id)
      if ((data ?? []).length < PAGE) break
    }
    if (allowedIds.size === 0) return []
  }

  const seen = new Set<string>()
  const out: AudienceContact[] = []
  for (let from = 0; out.length < cap; from += PAGE) {
    const { data, error } = await db
      .from('contacts')
      .select('id, name, email')
      .eq('account_id', accountId)
      .eq('email_opt_out', false)
      .not('email', 'is', null)
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw error
    const rows = (data ?? []) as { id: string; name: string | null; email: string | null }[]
    for (const r of rows) {
      const email = r.email?.trim()
      if (!email || !EMAIL.test(email)) continue
      if (allowedIds && !allowedIds.has(r.id)) continue
      const key = email.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ id: r.id, name: r.name, email })
      if (out.length >= cap) break
    }
    if (rows.length < PAGE) break
  }
  return out
}
