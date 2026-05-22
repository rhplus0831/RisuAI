/**
 * Phase 7 variable expansion. `risuChatParser` port, `#when`, conditional
 * cards.
 *
 * Browser source to port:
 *   - `src/ts/parser/parser.svelte.ts` (`risuChatParser`)
 *   - `src/ts/process/cbs.ts` (callbacks consumed by the parser)
 *   - `src/ts/process/dynamicutils/`
 *
 * Slice 7-2 (next): ship the pure-function port of `risuChatParser` for
 * use by the assembly modules and the route's `preview-prompt` shortcut.
 */

export interface ExpandContext {
  charName?: string
  userName?: string
  // Phase 7-2 fills in the remaining substitution variables.
}

export function expandVariables(_input: string, _ctx: ExpandContext): string {
  throw new Error('phase-7 variable expansion not yet implemented')
}
