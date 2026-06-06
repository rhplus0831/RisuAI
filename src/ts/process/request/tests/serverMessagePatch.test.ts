import { describe, expect, it, vi } from 'vitest'
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
  it('preserves append single-message detach while normalizing an already-local user append', () => {
    const serverMessage = {
      role: 'user',
      data: 'hi',
      chatId: 'server-id',
      time: 1,
      generationInfo: { model: 'server-model' },
    } satisfies Chat['message'][number]
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
            message: serverMessage,
          },
        ],
      }),
    )

    expect(chat.message).toEqual([
      {
        role: 'user',
        data: 'hi',
        chatId: 'server-id',
        time: 1,
        generationInfo: { model: 'server-model' },
      },
    ])
    expect(chat.message[0]).not.toBe(serverMessage)
    expect(chat.message[0].generationInfo).not.toBe(serverMessage.generationInfo)

    serverMessage.data = 'mutated after apply'
    serverMessage.generationInfo = { model: 'mutated model' }
    expect(chat.message[0]).toEqual({
      role: 'user',
      data: 'hi',
      chatId: 'server-id',
      time: 1,
      generationInfo: { model: 'server-model' },
    })
  })

  it('M7: replace_all applies a byte-identical transcript with zero structuredClone calls', () => {
    const replacementMessages = [
      {
        role: 'user',
        data: 'edited',
        chatId: 'server-user',
        time: 10,
        name: 'Tester',
        otherUser: true,
      },
      {
        role: 'char',
        data: 'inserted',
        saying: 'spoken',
        chatId: 'server-char',
        time: 11,
        name: 'Character',
        generationInfo: {
          model: 'server-model',
          generationId: 'generation-1',
          inputTokens: 12,
          outputTokens: 4,
          maxContext: 4096,
          stageTiming: { stage1: 1, stage2: 2 },
        },
        promptInfo: {
          promptName: 'preset',
          promptToggles: [{ key: 'toggle', value: 'on' }],
          promptText: [{ role: 'assistant', content: 'prompt row' }],
        },
        disabled: 'allBefore',
        isComment: true,
      },
    ] satisfies Chat['message']
    const expectedTranscript = JSON.stringify(replacementMessages)
    const chat = {
      message: [{ role: 'user', data: 'before', chatId: 'old-id' }],
      note: 'preserve note',
      name: 'preserve name',
      localLore: [],
      scriptstate: { $old: '1' },
    } satisfies Chat

    const structuredCloneSpy = vi.spyOn(globalThis, 'structuredClone')
    try {
      applyServerMessagePatch(
        chat,
        patch({
          messageMutations: [
            {
              type: 'replace_all',
              source: 'start_trigger',
              beforeLength: 1,
              afterLength: replacementMessages.length,
              messages: replacementMessages,
            },
          ],
        }),
      )

      expect(structuredCloneSpy).toHaveBeenCalledTimes(0)
    } finally {
      structuredCloneSpy.mockRestore()
    }

    expect(chat.message).toEqual(replacementMessages)
    expect(JSON.stringify(chat.message)).toBe(expectedTranscript)
    expect(chat.note).toBe('preserve note')
    expect(chat.name).toBe('preserve name')
    expect(chat.scriptstate).toEqual({ $old: '1' })
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
