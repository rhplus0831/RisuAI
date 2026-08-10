import { beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import {
  beginHalfStreamingProgress,
  clearHalfStreamingProgress,
  halfStreamingProgress,
  recordHalfStreamingToken,
  resetHalfStreamingProgressForTests,
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
    resetHalfStreamingProgressForTests()
  })

  it('reports token-frame throughput from the first received token', () => {
    beginHalfStreamingProgress(target)
    recordHalfStreamingToken(target)
    expect(get(halfStreamingProgress)).toContainEqual(
      expect.objectContaining({ generatedTokens: 1, tokensPerSecond: 0 }),
    )

    vi.setSystemTime(new Date(1_100))
    recordHalfStreamingToken(target)
    expect(get(halfStreamingProgress)).toContainEqual(
      expect.objectContaining({ generatedTokens: 2, tokensPerSecond: 10 }),
    )

    vi.setSystemTime(new Date(1_200))
    recordHalfStreamingToken(target)
    expect(get(halfStreamingProgress)).toContainEqual(
      expect.objectContaining({ generatedTokens: 3, tokensPerSecond: 10 }),
    )
  })

  it('uses server token counts when one gateway frame contains many tokens', () => {
    beginHalfStreamingProgress(target)

    recordHalfStreamingToken(target, 3_500, { generatedTokens: 12, elapsedMs: 2_500 })

    expect(get(halfStreamingProgress)).toContainEqual(
      expect.objectContaining({
        generatedTokens: 12,
        tokensPerSecond: 4.8,
      }),
    )
  })

  it('does not let an old generation clear a newer generation', () => {
    beginHalfStreamingProgress(target)
    beginHalfStreamingProgress({ ...target, generationId: 'generation-2' })

    clearHalfStreamingProgress(target)

    expect(get(halfStreamingProgress)).toEqual([expect.objectContaining({ generationId: 'generation-2' })])
  })

  it('keeps interleaved chat throughput independent and cannot revive a completed target', () => {
    const otherTarget = {
      characterId: 'char-2',
      chatId: 'chat-2',
      generationId: 'generation-2',
    }
    beginHalfStreamingProgress(target)
    beginHalfStreamingProgress(otherTarget)

    recordHalfStreamingToken(target, 2_000, { generatedTokens: 4, elapsedMs: 1_000 })
    recordHalfStreamingToken(otherTarget, 3_000, { generatedTokens: 9, elapsedMs: 2_000 })
    recordHalfStreamingToken(target, 4_000, { generatedTokens: 12, elapsedMs: 3_000 })

    expect(get(halfStreamingProgress)).toEqual([
      expect.objectContaining({ chatId: 'chat-1', generatedTokens: 12, tokensPerSecond: 4 }),
      expect.objectContaining({ chatId: 'chat-2', generatedTokens: 9, tokensPerSecond: 4.5 }),
    ])

    clearHalfStreamingProgress(target)
    recordHalfStreamingToken(target, 5_000, { generatedTokens: 20, elapsedMs: 4_000 })

    expect(get(halfStreamingProgress)).toEqual([
      expect.objectContaining({ chatId: 'chat-2', generatedTokens: 9, tokensPerSecond: 4.5 }),
    ])
  })

  it('bounds retained live generations and ignores an evicted target', () => {
    const targets = Array.from({ length: 17 }, (_, index) => ({
      characterId: `char-${index}`,
      chatId: `chat-${index}`,
      generationId: `generation-${index}`,
    }))
    targets.forEach((progressTarget) => beginHalfStreamingProgress(progressTarget))

    recordHalfStreamingToken(targets[0], 2_000, { generatedTokens: 5, elapsedMs: 1_000 })

    const progress = get(halfStreamingProgress)
    expect(progress).toHaveLength(16)
    expect(progress.some((entry) => entry.generationId === 'generation-0')).toBe(false)
  })
})
