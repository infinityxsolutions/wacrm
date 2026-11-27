import { describe, expect, it, vi } from 'vitest'
import { createEmailSender } from './index'

const env = { BREVO_API_KEY: 'key', BREVO_SENDER_EMAIL: 'send@growthxai.com' }
const msg = (n: number) => ({ toEmail: `u${n}@x.in`, toName: n % 2 ? null : `U${n}`, subject: `S${n}`, html: `<p>${n}</p>`, text: `${n}` })
const identity = { fromName: 'Shine', replyTo: 'hi@shine.in' }

describe('createEmailSender', () => {
  it('is a no-op without both settings', () => {
    expect(createEmailSender({}).enabled).toBe(false)
    expect(createEmailSender({ BREVO_API_KEY: 'k' }).enabled).toBe(false)
    expect(createEmailSender(env).enabled).toBe(true)
  })
})

describe('Brevo sender', () => {
  it('sends one request with a version per recipient and maps message ids in order', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ messageIds: ['<a>', '<b>'] }), { status: 201 }))
    const s = createEmailSender(env, { fetch: fetchMock as never })
    const out = await s.sendBatch(identity, [msg(1), msg(2)])
    expect(out).toEqual([{ ok: true, messageId: '<a>' }, { ok: true, messageId: '<b>' }])
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.brevo.com/v3/smtp/email')
    expect((init.headers as Record<string, string>)['api-key']).toBe('key')
    const body = JSON.parse(init.body as string)
    expect(body.sender).toEqual({ name: 'Shine', email: 'send@growthxai.com' })
    expect(body.replyTo.email).toBe('hi@shine.in')
    expect(body.messageVersions).toHaveLength(2)
    expect(body.messageVersions[0].to).toEqual([{ email: 'u1@x.in' }])
    expect(body.messageVersions[1].to).toEqual([{ email: 'u2@x.in', name: 'U2' }])
  })

  it('fails every message of a rejected batch with the provider message', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ message: 'Sender not valid' }), { status: 400 }))
    const out = await createEmailSender(env, { fetch: fetchMock as never }).sendBatch(identity, [msg(1), msg(2)])
    expect(out).toEqual([{ ok: false, error: 'Sender not valid' }, { ok: false, error: 'Sender not valid' }])
  })

  it('survives a network failure and an empty batch', async () => {
    const down = vi.fn(async () => { throw new Error('offline') })
    const s = createEmailSender(env, { fetch: down as never })
    expect(await s.sendBatch(identity, [msg(1)])).toEqual([{ ok: false, error: 'offline' }])
    expect(await s.sendBatch(identity, [])).toEqual([])
    expect(down).toHaveBeenCalledTimes(1)
  })
})
