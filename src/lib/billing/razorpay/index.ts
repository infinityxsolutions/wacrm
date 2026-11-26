import { HttpRazorpay } from './razorpay.client'
import { NoopRazorpay } from './noop.razorpay'
import type { RazorpayClient } from './razorpay.types'

export * from './razorpay.types'
export { verifyWebhookSignature } from './signature'

/** Real client when both keys are set, otherwise a no-op that fails clearly. */
export function createRazorpay(
  env: Record<string, string | undefined> = process.env,
  deps: { fetch?: typeof fetch } = {},
): RazorpayClient {
  const keyId = env.RAZORPAY_KEY_ID?.trim()
  const keySecret = env.RAZORPAY_KEY_SECRET?.trim()
  if (!keyId || !keySecret) return new NoopRazorpay()
  return new HttpRazorpay(keyId, keySecret, deps.fetch)
}
