import { describe, expect, it } from 'vitest'
import type { OpenAIChat } from '../../../src/ts/process/index.svelte'
import {
  DEFAULT_HYPA_V3_SETTINGS,
  normalizeHypaV3Settings,
  planStandardHypaV3Memory,
  validateHypaV3Settings,
  type HypaV3Settings,
} from '../src/memoryPlanner.js'

function chat(memo: string, content = memo, role: OpenAIChat['role'] = 'assistant'): OpenAIChat {
  return { role, content, memo }
}

function fixedTokenizer(tokensByMemo: Record<string, number>, memoryTokens = 7) {
  return (item: OpenAIChat): number => {
    if (item.memo && item.memo in tokensByMemo) return tokensByMemo[item.memo]
    if (item.content.startsWith('<Past Events Summary>')) return memoryTokens
    return 5
  }
}

describe('Hypa V3 settings normalization', () => {
  it('ports the browser defaults and preserves same-typed overrides', () => {
    const result = normalizeHypaV3Settings({
      memoryTokensRatio: 0.35,
      summarizationModel: 'model-a',
      maxChatsPerSummary: '9' as unknown as number,
      useExperimentalImpl: true,
    })

    expect(result.settings).toEqual({
      ...DEFAULT_HYPA_V3_SETTINGS,
      memoryTokensRatio: 0.35,
      summarizationModel: 'model-a',
      useExperimentalImpl: false,
    })
    expect(result.warnings).toEqual([
      {
        code: 'experimental_planner_fallback',
        message: expect.stringContaining('standard server planner'),
      },
    ])
  })

  it('validates ratios, rate limits, concurrency, and chunk separators', () => {
    const settings: HypaV3Settings = {
      ...DEFAULT_HYPA_V3_SETTINGS,
      memoryTokensRatio: -0.1,
      extraSummarizationRatio: 1.1,
      recentMemoryRatio: 0.7,
      similarMemoryRatio: 0.4,
      maxChatsPerSummary: 0,
      summarizationRequestsPerMinute: 0,
      summarizationMaxConcurrent: 1.5,
      embeddingRequestsPerMinute: -1,
      embeddingMaxConcurrent: 0,
      queryChatCount: -1,
      summaryChunkSeparator: '',
    }

    expect(validateHypaV3Settings(settings).map((error) => error.field)).toEqual([
      'memoryTokensRatio',
      'extraSummarizationRatio',
      'recentMemoryRatio+similarMemoryRatio',
      'maxChatsPerSummary',
      'summarizationRequestsPerMinute',
      'summarizationMaxConcurrent',
      'embeddingRequestsPerMinute',
      'embeddingMaxConcurrent',
      'queryChatCount',
      'summaryChunkSeparator',
    ])
  })
})

describe('standard Hypa V3 planner contract', () => {
  it('reports start index, token deltas, and planned windows without mutating memory', () => {
    const chats = ['m0', 'm1', 'm2', 'm3', 'm4', 'm5'].map((memo) => chat(memo))
    const plan = planStandardHypaV3Memory({
      chats,
      currentTokens: 140,
      maxContextTokens: 100,
      maxResponseTokens: 10,
      summaries: [{ chatMemos: ['m0', 'm1'] }],
      settings: {
        maxChatsPerSummary: 2,
        queryChatCount: 1,
      },
      tokenizeChat: fixedTokenizer({ m0: 10, m1: 10, m2: 10, m3: 10, m4: 10, m5: 10 }),
    })

    expect(plan.errors).toEqual([])
    expect(plan.mode).toBe('standard')
    expect(plan.summarizationMode).toBe(true)
    expect(plan.startIndex).toBe(5)
    expect(plan.tokenDeltas).toEqual([
      { kind: 'max_response', amount: -10, currentTokens: 130 },
      { kind: 'summarized_history', amount: -20, currentTokens: 110 },
      { kind: 'memory_reservation', amount: 20, currentTokens: 130 },
      { kind: 'planned_window', amount: -20, currentTokens: 110 },
      { kind: 'planned_window', amount: -10, currentTokens: 100 },
    ])
    expect(plan.plannedWindows).toEqual([
      expect.objectContaining({
        startIndex: 2,
        endIndexExclusive: 4,
        messageIndexes: [2, 3],
        chatMemos: ['m2', 'm3'],
        evaluatedTokenCount: 20,
        tokenDelta: -20,
      }),
      expect.objectContaining({
        startIndex: 4,
        endIndexExclusive: 5,
        messageIndexes: [4],
        chatMemos: ['m4'],
        evaluatedTokenCount: 10,
        tokenDelta: -10,
      }),
    ])
  })

  it('surfaces skipped-message reasons in the window contract', () => {
    const chats: OpenAIChat[] = [
      { role: 'user', content: 'example', memo: 'e0', name: 'example_user' },
      chat('NewChat', '[Start a new chat]', 'system'),
      chat('empty', '   '),
      chat('user', 'hello', 'user'),
      chat('assistant', 'reply'),
      chat('tail', 'tail'),
    ]

    const plan = planStandardHypaV3Memory({
      chats,
      currentTokens: 160,
      maxContextTokens: 100,
      maxResponseTokens: 0,
      settings: {
        doNotSummarizeUserMessage: true,
        maxChatsPerSummary: 5,
        queryChatCount: 1,
      },
      tokenizeChat: fixedTokenizer({
        e0: 10,
        NewChat: 10,
        empty: 10,
        user: 10,
        assistant: 10,
        tail: 10,
      }),
    })

    expect(plan.plannedWindows).toEqual([
      expect.objectContaining({
        messageIndexes: [4],
        chatMemos: ['assistant'],
        evaluatedTokenCount: 50,
      }),
    ])
    expect(plan.skippedMessages).toEqual([
      { index: 0, memo: 'e0', reason: 'example' },
      { index: 1, memo: 'NewChat', reason: 'new_chat_marker' },
      { index: 2, memo: 'empty', reason: 'empty' },
      { index: 3, memo: 'user', reason: 'user_message_disabled' },
    ])
  })

  it('returns a planner error when the standard path cannot summarize further', () => {
    const plan = planStandardHypaV3Memory({
      chats: [chat('m0'), chat('m1'), chat('m2')],
      currentTokens: 130,
      maxContextTokens: 100,
      maxResponseTokens: 0,
      settings: { queryChatCount: 3 },
      tokenizeChat: fixedTokenizer({ m0: 10, m1: 10, m2: 10 }),
    })

    expect(plan.errors).toEqual([
      expect.objectContaining({
        code: 'cannot_summarize_further',
        message: expect.stringContaining('Cannot summarize further'),
      }),
    ])
    expect(plan.plannedWindows).toEqual([])
  })

  it('returns invalid-settings errors before planning windows', () => {
    const plan = planStandardHypaV3Memory({
      chats: [chat('m0'), chat('m1'), chat('m2'), chat('m3')],
      currentTokens: 200,
      maxContextTokens: 100,
      maxResponseTokens: 0,
      settings: { recentMemoryRatio: 0.8, similarMemoryRatio: 0.5 },
      tokenizeChat: fixedTokenizer({ m0: 10, m1: 10, m2: 10, m3: 10 }),
    })

    expect(plan.errors).toEqual([
      expect.objectContaining({
        code: 'invalid_settings',
        details: expect.objectContaining({ field: 'recentMemoryRatio+similarMemoryRatio' }),
      }),
    ])
    expect(plan.plannedWindows).toEqual([])
  })
})
