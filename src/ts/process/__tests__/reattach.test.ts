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
    sendChat: vi.fn(async () => true),
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
  setActiveGenerationJobs,
  startActiveGenerationReattach,
  stopActiveGenerationReattach,
  triggerOpenChatGenerationReattach,
} from '../reattach'

function openChat(chatId: string): void {
  h.database = {
    characters: [{ chaId: 'char-a', chatPage: 0, chats: [{ id: chatId, message: [] }] }],
  }
  h.selectedCharID.set(0)
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
  activeGenerationJobs.set([])
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

  it('restores a consumed job when reattach fails so a later probe can retry', async () => {
    openChat('chat-1')
    const job = { chatId: 'chat-1', jobId: 'job-1', mode: 'continue' as const }
    setActiveGenerationJobs([job])
    h.sendChat.mockRejectedValueOnce(new Error('temporary network failure'))

    await maybeReattachOpenChatGeneration()

    expect(get(activeGenerationJobs)).toEqual([job])
    expect(h.clearActiveGenerationAbortController).toHaveBeenCalledTimes(1)
  })

  it('restores a consumed job when sendChat reports a non-throwing transport failure', async () => {
    openChat('chat-1')
    const job = { chatId: 'chat-1', jobId: 'job-1', mode: 'continue' as const }
    setActiveGenerationJobs([job])
    h.sendChat.mockResolvedValueOnce(false)

    await maybeReattachOpenChatGeneration()

    expect(get(activeGenerationJobs)).toEqual([job])
    expect(h.clearActiveGenerationAbortController).toHaveBeenCalledTimes(1)
  })

  it('does not restore a consumed job after an explicit abort', async () => {
    openChat('chat-1')
    setActiveGenerationJobs([{ chatId: 'chat-1', jobId: 'job-1' }])
    h.sendChat.mockImplementationOnce(async () => {
      h.createActiveGenerationAbortController.mock.results.at(-1)?.value.abort()
      return false
    })

    await maybeReattachOpenChatGeneration()

    expect(get(activeGenerationJobs)).toEqual([])
    expect(h.clearActiveGenerationAbortController).toHaveBeenCalledTimes(1)
  })

  it('keeps the job while a generation is in flight and retries when it becomes idle', async () => {
    openChat('chat-1')
    setActiveGenerationJobs([{ chatId: 'chat-1', jobId: 'job-1' }])
    h.doingChat.set(true)

    await maybeReattachOpenChatGeneration()

    expect(h.sendChat).not.toHaveBeenCalled()
    expect(get(activeGenerationJobs)).toEqual([{ chatId: 'chat-1', jobId: 'job-1' }])

    h.doingChat.set(false)
    await vi.waitFor(() => {
      expect(h.sendChat).toHaveBeenCalledWith(-1, expect.objectContaining({ reattachJobId: 'job-1' }))
    })
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

  it('re-arms and reattaches a second live-job chat after the first completes (L30)', async () => {
    // The first chat's reattach streams (sendChat blocked on a gate) while the
    // user switches to a second chat with its own live job. The mid-stream
    // trigger must defer — not drop — and fire once the first settles.
    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    h.sendChat.mockImplementationOnce(async () => {
      await firstGate
      return true
    })

    h.database = {
      characters: [
        { chaId: 'char-a', chatPage: 0, chats: [{ id: 'chat-1', message: [] }] },
        { chaId: 'char-b', chatPage: 0, chats: [{ id: 'chat-2', message: [] }] },
      ],
    }
    h.selectedCharID.set(0)
    setActiveGenerationJobs([
      { chatId: 'chat-1', jobId: 'job-1' },
      { chatId: 'chat-2', jobId: 'job-2' },
    ])

    const first = maybeReattachOpenChatGeneration()
    await vi.waitFor(() => expect(h.sendChat).toHaveBeenCalledTimes(1))

    // Switch to the second chat mid-stream and request a probe: it must not
    // start a second reattach now (one is in flight) and must not be lost.
    h.selectedCharID.set(1)
    triggerOpenChatGenerationReattach()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(h.sendChat).toHaveBeenCalledTimes(1)

    releaseFirst()
    await first

    await vi.waitFor(() => {
      expect(h.sendChat).toHaveBeenCalledWith(-1, expect.objectContaining({ reattachJobId: 'job-2' }))
    })
    expect(get(activeGenerationJobs)).toEqual([])
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
