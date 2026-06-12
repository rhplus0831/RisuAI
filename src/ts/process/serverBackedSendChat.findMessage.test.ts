import { describe, expect, it, vi } from 'vitest'

// Terminal assistant lookup scans newest-to-oldest without copying the transcript.

vi.mock('../platform', async (importActual) => {
  const actual = await importActual<typeof import('../platform')>()
  return { ...actual, isFastifyServer: true }
})

vi.mock('../storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'findmessage-token',
}))

import { findGeneratedAssistantMessage } from './serverBackedSendChat'
import type { Chat, Message } from '../storage/database.svelte'

function chatWith(messages: Partial<Message>[]): Chat {
  return { id: 'chat-1', message: messages as Message[] } as unknown as Chat
}

function trapIterator(chat: Chat): void {
  Object.defineProperty(chat.message, Symbol.iterator, {
    value: () => {
      throw new Error('transcript copied: the lookup must scan in place (L39)')
    },
  })
}

describe('terminal assistant-message lookup (L39)', () => {
  it('L39: resolves the message by chatId without copying the transcript', () => {
    const chat = chatWith([
      { role: 'user', data: 'one', chatId: 'm-1' },
      { role: 'char', data: 'two', chatId: 'gen-1' },
    ])
    trapIterator(chat)

    const found = findGeneratedAssistantMessage(chat, 'gen-1')
    expect(found?.data).toBe('two')
  })

  it('L39: falls back to the newest generationInfo match, scanning in place', () => {
    const chat = chatWith([
      { role: 'char', data: 'old', generationInfo: { generationId: 'gen-2' } },
      { role: 'user', data: 'middle' },
      { role: 'char', data: 'newest', generationInfo: { generationId: 'gen-2' } },
    ])
    trapIterator(chat)

    // Newest-to-oldest: the LAST matching assistant message wins, exactly like
    // the former reversed-copy `.find`.
    const found = findGeneratedAssistantMessage(chat, 'gen-2')
    expect(found?.data).toBe('newest')
  })

  it('L39: returns undefined when nothing matches, still without copying', () => {
    const chat = chatWith([
      { role: 'user', data: 'one', chatId: 'm-1' },
      { role: 'char', data: 'two', chatId: 'm-2' },
    ])
    trapIterator(chat)

    expect(findGeneratedAssistantMessage(chat, 'missing')).toBeUndefined()
  })
})
