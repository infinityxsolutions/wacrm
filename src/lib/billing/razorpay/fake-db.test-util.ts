import type { SupabaseClient } from '@supabase/supabase-js'

export type Row = Record<string, unknown>

/** Minimal in-memory stand-in for the Supabase builder calls billing code uses. */
export function fakeDb(seed: Record<string, Row[]> = {}, uniqueKeys: Record<string, string> = {}) {
  const tables: Record<string, Row[]> = structuredClone(seed)
  const calls: { table: string; op: string; payload?: unknown }[] = []
  const from = (table: string) => {
    tables[table] ??= []
    const filters: [string, unknown][] = []
    let op: 'select' | 'insert' | 'update' | 'upsert' = 'select'
    let payload: Row = {}
    let onConflict = ''
    const match = (r: Row) => filters.every(([k, v]) => r[k] === v)
    const run = () => {
      const rows = tables[table]!
      calls.push({ table, op, payload })
      const key = uniqueKeys[table]
      if (op === 'insert') {
        if (key && rows.some((r) => r[key] === payload[key])) {
          return { data: null, error: { code: '23505', message: 'duplicate' } }
        }
        rows.push({ ...payload })
        return { data: [payload], error: null }
      }
      if (op === 'upsert') {
        const existing = rows.find((r) => r[onConflict] === payload[onConflict])
        if (existing) Object.assign(existing, payload)
        else rows.push({ ...payload })
        return { data: [payload], error: null }
      }
      if (op === 'update') {
        const hit = rows.filter(match)
        hit.forEach((r) => Object.assign(r, payload))
        return { data: hit, error: null }
      }
      return { data: rows.filter(match), error: null }
    }
    const b = {
      select: () => b,
      insert: (p: Row) => ((op = 'insert'), (payload = p), b),
      upsert: (p: Row, o: { onConflict: string }) => ((op = 'upsert'), (payload = p), (onConflict = o.onConflict), b),
      update: (p: Row) => ((op = 'update'), (payload = p), b),
      eq: (k: string, v: unknown) => (filters.push([k, v]), b),
      maybeSingle: async () => {
        const r = run()
        return { data: (r.data as Row[] | null)?.[0] ?? null, error: r.error }
      },
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
    }
    return b
  }
  return { db: { from } as unknown as SupabaseClient, tables, calls }
}
