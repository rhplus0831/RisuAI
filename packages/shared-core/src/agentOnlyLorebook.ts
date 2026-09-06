export const AGENT_ONLY_LOREBOOK_EXTENSION_KEY = 'risu_agent_only'

export interface AgentOnlyLorebookEntryLike {
  agentOnly?: unknown
  extentions?: unknown
}

export function isAgentOnlyLorebookEntry(entry: AgentOnlyLorebookEntryLike | undefined | null): boolean {
  if (!entry) return false
  if (entry.agentOnly === true) return true
  const extensions = entry.extentions as Record<string, unknown> | undefined
  return extensions?.[AGENT_ONLY_LOREBOOK_EXTENSION_KEY] === true
}
