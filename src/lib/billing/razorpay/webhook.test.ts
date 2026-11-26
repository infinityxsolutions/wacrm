import { describe, expect, it } from 'vitest'
import { fakeDb } from './fake-db.test-util'
import { processRazorpayEvent } from './webhook'
import type { RazorpayEvent } from './events'

const event = (id = 'sub_1', notes: Record<string, string> = { account_id: 'A', plan_id: 'growth', interval: 'monthly' }): RazorpayEvent => ({
  event: 'subscription.charged',
  payload: {
    subscription: { entity: { id, current_end: 1_800_000_000, notes } },
    payment: { entity: { id: 'pay_1', amount: 199900, created_at: 1_790_000_000 } },
  },
})

const seed = () => ({
  account_subscriptions: [
    { account_id: 'A', plan_id: 'starter', status: 'trialing', current_period_end: null, billing_interval: null, razorpay_subscription_id: 'sub_1' },
    { account_id: 'B', plan_id: 'starter', status: 'trialing', current_period_end: null, billing_interval: null, razorpay_subscription_id: null },
  ],
})

describe('processRazorpayEvent', () => {
  it('activates the right account, stores the payment and marks the event processed', async () => {
    const { db, tables } = fakeDb(seed(), { billing_events: 'event_id' })
    const r = await processRazorpayEvent(db, event(), 'evt_1')
    expect(r.status).toBe('processed')
    expect(tables.account_subscriptions![0]).toMatchObject({ status: 'active', plan_id: 'growth', billing_interval: 'monthly' })
    expect(tables.account_subscriptions![1]).toMatchObject({ status: 'trialing', plan_id: 'starter' })
    expect(tables.billing_payments).toHaveLength(1)
    expect(tables.billing_events![0]).toMatchObject({ event_id: 'evt_1', account_id: 'A' })
    expect(tables.billing_events![0]!.processed_at).toBeTruthy()
  })

  it('skips an event it has already processed', async () => {
    const { db, tables } = fakeDb(seed(), { billing_events: 'event_id' })
    await processRazorpayEvent(db, event(), 'evt_1')
    tables.account_subscriptions![0]!.status = 'past_due'
    const again = await processRazorpayEvent(db, event(), 'evt_1')
    expect(again.status).toBe('duplicate')
    expect(tables.account_subscriptions![0]!.status).toBe('past_due')
  })

  it('finds the account from the notes when the subscription id was not stored yet', async () => {
    const s = seed()
    s.account_subscriptions[0]!.razorpay_subscription_id = null
    const { db, tables } = fakeDb(s, { billing_events: 'event_id' })
    const r = await processRazorpayEvent(db, event('sub_new'), 'evt_2')
    expect(r.status).toBe('processed')
    expect(tables.account_subscriptions![0]).toMatchObject({ status: 'active', razorpay_subscription_id: 'sub_new' })
  })

  it('acknowledges events for unknown accounts without changing anything', async () => {
    const { db, tables } = fakeDb(seed(), { billing_events: 'event_id' })
    const r = await processRazorpayEvent(db, event('sub_zzz', { account_id: 'NOPE' }), 'evt_3')
    expect(r).toEqual({ status: 'ignored', reason: 'unknown account' })
    expect(tables.billing_payments ?? []).toHaveLength(0)
  })

  it('ignores events with no subscription', async () => {
    const { db } = fakeDb(seed(), { billing_events: 'event_id' })
    expect((await processRazorpayEvent(db, { event: 'payment.failed' }, 'evt_4')).status).toBe('ignored')
  })
})
