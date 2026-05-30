import { get_encoding, type Tiktoken } from '@dqbd/tiktoken'
import type { OpenAIChat } from '../../../../src/ts/process/index.svelte'

/**
 * Minimal server tokenizer: text-only tiktoken counting plus `OpenAIChat`
 * per-message overhead. Provider-specific tokenizers, custom tokenizer hooks,
 * count-token API calls, local GGUF tokenization, and multimodal image-token
 * math remain out of scope. Anything not routed to `o200k_base` falls back to
 * the conservative `cl100k_base` encoder.
 */

export type TokenEncoding = 'cl100k_base' | 'o200k_base'

// Prefixes the SPA tags with `LLMTokenizer.tiktokenO200Base`. The omitted
// `chatgpt-4o-latest` and `gpt-4.5-preview*` rows intentionally use the
// conservative `cl100k_base` fallback until a fixture needs exact parity.
const O200K_PREFIXES: readonly string[] = [
  'gpt-4o',
  'gpt-4.1',
  'gpt-5',
  'gpt-oss',
  'o1',
  'o3',
  'o4',
]

const encoders: Partial<Record<TokenEncoding, Tiktoken>> = {}

function getEncoder(encoding: TokenEncoding): Tiktoken {
  let enc = encoders[encoding]
  if (!enc) {
    enc = get_encoding(encoding)
    encoders[encoding] = enc
  }
  return enc
}

/**
 * Route an explicit model id to the tiktoken encoding the SPA's
 * `tokenizer.ts` would pick. Matches the prefix list assigned
 * `LLMTokenizer.tiktokenO200Base` in
 * `src/ts/model/providers/openai.ts`; everything else falls back to
 * `cl100k_base`.
 */
export function encodingForModel(model: string | undefined | null): TokenEncoding {
  if (!model) return 'cl100k_base'
  const id = model.toLowerCase()
  for (const prefix of O200K_PREFIXES) {
    if (id.startsWith(prefix)) return 'o200k_base'
  }
  return 'cl100k_base'
}

/** Count tokens for plain text under the given encoding. */
export function tokenize(text: string, encoding: TokenEncoding = 'cl100k_base'): number {
  if (!text) return 0
  return getEncoder(encoding).encode(text).length
}

export interface TokenizeChatOptions {
  /** Per-message overhead added to every chat row. Defaults to 4 (matches SPA `ChatTokenizer`). */
  chatAdditionalTokens?: number
  /** Whether to count `name` and add the `name`-present separator. Defaults to `'name'`. */
  useName?: 'name' | 'noName'
  /** Whether to fold `thoughts[]` into the count. */
  countThoughts?: boolean
}

/**
 * Count tokens for a single `OpenAIChat`. Mirrors the SPA's
 * `ChatTokenizer.tokenizeChat` (text-only): content + overhead, plus
 * `name` and `thoughts[]` when requested.
 */
export function tokenizeChat(
  chat: OpenAIChat,
  encoding: TokenEncoding = 'cl100k_base',
  options: TokenizeChatOptions = {},
): number {
  const overhead = options.chatAdditionalTokens ?? 4
  const useName = options.useName ?? 'name'
  let count = tokenize(chat.content ?? '', encoding) + overhead
  if (chat.name && useName === 'name') {
    count += tokenize(chat.name, encoding) + 1
  }
  if (options.countThoughts && chat.thoughts && chat.thoughts.length > 0) {
    for (const thought of chat.thoughts) {
      count += tokenize(thought, encoding) + 1
    }
  }
  return count
}

/** Sum `tokenizeChat` across an `OpenAIChat[]`. */
export function tokenizeChats(
  chats: OpenAIChat[],
  encoding: TokenEncoding = 'cl100k_base',
  options: TokenizeChatOptions = {},
): number {
  let total = 0
  for (const chat of chats) {
    total += tokenizeChat(chat, encoding, options)
  }
  return total
}
