/**
 * Public origin used in links inside emails (the unsubscribe link). An
 * explicit NEXT_PUBLIC_SITE_URL wins; otherwise the proxy's forwarded host,
 * otherwise the request's own origin.
 */
export function publicBaseUrl(request: Request): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  if (explicit) return explicit.replace(/\/+$/, '')
  const host = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
  const proto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || 'https'
  if (host && /^[a-z0-9.-]+(:\d+)?$/i.test(host)) return `${proto}://${host}`
  return new URL(request.url).origin
}
