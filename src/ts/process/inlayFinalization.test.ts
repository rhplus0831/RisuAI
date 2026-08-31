import { beforeEach, describe, expect, it, vi } from 'vitest'

const commandMocks = vi.hoisted(() => ({
  baseRevisions: [17, 18],
  calls: [] as Array<Record<string, unknown>>,
  results: [] as Array<Record<string, unknown>>,
}))

vi.mock('../server/resourceState.svelte', () => ({
  captureChatBodyProjectionEpoch: () => 23,
}))

vi.mock('../server/chatTranscriptOwner', () => ({
  getChatTranscriptOwnerState: () => ({
    characterId: 'character-a',
    chatId: 'chat-a',
    messages: [
      {
        role: 'char',
        data: 'authoritative model text',
        chatId: 'message-a',
        generationInfo: { generationId: 'generation-a' },
      },
    ],
    projectionEpoch: 23,
    resourceLoaded: true,
  }),
}))

vi.mock('../server/commands', () => ({
  runServerCommand: async (input: { command: (baseRevision: number) => Promise<unknown> }) => {
    const revision = commandMocks.baseRevisions.shift() ?? 99
    return input.command(revision)
  },
  updateMessageCommand: async (input: Record<string, unknown>) => {
    commandMocks.calls.push(input)
    return commandMocks.results.shift() ?? { status: 'ok', revision: 18, event: {} }
  },
}))

import { finalizeServerBackedInlayMessage } from './inlayFinalization'

beforeEach(() => {
  commandMocks.baseRevisions = [17, 18]
  commandMocks.calls = []
  commandMocks.results = []
})

describe('finalizeServerBackedInlayMessage', () => {
  it('sends an owner- and generation-scoped compare-and-set message patch', async () => {
    await expect(
      finalizeServerBackedInlayMessage({
        chatId: 'chat-a',
        messageId: 'message-a',
        generationId: 'generation-a',
        expectedData: '<ImgGen="cat">',
        finalData: '{{inlay::asset-a}}',
      }),
    ).resolves.toBe(true)

    expect(commandMocks.calls).toEqual([
      {
        baseRevision: 17,
        messageId: 'message-a',
        patch: { data: '{{inlay::asset-a}}' },
        expectedData: '<ImgGen="cat">',
        expectedChatId: 'chat-a',
        expectedGenerationId: 'generation-a',
        optimisticChatId: 'chat-a',
        optimisticChatBodyProjectionEpoch: 23,
      },
    ])
  })

  it('retries one unrelated global revision conflict while retaining the same compare-and-set conditions', async () => {
    commandMocks.results = [
      { status: 'conflict', currentRevision: 17 },
      { status: 'ok', revision: 18, event: {} },
    ]

    await expect(
      finalizeServerBackedInlayMessage({
        chatId: 'chat-a',
        messageId: 'message-a',
        generationId: 'generation-a',
        expectedData: 'authoritative model text',
        finalData: '{{emotion::happy}}',
      }),
    ).resolves.toBe(true)

    expect(commandMocks.calls.map(({ baseRevision }) => baseRevision)).toEqual([17, 18])
    expect(commandMocks.calls[1]).toMatchObject({
      expectedData: 'authoritative model text',
      expectedChatId: 'chat-a',
      expectedGenerationId: 'generation-a',
    })
  })
})
