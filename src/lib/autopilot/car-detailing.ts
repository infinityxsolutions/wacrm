// ============================================================
// Autopilot industry pack: car detailing studios.
//
// The owner answers a short questionnaire; this module turns the
// answers into a complete WhatsApp sales setup — AI agent instructions,
// knowledge base, quick replies, a jobs pipeline, tags and WhatsApp
// templates — with no prompt writing on their side.
//
// Grounding rule: business facts (services, prices, timings, policies,
// offers) come ONLY from the answers. Anything the owner leaves blank is
// left out, and the agent is told to hand over rather than guess. The
// only non-business content is general car-care guidance, worded as
// general advice.
//
// Pure functions: no I/O, fully unit-tested.
// ============================================================

import type { TemplatePayload } from '@/lib/whatsapp/template-validators'
import type { AutopilotSetup, GeneratedDoc, ValidationResult } from './types'

export const CAR_DETAILING_PACK = 'car_detailing'

/** Services a detailing studio commonly offers; the owner ticks the ones they do. */
export const DETAILING_SERVICES = [
  { id: 'foam_wash', name: 'Premium foam wash' },
  { id: 'interior_cleaning', name: 'Interior deep cleaning' },
  { id: 'exterior_polish', name: 'Exterior polishing & paint correction' },
  { id: 'ceramic_coating', name: 'Ceramic coating' },
  { id: 'graphene_coating', name: 'Graphene coating' },
  { id: 'ppf', name: 'Paint protection film (PPF)' },
  { id: 'teflon_coating', name: 'Teflon coating' },
  { id: 'headlight_restoration', name: 'Headlight restoration' },
  { id: 'engine_bay', name: 'Engine bay cleaning' },
  { id: 'ac_sanitisation', name: 'AC vent sanitisation & odour removal' },
  { id: 'underbody_coating', name: 'Underbody anti-rust coating' },
  { id: 'bike_detailing', name: 'Bike detailing' },
] as const

export type DetailingServiceId = (typeof DETAILING_SERVICES)[number]['id']

export const VEHICLE_SIZES = ['hatchback', 'sedan', 'suv'] as const
export type VehicleSize = (typeof VEHICLE_SIZES)[number]

export interface ServiceOffer {
  id: DetailingServiceId
  /** Price in INR per vehicle size; omitted when the owner didn't give one. */
  prices: Partial<Record<VehicleSize, number>>
  /** e.g. "3–4 hours", "1 day". */
  duration?: string
  /** For coatings / PPF, e.g. "3 years". */
  warranty?: string
}

export interface CarDetailingAnswers {
  businessName: string
  city: string
  /** Area / full address customers should come to. */
  address: string
  mapsLink?: string
  /** Number customers can call (shown in replies and templates). */
  contactPhone?: string
  /** e.g. "Mon–Sat 9:00 am – 8:00 pm, Sunday closed". */
  openingHours: string
  /** Languages the agent may reply in, e.g. ["English", "Hindi"]. */
  languages: string[]
  services: ServiceOffer[]
  pickupDrop: 'no' | 'free' | 'paid'
  pickupDropNote?: string
  doorstep: boolean
  /** e.g. ["UPI", "Cash", "Card"]. */
  paymentMethods: string[]
  bookingAdvance?: string
  cancellationPolicy?: string
  currentOffer?: string
  /** What makes the studio different, in the owner's words. */
  highlights?: string
  googleReviewLink?: string
  instagram?: string
  tone: 'friendly' | 'premium'
}

// ------------------------------------------------------------
// Validation
// ------------------------------------------------------------

const MAX_TEXT = 500
const SERVICE_IDS = new Set<string>(DETAILING_SERVICES.map((s) => s.id))

function text(v: unknown, max = MAX_TEXT): string | undefined {
  if (typeof v !== 'string') return undefined
  const s = v.trim().replace(/\s+/g, ' ')
  return s ? s.slice(0, max) : undefined
}

function url(v: unknown): string | undefined {
  const s = text(v, 300)
  if (!s) return undefined
  try {
    const u = new URL(s)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : undefined
  } catch {
    return undefined
  }
}

function list(v: unknown, max = 8): string[] {
  if (!Array.isArray(v)) return []
  return [...new Set(v.map((x) => text(x, 40)).filter((x): x is string => !!x))].slice(0, max)
}

/** Validate and normalise raw questionnaire input. */
export function parseCarDetailingAnswers(raw: unknown): ValidationResult<CarDetailingAnswers> {
  const errors: string[] = []
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>

  const businessName = text(b.businessName, 80)
  const city = text(b.city, 60)
  const address = text(b.address, 300)
  const openingHours = text(b.openingHours, 200)
  if (!businessName) errors.push('Business name is required')
  if (!city) errors.push('City is required')
  if (!address) errors.push('Address or area is required')
  if (!openingHours) errors.push('Opening hours are required')

  const services: ServiceOffer[] = []
  const rawServices = Array.isArray(b.services) ? b.services : []
  for (const item of rawServices) {
    if (!item || typeof item !== 'object') continue
    const s = item as Record<string, unknown>
    if (typeof s.id !== 'string' || !SERVICE_IDS.has(s.id)) continue
    if (services.some((x) => x.id === s.id)) continue
    const prices: Partial<Record<VehicleSize, number>> = {}
    const rawPrices = (s.prices && typeof s.prices === 'object' ? s.prices : {}) as Record<string, unknown>
    for (const size of VEHICLE_SIZES) {
      const n = Number(rawPrices[size])
      if (rawPrices[size] !== undefined && rawPrices[size] !== '' && Number.isFinite(n) && n > 0 && n < 10_000_000) {
        prices[size] = Math.round(n)
      }
    }
    services.push({
      id: s.id as DetailingServiceId,
      prices,
      ...(text(s.duration, 40) ? { duration: text(s.duration, 40) } : {}),
      ...(text(s.warranty, 40) ? { warranty: text(s.warranty, 40) } : {}),
    })
  }
  if (services.length === 0) errors.push('Choose at least one service you offer')

  const pickupDrop = b.pickupDrop === 'free' || b.pickupDrop === 'paid' ? b.pickupDrop : 'no'
  const tone = b.tone === 'premium' ? 'premium' : 'friendly'
  const languages = list(b.languages)
  const paymentMethods = list(b.paymentMethods)

  if (errors.length > 0) return { ok: false, errors }
  return {
    ok: true,
    value: {
      businessName: businessName!,
      city: city!,
      address: address!,
      openingHours: openingHours!,
      ...(url(b.mapsLink) ? { mapsLink: url(b.mapsLink) } : {}),
      ...(text(b.contactPhone, 20) ? { contactPhone: text(b.contactPhone, 20) } : {}),
      languages: languages.length ? languages : ['English'],
      services,
      pickupDrop,
      ...(text(b.pickupDropNote, 200) ? { pickupDropNote: text(b.pickupDropNote, 200) } : {}),
      doorstep: b.doorstep === true,
      paymentMethods,
      ...(text(b.bookingAdvance, 200) ? { bookingAdvance: text(b.bookingAdvance, 200) } : {}),
      ...(text(b.cancellationPolicy, 300) ? { cancellationPolicy: text(b.cancellationPolicy, 300) } : {}),
      ...(text(b.currentOffer, 200) ? { currentOffer: text(b.currentOffer, 200) } : {}),
      ...(text(b.highlights, 400) ? { highlights: text(b.highlights, 400) } : {}),
      ...(url(b.googleReviewLink) ? { googleReviewLink: url(b.googleReviewLink) } : {}),
      ...(text(b.instagram, 80) ? { instagram: text(b.instagram, 80) } : {}),
      tone,
    },
  }
}

// ------------------------------------------------------------
// Generation helpers
// ------------------------------------------------------------

const SIZE_LABEL: Record<VehicleSize, string> = { hatchback: 'Hatchback', sedan: 'Sedan', suv: 'SUV' }

export function serviceName(id: DetailingServiceId): string {
  return DETAILING_SERVICES.find((s) => s.id === id)?.name ?? id
}

export function formatInr(n: number): string {
  return `₹${n.toLocaleString('en-IN')}`
}

function priceLine(s: ServiceOffer): string {
  const parts = VEHICLE_SIZES.filter((size) => s.prices[size] !== undefined).map(
    (size) => `${SIZE_LABEL[size]} ${formatInr(s.prices[size]!)}`,
  )
  return parts.length ? parts.join(' · ') : 'Price on request (quote after seeing the car)'
}

function lowestPrice(s: ServiceOffer): number | null {
  const values = VEHICLE_SIZES.map((size) => s.prices[size]).filter((n): n is number => n !== undefined)
  return values.length ? Math.min(...values) : null
}

function sentence(parts: (string | undefined | false)[]): string {
  return parts.filter(Boolean).join(' ')
}

function pickupText(a: CarDetailingAnswers): string {
  const pickup =
    a.pickupDrop === 'free'
      ? 'Free pickup and drop is available.'
      : a.pickupDrop === 'paid'
        ? 'Pickup and drop is available at an extra charge.'
        : 'Pickup and drop is not offered; customers bring the car to the studio.'
  return sentence([
    pickup,
    a.pickupDropNote,
    a.doorstep ? 'Doorstep service is available for selected services.' : 'Services are done at the studio, not at the doorstep.',
  ])
}

/** Template names must be unique per account and match Meta's rules. */
function templateName(base: string): string {
  return base.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 60)
}

// ------------------------------------------------------------
// Generation
// ------------------------------------------------------------

function buildSystemPrompt(a: CarDetailingAnswers): string {
  const tone =
    a.tone === 'premium'
      ? 'polished, calm and premium — like a luxury car studio concierge'
      : 'warm, friendly and helpful — like a trusted local car-care expert'
  const offered = a.services.map((s) => serviceName(s.id)).join(', ')
  return [
    `You are the WhatsApp assistant for ${a.businessName}, a car detailing studio in ${a.city}.`,
    `Your tone is ${tone}. Keep replies short (2–4 lines), use simple words and at most one emoji.`,
    `Reply in the customer's language when it is one of: ${a.languages.join(', ')}. Otherwise reply in English.`,
    '',
    'Your goal: turn every enquiry into a booking.',
    '1. Greet the customer and find out what they need.',
    '2. Ask for their car model (and whether it is a hatchback, sedan or SUV) so you can quote the right price.',
    '3. Quote prices ONLY from the knowledge base. Mention what is included and the time it takes when known.',
    '4. Ask for their preferred date and time, and their name.',
    '5. When they are ready to book, collect: name, car model, service, preferred date/time and pickup address if needed, then hand over to the team to confirm the slot.',
    '',
    `Services offered: ${offered}.`,
    a.highlights ? `What makes us different: ${a.highlights}` : '',
    a.currentOffer ? `Current offer (mention it when relevant): ${a.currentOffer}` : '',
    '',
    'Rules:',
    '- Never invent prices, discounts, warranties, availability or timelines. If something is not in the knowledge base, say the team will confirm and hand over.',
    '- Hand over to a human when: the customer wants a discount or custom quote, has a complaint, asks for a specific confirmed slot, asks about damage, or seems unhappy.',
    '- Never ask for card numbers, OTPs or passwords.',
    '- Do not discuss competitors. Do not make promises on behalf of the team.',
  ]
    .filter((line, i, arr) => !(line === '' && arr[i - 1] === ''))
    .join('\n')
    .trim()
}

function buildKnowledge(a: CarDetailingAnswers): GeneratedDoc[] {
  const docs: GeneratedDoc[] = []

  docs.push({
    title: 'Services and prices',
    content: [
      `${a.businessName} offers the following services in ${a.city}. Prices are in Indian rupees per vehicle.`,
      ...a.services.map((s) =>
        [
          `${serviceName(s.id)}: ${priceLine(s)}.`,
          s.duration ? `Time needed: ${s.duration}.` : '',
          s.warranty ? `Warranty: ${s.warranty}.` : '',
        ]
          .filter(Boolean)
          .join(' '),
      ),
      'If a size is not listed for a service, the price is confirmed by the team after seeing the car.',
    ].join('\n'),
  })

  docs.push({
    title: 'Location, timings and contact',
    content: [
      `${a.businessName} is at ${a.address}, ${a.city}.`,
      a.mapsLink ? `Google Maps: ${a.mapsLink}` : '',
      `Opening hours: ${a.openingHours}.`,
      a.contactPhone ? `Phone: ${a.contactPhone}.` : '',
      a.instagram ? `Instagram: ${a.instagram}.` : '',
      pickupText(a),
    ]
      .filter(Boolean)
      .join('\n'),
  })

  docs.push({
    title: 'Booking, payment and cancellation',
    content: [
      'To book, the customer shares their name, car model, the service and a preferred date and time; the team then confirms the slot.',
      a.paymentMethods.length ? `Payment methods accepted: ${a.paymentMethods.join(', ')}.` : '',
      a.bookingAdvance ? `Advance / booking amount: ${a.bookingAdvance}.` : '',
      a.cancellationPolicy ? `Cancellation and rescheduling: ${a.cancellationPolicy}.` : 'Cancellation and rescheduling: the team will confirm the policy.',
    ]
      .filter(Boolean)
      .join('\n'),
  })

  if (a.currentOffer) {
    docs.push({ title: 'Current offer', content: `Current offer at ${a.businessName}: ${a.currentOffer}.` })
  }

  const has = (id: DetailingServiceId) => a.services.some((s) => s.id === id)
  const faq: string[] = [
    'General car-care guidance (not specific prices or promises — the team confirms details):',
    'Q: How should I wash my car between services? A: Use a pH-neutral car shampoo, two buckets and a microfibre mitt; avoid dish soap and automatic brush washes.',
  ]
  if (has('ceramic_coating') || has('graphene_coating') || has('teflon_coating')) {
    faq.push(
      'Q: What is a coating? A: A coating is a protective layer on the paint that adds gloss and makes the car easier to clean. How long it lasts depends on the product and the care afterwards.',
      'Q: Can I wash the car right after coating? A: Coatings need time to cure. Avoid washing the car for about a week after application unless the team advises otherwise.',
    )
  }
  if (has('ppf')) {
    faq.push(
      'Q: What is PPF? A: Paint protection film is a clear film that protects paint from stone chips, scratches and stains. Many films can heal minor swirl marks with heat.',
    )
  }
  if ((has('ceramic_coating') || has('graphene_coating')) && has('ppf')) {
    faq.push(
      'Q: Ceramic coating or PPF? A: A coating mainly adds gloss and easy cleaning; PPF adds physical protection against chips and scratches. Some owners choose both. The team can recommend based on how the car is used.',
    )
  }
  if (has('interior_cleaning') || has('ac_sanitisation')) {
    faq.push('Q: Do you clean the interior and remove odours? A: Yes — see the services and prices for interior cleaning options.')
  }
  docs.push({ title: 'Frequently asked questions', content: faq.join('\n') })

  return docs
}

function buildQuickReplies(a: CarDetailingAnswers) {
  const menu = a.services
    .map((s) => {
      const p = lowestPrice(s)
      return `• ${serviceName(s.id)}${p !== null ? ` — from ${formatInr(p)}` : ''}`
    })
    .join('\n')

  const replies = [
    {
      title: 'Welcome',
      content_text: `Hi! 👋 Welcome to ${a.businessName}, ${a.city}. Which car do you have, and what would you like done — wash, interior cleaning, coating or protection?`,
    },
    {
      title: 'Services & prices',
      content_text: `Here's what we do at ${a.businessName}:\n${menu}\n\nShare your car model and I'll give you the exact price.`,
    },
    {
      title: 'Ask car details',
      content_text: 'Could you share your car model and colour, and whether it is a hatchback, sedan or SUV? Then I can quote the exact price.',
    },
    {
      title: 'Location & timings',
      content_text: sentence([
        `We're at ${a.address}, ${a.city}.`,
        a.mapsLink ? `Map: ${a.mapsLink}` : '',
        `Open ${a.openingHours}.`,
      ]),
    },
    {
      title: 'Book a slot',
      content_text: 'Great choice! Please share your name, car model, preferred date and time' +
        (a.pickupDrop !== 'no' ? ', and pickup address if you want pickup' : '') +
        ". I'll confirm the slot shortly.",
    },
  ]
  if (a.paymentMethods.length) {
    replies.push({
      title: 'Payment options',
      content_text: sentence([
        `We accept ${a.paymentMethods.join(', ')}.`,
        a.bookingAdvance ? `Booking amount: ${a.bookingAdvance}.` : '',
      ]),
    })
  }
  if (a.googleReviewLink) {
    replies.push({
      title: 'Ask for review',
      content_text: `Thank you for choosing ${a.businessName}! 🙏 If you loved the result, a quick Google review would mean a lot to us: ${a.googleReviewLink}`,
    })
  }
  if (a.currentOffer) {
    replies.push({ title: 'Current offer', content_text: `🎉 Current offer: ${a.currentOffer}. Want me to book a slot for you?` })
  }
  return replies
}

function buildTemplates(a: CarDetailingAnswers): TemplatePayload[] {
  const sample = { name: 'Rahul', car: 'Hyundai Creta', service: serviceName(a.services[0]!.id) }
  const templates: TemplatePayload[] = [
    {
      name: templateName('booking_confirmation'),
      category: 'Utility',
      language: 'en',
      body_text: `Hi {{1}}, your {{2}} booking for your {{3}} at ${a.businessName} is confirmed for {{4}}. Reply to this message if you need to reschedule.`,
      sample_values: { body: [sample.name, sample.service, sample.car, '12 Dec, 10:00 am'] },
    },
    {
      name: templateName('appointment_reminder'),
      category: 'Utility',
      language: 'en',
      body_text: `Hi {{1}}, a reminder of your {{2}} appointment at ${a.businessName} on {{3}}. See you soon! Reply here if you need to change the time.`,
      sample_values: { body: [sample.name, sample.service, 'tomorrow at 10:00 am'] },
    },
    {
      name: templateName('car_ready'),
      category: 'Utility',
      language: 'en',
      body_text: `Hi {{1}}, good news: your {{2}} is ready! ${a.pickupDrop === 'no' ? 'You can collect it during our opening hours.' : 'Reply here to arrange collection or drop.'}`,
      sample_values: { body: [sample.name, sample.car] },
    },
    {
      name: templateName('quote_follow_up'),
      category: 'Marketing',
      language: 'en',
      body_text: `Hi {{1}}, thanks for asking about {{2}} for your {{3}} at ${a.businessName}. Would you like us to reserve a slot this week? Reply here and we'll set it up.`,
      sample_values: { body: [sample.name, sample.service, sample.car] },
    },
    {
      name: templateName('maintenance_reminder'),
      category: 'Marketing',
      language: 'en',
      body_text: `Hi {{1}}, it's been a while since your {{2}} was detailed at ${a.businessName}. Regular care keeps it looking new. Reply here to book your next visit.`,
      sample_values: { body: [sample.name, sample.car] },
    },
  ]
  if (a.googleReviewLink) {
    templates.push({
      name: templateName('review_request'),
      category: 'Marketing',
      language: 'en',
      body_text: `Hi {{1}}, thank you for choosing ${a.businessName}! If you're happy with your {{2}}, a quick Google review would mean a lot to us: ${a.googleReviewLink}`,
      sample_values: { body: [sample.name, sample.car] },
    })
  }
  if (a.currentOffer) {
    templates.push({
      name: templateName('current_offer'),
      category: 'Marketing',
      language: 'en',
      body_text: `Hi {{1}}, special offer at ${a.businessName}: ${a.currentOffer}. Reply here to book your slot.`,
      sample_values: { body: [sample.name] },
    })
  }
  return templates
}

/** Build the full Autopilot setup for a car detailing studio. */
export function buildCarDetailingSetup(a: CarDetailingAnswers): AutopilotSetup {
  return {
    systemPrompt: buildSystemPrompt(a),
    knowledge: buildKnowledge(a),
    quickReplies: buildQuickReplies(a),
    pipeline: {
      name: 'Detailing jobs',
      stages: [
        { name: 'New enquiry', color: '#3b82f6' },
        { name: 'Quote sent', color: '#8b5cf6' },
        { name: 'Booked', color: '#f59e0b' },
        { name: 'In service', color: '#06b6d4' },
        { name: 'Completed', color: '#22c55e' },
        { name: 'Review requested', color: '#14b8a6' },
        { name: 'Lost', color: '#ef4444' },
      ],
    },
    tags: [
      { name: 'Hatchback', color: '#64748b' },
      { name: 'Sedan', color: '#64748b' },
      { name: 'SUV', color: '#64748b' },
      ...a.services.map((s) => ({ name: serviceName(s.id), color: '#0ea5e9' })),
      { name: 'Hot lead', color: '#ef4444' },
      { name: 'Repeat customer', color: '#22c55e' },
    ],
    templates: buildTemplates(a),
  }
}
