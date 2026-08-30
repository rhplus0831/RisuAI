import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_HYPA_V3_SETTINGS,
  normalizeHypaV3Settings,
  planStandardHypaV3Memory,
  validateHypaV3Settings,
  type HypaV3Settings,
} from '../src/memoryPlanner.js'
import type { MemorySummaryMessage } from '../src/memorySummaryMessage.js'
import {
  createHypaV3PrefixTokenMemo,
  type HypaV3PrefixTokenMemo,
  type HypaV3RawTokenizeChat,
} from '../src/prompt/prefixTokenMemo.js'
import { tokenizeChat, type TokenEncoding, type TokenizeChatOptions } from '../src/prompt/tokens.js'

function chat(memo: string, content = memo, role: MemorySummaryMessage['role'] = 'assistant'): MemorySummaryMessage {
  return { role, content, memo }
}

function fixedTokenizer(tokensByMemo: Record<string, number>, memoryTokens = 7) {
  return (item: MemorySummaryMessage): number => {
    if (item.memo && item.memo in tokensByMemo) return tokensByMemo[item.memo]
    if (item.content.startsWith('<Past Events Summary>')) return memoryTokens
    return 5
  }
}

function planWithSummarizedPrefixMemo(input: {
  chats: readonly MemorySummaryMessage[]
  memo: HypaV3PrefixTokenMemo
  rawTokenizeChat: HypaV3RawTokenizeChat
  encoding?: TokenEncoding
  options?: TokenizeChatOptions
  currentTokens?: number
}) {
  const encoding = input.encoding ?? 'cl100k_base'
  const options = input.options ?? {}
  return planStandardHypaV3Memory({
    chats: input.chats,
    currentTokens: input.currentTokens ?? 70,
    maxContextTokens: 100,
    maxResponseTokens: 0,
    summaries: [{ chatMemos: ['memo-a', 'memo-b'] }],
    settings: {
      memoryTokensRatio: 0.2,
      queryChatCount: 1,
    },
    tokenizeChat: (item) => tokenizeChat(item, encoding, options),
    tokenizeSummarizedPrefixChat: (item) => input.memo.tokenize(item, encoding, options, input.rawTokenizeChat),
  })
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

  it('reserves only the empty memory prompt when there are no summaries and it still fits', () => {
    const plan = planStandardHypaV3Memory({
      chats: [chat('m0'), chat('m1'), chat('m2')],
      currentTokens: 80,
      maxContextTokens: 100,
      maxResponseTokens: 0,
      settings: {
        memoryTokensRatio: 0.4,
      },
      tokenizeChat: fixedTokenizer({ m0: 10, m1: 10, m2: 10 }, 6),
    })

    expect(plan.errors).toEqual([])
    expect(plan.reservedEmptyMemoryPrompt).toBe(true)
    expect(plan.memoryTokens).toBe(40)
    expect(plan.emptyMemoryTokens).toBe(6)
    expect(plan.availableMemoryTokens).toBe(0)
    expect(plan.summarizationMode).toBe(false)
    expect(plan.tokenDeltas).toEqual([
      { kind: 'max_response', amount: -0, currentTokens: 80 },
      { kind: 'memory_reservation', amount: 6, currentTokens: 86 },
    ])
    expect(plan.plannedWindows).toEqual([])
  })

  it('falls back to the beginning when the latest summary memo is no longer in the chat', () => {
    const plan = planStandardHypaV3Memory({
      chats: [chat('m0'), chat('m1'), chat('m2')],
      currentTokens: 140,
      maxContextTokens: 100,
      maxResponseTokens: 0,
      summaries: [{ chatMemos: ['missing'] }],
      settings: {
        maxChatsPerSummary: 2,
        queryChatCount: 1,
      },
      tokenizeChat: fixedTokenizer({ m0: 10, m1: 10, m2: 10 }),
    })

    expect(plan.errors).toEqual([
      expect.objectContaining({
        code: 'cannot_summarize_further',
      }),
    ])
    expect(plan.reservedEmptyMemoryPrompt).toBe(false)
    expect(plan.startIndex).toBe(2)
    expect(plan.tokenDeltas).toEqual([
      { kind: 'max_response', amount: -0, currentTokens: 140 },
      { kind: 'memory_reservation', amount: 20, currentTokens: 160 },
      { kind: 'planned_window', amount: -20, currentTokens: 140 },
    ])
    expect(plan.plannedWindows).toEqual([
      expect.objectContaining({
        startIndex: 0,
        endIndexExclusive: 2,
        messageIndexes: [0, 1],
        chatMemos: ['m0', 'm1'],
      }),
    ])
  })

  it('surfaces skipped-message reasons in the window contract', () => {
    const chats: MemorySummaryMessage[] = [
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

  it('advances and records token deltas for skipped-only windows', () => {
    const chats: MemorySummaryMessage[] = [
      { role: 'user', content: 'example', memo: 'e0', name: 'example_user' },
      chat('NewChat', '[Start a new chat]', 'system'),
      chat('tail', 'tail'),
    ]

    const plan = planStandardHypaV3Memory({
      chats,
      currentTokens: 140,
      maxContextTokens: 100,
      maxResponseTokens: 0,
      settings: {
        maxChatsPerSummary: 2,
        queryChatCount: 1,
      },
      tokenizeChat: fixedTokenizer({ e0: 10, NewChat: 10, tail: 10 }),
    })

    expect(plan.errors).toEqual([
      expect.objectContaining({
        code: 'cannot_summarize_further',
      }),
    ])
    expect(plan.startIndex).toBe(2)
    expect(plan.tokenDeltas).toEqual([
      { kind: 'max_response', amount: -0, currentTokens: 140 },
      { kind: 'memory_reservation', amount: 20, currentTokens: 160 },
      { kind: 'planned_window', amount: -20, currentTokens: 140 },
    ])
    expect(plan.plannedWindows).toEqual([])
    expect(plan.skippedMessages).toEqual([
      { index: 0, memo: 'e0', reason: 'example' },
      { index: 1, memo: 'NewChat', reason: 'new_chat_marker' },
    ])
  })

  it('stops before a planned window would drop below the target while already within context', () => {
    const plan = planStandardHypaV3Memory({
      chats: [chat('m0'), chat('m1'), chat('m2'), chat('m3'), chat('tail')],
      currentTokens: 96,
      maxContextTokens: 100,
      maxResponseTokens: 0,
      settings: {
        extraSummarizationRatio: 0.1,
        maxChatsPerSummary: 2,
        queryChatCount: 1,
      },
      tokenizeChat: fixedTokenizer({ m0: 8, m1: 8, m2: 8, m3: 8, tail: 8 }),
    })

    expect(plan.errors).toEqual([])
    expect(plan.summarizationMode).toBe(true)
    expect(plan.targetTokens).toBe(90)
    expect(plan.startIndex).toBe(2)
    expect(plan.tokenDeltas).toEqual([
      { kind: 'max_response', amount: -0, currentTokens: 96 },
      { kind: 'memory_reservation', amount: 20, currentTokens: 116 },
      { kind: 'planned_window', amount: -16, currentTokens: 100 },
    ])
    expect(plan.plannedWindows).toHaveLength(1)
  })

  it('memoizes already-summarized prefix token counts across repeated planner passes', () => {
    const memo = createHypaV3PrefixTokenMemo()
    const chats: MemorySummaryMessage[] = [
      { role: 'user', content: 'alpha prefix '.repeat(12), memo: 'memo-a', name: 'Alex' },
      { role: 'assistant', content: 'bravo prefix '.repeat(12), memo: 'memo-b' },
      { role: 'user', content: 'tail', memo: 'memo-c' },
    ]
    const options: TokenizeChatOptions = { chatAdditionalTokens: 3, useName: 'name' }
    const rawTokenizeChat = vi.fn(
      (item: MemorySummaryMessage, rawEncoding: TokenEncoding, rawOptions: TokenizeChatOptions) =>
        tokenizeChat(item, rawEncoding, rawOptions),
    )

    const first = planWithSummarizedPrefixMemo({
      chats,
      memo,
      rawTokenizeChat,
      options,
    })

    expect(rawTokenizeChat).toHaveBeenCalledTimes(2)
    expect(rawTokenizeChat.mock.calls.map(([item]) => item.memo)).toEqual(['memo-a', 'memo-b'])
    expect(memo.stats()).toMatchObject({ entries: 2, hits: 0, misses: 2 })

    rawTokenizeChat.mockClear()
    const second = planWithSummarizedPrefixMemo({
      chats: structuredClone(chats),
      memo,
      rawTokenizeChat,
      options,
    })

    expect(rawTokenizeChat).not.toHaveBeenCalled()
    expect(memo.stats()).toMatchObject({ entries: 2, hits: 2, misses: 2 })
    expect(second.tokenDeltas).toEqual(first.tokenDeltas)
    expect(second.plannedWindows).toEqual(first.plannedWindows)
  })

  it('re-encodes edited summarized-prefix content and updates token deltas', () => {
    const memo = createHypaV3PrefixTokenMemo()
    const chats: MemorySummaryMessage[] = [
      { role: 'user', content: 'alpha prefix '.repeat(12), memo: 'memo-a' },
      { role: 'assistant', content: 'bravo prefix '.repeat(12), memo: 'memo-b' },
      { role: 'user', content: 'tail', memo: 'memo-c' },
    ]
    const rawTokenizeChat = vi.fn(
      (item: MemorySummaryMessage, rawEncoding: TokenEncoding, rawOptions: TokenizeChatOptions) =>
        tokenizeChat(item, rawEncoding, rawOptions),
    )
    planWithSummarizedPrefixMemo({ chats, memo, rawTokenizeChat })
    rawTokenizeChat.mockClear()

    const edited = structuredClone(chats)
    edited[0].content = `${edited[0].content} newly edited prefix content`
    const editedPlan = planWithSummarizedPrefixMemo({ chats: edited, memo, rawTokenizeChat })
    const expectedSummarizedTokens = tokenizeChat(edited[0]) + tokenizeChat(edited[1])

    expect(rawTokenizeChat).toHaveBeenCalledTimes(1)
    expect(rawTokenizeChat.mock.calls[0]?.[0].memo).toBe('memo-a')
    expect(editedPlan.tokenDeltas).toContainEqual({
      kind: 'summarized_history',
      amount: -expectedSummarizedTokens,
      currentTokens: 70 - expectedSummarizedTokens,
    })
  })

  it('re-encodes when summarized-prefix tokenizer options change', () => {
    const memo = createHypaV3PrefixTokenMemo()
    const chats: MemorySummaryMessage[] = [
      {
        role: 'user',
        content: 'alpha prefix '.repeat(12),
        memo: 'memo-a',
        name: 'Alex',
        thoughts: ['first hidden thought'],
      },
      {
        role: 'assistant',
        content: 'bravo prefix '.repeat(12),
        memo: 'memo-b',
        thoughts: ['second hidden thought'],
      },
      { role: 'user', content: 'tail', memo: 'memo-c' },
    ]
    const rawTokenizeChat = vi.fn(
      (item: MemorySummaryMessage, rawEncoding: TokenEncoding, rawOptions: TokenizeChatOptions) =>
        tokenizeChat(item, rawEncoding, rawOptions),
    )
    const firstOptions: TokenizeChatOptions = { chatAdditionalTokens: 3, countThoughts: false }
    const changedOptions: TokenizeChatOptions = { chatAdditionalTokens: 5, countThoughts: true }

    const first = planWithSummarizedPrefixMemo({
      chats,
      memo,
      rawTokenizeChat,
      options: firstOptions,
    })
    rawTokenizeChat.mockClear()
    const changed = planWithSummarizedPrefixMemo({
      chats: structuredClone(chats),
      memo,
      rawTokenizeChat,
      options: changedOptions,
    })

    expect(rawTokenizeChat).toHaveBeenCalledTimes(2)
    expect(rawTokenizeChat.mock.calls.map(([item]) => item.memo)).toEqual(['memo-a', 'memo-b'])
    expect(changed.tokenDeltas.find((delta) => delta.kind === 'summarized_history')).not.toEqual(
      first.tokenDeltas.find((delta) => delta.kind === 'summarized_history'),
    )
  })

  it('re-encodes when summarized-prefix multimodal dimensions change', () => {
    const memo = createHypaV3PrefixTokenMemo()
    const chats: MemorySummaryMessage[] = [
      {
        role: 'user',
        content: 'alpha prefix '.repeat(12),
        memo: 'memo-a',
        multimodals: [{ type: 'image', base64: 'a', width: 512, height: 512 }],
      },
      { role: 'assistant', content: 'bravo prefix '.repeat(12), memo: 'memo-b' },
      { role: 'user', content: 'tail', memo: 'memo-c' },
    ]
    const options: TokenizeChatOptions = {
      supportsInlayImage: true,
      visionQuality: 'high',
    }
    const rawTokenizeChat = vi.fn(
      (item: MemorySummaryMessage, rawEncoding: TokenEncoding, rawOptions: TokenizeChatOptions) =>
        tokenizeChat(item, rawEncoding, rawOptions),
    )
    planWithSummarizedPrefixMemo({ chats, memo, rawTokenizeChat, options })
    rawTokenizeChat.mockClear()

    const resized = structuredClone(chats)
    resized[0].multimodals![0].width = 1024
    planWithSummarizedPrefixMemo({ chats: resized, memo, rawTokenizeChat, options })

    expect(rawTokenizeChat).toHaveBeenCalledTimes(1)
    expect(rawTokenizeChat.mock.calls[0]?.[0].memo).toBe('memo-a')
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
