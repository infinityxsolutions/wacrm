import type { SupabaseClient } from '@supabase/supabase-js'
import { reduceBrevoEvent, type BrevoEvent, type RecipientStatus } from './events'

export type BrevoWebhookResult = 'updated' | 'ignored'

/** Apply one Brevo event. Service-role client. Throws on database errors so Brevo retries. */
export async function processBrevoEvent(db: SupabaseClient, event: BrevoEvent): Promise<BrevoWebhookResult> {
  const messageId = event['message-id']
  if (!messageId || typeof messageId !== 'string') return 'ignored'

  const { data, error } = await db
    .from('email_recipients')
    .select('id, status, contact_id, account_id, email')
    .eq('brevo_message_id', messageId)
    .maybeSingle()
  if (error) throw error
  const row = data as {
    id: string
    status: RecipientStatus
    contact_id: string | null
    account_id: string
    email: string
  } | null
  if (!row) return 'ignored'

  const change = reduceBrevoEvent(event.event, row.status)
  if (!change) return 'ignored'

  if (change.status !== row.status) {
    const { error: upErr } = await db.from('email_recipients').update({ status: change.status }).eq('id', row.id)
    if (upErr) throw upErr
  }
  if (change.optOut) await optOutContacts(db, row.account_id, row.contact_id, row.email)
  return 'updated'
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`)

/** Stop emailing this address in this account (the linked contact, and any duplicate with the same address). */
export async function optOutContacts(
  db: SupabaseClient,
  accountId: string,
  contactId: string | null,
  email: string,
): Promise<void> {
  const patch = { email_opt_out: true, email_opt_out_at: new Date().toISOString() }
  if (contactId) {
    const { error } = await db.from('contacts').update(patch).eq('id', contactId).eq('account_id', accountId)
    if (error) throw error
  }
  const { error } = await db
    .from('contacts')
    .update(patch)
    .eq('account_id', accountId)
    .ilike('email', escapeLike(email))
  if (error) throw error
}

/**
 * Unsubscribe by the token in an email link. Returns false for an unknown
 * token. Safe to repeat.
 */
export async function unsubscribeByToken(db: SupabaseClient, token: string): Promise<boolean> {
  const { data, error } = await db
    .from('email_recipients')
    .select('id, status, contact_id, account_id, email')
    .eq('unsubscribe_token', token)
    .maybeSingle()
  if (error) throw error
  const row = data as { id: string; status: string; contact_id: string | null; account_id: string; email: string } | null
  if (!row) return false
  if (row.status !== 'unsubscribed') {
    const { error: upErr } = await db.from('email_recipients').update({ status: 'unsubscribed' }).eq('id', row.id)
    if (upErr) throw upErr
  }
  await optOutContacts(db, row.account_id, row.contact_id, row.email)
  return true
}
