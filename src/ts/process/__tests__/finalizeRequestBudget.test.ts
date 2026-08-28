import { describe, expect, it } from 'vitest'

import type { ChatTokenizer } from '../../tokenizer'
import type { OpenAIChat } from '../index.svelte'
import { finalizeRequestBudget } from '../promptBudget/finalizeRequestBudget'

function tokensFor(chat: OpenAIChat): number {
  const fromContent = chat.content === '' ? 0 : chat.content.length
  const fromMultimodal = chat.multimodals?.length ? chat.multimodals.length * 100 : 0
  return fromContent + fromMultimodal
}

function fakeTokenizer(rowOverhead = 0): ChatTokenizer {
  return {
    async tokenizeChat(chat: OpenAIChat) {
      return tokensFor(chat) + rowOverhead
    },
  } as unknown as ChatTokenizer
}

describe('finalizeRequestBudget', () => {
  it('returns inputTokens and clamps outputTokens to maxResponse when under budget', async () => {
    const formated: OpenAIChat[] = [
      { role: 'system', content: 'hello' },
      { role: 'user', content: 'world!' },
    ]
    const result = await finalizeRequestBudget(formated, 1000, 200, fakeTokenizer())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.inputTokens).toBe(11)
    expect(result.outputTokens).toBe(200)
    expect(result.formated).toBe(formated)
  })

  it('clamps outputTokens to remaining headroom when maxResponse would overflow', async () => {
    const formated: OpenAIChat[] = [{ role: 'user', content: 'a'.repeat(80) }]
    const result = await finalizeRequestBudget(formated, 100, 200, fakeTokenizer())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.inputTokens).toBe(80)
    expect(result.outputTokens).toBe(20)
  })

  it('zeroes removable entries while preserving non-removable, then filters empties', async () => {
    const formated: OpenAIChat[] = [
      { role: 'system', content: 'system-prompt' },
      { role: 'user', content: 'aaaaaaaaaa', removable: true },
      { role: 'assistant', content: 'bbbbbbbbbb', removable: true },
      { role: 'user', content: 'final-question' },
    ]
    const result = await finalizeRequestBudget(formated, 30, 50, fakeTokenizer())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.formated.map((c) => c.content)).toEqual(['system-prompt', 'final-question'])
    expect(result.inputTokens).toBe(27)
    expect(result.outputTokens).toBe(3)
  })

  it('keeps multimodal-only entries during the empty-content filter', async () => {
    const formated: OpenAIChat[] = [
      {
        role: 'user',
        content: 'caption-text',
        removable: true,
        multimodals: [{ type: 'image', base64: 'x' }],
      },
      { role: 'user', content: 'follow-up' },
    ]
    const result = await finalizeRequestBudget(formated, 110, 50, fakeTokenizer())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.formated).toHaveLength(2)
    expect(result.formated[0].content).toBe('')
    expect(result.formated[0].multimodals?.length).toBe(1)
    expect(result.formated[1].content).toBe('follow-up')
    const returnedTokens = (
      await Promise.all(result.formated.map((chat) => fakeTokenizer().tokenizeChat(chat)))
    ).reduce((total, tokens) => total + tokens, 0)
    expect(result.inputTokens).toBe(returnedTokens)
    expect(result.inputTokens).toBe(109)
    expect(result.outputTokens).toBe(1)
    expect(result.inputTokens + result.outputTokens).toBeLessThanOrEqual(110)
  })

  it('retains row overhead for a trimmed multimodal entry', async () => {
    const tokenizer = fakeTokenizer(5)
    const formated: OpenAIChat[] = [
      {
        role: 'user',
        content: 'caption-text',
        removable: true,
        multimodals: [{ type: 'image', base64: 'x' }],
      },
      { role: 'user', content: 'follow-up' },
    ]
    const result = await finalizeRequestBudget(formated, 120, 50, tokenizer)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const returnedTokens = (await Promise.all(result.formated.map((chat) => tokenizer.tokenizeChat(chat)))).reduce(
      (total, tokens) => total + tokens,
      0,
    )
    expect(result.inputTokens).toBe(returnedTokens)
    expect(result.inputTokens).toBe(119)
    expect(result.outputTokens).toBe(1)
  })

  it('returns ok=false when no removable entries can bring tokens under the budget', async () => {
    const formated: OpenAIChat[] = [
      { role: 'system', content: 'pinned-system-prompt' },
      { role: 'user', content: 'pinned-user-prompt' },
    ]
    const result = await finalizeRequestBudget(formated, 5, 50, fakeTokenizer())
    expect(result).toEqual({
      ok: false,
      reason: 'overflow',
      inputTokens: 38,
    })
  })
})
