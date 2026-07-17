import { get } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const bootstrapMocks = vi.hoisted(() => ({
  fetchServerBootstrapReadOnly: vi.fn(),
}))

vi.mock('./bootstrap', () => ({
  fetchServerBootstrapReadOnly: bootstrapMocks.fetchServerBootstrapReadOnly,
}))

import {
  activeMessageTranslations,
  setActiveMessageTranslations,
  startActiveMessageTranslationRefresh,
} from './messageTranslationJobs'

describe('active message translation refresh', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    bootstrapMocks.fetchServerBootstrapReadOnly.mockReset()
    setActiveMessageTranslations([])
  })

  afterEach(() => {
    setActiveMessageTranslations([])
    vi.useRealTimers()
  })

  it('refreshes bootstrap translations and retains a detached failure for the row', async () => {
    const failedJob = {
      chatId: 'chat-a',
      messageId: 'msg-a',
      jobId: 'job-a',
      status: 'failed' as const,
      error: 'provider rejected the request',
      completedAt: 123,
    }
    bootstrapMocks.fetchServerBootstrapReadOnly.mockResolvedValue({
      status: 'ok',
      bootstrap: {
        initialized: true,
        revision: 1,
        activeMessageTranslations: [failedJob],
      },
    })

    startActiveMessageTranslationRefresh()
    setActiveMessageTranslations([{ chatId: 'chat-a', messageId: 'msg-a', jobId: 'job-a', status: 'running' }])

    await vi.advanceTimersByTimeAsync(5_000)

    expect(bootstrapMocks.fetchServerBootstrapReadOnly).toHaveBeenCalledWith(null, {
      cacheRevision: false,
    })
    expect(get(activeMessageTranslations)).toEqual([failedJob])

    await vi.advanceTimersByTimeAsync(10_000)
    expect(bootstrapMocks.fetchServerBootstrapReadOnly).toHaveBeenCalledTimes(1)
  })
})
