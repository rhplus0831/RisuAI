import type { Database } from '../../../../src/ts/storage/database.svelte'
import { encodingForModel, type TokenEncoding, type TokenizeChatOptions } from './tokens.js'

const AUTOMATIC_TOKENIZERS = new Set(['', 'tik', 'automatic', 'unknown', '0'])
const CL100K_TOKENIZERS = new Set(['cl100k_base', 'tiktokencl100kbase', '1'])
const O200K_TOKENIZERS = new Set(['o200k_base', 'tiktokeno200base', '2'])

function configuredTokenizer(db: Database): string {
  return typeof db.customTokenizer === 'string' ? db.customTokenizer.trim() : ''
}

function usesGoogleTokenizer(db: Database): boolean {
  const model = (db.aiModel ?? '').toLowerCase()
  return model.includes('gemini') || model.endsWith('-vertex') || model.startsWith('google-')
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
  if (AUTOMATIC_TOKENIZERS.has(normalized) || CL100K_TOKENIZERS.has(normalized) || O200K_TOKENIZERS.has(normalized)) {
    return undefined
  }
  return (
    `Tokenizer "${configured}" is not supported by Fastify prompt budgeting. ` +
    'Select Automatic, cl100k_base, or o200k_base.'
  )
}

export function tokenizerEncodingFromDb(db: Database): TokenEncoding {
  const unsupported = serverTokenizerUnsupportedReason(db)
  if (unsupported) throw new Error(unsupported)

  const normalized = configuredTokenizer(db).toLowerCase()
  if (CL100K_TOKENIZERS.has(normalized)) return 'cl100k_base'
  if (O200K_TOKENIZERS.has(normalized)) return 'o200k_base'
  if (db.aiModel === 'openrouter' || db.aiModel === 'reverse_proxy') return 'o200k_base'
  return encodingForModel(db.aiModel)
}

/**
 * Shared authoritative tokenizer config used by every Fastify prompt-budget
 * phase. Explicit cl100k/o200k choices win; Automatic keeps model-family
 * routing (and the legacy reverse-proxy o200k behavior). Unsupported imported
 * browser/provider tokenizers are rejected before assembly instead of silently
 * falling back. Message overhead matches the SPA call site:
 *   - `gpt*` models: per-message overhead 5, `useName: 'noName'`.
 *   - everything else: per-message overhead 3, `useName: 'name'`.
 * Non-GPT automatic model strings still resolve to `cl100k_base` as a
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
    },
  }
}
