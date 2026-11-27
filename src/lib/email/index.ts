import { BrevoEmailSender } from './brevo.client'
import { NoopEmailSender } from './noop.email'
import type { EmailSender } from './email.types'

export * from './email.types'

/** Brevo when the API key and a verified sender address are set, else a no-op. */
export function createEmailSender(
  env: Record<string, string | undefined> = process.env,
  deps: { fetch?: typeof fetch } = {},
): EmailSender {
  const key = env.BREVO_API_KEY?.trim()
  const sender = env.BREVO_SENDER_EMAIL?.trim()
  if (!key || !sender) return new NoopEmailSender()
  return new BrevoEmailSender(key, sender, deps.fetch)
}
