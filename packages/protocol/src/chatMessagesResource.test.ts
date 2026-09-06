import { describe, expect, it } from 'vitest'
import {
  SERVER_CHAT_MESSAGES_RESOURCE_VERSION,
  isServerBulkChatMessagesResource,
  isServerChatMessagesResource,
} from './chatMessagesResource'

describe('chat messages resource protocol', () => {
  it('accepts full, ranged, suffix, and bulk envelopes', () => {
    expect(SERVER_CHAT_MESSAGES_RESOURCE_VERSION).toBe(1)
    expect(isServerChatMessagesResource({ revision: 2, chatId: 'chat-a', message: [] })).toBe(true)
    expect(
      isServerChatMessagesResource({
        revision: 2,
        chatId: 'chat-a',
        message: [{ role: 'char', data: 'ok', chatId: 'message-a', tool: { name: 'x' } }],
        alternates: [],
        messageStart: 2,
        messageTotal: 4,
      }),
    ).toBe(true)
    expect(
      isServerBulkChatMessagesResource({
        revision: 2,
        chats: [{ chatId: 'chat-a', message: [], alternates: [] }],
        missing: ['chat-b'],
      }),
    ).toBe(true)
  })

  it('rejects empty or duplicate IDs and invalid ranges', () => {
    expect(isServerChatMessagesResource({ revision: 2, chatId: '', message: [], alternates: [] })).toBe(false)
    expect(
      isServerChatMessagesResource({
        revision: 2,
        chatId: 'chat-a',
        message: [],
        alternates: [],
        messageStart: 5,
        messageTotal: 4,
      }),
    ).toBe(false)
    expect(
      isServerBulkChatMessagesResource({
        revision: 2,
        chats: [
          { chatId: 'chat-a', message: [], alternates: [] },
          { chatId: 'chat-a', message: [], alternates: [] },
        ],
        missing: [],
      }),
    ).toBe(false)
    expect(isServerBulkChatMessagesResource({ revision: 2, chats: [], missing: [''] })).toBe(false)
  })
})
