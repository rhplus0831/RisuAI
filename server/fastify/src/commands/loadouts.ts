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
  modelPresetId: string
  modelPresetName: string
  promptPresetId: string
  promptPresetName: string
  agentPresetId?: string
  agentPresetName?: string
  togglePresetId?: string
  personaId: string
}

const REQUIRED_LOADOUT_KEYS = [
  'id',
  'name',
  'lastUsed',
  'favorite',
  'characterIds',
  'modules',
  'globalVariables',
  'presetName',
  'modelPresetId',
  'modelPresetName',
  'promptPresetId',
  'promptPresetName',
  'personaId',
] as const

const LOADOUT_KEYS = new Set<string>([...REQUIRED_LOADOUT_KEYS, 'agentPresetId', 'agentPresetName', 'togglePresetId'])

export function ensureDatabaseObject(database: unknown): JsonRecord {
  if (!database || typeof database !== 'object' || Array.isArray(database)) {
    throw new ValidationError('database must be an object before loadout commands can run')
  }
  return database as JsonRecord
}

export function ensureLoadoutCollection(database: JsonRecord): LoadoutRecord[] {
  if (!Array.isArray(database.loadouts)) {
    throw new ValidationError('loadouts must be an array')
  }
  const seen = new Set<string>()
  const loadouts = database.loadouts.map((raw, index) => {
    const label = `loadouts[${index}]`
    const record = readJsonObject(raw, label) as LoadoutRecord
    validateStoredLoadoutRecord(record, label)
    if (seen.has(record.id)) {
      throw new ValidationError(`Duplicate loadout id: ${record.id}`)
    }
    seen.add(record.id)
    return record
  })

  if (typeof database.lastLoadedLoadoutName !== 'string') {
    throw new ValidationError('lastLoadedLoadoutName must be a string')
  }

  return loadouts
}

export function normalizeLoadoutCollection(database: unknown): void {
  if (!database || typeof database !== 'object' || Array.isArray(database)) return
  const target = database as JsonRecord
  const input = Array.isArray(target.loadouts) ? target.loadouts : []
  const firstIndexById = new Map<string, number>()

  for (let index = 0; index < input.length; index += 1) {
    const id = stableLoadoutId(input[index])
    if (id && !firstIndexById.has(id)) firstIndexById.set(id, index)
  }

  // Reserve retained ids before minting replacements so an early damaged row
  // cannot steal the stable id of a later valid row.
  const usedIds = new Set(firstIndexById.keys())
  target.loadouts = input.map((raw, index) => {
    const loadout = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
    const requestedId = stableLoadoutId(loadout)
    const id =
      requestedId && firstIndexById.get(requestedId) === index
        ? requestedId
        : mintDeterministicLoadoutId(index, usedIds)
    usedIds.add(id)
    return repairLoadoutRecord(
      {
        name: `Loadout ${index + 1}`,
        ...loadout,
      },
      id,
    )
  })

  if (typeof target.lastLoadedLoadoutName !== 'string') {
    target.lastLoadedLoadoutName = ''
  }
}

export function createLoadoutRecord(input: unknown): LoadoutRecord {
  const loadout = readJsonObject(input, 'loadout')
  const record: LoadoutRecord = {
    id: readLoadoutId(loadout.id, 'loadout.id'),
    name: typeof loadout.name === 'string' && loadout.name.trim() ? loadout.name : 'New Loadout',
    lastUsed: numberValue(loadout.lastUsed, Date.now()),
    favorite: booleanValue(loadout.favorite, false),
    characterIds: stringArrayValue(loadout.characterIds, 'loadout.characterIds'),
    modules: stringArrayValue(loadout.modules, 'loadout.modules'),
    globalVariables: stringRecordValue(loadout.globalVariables, 'loadout.globalVariables'),
    presetName: typeof loadout.presetName === 'string' ? loadout.presetName : '',
    modelPresetId: typeof loadout.modelPresetId === 'string' ? loadout.modelPresetId : '',
    modelPresetName: typeof loadout.modelPresetName === 'string' ? loadout.modelPresetName : '',
    promptPresetId: typeof loadout.promptPresetId === 'string' ? loadout.promptPresetId : '',
    promptPresetName: typeof loadout.promptPresetName === 'string' ? loadout.promptPresetName : '',
    personaId: typeof loadout.personaId === 'string' ? loadout.personaId : '',
  }
  if (hasOwn(loadout, 'agentPresetId')) {
    record.agentPresetId = loadout.agentPresetId as string
  }
  if (hasOwn(loadout, 'agentPresetName')) {
    record.agentPresetName = loadout.agentPresetName as string
  }
  if (hasOwn(loadout, 'togglePresetId')) {
    record.togglePresetId = loadout.togglePresetId as string
  }
  validateLoadoutRecord(record, 'loadout')
  return record
}

function repairLoadoutRecord(input: unknown, id: string): LoadoutRecord {
  const loadout = readJsonObject(input, 'loadout')
  const record: LoadoutRecord = {
    id,
    name: typeof loadout.name === 'string' && loadout.name.trim() ? loadout.name : 'New Loadout',
    lastUsed: numberValue(loadout.lastUsed, 0),
    favorite: booleanValue(loadout.favorite, false),
    characterIds: stringArrayValue(loadout.characterIds, 'loadout.characterIds'),
    modules: stringArrayValue(loadout.modules, 'loadout.modules'),
    globalVariables: stringRecordValue(loadout.globalVariables, 'loadout.globalVariables'),
    presetName: typeof loadout.presetName === 'string' ? loadout.presetName : '',
    modelPresetId: typeof loadout.modelPresetId === 'string' ? loadout.modelPresetId : '',
    modelPresetName: typeof loadout.modelPresetName === 'string' ? loadout.modelPresetName : '',
    promptPresetId: typeof loadout.promptPresetId === 'string' ? loadout.promptPresetId : '',
    promptPresetName: typeof loadout.promptPresetName === 'string' ? loadout.promptPresetName : '',
    personaId: typeof loadout.personaId === 'string' ? loadout.personaId : '',
  }
  if (typeof loadout.agentPresetId === 'string') {
    record.agentPresetId = loadout.agentPresetId
  }
  if (typeof loadout.agentPresetName === 'string') {
    record.agentPresetName = loadout.agentPresetName
  }
  if (typeof loadout.togglePresetId === 'string') {
    record.togglePresetId = loadout.togglePresetId
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

/** Validate one persisted loadout exactly as stored without adding defaults. */
export function validateStoredLoadoutRecord(record: JsonRecord, label = 'loadout'): asserts record is LoadoutRecord {
  for (const key of Object.keys(record)) {
    if (!LOADOUT_KEYS.has(key)) {
      throw new ValidationError(`${label}.${key} is not a supported loadout field`)
    }
  }
  for (const key of REQUIRED_LOADOUT_KEYS) {
    if (!hasOwn(record, key)) {
      throw new ValidationError(`${label}.${key} is required`)
    }
  }
  validateLoadoutRecord(record, label)
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
  for (const key of Object.keys(record)) {
    if (!LOADOUT_KEYS.has(key)) {
      throw new ValidationError(`${label}.${key} is not a supported loadout field`)
    }
  }
  if ('id' in record && (typeof record.id !== 'string' || record.id.trim() === '')) {
    throw new ValidationError(`${label}.id must be a non-empty string`)
  }
  if ('name' in record && (typeof record.name !== 'string' || record.name.trim() === '')) {
    throw new ValidationError(`${label}.name must be a non-empty string`)
  }
  for (const key of [
    'presetName',
    'modelPresetId',
    'modelPresetName',
    'promptPresetId',
    'promptPresetName',
    'agentPresetId',
    'agentPresetName',
    'togglePresetId',
    'personaId',
  ]) {
    if (key in record && typeof record[key] !== 'string') {
      throw new ValidationError(`${label}.${key} must be a string`)
    }
  }
  if ('lastUsed' in record && (typeof record.lastUsed !== 'number' || !Number.isFinite(record.lastUsed))) {
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

function assertStringRecord(value: unknown, label: string): asserts value is Record<string, string> {
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

function stableLoadoutId(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const id = (value as JsonRecord).id
  return typeof id === 'string' && id.trim() ? id : null
}

function mintDeterministicLoadoutId(index: number, usedIds: ReadonlySet<string>): string {
  const base = `loadout-${index + 1}`
  if (!usedIds.has(base)) return base

  let suffix = 2
  while (usedIds.has(`${base}-${suffix}`)) suffix += 1
  return `${base}-${suffix}`
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

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}
