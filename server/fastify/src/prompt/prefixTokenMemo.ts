import { createHash } from 'node:crypto'
import type { PromptMessage } from './promptMessage.js'
import { tokenizeChat, type TokenEncoding, type TokenizeChatOptions } from './tokens.js'

const DEFAULT_HYPA_V3_PREFIX_TOKEN_MEMO_ENTRIES = 4096

interface NormalizedTokenizeChatOptions {
  chatAdditionalTokens: number
  useName: 'name' | 'noName'
  countThoughts: boolean
  supportsInlayImage: boolean
  visionQuality: string
}

export interface HypaV3PrefixTokenMemoStats {
  entries: number
  hits: number
  misses: number
  evictions: number
}

export type HypaV3RawTokenizeChat = (
  chat: PromptMessage,
  encoding: TokenEncoding,
  options: TokenizeChatOptions,
) => number

export interface HypaV3PrefixTokenMemo {
  tokenize(
    chat: PromptMessage,
    encoding?: TokenEncoding,
    options?: TokenizeChatOptions,
    rawTokenizeChat?: HypaV3RawTokenizeChat,
  ): number
  clear(): void
  stats(): HypaV3PrefixTokenMemoStats
}

export function createHypaV3PrefixTokenMemo(
  maxEntries = DEFAULT_HYPA_V3_PREFIX_TOKEN_MEMO_ENTRIES,
): HypaV3PrefixTokenMemo {
  const capacity = Math.max(1, Math.floor(maxEntries))
  const cache = new Map<string, number>()
  const stats = {
    hits: 0,
    misses: 0,
    evictions: 0,
  }

  return {
    tokenize(chat, encoding = 'cl100k_base', options = {}, rawTokenizeChat = tokenizeChat): number {
      const key = createHypaV3PrefixTokenMemoKey(chat, encoding, options)
      if (cache.has(key)) {
        const tokens = cache.get(key) as number
        cache.delete(key)
        cache.set(key, tokens)
        stats.hits++
        return tokens
      }

      const tokens = rawTokenizeChat(chat, encoding, options)
      cache.set(key, tokens)
      stats.misses++
      while (cache.size > capacity) {
        const oldest = cache.keys().next().value
        if (oldest === undefined) break
        cache.delete(oldest)
        stats.evictions++
      }
      return tokens
    },
    clear(): void {
      cache.clear()
      stats.hits = 0
      stats.misses = 0
      stats.evictions = 0
    },
    stats(): HypaV3PrefixTokenMemoStats {
      return {
        entries: cache.size,
        hits: stats.hits,
        misses: stats.misses,
        evictions: stats.evictions,
      }
    },
  }
}

export const sharedHypaV3PrefixTokenMemo = createHypaV3PrefixTokenMemo()

export function tokenizeHypaV3PrefixChat(
  chat: PromptMessage,
  encoding?: TokenEncoding,
  options?: TokenizeChatOptions,
): number {
  return sharedHypaV3PrefixTokenMemo.tokenize(chat, encoding, options)
}

export function resetHypaV3PrefixTokenMemoForTests(): void {
  sharedHypaV3PrefixTokenMemo.clear()
}

export function getHypaV3PrefixTokenMemoStatsForTests(): HypaV3PrefixTokenMemoStats {
  return sharedHypaV3PrefixTokenMemo.stats()
}

function createHypaV3PrefixTokenMemoKey(
  chat: PromptMessage,
  encoding: TokenEncoding,
  options: TokenizeChatOptions,
): string {
  const normalizedOptions = normalizeTokenizeChatOptions(options)
  const thoughts = Array.isArray(chat.thoughts) ? chat.thoughts : []
  return JSON.stringify([
    'hypa-v3-prefix-token-v2',
    encoding,
    normalizedOptions.chatAdditionalTokens,
    normalizedOptions.useName,
    normalizedOptions.countThoughts,
    normalizedOptions.supportsInlayImage,
    normalizedOptions.visionQuality,
    chat.role,
    hashText(chat.content ?? ''),
    chat.name === undefined ? null : hashText(chat.name),
    thoughts.map(hashText),
    (chat.multimodals ?? []).map((multimodal) => [
      multimodal.type,
      multimodal.width ?? null,
      multimodal.height ?? null,
    ]),
    chat.memo ?? null,
  ])
}

function normalizeTokenizeChatOptions(options: TokenizeChatOptions): NormalizedTokenizeChatOptions {
  return {
    chatAdditionalTokens: options.chatAdditionalTokens ?? 4,
    useName: options.useName ?? 'name',
    countThoughts: options.countThoughts === true,
    supportsInlayImage: options.supportsInlayImage === true,
    visionQuality: options.visionQuality ?? 'low',
  }
}

function hashText(text: string): string {
  return `${text.length}:${createHash('sha256').update(text).digest('base64url')}`
}
