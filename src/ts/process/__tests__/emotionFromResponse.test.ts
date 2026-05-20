import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import { CharEmotion } from '../../stores.svelte'
import type { character } from '../../storage/database.svelte'
import { applyEmotionFromResponse } from '../postGeneration/emotionFromResponse'

function makeChar(emotionImages: [string, string][]): character {
  return {
    name: 'Test',
    chaId: 'cha-test',
    emotionImages,
  } as unknown as character
}

describe('applyEmotionFromResponse', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(1000))
    CharEmotion.set({})
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns false when emotion is undefined', () => {
    const char = makeChar([['happy', 'h.png']])
    const result = applyEmotionFromResponse({ emotion: undefined, currentChar: char })
    expect(result).toBe(false)
    expect(get(CharEmotion)).toEqual({})
  })

  it('returns false when no emotion in currentChar.emotionImages matches', () => {
    const char = makeChar([['happy', 'h.png']])
    const result = applyEmotionFromResponse({ emotion: 'angry', currentChar: char })
    expect(result).toBe(false)
    expect(get(CharEmotion)).toEqual({})
  })

  it('pushes a tuple [name, image, ts] when emotion matches, returns true', () => {
    const char = makeChar([
      ['happy', 'h.png'],
      ['sad', 's.png'],
    ])
    const result = applyEmotionFromResponse({ emotion: 'sad', currentChar: char })
    expect(result).toBe(true)
    expect(get(CharEmotion)).toEqual({ 'cha-test': [['sad', 's.png', 1000]] })
  })

  it('appends to existing tempEmotion entries', () => {
    CharEmotion.set({ 'cha-test': [['happy', 'h.png', 500]] })
    const char = makeChar([
      ['happy', 'h.png'],
      ['sad', 's.png'],
    ])
    applyEmotionFromResponse({ emotion: 'sad', currentChar: char })
    expect(get(CharEmotion)).toEqual({
      'cha-test': [
        ['happy', 'h.png', 500],
        ['sad', 's.png', 1000],
      ],
    })
  })

  it('splices the oldest entry when tempEmotion has > 4 entries', () => {
    CharEmotion.set({
      'cha-test': [
        ['e1', 'e1.png', 100],
        ['e2', 'e2.png', 200],
        ['e3', 'e3.png', 300],
        ['e4', 'e4.png', 400],
        ['e5', 'e5.png', 500],
      ],
    })
    const char = makeChar([['e6', 'e6.png']])
    applyEmotionFromResponse({ emotion: 'e6', currentChar: char })
    // The oldest (e1) is spliced; the new entry (e6) is appended.
    expect(get(CharEmotion)).toEqual({
      'cha-test': [
        ['e2', 'e2.png', 200],
        ['e3', 'e3.png', 300],
        ['e4', 'e4.png', 400],
        ['e5', 'e5.png', 500],
        ['e6', 'e6.png', 1000],
      ],
    })
  })

  it('keeps all 4 entries when tempEmotion has exactly 4 (boundary)', () => {
    CharEmotion.set({
      'cha-test': [
        ['e1', 'e1.png', 100],
        ['e2', 'e2.png', 200],
        ['e3', 'e3.png', 300],
        ['e4', 'e4.png', 400],
      ],
    })
    const char = makeChar([['e5', 'e5.png']])
    applyEmotionFromResponse({ emotion: 'e5', currentChar: char })
    // The > 4 check is FALSE for length === 4; nothing is spliced.
    expect(get(CharEmotion)['cha-test']).toHaveLength(5)
  })

  it('handles missing chaId entry in CharEmotion (no prior tempEmotion)', () => {
    const char = makeChar([['happy', 'h.png']])
    const result = applyEmotionFromResponse({ emotion: 'happy', currentChar: char })
    expect(result).toBe(true)
    expect(get(CharEmotion)).toEqual({ 'cha-test': [['happy', 'h.png', 1000]] })
  })
})
