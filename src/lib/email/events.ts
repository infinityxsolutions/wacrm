// ============================================================
// Brevo delivery events -> recipient status.
//
// Pure. A recipient's status only moves forward through
// sent < delivered < opened < clicked; bounces, spam reports and
// unsubscribes are terminal and win over the forward states (spam and
// unsubscribe also win over a bounce). Hard bounces, spam reports and
// unsubscribes also opt the contact out of future email.
// ============================================================

export type RecipientStatus =
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'opened'
  | 'clicked'
  | 'bounced'
  | 'failed'
  | 'unsubscribed'
  | 'spam'

export interface BrevoEvent {
  event?: string
  'message-id'?: string
  email?: string
}

const RANK: Partial<Record<RecipientStatus, number>> = { queued: 0, sent: 1, delivered: 2, opened: 3, clicked: 4 }

export interface StatusChange {
  status: RecipientStatus
  optOut: boolean
}

export function reduceBrevoEvent(event: string | undefined, current: RecipientStatus): StatusChange | null {
  const e = (event ?? '').toLowerCase()
  let next: RecipientStatus
  let optOut = false
  switch (e) {
    case 'delivered':
      next = 'delivered'
      break
    case 'opened':
    case 'unique_opened':
    case 'proxy_open':
      next = 'opened'
      break
    case 'click':
    case 'clicks':
      next = 'clicked'
      break
    case 'hard_bounce':
    case 'invalid_email':
      next = 'bounced'
      optOut = true
      break
    case 'blocked':
      next = 'bounced'
      break
    case 'spam':
    case 'complaint':
      next = 'spam'
      optOut = true
      break
    case 'unsubscribed':
    case 'unsubscribe':
      next = 'unsubscribed'
      optOut = true
      break
    case 'error':
      next = 'failed'
      break
    default:
      return null // request, deferred, soft_bounce: transient, nothing to record
  }

  const forward = RANK[next] !== undefined
  if (forward) {
    const cur = RANK[current]
    if (cur === undefined) return null // already in a terminal state
    return next === current || RANK[next]! < cur ? null : { status: next, optOut }
  }
  if (current === 'spam' || current === 'unsubscribed') return null
  if (next === current) return optOut ? { status: next, optOut } : null
  return { status: next, optOut }
}
