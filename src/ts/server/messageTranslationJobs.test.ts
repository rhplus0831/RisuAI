import { get } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const bootstrapMocks = vi.hoisted(() => ({
  fetchServerBootstrapProjectionReadOnly: vi.fn(),
}))

vi.mock('./bootstrap', () => ({
  fetchServerBootstrapProjectionReadOnly: bootstrapMocks.fetchServerBootstrapProjectionReadOnly,
}))

import {
  activeMessageTranslations,
  setActiveMessageTranslations,
  startActiveMessageTranslationRefresh,
} from './messageTranslationJobs'

describe('active message translation refresh', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    bootstrapMocks.fetchServerBootstrapProjectionReadOnly.mockReset()
    setActiveMessageTranslations([])
  })

  afterEach(() => {
    setActiveMessageTranslations([])
    vi.useRealTimers()
  })

  it('refreshes bootstrap active translations so failed detached jobs do not stay busy forever', async () => {
    bootstrapMocks.fetchServerBootstrapProjectionReadOnly.mockResolvedValue({
      status: 'ok',
      projection: {
        revision: 1,
        database: {},
        activeMessageTranslations: [],
      },
    })

    startActiveMessageTranslationRefresh()
    setActiveMessageTranslations([{ chatId: 'chat-a', messageId: 'msg-a' }])

    await vi.advanceTimersByTimeAsync(5_000)

    expect(bootstrapMocks.fetchServerBootstrapProjectionReadOnly).toHaveBeenCalledWith(null, {
      cacheRevision: false,
    })
    expect(get(activeMessageTranslations)).toEqual([])
  })
})
