import { MODEL_ROLES, type ModelRole } from './modelRoles'

export interface ModelProfileRecord {
  id: string
  name: string
}

export interface LegacyModelRoleProfileBinding {
  mode: 'legacy'
}

export type ModelRoleProfileBinding = LegacyModelRoleProfileBinding
export type ModelRoleProfileMap = Record<ModelRole, ModelRoleProfileBinding>

export class ModelProfileRecordValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ModelProfileRecordValidationError'
  }
}

const MODEL_PROFILE_RECORD_KEYS = new Set(['id', 'name'])
const MODEL_ROLE_PROFILE_BINDING_KEYS = new Set(['mode'])
const MODEL_ROLE_SET = new Set<string>(MODEL_ROLES)

export function createDefaultModelRoleProfiles(): ModelRoleProfileMap {
  return Object.fromEntries(MODEL_ROLES.map((role) => [role, { mode: 'legacy' }])) as ModelRoleProfileMap
}

export function normalizeModelProfiles(value: unknown): ModelProfileRecord[] {
  if (!Array.isArray(value)) return []

  const profiles: ModelProfileRecord[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (!isRecord(item)) continue
    const id = stringOrBlank(item.id)
    if (!id || seen.has(id)) continue
    const name = stringOrBlank(item.name) || id
    profiles.push({ id, name })
    seen.add(id)
  }

  return profiles
}

export function normalizeModelRoleProfiles(value: unknown): ModelRoleProfileMap {
  const source = isRecord(value) ? value : {}
  const profiles = createDefaultModelRoleProfiles()
  for (const role of MODEL_ROLES) {
    if (isLegacyBinding(source[role])) profiles[role] = { mode: 'legacy' }
  }
  return profiles
}

export function readModelProfiles(value: unknown): ModelProfileRecord[] {
  if (!Array.isArray(value)) {
    throw new ModelProfileRecordValidationError('modelProfiles must be an array')
  }

  const profiles: ModelProfileRecord[] = []
  const seen = new Set<string>()
  value.forEach((item, index) => {
    const profile = readModelProfileRecord(item, `modelProfiles[${index}]`)
    if (seen.has(profile.id)) {
      throw new ModelProfileRecordValidationError(`Duplicate model profile id: ${profile.id}`)
    }
    seen.add(profile.id)
    profiles.push(profile)
  })

  return profiles
}

export function readModelRoleProfiles(value: unknown): ModelRoleProfileMap {
  if (!isRecord(value)) {
    throw new ModelProfileRecordValidationError('modelRoleProfiles must be an object')
  }

  const profiles = createDefaultModelRoleProfiles()
  for (const key of Object.keys(value)) {
    if (!MODEL_ROLE_SET.has(key)) {
      throw new ModelProfileRecordValidationError(`Unknown model role profile binding: ${key}`)
    }
  }

  for (const role of MODEL_ROLES) {
    if (Object.prototype.hasOwnProperty.call(value, role)) {
      profiles[role] = readModelRoleProfileBinding(value[role], `modelRoleProfiles.${role}`)
    }
  }

  return profiles
}

function readModelProfileRecord(value: unknown, path: string): ModelProfileRecord {
  if (!isRecord(value)) {
    throw new ModelProfileRecordValidationError(`${path} must be an object`)
  }

  for (const key of Object.keys(value)) {
    if (!MODEL_PROFILE_RECORD_KEYS.has(key)) {
      throw new ModelProfileRecordValidationError(`${path}.${key} is not supported`)
    }
  }

  const id = stringOrBlank(value.id)
  if (!id) {
    throw new ModelProfileRecordValidationError(`${path}.id must be a non-empty string`)
  }
  const name = stringOrBlank(value.name)
  if (!name) {
    throw new ModelProfileRecordValidationError(`${path}.name must be a non-empty string`)
  }

  return { id, name }
}

function readModelRoleProfileBinding(value: unknown, path: string): ModelRoleProfileBinding {
  if (!isRecord(value)) {
    throw new ModelProfileRecordValidationError(`${path} must be an object`)
  }
  for (const key of Object.keys(value)) {
    if (!MODEL_ROLE_PROFILE_BINDING_KEYS.has(key)) {
      throw new ModelProfileRecordValidationError(`${path}.${key} is not supported`)
    }
  }
  if (value.mode !== 'legacy') {
    throw new ModelProfileRecordValidationError(`${path}.mode must be legacy`)
  }
  return { mode: 'legacy' }
}

function isLegacyBinding(value: unknown): value is ModelRoleProfileBinding {
  return isRecord(value) && value.mode === 'legacy'
}

function stringOrBlank(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
