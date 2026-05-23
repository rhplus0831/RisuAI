import { describe, expect, it } from 'vitest'
import type { Chat } from '../../../storage/database.svelte'
import type { ServerChatMessagePatch } from '../serverChatEvents'
import { applyServerMessagePatch } from '../serverMessagePatch'

function patch(overrides: Partial<ServerChatMessagePatch>): ServerChatMessagePatch {
  return {
    chatId: 'chat-1',
    characterId: 'char-1',
    selectedCharID: 0,
    chatPage: 0,
    varChanged: false,
    messageMutations: [],
    chatVarMutations: [],
    additionalSystemPrompt: [],
    ...overrides,
  }
}

describe('applyServerMessagePatch', () => {
  it('normalizes an already-local user append without duplicating it', () => {
    const chat = {
      message: [{ role: 'user', data: 'hi' }],
      note: '',
      name: '',
      localLore: [],
      scriptstate: {},
    } satisfies Chat

    applyServerMessagePatch(
      chat,
      patch({
        messageMutations: [
          {
            type: 'append',
            source: 'user_message',
            index: 0,
            message: { role: 'user', data: 'hi', chatId: 'server-id', time: 1, name: null },
          },
        ],
      }),
    )

    expect(chat.message).toEqual([
      { role: 'user', data: 'hi', chatId: 'server-id', time: 1, name: null },
    ])
  })

  it('applies replace-all message mutations and chat variable deltas', () => {
    const chat = {
      message: [{ role: 'user', data: 'before' }],
      note: '',
      name: '',
      localLore: [],
      scriptstate: { $old: '1', $remove: 'x' },
    } satisfies Chat

    applyServerMessagePatch(
      chat,
      patch({
        messageMutations: [
          {
            type: 'replace_all',
            source: 'start_trigger',
            beforeLength: 1,
            afterLength: 2,
            messages: [
              { role: 'user', data: 'edited' },
              { role: 'char', data: 'inserted' },
            ],
          },
        ],
        chatVarMutations: [
          { key: '$old', before: '1', after: '2' },
          { key: '$remove', before: 'x', after: null },
        ],
      }),
    )

    expect(chat.message.map((m) => m.data)).toEqual(['edited', 'inserted'])
    expect(chat.scriptstate).toEqual({ $old: '2' })
  })
})
