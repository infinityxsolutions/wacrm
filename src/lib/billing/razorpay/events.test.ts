import { describe, expect, it } from 'vitest'
import { reduceRazorpayEvent, readNotes, type CurrentSubscription, type RazorpayEvent } from './events'

const current = (over: Partial<CurrentSubscription> = {}): CurrentSubscription => ({
  plan_id: 'starter',
  status: 'trialing',
  current_period_end: null,
  billing_interval: null,
  razorpay_subscription_id: 'sub_1',
  ...over,
})

const charged = (over: Partial<RazorpayEvent> = {}): RazorpayEvent => ({
  event: 'subscription.charged',
  payload: {
    subscription: {
      entity: { id: 'sub_1', current_end: 1_800_000_000, notes: { account_id: 'A', plan_id: 'growth', interval: 'yearly' } },
    },
    payment: { entity: { id: 'pay_1', amount: 799000, method: 'upi', invoice_id: 'inv_1', status: 'captured', created_at: 1_790_000_000 } },
  },
  ...over,
})

describe('reduceRazorpayEvent', () => {
  it('activates the plan from the notes and records the payment', () => {
    const r = reduceRazorpayEvent(charged(), current())
    expect(r.patch).toMatchObject({
      status: 'active',
      plan_id: 'growth',
      billing_interval: 'yearly',
      razorpay_subscription_id: 'sub_1',
      current_period_end: new Date(1_800_000_000 * 1000).toISOString(),
    })
    expect(r.payment).toMatchObject({ razorpay_payment_id: 'pay_1', amount_paise: 799000, method: 'upi', plan_id: 'growth' })
  })

  it('never moves the paid-through date backwards', () => {
    const later = new Date(1_900_000_000 * 1000).toISOString()
    const r = reduceRazorpayEvent(charged(), current({ current_period_end: later }))
    expect(r.patch?.current_period_end).toBe(later)
  })

  it('does not lift a platform suspension but still records the payment', () => {
    const r = reduceRazorpayEvent(charged(), current({ status: 'suspended' }))
    expect(r.patch).toBeNull()
    expect(r.payment?.razorpay_payment_id).toBe('pay_1')
  })

  it('ignores state changes from a different live subscription', () => {
    const ev = charged()
    ev.payload!.subscription!.entity!.id = 'sub_old'
    const r = reduceRazorpayEvent(ev, current({ status: 'active' }))
    expect(r.patch).toBeNull()
    expect(r.payment).not.toBeNull()
  })

  it('marks failures past_due and endings canceled with the period kept', () => {
    const base = { payload: { subscription: { entity: { id: 'sub_1', current_end: 1_800_000_000 } } } }
    expect(reduceRazorpayEvent({ event: 'subscription.halted', ...base }, current({ status: 'active' })).patch).toEqual({ status: 'past_due' })
    expect(reduceRazorpayEvent({ event: 'subscription.pending', ...base }, current({ status: 'active' })).patch).toEqual({ status: 'past_due' })
    const c = reduceRazorpayEvent({ event: 'subscription.cancelled', ...base }, current({ status: 'active' }))
    expect(c.patch).toMatchObject({ status: 'canceled', cancel_at_period_end: false })
    expect(c.patch?.current_period_end).toBe(new Date(1_800_000_000 * 1000).toISOString())
  })

  it('ignores unrelated events and payloads without a subscription', () => {
    expect(reduceRazorpayEvent({ event: 'subscription.authenticated', payload: { subscription: { entity: { id: 'sub_1' } } } }, current()).patch).toBeNull()
    expect(reduceRazorpayEvent({ event: 'payment.failed', payload: {} }, current())).toEqual({ patch: null, payment: null })
  })

  it('treats empty notes arrays as no notes', () => {
    expect(readNotes([])).toEqual({})
    expect(readNotes({ a: 'x', b: 1 })).toEqual({ a: 'x' })
  })
})
