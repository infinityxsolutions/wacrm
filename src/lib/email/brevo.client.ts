import type {
  EmailSendResult,
  EmailSender,
  EmailSenderIdentity,
  OutboundEmail,
} from './email.types'

const ENDPOINT = 'https://api.brevo.com/v3/smtp/email'

/**
 * Brevo transactional API. Each message is rendered per recipient by us
 * (so every variable is HTML-escaped by our code), then sent as a message
 * "version" so up to 50 go in one request.
 */
export class BrevoEmailSender implements EmailSender {
  readonly enabled = true
  readonly maxBatch = 50

  constructor(
    private readonly apiKey: string,
    private readonly senderEmail: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async sendBatch(identity: EmailSenderIdentity, messages: OutboundEmail[]): Promise<EmailSendResult[]> {
    if (messages.length === 0) return []
    const first = messages[0]!
    let res: Response
    try {
      res = await this.fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: { 'api-key': this.apiKey, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          sender: { name: identity.fromName, email: this.senderEmail },
          replyTo: { email: identity.replyTo, name: identity.fromName },
          subject: first.subject,
          htmlContent: first.html,
          textContent: first.text,
          messageVersions: messages.map((m) => ({
            to: [m.toName ? { email: m.toEmail, name: m.toName } : { email: m.toEmail }],
            subject: m.subject,
            htmlContent: m.html,
            textContent: m.text,
          })),
        }),
      })
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Network error'
      return messages.map(() => ({ ok: false, error }))
    }

    const data = (await res.json().catch(() => ({}))) as {
      messageId?: string
      messageIds?: string[]
      message?: string
    }
    if (!res.ok) {
      const error = data.message ?? `Brevo error ${res.status}`
      return messages.map(() => ({ ok: false, error }))
    }
    const ids = data.messageIds ?? (data.messageId ? [data.messageId] : [])
    return messages.map((_m, i) => {
      const messageId = ids[i]
      return messageId ? { ok: true, messageId } : { ok: true }
    })
  }
}
