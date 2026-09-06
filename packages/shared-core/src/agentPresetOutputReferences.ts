export interface AgentPresetOutputReference {
  key: string
  token: string
  index: number
}

export const AGENT_PRESET_OUTPUT_CBS_RE = /\{\{\s*agent::([A-Za-z_][A-Za-z0-9_]{0,63})\s*\}\}/g

export function agentPresetOutputReferences(input: string): AgentPresetOutputReference[] {
  const references: AgentPresetOutputReference[] = []
  for (const match of input.matchAll(AGENT_PRESET_OUTPUT_CBS_RE)) {
    const key = match[1]
    if (!key) continue
    references.push({
      key,
      token: match[0],
      index: match.index ?? 0,
    })
  }
  return references
}

export function expandAgentPresetOutputCbs(input: string, resolveOutput: (key: string) => string | undefined): string {
  return input.replace(AGENT_PRESET_OUTPUT_CBS_RE, (token, key: string) => resolveOutput(key) ?? token)
}
