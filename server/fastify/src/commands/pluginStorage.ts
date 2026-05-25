import { ValidationError } from '../repository.js'
import { readJsonObject } from './characters.js'

type JsonRecord = Record<string, unknown>

export interface PluginStorageBulkPatch {
  values: JsonRecord
  deleteKeys: string[]
  clear: boolean
}

export function ensurePluginStorageDatabase(database: unknown): JsonRecord {
  const target = readJsonObject(database, 'database')
  ensurePluginCustomStorage(target)
  return target
}

export function ensurePluginCustomStorage(database: JsonRecord): JsonRecord {
  if (!isPlainObject(database.pluginCustomStorage)) {
    database.pluginCustomStorage = {}
  }
  return database.pluginCustomStorage as JsonRecord
}

export function readPluginStorageKey(value: unknown, label = 'key'): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(`${label} must be a non-empty string`)
  }
  return value
}

export function readPluginStorageValue(value: unknown, label = 'value'): unknown {
  validateJsonValue(value, label)
  return value
}

export function readPluginStorageBulkPatch(body: unknown): PluginStorageBulkPatch {
  const input = readJsonObject(body, 'request body')
  const values = input.values === undefined ? {} : readJsonObject(input.values, 'values')
  const deleteKeys =
    input.deleteKeys === undefined ? [] : readPluginStorageKeyList(input.deleteKeys, 'deleteKeys')
  const clear = input.clear === undefined ? false : readPluginStorageClear(input.clear)

  for (const [key, value] of Object.entries(values)) {
    readPluginStorageKey(key, `values key`)
    validateJsonValue(value, `values.${key}`)
  }

  if (!clear && Object.keys(values).length === 0 && deleteKeys.length === 0) {
    throw new ValidationError('bulk plugin storage command must change at least one key')
  }

  return {
    values,
    deleteKeys,
    clear,
  }
}

function readPluginStorageKeyList(input: unknown, label: string): string[] {
  if (!Array.isArray(input)) {
    throw new ValidationError(`${label} must be an array`)
  }

  const seen = new Set<string>()
  return input.map((raw, index) => {
    const key = readPluginStorageKey(raw, `${label}[${index}]`)
    if (seen.has(key)) {
      throw new ValidationError(`Duplicate plugin storage key: ${key}`)
    }
    seen.add(key)
    return key
  })
}

function readPluginStorageClear(input: unknown): boolean {
  if (typeof input !== 'boolean') {
    throw new ValidationError('clear must be a boolean')
  }
  return input
}

function validateJsonValue(value: unknown, label: string): void {
  if (value === undefined) {
    throw new ValidationError(`${label} must be JSON-serializable`)
  }

  try {
    JSON.stringify(value)
  } catch {
    throw new ValidationError(`${label} must be JSON-serializable`)
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
