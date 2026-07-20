import { describe, expect, it } from 'vitest'
import type { Message } from 'src/ts/storage/database.svelte'
import { newlyAppendedMessageIds } from './newMessageTranslationEligibility'

const message = (chatId: string): Message => ({ chatId, role: 'char', data: chatId })

describe('newlyAppendedMessageIds', () => {
  it('does not mark pre-existing history when a chat becomes active', () => {
    expect(
      newlyAppendedMessageIds({
        previousChatId: null,
        currentChatId: 'chat-a',
        previousMessageIds: [],
        messages: [message('old-a'), message('old-b')],
        autoTranslate: true,
      }),
    ).toEqual([])
  })

  it('marks only the appended tail while the same auto-translate chat stays active', () => {
    expect(
      newlyAppendedMessageIds({
        previousChatId: 'chat-a',
        currentChatId: 'chat-a',
        previousMessageIds: ['old-a', 'old-b'],
        messages: [message('old-a'), message('old-b'), message('new-user'), message('new-bot')],
        autoTranslate: true,
      }),
    ).toEqual(['new-user', 'new-bot'])
  })

  it('does not mark appends while auto-translate is off or after an owner switch', () => {
    const messages = [message('old-a'), message('new-a')]
    expect(
      newlyAppendedMessageIds({
        previousChatId: 'chat-a',
        currentChatId: 'chat-a',
        previousMessageIds: ['old-a'],
        messages,
        autoTranslate: false,
      }),
    ).toEqual([])
    expect(
      newlyAppendedMessageIds({
        previousChatId: 'chat-a',
        currentChatId: 'chat-b',
        previousMessageIds: ['old-a'],
        messages,
        autoTranslate: true,
      }),
    ).toEqual([])
  })

  it('does not mistake prepended or replaced history for a new append', () => {
    expect(
      newlyAppendedMessageIds({
        previousChatId: 'chat-a',
        currentChatId: 'chat-a',
        previousMessageIds: ['old-a'],
        messages: [message('hydrated-before'), message('old-a')],
        autoTranslate: true,
      }),
    ).toEqual([])
    expect(
      newlyAppendedMessageIds({
        previousChatId: 'chat-a',
        currentChatId: 'chat-a',
        previousMessageIds: ['old-a'],
        messages: [message('replacement'), message('new-a')],
        autoTranslate: true,
      }),
    ).toEqual([])
  })
})
