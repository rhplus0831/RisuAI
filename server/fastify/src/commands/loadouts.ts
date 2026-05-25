import { randomUUID } from 'node:crypto'
import { EntityNotFoundError, ValidationError } from '../repository.js'

type JsonRecord = Record<string, unknown>

export interface LoadoutRecord extends JsonRecord {
  id: string
  name: string
  lastUsed: number
  favorite: boolean
  characterIds: string[]
  modules: string[]
  globalVariables: Record<string, string>
  presetName: string
  personaId: string
}

export function ensureDatabaseObject(database: unknown): JsonRecord {
  if (!database || typeof database !== 'object' || Array.isArray(database)) {
    throw new ValidationError('database must be an object before loadout commands can run')
  }
  return database as JsonRecord
}

export function ensureLoadoutCollection(database: JsonRecord): LoadoutRecord[] {
  if (!Array.isArray(database.loadouts)) {
    database.loadouts = []
  }

  const seen = new Set<string>()
  const loadouts = (database.loadouts as unknown[]).map((raw, index) => {
    const loadout = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
    const record = createLoadoutRecord({
      name: `Loadout ${index + 1}`,
      ...loadout,
    })
    if (seen.has(record.id)) {
      record.id = randomUUID()
    }
    seen.add(record.id)
    return record
  })
  database.loadouts = loadouts

  if (typeof database.lastLoadedLoadoutName !== 'string') {
    database.lastLoadedLoadoutName = ''
  }

  return loadouts
}

export function normalizeLoadoutCollection(database: unknown): void {
  if (!database || typeof database !== 'object' || Array.isArray(database)) return
  ensureLoadoutCollection(database as JsonRecord)
}

export function createLoadoutRecord(input: unknown): LoadoutRecord {
  const loadout = readJsonObject(input, 'loadout')
  const record: LoadoutRecord = {
    id: typeof loadout.id === 'string' && loadout.id.trim() ? loadout.id : randomUUID(),
    name: typeof loadout.name === 'string' && loadout.name.trim() ? loadout.name : 'New Loadout',
    lastUsed: numberValue(loadout.lastUsed, Date.now()),
    favorite: booleanValue(loadout.favorite, false),
    characterIds: stringArrayValue(loadout.characterIds, 'loadout.characterIds'),
    modules: stringArrayValue(loadout.modules, 'loadout.modules'),
    globalVariables: stringRecordValue(loadout.globalVariables, 'loadout.globalVariables'),
    presetName: typeof loadout.presetName === 'string' ? loadout.presetName : '',
    personaId: typeof loadout.personaId === 'string' ? loadout.personaId : '',
  }
  validateLoadoutRecord(record, 'loadout')
  return record
}

export function readLoadoutPatch(input: unknown): JsonRecord {
  const patch = readJsonObject(input, 'patch')
  if (Object.keys(patch).length === 0) {
    throw new ValidationError('patch must include at least one loadout field')
  }
  validateLoadoutRecord(patch, 'patch')
  return patch
}

export function readLoadoutId(value: unknown, label = 'loadoutId'): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(`${label} must be a non-empty string`)
  }
  return value
}

export function readOptionalBoolean(value: unknown, label: string, fallback: boolean): boolean {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') {
    throw new ValidationError(`${label} must be a boolean`)
  }
  return value
}

export function readOptionalTimestamp(value: unknown, label: string): number {
  if (value === undefined) return Date.now()
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ValidationError(`${label} must be a finite number`)
  }
  return value
}

export function readOptionalCharacterId(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError('characterId must be a non-empty string when provided')
  }
  return value
}

export function readJsonObject(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(`${label} must be an object`)
  }
  validateJsonValue(label, value)
  return value as JsonRecord
}

export function findLoadoutIndex(loadouts: readonly LoadoutRecord[], loadoutId: string): number {
  return loadouts.findIndex((loadout) => loadout.id === loadoutId)
}

export function requireLoadoutIndex(loadouts: readonly LoadoutRecord[], loadoutId: string): number {
  const index = findLoadoutIndex(loadouts, loadoutId)
  if (index === -1) {
    throw new EntityNotFoundError(`Loadout not found: ${loadoutId}`)
  }
  return index
}

function validateLoadoutRecord(record: JsonRecord, label: string): void {
  if ('id' in record && (typeof record.id !== 'string' || record.id.trim() === '')) {
    throw new ValidationError(`${label}.id must be a non-empty string`)
  }
  for (const key of ['name', 'presetName', 'personaId']) {
    if (key in record && typeof record[key] !== 'string') {
      throw new ValidationError(`${label}.${key} must be a string`)
    }
  }
  if (
    'lastUsed' in record &&
    (typeof record.lastUsed !== 'number' || !Number.isFinite(record.lastUsed))
  ) {
    throw new ValidationError(`${label}.lastUsed must be a finite number`)
  }
  if ('favorite' in record && typeof record.favorite !== 'boolean') {
    throw new ValidationError(`${label}.favorite must be a boolean`)
  }
  if ('characterIds' in record) {
    assertStringArray(record.characterIds, `${label}.characterIds`)
  }
  if ('modules' in record) {
    assertStringArray(record.modules, `${label}.modules`)
  }
  if ('globalVariables' in record) {
    assertStringRecord(record.globalVariables, `${label}.globalVariables`)
  }
}

function assertStringArray(value: unknown, label: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new ValidationError(`${label} must be an array of strings`)
  }
}

function assertStringRecord(
  value: unknown,
  label: string,
): asserts value is Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(`${label} must be an object with string values`)
  }
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'string') {
      throw new ValidationError(`${label}.${key} must be a string`)
    }
  }
}

function stringArrayValue(value: unknown, label: string): string[] {
  if (value === undefined) return []
  assertStringArray(value, label)
  return value
}

function stringRecordValue(value: unknown, label: string): Record<string, string> {
  if (value === undefined) return {}
  assertStringRecord(value, label)
  return value
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function validateJsonValue(label: string, value: unknown): void {
  try {
    JSON.stringify(value)
  } catch {
    throw new ValidationError(`${label} must be JSON-serializable`)
  }
  if (value === undefined) {
    throw new ValidationError(`${label} must be JSON-serializable`)
  }
}
