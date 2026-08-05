import { beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import {
  beginHalfStreamingProgress,
  clearHalfStreamingProgress,
  halfStreamingProgress,
  recordHalfStreamingToken,
} from './halfStreamingProgress'

const target = {
  characterId: 'char-1',
  chatId: 'chat-1',
  generationId: 'generation-1',
}

describe('halfStreamingProgress', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(1_000))
    halfStreamingProgress.set(null)
  })

  it('reports token-frame throughput from the first received token', () => {
    beginHalfStreamingProgress(target)
    recordHalfStreamingToken(target)
    expect(get(halfStreamingProgress)).toMatchObject({ generatedTokens: 1, tokensPerSecond: 0 })

    vi.setSystemTime(new Date(1_100))
    recordHalfStreamingToken(target)
    expect(get(halfStreamingProgress)).toMatchObject({ generatedTokens: 2, tokensPerSecond: 10 })

    vi.setSystemTime(new Date(1_200))
    recordHalfStreamingToken(target)
    expect(get(halfStreamingProgress)).toMatchObject({ generatedTokens: 3, tokensPerSecond: 10 })
  })

  it('does not let an old generation clear a newer generation', () => {
    beginHalfStreamingProgress(target)
    beginHalfStreamingProgress({ ...target, generationId: 'generation-2' })

    clearHalfStreamingProgress(target)

    expect(get(halfStreamingProgress)?.generationId).toBe('generation-2')
  })
})
