import { randomUUID } from 'node:crypto'
import { EntityNotFoundError, ValidationError } from '../repository.js'
import {
  type CharacterRecord,
  ensureCharacterCollection,
  readCharacterId,
  readJsonObject,
} from './characters.js'
import {
  ensureCharacterChats,
  normalizeAllCharacterChats,
  readChatId,
  requireChatLocation,
} from './chats.js'

type JsonRecord = Record<string, unknown>

export interface LorebookEntryRecord extends JsonRecord {
  id: string
  key: string
  secondkey: string
  insertorder: number
  comment: string
  content: string
  mode: string
  alwaysActive: boolean
  selective: boolean
  folder?: string
}

export interface GlobalLorebookRecord extends JsonRecord {
  id: string
  name: string
  data: LorebookEntryRecord[]
}

export interface ModuleRecord extends JsonRecord {
  id: string
  lorebook?: LorebookEntryRecord[]
  mcp?: unknown
}

export function ensureLorebookDatabase(database: unknown): JsonRecord {
  const target = readJsonObject(database, 'database')
  ensureGlobalLorebookCollection(target)
  ensureAllChildLorebooks(target)
  return target
}

export function ensureGlobalLorebookCollection(database: JsonRecord): GlobalLorebookRecord[] {
  if (!Array.isArray(database.loreBook)) {
    database.loreBookPage = 0
    database.loreBook = [{ name: 'My First LoreBook', data: [] }]
  }

  const seen = new Set<string>()
  const lorebooks = (database.loreBook as unknown[]).map((raw, index) => {
    const lorebook = repairGlobalLorebookRecord(
      {
        name: `LoreBook ${index + 1}`,
        data: [],
        ...readOptionalJsonObject(raw),
      },
      `loreBook[${index}]`,
    )
    if (seen.has(lorebook.id)) {
      lorebook.id = randomUUID()
    }
    seen.add(lorebook.id)
    return lorebook
  })

  database.loreBook = lorebooks
  normalizeLorebookPage(database, lorebooks)
  return lorebooks
}

export function ensureAllChildLorebooks(database: JsonRecord): void {
  if (Array.isArray(database.characters)) {
    const characters = ensureCharacterCollection(database)
    for (const character of characters) {
      ensureCharacterLorebooks(character)
      for (const chat of ensureCharacterChats(character)) {
        chat.localLore = repairLorebookEntries(chat.localLore, `chat ${chat.id}.localLore`)
      }
    }
  }

  if (Array.isArray(database.modules)) {
    for (const rawModule of database.modules) {
      if (!rawModule || typeof rawModule !== 'object' || Array.isArray(rawModule)) {
        continue
      }
      const module = rawModule as ModuleRecord
      if (Array.isArray(module.lorebook)) {
        const label =
          typeof module.id === 'string' && module.id.trim() ? `module ${module.id}` : 'module'
        module.lorebook = repairLorebookEntries(module.lorebook, `${label}.lorebook`)
      }
    }
  }
}

export function ensureCharacterLorebooks(character: CharacterRecord): LorebookEntryRecord[] {
  character.globalLore = repairLorebookEntries(
    Array.isArray(character.globalLore) ? character.globalLore : [],
    `character ${character.chaId}.globalLore`,
  )
  return character.globalLore as LorebookEntryRecord[]
}

export function ensureModuleCollection(database: JsonRecord): ModuleRecord[] {
  if (!Array.isArray(database.modules)) {
    database.modules = []
  }

  const seen = new Set<string>()
  const modules = (database.modules as unknown[]).map((raw, index) => {
    const module = readJsonObject(
      {
        name: `Module ${index + 1}`,
        lorebook: [],
        ...readOptionalJsonObject(raw),
      },
      `module[${index}]`,
    ) as ModuleRecord
    module.id = typeof module.id === 'string' && module.id.trim() ? module.id : randomUUID()
    if (seen.has(module.id)) {
      module.id = randomUUID()
    }
    seen.add(module.id)
    module.lorebook = repairLorebookEntries(module.lorebook ?? [], `module ${module.id}.lorebook`)
    return module
  })
  database.modules = modules
  return modules
}

export function createGlobalLorebookRecord(
  input: unknown,
  label = 'lorebook',
): GlobalLorebookRecord {
  const lorebook = readJsonObject(input, label) as GlobalLorebookRecord
  lorebook.id = readLorebookId(lorebook.id, `${label}.id`)
  lorebook.name =
    typeof lorebook.name === 'string' && lorebook.name.trim() ? lorebook.name : 'New LoreBook'
  lorebook.data = repairLorebookEntries(lorebook.data ?? [], `${label}.data`)
  validateGlobalLorebookRecord(lorebook, label)
  return lorebook
}

export function repairGlobalLorebookRecord(
  input: unknown,
  label = 'lorebook',
): GlobalLorebookRecord {
  const lorebook = readJsonObject(input, label) as GlobalLorebookRecord
  lorebook.id = typeof lorebook.id === 'string' && lorebook.id.trim() ? lorebook.id : randomUUID()
  lorebook.name =
    typeof lorebook.name === 'string' && lorebook.name.trim() ? lorebook.name : 'New LoreBook'
  lorebook.data = repairLorebookEntries(lorebook.data ?? [], `${label}.data`)
  validateGlobalLorebookRecord(lorebook, label)
  return lorebook
}

export function readGlobalLorebookPatch(input: unknown): JsonRecord {
  const patch = readJsonObject(input, 'patch')
  if (Object.keys(patch).length === 0) {
    throw new ValidationError('patch must include at least one lorebook field')
  }
  for (const key of Object.keys(patch)) {
    if (key !== 'name') {
      throw new ValidationError(`patch.${key} is not supported for lorebook commands`)
    }
  }
  if (typeof patch.name !== 'string' || patch.name.trim() === '') {
    throw new ValidationError('patch.name must be a non-empty string')
  }
  return patch
}

export function readLorebookId(value: unknown, label = 'lorebookId'): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(`${label} must be a non-empty string`)
  }
  return value
}

export function readLorebookIdList(input: unknown, label = 'lorebookIds'): string[] {
  if (!Array.isArray(input)) {
    throw new ValidationError(`${label} must be an array`)
  }
  return input.map((id, index) => readLorebookId(id, `${label}[${index}]`))
}

export function readLorebookEntries(input: unknown, label = 'entries'): LorebookEntryRecord[] {
  return validateLorebookEntries(input, label)
}

export function validateLorebookEntries(input: unknown, label = 'entries'): LorebookEntryRecord[] {
  if (!Array.isArray(input)) {
    throw new ValidationError(`${label} must be an array`)
  }
  const seen = new Set<string>()
  return input.map((raw, index) => {
    const entry = createLorebookEntryRecord(raw, `${label}[${index}]`, { repairId: false })
    if (seen.has(entry.id)) {
      throw new ValidationError(`Duplicate lorebook entry id: ${entry.id}`)
    }
    seen.add(entry.id)
    return entry
  })
}

export function requireGlobalLorebookIndex(
  lorebooks: readonly GlobalLorebookRecord[],
  lorebookId: string,
): number {
  const index = lorebooks.findIndex((lorebook) => lorebook.id === lorebookId)
  if (index === -1) {
    throw new EntityNotFoundError(`Lorebook not found: ${lorebookId}`)
  }
  return index
}

export function requireModule(modules: readonly ModuleRecord[], moduleId: string): ModuleRecord {
  const module = modules.find((candidate) => candidate.id === moduleId && !candidate.mcp)
  if (!module) {
    throw new EntityNotFoundError(`Module not found: ${moduleId}`)
  }
  return module
}

export function readModuleId(value: unknown, label = 'moduleId'): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(`${label} must be a non-empty string`)
  }
  return value
}

export function validateFullLorebookOrder(
  lorebooks: readonly GlobalLorebookRecord[],
  lorebookIds: readonly string[],
): void {
  const existing = new Set(lorebooks.map((lorebook) => lorebook.id))
  const seen = new Set<string>()
  for (const lorebookId of lorebookIds) {
    if (!existing.has(lorebookId)) {
      throw new ValidationError(`Unknown lorebook id in lorebookIds: ${lorebookId}`)
    }
    if (seen.has(lorebookId)) {
      throw new ValidationError(`Duplicate lorebook id in lorebookIds: ${lorebookId}`)
    }
    seen.add(lorebookId)
  }
  if (seen.size !== existing.size) {
    throw new ValidationError('lorebookIds must include every lorebook')
  }
}

export function repairLorebookEntries(input: unknown, label: string): LorebookEntryRecord[] {
  if (!Array.isArray(input)) {
    throw new ValidationError(`${label} must be an array`)
  }

  const seen = new Set<string>()
  return input.map((raw, index) => {
    const entry = createLorebookEntryRecord(raw, `${label}[${index}]`, { repairId: true })
    if (seen.has(entry.id)) {
      entry.id = randomUUID()
    }
    seen.add(entry.id)
    return entry
  })
}

export function normalizeSelectedCharacterLorebooks(
  database: JsonRecord,
  characterId: string,
): { character: CharacterRecord; characterIndex: number; entries: LorebookEntryRecord[] } {
  const characters = ensureCharacterCollection(database)
  const characterIndex = characters.findIndex((character) => character.chaId === characterId)
  if (characterIndex === -1) {
    throw new EntityNotFoundError(`Character not found: ${characterId}`)
  }
  const character = characters[characterIndex]
  const entries = ensureCharacterLorebooks(character)
  return { character, characterIndex, entries }
}

export function normalizeSelectedChatLorebooks(
  database: JsonRecord,
  chatId: string,
): { character: CharacterRecord; chat: { localLore: LorebookEntryRecord[] }; parentId: string } {
  // A4EC8 / B9: every globally-addressed resolver (requireChatLocation)
  // must run after global id normalization. Without normalizeAllCharacterChats
  // first, persisted cross-character duplicate chat ids would let this route
  // mutate the wrong row. Normalize is idempotent.
  normalizeAllCharacterChats(database)
  const characters = ensureCharacterCollection(database)
  const location = requireChatLocation(characters, chatId)
  location.chat.localLore = repairLorebookEntries(
    location.chat.localLore,
    `chat ${chatId}.localLore`,
  )
  return {
    character: location.character,
    chat: location.chat as { localLore: LorebookEntryRecord[] },
    parentId: location.character.chaId,
  }
}

function createLorebookEntryRecord(
  input: unknown,
  label: string,
  options: { repairId: boolean },
): LorebookEntryRecord {
  const entry = readJsonObject(
    {
      key: '',
      secondkey: '',
      insertorder: 100,
      comment: '',
      content: '',
      mode: 'normal',
      alwaysActive: false,
      selective: false,
      ...readOptionalJsonObject(input),
    },
    label,
  ) as LorebookEntryRecord
  if (typeof entry.id !== 'string' || entry.id.trim() === '') {
    if (!options.repairId) {
      throw new ValidationError(`${label}.id must be a non-empty string`)
    }
    entry.id = randomUUID()
  }
  validateLorebookEntryRecord(entry, label)
  return entry
}

function validateGlobalLorebookRecord(record: GlobalLorebookRecord, label: string): void {
  if (typeof record.id !== 'string' || record.id.trim() === '') {
    throw new ValidationError(`${label}.id must be a non-empty string`)
  }
  if (typeof record.name !== 'string' || record.name.trim() === '') {
    throw new ValidationError(`${label}.name must be a non-empty string`)
  }
  if (!Array.isArray(record.data)) {
    throw new ValidationError(`${label}.data must be an array`)
  }
}

function validateLorebookEntryRecord(record: JsonRecord, label: string): void {
  for (const key of ['id', 'key', 'secondkey', 'comment', 'content', 'mode']) {
    if (typeof record[key] !== 'string') {
      throw new ValidationError(`${label}.${key} must be a string`)
    }
  }
  if ((record.id as string).trim() === '') {
    throw new ValidationError(`${label}.id must be a non-empty string`)
  }
  if (typeof record.insertorder !== 'number' || !Number.isFinite(record.insertorder)) {
    throw new ValidationError(`${label}.insertorder must be a finite number`)
  }
  if (typeof record.alwaysActive !== 'boolean') {
    throw new ValidationError(`${label}.alwaysActive must be a boolean`)
  }
  if (typeof record.selective !== 'boolean') {
    throw new ValidationError(`${label}.selective must be a boolean`)
  }
  if ('folder' in record && record.folder !== undefined && typeof record.folder !== 'string') {
    throw new ValidationError(`${label}.folder must be a string`)
  }
  validateJsonValue(label, record)
}

function normalizeLorebookPage(
  database: JsonRecord,
  lorebooks: readonly GlobalLorebookRecord[],
): void {
  if (!Number.isInteger(database.loreBookPage as number)) {
    database.loreBookPage = 0
  }
  if ((database.loreBookPage as number) >= lorebooks.length) {
    database.loreBookPage = lorebooks.length > 0 ? lorebooks.length - 1 : 0
  }
  if ((database.loreBookPage as number) < 0) {
    database.loreBookPage = 0
  }
}

function readOptionalJsonObject(value: unknown): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  return value as JsonRecord
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

export { readCharacterId, readChatId }
