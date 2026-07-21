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
  beginActiveMessageTranslation,
  clearMessageTranslationJob,
  isCurrentMessageTranslationJob,
  setActiveMessageTranslations,
  startActiveMessageTranslationRefresh,
  stopActiveMessageTranslationRefresh,
} from './messageTranslationJobs'

describe('active message translation refresh', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    stopActiveMessageTranslationRefresh()
    bootstrapMocks.fetchServerBootstrapReadOnly.mockReset()
    setActiveMessageTranslations([])
  })

  afterEach(() => {
    stopActiveMessageTranslationRefresh()
    for (const job of get(activeMessageTranslations)) clearMessageTranslationJob(job.jobId)
    setActiveMessageTranslations([])
    vi.useRealTimers()
  })

  it('publishes a local operation before the request and rejects a second mounted starter', () => {
    expect(
      beginActiveMessageTranslation({
        chatId: 'chat-a',
        messageId: 'msg-a',
        jobId: 'job-a',
        status: 'running',
      }),
    ).toBe(true)
    expect(
      beginActiveMessageTranslation({
        chatId: 'chat-a',
        messageId: 'msg-a',
        jobId: 'job-b',
        status: 'running',
      }),
    ).toBe(false)
    expect(isCurrentMessageTranslationJob('msg-a', 'job-a')).toBe(true)
    expect(isCurrentMessageTranslationJob('msg-a', 'job-b')).toBe(false)
    expect(get(activeMessageTranslations)).toEqual([
      { chatId: 'chat-a', messageId: 'msg-a', jobId: 'job-a', status: 'running' },
    ])

    // A bootstrap refresh racing before server registration must not erase the
    // local ownership entry.
    setActiveMessageTranslations([])
    expect(isCurrentMessageTranslationJob('msg-a', 'job-a')).toBe(true)
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

  it('cancels the pending refresh timer when stopped', async () => {
    startActiveMessageTranslationRefresh()
    setActiveMessageTranslations([{ chatId: 'chat-a', messageId: 'msg-a', jobId: 'job-a', status: 'running' }])

    stopActiveMessageTranslationRefresh()
    await vi.advanceTimersByTimeAsync(5_000)

    expect(bootstrapMocks.fetchServerBootstrapReadOnly).not.toHaveBeenCalled()
  })
})
