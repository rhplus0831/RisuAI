import { beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'

// vi.hoisted runs before imports, so build minimal svelte-store-contract fakes
// inline rather than importing `writable`.
const h = vi.hoisted(() => {
  function makeStore<T>(initial: T) {
    let value = initial
    const subs = new Set<(value: T) => void>()
    return {
      set(next: T) {
        value = next
        for (const fn of subs) fn(value)
      },
      subscribe(fn: (value: T) => void) {
        subs.add(fn)
        fn(value)
        return () => subs.delete(fn)
      },
    }
  }
  return {
    database: {} as Record<string, unknown>,
    selectedCharID: makeStore(-1),
    doingChat: makeStore(false),
    createActiveGenerationAbortController: vi.fn(() => new AbortController()),
    clearActiveGenerationAbortController: vi.fn(),
    sendChat: vi.fn(
      async (
        _chatProcessIndex: number,
        _args: {
          signal?: AbortSignal
          reattachJobId?: string
          onReattachOutcome?: (outcome: {
            status: 'retryable_transport_failure' | 'terminal_failure' | 'missing_job' | 'aborted' | 'completed'
            error?: string
          }) => void
        },
      ) => true,
    ),
    fetchRuntimeJobs: vi.fn(),
  }
})

vi.mock('../../stores.svelte', () => ({
  selectedCharID: h.selectedCharID,
}))

vi.mock('../../storage/database.svelte', () => ({
  getDatabase: () => h.database,
}))

vi.mock('../../server/bootstrap', () => ({
  fetchServerBootstrapReadOnly: h.fetchRuntimeJobs,
}))

vi.mock('../index.svelte', () => ({
  sendChat: h.sendChat,
  doingChat: h.doingChat,
  createActiveGenerationAbortController: h.createActiveGenerationAbortController,
  clearActiveGenerationAbortController: h.clearActiveGenerationAbortController,
}))

import {
  activeGenerationJobs,
  forgetActiveGenerationJob,
  maybeReattachOpenChatGeneration,
  rememberActiveGenerationJob,
  refreshActiveGenerationJobsFromBootstrap,
  setActiveGenerationJobs,
  startActiveGenerationReattach,
  stopActiveGenerationReattach,
  triggerOpenChatGenerationReattach,
} from '../reattach'
import {
  beginChatGenerationActivity,
  finishChatGenerationActivity,
  resetChatGenerationActivitiesForTests,
} from '../generationActivity.svelte'

function openChat(chatId: string): void {
  h.database = {
    characters: [{ chaId: 'char-a', chatPage: 0, chats: [{ id: chatId, message: [] }] }],
  }
  h.selectedCharID.set(0)
}

function reportReattachOutcome(
  status: 'retryable_transport_failure' | 'terminal_failure' | 'missing_job' | 'completed',
): void {
  h.sendChat.mockImplementationOnce(async (_chatProcessIndex, args) => {
    args.onReattachOutcome?.({ status, error: status === 'completed' ? undefined : `${status} test error` })
    return status === 'completed'
  })
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve()
}

beforeEach(() => {
  h.database = { characters: [] }
  h.selectedCharID.set(-1)
  h.sendChat.mockReset()
  h.sendChat.mockResolvedValue(true)
  h.createActiveGenerationAbortController.mockClear()
  h.clearActiveGenerationAbortController.mockClear()
  h.fetchRuntimeJobs.mockReset()
  h.fetchRuntimeJobs.mockResolvedValue({
    status: 'ok',
    bootstrap: { activeGenerationJobs: [] },
  })
  h.doingChat.set(false)
  setActiveGenerationJobs([])
  resetChatGenerationActivitiesForTests()
})

describe('reattach open-chat generation (Phase 4)', () => {
  it('retains and forgets a job learned from the live response', () => {
    setActiveGenerationJobs([
      { chatId: 'chat-1', jobId: 'job-old' },
      { chatId: 'chat-2', jobId: 'job-other' },
    ])

    rememberActiveGenerationJob({ chatId: 'chat-1', jobId: 'job-new', mode: 'send' })

    expect(get(activeGenerationJobs)).toEqual([
      { chatId: 'chat-1', jobId: 'job-new', mode: 'send' },
      { chatId: 'chat-2', jobId: 'job-other' },
    ])
    forgetActiveGenerationJob('job-new')
    expect(get(activeGenerationJobs)).toEqual([{ chatId: 'chat-2', jobId: 'job-other' }])
  })

  it('reattaches the open chat and consumes the job', async () => {
    openChat('chat-1')
    setActiveGenerationJobs([{ chatId: 'chat-1', jobId: 'job-1' }])

    await maybeReattachOpenChatGeneration()

    expect(h.sendChat).toHaveBeenCalledWith(
      -1,
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        reattachJobId: 'job-1',
        expectedTarget: {
          selectedCharID: 0,
          chatPage: 0,
          characterId: 'char-a',
          chatId: 'chat-1',
        },
      }),
    )
    expect(get(activeGenerationJobs)).toEqual([])
  })

  // continue/regenerate are durable, so a reload can reattach to them; the mode
  // must ride the reattach so the replayed stream renders on the right row.
  it('reattaches a continue job with the continue flag', async () => {
    openChat('chat-1')
    setActiveGenerationJobs([{ chatId: 'chat-1', jobId: 'job-c', mode: 'continue' }])

    await maybeReattachOpenChatGeneration()

    expect(h.sendChat).toHaveBeenCalledWith(
      -1,
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        reattachJobId: 'job-c',
        continue: true,
        regenerateMessageId: undefined,
      }),
    )
  })

  it('reattaches a regenerate job with its target id', async () => {
    openChat('chat-1')
    setActiveGenerationJobs([{ chatId: 'chat-1', jobId: 'job-r', mode: 'regenerate', regenerateMessageId: 'msg-1' }])

    await maybeReattachOpenChatGeneration()

    expect(h.sendChat).toHaveBeenCalledWith(
      -1,
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        reattachJobId: 'job-r',
        continue: undefined,
        regenerateMessageId: 'msg-1',
      }),
    )
  })

  it('does nothing when no job matches the open chat', async () => {
    openChat('chat-1')
    setActiveGenerationJobs([{ chatId: 'chat-other', jobId: 'job-x' }])

    await maybeReattachOpenChatGeneration()

    expect(h.sendChat).not.toHaveBeenCalled()
    expect(get(activeGenerationJobs)).toEqual([{ chatId: 'chat-other', jobId: 'job-x' }])
  })

  it('does not restore a consumed job after an unclassified exception', async () => {
    openChat('chat-1')
    const job = { chatId: 'chat-1', jobId: 'job-1', mode: 'continue' as const }
    setActiveGenerationJobs([job])
    h.sendChat.mockRejectedValueOnce(new Error('temporary network failure'))

    await maybeReattachOpenChatGeneration()

    expect(get(activeGenerationJobs)).toEqual([])
    expect(h.clearActiveGenerationAbortController).toHaveBeenCalledTimes(1)
  })

  it('restores a consumed job after a retryable transport failure', async () => {
    openChat('chat-1')
    const job = { chatId: 'chat-1', jobId: 'job-1', mode: 'continue' as const }
    setActiveGenerationJobs([job])
    reportReattachOutcome('retryable_transport_failure')

    await maybeReattachOpenChatGeneration()
    triggerOpenChatGenerationReattach()
    await flushMicrotasks()

    expect(get(activeGenerationJobs)).toEqual([job])
    expect(h.sendChat).toHaveBeenCalledTimes(1)
    expect(h.clearActiveGenerationAbortController).toHaveBeenCalledTimes(1)
  })

  it('consumes a job after a terminal SSE error without retrying after microtasks settle', async () => {
    openChat('chat-1')
    setActiveGenerationJobs([{ chatId: 'chat-1', jobId: 'job-terminal' }])
    reportReattachOutcome('terminal_failure')

    await maybeReattachOpenChatGeneration()
    triggerOpenChatGenerationReattach()
    await flushMicrotasks()

    expect(h.sendChat).toHaveBeenCalledTimes(1)
    expect(get(activeGenerationJobs)).toEqual([])
  })

  it('consumes an expired 404 job without retrying after microtasks settle', async () => {
    openChat('chat-1')
    setActiveGenerationJobs([{ chatId: 'chat-1', jobId: 'job-missing' }])
    reportReattachOutcome('missing_job')

    await maybeReattachOpenChatGeneration()
    triggerOpenChatGenerationReattach()
    await flushMicrotasks()

    expect(h.sendChat).toHaveBeenCalledTimes(1)
    expect(get(activeGenerationJobs)).toEqual([])
  })

  it('backs off and bounds retries for a repeatedly failing transport', async () => {
    vi.useFakeTimers()
    try {
      openChat('chat-1')
      const job = { chatId: 'chat-1', jobId: 'job-transport' }
      setActiveGenerationJobs([job])
      h.sendChat.mockImplementation(async (_chatProcessIndex, args) => {
        args.onReattachOutcome?.({ status: 'retryable_transport_failure', error: 'offline' })
        return false
      })

      await maybeReattachOpenChatGeneration()
      triggerOpenChatGenerationReattach()
      triggerOpenChatGenerationReattach()
      await flushMicrotasks()

      expect(h.sendChat).toHaveBeenCalledTimes(1)
      expect(get(activeGenerationJobs)).toEqual([job])
      expect(vi.getTimerCount()).toBe(1)

      for (let expectedAttempts = 2; expectedAttempts <= 4; expectedAttempts += 1) {
        await vi.advanceTimersToNextTimerAsync()
        await flushMicrotasks()
        expect(h.sendChat).toHaveBeenCalledTimes(expectedAttempts)
      }

      expect(vi.getTimerCount()).toBe(0)
      triggerOpenChatGenerationReattach()
      triggerOpenChatGenerationReattach()
      await flushMicrotasks()
      expect(h.sendChat).toHaveBeenCalledTimes(4)
      expect(get(activeGenerationJobs)).toEqual([job])
    } finally {
      setActiveGenerationJobs([])
      vi.useRealTimers()
    }
  })

  it('does not restore or retry a consumed job after abort while reattach is pending', async () => {
    openChat('chat-1')
    setActiveGenerationJobs([{ chatId: 'chat-1', jobId: 'job-1' }])
    let settleReattach!: (attached: boolean) => void
    h.sendChat.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          settleReattach = resolve
        }),
    )

    const pending = maybeReattachOpenChatGeneration()
    await vi.waitFor(() => expect(h.sendChat).toHaveBeenCalledTimes(1))

    h.createActiveGenerationAbortController.mock.results.at(-1)?.value.abort()
    settleReattach(false)
    await pending
    triggerOpenChatGenerationReattach()
    await flushMicrotasks()

    expect(h.sendChat).toHaveBeenCalledTimes(1)
    expect(get(activeGenerationJobs)).toEqual([])
    expect(h.clearActiveGenerationAbortController).toHaveBeenCalledTimes(1)
  })

  it('keeps the job while the same chat already has a client generation activity', async () => {
    openChat('chat-1')
    setActiveGenerationJobs([{ chatId: 'chat-1', jobId: 'job-1' }])
    const activity = beginChatGenerationActivity({
      target: { selectedCharID: 0, chatPage: 0, characterId: 'char-a', chatId: 'chat-1' },
      kind: 'message',
    })!

    await maybeReattachOpenChatGeneration()

    expect(h.sendChat).not.toHaveBeenCalled()
    expect(get(activeGenerationJobs)).toEqual([{ chatId: 'chat-1', jobId: 'job-1' }])

    finishChatGenerationActivity(activity.id)
    await maybeReattachOpenChatGeneration()
    expect(h.sendChat).toHaveBeenCalledWith(-1, expect.objectContaining({ reattachJobId: 'job-1' }))
  })

  it('does nothing when no chat is open', async () => {
    setActiveGenerationJobs([{ chatId: 'chat-1', jobId: 'job-1' }])

    await maybeReattachOpenChatGeneration()

    expect(h.sendChat).not.toHaveBeenCalled()
  })

  it('does not start the previous chat job after the active chat switches during runtime loading', async () => {
    h.database = {
      characters: [
        {
          chaId: 'char-a',
          chatPage: 0,
          chats: [
            { id: 'chat-1', message: [] },
            { id: 'chat-2', message: [] },
          ],
        },
      ],
    }
    h.selectedCharID.set(0)
    setActiveGenerationJobs([{ chatId: 'chat-1', jobId: 'job-1' }])

    const reattach = maybeReattachOpenChatGeneration()
    ;(h.database.characters as Array<{ chatPage: number }>)[0].chatPage = 1
    await reattach

    expect(h.sendChat).not.toHaveBeenCalled()
    expect(get(activeGenerationJobs)).toEqual([{ chatId: 'chat-1', jobId: 'job-1' }])
  })

  it('keeps concurrent reattach controllers isolated when Chat A is aborted', async () => {
    const pendingCalls = new Map<
      string,
      {
        signal: AbortSignal
        settle: (attached: boolean) => void
      }
    >()
    h.sendChat.mockImplementation(
      (_chatProcessIndex, args) =>
        new Promise<boolean>((resolve) => {
          pendingCalls.set(args.reattachJobId ?? '', {
            signal: args.signal!,
            settle: resolve,
          })
        }),
    )
    h.database = {
      characters: [
        { chaId: 'char-a', chatPage: 0, chats: [{ id: 'chat-a', message: [] }] },
        { chaId: 'char-b', chatPage: 0, chats: [{ id: 'chat-b', message: [] }] },
      ],
    }
    h.selectedCharID.set(0)
    setActiveGenerationJobs([
      { chatId: 'chat-a', jobId: 'job-a' },
      { chatId: 'chat-b', jobId: 'job-b' },
    ])

    const pendingA = maybeReattachOpenChatGeneration()
    await vi.waitFor(() => expect(pendingCalls.has('job-a')).toBe(true))
    h.selectedCharID.set(1)
    const pendingB = maybeReattachOpenChatGeneration()
    await vi.waitFor(() => expect(pendingCalls.has('job-b')).toBe(true))

    h.createActiveGenerationAbortController.mock.results[0]?.value.abort()

    expect(pendingCalls.get('job-a')?.signal.aborted).toBe(true)
    expect(pendingCalls.get('job-b')?.signal.aborted).toBe(false)
    pendingCalls.get('job-a')?.settle(false)
    pendingCalls.get('job-b')?.settle(true)
    await Promise.all([pendingA, pendingB])

    expect(h.sendChat).toHaveBeenCalledTimes(2)
    expect(get(activeGenerationJobs)).toEqual([])
    expect(h.clearActiveGenerationAbortController).toHaveBeenCalledTimes(2)
  })

  it('reattaches after a queued trigger observes a same-character chat switch', async () => {
    h.database = {
      characters: [
        {
          chaId: 'char-a',
          chatPage: 0,
          chats: [
            { id: 'chat-1', message: [] },
            { id: 'chat-2', message: [] },
          ],
        },
      ],
    }
    h.selectedCharID.set(0)
    setActiveGenerationJobs([{ chatId: 'chat-2', jobId: 'job-2' }])
    ;(h.database.characters as Array<{ chatPage: number }>)[0].chatPage = 1

    triggerOpenChatGenerationReattach()

    await vi.waitFor(() => {
      expect(h.sendChat).toHaveBeenCalledWith(
        -1,
        expect.objectContaining({
          signal: expect.any(AbortSignal),
          reattachJobId: 'job-2',
        }),
      )
    })
    expect(get(activeGenerationJobs)).toEqual([])
  })

  it('does not reattach a terminal job again when generation activity settles', async () => {
    openChat('chat-1')
    setActiveGenerationJobs([{ chatId: 'chat-1', jobId: 'job-terminal' }])
    startActiveGenerationReattach()
    h.sendChat.mockImplementationOnce(async (_chatProcessIndex, args) => {
      const activity = beginChatGenerationActivity({
        target: { selectedCharID: 0, chatPage: 0, characterId: 'char-a', chatId: 'chat-1' },
        kind: 'message',
      })!
      args.onReattachOutcome?.({ status: 'terminal_failure', error: 'terminal SSE error' })
      finishChatGenerationActivity(activity.id)
      return false
    })

    await maybeReattachOpenChatGeneration()
    await flushMicrotasks()

    expect(h.sendChat).toHaveBeenCalledTimes(1)
    expect(get(activeGenerationJobs)).toEqual([])
  })

  it('probes a retained job when the browser network returns', async () => {
    openChat('chat-1')
    startActiveGenerationReattach()
    h.fetchRuntimeJobs.mockResolvedValueOnce({
      status: 'ok',
      bootstrap: { activeGenerationJobs: [{ chatId: 'chat-1', jobId: 'job-online' }] },
    })

    window.dispatchEvent(new Event('online'))

    await vi.waitFor(() => {
      expect(h.fetchRuntimeJobs).toHaveBeenCalledWith(null, { cacheRevision: false })
      expect(h.sendChat).toHaveBeenCalledWith(-1, expect.objectContaining({ reattachJobId: 'job-online' }))
    })
  })

  it('settles and releases a never-ending bootstrap refresh when its authority signal aborts', async () => {
    const controller = new AbortController()
    h.fetchRuntimeJobs.mockReturnValueOnce(new Promise(() => {}))

    const refresh = refreshActiveGenerationJobsFromBootstrap(controller.signal)
    await vi.waitFor(() => {
      expect(h.fetchRuntimeJobs).toHaveBeenCalledWith(controller.signal, { cacheRevision: false })
    })

    controller.abort()
    await expect(refresh).resolves.toBeUndefined()

    h.fetchRuntimeJobs.mockResolvedValueOnce({
      status: 'ok',
      bootstrap: { activeGenerationJobs: [] },
    })
    await expect(refreshActiveGenerationJobsFromBootstrap()).resolves.toBeUndefined()
    expect(h.fetchRuntimeJobs).toHaveBeenCalledTimes(2)
  })

  it('stops lifecycle probes from reconnecting to the server', async () => {
    openChat('chat-1')
    startActiveGenerationReattach()
    stopActiveGenerationReattach()
    h.fetchRuntimeJobs.mockClear()

    window.dispatchEvent(new Event('online'))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(h.fetchRuntimeJobs).not.toHaveBeenCalled()
    expect(h.sendChat).not.toHaveBeenCalled()
  })
})
