import { describe, expect, it } from 'vitest'
import {
  getChatGenerationLoadingLanguageKey,
  getChatGenerationLoadingProgress,
  getPostGenerationScriptProgress,
  normalizeChatGenerationLoadingStage,
} from './chatGenerationLoading'

describe('chat generation loading stage mapping', () => {
  it('maps known process stages to user-facing status keys and progress values', () => {
    expect(getChatGenerationLoadingLanguageKey(0)).toBe('chatGenerationStageStarting')
    expect(getChatGenerationLoadingLanguageKey(1)).toBe('chatGenerationStagePreparingPrompt')
    expect(getChatGenerationLoadingLanguageKey(2)).toBe('chatGenerationStageCheckingMemory')
    expect(getChatGenerationLoadingLanguageKey(3)).toBe('chatGenerationStageWaitingForModel')
    expect(getChatGenerationLoadingLanguageKey(4)).toBe('chatGenerationStageFinalizing')

    expect(getChatGenerationLoadingProgress(0)).toBe(12)
    expect(getChatGenerationLoadingProgress(4)).toBe(92)
  })

  it('falls back to the starting stage for unknown values', () => {
    expect(normalizeChatGenerationLoadingStage(-1)).toBe(0)
    expect(normalizeChatGenerationLoadingStage(99)).toBe(0)
    expect(normalizeChatGenerationLoadingStage(null)).toBe(0)
    expect(getChatGenerationLoadingLanguageKey(undefined)).toBe('chatGenerationStageStarting')
  })

  it('simulates bounded progress for post-generation scripts', () => {
    expect(getPostGenerationScriptProgress(1_000, 1_000, 0)).toBe(18)
    expect(getPostGenerationScriptProgress(1_000, 20_000, 3)).toBe(92)
    expect(getPostGenerationScriptProgress(1_000, 60_000, 100)).toBe(94)
  })
})
