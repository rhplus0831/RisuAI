import { get_encoding, type Tiktoken } from '@dqbd/tiktoken'
import type { OpenAIChat } from '../../../../src/ts/process/index.svelte'

/**
 * Phase 7-8a minimal server tokenizer.
 *
 * Replaces the SPA's 654-line tokenizer dispatcher
 * (`src/ts/tokenizer.ts`) with the slice of behavior that Phase 7
 * budget heuristics actually need: text-only tiktoken counting plus
 * `OpenAIChat` per-message overhead.
 *
 * Out of scope (see the archived Phase 7 scope re-verification in
 * docs/archive/fastify/phases/phase-7-prompt-assembly.md):
 * Svelte stores, plugin / custom tokenizer hooks,
 * `@mlc-ai/web-tokenizers` providers (Claude / Llama / Mistral /
 * NovelAI / NovelList / Gemma / Cohere / DeepSeek / GLM), Google
 * count-token calls, local GGUF tokenization, and multimodal
 * image-token math. Anything not routed to `o200k_base` here falls
 * back to the conservative `cl100k_base` encoder so Phase 7 budgets
 * stay stable; exact provider tokenizers land only when a fixture
 * needs them.
 */

export type TokenEncoding = 'cl100k_base' | 'o200k_base'

// Prefix list from Phase 7-8a: the families the SPA's
// `src/ts/model/providers/openai.ts` tags with
// `LLMTokenizer.tiktokenO200Base`. Two SPA rows that fall outside this
// list (`chatgpt-4o-latest`, `gpt-4.5-preview*`) are intentionally
// routed to `cl100k_base` per the documented conservative fallback;
// add their prefixes here only when a fixture requires the exact
// per-model parity.
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
