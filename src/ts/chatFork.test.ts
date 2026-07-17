import { describe, expect, it } from 'vitest'
import type { Chat } from './storage/database.svelte'
import { rekeyClonedChat } from './chatFork'

function idSequence(...ids: string[]): () => string {
  return () => {
    const id = ids.shift()
    if (!id) throw new Error('No test id remains')
    return id
  }
}

describe('rekeyClonedChat', () => {
  it('rewrites retained message references and prunes branch-tail references', () => {
    const chat = {
      id: 'source-chat',
      name: 'Branch',
      message: [
        { chatId: 'message-a', role: 'user', data: 'A' },
        {
          chatId: 'message-b',
          role: 'char',
          data: 'B',
          generationInfo: { generationId: 'message-b' },
        },
      ],
      bookmarks: ['message-a', 'message-tail'],
      bookmarkNames: {
        'message-a': 'Opening',
        'message-tail': 'Removed tail',
      },
      hypaV3Data: {
        summaries: [{ chatMemos: ['message-a', 'message-b', 'message-tail'] }],
      },
    } as Chat

    const messageIdMap = rekeyClonedChat(chat, {
      createId: idSequence('fork-chat', 'fork-message-a', 'fork-message-b'),
    })

    expect(chat.id).toBe('fork-chat')
    expect(messageIdMap).toEqual(
      new Map([
        ['message-a', 'fork-message-a'],
        ['message-b', 'fork-message-b'],
      ]),
    )
    expect(chat.message.map((message) => message.chatId)).toEqual(['fork-message-a', 'fork-message-b'])
    expect(chat.message[1].generationInfo?.generationId).toBe('fork-message-b')
    expect(chat.bookmarks).toEqual(['fork-message-a'])
    expect(chat.bookmarkNames).toEqual({ 'fork-message-a': 'Opening' })
    expect(chat.hypaV3Data?.summaries?.[0]?.chatMemos).toEqual(['fork-message-a', 'fork-message-b'])
  })

  it('can retain unknown legacy references while rekeying an imported chat', () => {
    const chat = {
      id: 'import-chat',
      name: 'Import',
      message: [{ chatId: 'message-a', role: 'user', data: 'A' }],
      bookmarks: ['message-a', 'legacy-missing'],
    } as Chat

    rekeyClonedChat(chat, {
      createId: idSequence('new-chat', 'new-message-a'),
      pruneDanglingReferences: false,
    })

    expect(chat.bookmarks).toEqual(['new-message-a', 'legacy-missing'])
  })
})
