/**
 * Phase 7 chat history shaping: role mapping, multimodal fold-in,
 * ChatML-style assembly.
 *
 * Browser source to port:
 *   - `src/ts/process/promptAssembly/buildHistoryWindow.ts`
 *   - `src/ts/process/promptAssembly/formatHistoryMessage.ts`
 *   - `src/ts/process/promptAssembly/buildMemoryWindow.ts`
 */

export interface ShapedHistory {
  messages: Array<{ role: string; content: unknown }>
}

export async function shapeHistory(): Promise<ShapedHistory> {
  throw new Error('phase-7 history shaping not yet implemented')
}
