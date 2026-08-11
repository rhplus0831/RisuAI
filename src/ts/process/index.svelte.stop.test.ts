import { beforeEach, describe, expect, it, vi } from 'vitest'

const stopMocks = vi.hoisted(() => ({
  findOperationId: vi.fn(),
  stopOperation: vi.fn(async () => ({ status: 'acknowledged' })),
  target: {
    selectedCharID: 0,
    chatPage: 0,
    characterId: 'character-a',
    chatId: 'chat-a',
  },
}))

vi.mock('../chatCommands', () => ({
  captureActiveChatTarget: () => stopMocks.target,
  isActiveChatTargetFresh: vi.fn(),
  waitForPendingChatGenerationSettingsSave: vi.fn(),
}))

vi.mock('../server/generationOperations', () => ({
  findGenerationOperationIdForTarget: stopMocks.findOperationId,
  stopGenerationOperation: stopMocks.stopOperation,
}))

vi.mock('./inputHookActivity.svelte', () => ({ abortInputHookActivity: vi.fn(() => false) }))

import { abortActiveGeneration } from './generationStop.svelte'
import { beginChatGenerationActivity, resetChatGenerationActivitiesForTests } from './generationActivity.svelte'

beforeEach(() => {
  vi.clearAllMocks()
  stopMocks.findOperationId.mockReturnValue(undefined)
  resetChatGenerationActivitiesForTests()
})

describe('abortActiveGeneration acknowledged Stop routing', () => {
  it('addresses a protocol-v1 activity by operation ID without optimistically aborting its viewer', () => {
    const controller = new AbortController()
    beginChatGenerationActivity({
      target: stopMocks.target,
      kind: 'message',
      controller,
      operationId: '11111111-1111-4111-8111-111111111111',
      acceptedMessageId: '22222222-2222-4222-8222-222222222222',
    })

    abortActiveGeneration()

    expect(stopMocks.stopOperation).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111')
    expect(controller.signal.aborted).toBe(false)
  })

  it('keeps the AbortController fallback for non-protocol generation activity', () => {
    const controller = new AbortController()
    beginChatGenerationActivity({ target: stopMocks.target, kind: 'message', controller })

    abortActiveGeneration()

    expect(stopMocks.stopOperation).not.toHaveBeenCalled()
    expect(controller.signal.aborted).toBe(true)
  })
})
