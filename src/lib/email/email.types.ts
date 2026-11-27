export interface OutboundEmail {
  toEmail: string
  toName: string | null
  subject: string
  html: string
  text: string
}

export interface EmailSenderIdentity {
  /** Display name recipients see (the business). */
  fromName: string
  /** Where replies go (the business). */
  replyTo: string
}

export interface EmailSendResult {
  ok: boolean
  /** Provider message id, used to match delivery webhooks. */
  messageId?: string
  error?: string
}

/** The slice of an email provider (Brevo) that GrowthXAi uses. */
export interface EmailSender {
  /** True when real credentials are configured (false for the no-op). */
  readonly enabled: boolean
  /** Send up to `maxBatch` messages; returns one result per message, in order. */
  readonly maxBatch: number
  sendBatch(identity: EmailSenderIdentity, messages: OutboundEmail[]): Promise<EmailSendResult[]>
}

export class EmailNotConfiguredError extends Error {
  constructor() {
    super('Email sending is not configured')
    this.name = 'EmailNotConfiguredError'
  }
}

export type EmailErrorCode =
  | 'settings_missing'
  | 'campaign_not_found'
  | 'already_sent'
  | 'no_recipients'
  | 'invalid_audience'

export class EmailError extends Error {
  constructor(
    readonly code: EmailErrorCode,
    message: string,
    readonly status: number = 400,
  ) {
    super(message)
    this.name = 'EmailError'
  }
}
