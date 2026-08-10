import { get } from 'svelte/store'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActiveChatTarget, ChatMutationFinalOutcome } from '../chatCommands'

const coordinatorMocks = vi.hoisted(() => ({
  clearController: vi.fn(),
  controller: new AbortController(),
  createController: vi.fn(),
  refreshActiveGenerationJobsFromBootstrap: vi.fn(),
  sendChat: vi.fn(),
  sleep: vi.fn(),
}))

vi.mock('../util', () => ({
  sleep: coordinatorMocks.sleep,
}))

vi.mock('./index.svelte', () => ({
  clearActiveGenerationAbortController: coordinatorMocks.clearController,
  createActiveGenerationAbortController: coordinatorMocks.createController,
  sendChat: coordinatorMocks.sendChat,
}))

vi.mock('./reattach', () => ({
  refreshActiveGenerationJobsFromBootstrap: coordinatorMocks.refreshActiveGenerationJobsFromBootstrap,
}))

import {
  acceptedSendRecoveries,
  coordinateAcceptedChatSend,
  resetAcceptedSendCoordinatorForTests,
  retryAcceptedChatSend,
} from './acceptedSendCoordinator.svelte'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

function target(): ActiveChatTarget {
  return {
    selectedCharID: 0,
    chatPage: 0,
    characterId: 'character-a',
    chatId: 'chat-a',
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  coordinatorMocks.controller = new AbortController()
  coordinatorMocks.createController.mockReturnValue(coordinatorMocks.controller)
  coordinatorMocks.sendChat.mockResolvedValue(true)
  coordinatorMocks.refreshActiveGenerationJobsFromBootstrap.mockResolvedValue(undefined)
  coordinatorMocks.sleep.mockResolvedValue(undefined)
  resetAcceptedSendCoordinatorForTests()
})

describe('accepted send coordinator', () => {
  it('starts one captured-target generation after a queued append is accepted', async () => {
    const settlement = deferred<ChatMutationFinalOutcome>()
    const onAppendAccepted = vi.fn()
    const input = {
      target: target(),
      append: {
        status: 'queued' as const,
        messageId: 'message-a',
        settlement: settlement.promise,
      },
      onAppendAccepted,
    }

    const first = coordinateAcceptedChatSend(input)
    const duplicate = coordinateAcceptedChatSend(input)

    expect(duplicate).toBe(first)
    expect(coordinatorMocks.sendChat).not.toHaveBeenCalled()
    settlement.resolve({ status: 'accepted' })

    await expect(first).resolves.toEqual({ status: 'generated' })
    expect(onAppendAccepted).toHaveBeenCalledTimes(1)
    expect(coordinatorMocks.sleep).toHaveBeenCalledTimes(1)
    expect(coordinatorMocks.sendChat).toHaveBeenCalledTimes(1)
    expect(coordinatorMocks.sendChat).toHaveBeenCalledWith(
      -1,
      expect.objectContaining({
        signal: coordinatorMocks.controller.signal,
        expectedTarget: target(),
      }),
    )
  })

  it('does not generate when a queued append finally fails', async () => {
    const settlement = deferred<ChatMutationFinalOutcome>()
    const onAppendFailed = vi.fn()
    const operation = coordinateAcceptedChatSend({
      target: target(),
      append: {
        status: 'queued',
        messageId: 'message-a',
        settlement: settlement.promise,
      },
      onAppendFailed,
    })

    const failure = { status: 'failed' as const, result: { status: 'unavailable' as const } }
    settlement.resolve(failure)

    await expect(operation).resolves.toEqual({ status: 'append_failed' })
    expect(onAppendFailed).toHaveBeenCalledWith(failure)
    expect(coordinatorMocks.sendChat).not.toHaveBeenCalled()
    expect(get(acceptedSendRecoveries)).toEqual([])
  })

  it('records a target-keyed failure and retries generation without appending', async () => {
    coordinatorMocks.sendChat.mockResolvedValueOnce(false).mockResolvedValueOnce(true)

    await expect(
      coordinateAcceptedChatSend({
        target: target(),
        append: { status: 'ok', messageId: 'message-a' },
      }),
    ).resolves.toEqual({ status: 'generation_failed', cause: 'generation_failed' })

    const [recovery] = get(acceptedSendRecoveries)
    expect(recovery).toMatchObject({
      target: target(),
      messageId: 'message-a',
      cause: 'generation_failed',
      retrying: false,
    })
    expect(coordinatorMocks.refreshActiveGenerationJobsFromBootstrap).not.toHaveBeenCalled()

    await expect(retryAcceptedChatSend(recovery.id)).resolves.toBe(true)
    expect(coordinatorMocks.sendChat).toHaveBeenCalledTimes(2)
    expect(coordinatorMocks.sendChat).toHaveBeenLastCalledWith(
      -1,
      expect.objectContaining({ expectedTarget: target() }),
    )
    expect(get(acceptedSendRecoveries)).toEqual([])
  })

  it('keeps a generation-in-progress recovery through a rejected retry and refreshes remote jobs', async () => {
    const rejectForRunningGeneration = async (_index: number, args: unknown): Promise<boolean> => {
      const onFailure = (args as { onFailure?: (failure: { cause: 'generation_in_progress' }) => void }).onFailure
      onFailure?.({ cause: 'generation_in_progress' })
      return false
    }
    coordinatorMocks.sendChat
      .mockImplementationOnce(rejectForRunningGeneration)
      .mockImplementationOnce(rejectForRunningGeneration)
      .mockResolvedValueOnce(true)

    await expect(
      coordinateAcceptedChatSend({
        target: target(),
        append: { status: 'ok', messageId: 'message-a' },
      }),
    ).resolves.toEqual({ status: 'generation_failed', cause: 'generation_in_progress' })

    const [recovery] = get(acceptedSendRecoveries)
    expect(recovery).toMatchObject({
      target: target(),
      messageId: 'message-a',
      cause: 'generation_in_progress',
      retrying: false,
    })
    expect(coordinatorMocks.refreshActiveGenerationJobsFromBootstrap).toHaveBeenCalledTimes(1)

    await expect(retryAcceptedChatSend(recovery.id)).resolves.toBe(false)
    expect(get(acceptedSendRecoveries)).toEqual([
      expect.objectContaining({ id: recovery.id, cause: 'generation_in_progress', retrying: false }),
    ])
    expect(coordinatorMocks.refreshActiveGenerationJobsFromBootstrap).toHaveBeenCalledTimes(2)
    expect(coordinatorMocks.sendChat).toHaveBeenCalledTimes(2)

    await expect(retryAcceptedChatSend(recovery.id)).resolves.toBe(true)
    expect(coordinatorMocks.sendChat).toHaveBeenCalledTimes(3)
    expect(get(acceptedSendRecoveries)).toEqual([])
  })
})
