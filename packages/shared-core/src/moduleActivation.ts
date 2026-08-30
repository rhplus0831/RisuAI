export const MODULE_ACTIVATION_SOURCES = [
  'global',
  'chat',
  'character',
  'persona',
  'promptPresetIntegration',
  'agentPresetIntegration',
  'legacyIntegration',
] as const

export type ModuleActivationSource = (typeof MODULE_ACTIVATION_SOURCES)[number]

export interface ModuleActivationReference {
  id: string
  namespace?: string | null
}

export interface ModuleActivationState<TModule extends ModuleActivationReference = ModuleActivationReference> {
  module: TModule
  sources: readonly ModuleActivationSource[]
}

export type ModuleActivationIdentifiers = Partial<Record<ModuleActivationSource, readonly string[] | null | undefined>>

export interface ResolveModuleActivationStatesInput<TModule extends ModuleActivationReference> {
  modules: readonly TModule[]
  identifiers: ModuleActivationIdentifiers
}

function sourceMatchesModule(identifiers: Set<string>, module: ModuleActivationReference): boolean {
  return identifiers.has(module.id) || (typeof module.namespace === 'string' && identifiers.has(module.namespace))
}

export function resolveModuleActivationStates<TModule extends ModuleActivationReference>(
  input: ResolveModuleActivationStatesInput<TModule>,
): ModuleActivationState<TModule>[] {
  const identifiersBySource = new Map<ModuleActivationSource, Set<string>>()
  for (const source of MODULE_ACTIVATION_SOURCES) {
    const identifiers = input.identifiers[source]
    if (!identifiers || identifiers.length === 0) continue
    identifiersBySource.set(source, new Set(identifiers))
  }

  const seenModuleIds = new Set<string>()
  const states: ModuleActivationState<TModule>[] = []
  for (const module of input.modules) {
    if (seenModuleIds.has(module.id)) continue
    const sources = MODULE_ACTIVATION_SOURCES.filter((source) => {
      const identifiers = identifiersBySource.get(source)
      return identifiers ? sourceMatchesModule(identifiers, module) : false
    })
    if (sources.length === 0) continue
    seenModuleIds.add(module.id)
    states.push({ module, sources })
  }
  return states
}

export function hasModuleActivationIdentifiers(identifiers: ModuleActivationIdentifiers): boolean {
  return MODULE_ACTIVATION_SOURCES.some((source) => (identifiers[source]?.length ?? 0) > 0)
}

export function moduleActivationIdentifiersKey(identifiers: ModuleActivationIdentifiers): string {
  return JSON.stringify(MODULE_ACTIVATION_SOURCES.map((source) => identifiers[source] ?? []))
}
