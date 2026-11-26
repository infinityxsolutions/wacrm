// ============================================================
// Razorpay webhook event -> subscription state.
//
// Pure: takes the event and the account's current subscription row and
// returns what to write. Handlers are idempotent (absolute state, and the
// paid-through date only ever moves forward), so a duplicate or
// out-of-order delivery cannot roll an account back.
//
// A platform-suspended account stays suspended: a payment never lifts an
// admin's suspension (the payment is still recorded).
// ============================================================

import type { BillingInterval } from './razorpay.types'
import { isInterval } from './pricing'

interface RzpSubscriptionEntity {
  id: string
  status?: string
  /** Unix seconds: end of the current paid cycle. */
  current_end?: number | null
  ended_at?: number | null
  notes?: Record<string, unknown> | unknown[] | null
}

interface RzpPaymentEntity {
  id: string
  /** Paise. */
  amount: number
  currency?: string
  status?: string
  method?: string | null
  invoice_id?: string | null
  created_at?: number
}

export interface RazorpayEvent {
  event: string
  payload?: {
    subscription?: { entity?: RzpSubscriptionEntity }
    payment?: { entity?: RzpPaymentEntity }
  }
}

export interface CurrentSubscription {
  plan_id: string
  status: string
  current_period_end: string | null
  billing_interval: BillingInterval | null
  razorpay_subscription_id: string | null
}

export interface PaymentRecord {
  razorpay_payment_id: string
  razorpay_subscription_id: string
  razorpay_invoice_id: string | null
  plan_id: string | null
  billing_interval: BillingInterval | null
  amount_paise: number
  currency: string
  status: string
  method: string | null
  paid_at: string
}

export interface EventOutcome {
  /** Columns to update on account_subscriptions, or null for "nothing". */
  patch: Record<string, unknown> | null
  payment: PaymentRecord | null
}

const NOTHING: EventOutcome = { patch: null, payment: null }

/** Razorpay sends `notes: []` when empty, so normalise to a record. */
export function readNotes(notes: RzpSubscriptionEntity['notes']): Record<string, string> {
  if (!notes || Array.isArray(notes) || typeof notes !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(notes)) if (typeof v === 'string') out[k] = v
  return out
}

const iso = (unixSeconds: number) => new Date(unixSeconds * 1000).toISOString()

function laterOf(current: string | null, unixSeconds: number | null | undefined): string | null {
  const next = unixSeconds ? iso(unixSeconds) : null
  if (!next) return current
  if (!current) return next
  return new Date(next) > new Date(current) ? next : current
}

export function reduceRazorpayEvent(event: RazorpayEvent, current: CurrentSubscription): EventOutcome {
  const sub = event.payload?.subscription?.entity
  if (!sub?.id) return NOTHING

  const notes = readNotes(sub.notes)
  const interval = isInterval(notes.interval) ? notes.interval : current.billing_interval
  const planId = notes.plan_id || current.plan_id

  // A different live subscription already owns this account: ignore this
  // one's state changes (an abandoned checkout paid late). Payments below
  // are still recorded.
  const foreign =
    !!current.razorpay_subscription_id &&
    current.razorpay_subscription_id !== sub.id &&
    current.status === 'active'

  const suspended = current.status === 'suspended'

  switch (event.event) {
    case 'subscription.activated':
    case 'subscription.charged': {
      const payment = paymentFrom(event, sub.id, planId, interval)
      if (foreign || suspended) return { patch: null, payment }
      return {
        patch: {
          status: 'active',
          plan_id: planId,
          billing_interval: interval,
          razorpay_subscription_id: sub.id,
          current_period_end: laterOf(current.current_period_end, sub.current_end),
          suspended_reason: null,
        },
        payment,
      }
    }
    case 'subscription.pending':
    case 'subscription.halted':
      if (foreign || suspended) return NOTHING
      return { patch: { status: 'past_due' }, payment: null }
    case 'subscription.cancelled':
    case 'subscription.completed':
      if (foreign || suspended) return NOTHING
      return {
        patch: {
          status: 'canceled',
          cancel_at_period_end: false,
          current_period_end: laterOf(current.current_period_end, sub.current_end ?? sub.ended_at),
        },
        payment: null,
      }
    default:
      return NOTHING
  }
}

function paymentFrom(
  event: RazorpayEvent,
  subscriptionId: string,
  planId: string | null,
  interval: BillingInterval | null,
): PaymentRecord | null {
  const p = event.payload?.payment?.entity
  if (!p?.id || typeof p.amount !== 'number') return null
  return {
    razorpay_payment_id: p.id,
    razorpay_subscription_id: subscriptionId,
    razorpay_invoice_id: p.invoice_id ?? null,
    plan_id: planId,
    billing_interval: interval,
    amount_paise: p.amount,
    currency: p.currency ?? 'INR',
    status: p.status ?? 'captured',
    method: p.method ?? null,
    paid_at: p.created_at ? iso(p.created_at) : new Date().toISOString(),
  }
}
