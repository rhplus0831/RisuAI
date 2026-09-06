import { describe, expect, it } from 'vitest'

import { planImportedChatRequests, type PlannedChatImportRequest } from './chatImportPlanning'

interface TestMessage {
  chatId?: string
  data: string
}

interface TestChat {
  id: string
  name: string
  message: TestMessage[]
}

const characterId = 'character / one'
const chatId = 'chat / one'

function payloadByteLength(request: PlannedChatImportRequest<TestChat, TestMessage>): number {
  const intent = {
    version: 1,
    requests: [{ method: request.method, path: request.path, body: request.body }],
  }
  return new TextEncoder().encode(JSON.stringify({ intent })).byteLength
}

function plan(input: {
  messages: TestMessage[]
  maxPayloadBytes: number
  fullChat?: TestChat
  metadataChat?: TestChat
  measure?: typeof payloadByteLength
}) {
  const fullChat = input.fullChat ?? { id: chatId, name: 'Imported', message: input.messages }
  return planImportedChatRequests({
    characterId,
    chatId,
    fullChat,
    metadataChat: input.metadataChat ?? { ...fullChat, message: [] },
    messages: input.messages,
    select: false,
    maxPayloadBytes: input.maxPayloadBytes,
    payloadByteLength: input.measure ?? payloadByteLength,
  })
}

describe('imported chat request planning', () => {
  it('keeps a full create at the exact payload boundary', () => {
    const messages = [{ chatId: 'message-a', data: 'hello' }]
    const fullRequest = {
      method: 'POST' as const,
      path: '/characters/character%20%2F%20one/chats',
      body: { chat: { id: chatId, name: 'Imported', message: messages }, select: false },
    }
    const result = plan({ messages, maxPayloadBytes: payloadByteLength(fullRequest) })

    expect(result).toEqual({ create: fullRequest, tails: [] })
  })

  it('greedily chunks an oversized transcript with stable anchors and prefix lengths', () => {
    const messages = [
      { chatId: 'message-a', data: 'a' },
      { chatId: 'message-b', data: 'b' },
      { chatId: 'message-c', data: 'c' },
    ]
    const measure = (request: PlannedChatImportRequest<TestChat, TestMessage>) => {
      if ('chat' in request.body) return request.body.chat.message.length === 0 ? 1 : 100
      return request.body.messages.length * 4
    }
    const result = plan({ messages, maxPayloadBytes: 8, measure })

    expect(result).toEqual({
      create: {
        method: 'POST',
        path: '/characters/character%20%2F%20one/chats',
        body: { chat: { id: chatId, name: 'Imported', message: [] }, select: false },
      },
      tails: [
        {
          method: 'POST',
          path: '/chats/chat%20%2F%20one/messages/tail',
          body: { afterMessageId: null, messages: messages.slice(0, 2) },
          acceptedPrefixLength: 0,
        },
        {
          method: 'POST',
          path: '/chats/chat%20%2F%20one/messages/tail',
          body: { afterMessageId: 'message-b', messages: messages.slice(2) },
          acceptedPrefixLength: 2,
        },
      ],
    })
  })

  it('uses UTF-8 envelope bytes when choosing the full-create boundary', () => {
    const ascii = [{ chatId: 'message-a', data: 'aa' }]
    const unicode = [{ chatId: 'message-a', data: '한글' }]
    const fullRequest = (messages: TestMessage[]) => ({
      method: 'POST' as const,
      path: '/characters/character%20%2F%20one/chats',
      body: { chat: { id: chatId, name: 'Imported', message: messages }, select: false },
    })
    const maxPayloadBytes = payloadByteLength(fullRequest(ascii))

    expect(plan({ messages: ascii, maxPayloadBytes })?.tails).toEqual([])
    expect(plan({ messages: unicode, maxPayloadBytes })?.tails).toHaveLength(1)
  })

  it('rejects metadata or a single message that cannot fit', () => {
    const messages = [{ chatId: 'message-a', data: 'oversized' }]
    const metadataTooLarge = (request: PlannedChatImportRequest<TestChat, TestMessage>) =>
      'chat' in request.body && request.body.chat.message.length === 0 ? 101 : 102
    const messageTooLarge = (request: PlannedChatImportRequest<TestChat, TestMessage>) =>
      'chat' in request.body ? (request.body.chat.message.length === 0 ? 1 : 102) : 101

    expect(plan({ messages, maxPayloadBytes: 100, measure: metadataTooLarge })).toBeNull()
    expect(plan({ messages, maxPayloadBytes: 100, measure: messageTooLarge })).toBeNull()
  })

  it('rejects a missing anchor only when another tail needs it', () => {
    const messages = [{ data: 'first' }, { chatId: 'message-b', data: 'second' }]
    const measure = (request: PlannedChatImportRequest<TestChat, TestMessage>) => {
      if ('chat' in request.body) return request.body.chat.message.length === 0 ? 1 : 100
      return request.body.messages.length * 10
    }

    expect(plan({ messages, maxPayloadBytes: 10, measure })).toBeNull()
    expect(plan({ messages: messages.slice(0, 1), maxPayloadBytes: 10, measure })?.tails).toHaveLength(1)
  })

  it('rejects an oversized message-free create instead of producing an empty chunk plan', () => {
    const fullChat = { id: chatId, name: 'x'.repeat(100), message: [] }
    expect(plan({ messages: [], fullChat, maxPayloadBytes: 1 })).toBeNull()
  })
})
