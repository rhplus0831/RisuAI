import { AGENT_ONLY_LOREBOOK_EXTENSION_KEY, isAgentOnlyLorebookEntry } from '@risuai/shared-core/agent-only-lorebook'
import type { AgentLorebookInput } from './agentPresetRecords'
import type { Chat, character, loreBook } from './storage/database.svelte'
import { safeStructuredClone } from './safeStructuredClone'

export { AGENT_ONLY_LOREBOOK_EXTENSION_KEY, isAgentOnlyLorebookEntry }

export type AgentLorebookInputResolution =
  | {
      status: 'resolved'
      input: AgentLorebookInput
      scope: 'chat' | 'character'
      entry: loreBook
      content: string
    }
  | {
      status: 'optional_missing'
      input: AgentLorebookInput
    }
  | {
      status: 'missing' | 'ambiguous' | 'not_agent_only' | 'invalid_activation' | 'invalid_entry' | 'empty'
      input: AgentLorebookInput
      scope?: 'chat' | 'character'
      message: string
    }

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

export function resolveAgentLorebookInput(
  input: AgentLorebookInput,
  currentChar: Pick<character, 'globalLore'>,
  currentChat: Pick<Chat, 'localLore'>,
): AgentLorebookInputResolution {
  const displayName = input.displayName.trim()
  const chatMatches = matchingEntries(currentChat.localLore, displayName)
  const characterMatches = matchingEntries(currentChar.globalLore, displayName)
  const scope = chatMatches.length > 0 ? 'chat' : 'character'
  const matches = chatMatches.length > 0 ? chatMatches : characterMatches

  if (matches.length === 0) {
    if (!input.required) return { status: 'optional_missing', input }
    return {
      status: 'missing',
      input,
      message: `Required Agent lorebook input was not found: ${displayName}`,
    }
  }
  if (matches.length > 1) {
    return {
      status: 'ambiguous',
      input,
      scope,
      message: `Multiple ${scope}-level lorebook entries use the display name: ${displayName}`,
    }
  }

  const entry = matches[0]
  if (!isAgentOnlyLorebookEntry(entry)) {
    return {
      status: 'not_agent_only',
      input,
      scope,
      message: `Lorebook entry must be marked Agent-only: ${displayName}`,
    }
  }
  if (entry.alwaysActive !== false || entry.key?.trim() || entry.secondkey?.trim()) {
    return {
      status: 'invalid_activation',
      input,
      scope,
      message: `Agent-only lorebook entry must disable Always Active and have no activation keys: ${displayName}`,
    }
  }
  if (entry.mode === 'folder' || entry.mode === 'child') {
    return {
      status: 'invalid_entry',
      input,
      scope,
      message: `Agent-only lorebook input must be a regular lorebook entry: ${displayName}`,
    }
  }
  if (!entry.content?.trim()) {
    return {
      status: 'empty',
      input,
      scope,
      message: `Agent-only lorebook input is empty: ${displayName}`,
    }
  }
  return {
    status: 'resolved',
    input,
    scope,
    entry,
    content: entry.content,
  }
}

function matchingEntries(entries: readonly loreBook[] | undefined, displayName: string): loreBook[] {
  return (entries ?? []).filter((entry) => entry.mode !== 'folder' && entry.comment?.trim() === displayName)
}
