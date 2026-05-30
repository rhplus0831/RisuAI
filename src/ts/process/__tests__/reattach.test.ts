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
    DBState: { db: {} as Record<string, unknown> },
    selectedCharID: makeStore(-1),
    doingChat: makeStore(false),
    sendChat: vi.fn(async () => true),
  }
})

vi.mock('../../stores.svelte', () => ({
  DBState: h.DBState,
  selectedCharID: h.selectedCharID,
}))

vi.mock('../index.svelte', () => ({
  sendChat: h.sendChat,
  doingChat: h.doingChat,
}))

import {
  activeGenerationJobs,
  maybeReattachOpenChatGeneration,
  setActiveGenerationJobs,
} from '../reattach'

function openChat(chatId: string): void {
  h.DBState.db = {
    characters: [{ chaId: 'char-a', chatPage: 0, chats: [{ id: chatId, message: [] }] }],
  }
  h.selectedCharID.set(0)
}

beforeEach(() => {
  h.DBState.db = { characters: [] }
  h.selectedCharID.set(-1)
  h.sendChat.mockClear()
  h.doingChat.set(false)
  activeGenerationJobs.set([])
})

describe('reattach open-chat generation (Phase 7)', () => {
  it('reattaches the open chat and consumes the job', async () => {
    openChat('chat-1')
    setActiveGenerationJobs([{ chatId: 'chat-1', jobId: 'job-1' }])

    await maybeReattachOpenChatGeneration()

    expect(h.sendChat).toHaveBeenCalledWith(-1, { reattachJobId: 'job-1' })
    expect(get(activeGenerationJobs)).toEqual([])
  })

  it('does nothing when no job matches the open chat', async () => {
    openChat('chat-1')
    setActiveGenerationJobs([{ chatId: 'chat-other', jobId: 'job-x' }])

    await maybeReattachOpenChatGeneration()

    expect(h.sendChat).not.toHaveBeenCalled()
    expect(get(activeGenerationJobs)).toEqual([{ chatId: 'chat-other', jobId: 'job-x' }])
  })

  it('does nothing (and keeps the job) while a generation is already in flight', async () => {
    openChat('chat-1')
    setActiveGenerationJobs([{ chatId: 'chat-1', jobId: 'job-1' }])
    h.doingChat.set(true)

    await maybeReattachOpenChatGeneration()

    expect(h.sendChat).not.toHaveBeenCalled()
    expect(get(activeGenerationJobs)).toEqual([{ chatId: 'chat-1', jobId: 'job-1' }])
  })

  it('does nothing when no chat is open', async () => {
    setActiveGenerationJobs([{ chatId: 'chat-1', jobId: 'job-1' }])

    await maybeReattachOpenChatGeneration()

    expect(h.sendChat).not.toHaveBeenCalled()
  })
})
