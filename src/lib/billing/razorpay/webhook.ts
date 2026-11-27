import type { SupabaseClient } from '@supabase/supabase-js'
import { reduceRazorpayEvent, readNotes, type CurrentSubscription, type RazorpayEvent } from './events'

export type WebhookResult =
  | { status: 'processed' }
  | { status: 'duplicate' }
  | { status: 'ignored'; reason: string }

/**
 * Apply one verified Razorpay event. Runs on the service-role client.
 * Throws on database errors so the route answers 500 and Razorpay retries;
 * unknown accounts and irrelevant events are acknowledged (200) so they are
 * not retried forever.
 */
export async function processRazorpayEvent(
  db: SupabaseClient,
  event: RazorpayEvent,
  eventId: string,
): Promise<WebhookResult> {
  const subEntity = event.payload?.subscription?.entity
  if (!subEntity?.id) return { status: 'ignored', reason: 'no subscription' }

  const { data: seen, error: seenErr } = await db
    .from('billing_events')
    .select('event_id, processed_at')
    .eq('event_id', eventId)
    .maybeSingle()
  if (seenErr) throw seenErr
  if (seen?.processed_at) return { status: 'duplicate' }
  if (!seen) {
    const { error } = await db
      .from('billing_events')
      .insert({ event_id: eventId, event_type: event.event })
    // A concurrent delivery inserted it first: fine, we still process (idempotent).
    if (error && error.code !== '23505') throw error
  }

  const columns =
    'account_id, plan_id, status, current_period_end, billing_interval, razorpay_subscription_id'
  const bySub = await db
    .from('account_subscriptions')
    .select(columns)
    .eq('razorpay_subscription_id', subEntity.id)
    .maybeSingle()
  if (bySub.error) throw bySub.error
  let row = bySub.data
  if (!row) {
    const accountId = readNotes(subEntity.notes).account_id
    if (accountId) {
      const res = await db.from('account_subscriptions').select(columns).eq('account_id', accountId).maybeSingle()
      if (res.error) throw res.error
      row = res.data
    }
  }
  if (!row) {
    await markProcessed(db, eventId, null, 'unknown account')
    return { status: 'ignored', reason: 'unknown account' }
  }

  const accountId = (row as { account_id: string }).account_id
  const outcome = reduceRazorpayEvent(event, row as unknown as CurrentSubscription)

  if (outcome.payment) {
    const { error } = await db
      .from('billing_payments')
      .upsert({ account_id: accountId, ...outcome.payment }, { onConflict: 'razorpay_payment_id' })
    if (error) throw error
  }
  if (outcome.patch) {
    const { error } = await db.from('account_subscriptions').update(outcome.patch).eq('account_id', accountId)
    if (error) throw error
  }
  await markProcessed(db, eventId, accountId, null)
  return { status: 'processed' }
}

async function markProcessed(db: SupabaseClient, eventId: string, accountId: string | null, note: string | null) {
  const { error } = await db
    .from('billing_events')
    .update({ processed_at: new Date().toISOString(), account_id: accountId, error: note })
    .eq('event_id', eventId)
  if (error) throw error
}
