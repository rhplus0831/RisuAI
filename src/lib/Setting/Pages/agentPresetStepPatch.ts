import type { AgentPresetStepSnapshot } from 'src/ts/server/commands'

export function sparseAgentPresetStepPatch(
  initial: AgentPresetStepSnapshot,
  final: AgentPresetStepSnapshot,
): AgentPresetStepSnapshot {
  const patch: AgentPresetStepSnapshot = {}
  for (const [key, value] of Object.entries(final)) {
    if (key === 'id') continue
    if (JSON.stringify(initial[key]) === JSON.stringify(value)) continue
    patch[key] = value
  }
  return patch
}
