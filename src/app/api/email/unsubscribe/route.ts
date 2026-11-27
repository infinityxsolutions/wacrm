import { NextResponse } from 'next/server'
import { isPlausibleToken } from '@/lib/email/tokens'
import { unsubscribeByToken } from '@/lib/email/webhook'
import { checkRateLimit } from '@/lib/rate-limit'
import { platformDb } from '@/lib/platform/admin'

// Public (no session): the token in the link is the credential. GET only
// shows a confirmation button, so mail scanners that pre-fetch links cannot
// unsubscribe anyone; the POST does the work (also the one-click method).

const page = (title: string, body: string, token?: string) =>
  new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>` +
      `<body style="font-family:Arial,sans-serif;max-width:420px;margin:64px auto;padding:0 16px;color:#111827"><h1 style="font-size:20px">${title}</h1><p>${body}</p>` +
      (token
        ? `<form method="post" action="/api/email/unsubscribe?t=${encodeURIComponent(token)}"><button type="submit" style="padding:10px 16px;font-size:15px;cursor:pointer">Unsubscribe</button></form>`
        : '') +
      `</body></html>`,
    { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } },
  )

const tokenOf = (request: Request) => new URL(request.url).searchParams.get('t')

function ipOf(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
}

export async function GET(request: Request) {
  const token = tokenOf(request)
  if (!isPlausibleToken(token)) return page('Link not valid', 'This unsubscribe link is not valid or has expired.')
  return page('Unsubscribe', 'Click the button to stop receiving emails from this business.', token)
}

export async function POST(request: Request) {
  const limit = checkRateLimit(`email-unsub:${ipOf(request)}`, { limit: 30, windowMs: 60_000 })
  if (!limit.success) return page('Too many requests', 'Please try again in a minute.')
  const token = tokenOf(request)
  if (!isPlausibleToken(token)) return page('Link not valid', 'This unsubscribe link is not valid or has expired.')
  try {
    const found = await unsubscribeByToken(platformDb(), token)
    return found
      ? page('You are unsubscribed', 'You will not receive more emails from this business.')
      : page('Link not valid', 'This unsubscribe link is not valid or has expired.')
  } catch (err) {
    console.error('[email/unsubscribe] error:', err)
    return page('Something went wrong', 'Please try again in a moment.')
  }
}
