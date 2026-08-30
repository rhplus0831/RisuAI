import { describe, expect, it } from 'vitest'
import { normalizeChatPageIndex } from './chatPage.js'

describe('normalizeChatPageIndex differential fixtures', () => {
  it.each([
    { value: undefined, chatCount: 3, expected: 0 },
    { value: Number.NaN, chatCount: 3, expected: 0 },
    { value: 1.5, chatCount: 3, expected: 0 },
    { value: '1', chatCount: 3, expected: 0 },
    { value: -2, chatCount: 3, expected: 0 },
    { value: -1, chatCount: 3, expected: -1 },
    { value: 0, chatCount: 3, expected: 0 },
    { value: 1, chatCount: 3, expected: 1 },
    { value: 3, chatCount: 3, expected: 2 },
    { value: 99, chatCount: 3, expected: 2 },
    { value: undefined, chatCount: 0, expected: -1 },
    { value: -2, chatCount: 0, expected: -1 },
    { value: -1, chatCount: 0, expected: -1 },
    { value: 0, chatCount: 0, expected: -1 },
  ])('preserves the browser and Fastify result for $value with $chatCount chats', ({ value, chatCount, expected }) => {
    expect(normalizeChatPageIndex(value, chatCount)).toBe(expected)
  })
})
