export interface ModuleIntegrationAgentPresetReference {
  id?: unknown
  enabled?: unknown
  moduleIntergration?: unknown
}

export function parseModuleIntegration(value: unknown): string[] {
  if (typeof value !== 'string') return []
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

export function combineModuleIntegrations(...values: readonly unknown[]): string {
  const entries = new Set<string>()
  for (const value of values) {
    for (const entry of parseModuleIntegration(value)) entries.add(entry)
  }
  return [...entries].join(', ')
}

export function resolveAgentPresetModuleIntegration(
  presets: readonly ModuleIntegrationAgentPresetReference[] | null | undefined,
  presetId: unknown,
): string {
  if (typeof presetId !== 'string' || presetId.trim().length === 0) return ''
  const normalizedPresetId = presetId.trim()
  const preset = presets?.find((candidate) => candidate.id === normalizedPresetId)
  if (!preset || preset.enabled === false || typeof preset.moduleIntergration !== 'string') return ''
  return preset.moduleIntergration
}
