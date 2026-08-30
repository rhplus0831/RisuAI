import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { EntityNotFoundError, ValidationError } from '../repository.js'
import {
  validateAssetIdList,
  validateAssetTriples,
  validateCcAssetRefs,
  validateEmotionImageRefs,
  validateOptionalServerAssetRef,
} from './assets.js'
import { repairCreatedLorebookEntries } from './lorebooks.js'
import { normalizeScriptModelOverrides, readScriptModelOverrides } from '@risuai/shared-core/script-model-overrides'

type JsonRecord = Record<string, unknown>

const SERVER_ASSET_ID_RE = /^[0-9a-fA-F]{64}$/

export interface CharacterRecord extends JsonRecord {
  chaId: string
  name?: string
  displayName?: string
  trashTime?: number
}

export interface CharacterFolderRecord extends JsonRecord {
  id: string
  name: string
  color: string
  data: string[]
  askBeforeOpening?: boolean
  imgFile?: string | null
  img?: string
}

export type CharacterOrderEntry = string | CharacterFolderRecord

export type AlternateGreetingMutation =
  | { type: 'delete'; index: number }
  | { type: 'swap'; firstIndex: number; secondIndex: number }

export interface AlternateGreetingMutationInput {
  alternateGreetings: string[]
  operation: AlternateGreetingMutation
}

const EXCLUDED_CHARACTER_PATCH_KEYS = new Set([
  'chaId',
  'chats',
  'chatFolders',
  'globalLore',
  'customscript',
  'triggerscript',
  'scriptstate',
  'modules',
  'coldstorage',
  'coldStoragedChats',
  'greetingTranslations',
])

const CHARACTER_PATCH_DELETABLE_KEYS = new Set(['loreSettings'])

export function ensureDatabaseObject(database: unknown): JsonRecord {
  if (!database || typeof database !== 'object' || Array.isArray(database)) {
    throw new ValidationError('database must be an object before character commands can run')
  }
  return database as JsonRecord
}

export function ensureCharacterCollection(database: JsonRecord): CharacterRecord[] {
  if (!Array.isArray(database.characters)) {
    database.characters = []
  }

  const seen = new Set<string>()
  const characters = (database.characters as unknown[]).map((raw, index) => {
    const character = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as JsonRecord) : {}
    const record = repairCharacterCollectionRow(character, index)
    if (seen.has(record.chaId)) {
      record.chaId = randomUUID()
    }
    seen.add(record.chaId)
    return record
  })
  database.characters = characters

  normalizeCharacterOrder(database, characters)
  normalizeCurrentChar(database, characters)

  return characters
}

export function normalizeCharacterCollection(database: unknown): void {
  if (!database || typeof database !== 'object' || Array.isArray(database)) return
  ensureCharacterCollection(database as JsonRecord)
}

export function createCharacterRecord(input: unknown, options: { assetDb?: DatabaseSync } = {}): CharacterRecord {
  const character = readJsonObject(input, 'character') as CharacterRecord
  character.chaId = readCharacterId(character.chaId, 'character.chaId')
  character.globalLore = repairCreatedLorebookEntries(
    Array.isArray(character.globalLore) ? character.globalLore : [],
    `character ${character.chaId}.globalLore`,
  )
  validateCharacterRecord(character, 'character', options)
  validateCharacterCreateRecord(character, 'character')
  return character
}

export function repairCharacterCollectionRow(
  input: unknown,
  index = 0,
  options: { assetDb?: DatabaseSync } = {},
): CharacterRecord {
  const character = input && typeof input === 'object' && !Array.isArray(input) ? (input as JsonRecord) : {}
  return repairCharacterRecord({ ...characterCollectionRowDefaults(index), ...character }, options)
}

export function buildPatchedCharacterCollectionRow(
  input: unknown,
  patch: JsonRecord,
  characterId: string,
  index = 0,
  options: { assetDb?: DatabaseSync } = {},
): CharacterRecord {
  const character = input && typeof input === 'object' && !Array.isArray(input) ? (input as JsonRecord) : {}
  const patched: JsonRecord = {
    ...characterCollectionRowDefaults(index),
    ...character,
    chats: [],
    ...patch,
    chaId: characterId,
  }
  for (const key of CHARACTER_PATCH_DELETABLE_KEYS) {
    if (patch[key] === null) delete patched[key]
  }
  validateCharacterRecord(patched, 'character', options)
  return patched as CharacterRecord
}

export function repairCharacterRecord(input: unknown, options: { assetDb?: DatabaseSync } = {}): CharacterRecord {
  const character = readJsonObject(input, 'character') as CharacterRecord
  character.chaId = typeof character.chaId === 'string' && character.chaId.trim() ? character.chaId : randomUUID()
  const scriptModelOverrides = normalizeScriptModelOverrides(character.scriptModelOverrides)
  if (Object.keys(scriptModelOverrides).length > 0) character.scriptModelOverrides = scriptModelOverrides
  else delete character.scriptModelOverrides
  validateCharacterRecord(character, 'character', options)
  return character
}

function characterCollectionRowDefaults(index: number): JsonRecord {
  return {
    name: `Character ${index + 1}`,
    displayName: '',
    firstMessage: '',
    customNotificationMessage: '',
    notificationImage: '',
    desc: '',
    notes: '',
    chats: [],
    chatFolders: [],
    chatPage: 0,
    viewScreen: 'none',
    bias: [],
    emotionImages: [],
    globalLore: [],
    sdData: [],
    customscript: [],
    triggerscript: [],
    utilityBot: false,
    exampleMessage: '',
    creatorNotes: '',
    systemPrompt: '',
    postHistoryInstructions: '',
    alternateGreetings: [],
    tags: [],
    creator: '',
    characterVersion: '',
    personality: '',
    scenario: '',
    firstMsgIndex: -1,
    replaceGlobalNote: '',
    additionalText: '',
  }
}

export function readCharacterPatch(input: unknown, options: { assetDb?: DatabaseSync } = {}): JsonRecord {
  const patch = readJsonObject(input, 'patch')
  if (Object.keys(patch).length === 0) {
    throw new ValidationError('patch must include at least one character field')
  }
  validateCharacterPatch(patch, 'patch', options)
  return patch
}

export function readAlternateGreetingMutation(
  input: unknown,
  currentGreetingCount: number,
): AlternateGreetingMutationInput {
  const body = readJsonObject(input, 'body')
  if (!Array.isArray(body.alternateGreetings) || !body.alternateGreetings.every((value) => typeof value === 'string')) {
    throw new ValidationError('alternateGreetings must be an array of strings')
  }
  const operation = readJsonObject(body.operation, 'operation')
  if (operation.type === 'delete') {
    if (
      !Number.isInteger(operation.index) ||
      (operation.index as number) < 0 ||
      (operation.index as number) >= currentGreetingCount ||
      body.alternateGreetings.length !== currentGreetingCount - 1
    ) {
      throw new ValidationError('alternate greeting delete does not match the current collection')
    }
    return {
      alternateGreetings: [...body.alternateGreetings] as string[],
      operation: { type: 'delete', index: operation.index as number },
    }
  }
  if (operation.type === 'swap') {
    const firstIndex = operation.firstIndex
    const secondIndex = operation.secondIndex
    if (
      !Number.isInteger(firstIndex) ||
      !Number.isInteger(secondIndex) ||
      (firstIndex as number) < 0 ||
      (secondIndex as number) < 0 ||
      (firstIndex as number) >= currentGreetingCount ||
      (secondIndex as number) >= currentGreetingCount ||
      Math.abs((firstIndex as number) - (secondIndex as number)) !== 1 ||
      body.alternateGreetings.length !== currentGreetingCount
    ) {
      throw new ValidationError('alternate greeting swap does not match the current collection')
    }
    return {
      alternateGreetings: [...body.alternateGreetings] as string[],
      operation: { type: 'swap', firstIndex: firstIndex as number, secondIndex: secondIndex as number },
    }
  }
  throw new ValidationError('operation.type must be delete or swap')
}

export function remapAlternateGreetingIndex(
  value: unknown,
  greetingCount: number,
  operation: AlternateGreetingMutation,
): number {
  if (!Number.isInteger(value) || (value as number) < -1 || (value as number) >= greetingCount) return -1
  const index = value as number
  if (index === -1) return -1
  if (operation.type === 'delete') {
    if (index === operation.index) return -1
    return index > operation.index ? index - 1 : index
  }
  if (index === operation.firstIndex) return operation.secondIndex
  if (index === operation.secondIndex) return operation.firstIndex
  return index
}

export function readCharacterId(value: unknown, label = 'characterId'): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(`${label} must be a non-empty string`)
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

export function findCharacterIndex(characters: readonly CharacterRecord[], characterId: string): number {
  return characters.findIndex((character) => character.chaId === characterId)
}

export function requireCharacterIndex(characters: readonly CharacterRecord[], characterId: string): number {
  const index = findCharacterIndex(characters, characterId)
  if (index === -1) {
    throw new EntityNotFoundError(`Character not found: ${characterId}`)
  }
  return index
}

export function selectedCharacterId(database: JsonRecord, characters: readonly CharacterRecord[]): string | null {
  const index = Number.isInteger(database.currentChar as number) ? (database.currentChar as number) : -1
  return characters[index]?.chaId ?? null
}

export function readCharacterOrder(input: unknown): CharacterOrderEntry[] {
  if (!Array.isArray(input)) {
    throw new ValidationError('characterOrder must be an array')
  }
  validateJsonValue('characterOrder', input)
  return input.map((entry, index) => readCharacterOrderEntry(entry, index))
}

export function validateFullCharacterOrder(
  characters: readonly CharacterRecord[],
  order: readonly CharacterOrderEntry[],
): void {
  const activeIds = new Set(
    characters
      .filter((character) => !character.trashTime && character.chaId !== '§temp')
      .map((character) => character.chaId),
  )
  const seenCharacterIds = new Set<string>()
  const seenFolderIds = new Set<string>()

  for (const entry of order) {
    if (typeof entry === 'string') {
      validateOrderedCharacterId(entry, activeIds, seenCharacterIds)
      continue
    }

    if (seenFolderIds.has(entry.id)) {
      throw new ValidationError(`Duplicate character folder id: ${entry.id}`)
    }
    seenFolderIds.add(entry.id)
    for (const characterId of entry.data) {
      validateOrderedCharacterId(characterId, activeIds, seenCharacterIds)
    }
  }

  if (seenCharacterIds.size !== activeIds.size) {
    throw new ValidationError('characterOrder must include every untrashed character id')
  }
}

export function validateCharacterOrderAssetRefs(db: DatabaseSync, order: readonly CharacterOrderEntry[]): void {
  order.forEach((entry, index) => {
    if (typeof entry === 'string') return
    validateCharacterOrderLegacyImageRef(db, entry.img, `characterOrder[${index}].img`)
    validateOptionalServerAssetRef(db, entry.imgFile, `characterOrder[${index}].imgFile`)
  })
}

function validateCharacterOrderLegacyImageRef(db: DatabaseSync, value: unknown, label: string): void {
  if (typeof value !== 'string' || !SERVER_ASSET_ID_RE.test(value)) return
  validateOptionalServerAssetRef(db, value, label)
}

function normalizeCharacterOrder(database: JsonRecord, characters: readonly CharacterRecord[]): void {
  const rawOrder = Array.isArray(database.characterOrder) ? database.characterOrder : []
  const activeIds = new Set(
    characters
      .filter((character) => !character.trashTime && character.chaId !== '§temp')
      .map((character) => character.chaId),
  )
  const seen = new Set<string>()
  const normalized: CharacterOrderEntry[] = []

  for (const rawEntry of rawOrder) {
    if (typeof rawEntry === 'string') {
      if (activeIds.has(rawEntry) && !seen.has(rawEntry)) {
        normalized.push(rawEntry)
        seen.add(rawEntry)
      }
      continue
    }

    if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) continue
    const folder = readCharacterOrderEntry(rawEntry, normalized.length) as CharacterFolderRecord
    folder.data = folder.data.filter((id: string) => {
      if (!activeIds.has(id) || seen.has(id)) return false
      seen.add(id)
      return true
    })
    if (folder.data.length > 0) normalized.push(folder)
  }

  for (const id of activeIds) {
    if (!seen.has(id)) normalized.push(id)
  }

  database.characterOrder = normalized
}

function normalizeCurrentChar(database: JsonRecord, characters: readonly CharacterRecord[]): void {
  if (!Number.isInteger(database.currentChar as number)) {
    database.currentChar = characters.length > 0 ? 0 : -1
  }
  if ((database.currentChar as number) >= characters.length) {
    database.currentChar = characters.length > 0 ? characters.length - 1 : -1
  }
  if ((database.currentChar as number) < -1) {
    database.currentChar = characters.length > 0 ? 0 : -1
  }
}

function readCharacterOrderEntry(entry: unknown, index: number): CharacterOrderEntry {
  if (typeof entry === 'string') {
    if (entry.trim() === '') {
      throw new ValidationError(`characterOrder[${index}] must be a non-empty string`)
    }
    return entry
  }
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new ValidationError(`characterOrder[${index}] must be a character id or folder`)
  }

  const folder = entry as JsonRecord
  if (typeof folder.id !== 'string' || folder.id.trim() === '') {
    throw new ValidationError(`characterOrder[${index}].id must be a non-empty string`)
  }
  if (folder.name !== undefined && typeof folder.name !== 'string') {
    throw new ValidationError(`characterOrder[${index}].name must be a string`)
  }
  if (folder.color !== undefined && typeof folder.color !== 'string') {
    throw new ValidationError(`characterOrder[${index}].color must be a string`)
  }
  if (!Array.isArray(folder.data) || folder.data.some((id) => typeof id !== 'string' || !id)) {
    throw new ValidationError(`characterOrder[${index}].data must be an array of character ids`)
  }
  if (folder.askBeforeOpening !== undefined && typeof folder.askBeforeOpening !== 'boolean') {
    throw new ValidationError(`characterOrder[${index}].askBeforeOpening must be a boolean`)
  }
  if (folder.imgFile !== undefined && folder.imgFile !== null && typeof folder.imgFile !== 'string') {
    throw new ValidationError(`characterOrder[${index}].imgFile must be a string or null`)
  }
  if (folder.img !== undefined && typeof folder.img !== 'string') {
    throw new ValidationError(`characterOrder[${index}].img must be a string`)
  }

  return {
    ...folder,
    id: folder.id,
    name: typeof folder.name === 'string' ? folder.name : 'New Folder',
    color: typeof folder.color === 'string' ? folder.color : '',
    data: [...(folder.data as string[])],
    askBeforeOpening: folder.askBeforeOpening === true,
  } as CharacterFolderRecord
}

function validateOrderedCharacterId(characterId: string, activeIds: Set<string>, seenCharacterIds: Set<string>): void {
  if (!activeIds.has(characterId)) {
    throw new ValidationError(`Unknown character id in characterOrder: ${characterId}`)
  }
  if (seenCharacterIds.has(characterId)) {
    throw new ValidationError(`Duplicate character id in characterOrder: ${characterId}`)
  }
  seenCharacterIds.add(characterId)
}

function validateCharacterRecord(record: JsonRecord, label: string, options: { assetDb?: DatabaseSync } = {}): void {
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
  if ('chaId' in record && (typeof record.chaId !== 'string' || record.chaId.trim() === '')) {
    throw new ValidationError(`${label}.chaId must be a non-empty string`)
  }
  if ('name' in record && typeof record.name !== 'string') {
    throw new ValidationError(`${label}.name must be a string`)
  }
  if ('displayName' in record && typeof record.displayName !== 'string') {
    throw new ValidationError(`${label}.displayName must be a string`)
  }
  if ('customNotificationMessage' in record && typeof record.customNotificationMessage !== 'string') {
    throw new ValidationError(`${label}.customNotificationMessage must be a string`)
  }
  if ('notificationImage' in record && typeof record.notificationImage !== 'string') {
    throw new ValidationError(`${label}.notificationImage must be a string`)
  }
  if (
    'trashTime' in record &&
    record.trashTime !== undefined &&
    record.trashTime !== null &&
    (typeof record.trashTime !== 'number' || !Number.isFinite(record.trashTime))
  ) {
    throw new ValidationError(`${label}.trashTime must be a finite number, null, or undefined`)
  }
  if (options.assetDb) {
    validateCharacterAssetRefs(options.assetDb, record, label)
  }
}

function validateCharacterCreateRecord(record: JsonRecord, label: string): void {
  if (Object.prototype.hasOwnProperty.call(record, 'greetingTranslations')) {
    throw new ValidationError(`${label}.greetingTranslations is server-owned portable data`)
  }
  if (!Object.prototype.hasOwnProperty.call(record, 'chats')) return
  if (!Array.isArray(record.chats)) {
    throw new ValidationError(`${label}.chats must be an array when provided`)
  }
  if (record.chats.length > 0) {
    throw new ValidationError(`${label}.chats must be empty; create chats with chat commands`)
  }
}

function validateCharacterPatch(record: JsonRecord, label: string, options: { assetDb?: DatabaseSync } = {}): void {
  for (const key of Object.keys(record)) {
    if (EXCLUDED_CHARACTER_PATCH_KEYS.has(key)) {
      throw new ValidationError(`${label}.${key} is owned by a later command slice`)
    }
  }
  validateCharacterRecord(record, label, options)
}

function validateCharacterAssetRefs(db: DatabaseSync, record: JsonRecord, label: string): void {
  if ('image' in record) {
    validateOptionalServerAssetRef(db, record.image, `${label}.image`)
  }
  if ('notificationImage' in record) {
    validateOptionalServerAssetRef(db, record.notificationImage, `${label}.notificationImage`)
  }
  if ('emotionImages' in record) {
    validateEmotionImageRefs(db, record.emotionImages, `${label}.emotionImages`)
  }
  if ('additionalAssets' in record) {
    validateAssetTriples(db, record.additionalAssets, `${label}.additionalAssets`)
  }
  if ('ccAssets' in record) {
    validateCcAssetRefs(db, record.ccAssets, `${label}.ccAssets`)
  }
  if ('prebuiltAssetExclude' in record) {
    validateAssetIdList(db, record.prebuiltAssetExclude, `${label}.prebuiltAssetExclude`)
  }
  if ('vits' in record) {
    validateVitsAssetRefs(db, record.vits, `${label}.vits`)
  }
  if ('gptSoVitsConfig' in record) {
    validateGptSoVitsAssetRefs(db, record.gptSoVitsConfig, `${label}.gptSoVitsConfig`)
  }
}

function validateVitsAssetRefs(db: DatabaseSync, value: unknown, label: string): void {
  if (value === undefined || value === null) return
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(`${label} must be an object`)
  }
  const record = value as JsonRecord
  if (!('files' in record) || record.files === undefined || record.files === null) return
  if (!record.files || typeof record.files !== 'object' || Array.isArray(record.files)) {
    throw new ValidationError(`${label}.files must be an object`)
  }
  for (const [key, assetId] of Object.entries(record.files as JsonRecord)) {
    validateOptionalServerAssetRef(db, assetId, `${label}.files.${key}`)
  }
}

function validateGptSoVitsAssetRefs(db: DatabaseSync, value: unknown, label: string): void {
  if (value === undefined || value === null) return
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(`${label} must be an object`)
  }
  const record = value as JsonRecord
  if (!('ref_audio_data' in record) || record.ref_audio_data === undefined || record.ref_audio_data === null) {
    return
  }
  if (!record.ref_audio_data || typeof record.ref_audio_data !== 'object' || Array.isArray(record.ref_audio_data)) {
    throw new ValidationError(`${label}.ref_audio_data must be an object`)
  }
  const refAudio = record.ref_audio_data as JsonRecord
  if ('assetId' in refAudio) {
    validateOptionalServerAssetRef(db, refAudio.assetId, `${label}.ref_audio_data.assetId`)
  }
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
