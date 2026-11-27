import crypto from 'crypto'
import { describe, expect, it, vi } from 'vitest'
import { createRazorpay, verifyWebhookSignature, BillingNotConfiguredError, RazorpayApiError } from './index'
import { planPriceInr, toPaise, totalCount } from './pricing'

describe('createRazorpay', () => {
  it('returns a no-op that fails clearly without keys', async () => {
    const r = createRazorpay({})
    expect(r.enabled).toBe(false)
    await expect(r.createSubscription({ razorpayPlanId: "p", totalCount: 1, notes: {} })).rejects.toBeInstanceOf(BillingNotConfiguredError)
    await expect(createRazorpay({ RAZORPAY_KEY_ID: "x" }).createPlan({ interval: "monthly", name: "n", description: "d", amountPaise: 1, notes: {} })).rejects.toBeInstanceOf(BillingNotConfiguredError)
  })

  it('detects test mode and sends basic auth to the plans endpoint', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'plan_1' }), { status: 200 }))
    const r = createRazorpay({ RAZORPAY_KEY_ID: 'rzp_test_abc', RAZORPAY_KEY_SECRET: 'sec' }, { fetch: fetchMock as never })
    expect(r.enabled).toBe(true)
    expect(r.testMode).toBe(true)
    const out = await r.createPlan({ interval: 'yearly', name: 'Pro', description: 'd', amountPaise: 399900, notes: {} })
    expect(out.id).toBe('plan_1')
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.razorpay.com/v1/plans')
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from('rzp_test_abc:sec').toString('base64')}`,
    )
    const body = JSON.parse(init.body as string)
    expect(body.period).toBe('yearly')
    expect(body.item.amount).toBe(399900)
  })

  it('maps API errors and requires a payment link', async () => {
    const bad = vi.fn(async () => new Response(JSON.stringify({ error: { description: 'Bad plan' } }), { status: 400 }))
    const r = createRazorpay({ RAZORPAY_KEY_ID: 'rzp_live_a', RAZORPAY_KEY_SECRET: 's' }, { fetch: bad as never })
    expect(r.testMode).toBe(false)
    await expect(r.createSubscription({ razorpayPlanId: 'p', totalCount: 1, notes: {} })).rejects.toMatchObject({
      status: 400,
      message: 'Bad plan',
    })
    const noLink = vi.fn(async () => new Response(JSON.stringify({ id: 'sub_1', status: 'created' }), { status: 200 }))
    const r2 = createRazorpay({ RAZORPAY_KEY_ID: 'k', RAZORPAY_KEY_SECRET: 's' }, { fetch: noLink as never })
    await expect(r2.createSubscription({ razorpayPlanId: 'p', totalCount: 1, notes: {} })).rejects.toBeInstanceOf(RazorpayApiError)
  })

  it('cancels at cycle end or immediately', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: 'cancelled' }), { status: 200 }))
    const r = createRazorpay({ RAZORPAY_KEY_ID: 'k', RAZORPAY_KEY_SECRET: 's' }, { fetch: fetchMock as never })
    await r.cancelSubscription('sub_1', true)
    await r.cancelSubscription('sub_1', false)
    const bodies = fetchMock.mock.calls.map((c) => JSON.parse((c as unknown as [string, RequestInit])[1].body as string))
    expect(bodies).toEqual([{ cancel_at_cycle_end: 1 }, { cancel_at_cycle_end: 0 }])
  })
})

describe('verifyWebhookSignature', () => {
  const secret = 'whsec'
  const body = '{"event":"subscription.charged"}'
  const sig = crypto.createHmac('sha256', secret).update(body).digest('hex')
  it('accepts the right signature', () => expect(verifyWebhookSignature(body, sig, secret)).toBe(true))
  it('rejects tampering, missing values and a wrong length', () => {
    expect(verifyWebhookSignature(body + ' ', sig, secret)).toBe(false)
    expect(verifyWebhookSignature(body, sig, 'other')).toBe(false)
    expect(verifyWebhookSignature(body, null, secret)).toBe(false)
    expect(verifyWebhookSignature(body, sig, undefined)).toBe(false)
    expect(verifyWebhookSignature(body, 'abc', secret)).toBe(false)
  })
})

describe('pricing', () => {
  it('defaults yearly to ten months and honours an explicit yearly price', () => {
    expect(planPriceInr({ price_inr_monthly: 799, price_inr_yearly: null }, 'yearly')).toBe(7990)
    expect(planPriceInr({ price_inr_monthly: 799, price_inr_yearly: 7500 }, 'yearly')).toBe(7500)
    expect(planPriceInr({ price_inr_monthly: 799, price_inr_yearly: 7500 }, 'monthly')).toBe(799)
    expect(toPaise(799)).toBe(79900)
    expect(totalCount('monthly')).toBe(120)
    expect(totalCount('yearly')).toBe(10)
  })
})
