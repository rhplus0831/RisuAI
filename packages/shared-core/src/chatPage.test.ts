import { describe, expect, it } from 'vitest'
import { normalizeChatPageIndex } from './chatPage.js'

function normalizeBrowserChatPageBeforeExtraction(value: unknown, chatCount: number): number {
  const character = { chatPage: value }
  if (!Number.isInteger(character.chatPage)) {
    character.chatPage = chatCount > 0 ? 0 : -1
  }
  if ((character.chatPage as number) >= chatCount) {
    character.chatPage = chatCount > 0 ? chatCount - 1 : -1
  }
  if ((character.chatPage as number) < -1) {
    character.chatPage = chatCount > 0 ? 0 : -1
  }
  return character.chatPage as number
}

function normalizeFastifyChatPageBeforeExtraction(value: unknown, chatCount: number): number {
  const character = { chatPage: value }
  if (!Number.isInteger(character.chatPage as number)) {
    character.chatPage = chatCount > 0 ? 0 : -1
  }
  if ((character.chatPage as number) >= chatCount) {
    character.chatPage = chatCount > 0 ? chatCount - 1 : -1
  }
  if ((character.chatPage as number) < -1) {
    character.chatPage = chatCount > 0 ? 0 : -1
  }
  return character.chatPage as number
}

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
    const browserResult = normalizeBrowserChatPageBeforeExtraction(value, chatCount)
    const fastifyResult = normalizeFastifyChatPageBeforeExtraction(value, chatCount)

    expect(browserResult).toBe(expected)
    expect(fastifyResult).toBe(expected)
    expect(normalizeChatPageIndex(value, chatCount)).toBe(browserResult)
    expect(normalizeChatPageIndex(value, chatCount)).toBe(fastifyResult)
  })
})
