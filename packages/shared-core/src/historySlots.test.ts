import { describe, expect, it, vi } from 'vitest'
import {
  containsHistorySlot,
  createAsyncHistorySlotResolver,
  createHistorySlotResolver,
  historySlotCounts,
  maximumHistorySlotCount,
  replaceHistorySlots,
  resolveHistorySlot,
  type HistorySlotContext,
  type HistorySlotKind,
  type HistorySlotResolver,
} from './historySlots.js'

interface OracleEntry {
  role: 'user' | 'char'
  source: string
  translated?: string
}

function oracleBlock(role: OracleEntry['role'], body: string): string {
  return `${role}: ${body}\n\n---\n\n`
}

function oracleEntries(
  context: HistorySlotContext,
  count: number,
  transformText: (text: string) => string,
): OracleEntry[] {
  const newestFirst: OracleEntry[] = []
  let mayUseGreeting = true
  for (let index = Math.min(context.messageIndex - 1, context.messages.length - 1); index >= 0; index -= 1) {
    const message = context.messages[index]
    if (message.disabled === 'allBefore') {
      mayUseGreeting = false
      break
    }
    if (message.disabled === true || message.isComment === true) continue
    const translation =
      message.translation && typeof message.translation === 'object' && !Array.isArray(message.translation)
        ? (message.translation as Record<string, unknown>)
        : {}
    newestFirst.push({
      role: message.role === 'user' ? 'user' : 'char',
      source: transformText(typeof message.data === 'string' ? message.data : ''),
      ...(typeof translation.text === 'string' ? { translated: transformText(translation.text) } : {}),
    })
    if (newestFirst.length === count) break
  }
  if (newestFirst.length < count && mayUseGreeting && context.greeting.source.length > 0) {
    newestFirst.push({
      role: 'char',
      source: transformText(context.greeting.source),
      ...(context.greeting.translated === undefined ? {} : { translated: transformText(context.greeting.translated) }),
    })
  }
  return newestFirst.reverse()
}

function oracleRendered(entries: readonly OracleEntry[]): Record<HistorySlotKind, string> {
  return {
    source: entries.map((entry) => oracleBlock(entry.role, entry.source)).join(''),
    translated: entries.map((entry) => oracleBlock(entry.role, entry.translated ?? '')).join(''),
  }
}

function oracleSyncResolver(input: {
  context: HistorySlotContext
  maxTokens: number
  countTokens: (text: string) => number
  transformText: (text: string) => string
}): HistorySlotResolver {
  const cache = new Map<number, Record<HistorySlotKind, string>>()
  const maxTokens = Number.isFinite(input.maxTokens) && input.maxTokens > 0 ? input.maxTokens : 2048
  return (kind, count) => {
    let rendered = cache.get(count)
    if (!rendered) {
      const entries = oracleEntries(input.context, count, input.transformText)
      const tokensFor = (entry: OracleEntry): number =>
        input.countTokens(oracleBlock(entry.role, entry.source)) +
        (entry.translated === undefined ? 0 : input.countTokens(oracleBlock(entry.role, entry.translated)))
      let total = entries.reduce((sum, entry) => sum + tokensFor(entry), 0)
      while (entries.length > 0 && total > maxTokens) total -= tokensFor(entries.shift()!)
      rendered = oracleRendered(entries)
      cache.set(count, rendered)
    }
    return rendered[kind]
  }
}

async function oracleAsyncResolver(input: {
  context: HistorySlotContext
  counts: readonly number[]
  maxTokens: number
  countTokens: (text: string) => Promise<number>
  transformText: (text: string) => string
}): Promise<HistorySlotResolver> {
  const rendered = new Map<number, Record<HistorySlotKind, string>>()
  const maxTokens = Number.isFinite(input.maxTokens) && input.maxTokens > 0 ? input.maxTokens : 2048
  await Promise.all(
    [...new Set(input.counts)].map(async (count) => {
      if (!Number.isInteger(count) || count < 1 || count > 50) return
      const entries = oracleEntries(input.context, count, input.transformText)
      const tokens = await Promise.all(
        entries.map(async (entry) => {
          const source = await input.countTokens(oracleBlock(entry.role, entry.source))
          const translated =
            entry.translated === undefined ? 0 : await input.countTokens(oracleBlock(entry.role, entry.translated))
          return source + translated
        }),
      )
      let total = tokens.reduce((sum, value) => sum + value, 0)
      let firstIncluded = 0
      while (firstIncluded < entries.length && total > maxTokens) {
        total -= tokens[firstIncluded]
        firstIncluded += 1
      }
      rendered.set(count, oracleRendered(entries.slice(firstIncluded)))
    }),
  )
  return (kind, count) => rendered.get(count)?.[kind] ?? ''
}

const context: HistorySlotContext = {
  messages: [
    { role: 'user', data: 'old', translation: { text: 'old-ko' } },
    { role: 'char', data: 'middle' },
    { role: 'user', data: 'comment', isComment: true },
    { role: 'assistant', data: 'new', translation: { text: 'new-ko' } },
    { role: 'user', data: 'future' },
  ],
  messageIndex: 4,
  greeting: { source: 'hello', translated: 'hello-ko' },
}

describe('history-slot grammar', () => {
  it('preserves matching, count discovery, replacement, and invalid-count erasure', () => {
    const template =
      'A {{slot::history::2}} B {{slot::historytrans::50}} C {{slot::history::0}} D {{slot::history::oops}} E {{slot::history}} F {{slot::history::2}}'
    const resolver = vi.fn((kind: HistorySlotKind, count: number) => `${kind}:${count}`)

    expect(containsHistorySlot(template)).toBe(true)
    expect(containsHistorySlot('{{slot::history::2')).toBe(false)
    expect(maximumHistorySlotCount(template)).toBe(50)
    expect(historySlotCounts(template)).toEqual([2, 50, 2])
    expect(replaceHistorySlots(template, resolver)).toBe(
      'A source:2 B translated:50 C  D  E {{slot::history}} F source:2',
    )
    expect(resolver.mock.calls).toEqual([
      ['source', 2],
      ['translated', 50],
      ['source', 2],
    ])
    expect(resolveHistorySlot('history', '01', resolver)).toBe('source:1')
    expect(resolveHistorySlot('historytrans', '51', resolver)).toBe('')
  })
})

describe('history-slot rendering', () => {
  it.each([
    { name: 'full history with greeting', count: 5, maxTokens: 10_000 },
    { name: 'bounded recent history', count: 2, maxTokens: 10_000 },
    { name: 'oldest-first token eviction', count: 5, maxTokens: 80 },
    { name: 'fallback token budget', count: 5, maxTokens: Number.NaN },
  ])('matches the pre-extraction synchronous behavior: $name', ({ count, maxTokens }) => {
    const actualTransform = vi.fn((text: string) => `[${text}]`)
    const oracleTransform = vi.fn((text: string) => `[${text}]`)
    const countTokens = (text: string) => text.length
    const actual = createHistorySlotResolver({ context, maxTokens, countTokens, transformText: actualTransform })
    const oracle = oracleSyncResolver({ context, maxTokens, countTokens, transformText: oracleTransform })

    expect(actual('source', count)).toBe(oracle('source', count))
    expect(actual('translated', count)).toBe(oracle('translated', count))
    expect(actualTransform.mock.calls).toEqual(oracleTransform.mock.calls)
  })

  it('preserves allBefore cutoffs, disabled rows, non-string normalization, and no greeting fallback', () => {
    const cutoffContext: HistorySlotContext = {
      messages: [
        { role: 'user', data: 'hidden' },
        { role: 'char', data: 'cutoff', disabled: 'allBefore' },
        { role: 'user', data: 'disabled', disabled: true },
        { role: 'other', data: 42, translation: [] },
      ],
      messageIndex: 4,
      greeting: { source: 'must-not-appear' },
    }
    const resolver = createHistorySlotResolver({ context: cutoffContext, maxTokens: 1000, countTokens: () => 1 })

    expect(resolver('source', 5)).toBe(oracleBlock('char', ''))
    expect(resolver('translated', 5)).toBe(oracleBlock('char', ''))
  })

  it('caches both rendered kinds for each synchronous count', () => {
    const countTokens = vi.fn(() => 1)
    const resolver = createHistorySlotResolver({ context, maxTokens: 1000, countTokens })

    resolver('source', 2)
    resolver('translated', 2)
    resolver('source', 2)

    expect(countTokens).toHaveBeenCalledTimes(3)
  })

  it('matches pre-extraction async rendering, de-duplicates counts, and ignores invalid counts', async () => {
    const actualTokens = vi.fn(async (text: string) => text.length)
    const oracleTokens = vi.fn(async (text: string) => text.length)
    const transform = (text: string) => text.toUpperCase()
    const counts = [2, 2, 5, 0, 51]
    const actual = await createAsyncHistorySlotResolver({
      context,
      counts,
      maxTokens: 90,
      countTokens: actualTokens,
      transformText: transform,
    })
    const oracle = await oracleAsyncResolver({
      context,
      counts,
      maxTokens: 90,
      countTokens: oracleTokens,
      transformText: transform,
    })

    for (const count of [2, 5, 0, 51]) {
      expect(actual('source', count)).toBe(oracle('source', count))
      expect(actual('translated', count)).toBe(oracle('translated', count))
    }
    expect(actualTokens).toHaveBeenCalledTimes(oracleTokens.mock.calls.length)
  })
})
