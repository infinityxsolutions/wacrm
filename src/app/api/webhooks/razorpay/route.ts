import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { verifyWebhookSignature } from '@/lib/billing/razorpay'
import type { RazorpayEvent } from '@/lib/billing/razorpay/events'
import { processRazorpayEvent } from '@/lib/billing/razorpay/webhook'
import { readCappedBody } from '@/lib/whatsapp/webhook-body'
import { platformDb } from '@/lib/platform/admin'

const MAX_BYTES = 1024 * 1024

/**
 * POST /api/webhooks/razorpay
 *
 * Razorpay subscription events. Authenticated only by the HMAC signature of
 * the raw body; no session. Answers 200 for anything it understood or
 * deliberately ignores, and 500 only on a real failure so Razorpay retries.
 */
export async function POST(request: Request) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET
  if (!secret) {
    console.error('[razorpay webhook] RAZORPAY_WEBHOOK_SECRET is not set')
    return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  }

  const raw = await readCappedBody(request, MAX_BYTES)
  if (raw === null) return NextResponse.json({ error: 'Payload too large' }, { status: 413 })
  if (!verifyWebhookSignature(raw, request.headers.get('x-razorpay-signature'), secret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let event: RazorpayEvent
  try {
    event = JSON.parse(raw) as RazorpayEvent
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (typeof event.event !== 'string') return NextResponse.json({ received: true })

  // Razorpay sends a unique id per event; fall back to a hash of the body.
  const eventId =
    request.headers.get('x-razorpay-event-id')?.trim() ||
    `body_${crypto.createHash('sha256').update(raw).digest('hex')}`

  try {
    const result = await processRazorpayEvent(platformDb(), event, eventId)
    return NextResponse.json({ received: true, result: result.status })
  } catch (err) {
    console.error('[razorpay webhook] processing failed:', err)
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 })
  }
}
