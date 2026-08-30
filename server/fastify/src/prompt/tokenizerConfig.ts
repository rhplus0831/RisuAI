import type { FastifyDatabase as Database } from './serverTypes.js'
import { LLMFlags, LLMTokenizer } from '@risuai/shared-core/model-types'
import { resolveModelProfile, resolveServerSafeTokenizerFamily } from '@risuai/shared-core/model-profile-resolver'
import { encodingForModel, ensureTokenizerLoaded, type TokenEncoding, type TokenizeChatOptions } from './tokens.js'

const AUTOMATIC_TOKENIZERS = new Set(['', 'tik', 'automatic', 'unknown', '0'])
const CL100K_TOKENIZERS = new Set(['cl100k_base', 'tiktokencl100kbase', '1'])
const O200K_TOKENIZERS = new Set(['o200k_base', 'tiktokeno200base', '2'])
const LOCAL_TOKENIZERS = new Set(['local', '12'])
const GOOGLE_CLOUD_TOKENIZERS = new Set(['googlecloud', 'google-cloud', '10'])
const PLUGIN_TOKENIZERS = new Set(['custom', 'plugin'])

const PORTABLE_TOKENIZER_ALIASES = new Map<string, TokenEncoding>([
  ['mistral', 'mistral'],
  ['3', 'mistral'],
  ['llama', 'llama'],
  ['4', 'llama'],
  ['novelai', 'novelai'],
  ['5', 'novelai'],
  ['claude', 'claude'],
  ['6', 'claude'],
  ['novellist', 'novellist'],
  ['7', 'novellist'],
  ['llama3', 'llama3'],
  ['8', 'llama3'],
  ['gemma', 'gemma'],
  ['9', 'gemma'],
  ['cohere', 'cohere'],
  ['11', 'cohere'],
  ['deepseek', 'deepseek'],
  ['13', 'deepseek'],
  ['deepseek-v4', 'deepseek-v4'],
  ['deepseekv4', 'deepseek-v4'],
  ['14', 'deepseek-v4'],
  ['glm4', 'glm4'],
  ['15', 'glm4'],
  ['glm5', 'glm5'],
  ['16', 'glm5'],
])

function configuredTokenizer(db: Database): string {
  return typeof db.customTokenizer === 'string' ? db.customTokenizer.trim() : ''
}

function usesGoogleTokenizer(db: Database): boolean {
  const model = (db.aiModel ?? '').toLowerCase()
  return (
    resolveServerSafeTokenizerFamily(db, db.aiModel ?? '') === LLMTokenizer.GoogleCloud ||
    model.includes('gemini') ||
    model.endsWith('-vertex') ||
    model.startsWith('google-')
  )
}

export function serverTokenizerUnsupportedReason(db: Database): string | undefined {
  if (db.googleClaudeTokenizing === true && usesGoogleTokenizer(db)) {
    return (
      'Google Cloud tokenization is not supported by Fastify prompt budgeting. ' +
      'Disable it and use Automatic, cl100k_base, or o200k_base.'
    )
  }

  const configured = configuredTokenizer(db)
  const normalized = configured.toLowerCase()
  if (LOCAL_TOKENIZERS.has(normalized)) {
    return (
      `Tokenizer "${configured}" is not supported by Fastify prompt budgeting. ` +
      'Local tokenization requires a GGUF tokenizer model that is not available on the server.'
    )
  }
  if (GOOGLE_CLOUD_TOKENIZERS.has(normalized)) {
    return (
      `Tokenizer "${configured}" is not supported by Fastify prompt budgeting. ` +
      'Google Cloud network token counting is not available in the server prompt pipeline.'
    )
  }
  if (
    db.aiModel === 'custom' &&
    !AUTOMATIC_TOKENIZERS.has(normalized) &&
    !CL100K_TOKENIZERS.has(normalized) &&
    !O200K_TOKENIZERS.has(normalized)
  ) {
    return (
      `Tokenizer "${configured}" is not supported for plugin models by Fastify prompt budgeting. ` +
      'Plugin-provided tokenizers cannot run in the server prompt pipeline.'
    )
  }
  if (
    AUTOMATIC_TOKENIZERS.has(normalized) ||
    CL100K_TOKENIZERS.has(normalized) ||
    O200K_TOKENIZERS.has(normalized) ||
    PORTABLE_TOKENIZER_ALIASES.has(normalized)
  ) {
    return undefined
  }
  if (PLUGIN_TOKENIZERS.has(normalized)) {
    return (
      `Tokenizer "${configured}" is not supported by Fastify prompt budgeting. ` +
      'Plugin-provided tokenizers cannot run in the server prompt pipeline.'
    )
  }
  return (
    `Tokenizer "${configured}" is not supported by Fastify prompt budgeting. ` +
    'Select Automatic or a portable built-in tokenizer.'
  )
}

export function tokenizerEncodingFromDb(db: Database): TokenEncoding {
  const unsupported = serverTokenizerUnsupportedReason(db)
  if (unsupported) throw new Error(unsupported)

  const normalized = configuredTokenizer(db).toLowerCase()
  if (CL100K_TOKENIZERS.has(normalized)) return 'cl100k_base'
  if (O200K_TOKENIZERS.has(normalized)) return 'o200k_base'
  const explicitPortable = PORTABLE_TOKENIZER_ALIASES.get(normalized)

  if (db.aiModel === 'openrouter' || db.aiModel === 'reverse_proxy') {
    // Client parity quirk: only this provider-selection branch maps llama3 to
    // the Llama v2 SentencePiece tokenizer. Its default remains o200k.
    if (explicitPortable === 'llama3') return 'llama'
    return explicitPortable ?? 'o200k_base'
  }
  if (explicitPortable) return explicitPortable

  switch (resolveServerSafeTokenizerFamily(db, db.aiModel ?? '')) {
    case LLMTokenizer.tiktokenO200Base:
      return 'o200k_base'
    case LLMTokenizer.Mistral:
      return 'mistral'
    case LLMTokenizer.Llama:
      return 'llama'
    case LLMTokenizer.NovelAI:
      return 'novelai'
    case LLMTokenizer.Claude:
      return 'claude'
    case LLMTokenizer.NovelList:
      return 'novellist'
    case LLMTokenizer.Llama3:
      return 'llama3'
    case LLMTokenizer.Gemma:
    case LLMTokenizer.GoogleCloud:
      return 'gemma'
    case LLMTokenizer.Cohere:
      return 'cohere'
    case LLMTokenizer.DeepSeek:
      return 'deepseek'
    case LLMTokenizer.DeepSeekV4:
      return 'deepseek-v4'
    case LLMTokenizer.GLM4:
      return 'glm4'
    case LLMTokenizer.GLM5:
      return 'glm5'
    case LLMTokenizer.Unknown:
      return encodingForModel(db.aiModel)
    case LLMTokenizer.tiktokenCl100kBase:
    case LLMTokenizer.Local:
    default:
      return 'cl100k_base'
  }
}

/** Warm the database-selected tokenizer before entering synchronous budget code. */
export async function ensureTokenizerLoadedForDb(db: Database): Promise<void> {
  await ensureTokenizerLoaded(tokenizerEncodingFromDb(db))
}

/**
 * Shared authoritative tokenizer config used by every Fastify prompt-budget
 * phase. Explicit built-in choices win; Automatic uses the Node-clean static
 * model resolver (and the legacy reverse-proxy o200k behavior). Unsupported
 * network, local, and plugin tokenizers are rejected before assembly instead
 * of silently falling back. Message overhead matches the SPA call site:
 *   - `gpt*` models: per-message overhead 5, `useName: 'noName'`.
 *   - everything else: per-message overhead 3, `useName: 'name'`.
 * Unknown and automatic Local model families resolve to `cl100k_base` as a
 * conservative fallback.
 */
export function tokenizerOptionsFromDb(db: Database): {
  encoding: TokenEncoding
  options: TokenizeChatOptions
} {
  const isGpt = (db.aiModel ?? '').startsWith('gpt')
  return {
    encoding: tokenizerEncodingFromDb(db),
    options: {
      chatAdditionalTokens: isGpt ? 5 : 3,
      useName: isGpt ? 'noName' : 'name',
      supportsInlayImage: resolveModelProfile({ database: db }).modelInfo.flags.includes(LLMFlags.hasImageInput),
      visionQuality: db.gptVisionQuality ?? 'low',
    },
  }
}
