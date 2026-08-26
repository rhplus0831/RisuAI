import { describe, expect, it } from 'vitest'
import type { Database } from '../../../src/ts/storage/database.svelte'
import type { OpenAIChat } from '../../../src/ts/process/index.svelte'
import { finalizeRequestBudget } from '../src/prompt/budgetFinalize.js'
import { ensureTokenizerLoadedForDb } from '../src/prompt/tokenizerConfig.js'

function makeDb(aiModel = 'gpt4'): Database {
  return { aiModel } as unknown as Database
}

describe('finalizeRequestBudget — under budget', () => {
  it('passes through and returns maxResponse as outputTokens', () => {
    const formated: OpenAIChat[] = [
      { role: 'system', content: 'hello' },
      { role: 'user', content: 'world!' },
    ]
    const result = finalizeRequestBudget({
      db: makeDb(),
      formated,
      maxContextTokens: 1000,
      maxResponse: 200,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // gpt4 → overhead 5: 'hello' (1+5) + 'world!' (2+5) = 13.
    expect(result.inputTokens).toBe(13)
    expect(result.outputTokens).toBe(200)
    expect(result.formated).toBe(formated)
  })

  it('returns ok with zeros for an empty array', () => {
    const result = finalizeRequestBudget({
      db: makeDb(),
      formated: [],
      maxContextTokens: 1000,
      maxResponse: 200,
    })
    expect(result).toEqual({
      ok: true,
      formated: [],
      inputTokens: 0,
      outputTokens: 200,
    })
  })
})

describe('finalizeRequestBudget — outputTokens clamp', () => {
  it('clamps outputTokens to the remaining headroom', () => {
    const formated: OpenAIChat[] = [{ role: 'user', content: 'a'.repeat(80) }]
    const result = finalizeRequestBudget({
      db: makeDb(),
      formated,
      maxContextTokens: 20,
      maxResponse: 200,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // 'a'*80 → 10 content + 5 overhead = 15. 15 + 200 > 20 → 20 - 15 = 5.
    expect(result.inputTokens).toBe(15)
    expect(result.outputTokens).toBe(5)
  })
})

describe('finalizeRequestBudget — trimming', () => {
  it('zeroes removable entries front-to-back then filters empties', () => {
    const formated: OpenAIChat[] = [
      { role: 'system', content: 'system-prompt' },
      { role: 'user', content: 'aaaaaaaaaa', removable: true, memo: 'message-1' },
      { role: 'assistant', content: 'bbbbbbbbbb', removable: true },
      { role: 'user', content: 'final-question' },
    ]
    const result = finalizeRequestBudget({
      db: makeDb(),
      formated,
      maxContextTokens: 20,
      maxResponse: 50,
      historyMessageIds: new Set(['message-1']),
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Totals (overhead 5): 8 + 7 + 8 + 7 = 30.
    // Trim row1 (-7 → 23), trim row2 (-8 → 15 ≤ 20). Pinned rows kept.
    expect(result.formated.map((c) => c.content)).toEqual(['system-prompt', 'final-question'])
    expect(result.inputTokens).toBe(15)
    // 15 + 50 > 20 → 20 - 15 = 5.
    expect(result.outputTokens).toBe(5)
    expect(result.historyTruncated).toBe(true)
  })

  it('keeps multimodal-only rows during the empty-content filter', () => {
    const formated: OpenAIChat[] = [
      {
        role: 'user',
        content: 'caption',
        removable: true,
        multimodals: [{ type: 'image', base64: 'x' }],
      },
      { role: 'user', content: 'final-question' },
    ]
    const result = finalizeRequestBudget({
      db: makeDb(),
      formated,
      maxContextTokens: 10,
      maxResponse: 50,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // GPT-4 has no image input, so the attachment adds one row-overhead charge:
    // 'caption' (1+5+5) + 'final-question' (2+5) = 18 > 10.
    // Trim row0 (-11 → 7 ≤ 10); its content blanks but multimodals keep it.
    expect(result.formated).toHaveLength(2)
    expect(result.formated[0].content).toBe('')
    expect(result.formated[0].multimodals?.length).toBe(1)
    expect(result.formated[1].content).toBe('final-question')
    expect(result.inputTokens).toBe(7)
  })

  it('uses low-quality image charges when deciding whether to trim history', () => {
    const formated: OpenAIChat[] = [
      {
        role: 'user',
        content: 'caption',
        removable: true,
        multimodals: [{ type: 'image', base64: 'x' }],
      },
      { role: 'user', content: 'final-question' },
    ]
    const result = finalizeRequestBudget({
      db: { ...makeDb('gpt4o'), gptVisionQuality: 'low' },
      formated,
      maxContextTokens: 99,
      maxResponse: 50,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    // caption (1) + overhead (5) + image (87) + final row (7) = 100.
    // The image charge tips the request over the 99-token window.
    expect(result.inputTokens).toBe(7)
    expect(result.formated[0]).toMatchObject({ content: '', removable: true })
    expect(result.formated[0].multimodals).toHaveLength(1)
  })

  it('returns ok=false overflow when no removable row can fit the budget', () => {
    const formated: OpenAIChat[] = [
      { role: 'system', content: 'pinned-system-prompt' },
      { role: 'user', content: 'pinned-user-prompt' },
    ]
    const result = finalizeRequestBudget({
      db: makeDb(),
      formated,
      maxContextTokens: 5,
      maxResponse: 50,
    })
    // Both rows pinned: (5+5) + (5+5) = 20, never drops below 5.
    expect(result).toEqual({ ok: false, reason: 'overflow', inputTokens: 20 })
  })
})

describe('finalizeRequestBudget — tokenizer routing', () => {
  it('uses overhead 3 + name accounting for non-gpt models', async () => {
    const formated: OpenAIChat[] = [{ role: 'system', content: 'hello', name: 'hello' }]
    const db = makeDb('claude-3-5-sonnet')
    await ensureTokenizerLoadedForDb(db)
    const result = finalizeRequestBudget({
      db,
      formated,
      maxContextTokens: 1000,
      maxResponse: 100,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // claude → overhead 3, useName 'name': 1 content + 3 + (1 name + 1 sep).
    expect(result.inputTokens).toBe(6)
    expect(result.outputTokens).toBe(100)
  })

  it('routes through o200k_base for the gpt-4o family', () => {
    const formated: OpenAIChat[] = [{ role: 'system', content: 'café résumé 漢字' }]
    const result = finalizeRequestBudget({
      db: makeDb('gpt-4o'),
      formated,
      maxContextTokens: 1000,
      maxResponse: 100,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // o200k count for the test string = 6 + 5 overhead.
    expect(result.inputTokens).toBe(11)
  })
})
