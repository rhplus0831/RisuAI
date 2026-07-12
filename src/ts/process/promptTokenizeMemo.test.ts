import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const tokenizeAccurateMock = vi.hoisted(() =>
  vi.fn(async (text: string, consti?: boolean) => {
    return text.replace('{{slot}}', '').length + (consti ? 1000 : 0)
  }),
)

vi.mock('../tokenizer', () => ({
  tokenizeAccurate: tokenizeAccurateMock,
}))

vi.mock('../storage/database.svelte', () => ({
  createPreset: vi.fn(),
  getDatabase: vi.fn(() => ({})),
  presetTemplate: {},
  setDatabase: vi.fn(),
}))

vi.mock('../alert', () => ({
  alertError: vi.fn(),
  alertNormal: vi.fn(),
}))

import { createPromptTokenizeDebouncer, createPromptTokenizeMemo, tokenizePreset, type PromptItem } from './prompt'

function plainPrompt(id: string | undefined, text: string): PromptItem {
  return {
    ...(id ? { id } : {}),
    type: 'plain',
    type2: 'normal',
    text,
    role: 'system',
  }
}

async function fullPresetTotals(prompts: PromptItem[]) {
  return {
    tokens: await tokenizePreset(prompts, true),
    extokens: await tokenizePreset(prompts, false),
  }
}

describe('prompt template tokenization memo', () => {
  beforeEach(() => {
    tokenizeAccurateMock.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('M13: memoized prompt token totals match tokenizePreset for supported prompt item types', async () => {
    const template: PromptItem[] = [
      plainPrompt('main', 'main {{slot}} prompt'),
      {
        id: 'jailbreak',
        type: 'jailbreak',
        type2: 'normal',
        text: 'jailbreak prompt',
        role: 'system',
      },
      { id: 'persona', type: 'persona', innerFormat: 'persona {{slot}} format' },
      { id: 'description', type: 'description', innerFormat: 'description format' },
      { id: 'lorebook', type: 'lorebook', innerFormat: 'lore format' },
      { id: 'post', type: 'postEverything', innerFormat: 'post format' },
      { id: 'authornote', type: 'authornote', innerFormat: 'author note format' },
      { id: 'memory', type: 'memory', innerFormat: 'memory format' },
      {
        id: 'cot',
        type: 'cot',
        type2: 'normal',
        text: 'old tokenizePreset ignores cot text',
        role: 'system',
      },
      { id: 'chatml', type: 'chatML', text: 'old tokenizePreset ignores chatML text' },
      { id: 'chat', type: 'chat', rangeStart: 0, rangeEnd: 'end' },
      { id: 'cache', type: 'cache', name: 'cache point', depth: 1, role: 'all' },
    ]
    const expected = await fullPresetTotals(template)
    tokenizeAccurateMock.mockClear()

    const totals = await createPromptTokenizeMemo().tokenize(template)

    expect(totals).toEqual(expected)
  })

  it('treats absent promptTemplate values as zero tokens', async () => {
    await expect(tokenizePreset(undefined)).resolves.toBe(0)
    await expect(tokenizePreset(null)).resolves.toBe(0)
    expect(tokenizeAccurateMock).not.toHaveBeenCalled()
  })

  it('M13: unchanged prompt items hit cached token totals for both consti variants', async () => {
    const memo = createPromptTokenizeMemo()
    const template: PromptItem[] = [
      plainPrompt('edited', 'alpha'),
      { id: 'stable', type: 'memory', innerFormat: 'stable memory format' },
      { id: 'ignored', type: 'chat', rangeStart: 0, rangeEnd: 'end' },
    ]
    await memo.tokenize(template)
    tokenizeAccurateMock.mockClear()
    const editedTemplate = [plainPrompt('edited', 'alpha updated'), template[1], template[2]]
    const expected = await fullPresetTotals(editedTemplate)
    tokenizeAccurateMock.mockClear()

    const totals = await memo.tokenize(editedTemplate)

    expect(totals).toEqual(expected)
    expect(tokenizeAccurateMock.mock.calls).toEqual([
      ['alpha updated', true],
      ['alpha updated', false],
    ])
  })

  it('M13: rapid prompt edits debounce to the newest token total', async () => {
    vi.useFakeTimers()
    const tokenizeText = vi.fn(async (text: string, consti: boolean) => {
      return text.length + (consti ? 100 : 0)
    })
    const results: Array<{ tokens: number; extokens: number }> = []
    const debouncer = createPromptTokenizeDebouncer({
      debounceMs: 300,
      tokenizeText,
      onResult: (totals) => results.push(totals),
    })

    debouncer.schedule([plainPrompt('row', 'a')])
    await vi.advanceTimersByTimeAsync(100)
    debouncer.schedule([plainPrompt('row', 'ab')])
    await vi.advanceTimersByTimeAsync(100)
    debouncer.schedule([plainPrompt('row', 'abc')])
    await vi.advanceTimersByTimeAsync(299)
    expect(results).toEqual([])

    await vi.advanceTimersByTimeAsync(1)

    expect(results).toEqual([{ tokens: 103, extokens: 3 }])
    expect(tokenizeText.mock.calls).toEqual([
      ['abc', true],
      ['abc', false],
    ])
    debouncer.cancel()
  })

  it('M13: stale in-flight prompt tokenization results cannot overwrite newer edits', async () => {
    vi.useFakeTimers()
    const tokenizeText = vi.fn(async (text: string, consti: boolean) => {
      if (text === 'old') {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      return text.length + (consti ? 100 : 0)
    })
    const results: Array<{ tokens: number; extokens: number }> = []
    const debouncer = createPromptTokenizeDebouncer({
      debounceMs: 250,
      tokenizeText,
      onResult: (totals) => results.push(totals),
    })

    debouncer.schedule([plainPrompt('row', 'old')])
    await vi.advanceTimersByTimeAsync(250)
    debouncer.schedule([plainPrompt('row', 'newer')])
    await vi.advanceTimersByTimeAsync(250)

    expect(results).toEqual([{ tokens: 105, extokens: 5 }])
    debouncer.cancel()
  })

  it('M13: reorder delete and add preserve memoized token totals', async () => {
    const memo = createPromptTokenizeMemo()
    const alpha = plainPrompt('alpha', 'alpha')
    const betaWithoutId = plainPrompt(undefined, 'beta {{slot}}')
    const gamma: PromptItem = { id: 'gamma', type: 'memory', innerFormat: 'gamma' }
    const base = [alpha, betaWithoutId, gamma]
    await memo.tokenize(base)

    const reordered = [gamma, betaWithoutId, alpha]
    const expectedReordered = await fullPresetTotals(reordered)
    tokenizeAccurateMock.mockClear()
    expect(await memo.tokenize(reordered)).toEqual(expectedReordered)
    expect(tokenizeAccurateMock).not.toHaveBeenCalled()

    const deleted = [gamma, alpha]
    const expectedDeleted = await fullPresetTotals(deleted)
    tokenizeAccurateMock.mockClear()
    expect(await memo.tokenize(deleted)).toEqual(expectedDeleted)
    expect(tokenizeAccurateMock).not.toHaveBeenCalled()
    expect(memo.size()).toBe(2)

    const added = [gamma, alpha, plainPrompt('delta', 'delta')]
    const expectedAdded = await fullPresetTotals(added)
    tokenizeAccurateMock.mockClear()
    expect(await memo.tokenize(added)).toEqual(expectedAdded)
    expect(tokenizeAccurateMock.mock.calls).toEqual([
      ['delta', true],
      ['delta', false],
    ])
  })
})
