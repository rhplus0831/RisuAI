import { AGENT_ONLY_LOREBOOK_EXTENSION_KEY, isAgentOnlyLorebookEntry } from '@risuai/shared-core/agent-only-lorebook'
import { resolveAgentLorebookInput, type AgentLorebookInputResolution } from '@risuai/shared-core/agent-lorebook-inputs'
import type { loreBook } from './storage/database.svelte'
import { safeStructuredClone } from './safeStructuredClone'

export { AGENT_ONLY_LOREBOOK_EXTENSION_KEY, isAgentOnlyLorebookEntry, resolveAgentLorebookInput }
export type { AgentLorebookInputResolution }

/** Project Agent-only entries as inert data for Original Risu exports. */
export function lorebookEntriesForOriginalRisuExport(entries: readonly loreBook[]): loreBook[] {
  return entries.map((entry) => {
    const exported = safeStructuredClone(entry)
    if (isAgentOnlyLorebookEntry(exported)) {
      exported.alwaysActive = false
      exported.key = ''
      exported.secondkey = ''
    }
    return exported
  })
}
