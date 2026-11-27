export type BillingInterval = 'monthly' | 'yearly'

export interface RazorpayPlanRequest {
  interval: BillingInterval
  name: string
  description: string
  /** Amount in paise. */
  amountPaise: number
  notes: Record<string, string>
}

export interface RazorpaySubscriptionRequest {
  razorpayPlanId: string
  /** Number of billing cycles before Razorpay stops charging. */
  totalCount: number
  notes: Record<string, string>
}

export interface RazorpaySubscription {
  id: string
  status: string
  /** Hosted checkout page the customer pays on. */
  shortUrl: string
}

/** The slice of Razorpay's API that GrowthXAi uses. */
export interface RazorpayClient {
  /** True when real keys are configured (false for the no-op fallback). */
  readonly enabled: boolean
  /** True for rzp_test_ keys: no real money moves. */
  readonly testMode: boolean
  createPlan(req: RazorpayPlanRequest): Promise<{ id: string }>
  createSubscription(req: RazorpaySubscriptionRequest): Promise<RazorpaySubscription>
  cancelSubscription(subscriptionId: string, atCycleEnd: boolean): Promise<{ status: string }>
}

export class BillingNotConfiguredError extends Error {
  constructor() {
    super('Online payments are not configured')
    this.name = 'BillingNotConfiguredError'
  }
}

export class RazorpayApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'RazorpayApiError'
  }
}
