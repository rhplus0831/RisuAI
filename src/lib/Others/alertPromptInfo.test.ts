import { describe, expect, it } from 'vitest'
import { normalizePromptInfo } from './alertPromptInfo'

describe('normalizePromptInfo', () => {
  it('treats missing prompt info as empty display data', () => {
    expect(normalizePromptInfo(undefined)).toEqual({
      hasPromptInfo: false,
      promptName: '',
      promptToggles: [],
      promptText: [],
    })
  })

  it('keeps prompt text displayable when toggles are absent', () => {
    const normalized = normalizePromptInfo({
      promptText: [{ role: 'system', content: 'Use the compact server prompt.' }],
    })

    expect(normalized.hasPromptInfo).toBe(true)
    expect(normalized.promptToggles).toEqual([])
    expect(normalized.promptText).toEqual([{ role: 'system', content: 'Use the compact server prompt.' }])
  })

  it('filters malformed prompt rows without throwing', () => {
    const malformedPromptInfo = {
      promptName: 'Preset',
      promptToggles: undefined,
      promptText: [{ role: 'system', content: 'ok' }, { role: 'invalid', content: 'skip' }, { role: 'user' }],
    } as unknown as Parameters<typeof normalizePromptInfo>[0]
    const normalized = normalizePromptInfo(malformedPromptInfo)

    expect(normalized).toEqual({
      hasPromptInfo: true,
      promptName: 'Preset',
      promptToggles: [],
      promptText: [{ role: 'system', content: 'ok' }],
    })
  })
})
