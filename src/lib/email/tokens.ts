import crypto from 'crypto'

/** Unguessable per-recipient token (192 bits, URL-safe). */
export function newUnsubscribeToken(): string {
  return crypto.randomBytes(24).toString('base64url')
}

export function isPlausibleToken(token: unknown): token is string {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(token)
}

export function unsubscribeUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/api/email/unsubscribe?t=${encodeURIComponent(token)}`
}
