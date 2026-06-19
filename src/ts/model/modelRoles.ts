export const MODEL_ROLES = [
  'chatMain',
  'chatAux',
  'memory',
  'emotion',
  'translate',
  'otherAx',
  'scriptMain',
  'scriptAux',
] as const

export type ModelRole = (typeof MODEL_ROLES)[number]
export type ModelRoleOverrides = Partial<Record<ModelRole, string>>
export type NormalizedModelRoleOverrides = Record<ModelRole, string>
export type ResolvedModelRoleMap = Record<ModelRole, string>

export const LEGACY_SEPERATE_MODEL_KEYS = [
  'memory',
  'emotion',
  'translate',
  'otherAx',
  'scriptMain',
  'scriptAux',
] as const

export type LegacySeperateModelKey = (typeof LEGACY_SEPERATE_MODEL_KEYS)[number]
export type LegacySeperateModelMap = Record<LegacySeperateModelKey, string>

export const LEGACY_FALLBACK_MODEL_KEYS = [
  'model',
  'memory',
  'emotion',
  'translate',
  'otherAx',
  'scriptMain',
  'scriptAux',
] as const

export type LegacyFallbackModelKey = (typeof LEGACY_FALLBACK_MODEL_KEYS)[number]
export type LegacyFallbackModelMap = Record<LegacyFallbackModelKey, string[]>

export type LegacyModelMode =
  | 'model'
  | 'submodel'
  | 'memory'
  | 'emotion'
  | 'translate'
  | 'otherAx'
  | 'scriptMain'
  | 'scriptAux'

export type ModelRoleLike = ModelRole | LegacyModelMode

export interface ModelRoleResolutionSource {
  aiModel?: unknown
  subModel?: unknown
  modelRoles?: unknown
  seperateModelsForAxModels?: unknown
  seperateModels?: unknown
}

const MODEL_ROLE_SET = new Set<string>(MODEL_ROLES)

const MODEL_ROLE_ALIASES: Record<ModelRoleLike, ModelRole> = {
  chatMain: 'chatMain',
  chatAux: 'chatAux',
  memory: 'memory',
  emotion: 'emotion',
  translate: 'translate',
  otherAx: 'otherAx',
  scriptMain: 'scriptMain',
  scriptAux: 'scriptAux',
  model: 'chatMain',
  submodel: 'chatAux',
}

const LEGACY_MODEL_MODE_BY_ROLE: Record<ModelRole, LegacyModelMode> = {
  chatMain: 'model',
  chatAux: 'submodel',
  memory: 'memory',
  emotion: 'emotion',
  translate: 'translate',
  otherAx: 'otherAx',
  scriptMain: 'scriptMain',
  scriptAux: 'scriptAux',
}

const MODEL_ROLE_PROFILE_INHERIT_SOURCE: Partial<Record<ModelRole, ModelRole>> = {
  memory: 'chatAux',
  emotion: 'chatAux',
  translate: 'chatAux',
  otherAx: 'chatAux',
  scriptMain: 'chatMain',
  scriptAux: 'chatAux',
}

export function createDefaultModelRoleOverrides(): NormalizedModelRoleOverrides {
  return Object.fromEntries(MODEL_ROLES.map((role) => [role, ''])) as NormalizedModelRoleOverrides
}

export function createDefaultLegacySeperateModels(): LegacySeperateModelMap {
  return Object.fromEntries(LEGACY_SEPERATE_MODEL_KEYS.map((role) => [role, ''])) as LegacySeperateModelMap
}

export function createDefaultLegacyFallbackModels(): LegacyFallbackModelMap {
  return Object.fromEntries(LEGACY_FALLBACK_MODEL_KEYS.map((role) => [role, []])) as LegacyFallbackModelMap
}

export function normalizeModelRole(role: unknown): ModelRole | null {
  if (typeof role !== 'string') return null
  if (MODEL_ROLE_SET.has(role)) return role as ModelRole
  return MODEL_ROLE_ALIASES[role as ModelRoleLike] ?? null
}

export function modelRoleToLegacyModelMode(role: ModelRole): LegacyModelMode {
  return LEGACY_MODEL_MODE_BY_ROLE[role]
}

export function modelRoleProfileInheritSource(role: ModelRole): ModelRole | null {
  return MODEL_ROLE_PROFILE_INHERIT_SOURCE[role] ?? null
}

export function normalizeModelRoleOverrides(value: unknown): NormalizedModelRoleOverrides {
  const source = isRecord(value) ? value : {}
  const roles = createDefaultModelRoleOverrides()
  for (const role of MODEL_ROLES) {
    roles[role] = stringOrBlank(source[role])
  }
  return roles
}

export function normalizeLegacySeperateModels(value: unknown): LegacySeperateModelMap {
  const source = isRecord(value) ? value : {}
  const models = createDefaultLegacySeperateModels()
  for (const role of LEGACY_SEPERATE_MODEL_KEYS) {
    models[role] = stringOrBlank(source[role])
  }
  return models
}

export function normalizeLegacyFallbackModels(value: unknown): LegacyFallbackModelMap {
  const source = isRecord(value) ? value : {}
  const models = createDefaultLegacyFallbackModels()
  for (const role of LEGACY_FALLBACK_MODEL_KEYS) {
    models[role] = stringArray(source[role]).filter((model) => model.trim() !== '')
  }
  return models
}

export function resolveModelForRole(source: ModelRoleResolutionSource, roleLike: ModelRoleLike): string {
  const role = normalizeModelRole(roleLike)
  if (!role) return ''

  const roleOverride = nonBlankString(normalizeModelRoleOverrides(source.modelRoles)[role])
  if (role !== 'chatMain' && role !== 'chatAux' && roleOverride) return roleOverride

  const seperateModels = isRecord(source.seperateModels) ? source.seperateModels : {}

  switch (role) {
    case 'chatMain':
      return nonBlankString(source.aiModel) ?? ''
    case 'chatAux':
      return nonBlankString(source.subModel) ?? ''
    case 'memory':
    case 'emotion':
    case 'translate':
    case 'otherAx': {
      if (source.seperateModelsForAxModels === true) {
        const legacyModel = nonBlankString(seperateModels[role])
        if (legacyModel) return legacyModel
      }
      return nonBlankString(source.subModel) ?? ''
    }
    case 'scriptMain':
      if (source.seperateModelsForAxModels === true) {
        const legacyModel = nonBlankString(seperateModels.scriptMain)
        if (legacyModel) return legacyModel
      }
      return nonBlankString(source.aiModel) ?? ''
    case 'scriptAux':
      if (source.seperateModelsForAxModels === true) {
        return (
          nonBlankString(seperateModels.scriptAux) ??
          nonBlankString(seperateModels.otherAx) ??
          nonBlankString(source.subModel) ??
          ''
        )
      }
      return nonBlankString(source.subModel) ?? ''
  }
}

export function resolveModelRoles(source: ModelRoleResolutionSource): ResolvedModelRoleMap {
  return Object.fromEntries(
    MODEL_ROLES.map((role) => [role, resolveModelForRole(source, role)]),
  ) as ResolvedModelRoleMap
}

function stringOrBlank(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function nonBlankString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
