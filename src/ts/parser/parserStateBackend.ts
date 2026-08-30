import type { Database } from '../storage/database.svelte'

/**
 * DI seam for the parser's optional fallbacks against the client database /
 * `selectedCharID`. Lifted out of `risuChatParser` so the parser can be
 * imported into the Fastify server without pulling Svelte runes.
 *
 * `matcherArg.db` is set from `arg.db ?? getDefaultDatabase()`. No CBS
 * callback actually reads `matcherArg.db` (callbacks use `getDatabase()`
 * through the `registerCBS` closure), so the default of `null` is safe;
 * the field exists for type-shape compatibility only.
 *
 * `getDefaultSelectedCharID` is consulted only when
 * `arg.tokenizeAccurate` is true and the caller didn't pass `chara`
 * (used by `tokenizeAccurate()` in `src/ts/tokenizer.ts` during the
 * browser tokenizer warm-up). Returning `0` on the server is fine
 * because server-side prompt assembly never sets `tokenizeAccurate`.
 *
 * The browser registers a characters-only resource projection and
 * `get(selectedCharID)` at `chatVar.svelte`'s module init. That preserves the
 * tokenizer fallback without exposing the aggregate resource database.
 */

export interface ParserStateBackend {
  getDefaultDatabase: () => Database | null
  getDefaultSelectedCharID: () => number
}

const defaultBackend: ParserStateBackend = {
  getDefaultDatabase: () => null,
  getDefaultSelectedCharID: () => 0,
}

let backend: ParserStateBackend = defaultBackend

export function setParserStateBackend(impl: ParserStateBackend): void {
  backend = impl
}

export function getDefaultDatabase(): Database | null {
  return backend.getDefaultDatabase()
}

export function getDefaultSelectedCharID(): number {
  return backend.getDefaultSelectedCharID()
}
