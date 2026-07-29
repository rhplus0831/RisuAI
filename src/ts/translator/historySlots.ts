export type HistorySlotKind = 'source' | 'translated'

export type HistorySlotResolver = (kind: HistorySlotKind, count: number) => string

export interface HistorySlotMessage {
  role?: unknown
  data?: unknown
  translation?: unknown
  disabled?: unknown
  isComment?: unknown
}

export interface HistorySlotContext {
  messages: readonly HistorySlotMessage[]
  messageIndex: number
  greeting: {
    source: string
    translated?: string
  }
}

interface HistorySlotEntry {
  role: 'user' | 'char'
  source: string
  translated?: string
}

interface RenderedHistorySlots {
  source: string
  translated: string
}

const DEFAULT_HISTORY_MAX_TOKENS = 2048

function historySlotPattern(): RegExp {
  return /{{slot::(history|historytrans)::([^}]*)}}/g
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function normalizedCount(rawCount: string): number | null {
  if (!/^\d+$/.test(rawCount)) return null
  const count = Number(rawCount)
  return Number.isInteger(count) && count >= 1 && count <= 50 ? count : null
}

function normalizedMaxTokens(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_HISTORY_MAX_TOKENS
}

export function containsHistorySlot(template: string): boolean {
  return historySlotPattern().test(template)
}

export function maximumHistorySlotCount(template: string): number {
  let maximum = 0
  for (const match of template.matchAll(historySlotPattern())) {
    const count = normalizedCount(match[2])
    if (count !== null) maximum = Math.max(maximum, count)
  }
  return maximum
}

export function replaceHistorySlots(template: string, resolver?: HistorySlotResolver): string {
  return template.replace(historySlotPattern(), (_match, slot: string, rawCount: string) => {
    return resolveHistorySlot(slot, rawCount, resolver)
  })
}

export function resolveHistorySlot(slot: string, rawCount: string, resolver?: HistorySlotResolver): string {
  const count = normalizedCount(rawCount)
  if (count === null) return ''
  return resolver?.(slot === 'history' ? 'source' : 'translated', count) ?? ''
}

export function historySlotBlock(role: HistorySlotEntry['role'], body: string): string {
  return `${role}: ${body}\n\n---\n\n`
}

function collectHistorySlotEntries(
  context: HistorySlotContext,
  count: number,
  transformText: (text: string) => string,
): HistorySlotEntry[] {
  const newestFirst: HistorySlotEntry[] = []
  let exhaustedHistory = true
  for (let index = Math.min(context.messageIndex - 1, context.messages.length - 1); index >= 0; index--) {
    const message = context.messages[index]
    if (message.disabled === 'allBefore') {
      exhaustedHistory = false
      break
    }
    if (message.disabled === true || message.isComment === true) continue

    const translation = recordValue(message.translation)
    newestFirst.push({
      role: message.role === 'user' ? 'user' : 'char',
      source: transformText(stringValue(message.data)),
      ...(typeof translation.text === 'string' ? { translated: transformText(translation.text) } : {}),
    })
    if (newestFirst.length === count) break
  }

  if (newestFirst.length < count && exhaustedHistory && context.greeting.source.length > 0) {
    newestFirst.push({
      role: 'char',
      source: transformText(context.greeting.source),
      ...(context.greeting.translated === undefined ? {} : { translated: transformText(context.greeting.translated) }),
    })
  }

  return newestFirst.reverse()
}

function renderedHistorySlots(entries: readonly HistorySlotEntry[]): RenderedHistorySlots {
  return {
    source: entries.map((entry) => historySlotBlock(entry.role, entry.source)).join(''),
    translated: entries.map((entry) => historySlotBlock(entry.role, entry.translated ?? '')).join(''),
  }
}

function synchronousEntryTokens(entry: HistorySlotEntry, countTokens: (text: string) => number): number {
  const sourceTokens = countTokens(historySlotBlock(entry.role, entry.source))
  const translatedTokens =
    entry.translated === undefined ? 0 : countTokens(historySlotBlock(entry.role, entry.translated))
  return sourceTokens + translatedTokens
}

async function asynchronousEntryTokens(
  entry: HistorySlotEntry,
  countTokens: (text: string) => Promise<number>,
): Promise<number> {
  const sourceTokens = await countTokens(historySlotBlock(entry.role, entry.source))
  const translatedTokens =
    entry.translated === undefined ? 0 : await countTokens(historySlotBlock(entry.role, entry.translated))
  return sourceTokens + translatedTokens
}

export function createHistorySlotResolver(input: {
  context: HistorySlotContext
  maxTokens: number
  countTokens: (text: string) => number
  transformText?: (text: string) => string
}): HistorySlotResolver {
  const cache = new Map<number, RenderedHistorySlots>()
  const maxTokens = normalizedMaxTokens(input.maxTokens)
  const transformText = input.transformText ?? ((text: string) => text)

  return (kind, count) => {
    let rendered = cache.get(count)
    if (!rendered) {
      const entries = collectHistorySlotEntries(input.context, count, transformText)
      let totalTokens = entries.reduce((total, entry) => total + synchronousEntryTokens(entry, input.countTokens), 0)
      while (entries.length > 0 && totalTokens > maxTokens) {
        totalTokens -= synchronousEntryTokens(entries.shift()!, input.countTokens)
      }
      rendered = renderedHistorySlots(entries)
      cache.set(count, rendered)
    }
    return rendered[kind]
  }
}

export async function createAsyncHistorySlotResolver(input: {
  context: HistorySlotContext
  counts: readonly number[]
  maxTokens: number
  countTokens: (text: string) => Promise<number>
  transformText?: (text: string) => string
}): Promise<HistorySlotResolver> {
  const renderedByCount = new Map<number, RenderedHistorySlots>()
  const maxTokens = normalizedMaxTokens(input.maxTokens)
  const transformText = input.transformText ?? ((text: string) => text)

  await Promise.all(
    [...new Set(input.counts)].map(async (count) => {
      if (!Number.isInteger(count) || count < 1 || count > 50) return
      const entries = collectHistorySlotEntries(input.context, count, transformText)
      const entryTokens = await Promise.all(entries.map((entry) => asynchronousEntryTokens(entry, input.countTokens)))
      let totalTokens = entryTokens.reduce((total, tokens) => total + tokens, 0)
      let firstIncluded = 0
      while (firstIncluded < entries.length && totalTokens > maxTokens) {
        totalTokens -= entryTokens[firstIncluded]
        firstIncluded += 1
      }
      renderedByCount.set(count, renderedHistorySlots(entries.slice(firstIncluded)))
    }),
  )

  return (kind, count) => renderedByCount.get(count)?.[kind] ?? ''
}

export function historySlotCounts(template: string): number[] {
  const counts: number[] = []
  for (const match of template.matchAll(historySlotPattern())) {
    const count = normalizedCount(match[2])
    if (count !== null) counts.push(count)
  }
  return counts
}
