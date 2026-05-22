/**
 * Phase 7 lorebook activation: constant + keyword + recursion.
 * Budget-aware. Returns activation metadata (which entries fired, why) so
 * the route can emit it as part of the `prompt` SSE event.
 *
 * Browser source to port:
 *   - `src/ts/process/lorebook.svelte.ts`
 *   - `src/ts/process/promptAssembly/buildLorebookContext.ts`
 */

export interface LorebookActivationReport {
  // Populated by Phase 7-N when this module gains a real implementation.
  entries: Array<{ id: string; reason: 'constant' | 'keyword' | 'recursion' }>
}

export async function activateLorebook(): Promise<LorebookActivationReport> {
  throw new Error('phase-7 lorebook activation not yet implemented')
}
