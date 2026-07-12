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

  it('refreshes bootstrap active translations so failed detached jobs do not stay busy forever', async () => {
    bootstrapMocks.fetchServerBootstrapReadOnly.mockResolvedValue({
      status: 'ok',
      bootstrap: {
        initialized: true,
        revision: 1,
        activeMessageTranslations: [],
      },
    })

    startActiveMessageTranslationRefresh()
    setActiveMessageTranslations([{ chatId: 'chat-a', messageId: 'msg-a' }])

    await vi.advanceTimersByTimeAsync(5_000)

    expect(bootstrapMocks.fetchServerBootstrapReadOnly).toHaveBeenCalledWith(null, {
      cacheRevision: false,
    })
    expect(get(activeMessageTranslations)).toEqual([])
  })
})
