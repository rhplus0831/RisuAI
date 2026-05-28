import { randomUUID } from 'node:crypto'
import { EntityNotFoundError, ValidationError } from '../repository.js'
import { validateAssetTriples } from './assets.js'
import {
  type CharacterRecord,
  ensureCharacterCollection,
  readCharacterId,
  readJsonObject,
} from './characters.js'
import { ensureCharacterChats } from './chats.js'

type JsonRecord = Record<string, unknown>

export interface ModuleRecord extends JsonRecord {
  id: string
  name: string
  description: string
  mcp?: unknown
}

const MODULE_PATCH_EXCLUDED_KEYS = new Set(['id', 'mcp', 'lorebook', 'regex', 'trigger'])

const MODULE_SCALAR_FIELD_TYPES = new Map<string, readonly string[]>([
  ['name', ['string']],
  ['description', ['string']],
  ['namespace', ['string', 'undefined']],
  ['lowLevelAccess', ['boolean', 'undefined']],
  ['hideIcon', ['boolean', 'undefined']],
  ['backgroundEmbedding', ['string', 'undefined']],
  ['customModuleToggle', ['string', 'undefined']],
  ['cjs', ['string', 'undefined']],
])

export function ensureModuleCommandDatabase(database: unknown): JsonRecord {
  const target = readJsonObject(database, 'database')
  ensureModuleRecords(target)
  ensureEnabledModules(target)
  ensureCharacterCollection(target)
  return target
}

export function ensureModuleRecords(database: JsonRecord): ModuleRecord[] {
  if (!Array.isArray(database.modules)) {
    database.modules = []
  }

  const seen = new Set<string>()
  const modules = (database.modules as unknown[]).map((raw, index) => {
    const module = repairModuleRecord(
      {
        name: `Module ${index + 1}`,
        description: '',
        ...readOptionalJsonObject(raw),
      },
      `module[${index}]`,
      { allowMcp: true },
    )
    if (seen.has(module.id)) {
      module.id = randomUUID()
    }
    seen.add(module.id)
    return module
  })
  database.modules = modules
  return modules
}

export function createModuleRecord(
  input: unknown,
  label = 'module',
  options: { allowMcp?: boolean } = {},
  assetOptions: { assetDataDir?: string } = {},
): ModuleRecord {
  const module = readJsonObject(input, label) as ModuleRecord
  module.id = readModuleId(module.id, `${label}.id`)
  module.name = typeof module.name === 'string' && module.name.trim() ? module.name : 'New Module'
  module.description = typeof module.description === 'string' ? module.description : ''
  validateModuleRecord(module, label, options, assetOptions)
  return module
}

function repairModuleRecord(
  input: unknown,
  label = 'module',
  options: { allowMcp?: boolean } = {},
  assetOptions: { assetDataDir?: string } = {},
): ModuleRecord {
  const module = readJsonObject(input, label) as ModuleRecord
  module.id = typeof module.id === 'string' && module.id.trim() ? module.id : randomUUID()
  module.name = typeof module.name === 'string' && module.name.trim() ? module.name : 'New Module'
  module.description = typeof module.description === 'string' ? module.description : ''
  validateModuleRecord(module, label, options, assetOptions)
  return module
}

export function readModuleId(value: unknown, label = 'moduleId'): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(`${label} must be a non-empty string`)
  }
  return value
}

export function readModulePatch(
  input: unknown,
  options: { assetDataDir?: string } = {},
): JsonRecord {
  const patch = readJsonObject(input, 'patch')
  if (Object.keys(patch).length === 0) {
    throw new ValidationError('patch must include at least one module field')
  }
  validateModulePatch(patch, 'patch', {}, options)
  return patch
}

export function readModuleIdList(input: unknown, label = 'moduleIds'): string[] {
  if (!Array.isArray(input)) {
    throw new ValidationError(`${label} must be an array`)
  }
  return input.map((id, index) => readModuleId(id, `${label}[${index}]`))
}

export function readModuleEnabled(input: unknown): boolean {
  if (typeof input !== 'boolean') {
    throw new ValidationError('enabled must be a boolean')
  }
  return input
}

export function requireModuleIndex(modules: readonly ModuleRecord[], moduleId: string): number {
  const index = modules.findIndex((module) => module.id === moduleId && !module.mcp)
  if (index === -1) {
    throw new EntityNotFoundError(`Module not found: ${moduleId}`)
  }
  return index
}

export function validateFullModuleOrder(
  modules: readonly ModuleRecord[],
  moduleIds: readonly string[],
): void {
  const existing = new Set(modules.map((module) => module.id))
  const seen = new Set<string>()
  for (const moduleId of moduleIds) {
    if (!existing.has(moduleId)) {
      throw new ValidationError(`Unknown module id in moduleIds: ${moduleId}`)
    }
    if (seen.has(moduleId)) {
      throw new ValidationError(`Duplicate module id in moduleIds: ${moduleId}`)
    }
    seen.add(moduleId)
  }
  if (seen.size !== existing.size) {
    throw new ValidationError('moduleIds must include every module')
  }
}

/**
 * Validate the full replacement set of a character's module links. The list is
 * the new set of links, so it supports add, remove, and reorder in one command:
 * every id must reference a known module and the list must be duplicate-free,
 * but it does not need to match the character's existing links.
 */
export function validateCharacterModuleLinks(
  modules: readonly ModuleRecord[],
  moduleIds: readonly string[],
): void {
  validateNormalModuleLinks(modules, moduleIds, 'moduleIds')
}

export function validateNormalModuleLinks(
  modules: readonly ModuleRecord[],
  moduleIds: readonly string[],
  label = 'moduleIds',
): void {
  const available = new Set(modules.filter((module) => !module.mcp).map((module) => module.id))
  const seen = new Set<string>()
  for (const moduleId of moduleIds) {
    if (!available.has(moduleId)) {
      throw new ValidationError(`Unknown module id in ${label}: ${moduleId}`)
    }
    if (seen.has(moduleId)) {
      throw new ValidationError(`Duplicate module id in ${label}: ${moduleId}`)
    }
    seen.add(moduleId)
  }
}

export function removeModuleReferences(database: JsonRecord, moduleId: string): void {
  database.enabledModules = ensureEnabledModules(database).filter((id) => id !== moduleId)
  for (const character of ensureCharacterCollection(database)) {
    character.modules = readStringArray(
      character.modules,
      `character ${character.chaId}.modules`,
    ).filter((id) => id !== moduleId)
    for (const chat of ensureCharacterChats(character)) {
      chat.modules = readStringArray(chat.modules, `chat ${chat.id}.modules`).filter(
        (id) => id !== moduleId,
      )
    }
  }

  if (Array.isArray(database.loadouts)) {
    for (const loadout of database.loadouts) {
      if (!loadout || typeof loadout !== 'object' || Array.isArray(loadout)) continue
      const record = loadout as JsonRecord
      if (Array.isArray(record.modules)) {
        record.modules = record.modules.filter((id) => id !== moduleId)
      }
    }
  }
}

export function ensureEnabledModules(database: JsonRecord): string[] {
  database.enabledModules = readStringArray(database.enabledModules, 'enabledModules')
  return database.enabledModules as string[]
}

export function findCharacterForModuleCommand(
  database: JsonRecord,
  characterId: string,
): CharacterRecord {
  const characters = ensureCharacterCollection(database)
  const character = characters.find((candidate) => candidate.chaId === characterId)
  if (!character) {
    throw new EntityNotFoundError(`Character not found: ${characterId}`)
  }
  return character
}

export { readCharacterId }

function validateModuleRecord(
  record: JsonRecord,
  label: string,
  options: { allowMcp?: boolean } = {},
  assetOptions: { assetDataDir?: string } = {},
): void {
  if ('id' in record && (typeof record.id !== 'string' || record.id.trim() === '')) {
    throw new ValidationError(`${label}.id must be a non-empty string`)
  }
  if ('mcp' in record && !options.allowMcp) {
    throw new ValidationError(`${label}.mcp is not supported for module commands`)
  }
  validateModulePatch(
    record,
    label,
    {
      allowId: true,
      allowChildren: true,
      allowMcp: options.allowMcp,
    },
    assetOptions,
  )
}

function validateModulePatch(
  record: JsonRecord,
  label: string,
  options: { allowId?: boolean; allowChildren?: boolean; allowMcp?: boolean } = {},
  assetOptions: { assetDataDir?: string } = {},
): void {
  for (const key of Object.keys(record)) {
    if ((!options.allowId || key !== 'id') && MODULE_PATCH_EXCLUDED_KEYS.has(key)) {
      if (options.allowChildren && ['lorebook', 'regex', 'trigger'].includes(key)) {
        continue
      }
      if (options.allowMcp && key === 'mcp') continue
      throw new ValidationError(`${label}.${key} is owned by a later command slice`)
    }
    if (!MODULE_SCALAR_FIELD_TYPES.has(key) && key !== 'id') continue
    const allowedTypes = MODULE_SCALAR_FIELD_TYPES.get(key)
    if (!allowedTypes) continue
    const value = record[key]
    const type = value === undefined ? 'undefined' : typeof value
    if (!allowedTypes.includes(type)) {
      throw new ValidationError(`${label}.${key} must be ${describeTypes(allowedTypes)}`)
    }
  }
  if (assetOptions.assetDataDir && 'assets' in record) {
    validateAssetTriples(assetOptions.assetDataDir, record.assets, `${label}.assets`)
  }
}

function readStringArray(input: unknown, label: string): string[] {
  if (input === undefined || input === null) return []
  if (!Array.isArray(input)) {
    throw new ValidationError(`${label} must be an array`)
  }
  return input.filter((id): id is string => typeof id === 'string' && id.trim() !== '')
}

function readOptionalJsonObject(value: unknown): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  return value as JsonRecord
}

function describeTypes(types: readonly string[]): string {
  return types.filter((type) => type !== 'undefined').join(' or ')
}
