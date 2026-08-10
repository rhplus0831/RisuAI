import { get } from 'svelte/store'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  beginPostGenerationProgress,
  clearPostGenerationProgress,
  postGenerationProgress,
  updatePostGenerationProgress,
  type PostGenerationProgressSession,
} from './postGenerationProgress'

afterEach(() => {
  clearPostGenerationProgress()
  vi.useRealTimers()
})

function updateProgress(
  session: PostGenerationProgressSession,
  ownerName: string,
  status: 'started' | 'running' | 'finished' | 'error' = 'running',
): void {
  updatePostGenerationProgress(session, {
    type: 'post_generation_progress',
    phase: 'onOutput',
    status,
    runSeq: 1,
    ownerType: 'module',
    ownerName,
    llmCallCount: status === 'running' ? 1 : 0,
    pendingLlmCount: status === 'running' ? 1 : 0,
    llmCallCounts: { LLM: 0, axLLM: status === 'running' ? 1 : 0 },
    pendingLlmCounts: { LLM: 0, axLLM: status === 'running' ? 1 : 0 },
  })
}

describe('post-generation progress state', () => {
  it('preserves the start time within one run and phase', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const session = beginPostGenerationProgress({ characterId: 'char-1', chatId: 'chat-1' })
    updateProgress(session, 'Translator', 'started')

    vi.setSystemTime(1_500)
    updateProgress(session, 'Translator')

    expect(get(postGenerationProgress)).toContainEqual(
      expect.objectContaining({
        startedAt: 1_000,
        updatedAt: 1_500,
        ownerName: 'Translator',
      }),
    )
  })

  it('keeps simultaneous chats independent and rejects events after one finishes', () => {
    const first = beginPostGenerationProgress({ characterId: 'char-1', chatId: 'chat-1' })
    const second = beginPostGenerationProgress({ characterId: 'char-2', chatId: 'chat-2' })
    updateProgress(first, 'First Script')
    updateProgress(second, 'Second Script')

    expect(get(postGenerationProgress)).toEqual([
      expect.objectContaining({
        target: { characterId: 'char-1', chatId: 'chat-1' },
        ownerName: 'First Script',
      }),
      expect.objectContaining({
        target: { characterId: 'char-2', chatId: 'chat-2' },
        ownerName: 'Second Script',
      }),
    ])

    updateProgress(first, 'First Script', 'finished')
    updateProgress(first, 'Stale First Script')

    expect(get(postGenerationProgress)).toEqual([
      expect.objectContaining({
        target: { characterId: 'char-2', chatId: 'chat-2' },
        ownerName: 'Second Script',
      }),
    ])
  })

  it('bounds retained live targets and invalidates the least-recently-active session', () => {
    const sessions = Array.from({ length: 17 }, (_, index) =>
      beginPostGenerationProgress({ characterId: `char-${index}`, chatId: `chat-${index}` }),
    )
    sessions.forEach((session, index) => updateProgress(session, `Script ${index}`))

    const progress = get(postGenerationProgress)
    expect(progress).toHaveLength(16)
    expect(progress.some((entry) => entry.target.chatId === 'chat-0')).toBe(false)
  })
})
