import type { SupabaseClient } from '@supabase/supabase-js'
import { assertWritable, type Entitlements } from '@/lib/billing/entitlements'
import { parseAudience, resolveAudience, type AudienceContact } from './audience'
import { EmailError, EmailNotConfiguredError, type EmailSender, type OutboundEmail } from './email.types'
import { assertEmailQuota, getEmailQuota } from './quota'
import { renderEmail } from './render'
import { newUnsubscribeToken, unsubscribeUrl } from './tokens'

export interface EmailSettingsRow {
  from_name: string
  reply_to_email: string
  business_address: string
}

interface CampaignRow {
  id: string
  subject: string
  body_text: string
  audience: unknown
  status: string
}

export interface SendContext {
  accountId: string
  baseUrl: string
  entitlements: Entitlements | null
}

export interface SendReport {
  recipients: number
  sent: number
  failed: number
}

export async function loadSettings(db: SupabaseClient, accountId: string): Promise<EmailSettingsRow> {
  const { data, error } = await db
    .from('email_settings')
    .select('from_name, reply_to_email, business_address')
    .eq('account_id', accountId)
    .maybeSingle()
  if (error) throw error
  if (!data) throw new EmailError('settings_missing', 'Set your sender details first')
  return data as EmailSettingsRow
}

function build(
  campaign: Pick<CampaignRow, 'subject' | 'body_text'>,
  settings: EmailSettingsRow,
  contact: Pick<AudienceContact, 'name' | 'email'>,
  token: string,
  baseUrl: string,
): OutboundEmail {
  const r = renderEmail(
    campaign.subject,
    campaign.body_text,
    { name: contact.name, businessName: settings.from_name },
    {
      businessName: settings.from_name,
      address: settings.business_address,
      unsubscribeUrl: unsubscribeUrl(baseUrl, token),
    },
  )
  return { toEmail: contact.email, toName: contact.name, subject: r.subject, html: r.html, text: r.text }
}

/** One preview/test message; nothing is stored and no quota is used. */
export async function sendTestEmail(
  sender: EmailSender,
  settings: EmailSettingsRow,
  campaign: Pick<CampaignRow, 'subject' | 'body_text'>,
  toEmail: string,
  baseUrl: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!sender.enabled) throw new EmailNotConfiguredError()
  const msg = build(campaign, settings, { name: 'Test Customer', email: toEmail }, 'test-token-not-real', baseUrl)
  const [result] = await sender.sendBatch({ fromName: settings.from_name, replyTo: settings.reply_to_email }, [
    { ...msg, subject: `[Test] ${msg.subject}` },
  ])
  return result?.ok ? { ok: true } : { ok: false, error: result?.error ?? 'Send failed' }
}

/**
 * Send a draft campaign to its audience. Runs on the caller's RLS client.
 * Order matters: quota and audience are checked BEFORE the draft is
 * claimed, so a refusal leaves it a draft. The claim is a conditional
 * update, so a double click cannot send twice.
 */
export async function sendCampaign(
  db: SupabaseClient,
  sender: EmailSender,
  ctx: SendContext,
  campaignId: string,
): Promise<SendReport> {
  if (!sender.enabled) throw new EmailNotConfiguredError()
  assertWritable(ctx.entitlements)

  const { data: c, error: cErr } = await db
    .from('email_campaigns')
    .select('id, subject, body_text, audience, status')
    .eq('id', campaignId)
    .eq('account_id', ctx.accountId)
    .maybeSingle()
  if (cErr) throw cErr
  const campaign = c as CampaignRow | null
  if (!campaign) throw new EmailError('campaign_not_found', 'Campaign not found', 404)
  if (campaign.status !== 'draft') throw new EmailError('already_sent', 'This campaign was already sent', 409)

  const settings = await loadSettings(db, ctx.accountId)
  const quota = await getEmailQuota(db, ctx.accountId, ctx.entitlements)
  const cap = Number.isFinite(quota.remaining) ? quota.remaining + 1 : 50_000
  const contacts = await resolveAudience(db, ctx.accountId, parseAudience(campaign.audience), cap)
  if (contacts.length === 0) throw new EmailError('no_recipients', 'No contacts with an email address match this audience')
  assertEmailQuota(quota, contacts.length)

  const { data: claimed, error: claimErr } = await db
    .from('email_campaigns')
    .update({ status: 'sending', recipient_count: contacts.length })
    .eq('id', campaign.id)
    .eq('status', 'draft')
    .select('id')
  if (claimErr) throw claimErr
  if (!claimed || (claimed as unknown[]).length === 0) {
    throw new EmailError('already_sent', 'This campaign was already sent', 409)
  }

  const rows = contacts.map((contact) => ({
    contact,
    row: {
      account_id: ctx.accountId,
      campaign_id: campaign.id,
      contact_id: contact.id,
      email: contact.email,
      status: 'queued',
      unsubscribe_token: newUnsubscribeToken(),
    },
  }))

  let sent = 0
  let failed = 0
  try {
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await db.from('email_recipients').insert(rows.slice(i, i + 500).map((r) => r.row))
      if (error) throw error
    }

    for (let i = 0; i < rows.length; i += sender.maxBatch) {
      const batch = rows.slice(i, i + sender.maxBatch)
      const messages = batch.map((r) => build(campaign, settings, r.contact, r.row.unsubscribe_token, ctx.baseUrl))
      const results = await sender.sendBatch(
        { fromName: settings.from_name, replyTo: settings.reply_to_email },
        messages,
      )
      await Promise.all(
        batch.map(async (r, idx) => {
          const res = results[idx]
          const ok = res?.ok === true
          if (ok) sent++
          else failed++
          const { error } = await db
            .from('email_recipients')
            .update(
              ok
                ? { status: 'sent', brevo_message_id: res.messageId ?? null }
                : { status: 'failed', error: (res?.error ?? 'Send failed').slice(0, 300) },
            )
            .eq('campaign_id', campaign.id)
            .eq('unsubscribe_token', r.row.unsubscribe_token)
          if (error) console.error('[email] could not record recipient status:', error)
        }),
      )
    }
  } finally {
    // Whatever happened, leave the campaign in a final state with real counts.
    const unsent = rows.length - sent - failed
    failed += unsent
    await db
      .from('email_campaigns')
      .update({
        status: sent > 0 ? 'sent' : 'failed',
        sent_count: sent,
        failed_count: failed,
        sent_at: new Date().toISOString(),
      })
      .eq('id', campaign.id)
  }
  return { recipients: rows.length, sent, failed }
}
