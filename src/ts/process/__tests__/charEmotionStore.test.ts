import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import { CharEmotion } from '../../stores.svelte'
import {
  loadAndTrimCharEmotion,
  pushCharEmotionEntry,
  type CharEmotionEntry,
} from '../postGeneration/charEmotionStore'

describe('loadAndTrimCharEmotion', () => {
  beforeEach(() => {
    CharEmotion.set({})
  })

  it('returns an empty tempEmotion when no prior entry exists for chaId', () => {
    const { tempEmotion, charemotions } = loadAndTrimCharEmotion('cha-1')
    expect(tempEmotion).toEqual([])
    expect(charemotions).toEqual({})
  })

  it('returns the existing tempEmotion array unchanged when length < 5', () => {
    const initial: CharEmotionEntry[] = [
      ['e1', 'e1.png', 100],
      ['e2', 'e2.png', 200],
    ]
    CharEmotion.set({ 'cha-1': initial })
    const { tempEmotion } = loadAndTrimCharEmotion('cha-1')
    expect(tempEmotion).toBe(initial)
    expect(tempEmotion).toHaveLength(2)
  })

  it('does not trim at the > 4 boundary (length 4 is preserved)', () => {
    const initial: CharEmotionEntry[] = [
      ['e1', 'e1.png', 100],
      ['e2', 'e2.png', 200],
      ['e3', 'e3.png', 300],
      ['e4', 'e4.png', 400],
    ]
    CharEmotion.set({ 'cha-1': initial })
    const { tempEmotion } = loadAndTrimCharEmotion('cha-1')
    expect(tempEmotion).toHaveLength(4)
    expect(tempEmotion[0]).toEqual(['e1', 'e1.png', 100])
  })

  it('splices the oldest entry when length > 4', () => {
    const initial: CharEmotionEntry[] = [
      ['e1', 'e1.png', 100],
      ['e2', 'e2.png', 200],
      ['e3', 'e3.png', 300],
      ['e4', 'e4.png', 400],
      ['e5', 'e5.png', 500],
    ]
    CharEmotion.set({ 'cha-1': initial })
    const { tempEmotion } = loadAndTrimCharEmotion('cha-1')
    expect(tempEmotion).toHaveLength(4)
    expect(tempEmotion[0]).toEqual(['e2', 'e2.png', 200])
  })

  it('mutates the live store array in place (does not call set)', () => {
    const initial: CharEmotionEntry[] = [
      ['e1', 'e1.png', 100],
      ['e2', 'e2.png', 200],
      ['e3', 'e3.png', 300],
      ['e4', 'e4.png', 400],
      ['e5', 'e5.png', 500],
    ]
    CharEmotion.set({ 'cha-1': initial })
    let subscribeCount = 0
    const unsub = CharEmotion.subscribe(() => {
      subscribeCount++
    })
    const before = subscribeCount
    loadAndTrimCharEmotion('cha-1')
    unsub()
    expect(subscribeCount).toBe(before)
    expect(initial).toHaveLength(4)
  })
})

describe('pushCharEmotionEntry', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(1000))
    CharEmotion.set({})
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('pushes a [name, image, Date.now()] tuple onto tempEmotion', () => {
    const tempEmotion: CharEmotionEntry[] = []
    const charemotions = {}
    pushCharEmotionEntry({
      emoTuple: ['happy', 'h.png'],
      tempEmotion,
      charemotions,
      chaId: 'cha-1',
    })
    expect(tempEmotion).toEqual([['happy', 'h.png', 1000]])
  })

  it('assigns tempEmotion onto charemotions[chaId]', () => {
    const tempEmotion: CharEmotionEntry[] = []
    const charemotions: { [k: string]: CharEmotionEntry[] } = {}
    pushCharEmotionEntry({
      emoTuple: ['sad', 's.png'],
      tempEmotion,
      charemotions,
      chaId: 'cha-7',
    })
    expect(charemotions['cha-7']).toBe(tempEmotion)
  })

  it('propagates the update via CharEmotion.set so subscribers fire', () => {
    let lastValue: unknown = null
    const unsub = CharEmotion.subscribe((v) => {
      lastValue = v
    })
    pushCharEmotionEntry({
      emoTuple: ['happy', 'h.png'],
      tempEmotion: [],
      charemotions: {},
      chaId: 'cha-1',
    })
    unsub()
    expect(lastValue).toEqual({ 'cha-1': [['happy', 'h.png', 1000]] })
    expect(get(CharEmotion)).toEqual({ 'cha-1': [['happy', 'h.png', 1000]] })
  })

  it('appends rather than replacing when tempEmotion already has entries', () => {
    const tempEmotion: CharEmotionEntry[] = [['prior', 'p.png', 500]]
    pushCharEmotionEntry({
      emoTuple: ['happy', 'h.png'],
      tempEmotion,
      charemotions: { 'cha-1': tempEmotion },
      chaId: 'cha-1',
    })
    expect(tempEmotion).toEqual([
      ['prior', 'p.png', 500],
      ['happy', 'h.png', 1000],
    ])
  })
})
