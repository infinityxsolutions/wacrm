import { describe, expect, it } from 'vitest'
import { reduceBrevoEvent } from './events'
import { fakeDb } from './fake-db.test-util'
import { processBrevoEvent, unsubscribeByToken } from './webhook'

describe('reduceBrevoEvent', () => {
  it('moves forward only', () => {
    expect(reduceBrevoEvent('delivered', 'sent')).toEqual({ status: 'delivered', optOut: false })
    expect(reduceBrevoEvent('opened', 'delivered')).toEqual({ status: 'opened', optOut: false })
    expect(reduceBrevoEvent('click', 'opened')?.status).toBe('clicked')
    expect(reduceBrevoEvent('delivered', 'clicked')).toBeNull()
    expect(reduceBrevoEvent('opened', 'opened')).toBeNull()
  })

  it('treats bounces, spam and unsubscribes as terminal and opts out where it should', () => {
    expect(reduceBrevoEvent('hard_bounce', 'sent')).toEqual({ status: 'bounced', optOut: true })
    expect(reduceBrevoEvent('blocked', 'sent')).toEqual({ status: 'bounced', optOut: false })
    expect(reduceBrevoEvent('spam', 'opened')).toEqual({ status: 'spam', optOut: true })
    expect(reduceBrevoEvent('unsubscribed', 'delivered')).toEqual({ status: 'unsubscribed', optOut: true })
    expect(reduceBrevoEvent('opened', 'bounced')).toBeNull()
    expect(reduceBrevoEvent('hard_bounce', 'spam')).toBeNull()
    expect(reduceBrevoEvent('spam', 'bounced')?.status).toBe('spam')
  })

  it('ignores transient and unknown events', () => {
    for (const e of ['request', 'deferred', 'soft_bounce', 'whatever', undefined]) expect(reduceBrevoEvent(e, 'sent')).toBeNull()
  })
})

const seed = () => ({
  email_recipients: [
    { id: 'r1', account_id: 'A', contact_id: 'c1', email: 'a@x.in', status: 'sent', brevo_message_id: '<m1>', unsubscribe_token: 'tok1tok1tok1tok1tok1' },
  ],
  contacts: [
    { id: 'c1', account_id: 'A', email: 'a@x.in', email_opt_out: false },
    { id: 'c2', account_id: 'A', email: 'A@X.in', email_opt_out: false },
    { id: 'c3', account_id: 'B', email: 'a@x.in', email_opt_out: false },
  ],
})

describe('processBrevoEvent', () => {
  it('updates the status and opts the contact out on a spam report, only in its own account', async () => {
    const { db, tables } = fakeDb(seed())
    expect(await processBrevoEvent(db, { event: 'spam', 'message-id': '<m1>' })).toBe('updated')
    expect(tables.email_recipients![0]!.status).toBe('spam')
    expect(tables.contacts!.map((c) => c.email_opt_out)).toEqual([true, true, false])
  })

  it('ignores unknown messages and events without an id', async () => {
    const { db } = fakeDb(seed())
    expect(await processBrevoEvent(db, { event: 'delivered', 'message-id': '<nope>' })).toBe('ignored')
    expect(await processBrevoEvent(db, { event: 'delivered' })).toBe('ignored')
  })

  it('throws on database errors so Brevo retries', async () => {
    const { db } = fakeDb(seed(), 'email_recipients.select')
    await expect(processBrevoEvent(db, { event: 'delivered', 'message-id': '<m1>' })).rejects.toBeDefined()
  })
})

describe('unsubscribeByToken', () => {
  it('unsubscribes and opts out, and is safe to repeat', async () => {
    const { db, tables } = fakeDb(seed())
    expect(await unsubscribeByToken(db, 'tok1tok1tok1tok1tok1')).toBe(true)
    expect(await unsubscribeByToken(db, 'tok1tok1tok1tok1tok1')).toBe(true)
    expect(tables.email_recipients![0]!.status).toBe('unsubscribed')
    expect(tables.contacts![0]!.email_opt_out).toBe(true)
    expect(tables.contacts![2]!.email_opt_out).toBe(false)
  })
  it('returns false for an unknown token', async () => {
    expect(await unsubscribeByToken(fakeDb(seed()).db, 'nope-nope-nope-nope')).toBe(false)
  })
})
