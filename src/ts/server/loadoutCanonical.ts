export interface CanonicalLoadout {
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

export function isCanonicalLoadout(value: unknown): value is CanonicalLoadout {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
  if (keys.some((key) => !LOADOUT_KEYS.has(key))) return false
  if (REQUIRED_LOADOUT_KEYS.some((key) => !Object.prototype.hasOwnProperty.call(record, key))) return false
  if (!nonBlankString(record.id) || !nonBlankString(record.name)) return false
  if (typeof record.lastUsed !== 'number' || !Number.isFinite(record.lastUsed)) return false
  if (typeof record.favorite !== 'boolean') return false
  if (!isStringArray(record.characterIds) || !isStringArray(record.modules)) return false
  if (!isStringRecord(record.globalVariables)) return false
  for (const key of [
    'presetName',
    'modelPresetId',
    'modelPresetName',
    'promptPresetId',
    'promptPresetName',
    'personaId',
  ] as const) {
    if (typeof record[key] !== 'string') return false
  }
  if (Object.prototype.hasOwnProperty.call(record, 'agentPresetId') && typeof record.agentPresetId !== 'string') {
    return false
  }
  if (Object.prototype.hasOwnProperty.call(record, 'agentPresetName') && typeof record.agentPresetName !== 'string') {
    return false
  }
  if (Object.prototype.hasOwnProperty.call(record, 'togglePresetId') && typeof record.togglePresetId !== 'string') {
    return false
  }
  return true
}

export function isCanonicalLoadoutCollection(value: unknown): value is CanonicalLoadout[] {
  if (!Array.isArray(value)) return false
  const ids = new Set<string>()
  for (const loadout of value) {
    if (!isCanonicalLoadout(loadout) || ids.has(loadout.id)) return false
    ids.add(loadout.id)
  }
  return true
}

function nonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isStringArray(value: unknown): value is string[] {
  if (!Array.isArray(value)) return false
  for (let index = 0; index < value.length; index += 1) {
    if (typeof value[index] !== 'string') return false
  }
  return true
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === 'string')
  )
}
