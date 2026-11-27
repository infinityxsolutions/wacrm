import crypto from 'crypto'

/**
 * Verify Razorpay's `X-Razorpay-Signature`: hex HMAC-SHA256 of the RAW
 * request body with the webhook secret. Constant-time compare.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string | null | undefined,
  secret: string | undefined,
): boolean {
  if (!secret || !signature) return false
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(signature.trim())
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}
