import { describe, expect, it, vi } from 'vitest'
import type { Entitlements } from '@/lib/billing/entitlements'
import { createEmailSender, EmailNotConfiguredError, type EmailSender } from './index'
import { parseAudience } from './audience'
import { fakeDb } from './fake-db.test-util'
import { getEmailQuota } from './quota'
import { sendCampaign, sendTestEmail } from './send'

const ent = (over: Partial<Entitlements> = {}): Entitlements =>
  ({ account_id: 'A', plan: { id: 'starter', name: 'Starter', price_inr_monthly: 799 }, status: 'active', is_comped: false, writable: true, ...over }) as Entitlements

const settings = { account_id: 'A', from_name: 'Shine', reply_to_email: 'hi@shine.in', business_address: 'Road 12, Hyderabad' }

const seed = (opts: { contacts?: Record<string, unknown>[]; limit?: number; used?: number } = {}) => ({
  email_settings: [settings],
  plans: [{ id: 'starter', max_emails_monthly: opts.limit ?? 100 }],
  email_campaigns: [
    { id: 'camp1', account_id: 'A', subject: 'Hi {{first_name}}', body_text: 'Offer for {{name}}', audience: { kind: 'all' }, status: 'draft' },
  ],
  email_recipients: Array.from({ length: opts.used ?? 0 }, (_, i) => ({
    id: `old${i}`, account_id: 'A', status: 'sent', created_at: new Date().toISOString(),
  })),
  contacts: opts.contacts ?? [
    { id: 'c1', account_id: 'A', name: 'Rahul Verma', email: 'rahul@x.in', email_opt_out: false },
    { id: 'c2', account_id: 'A', name: 'Asha', email: 'asha@x.in', email_opt_out: false },
    { id: 'c3', account_id: 'A', name: 'Opted out', email: 'no@x.in', email_opt_out: true },
    { id: 'c4', account_id: 'A', name: 'No email', email: null, email_opt_out: false },
    { id: 'c5', account_id: 'A', name: 'Dup', email: 'RAHUL@x.in', email_opt_out: false },
    { id: 'c6', account_id: 'A', name: 'Bad', email: 'not-an-email', email_opt_out: false },
    { id: 'c7', account_id: 'B', name: 'Other tenant', email: 'other@y.in', email_opt_out: false },
  ],
})

const fakeSender = (fail: (i: number) => boolean = () => false): EmailSender & { calls: number } => {
  let calls = 0
  let counter = 0
  return {
    enabled: true,
    maxBatch: 2,
    get calls() {
      return calls
    },
    sendBatch: vi.fn(async (_id, msgs) => {
      calls++
      return msgs.map(() => {
        const i = counter++
        return fail(i) ? { ok: false, error: 'rejected' } : { ok: true, messageId: `<m${i}>` }
      })
    }),
  } as never
}

const ctx = { accountId: 'A', baseUrl: 'https://app.example', entitlements: ent() }

describe('sendCampaign', () => {
  it('sends to eligible contacts only, personalised, with a unique unsubscribe link each', async () => {
    const { db, tables } = fakeDb(seed())
    const sender = fakeSender()
    const r = await sendCampaign(db, sender, ctx, 'camp1')
    expect(r).toEqual({ recipients: 2, sent: 2, failed: 0 })
    expect(sender.calls).toBe(1)
    const msgs = (sender.sendBatch as ReturnType<typeof vi.fn>).mock.calls[0]![1] as { toEmail: string; subject: string; html: string }[]
    expect(msgs.map((m) => m.toEmail)).toEqual(['rahul@x.in', 'asha@x.in'])
    expect(msgs[0]!.subject).toBe('Hi Rahul')
    const links = msgs.map((m) => m.html.match(/unsubscribe\?t=([A-Za-z0-9_-]+)/)![1])
    expect(new Set(links).size).toBe(2)
    expect(tables.email_recipients!.map((x) => x.status)).toEqual(['sent', 'sent'])
    expect(tables.email_recipients![0]!.brevo_message_id).toBe('<m0>')
    expect(tables.email_campaigns![0]).toMatchObject({ status: 'sent', sent_count: 2, failed_count: 0, recipient_count: 2 })
  })

  it('records per-recipient failures and still reports the campaign as sent when some got through', async () => {
    const { db, tables } = fakeDb(seed())
    const r = await sendCampaign(db, fakeSender((i) => i === 1), ctx, 'camp1')
    expect(r).toEqual({ recipients: 2, sent: 1, failed: 1 })
    expect(tables.email_recipients!.map((x) => x.status).sort()).toEqual(['failed', 'sent'])
    expect(tables.email_campaigns![0]!.status).toBe('sent')
  })

  it('marks the campaign failed when nothing was sent', async () => {
    const { db, tables } = fakeDb(seed())
    await sendCampaign(db, fakeSender(() => true), ctx, 'camp1')
    expect(tables.email_campaigns![0]).toMatchObject({ status: 'failed', sent_count: 0, failed_count: 2 })
  })

  it('refuses a send that would exceed the monthly allowance and leaves the draft untouched', async () => {
    const { db, tables } = fakeDb(seed({ limit: 100, used: 99 }))
    const sender = fakeSender()
    await expect(sendCampaign(db, sender, ctx, 'camp1')).rejects.toMatchObject({ code: 'email_limit', status: 402 })
    expect(sender.calls).toBe(0)
    expect(tables.email_campaigns![0]!.status).toBe('draft')
  })

  it('lets complimentary accounts send regardless of the plan allowance', async () => {
    const { db } = fakeDb(seed({ limit: 0 }))
    const r = await sendCampaign(db, fakeSender(), { ...ctx, entitlements: ent({ is_comped: true }) }, 'camp1')
    expect(r.sent).toBe(2)
  })

  it('refuses read-only accounts, already-sent campaigns, missing settings and empty audiences', async () => {
    const sender = fakeSender()
    await expect(sendCampaign(fakeDb(seed()).db, sender, { ...ctx, entitlements: ent({ writable: false }) }, 'camp1')).rejects.toMatchObject({ code: 'read_only' })

    const sent = seed()
    sent.email_campaigns[0]!.status = 'sent'
    await expect(sendCampaign(fakeDb(sent).db, sender, ctx, 'camp1')).rejects.toMatchObject({ code: 'already_sent' })

    const noSettings = seed()
    noSettings.email_settings = []
    await expect(sendCampaign(fakeDb(noSettings).db, sender, ctx, 'camp1')).rejects.toMatchObject({ code: 'settings_missing' })

    await expect(sendCampaign(fakeDb(seed({ contacts: [] })).db, sender, ctx, 'camp1')).rejects.toMatchObject({ code: 'no_recipients' })
    await expect(sendCampaign(fakeDb(seed()).db, sender, ctx, 'missing')).rejects.toMatchObject({ code: 'campaign_not_found', status: 404 })
    expect(sender.calls).toBe(0)
  })

  it('refuses when email is not configured', async () => {
    await expect(sendCampaign(fakeDb(seed()).db, createEmailSender({}), ctx, 'camp1')).rejects.toBeInstanceOf(EmailNotConfiguredError)
  })

  it('sends only to contacts with the chosen tag', async () => {
    const s = seed()
    ;(s.email_campaigns[0] as Record<string, unknown>).audience = { kind: 'tags', tag_ids: ['11111111-1111-1111-1111-111111111111'] }
    ;(s as Record<string, unknown[]>).contact_tags = [{ contact_id: 'c2', tag_id: '11111111-1111-1111-1111-111111111111' }]
    const r = await sendCampaign(fakeDb(s).db, fakeSender(), ctx, 'camp1')
    expect(r.recipients).toBe(1)
  })
})

describe('sendTestEmail', () => {
  it('sends one labelled test and stores nothing', async () => {
    const sender = fakeSender()
    const r = await sendTestEmail(sender, settings, { subject: 'Hello {{name}}', body_text: 'Body' }, 'me@x.in', 'https://app.example')
    expect(r).toEqual({ ok: true })
    const msg = (sender.sendBatch as ReturnType<typeof vi.fn>).mock.calls[0]![1][0]
    expect(msg.subject).toBe('[Test] Hello Test Customer')
    expect(msg.toEmail).toBe('me@x.in')
  })
})

describe('getEmailQuota', () => {
  it('counts this month, ignoring failed and queued', async () => {
    const s = seed({ limit: 10, used: 3 })
    s.email_recipients.push({ id: 'f', account_id: 'A', status: 'failed', created_at: new Date().toISOString() })
    s.email_recipients.push({ id: 'old', account_id: 'A', status: 'sent', created_at: '2020-01-01T00:00:00.000Z' })
    const q = await getEmailQuota(fakeDb(s).db, 'A', ent())
    expect(q).toEqual({ limit: 10, used: 3, remaining: 7 })
  })
})

describe('parseAudience', () => {
  it('defaults to everyone and validates tag audiences', () => {
    expect(parseAudience(undefined)).toEqual({ kind: 'all' })
    expect(() => parseAudience({ kind: 'tags', tag_ids: ['nope'] })).toThrow()
    expect(() => parseAudience({ kind: 'weird' })).toThrow()
  })
})
