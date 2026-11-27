import type { SupabaseClient } from '@supabase/supabase-js'

export type Row = Record<string, unknown>

/** In-memory stand-in for the Supabase query-builder calls the email code uses. */
export function fakeDb(seed: Record<string, Row[]> = {}, failOn?: string) {
  const tables: Record<string, Row[]> = structuredClone(seed)
  let n = 0
  const from = (table: string) => {
    tables[table] ??= []
    const preds: ((r: Row) => boolean)[] = []
    let op: 'select' | 'insert' | 'update' = 'select'
    let payload: Row | Row[] = {}
    let range: [number, number] | null = null
    let head = false
    let wantCount = false
    const run = () => {
      if (failOn === `${table}.${op}`) return { data: null, error: { message: 'boom' }, count: null }
      const rows = tables[table]!
      if (op === 'insert') {
        const list = (Array.isArray(payload) ? payload : [payload]).map((r) => ({ id: `id${++n}`, ...r }))
        rows.push(...list)
        return { data: list, error: null, count: null }
      }
      const hit = rows.filter((r) => preds.every((p) => p(r)))
      if (op === 'update') {
        hit.forEach((r) => Object.assign(r, payload))
        return { data: hit, error: null, count: null }
      }
      const page = range ? hit.slice(range[0], range[1] + 1) : hit
      return { data: head ? null : page, error: null, count: wantCount ? hit.length : null }
    }
    const b = {
      select: (_cols?: string, opts?: { count?: string; head?: boolean }) => {
        head = opts?.head === true
        wantCount = opts?.count !== undefined
        return b
      },
      insert: (p: Row | Row[]) => ((op = 'insert'), (payload = p), b),
      update: (p: Row) => ((op = 'update'), (payload = p), b),
      eq: (k: string, v: unknown) => (preds.push((r) => r[k] === v), b),
      in: (k: string, vs: unknown[]) => (preds.push((r) => vs.includes(r[k])), b),
      gte: (k: string, v: string) => (preds.push((r) => String(r[k]) >= v), b),
      ilike: (k: string, v: string) => (preds.push((r) => String(r[k] ?? '').toLowerCase() === v.replace(/\\(.)/g, '$1').toLowerCase()), b),
      not: (k: string, o: string, v: unknown) => {
        if (o === 'is') preds.push((r) => r[k] !== v)
        else if (o === 'in') {
          const set = String(v).replace(/[()]/g, '').split(',')
          preds.push((r) => !set.includes(String(r[k])))
        }
        return b
      },
      order: () => b,
      range: (a: number, z: number) => ((range = [a, z]), b),
      maybeSingle: async () => {
        const r = run()
        return { data: (r.data as Row[] | null)?.[0] ?? null, error: r.error }
      },
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
    }
    return b
  }
  return { db: { from } as unknown as SupabaseClient, tables }
}
