import {
  RazorpayApiError,
  type RazorpayClient,
  type RazorpayPlanRequest,
  type RazorpaySubscription,
  type RazorpaySubscriptionRequest,
} from './razorpay.types'

const BASE_URL = 'https://api.razorpay.com/v1'

export class HttpRazorpay implements RazorpayClient {
  readonly enabled = true
  readonly testMode: boolean
  private readonly auth: string

  constructor(
    keyId: string,
    keySecret: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.auth = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`
    this.testMode = keyId.startsWith('rzp_test_')
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await this.fetchImpl(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { Authorization: this.auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = (await res.json().catch(() => ({}))) as {
      error?: { description?: string }
    } & Record<string, unknown>
    if (!res.ok) {
      throw new RazorpayApiError(res.status, data.error?.description ?? `Razorpay error ${res.status}`)
    }
    return data as T
  }

  async createPlan(req: RazorpayPlanRequest): Promise<{ id: string }> {
    const data = await this.post<{ id: string }>('/plans', {
      period: req.interval === 'yearly' ? 'yearly' : 'monthly',
      interval: 1,
      item: {
        name: req.name,
        description: req.description,
        amount: req.amountPaise,
        currency: 'INR',
      },
      notes: req.notes,
    })
    return { id: data.id }
  }

  async createSubscription(req: RazorpaySubscriptionRequest): Promise<RazorpaySubscription> {
    const data = await this.post<{ id: string; status: string; short_url?: string }>('/subscriptions', {
      plan_id: req.razorpayPlanId,
      total_count: req.totalCount,
      customer_notify: 1,
      notes: req.notes,
    })
    if (!data.short_url) throw new RazorpayApiError(502, 'Razorpay did not return a payment link')
    return { id: data.id, status: data.status, shortUrl: data.short_url }
  }

  async cancelSubscription(subscriptionId: string, atCycleEnd: boolean): Promise<{ status: string }> {
    const data = await this.post<{ status: string }>(
      `/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`,
      { cancel_at_cycle_end: atCycleEnd ? 1 : 0 },
    )
    return { status: data.status }
  }
}
