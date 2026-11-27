import { describe, expect, it, vi } from 'vitest'
import { fakeDb } from './fake-db.test-util'
import { BillingError, cancelSubscription, startCheckout } from './subscribe'
import type { RazorpayClient } from './razorpay.types'

const fakeRazorpay = (): RazorpayClient & { createPlan: ReturnType<typeof vi.fn>; createSubscription: ReturnType<typeof vi.fn>; cancelSubscription: ReturnType<typeof vi.fn> } =>
  ({
    enabled: true,
    testMode: true,
    createPlan: vi.fn(async () => ({ id: 'plan_new' })),
    createSubscription: vi.fn(async () => ({ id: 'sub_new', status: 'created', shortUrl: 'https://rzp.io/i/x' })),
    cancelSubscription: vi.fn(async () => ({ status: 'cancelled' })),
  }) as never

const seed = (sub: Record<string, unknown> = {}, plan: Record<string, unknown> = {}) => ({
  plans: [{ id: 'growth', name: 'Growth', price_inr_monthly: 1999, price_inr_yearly: null, is_public: true, razorpay_plans: {}, ...plan }],
  account_subscriptions: [{ account_id: 'A', status: 'trialing', is_comped: false, razorpay_subscription_id: null, ...sub }],
})

describe('startCheckout', () => {
  it('creates the Razorpay plan once, stores it, and returns the hosted link', async () => {
    const { db, tables } = fakeDb(seed())
    const rzp = fakeRazorpay()
    const out = await startCheckout(db, rzp, { accountId: 'A', planId: 'growth', interval: 'yearly' })
    expect(out).toEqual({ url: 'https://rzp.io/i/x', subscriptionId: 'sub_new' })
    expect(rzp.createPlan.mock.calls[0]![0]).toMatchObject({ amountPaise: 1999000 })
    expect(rzp.createSubscription.mock.calls[0]![0]).toMatchObject({
      razorpayPlanId: 'plan_new',
      totalCount: 10,
      notes: { account_id: 'A', plan_id: 'growth', interval: 'yearly' },
    })
    expect(tables.plans![0]!.razorpay_plans).toEqual({ yearly: { id: 'plan_new', amount_inr: 19990 } })
    expect(tables.account_subscriptions![0]!.razorpay_subscription_id).toBe('sub_new')
  })

  it('reuses a Razorpay plan while the price is unchanged and makes a new one when it changes', async () => {
    const same = fakeDb(seed({}, { razorpay_plans: { monthly: { id: 'plan_old', amount_inr: 1999 } } }))
    const rzp = fakeRazorpay()
    await startCheckout(same.db, rzp, { accountId: 'A', planId: 'growth', interval: 'monthly' })
    expect(rzp.createPlan).not.toHaveBeenCalled()
    expect(rzp.createSubscription.mock.calls[0]![0].razorpayPlanId).toBe('plan_old')

    const changed = fakeDb(seed({}, { razorpay_plans: { monthly: { id: 'plan_old', amount_inr: 1499 } } }))
    const rzp2 = fakeRazorpay()
    await startCheckout(changed.db, rzp2, { accountId: 'A', planId: 'growth', interval: 'monthly' })
    expect(rzp2.createPlan).toHaveBeenCalledOnce()
  })

  it.each([
    ['comped', { is_comped: true }, {}, 'comped'],
    ['suspended', { status: 'suspended' }, {}, 'suspended'],
    ['already subscribed', { status: 'active', razorpay_subscription_id: 'sub_x' }, {}, 'already_subscribed'],
    ['hidden plan', {}, { is_public: false }, 'plan_not_found'],
    ['free plan', {}, { price_inr_monthly: 0 }, 'free_plan'],
  ])('refuses %s', async (_n, sub, plan, code) => {
    const { db } = fakeDb(seed(sub, plan))
    const rzp = fakeRazorpay()
    await expect(startCheckout(db, rzp, { accountId: 'A', planId: 'growth', interval: 'monthly' })).rejects.toMatchObject({ code })
    expect(rzp.createSubscription).not.toHaveBeenCalled()
  })

  it('allows a canceled account to subscribe again', async () => {
    const { db } = fakeDb(seed({ status: 'canceled', razorpay_subscription_id: 'sub_old' }))
    await expect(startCheckout(db, fakeRazorpay(), { accountId: 'A', planId: 'growth', interval: 'monthly' })).resolves.toBeDefined()
  })
})

describe('cancelSubscription', () => {
  it('cancels at cycle end for an active plan and flags it', async () => {
    const { db, tables } = fakeDb(seed({ status: 'active', razorpay_subscription_id: 'sub_1' }))
    const rzp = fakeRazorpay()
    expect(await cancelSubscription(db, rzp, 'A')).toEqual({ cancelAtPeriodEnd: true })
    expect(rzp.cancelSubscription).toHaveBeenCalledWith('sub_1', true)
    expect(tables.account_subscriptions![0]!.cancel_at_period_end).toBe(true)
  })

  it('cancels a failing plan immediately', async () => {
    const { db } = fakeDb(seed({ status: 'past_due', razorpay_subscription_id: 'sub_1' }))
    const rzp = fakeRazorpay()
    expect(await cancelSubscription(db, rzp, 'A')).toEqual({ cancelAtPeriodEnd: false })
    expect(rzp.cancelSubscription).toHaveBeenCalledWith('sub_1', false)
  })

  it('refuses when there is nothing to cancel', async () => {
    const { db } = fakeDb(seed())
    await expect(cancelSubscription(db, fakeRazorpay(), 'A')).rejects.toBeInstanceOf(BillingError)
  })
})
