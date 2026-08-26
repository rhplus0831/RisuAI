import { describe, expect, it, vi } from 'vitest'
import type { character, Chat, Message } from '../../../storage/database.svelte'
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
  it('treats an authoritative transcript replay as a semantic no-op', () => {
    const user = { role: 'user', data: 'hello', chatId: 'user-1' } as const
    const assistant = {
      role: 'char',
      data: 'persisted reply',
      chatId: 'generation-1',
      generationInfo: { generationId: 'generation-1' },
    } as const
    const chat = {
      message: [user, assistant],
      note: '',
      name: '',
      localLore: [],
      scriptstate: { $score: '1' },
    } as Chat
    const messagesBefore = chat.message
    const userBefore = chat.message[0]
    const assistantBefore = chat.message[1]
    const scriptstateBefore = chat.scriptstate

    applyServerMessagePatch(
      chat,
      patch({
        messageMutations: [
          {
            type: 'replace_all',
            source: 'output_trigger',
            beforeLength: 1,
            afterLength: 2,
            firstChangedIndex: 1,
            messages: [structuredClone(assistant)],
          },
        ],
        chatVarMutations: [{ key: '$score', before: '0', after: '1' }],
      }),
    )

    expect(chat.message).toBe(messagesBefore)
    expect(chat.message[0]).toBe(userBefore)
    expect(chat.message[1]).toBe(assistantBefore)
    expect(chat.scriptstate).toBe(scriptstateBefore)
  })

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
    const appliedMessage = chat.message[0] as Message
    expect(appliedMessage.generationInfo).not.toBe(serverMessage.generationInfo)

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

  it('replace_all applies a byte-identical transcript with zero structuredClone calls', () => {
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

  it('applies @@inject rewrites by message identity after local rows shift', () => {
    const chat = {
      message: [
        { role: 'user', data: 'inserted locally', chatId: 'local-row' },
        { role: 'user', data: 'before inject', chatId: 'inject-row' },
      ],
      note: '',
      name: '',
      localLore: [],
    } satisfies Chat

    applyServerMessagePatch(
      chat,
      patch({
        messageMutations: [
          {
            type: 'replace_by_id',
            source: 'history_inject',
            messageId: 'inject-row',
            before: { role: 'user', data: 'before inject', chatId: 'inject-row' },
            message: { role: 'user', data: 'expanded before inject', chatId: 'inject-row' },
          },
        ],
      }),
    )

    expect(chat.message).toEqual([
      { role: 'user', data: 'inserted locally', chatId: 'local-row' },
      { role: 'user', data: 'expanded before inject', chatId: 'inject-row' },
    ])
  })

  it('applies the persisted memory cutoff to the live chat projection', () => {
    const chat = {
      message: [{ role: 'user', data: 'first', chatId: 'message-1' }],
      note: '',
      name: '',
      localLore: [],
      lastMemory: 'old-message',
    } satisfies Chat

    applyServerMessagePatch(
      chat,
      patch({
        chatMetadataMutations: [{ key: 'lastMemory', before: 'old-message', after: 'message-1' }],
      }),
    )

    expect(chat.lastMemory).toBe('message-1')
  })

  it('applies trusted terminal character and local-lore mutations only to fresh targets', () => {
    const character = { name: 'Tess', desc: 'old description' } as character
    const chat = {
      message: [],
      note: '',
      name: '',
      localLore: [{ id: 'lore-a', comment: 'note', content: 'old' }],
    } as Chat
    const terminalPatch = patch({
      characterFieldMutations: [
        { key: 'name', before: 'Tess', after: 'Output Tess' },
        { key: 'desc', before: 'old description', after: 'new description' },
      ],
      localLoreMutation: {
        before: [{ id: 'lore-a', comment: 'note', content: 'old' }],
        after: [{ id: 'lore-a', comment: 'note', content: 'scripted' }],
      },
    })

    applyServerMessagePatch(chat, terminalPatch, character)

    expect(character).toMatchObject({ name: 'Output Tess', desc: 'new description' })
    expect(chat.localLore).toEqual([{ id: 'lore-a', comment: 'note', content: 'scripted' }])

    character.desc = 'newer user description'
    chat.localLore = [{ id: 'user-lore', comment: 'user note', content: 'newer' }] as Chat['localLore']
    applyServerMessagePatch(chat, terminalPatch, character)
    expect(character.desc).toBe('newer user description')
    expect(chat.localLore).toEqual([{ id: 'user-lore', comment: 'user note', content: 'newer' }])
  })

  it('applies compact replace-all suffix mutations from firstChangedIndex', () => {
    const chat = {
      message: [
        { role: 'user', data: 'keep', chatId: 'm0' },
        { role: 'char', data: 'old', chatId: 'm1' },
        { role: 'user', data: 'old tail', chatId: 'm2' },
      ],
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
            type: 'replace_all',
            source: 'editinput',
            beforeLength: 3,
            afterLength: 2,
            firstChangedIndex: 1,
            messages: [{ role: 'char', data: 'new', chatId: 'm1-new' }],
          },
        ],
      }),
    )

    expect(chat.message).toEqual([
      { role: 'user', data: 'keep', chatId: 'm0' },
      { role: 'char', data: 'new', chatId: 'm1-new' },
    ])
  })
})
