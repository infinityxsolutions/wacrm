import { parseAudience } from './audience'

/** Validate a campaign create/edit body; null when name, subject or message is missing. */
export function parseCampaignInput(b: Record<string, unknown> | null) {
  const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
  const name = clean(b?.name, 120)
  const subject = clean(b?.subject, 200).replace(/\s+/g, ' ')
  const body_text = clean(b?.body_text, 20000)
  if (!name || !subject || !body_text) return null
  return { name, subject, body_text, audience: parseAudience(b?.audience) }
}
