import type { PromptEvent } from './sseEvents.js'

/**
 * Phase 7 root assembly entry point.
 *
 * Walks the preset's `promptTemplate`, substitutes `{{user}}`, `{{char}}`,
 * persona, description, author note, example messages, scenario, and
 * jailbreak. Calls into `lorebook.ts`, `history.ts`, `templates.ts`,
 * `tokens.ts`, `variables.ts`, and `triggers.ts`.
 *
 * Browser source to port:
 *   - `src/ts/process/promptAssembly/renderFinalPrompt.ts`
 *   - `src/ts/process/promptAssembly/buildPlainPromptSections.ts`
 *   - `src/ts/process/promptAssembly/buildStaticPromptSections.ts`
 *   - `src/ts/process/promptAssembly/normalizeTemplate.ts`
 *   - `src/ts/process/promptAssembly/systemizeChat.ts`
 *
 * Returns the assembled prompt payload that becomes the `prompt` SSE event.
 */
export interface AssembleInput {
  chatId: string
  characterId: string
  presetId?: string
  loadoutId?: string
  mode: 'send' | 'continue' | 'preview' | 'preview_prompt' | 'regenerate'
  regenerateMessageId?: string
  userMessage?: string
  resetMessages?: boolean
  expectedRevision?: number
  inlayAssets?: unknown[]
}

export type AssembleResult = Omit<PromptEvent, 'type'>

export async function assemblePrompt(_input: AssembleInput): Promise<AssembleResult> {
  // TODO(phase-7-N): implement. Subsequent slices fill this in as each
  // helper module gains its own port (variables, templates, history, ...).
  throw new Error('phase-7 prompt assembly not yet implemented')
}
