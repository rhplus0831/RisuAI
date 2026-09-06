import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CHAT_DISPLAY_TAIL_COUNT,
  MAX_CHAT_DISPLAY_TAIL_COUNT,
  MIN_CHAT_DISPLAY_TAIL_COUNT,
  normalizeChatDisplayTailCount,
} from './chatDisplayTailCount.js'

describe('normalizeChatDisplayTailCount', () => {
  it('preserves the display-tail defaults and bounds', () => {
    expect(DEFAULT_CHAT_DISPLAY_TAIL_COUNT).toBe(30)
    expect(MIN_CHAT_DISPLAY_TAIL_COUNT).toBe(1)
    expect(MAX_CHAT_DISPLAY_TAIL_COUNT).toBe(500)
  })

  it.each([
    [undefined, 30],
    [null, 30],
    [true, 30],
    [[], 30],
    ['', 30],
    ['   ', 30],
    [Number.NaN, 30],
    [Infinity, 30],
    [-Infinity, 30],
    ['invalid', 30],
    [1, 1],
    [30, 30],
    [500, 500],
    ['42', 42],
    [' 42.4 ', 42],
    [42.5, 43],
    [0, 1],
    [-20, 1],
    [500.5, 500],
    [999, 500],
  ])('normalizes %o to the expected value', (input, expected) => {
    expect(normalizeChatDisplayTailCount(input)).toBe(expected)
  })
})
