/**
 * Phase 7 trigger hooks: `editInput` and `editRequest` into the trigger
 * sandbox from Phase 6.
 *
 * Browser source to port:
 *   - `src/ts/process/triggers.ts`
 *   - `src/ts/process/scripts.ts`
 *
 * The plugin sandbox itself stays browser-side for the migration scope.
 */

export interface TriggerHookResult {
  edited: boolean
  // Phase 7-N: extend with the edit payload + side-effect emissions.
}

export async function runEditInput(): Promise<TriggerHookResult> {
  throw new Error('phase-7 editInput hook not yet implemented')
}

export async function runEditRequest(): Promise<TriggerHookResult> {
  throw new Error('phase-7 editRequest hook not yet implemented')
}
