// ============================================================
// Email rendering. The owner writes plain text with {{name}} style
// variables; we produce HTML + text. Everything inserted is escaped, and
// only http(s) links are made clickable, so contact data (a name like
// "<script>") can never inject markup.
// ============================================================

export interface RenderVars {
  name: string | null
  businessName: string
}

export interface FooterInfo {
  businessName: string
  address: string
  unsubscribeUrl: string
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
export const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => ESCAPES[c]!)

/** Fill {{name}}, {{first_name}}, {{business_name}}; unknown variables become empty. */
export function fillVariables(template: string, vars: RenderVars): string {
  const name = vars.name?.trim() || 'there'
  const first = name.split(/\s+/)[0] ?? 'there'
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_m, key: string) => {
    switch (key.toLowerCase()) {
      case 'name':
        return name
      case 'first_name':
        return first
      case 'business_name':
        return vars.businessName
      default:
        return ''
    }
  })
}

function linkify(escaped: string): string {
  return escaped.replace(/\bhttps?:\/\/[^\s<]+/g, (url) => {
    // Trailing punctuation belongs to the sentence, not the link.
    const m = url.match(/^(.*?)([.,;:!?)]*)$/)
    const clean = m?.[1] ?? url
    const tail = m?.[2] ?? ''
    return `<a href="${clean}" style="color:#2563eb">${clean}</a>${tail}`
  })
}

export function renderEmailBody(bodyTemplate: string, vars: RenderVars): { html: string; text: string } {
  const text = fillVariables(bodyTemplate, vars).replace(/\r\n/g, '\n').trim()
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 16px">${linkify(escapeHtml(p)).replace(/\n/g, '<br>')}</p>`)
  return { html: paragraphs.join(''), text }
}

export function renderEmail(
  subjectTemplate: string,
  bodyTemplate: string,
  vars: RenderVars,
  footer: FooterInfo,
): { subject: string; html: string; text: string } {
  const subject = fillVariables(subjectTemplate, vars).replace(/\s+/g, ' ').trim()
  const body = renderEmailBody(bodyTemplate, vars)
  const unsub = footer.unsubscribeUrl
  const html =
    `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f7f9;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111827">` +
    `<div style="max-width:560px;margin:0 auto;background:#ffffff;padding:24px;border-radius:8px">${body.html}</div>` +
    `<p style="max-width:560px;margin:16px auto 0;font-size:12px;color:#6b7280">` +
    `You are receiving this email from ${escapeHtml(footer.businessName)}, ${escapeHtml(footer.address)}.<br>` +
    `<a href="${escapeHtml(unsub)}" style="color:#6b7280">Unsubscribe</a></p></body></html>`
  const textOut =
    `${body.text}\n\n--\nYou are receiving this email from ${footer.businessName}, ${footer.address}.\n` +
    `Unsubscribe: ${unsub}`
  return { subject, html, text: textOut }
}
