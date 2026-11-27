import { describe, expect, it } from 'vitest'
import { parseCampaignInput } from './campaign-input'

describe('parseCampaignInput', () => {
  it('trims, collapses the subject and defaults the audience', () => {
    expect(parseCampaignInput({ name: ' Diwali ', subject: 'Hi \n there', body_text: ' Body ' })).toEqual({
      name: 'Diwali',
      subject: 'Hi there',
      body_text: 'Body',
      audience: { kind: 'all' },
    })
  })
  it('requires name, subject and body and rejects bad audiences', () => {
    expect(parseCampaignInput(null)).toBeNull()
    expect(parseCampaignInput({ name: 'a', subject: '', body_text: 'x' })).toBeNull()
    expect(() => parseCampaignInput({ name: 'a', subject: 'b', body_text: 'c', audience: { kind: 'tags', tag_ids: [] } })).toThrow()
  })
})
