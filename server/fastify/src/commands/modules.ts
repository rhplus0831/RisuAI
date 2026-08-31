import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { EntityNotFoundError, ValidationError } from '../repository.js'
import { validateAssetTriples } from './assets.js'
import {
  type CharacterRecord,
  ensureCharacterCollection,
  readCharacterId,
  readJsonObject,
  readStrictCharacterRecord,
} from './characters.js'
import { isImportableMCPIdentifier } from '@risuai/shared-core/mcp-identifier'
import { repairCreatedLorebookEntries, validateStoredLorebookEntries } from './lorebooks.js'
import { normalizeScriptModelOverrides, readScriptModelOverrides } from '@risuai/shared-core/script-model-overrides'

type JsonRecord = Record<string, unknown>

export interface ModuleRecord extends JsonRecord {
  id: string
  name: string
  description: string
  mcp?: unknown
}

const MODULE_PATCH_EXCLUDED_KEYS = new Set(['id', 'mcp', 'lorebook', 'regex', 'trigger'])
const MODULE_PATCH_DELETABLE_KEYS = new Set([
  'namespace',
  'lowLevelAccess',
  'hideIcon',
  'backgroundEmbedding',
  'customModuleToggle',
  'cjs',
  'assets',
])

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

/**
 * Read persisted module identities without repairing any row. All identities
 * are checked together so target lookup cannot silently choose one duplicate.
 */
export function readStrictModuleRecords(database: JsonRecord): ModuleRecord[] {
  if (!Array.isArray(database.modules)) {
    throw new ValidationError('modules must be an array')
  }
  const seen = new Set<string>()
  return database.modules.map((raw, index) => {
    const module = readJsonObject(raw, `module[${index}]`) as ModuleRecord
    const id = readModuleId(module.id, `module[${index}].id`)
    if (seen.has(id)) {
      throw new ValidationError(`Duplicate module id: ${id}`)
    }
    seen.add(id)
    return module
  })
}

/** Validate one stored module exactly as represented, without normalization. */
export function validateStoredModuleRecord(
  module: ModuleRecord,
  label = 'module',
  options: { allowMcp?: boolean; validateLorebook?: boolean } = {},
): ModuleRecord {
  if (typeof module.name !== 'string' || module.name.trim() === '') {
    throw new ValidationError(`${label}.name must be a non-empty string`)
  }
  if (typeof module.description !== 'string') {
    throw new ValidationError(`${label}.description must be a string`)
  }
  // Some shared validators canonicalize their argument. Validate a shallow
  // copy so the stored row returned to the command remains byte-faithful.
  validateModuleRecord({ ...module }, label, options)
  if (options.validateLorebook && module.lorebook !== undefined) {
    validateStoredLorebookEntries(module.lorebook, `${label}.lorebook`)
  }
  return module
}

export function createModuleRecord(
  input: unknown,
  label = 'module',
  options: { allowMcp?: boolean } = {},
  assetOptions: { assetDb?: DatabaseSync } = {},
): ModuleRecord {
  const module = readJsonObject(input, label) as ModuleRecord
  module.id = readModuleId(module.id, `${label}.id`)
  module.name = typeof module.name === 'string' && module.name.trim() ? module.name : 'New Module'
  module.description = typeof module.description === 'string' ? module.description : ''
  if (Array.isArray(module.lorebook)) {
    module.lorebook = repairCreatedLorebookEntries(module.lorebook, `${label}.lorebook`)
  }
  validateModuleRecord(module, label, options, assetOptions)
  return module
}

function repairModuleRecord(
  input: unknown,
  label = 'module',
  options: { allowMcp?: boolean } = {},
  assetOptions: { assetDb?: DatabaseSync } = {},
): ModuleRecord {
  const module = readJsonObject(input, label) as ModuleRecord
  module.id = typeof module.id === 'string' && module.id.trim() ? module.id : randomUUID()
  module.name = typeof module.name === 'string' && module.name.trim() ? module.name : 'New Module'
  module.description = typeof module.description === 'string' ? module.description : ''
  const scriptModelOverrides = normalizeScriptModelOverrides(module.scriptModelOverrides)
  if (Object.keys(scriptModelOverrides).length > 0) module.scriptModelOverrides = scriptModelOverrides
  else delete module.scriptModelOverrides
  validateModuleRecord(module, label, options, assetOptions)
  return module
}

export function readModuleId(value: unknown, label = 'moduleId'): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(`${label} must be a non-empty string`)
  }
  return value
}

export function readModulePatch(input: unknown, options: { assetDb?: DatabaseSync } = {}): JsonRecord {
  const patch = readJsonObject(input, 'patch')
  if (Object.keys(patch).length === 0) {
    throw new ValidationError('patch must include at least one module field')
  }
  validateModulePatch(patch, 'patch', { allowDeleteSentinel: true }, options)
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

export function requireModuleIndex(
  modules: readonly ModuleRecord[],
  moduleId: string,
  options: { allowMcp?: boolean } = {},
): number {
  const matches = modules.map((module, index) => ({ module, index })).filter(({ module }) => module.id === moduleId)
  if (matches.length === 0) {
    throw new EntityNotFoundError(`Module not found: ${moduleId}`)
  }
  if (matches.length !== 1) {
    throw new ValidationError(`Duplicate module id: ${moduleId}`)
  }
  if (!options.allowMcp && matches[0].module.mcp) {
    throw new EntityNotFoundError(`Module not found: ${moduleId}`)
  }
  return matches[0].index
}

export function validateFullModuleOrder(modules: readonly ModuleRecord[], moduleIds: readonly string[]): void {
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
export function validateCharacterModuleLinks(modules: readonly ModuleRecord[], moduleIds: readonly string[]): void {
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

export interface RemovedModuleReferences {
  settingsChanged: boolean
  changedPersonaIndexes: number[]
  changedLoadoutIndexes: number[]
  changedCharacters: Array<{ characterId: string; character: CharacterRecord }>
  changedChats: Array<{ chatId: string; chat: JsonRecord }>
}

export function removeModuleReferences(database: JsonRecord, moduleId: string): RemovedModuleReferences {
  const enabledModules = readStrictEnabledModules(database)
  const nextEnabledModules = enabledModules.filter((id) => id !== moduleId)
  const result: RemovedModuleReferences = {
    settingsChanged: nextEnabledModules.length !== enabledModules.length,
    changedPersonaIndexes: [],
    changedLoadoutIndexes: [],
    changedCharacters: [],
    changedChats: [],
  }
  if (result.settingsChanged) database.enabledModules = nextEnabledModules

  if (Array.isArray(database.personas)) {
    for (let index = 0; index < database.personas.length; index++) {
      const record = readJsonObject(database.personas[index], `persona[${index}]`)
      if (record.modules === undefined) continue
      const modules = readStrictStringArray(record.modules, `persona[${index}].modules`)
      const next = modules.filter((id) => id !== moduleId)
      if (next.length === modules.length) continue
      record.modules = next
      result.changedPersonaIndexes.push(index)
    }
  }

  if (!Array.isArray(database.characters)) {
    throw new ValidationError('characters must be an array')
  }
  const seenCharacterIds = new Set<string>()
  const seenChatIds = new Set<string>()
  for (let characterIndex = 0; characterIndex < database.characters.length; characterIndex++) {
    const character = readJsonObject(
      database.characters[characterIndex],
      `character[${characterIndex}]`,
    ) as CharacterRecord
    const characterId = readCharacterId(character.chaId, `character[${characterIndex}].chaId`)
    if (seenCharacterIds.has(characterId)) {
      throw new ValidationError(`Duplicate character id: ${characterId}`)
    }
    seenCharacterIds.add(characterId)
    if (character.modules !== undefined) {
      const modules = readStrictStringArray(character.modules, `character ${characterId}.modules`)
      const next = modules.filter((id) => id !== moduleId)
      if (next.length !== modules.length) {
        character.modules = next
        result.changedCharacters.push({ characterId, character })
      }
    }
    if (character.chats === undefined) continue
    if (!Array.isArray(character.chats)) {
      throw new ValidationError(`character ${characterId}.chats must be an array`)
    }
    for (let chatIndex = 0; chatIndex < character.chats.length; chatIndex++) {
      const chat = readJsonObject(character.chats[chatIndex], `character ${characterId}.chats[${chatIndex}]`)
      const chatId = readModuleId(chat.id, `character ${characterId}.chats[${chatIndex}].id`)
      if (seenChatIds.has(chatId)) {
        throw new ValidationError(`Duplicate chat id: ${chatId}`)
      }
      seenChatIds.add(chatId)
      if (chat.modules === undefined) continue
      const modules = readStrictStringArray(chat.modules, `chat ${chatId}.modules`)
      const next = modules.filter((id) => id !== moduleId)
      if (next.length === modules.length) continue
      chat.modules = next
      result.changedChats.push({ chatId, chat })
    }
  }

  if (Array.isArray(database.loadouts)) {
    for (let index = 0; index < database.loadouts.length; index++) {
      const record = readJsonObject(database.loadouts[index], `loadout[${index}]`)
      if (record.modules === undefined) continue
      const modules = readStrictStringArray(record.modules, `loadout[${index}].modules`)
      const next = modules.filter((id) => id !== moduleId)
      if (next.length === modules.length) continue
      record.modules = next
      result.changedLoadoutIndexes.push(index)
    }
  }
  return result
}

export function ensureEnabledModules(database: JsonRecord): string[] {
  database.enabledModules = readStringArray(database.enabledModules, 'enabledModules')
  return database.enabledModules as string[]
}

export function readStrictEnabledModules(database: JsonRecord): string[] {
  if (!Array.isArray(database.enabledModules)) {
    throw new ValidationError('enabledModules must be an array')
  }
  const seen = new Set<string>()
  return database.enabledModules.map((value, index) => {
    const id = readModuleId(value, `enabledModules[${index}]`)
    if (seen.has(id)) {
      throw new ValidationError(`Duplicate module id in enabledModules: ${id}`)
    }
    seen.add(id)
    return id
  })
}

export function findCharacterForModuleCommand(database: JsonRecord, characterId: string): CharacterRecord {
  const characters = Array.isArray(database.characters) ? database.characters : []
  const matches = characters.filter(
    (candidate): candidate is JsonRecord =>
      !!candidate && typeof candidate === 'object' && !Array.isArray(candidate) && candidate.chaId === characterId,
  )
  if (matches.length === 0) {
    throw new EntityNotFoundError(`Character not found: ${characterId}`)
  }
  if (matches.length !== 1) {
    throw new ValidationError(`Duplicate character id: ${characterId}`)
  }
  return readStrictCharacterRecord(matches[0], characterId)
}

export { readCharacterId }

function validateModuleRecord(
  record: JsonRecord,
  label: string,
  options: { allowMcp?: boolean } = {},
  assetOptions: { assetDb?: DatabaseSync } = {},
): void {
  if ('id' in record && (typeof record.id !== 'string' || record.id.trim() === '')) {
    throw new ValidationError(`${label}.id must be a non-empty string`)
  }
  if ('mcp' in record && !options.allowMcp) {
    throw new ValidationError(`${label}.mcp is not supported for module commands`)
  }
  if ('mcp' in record && options.allowMcp) {
    const mcp = readJsonObject(record.mcp, `${label}.mcp`)
    if (typeof mcp.url !== 'string' || !isImportableMCPIdentifier(mcp.url)) {
      throw new ValidationError(`${label}.mcp.url must be a supported MCP identifier`)
    }
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
  options: { allowId?: boolean; allowChildren?: boolean; allowMcp?: boolean; allowDeleteSentinel?: boolean } = {},
  assetOptions: { assetDb?: DatabaseSync } = {},
): void {
  if ('scriptModelOverrides' in record) {
    try {
      record.scriptModelOverrides = readScriptModelOverrides(
        record.scriptModelOverrides,
        `${label}.scriptModelOverrides`,
      )
    } catch (error) {
      throw new ValidationError(error instanceof Error ? error.message : String(error))
    }
  }
  for (const key of Object.keys(record)) {
    if ((!options.allowId || key !== 'id') && MODULE_PATCH_EXCLUDED_KEYS.has(key)) {
      if (options.allowChildren && ['lorebook', 'regex', 'trigger'].includes(key)) {
        continue
      }
      if (options.allowMcp && key === 'mcp') continue
      throw new ValidationError(`${label}.${key} is owned by a later command slice`)
    }
    if (record[key] === null) {
      if (!options.allowDeleteSentinel || !MODULE_PATCH_DELETABLE_KEYS.has(key)) {
        throw new ValidationError(`${label}.${key} cannot be deleted`)
      }
      continue
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
  if (assetOptions.assetDb && 'assets' in record && record.assets !== null) {
    validateAssetTriples(assetOptions.assetDb, record.assets, `${label}.assets`)
  }
}

function readStringArray(input: unknown, label: string): string[] {
  if (input === undefined || input === null) return []
  if (!Array.isArray(input)) {
    throw new ValidationError(`${label} must be an array`)
  }
  return input.filter((id): id is string => typeof id === 'string' && id.trim() !== '')
}

function readStrictStringArray(input: unknown, label: string): string[] {
  if (!Array.isArray(input)) {
    throw new ValidationError(`${label} must be an array`)
  }
  const seen = new Set<string>()
  return input.map((value, index) => {
    const id = readModuleId(value, `${label}[${index}]`)
    if (seen.has(id)) {
      throw new ValidationError(`Duplicate module id in ${label}: ${id}`)
    }
    seen.add(id)
    return id
  })
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
