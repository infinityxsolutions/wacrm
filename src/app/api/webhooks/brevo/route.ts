import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { readCappedBody } from '@/lib/whatsapp/webhook-body'
import { processBrevoEvent } from '@/lib/email/webhook'
import type { BrevoEvent } from '@/lib/email/events'
import { platformDb } from '@/lib/platform/admin'

const MAX_BYTES = 1024 * 1024

function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false
  const a = crypto.createHash('sha256').update(provided).digest()
  const b = crypto.createHash('sha256').update(expected).digest()
  return crypto.timingSafeEqual(a, b)
}

/**
 * POST /api/webhooks/brevo?token=<BREVO_WEBHOOK_SECRET>
 *
 * Delivery events (delivered, opened, click, bounces, spam). Brevo does not
 * sign webhooks, so the shared secret in the URL (or an Authorization
 * Bearer header, if you configure one) is the credential. Answers 200 for
 * anything handled or ignored and 500 only on a real failure so Brevo retries.
 */
export async function POST(request: Request) {
  const expected = process.env.BREVO_WEBHOOK_SECRET
  if (!expected) {
    console.error('[brevo webhook] BREVO_WEBHOOK_SECRET is not set')
    return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  }
  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null
  const provided = new URL(request.url).searchParams.get('token') ?? bearer
  if (!secretMatches(provided, expected)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const raw = await readCappedBody(request, MAX_BYTES)
  if (raw === null) return NextResponse.json({ error: 'Payload too large' }, { status: 413 })
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const events = (Array.isArray(parsed) ? parsed : [parsed]).filter(
    (e): e is BrevoEvent => !!e && typeof e === 'object',
  )
  try {
    const db = platformDb()
    for (const event of events.slice(0, 200)) await processBrevoEvent(db, event)
    return NextResponse.json({ received: true })
  } catch (err) {
    console.error('[brevo webhook] processing failed:', err)
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 })
  }
}
