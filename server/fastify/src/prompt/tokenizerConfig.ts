import type { Database } from '../../../../src/ts/storage/database.svelte'
import { encodingForModel, type TokenEncoding, type TokenizeChatOptions } from './tokens.js'

/**
 * Shared tokenizer config derived from `db.aiModel`, used by
 * `history.ts` (7-5e) and `preflight.ts` (7-8b). Matches the SPA
 * call site at `src/ts/process/sendChatContext.ts:92-103`:
 *   - `gpt*` models: per-message overhead 5, `useName: 'noName'`.
 *   - everything else: per-message overhead 3, `useName: 'name'`.
 * The encoding falls out of `encodingForModel(db.aiModel)`; non-gpt
 * model strings still resolve to `cl100k_base` as a conservative
 * fallback.
 */
export function tokenizerOptionsFromDb(db: Database): {
  encoding: TokenEncoding
  options: TokenizeChatOptions
} {
  const isGpt = (db.aiModel ?? '').startsWith('gpt')
  return {
    encoding: encodingForModel(db.aiModel),
    options: {
      chatAdditionalTokens: isGpt ? 5 : 3,
      useName: isGpt ? 'noName' : 'name',
    },
  }
}
