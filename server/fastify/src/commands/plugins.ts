import { EntityNotFoundError, ValidationError } from '../repository.js'
import { readJsonObject } from './characters.js'

type JsonRecord = Record<string, unknown>

export interface PluginRecord extends JsonRecord {
  name: string
  script: string
  arguments: Record<string, 'int' | 'string' | string[]>
  realArg: Record<string, string | number>
  customLink: Array<{ link: string; hoverText?: string }>
  argMeta: Record<string, Record<string, string>>
  version: '3.0'
  displayName?: string
  versionOfPlugin?: string
  updateURL?: string
  enabled?: boolean
  allowedIPC?: string[]
}

const PLUGIN_PATCH_EXCLUDED_KEYS = new Set(['name'])
const PLUGIN_PATCH_DELETABLE_KEYS = new Set(['displayName', 'versionOfPlugin', 'updateURL', 'enabled', 'allowedIPC'])

const PLUGIN_SCALAR_FIELD_TYPES = new Map<string, readonly string[]>([
  ['script', ['string']],
  ['displayName', ['string', 'undefined']],
  ['versionOfPlugin', ['string', 'undefined']],
  ['updateURL', ['string', 'undefined']],
  ['enabled', ['boolean', 'undefined']],
])

export function ensurePluginCommandDatabase(database: unknown): JsonRecord {
  const target = readJsonObject(database, 'database')
  ensurePluginRecords(target)
  if (typeof target.currentPluginProvider !== 'string') {
    target.currentPluginProvider = ''
  }
  return target
}

export function ensurePluginRecords(database: JsonRecord): PluginRecord[] {
  if (!Array.isArray(database.plugins)) {
    database.plugins = []
  }

  const seen = new Set<string>()
  const plugins = (database.plugins as unknown[]).map((raw, index) => {
    const plugin = createPluginRecord(raw, `plugins[${index}]`)
    if (seen.has(plugin.name)) {
      throw new ValidationError(`Duplicate plugin name: ${plugin.name}`)
    }
    seen.add(plugin.name)
    return plugin
  })
  database.plugins = plugins
  return plugins
}

export function createPluginRecord(input: unknown, label = 'plugin'): PluginRecord {
  const plugin = readJsonObject(input, label) as PluginRecord
  validatePluginRecord(plugin, label)
  return plugin
}

export function readPluginId(value: unknown, label = 'pluginId'): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(`${label} must be a non-empty string`)
  }
  return value
}

export function readPluginPatch(input: unknown): JsonRecord {
  const patch = readJsonObject(input, 'patch')
  if (Object.keys(patch).length === 0) {
    throw new ValidationError('patch must include at least one plugin field')
  }
  validatePluginPatch(patch, 'patch', { allowDeleteSentinel: true })
  return patch
}

export function readPluginEnabled(input: unknown): boolean {
  if (typeof input !== 'boolean') {
    throw new ValidationError('enabled must be a boolean')
  }
  return input
}

export function readPluginProvider(input: unknown): string {
  if (typeof input !== 'string') {
    throw new ValidationError('provider must be a string')
  }
  return input
}

export function readPluginIdList(input: unknown, label = 'pluginIds'): string[] {
  if (!Array.isArray(input)) {
    throw new ValidationError(`${label} must be an array`)
  }
  return input.map((id, index) => readPluginId(id, `${label}[${index}]`))
}

export function requirePluginIndex(plugins: readonly PluginRecord[], pluginId: string): number {
  const index = plugins.findIndex((plugin) => plugin.name === pluginId)
  if (index === -1) {
    throw new EntityNotFoundError(`Plugin not found: ${pluginId}`)
  }
  return index
}

export function validateFullPluginOrder(plugins: readonly PluginRecord[], pluginIds: readonly string[]): void {
  const existing = new Set(plugins.map((plugin) => plugin.name))
  const seen = new Set<string>()
  for (const pluginId of pluginIds) {
    if (!existing.has(pluginId)) {
      throw new ValidationError(`Unknown plugin id in pluginIds: ${pluginId}`)
    }
    if (seen.has(pluginId)) {
      throw new ValidationError(`Duplicate plugin id in pluginIds: ${pluginId}`)
    }
    seen.add(pluginId)
  }
  if (seen.size !== existing.size) {
    throw new ValidationError('pluginIds must include every plugin')
  }
}

function validatePluginRecord(record: JsonRecord, label: string): void {
  if (typeof record.name !== 'string' || record.name.trim() === '') {
    throw new ValidationError(`${label}.name must be a non-empty string`)
  }
  validatePluginPatch(record, label, { allowName: true })
  validatePluginVersion(record.version, `${label}.version`, true)
}

function validatePluginPatch(
  record: JsonRecord,
  label: string,
  options: { allowName?: boolean; allowDeleteSentinel?: boolean } = {},
): void {
  for (const key of Object.keys(record)) {
    if (!options.allowName && PLUGIN_PATCH_EXCLUDED_KEYS.has(key)) {
      throw new ValidationError(`${label}.${key} cannot be changed by plugin commands`)
    }

    if (record[key] === null) {
      if (!options.allowDeleteSentinel || !PLUGIN_PATCH_DELETABLE_KEYS.has(key)) {
        throw new ValidationError(`${label}.${key} cannot be deleted`)
      }
      continue
    }

    const allowedTypes = PLUGIN_SCALAR_FIELD_TYPES.get(key)
    if (allowedTypes) {
      const value = record[key]
      const type = value === undefined ? 'undefined' : typeof value
      if (!allowedTypes.includes(type)) {
        throw new ValidationError(`${label}.${key} must be ${describeTypes(allowedTypes)}`)
      }
      continue
    }

    switch (key) {
      case 'name':
        if (typeof record.name !== 'string' || record.name.trim() === '') {
          throw new ValidationError(`${label}.name must be a non-empty string`)
        }
        break
      case 'version':
        validatePluginVersion(record.version, `${label}.version`)
        break
      case 'arguments':
        validatePluginArguments(record.arguments, `${label}.arguments`)
        break
      case 'realArg':
        validatePluginRealArgs(record.realArg, `${label}.realArg`)
        break
      case 'argMeta':
        validatePluginArgMeta(record.argMeta, `${label}.argMeta`)
        break
      case 'customLink':
        validatePluginCustomLinks(record.customLink, `${label}.customLink`)
        break
      case 'allowedIPC':
        validateStringArray(record.allowedIPC, `${label}.allowedIPC`)
        break
    }
  }

  if ('arguments' in record && record.arguments === undefined) {
    throw new ValidationError(`${label}.arguments must be an object`)
  }
  if ('realArg' in record && record.realArg === undefined) {
    throw new ValidationError(`${label}.realArg must be an object`)
  }
  if ('argMeta' in record && record.argMeta === undefined) {
    throw new ValidationError(`${label}.argMeta must be an object`)
  }
  if ('customLink' in record && record.customLink === undefined) {
    throw new ValidationError(`${label}.customLink must be an array`)
  }
}

function validatePluginVersion(value: unknown, label: string, required = false): void {
  if (value === undefined && !required) return
  if (value !== '3.0') {
    throw new ValidationError(`${label} must be "3.0"; Fastify does not support V2-series plugins`)
  }
}

function validatePluginArguments(value: unknown, label: string): void {
  const record = readPlainObject(value, label)
  for (const [key, arg] of Object.entries(record)) {
    if (typeof arg === 'string') {
      if (arg !== 'int' && arg !== 'string') {
        throw new ValidationError(`${label}.${key} must be "int", "string", or an array`)
      }
      continue
    }
    validateStringArray(arg, `${label}.${key}`)
  }
}

function validatePluginRealArgs(value: unknown, label: string): void {
  const record = readPlainObject(value, label)
  for (const [key, arg] of Object.entries(record)) {
    if (typeof arg !== 'string' && typeof arg !== 'number') {
      throw new ValidationError(`${label}.${key} must be a string or number`)
    }
  }
}

function validatePluginArgMeta(value: unknown, label: string): void {
  const record = readPlainObject(value, label)
  for (const [key, meta] of Object.entries(record)) {
    const metaRecord = readPlainObject(meta, `${label}.${key}`)
    for (const [metaKey, metaValue] of Object.entries(metaRecord)) {
      if (typeof metaValue !== 'string') {
        throw new ValidationError(`${label}.${key}.${metaKey} must be a string`)
      }
    }
  }
}

function validatePluginCustomLinks(value: unknown, label: string): void {
  if (!Array.isArray(value)) {
    throw new ValidationError(`${label} must be an array`)
  }
  value.forEach((raw, index) => {
    const link = readPlainObject(raw, `${label}[${index}]`)
    if (typeof link.link !== 'string') {
      throw new ValidationError(`${label}[${index}].link must be a string`)
    }
    if ('hoverText' in link && link.hoverText !== undefined && typeof link.hoverText !== 'string') {
      throw new ValidationError(`${label}[${index}].hoverText must be a string`)
    }
  })
}

function validateStringArray(value: unknown, label: string): void {
  if (!Array.isArray(value)) {
    throw new ValidationError(`${label} must be an array`)
  }
  value.forEach((item, index) => {
    if (typeof item !== 'string') {
      throw new ValidationError(`${label}[${index}] must be a string`)
    }
  })
}

function readPlainObject(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(`${label} must be an object`)
  }
  return value as JsonRecord
}

function describeTypes(types: readonly string[]): string {
  return types.join(' or ')
}
