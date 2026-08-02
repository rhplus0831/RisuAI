import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { get_encoding, type Tiktoken } from '@dqbd/tiktoken'
import type { Tokenizer as WebTokenizer } from '@mlc-ai/web-tokenizers'
import type { PreTrainedTokenizer } from '@huggingface/transformers'
import type { MultiModal, OpenAIChat } from '../../../../src/ts/process/index.svelte'

/**
 * Server text tokenizer plus `OpenAIChat` per-message overhead. Portable client
 * tokenizer families are loaded lazily from the repository's `public/token`
 * assets. Google Cloud network counting, local GGUF tokenization, plugin
 * tokenizer hooks remain out of scope. Multimodal charges mirror the client
 * `ChatTokenizer` because they participate in every prompt-budget phase.
 */

export const PORTABLE_TOKEN_ENCODINGS = [
  'claude',
  'llama3',
  'cohere',
  'deepseek',
  'deepseek-v4',
  'glm4',
  'glm5',
  'gemma',
  'mistral',
  'llama',
  'novelai',
  'novellist',
] as const

export type PortableTokenEncoding = (typeof PORTABLE_TOKEN_ENCODINGS)[number]
export type TokenEncoding = 'cl100k_base' | 'o200k_base' | PortableTokenEncoding

type SyncTokenizer = Pick<WebTokenizer, 'encode'> | Pick<PreTrainedTokenizer, 'encode'>

interface PortableTokenizerAsset {
  kind: 'json' | 'sentencepiece' | 'gemma'
  relativePath: string
}

const PORTABLE_TOKENIZER_ASSETS: Record<PortableTokenEncoding, PortableTokenizerAsset> = {
  claude: { kind: 'json', relativePath: 'claude/claude.json' },
  llama3: { kind: 'json', relativePath: 'llama/llama3.json' },
  cohere: { kind: 'json', relativePath: 'cohere/tokenizer.json' },
  deepseek: { kind: 'json', relativePath: 'deepseek/tokenizer.json' },
  'deepseek-v4': { kind: 'json', relativePath: 'deepseek/v4/tokenizer.json' },
  glm4: { kind: 'json', relativePath: 'glm4/tokenizer.json' },
  glm5: { kind: 'json', relativePath: 'glm5/tokenizer.json' },
  // Client parity quirk: GemmaTokenizer is constructed over llama3.json.
  gemma: { kind: 'gemma', relativePath: 'llama/llama3.json' },
  mistral: { kind: 'sentencepiece', relativePath: 'mistral/tokenizer.model' },
  llama: { kind: 'sentencepiece', relativePath: 'llama/llama.model' },
  novelai: { kind: 'sentencepiece', relativePath: 'nai/nerdstash_v2.model' },
  novellist: { kind: 'sentencepiece', relativePath: 'trin/spiece.model' },
}

const nodeRequire = createRequire(
  import.meta.url.startsWith('file:')
    ? import.meta.url
    : path.join(process.cwd(), 'server', 'fastify', 'src', 'prompt', 'tokens.ts'),
)
const loadedTokenizers = new Map<PortableTokenEncoding, SyncTokenizer>()
const tokenizerLoads = new Map<PortableTokenEncoding, Promise<SyncTokenizer>>()
let webTokenizersModule: typeof import('@mlc-ai/web-tokenizers') | undefined

// Server-side o200k routing uses broad model-family prefixes; everything else
// falls back to the conservative `cl100k_base` encoder.
const O200K_PREFIXES: readonly string[] = ['gpt-4o', 'gpt-4.1', 'gpt-5', 'gpt-oss', 'o1', 'o3', 'o4']

const encoders: Partial<Record<TokenEncoding, Tiktoken>> = {}

function isTiktokenEncoding(encoding: TokenEncoding): encoding is 'cl100k_base' | 'o200k_base' {
  return encoding === 'cl100k_base' || encoding === 'o200k_base'
}

function getTiktokenEncoder(encoding: 'cl100k_base' | 'o200k_base'): Tiktoken {
  let enc = encoders[encoding]
  if (!enc) {
    enc = get_encoding(encoding)
    encoders[encoding] = enc
  }
  return enc
}

function exactArrayBuffer(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
}

function tokenizerAssetPath(relativePath: string): string {
  // Match Fastify config's repository-root resolution: the server is launched
  // with the repository as process.cwd(). Vite copies the same public assets to
  // dist for browser serving, while server tokenizers read the sources directly.
  return path.join(process.cwd(), 'public', 'token', relativePath)
}

function loadWebTokenizersModule(): typeof import('@mlc-ai/web-tokenizers') {
  if (webTokenizersModule) return webTokenizersModule
  try {
    const candidate = nodeRequire('@mlc-ai/web-tokenizers') as typeof import('@mlc-ai/web-tokenizers')
    if (
      typeof candidate.Tokenizer?.fromJSON !== 'function' ||
      typeof candidate.Tokenizer?.fromSentencePiece !== 'function'
    ) {
      throw new Error('@mlc-ai/web-tokenizers exposed an empty ESM namespace')
    }
    webTokenizersModule = candidate
  } catch {
    // The package can expose an empty namespace instead of throwing because its
    // UMD entry is marked as ESM. Compile that same source explicitly as CJS.
    webTokenizersModule = nodeRequire('./webTokenizers.cjs') as typeof import('@mlc-ai/web-tokenizers')
  }
  return webTokenizersModule
}

async function loadPortableTokenizer(encoding: PortableTokenEncoding): Promise<SyncTokenizer> {
  const asset = PORTABLE_TOKENIZER_ASSETS[encoding]
  const data = await readFile(tokenizerAssetPath(asset.relativePath))

  if (asset.kind === 'gemma') {
    const { GemmaTokenizer } = await import('@huggingface/transformers')
    return new GemmaTokenizer(JSON.parse(data.toString('utf8')), {})
  }

  // The package ships a UMD entry under `"type": "module"`; native ESM import
  // exposes an empty namespace in Node. The helper above loads its UMD exports
  // while the type-only import keeps this surface typed.
  const { Tokenizer } = loadWebTokenizersModule()
  const arrayBuffer = exactArrayBuffer(data)
  return asset.kind === 'json' ? await Tokenizer.fromJSON(arrayBuffer) : await Tokenizer.fromSentencePiece(arrayBuffer)
}

/** Load and cache a portable tokenizer before entering synchronous counting code. */
export async function ensureTokenizerLoaded(encoding: TokenEncoding): Promise<void> {
  if (isTiktokenEncoding(encoding) || loadedTokenizers.has(encoding)) return

  let loading = tokenizerLoads.get(encoding)
  if (!loading) {
    loading = loadPortableTokenizer(encoding)
    tokenizerLoads.set(encoding, loading)
  }

  try {
    loadedTokenizers.set(encoding, await loading)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to load tokenizer "${encoding}" from public/token: ${detail}`, { cause: error })
  } finally {
    if (tokenizerLoads.get(encoding) === loading) tokenizerLoads.delete(encoding)
  }
}

function encodeWithLoadedTokenizer(text: string, encoding: TokenEncoding): ArrayLike<number> {
  if (isTiktokenEncoding(encoding)) return getTiktokenEncoder(encoding).encode(text)
  const tokenizer = loadedTokenizers.get(encoding)
  if (!tokenizer) {
    throw new Error(
      `Tokenizer "${encoding}" is not loaded. Call await ensureTokenizerLoaded("${encoding}") before synchronous token counting.`,
    )
  }
  return tokenizer.encode(text)
}

/**
 * Route an explicit model id to the server tokenizer's tiktoken encoding.
 * Known OpenAI o-series/GPT families use `o200k_base`; everything else falls
 * back to `cl100k_base`.
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
  return encodeWithLoadedTokenizer(text, encoding).length
}

/** Return token ids for provider-level features such as OpenAI logit bias. */
export function encodeTokens(text: string, encoding: TokenEncoding = 'cl100k_base'): number[] {
  if (!text) return []
  return Array.from(encodeWithLoadedTokenizer(text, encoding))
}

export interface TokenizeChatOptions {
  /** Per-message overhead added to every chat row. Defaults to 4 (matches SPA `ChatTokenizer`). */
  chatAdditionalTokens?: number
  /** Whether to count `name` and add the `name`-present separator. Defaults to `'name'`. */
  useName?: 'name' | 'noName'
  /** Whether to fold `thoughts[]` into the count. */
  countThoughts?: boolean
  /** Whether the effective request model advertises image-input support. */
  supportsInlayImage?: boolean
  /** Database `gptVisionQuality`; only the exact value `'low'` uses the fixed charge. */
  visionQuality?: string
}

/** Port of the baseline `ChatTokenizer.tokenizeMultiModal` charging rules. */
export function tokenizeMultiModal(data: MultiModal, options: TokenizeChatOptions = {}): number {
  const overhead = options.chatAdditionalTokens ?? 4
  if (options.supportsInlayImage !== true) return overhead
  if ((options.visionQuality ?? 'low') === 'low') return 87

  let encoded = overhead
  // Stored asset references can lack dimensions. The baseline treated those as
  // 0x0, which conservatively keeps the base 85-token image charge plus the
  // per-message overhead while adding no 512px tiles.
  let height = data.height ?? 0
  let width = data.width ?? 0

  if (height === width) {
    if (height > 768) {
      height = 768
      width = 768
    }
  } else if (height > width) {
    if (width > 768) {
      width = 768
      height = height * (768 / width)
    }
  } else if (height > 768) {
    height = 768
    width = width * (768 / height)
  }

  const chunkSize = Math.ceil(width / 512) * Math.ceil(height / 512)
  encoded += chunkSize * 2
  encoded += 85
  return encoded
}

/**
 * Count tokens for a single `OpenAIChat`. Mirrors the SPA's
 * `ChatTokenizer.tokenizeChat`: content + overhead, names, every multimodal,
 * and `thoughts[]` when requested.
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
  if (chat.multimodals && chat.multimodals.length > 0) {
    for (const multimodal of chat.multimodals) {
      count += tokenizeMultiModal(multimodal, options)
    }
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
