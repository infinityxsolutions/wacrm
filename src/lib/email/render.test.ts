import { describe, expect, it } from 'vitest'
import { escapeHtml, fillVariables, renderEmail } from './render'
import { isPlausibleToken, newUnsubscribeToken, unsubscribeUrl } from './tokens'

const footer = { businessName: 'Shine Studio', address: 'Road 12, Hyderabad', unsubscribeUrl: 'https://app.example/api/email/unsubscribe?t=abc' }

describe('fillVariables', () => {
  it('fills name, first name and business, with a friendly fallback', () => {
    const v = { name: 'Rahul Verma', businessName: 'Shine' }
    expect(fillVariables('Hi {{first_name}} / {{ name }} from {{business_name}}', v)).toBe('Hi Rahul / Rahul Verma from Shine')
    expect(fillVariables('Hi {{name}}', { name: null, businessName: 'x' })).toBe('Hi there')
    expect(fillVariables('{{secret}}!', v)).toBe('!')
  })
})

describe('renderEmail', () => {
  it('escapes contact data and never lets a name inject markup', () => {
    const r = renderEmail('Hello {{name}}', 'Hi {{name}}', { name: '<script>alert(1)</script>', businessName: 'S' }, footer)
    expect(r.html).not.toContain('<script>')
    expect(r.html).toContain('&lt;script&gt;')
  })

  it('makes only http(s) links clickable and keeps trailing punctuation outside the link', () => {
    const r = renderEmail('s', 'See https://shine.in/offer. Or javascript:alert(1)', { name: 'A', businessName: 'S' }, footer)
    expect(r.html).toContain('<a href="https://shine.in/offer"')
    expect(r.html).toContain('</a>.')
    expect(r.html).not.toContain('href="javascript')
  })

  it('splits paragraphs, adds the address and an unsubscribe link in html and text', () => {
    const r = renderEmail('Offer', 'Line one\nline two\n\nSecond paragraph', { name: 'A', businessName: 'S' }, footer)
    expect(r.html.match(/<p style="margin:0 0 16px">/g)).toHaveLength(2)
    expect(r.html).toContain('line two'.replace('line', '<br>line'))
    for (const out of [r.html, r.text]) {
      expect(out).toContain('Road 12, Hyderabad')
      expect(out).toContain('unsubscribe?t=abc')
    }
  })

  it('strips line breaks from the subject', () => {
    expect(renderEmail('A\r\nB  C', 'x', { name: null, businessName: 'S' }, footer).subject).toBe('A B C')
  })
})

describe('tokens', () => {
  it('are unique, url-safe and plausible', () => {
    const a = newUnsubscribeToken()
    expect(a).not.toBe(newUnsubscribeToken())
    expect(isPlausibleToken(a)).toBe(true)
    expect(isPlausibleToken('short')).toBe(false)
    expect(isPlausibleToken('has space has space')).toBe(false)
    expect(unsubscribeUrl('https://x.in/', 'a b')).toBe('https://x.in/api/email/unsubscribe?t=a%20b')
    expect(escapeHtml(`<&">'`)).toBe('&lt;&amp;&quot;&gt;&#39;')
  })
})
