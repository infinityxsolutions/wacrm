import { EmailNotConfiguredError, type EmailSender } from './email.types'

/** Used when no Brevo credentials are set: fails clearly, sends nothing. */
export class NoopEmailSender implements EmailSender {
  readonly enabled = false
  readonly maxBatch = 1
  async sendBatch(): Promise<never> {
    throw new EmailNotConfiguredError()
  }
}
