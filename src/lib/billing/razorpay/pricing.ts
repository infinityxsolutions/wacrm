import type { BillingInterval } from './razorpay.types'

export interface PricedPlan {
  price_inr_monthly: number
  price_inr_yearly: number | null
}

/** Rupees charged per billing interval. Yearly defaults to 10 x monthly (two months free). */
export function planPriceInr(plan: PricedPlan, interval: BillingInterval): number {
  if (interval === 'monthly') return plan.price_inr_monthly
  return plan.price_inr_yearly ?? plan.price_inr_monthly * 10
}

export const toPaise = (rupees: number): number => Math.round(rupees * 100)

/** Billing cycles to authorise: about ten years either way. */
export function totalCount(interval: BillingInterval): number {
  return interval === 'yearly' ? 10 : 120
}

export function isInterval(v: unknown): v is BillingInterval {
  return v === 'monthly' || v === 'yearly'
}
