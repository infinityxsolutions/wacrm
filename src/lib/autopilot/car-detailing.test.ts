import { describe, expect, it } from 'vitest'
import { validateTemplatePayload } from '@/lib/whatsapp/template-validators'
import { buildCarDetailingSetup, parseCarDetailingAnswers, formatInr } from './car-detailing'

const raw = {
  businessName: '  Shine Studio ',
  city: 'Hyderabad',
  address: 'Road 12, Banjara Hills',
  openingHours: 'Mon–Sat 9am–8pm',
  mapsLink: 'https://maps.google.com/?q=shine',
  contactPhone: '+91 90000 00000',
  languages: ['English', 'Telugu', 'English'],
  services: [
    { id: 'foam_wash', prices: { hatchback: 499, sedan: 599, suv: '799' }, duration: '1 hour' },
    { id: 'ceramic_coating', prices: { sedan: 18000 }, warranty: '3 years' },
    { id: 'ppf', prices: {} },
    { id: 'not_a_service', prices: { sedan: 1 } },
    { id: 'foam_wash', prices: { sedan: 1 } },
  ],
  pickupDrop: 'free',
  doorstep: true,
  paymentMethods: ['UPI', 'Cash'],
  currentOffer: '10% off ceramic coating this month',
  googleReviewLink: 'https://g.page/r/shine/review',
  tone: 'premium',
}

describe('parseCarDetailingAnswers', () => {
  it('normalises valid answers and drops unknown/duplicate services', () => {
    const r = parseCarDetailingAnswers(raw)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.businessName).toBe('Shine Studio')
    expect(r.value.languages).toEqual(['English', 'Telugu'])
    expect(r.value.services.map((s) => s.id)).toEqual(['foam_wash', 'ceramic_coating', 'ppf'])
    expect(r.value.services[0]!.prices).toEqual({ hatchback: 499, sedan: 599, suv: 799 })
  })

  it('reports required fields', () => {
    const r = parseCarDetailingAnswers({ services: [] })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors).toHaveLength(5)
  })

  it('rejects non-http links and bad prices', () => {
    const r = parseCarDetailingAnswers({
      ...raw,
      mapsLink: 'javascript:alert(1)',
      services: [{ id: 'foam_wash', prices: { sedan: -5, suv: 'abc' } }],
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.mapsLink).toBeUndefined()
    expect(r.value.services[0]!.prices).toEqual({})
  })
})

describe('buildCarDetailingSetup', () => {
  const answers = (() => {
    const r = parseCarDetailingAnswers(raw)
    if (!r.ok) throw new Error('fixture invalid')
    return r.value
  })()
  const setup = buildCarDetailingSetup(answers)

  it('grounds the prompt and knowledge in the answers only', () => {
    expect(setup.systemPrompt).toContain('Shine Studio')
    expect(setup.systemPrompt).toContain('Never invent prices')
    const prices = setup.knowledge.find((d) => d.title === 'Services and prices')!.content
    expect(prices).toContain(`Sedan ${formatInr(18000)}`)
    expect(prices).toContain('Price on request')
    expect(setup.knowledge.map((d) => d.title)).toContain('Current offer')
  })

  it('omits optional pieces when not provided', () => {
    const r = parseCarDetailingAnswers({ ...raw, currentOffer: '', googleReviewLink: '' })
    if (!r.ok) throw new Error('invalid')
    const s = buildCarDetailingSetup(r.value)
    expect(s.templates.map((t) => t.name)).not.toContain('review_request')
    expect(s.templates.map((t) => t.name)).not.toContain('current_offer')
    expect(s.quickReplies.map((q) => q.title)).not.toContain('Current offer')
  })

  it('produces Meta-valid templates with unique names', () => {
    expect(setup.templates.length).toBe(7)
    expect(new Set(setup.templates.map((t) => t.name)).size).toBe(setup.templates.length)
    for (const t of setup.templates) expect(() => validateTemplatePayload(t)).not.toThrow()
  })

  it('builds pipeline and unique tags', () => {
    expect(setup.pipeline.stages[0]!.name).toBe('New enquiry')
    const names = setup.tags.map((t) => t.name)
    expect(new Set(names).size).toBe(names.length)
  })
})
