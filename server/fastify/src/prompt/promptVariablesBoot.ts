import { registerCBS } from '../../../../src/ts/cbs'
import { setChatVarBackend } from '../../../../src/ts/parser/chatVarBackend'
import { registerRisuChatParserMatcher } from '../../../../src/ts/parser/risuChatParser'
import { buildServerCBSArg } from './cbsAdapter.js'
import { chatVarBackend } from './promptScope.js'

/**
 * One-time boot of the server-side prompt variable infrastructure.
 *
 * Wires:
 * - `chatVarBackend` DI seam to the `promptScope` singleton, so the
 *   parser's `#when` evaluator and `calcString`'s `$var` expansion
 *   read from the active request's chat-vars.
 * - `cbs.ts` callbacks (`{{user}}`, `{{char}}`, `{{getvar}}`,
 *   `{{setvar}}`, `{{#when ...}}`, etc.) to the same backend via
 *   `registerCBS({...buildServerCBSArg(), registerFunction})`. The
 *   `registerFunction` points at `registerRisuChatParserMatcher` so
 *   each cbs callback lands in the parser's `matcherMap`.
 *
 * Idempotent: guarded with a module-level `booted` flag so test setups
 * and the production app entry can both call it without
 * re-registering 150+ callbacks.
 */

let booted = false

export function bootPromptVariables(): void {
  if (booted) return
  setChatVarBackend(chatVarBackend)
  registerCBS({
    ...buildServerCBSArg(),
    registerFunction: registerRisuChatParserMatcher,
  })
  booted = true
}
