import { createHash, randomBytes, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createInitialDatabase } from './databaseDefaults.js'
import { repairStoredChatGenerationSettings } from './chatGenerationSettingsStorage.js'
import { DEFAULT_AUTOMATIC_BACKUP_RETENTION } from './config.js'
import { getSchemaState } from './db.js'
import { assessDatabaseInitialization, InitializeConflictError } from './databaseInitialization.js'
import { COMMAND_EVENT_CATALOG, persistRevisionedCommandEvent, type CommandEvent } from './commands/events.js'
import { getDatabaseWriterMetadata, rotateDatabaseLineage } from './databaseLineage.js'
import { recordTableWrite } from './protocolMetrics.js'
import {
  applyChatMessageDiff,
  deleteChatHypaV3,
  deleteChatMessages,
  getAlternateMessagesGroupedByIds,
  getAllChatHypaV3Grouped,
  getAllChatMessagesGrouped,
  getAlternateMessages,
  getChatHypaV3,
  getChatHypaV3GroupedByIds,
  getChatMessages,
  getChatMessagesRange,
  getChatMessagesGroupedByIds,
  getActiveMessageLocationById,
  replaceAllChatHypaV3,
  replaceAllChatMessages,
  setChatHypaV3,
  countChatMessages,
} from './messageStore.js'

const PLUGIN_CUSTOM_STORAGE_EMPTY_SENTINEL_KEY = '__risu_internal_plugin_custom_storage_empty__'

export const CONTENT_TYPE_EXTENSIONS: Record<string, string> = {
  'application/x-onnx': 'onnx',
  'application/x-risu-inlay-signature+json': 'json',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'audio/mpeg': 'mp3',
  'audio/aac': 'aac',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/flac': 'flac',
  'audio/webm': 'weba',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/x-matroska': 'mkv',
  'image/svg+xml': 'svg',
  'text/css': 'css',
  'font/ttf': 'ttf',
  'font/otf': 'otf',
  'font/woff': 'woff',
  'font/woff2': 'woff2',
}

export const SUPPORTED_ASSET_CONTENT_TYPES = Object.keys(CONTENT_TYPE_EXTENSIONS)

const SHA256_RE = /^[a-f0-9]{64}$/

function startsWithBytes(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[index] === value)
}

function asciiAt(bytes: Uint8Array, offset: number, value: string): boolean {
  if (bytes.byteLength < offset + value.length) return false
  return [...value].every((character, index) => bytes[offset + index] === character.charCodeAt(0))
}

/** Detect media types whose picker-facing formats have stable magic bytes. */
export function detectAssetContentType(bytes: Uint8Array): string | null {
  if (startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (startsWithBytes(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (asciiAt(bytes, 0, 'GIF87a') || asciiAt(bytes, 0, 'GIF89a')) return 'image/gif'
  if (asciiAt(bytes, 0, 'RIFF') && asciiAt(bytes, 8, 'WEBP')) return 'image/webp'
  if (asciiAt(bytes, 0, 'RIFF') && asciiAt(bytes, 8, 'WAVE')) return 'audio/wav'
  if (asciiAt(bytes, 0, 'OggS')) return 'audio/ogg'
  if (asciiAt(bytes, 0, 'fLaC')) return 'audio/flac'
  if (asciiAt(bytes, 0, 'ID3')) return 'audio/mpeg'
  if (bytes[0] === 0xff && bytes.byteLength >= 2 && (bytes[1] & 0xf0) === 0xf0) {
    return (bytes[1] & 0x06) === 0 ? 'audio/aac' : 'audio/mpeg'
  }
  if (asciiAt(bytes, 4, 'ftyp')) {
    const brand = String.fromCharCode(...bytes.subarray(8, 12))
    if (brand === 'avif' || brand === 'avis') return 'image/avif'
    if (['isom', 'iso2', 'mp41', 'mp42', 'M4V ', 'qt  '].includes(brand)) return 'video/mp4'
  }
  return null
}

/**
 * Cards in the wild routinely lie about asset extensions (e.g. WebP bytes in a
 * `.png` asset), so a declared type that disagrees with recognizable magic
 * bytes is coerced to the detected type instead of rejected.
 */
function resolveEffectiveAssetContentType(asset: AddAssetInput): string {
  const detectedContentType = detectAssetContentType(asset.bytes)
  return detectedContentType ?? asset.contentType
}

export function isValidAssetId(id: string): boolean {
  return SHA256_RE.test(id)
}

export const PERSISTED_VERSION = 1

export interface PersistedAsset {
  id: string
  ext: string
  size: number
  contentType: string
}

export type PersistedInlayCatalogAssetType = 'image' | 'video' | 'audio' | 'signature'

export interface PersistedInlayCatalogEntry {
  assetId: string
  aliases: string[]
  ext: string
  height?: number
  name: string
  size: number
  type: PersistedInlayCatalogAssetType
  width?: number
}

interface AssetMetadataRow {
  id: string
  ext: string
  size: number
  content_type: string
}

function rowToPersistedAsset(row: AssetMetadataRow): PersistedAsset {
  return { id: row.id, ext: row.ext, size: row.size, contentType: row.content_type }
}

export const COLLECTION_FIELDS = [
  'modules',
  'plugins',
  'modelPresets',
  'promptPresets',
  'botPresets',
  'promptTemplate',
  'personas',
  'loadouts',
  'loreBook',
  'translatorPresets',
  'hypaV3Presets',
] as const

export type CollectionFieldKey = (typeof COLLECTION_FIELDS)[number]

const NON_SETTINGS_FIELDS = new Set<string>(['characters', ...COLLECTION_FIELDS, 'pluginCustomStorage'])

const COLLECTION_TABLE_MAP: Record<string, string> = {
  modules: 'modules',
  plugins: 'plugins',
  modelPresets: 'model_presets',
  promptPresets: 'prompt_presets',
  botPresets: 'bot_presets',
  promptTemplate: 'prompt_templates',
  personas: 'personas',
  loadouts: 'loadouts',
  loreBook: 'lore_books',
  translatorPresets: 'translator_presets',
  hypaV3Presets: 'hypa_v3_presets',
}

export function createCollectionTables(db: DatabaseSync): void {
  for (const tableName of Object.values(COLLECTION_TABLE_MAP)) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ${tableName} (
        position INTEGER PRIMARY KEY,
        data_json TEXT NOT NULL CHECK (json_valid(data_json))
      )
    `)
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS plugin_custom_storage (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL CHECK (json_valid(value_json))
    )
  `)
}

/**
 * Persisted global lorebook ids are API identities. Repair them before a row
 * reaches a resource response or command baseline; otherwise the browser and
 * server can independently mint different ids for the same legacy row.
 */
export function repairPersistedGlobalLorebookIds(database: unknown): boolean {
  if (!isRecord(database) || !Array.isArray(database.loreBook)) return false

  let changed = false
  const lorebookIds = new Set<string>()
  for (const rawLorebook of database.loreBook) {
    if (!isRecord(rawLorebook)) continue

    let lorebookId = typeof rawLorebook.id === 'string' && rawLorebook.id.trim() ? rawLorebook.id : ''
    if (!lorebookId || lorebookIds.has(lorebookId)) {
      lorebookId = randomUUID()
      rawLorebook.id = lorebookId
      changed = true
    }
    lorebookIds.add(lorebookId)

    if (!Array.isArray(rawLorebook.data)) continue
    const entryIds = new Set<string>()
    for (const rawEntry of rawLorebook.data) {
      if (!isRecord(rawEntry)) continue
      let entryId = typeof rawEntry.id === 'string' && rawEntry.id.trim() ? rawEntry.id : ''
      if (!entryId || entryIds.has(entryId)) {
        entryId = randomUUID()
        rawEntry.id = entryId
        changed = true
      }
      entryIds.add(entryId)
    }
  }
  return changed
}

export function repairPersistedGlobalLorebookIdsInSqlite(db: DatabaseSync): boolean {
  let changed = false
  const rows = db.prepare('SELECT position, data_json FROM lore_books ORDER BY position').all() as Array<{
    position: number
    data_json: string
  }>
  if (rows.length > 0) {
    const projected = { loreBook: rows.map((row) => JSON.parse(row.data_json)) }
    if (repairPersistedGlobalLorebookIds(projected)) {
      const update = db.prepare('UPDATE lore_books SET data_json = ? WHERE position = ?')
      projected.loreBook.forEach((lorebook, index) => {
        update.run(JSON.stringify(lorebook), rows[index].position)
      })
      changed = true
    }
  }

  // Defensive fallback for stores that still carry an embedded collection in
  // settings because collection extraction never completed.
  const settingsRow = db.prepare('SELECT data_json FROM settings WHERE id = 1').get() as
    | { data_json: string }
    | undefined
  if (settingsRow) {
    const settings = JSON.parse(settingsRow.data_json)
    if (repairPersistedGlobalLorebookIds(settings)) {
      db.prepare('UPDATE settings SET data_json = ? WHERE id = 1').run(JSON.stringify(settings))
      changed = true
    }
  }
  return changed
}

function loadCollectionsFromSqlite(db: DatabaseSync, database: Record<string, unknown>): Record<string, unknown> {
  const merged = { ...database }
  for (const [field, tableName] of Object.entries(COLLECTION_TABLE_MAP)) {
    const rows = db.prepare(`SELECT data_json FROM ${tableName} ORDER BY position`).all() as unknown as Array<{
      data_json: string
    }>
    if (rows.length > 0) {
      merged[field] = rows.map((r) => JSON.parse(r.data_json))
    }
    // SQLite empty → keep existing value ([] marker or absent); don't fabricate a field.
  }
  const storageRows = db.prepare('SELECT key, value_json FROM plugin_custom_storage').all() as unknown as Array<{
    key: string
    value_json: string
  }>
  if (storageRows.length > 0) {
    const storage: Record<string, unknown> = {}
    for (const row of storageRows) {
      if (isPluginStorageEmptySentinelKey(row.key)) continue
      storage[row.key] = JSON.parse(row.value_json)
    }
    merged.pluginCustomStorage = storage
  }
  // SQLite empty → keep existing value ({} marker or absent).
  return merged
}

export function replaceAllCollectionsInTable(db: DatabaseSync, database: unknown): void {
  if (!isRecord(database)) return
  for (const [field, tableName] of Object.entries(COLLECTION_TABLE_MAP)) {
    const arr = database[field]
    writeCollectionTableRows(db, tableName, Array.isArray(arr) ? arr : [])
  }
  recordTableWrite('plugin_custom_storage')
  db.exec('DELETE FROM plugin_custom_storage')
  const storage = database.pluginCustomStorage
  if (isRecord(storage)) {
    const entries = Object.entries(storage)
    if (entries.length === 0) {
      insertPluginStorageEmptySentinel(db)
      return
    }
    const stmt = db.prepare('INSERT INTO plugin_custom_storage (key, value_json) VALUES (?, ?)')
    for (const [key, value] of entries) {
      stmt.run(key, JSON.stringify(value ?? null))
    }
  }
}

export function createSettingsTable(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data_json TEXT NOT NULL CHECK (json_valid(data_json))
    )
  `)
}

export function loadSettingsFromSqlite(db: DatabaseSync): Record<string, unknown> | null {
  const row = db.prepare('SELECT data_json FROM settings WHERE id = 1').get() as { data_json: string } | undefined
  if (!row) return null
  const parsed = JSON.parse(row.data_json)
  return isRecord(parsed) ? parsed : null
}

export function loadServerIntentCompletionSettings(db: DatabaseSync): Record<string, unknown> | null {
  return loadSettingsFromSqlite(db)
}

export function extractSettings(database: Record<string, unknown>): Record<string, unknown> {
  const settings: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(database)) {
    if (!NON_SETTINGS_FIELDS.has(key)) {
      settings[key] = value
    }
  }
  return settings
}

export function replaceAllSettingsInTable(db: DatabaseSync, database: unknown): void {
  if (!isRecord(database)) return
  const settings = extractSettings(database)
  recordTableWrite('settings')
  db.exec('DELETE FROM settings')
  db.prepare('INSERT INTO settings (id, data_json) VALUES (1, ?)').run(JSON.stringify(settings))
}

export function stripSettings(next: Persisted): Persisted {
  if (!isRecord(next.database)) return next
  const kept: Record<string, unknown> = {}
  const db = next.database as Record<string, unknown>
  for (const key of Object.keys(db)) {
    if (NON_SETTINGS_FIELDS.has(key)) {
      kept[key] = db[key]
    }
  }
  return { ...next, database: kept }
}

export function stripCollections(next: Persisted): Persisted {
  if (!isRecord(next.database)) return next
  const stripped = { ...next.database }
  for (const field of COLLECTION_FIELDS) {
    if (Array.isArray(stripped[field])) {
      stripped[field] = []
    }
  }
  if (isRecord(stripped.pluginCustomStorage)) {
    stripped.pluginCustomStorage = {}
  }
  return { ...next, database: stripped }
}

export function createCharacterTables(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS characters (
      id TEXT PRIMARY KEY,
      position INTEGER NOT NULL,
      data_json TEXT NOT NULL CHECK (json_valid(data_json))
    );
    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL
        REFERENCES characters(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      data_json TEXT NOT NULL CHECK (json_valid(data_json))
    );
    CREATE INDEX IF NOT EXISTS idx_chats_character_id ON chats (character_id);
  `)
}

interface CharacterRow {
  id: string
  position: number
  data_json: string
}

interface ChatRow {
  id: string
  character_id: string
  position: number
  data_json: string
}

export interface CharacterSelectionRows {
  characterId: string
  position: number
  character: JsonRecord
  settings: JsonRecord
}

export interface CharacterMutationTarget {
  characterId: string
  /** Preserve the stored character payload without stamping its table id into
   * the JSON row. Used when every non-target field must remain exact. */
  exactCharacterRow?: boolean
}

export interface CharacterSelectionProjection {
  characterId: string
  currentChar: number
  lastInteraction?: number
}

function loadCharactersFromSqlite(db: DatabaseSync, options: { exactChatRows?: boolean } = {}): unknown[] {
  const charRows = db
    .prepare('SELECT id, position, data_json FROM characters ORDER BY position')
    .all() as unknown as CharacterRow[]
  if (charRows.length === 0) return []

  const chatRows = db
    .prepare('SELECT id, character_id, position, data_json FROM chats ORDER BY character_id, position')
    .all() as unknown as ChatRow[]

  const chatsByCharId = new Map<string, unknown[]>()
  for (const row of chatRows) {
    const chat = options.exactChatRows ? JSON.parse(row.data_json) : parseStoredChatRow(row.data_json)
    const list = chatsByCharId.get(row.character_id) ?? []
    list.push(chat)
    chatsByCharId.set(row.character_id, list)
  }

  return charRows.map((row) => {
    const char = JSON.parse(row.data_json) as Record<string, unknown>
    char.chats = chatsByCharId.get(row.id) ?? []
    return char
  })
}

export function replaceAllCharactersInTable(db: DatabaseSync, database: unknown): void {
  const characters = isRecord(database) && Array.isArray(database.characters) ? database.characters : []

  recordTableWrite('characters')
  recordTableWrite('chats')
  db.exec('DELETE FROM chats')
  db.exec('DELETE FROM characters')

  if (characters.length === 0) return

  const insertChar = db.prepare('INSERT INTO characters (id, position, data_json) VALUES (?, ?, ?)')
  const insertChat = db.prepare('INSERT INTO chats (id, character_id, position, data_json) VALUES (?, ?, ?, ?)')

  for (let i = 0; i < characters.length; i++) {
    const char = characters[i]
    if (!isRecord(char)) continue
    const chaId = char.chaId
    if (typeof chaId !== 'string') continue

    const chats = Array.isArray(char.chats) ? char.chats : []
    const { chats: _chats, ...charWithoutChats } = char
    insertChar.run(chaId, i, JSON.stringify(charWithoutChats))

    for (let j = 0; j < chats.length; j++) {
      const chat = chats[j]
      if (!isRecord(chat)) continue
      const chatId = chat.id
      if (typeof chatId !== 'string') continue
      const { message: _msg, hypaV3Data: _hypa, ...chatClean } = chat
      repairStoredChatGenerationSettings(chatClean)
      insertChat.run(chatId, chaId, j, JSON.stringify(chatClean))
    }
  }
}

export function loadCharacterSelectionRows(db: DatabaseSync, characterId: string): CharacterSelectionRows {
  const settings = loadSettingsFromSqlite(db)
  if (settings === null) {
    throw new ValidationError('database must be an object before character commands can run')
  }

  const row = db.prepare('SELECT id, position, data_json FROM characters WHERE id = ?').get(characterId) as unknown as
    | CharacterRow
    | undefined
  if (!row) {
    throw new EntityNotFoundError(`Character not found: ${characterId}`)
  }

  const character = JSON.parse(row.data_json)
  if (!isRecord(character)) {
    throw new ValidationError(`Character row is not an object: ${characterId}`)
  }

  return {
    characterId: row.id,
    position: row.position,
    character,
    settings,
  }
}

export function writeCharacterSelectionRows(db: DatabaseSync, rows: CharacterSelectionRows): void {
  recordTableWrite('characters')
  db.prepare('UPDATE characters SET data_json = ? WHERE id = ?').run(JSON.stringify(rows.character), rows.characterId)
  recordTableWrite('settings')
  db.prepare('UPDATE settings SET data_json = ? WHERE id = 1').run(JSON.stringify(rows.settings))
}

export function loadCharacterSelectionProjection(
  db: DatabaseSync,
  characterId: string,
): CharacterSelectionProjection | null {
  const row = db.prepare('SELECT position, data_json FROM characters WHERE id = ?').get(characterId) as
    | Pick<CharacterRow, 'position' | 'data_json'>
    | undefined
  if (!row) return null

  const settings = loadSettingsFromSqlite(db)
  const currentChar =
    settings !== null && Number.isInteger(settings.currentChar) ? (settings.currentChar as number) : row.position
  const character = JSON.parse(row.data_json)
  const lastInteraction = isRecord(character) ? character.lastInteraction : undefined
  return {
    characterId,
    currentChar,
    ...(typeof lastInteraction === 'number' ? { lastInteraction } : {}),
  }
}

// --- Targeted writer kit -----------------------------------------------------
// Narrow SQLite writers that touch exactly the rows a single command changed,
// the building blocks that route broad commands onto row-level updates.
// Each writer performs only its `UPDATE`/`DELETE`+`INSERT` and reports its table
// to the mutation-range metric; it owns no revision/event emission and runs
// inside the caller's open `BEGIN IMMEDIATE` transaction. None of them touch the
// message store, `hypaV3Data`, or alternates. They leave every unrelated rowid
// stable (the rowid-stability contract `writeCharacterSelectionRows` set).

/** One `UPDATE settings` (id=1). Drop-in for the settings half of
 *  `writeCharacterSelectionRows`; the caller passes the (already-extracted)
 *  settings record to persist. */
export function writeSettingsOnly(db: DatabaseSync, settings: JsonRecord): void {
  recordTableWrite('settings')
  db.prepare('UPDATE settings SET data_json = ? WHERE id = 1').run(JSON.stringify(settings))
}

/** `UPDATE characters WHERE id=?` for one character row. `chats` is stripped to
 *  match the storage contract (chats live in the `chats` table). */
export function writeSingleCharacterRow(db: DatabaseSync, characterId: string, character: JsonRecord): void {
  const { chats: _chats, ...charWithoutChats } = character
  recordTableWrite('characters')
  db.prepare('UPDATE characters SET data_json = ? WHERE id = ?').run(JSON.stringify(charWithoutChats), characterId)
}

export function characterRowExists(db: DatabaseSync, characterId: string): boolean {
  const row = db.prepare('SELECT 1 AS found FROM characters WHERE id = ? LIMIT 1').get(characterId) as
    | { found: number }
    | undefined
  return !!row
}

export function nextCharacterRowPosition(db: DatabaseSync): number {
  const row = db.prepare('SELECT COALESCE(MAX(position) + 1, 0) AS position FROM characters').get() as {
    position: number
  }
  return row.position
}

/** INSERT one brand-new character row at the supplied position. `chats` is
 *  stripped to match the storage contract (chats live in the `chats` table). */
export function insertCharacterRow(db: DatabaseSync, position: number, character: JsonRecord): void {
  const characterId = character.chaId
  if (typeof characterId !== 'string' || characterId.trim() === '') {
    throw new ValidationError('character.chaId must be a non-empty string')
  }
  const { chats: _chats, ...charWithoutChats } = character
  recordTableWrite('characters')
  db.prepare('INSERT INTO characters (id, position, data_json) VALUES (?, ?, ?)').run(
    characterId,
    position,
    JSON.stringify(charWithoutChats),
  )
}

/** `UPDATE chats WHERE id=?` for one chat row. `message` / `hypaV3Data` are
 *  stripped to match the storage contract (they live in the message store). */
export function writeSingleChatRow(db: DatabaseSync, chatId: string, chat: JsonRecord): void {
  writeSingleChatRowData(db, chatId, chat, true)
}

/** Lorebook mutations already own their target-field repair. Preserve every
 * unrelated persisted chat field exactly while still respecting the storage
 * split for messages and hypa data. */
export function writeSingleChatRowExact(db: DatabaseSync, chatId: string, chat: JsonRecord): void {
  writeSingleChatRowData(db, chatId, chat, false)
}

function writeSingleChatRowData(
  db: DatabaseSync,
  chatId: string,
  chat: JsonRecord,
  repairGenerationSettings: boolean,
): void {
  const { message: _msg, hypaV3Data: _hypa, ...chatClean } = chat
  if (repairGenerationSettings) repairStoredChatGenerationSettings(chatClean)
  recordTableWrite('chats')
  const result = db.prepare('UPDATE chats SET data_json = ? WHERE id = ?').run(JSON.stringify(chatClean), chatId)
  if (Number(result.changes) === 0) {
    const row = db.prepare('SELECT 1 AS found FROM chats WHERE id = ? LIMIT 1').get(chatId) as
      | { found: number }
      | undefined
    if (!row) throw new EntityNotFoundError(`Chat row not found: ${chatId}`)
  }
}

/** Delete one chat row from the `chats` table (scoped by its parent character).
 *  Pairs with the message-store deletes for a chat removal; the caller re-stamps
 *  the remaining rows' positions. Keyed by character so a character-wide delete
 *  can iterate it. */
export function deleteCharacterChatRow(db: DatabaseSync, chatId: string, characterId: string): void {
  recordTableWrite('chats')
  db.prepare('DELETE FROM chats WHERE id = ? AND character_id = ?').run(chatId, characterId)
}

/** Delete one character's row and compact the positions of the rows after it so
 *  the `characters` table stays contiguous (matching the broad rewrite). The
 *  `chats.character_id` FK declares `ON DELETE CASCADE` and `openDatabase`
 *  sets `PRAGMA foreign_keys = ON`, so this single DELETE also removes the
 *  character's chat rows.
 *  Pairs with the message-store deletes for a character removal. Remaining
 *  rows keep their rowids (UPDATE/DELETE, no reINSERT). */
export function deleteCharacterRow(db: DatabaseSync, characterId: string): void {
  recordTableWrite('characters')
  // The FK cascade physically writes the chats table; record it so the
  // command-metric `writtenTables` budget stays truthful.
  recordTableWrite('chats')
  const row = db.prepare('SELECT position FROM characters WHERE id = ?').get(characterId) as
    | { position: number }
    | undefined
  db.prepare('DELETE FROM characters WHERE id = ?').run(characterId)
  if (row) {
    db.prepare('UPDATE characters SET position = position - 1 WHERE position > ?').run(row.position)
  }
}

/** Re-stamp one character's chat rows in place: `position` = array index and the
 *  updated `data_json`, keyed by id, for reorder / folder-cascade edits where the
 *  chat set is unchanged. Each row keeps its rowid (UPDATE, not DELETE+reINSERT);
 *  `message` / `hypaV3Data` are stripped (they live in the message store). */
export function writeCharacterChatRows(db: DatabaseSync, characterId: string, chats: readonly JsonRecord[]): void {
  recordTableWrite('chats')
  const stmt = db.prepare('UPDATE chats SET position = ?, data_json = ? WHERE id = ? AND character_id = ?')
  for (let i = 0; i < chats.length; i++) {
    const chat = chats[i]
    const chatId = chat.id
    if (typeof chatId !== 'string') continue
    const { message: _msg, hypaV3Data: _hypa, ...chatClean } = chat
    repairStoredChatGenerationSettings(chatClean)
    stmt.run(i, JSON.stringify(chatClean), chatId, characterId)
  }
}

/** INSERT one brand-new chat row for a character at `position` (e.g. fork's
 *  head `unshift`). The new chat's messages persist separately via the message
 *  store; `message` / `hypaV3Data` are stripped here. */
export function insertCharacterChatRow(
  db: DatabaseSync,
  characterId: string,
  position: number,
  chat: JsonRecord,
): void {
  const chatId = chat.id
  if (typeof chatId !== 'string') {
    throw new ValidationError('chat.id must be a non-empty string')
  }
  const { message: _msg, hypaV3Data: _hypa, ...chatClean } = chat
  repairStoredChatGenerationSettings(chatClean)
  recordTableWrite('chats')
  db.prepare('INSERT INTO chats (id, character_id, position, data_json) VALUES (?, ?, ?, ?)').run(
    chatId,
    characterId,
    position,
    JSON.stringify(chatClean),
  )
}

export function updateSettingsForCharacterAppend(
  db: DatabaseSync,
  characterId: string,
  character: JsonRecord,
  nextCharacterCount: number,
): void {
  const settings = loadSettingsFromSqlite(db)
  if (settings === null) {
    throw new ValidationError('database must be an object before character commands can run')
  }

  if (!Number.isInteger(settings.currentChar as number)) {
    settings.currentChar = nextCharacterCount > 0 ? 0 : -1
  }
  if ((settings.currentChar as number) >= nextCharacterCount) {
    settings.currentChar = nextCharacterCount > 0 ? nextCharacterCount - 1 : -1
  }
  if ((settings.currentChar as number) < -1) {
    settings.currentChar = nextCharacterCount > 0 ? 0 : -1
  }

  if (!Array.isArray(settings.characterOrder)) {
    settings.characterOrder = []
  }
  if (!character.trashTime && characterId !== '§temp') {
    const order = settings.characterOrder as unknown[]
    if (!characterOrderContains(order, characterId)) {
      order.push(characterId)
    }
  }

  writeSettingsOnly(db, settings)
}

function characterOrderContains(order: readonly unknown[], characterId: string): boolean {
  for (const entry of order) {
    if (entry === characterId) return true
    if (isRecord(entry) && Array.isArray(entry.data) && entry.data.includes(characterId)) {
      return true
    }
  }
  return false
}

function collectionTableForField(field: string): string {
  const tableName = COLLECTION_TABLE_MAP[field]
  if (!tableName) {
    throw new ValidationError(`Unknown collection field: ${field}`)
  }
  return tableName
}

function writeCollectionTableRows(db: DatabaseSync, tableName: string, array: readonly unknown[]): void {
  recordTableWrite(tableName)
  db.exec(`DELETE FROM ${tableName}`)
  if (array.length > 0) {
    const stmt = db.prepare(`INSERT INTO ${tableName} (position, data_json) VALUES (?, ?)`)
    for (let i = 0; i < array.length; i++) {
      stmt.run(i, JSON.stringify(array[i]))
    }
  }
}

/** Rebuild one collection table (DELETE + ordered reinsert) for
 *  create/delete/reorder. Leaves the other eight tables untouched. */
export function writeSingleCollectionTable(db: DatabaseSync, field: string, array: readonly unknown[]): void {
  const tableName = collectionTableForField(field)
  writeCollectionTableRows(db, tableName, array)
}

/** `UPDATE <collection> WHERE position=?` for a single pure field edit. Keeps
 *  the row's rowid stable (no delete+reinsert). */
export function writeSingleCollectionRow(db: DatabaseSync, field: string, position: number, value: unknown): void {
  const tableName = collectionTableForField(field)
  const json = JSON.stringify(value)
  recordTableWrite(tableName)
  db.prepare(`UPDATE ${tableName} SET data_json = ? WHERE position = ?`).run(json, position)
}

// The `promptTemplate` collection (`prompt_templates` table) is written through
// these named wrappers, never the bare field string, so literal-`'promptTemplate'`
// checks over `routes/commands.ts` stay focused on generic-settings writes while
// targeted-collection writes still address the table directly.
export function writePromptTemplatesTable(db: DatabaseSync, items: readonly unknown[]): void {
  writeSingleCollectionTable(db, 'promptTemplate', items)
}

export function writePromptTemplateRow(db: DatabaseSync, position: number, value: unknown): void {
  writeSingleCollectionRow(db, 'promptTemplate', position, value)
}

/** Single-key upsert on `plugin_custom_storage`. */
export function writePluginStorageKey(db: DatabaseSync, key: string, value: unknown): void {
  recordTableWrite('plugin_custom_storage')
  db.prepare('DELETE FROM plugin_custom_storage WHERE key = ?').run(PLUGIN_CUSTOM_STORAGE_EMPTY_SENTINEL_KEY)
  db.prepare(
    'INSERT INTO plugin_custom_storage (key, value_json) VALUES (?, ?) ' +
      'ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json',
  ).run(key, JSON.stringify(value ?? null))
}

/** Single-key delete on `plugin_custom_storage`. */
export function deletePluginStorageKey(db: DatabaseSync, key: string): void {
  recordTableWrite('plugin_custom_storage')
  db.prepare('DELETE FROM plugin_custom_storage WHERE key = ?').run(key)
  if (!hasPluginStorageUserRows(db)) insertPluginStorageEmptySentinel(db)
}

/** Rewrite the whole `plugin_custom_storage` table (DELETE-all + reinsert) to
 *  match the given key/value map. The bulk command's clear/replace semantics;
 *  mirrors the `plugin_custom_storage` tail of `replaceAllCollectionsInTable` but
 *  touches only that one table. */
export function replacePluginStorage(db: DatabaseSync, storage: Record<string, unknown>): void {
  recordTableWrite('plugin_custom_storage')
  db.exec('DELETE FROM plugin_custom_storage')
  const keys = Object.keys(storage)
  if (keys.length === 0) {
    insertPluginStorageEmptySentinel(db)
    return
  }
  const stmt = db.prepare('INSERT INTO plugin_custom_storage (key, value_json) VALUES (?, ?)')
  for (const key of keys) {
    stmt.run(key, JSON.stringify(storage[key] ?? null))
  }
}

function isPluginStorageEmptySentinelKey(key: string): boolean {
  return key === PLUGIN_CUSTOM_STORAGE_EMPTY_SENTINEL_KEY
}

function hasPluginStorageUserRows(db: DatabaseSync): boolean {
  const row = db
    .prepare('SELECT 1 AS found FROM plugin_custom_storage WHERE key != ? LIMIT 1')
    .get(PLUGIN_CUSTOM_STORAGE_EMPTY_SENTINEL_KEY) as { found: number } | undefined
  return !!row
}

function insertPluginStorageEmptySentinel(db: DatabaseSync): void {
  db.prepare('INSERT OR IGNORE INTO plugin_custom_storage (key, value_json) VALUES (?, ?)').run(
    PLUGIN_CUSTOM_STORAGE_EMPTY_SENTINEL_KEY,
    'null',
  )
}

export function createAssetMetadataTable(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      ext TEXT NOT NULL,
      size INTEGER NOT NULL,
      content_type TEXT NOT NULL
    )
  `)
}

export function createInlayCatalogTable(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS inlay_catalog (
      asset_id TEXT PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      width INTEGER CHECK (width IS NULL OR width > 0),
      height INTEGER CHECK (height IS NULL OR height > 0),
      aliases_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(aliases_json))
    )
  `)
}

function inlayTypeFromContentType(contentType: string): PersistedInlayCatalogAssetType | null {
  if (contentType === 'application/x-risu-inlay-signature+json') return 'signature'
  if (contentType.startsWith('image/')) return 'image'
  if (contentType.startsWith('audio/')) return 'audio'
  if (contentType.startsWith('video/')) return 'video'
  return null
}

interface InlayCatalogRow {
  asset_id: string
  aliases_json: string
  content_type: string
  ext: string
  height: number | null
  name: string
  size: number
  width: number | null
}

function inlayCatalogEntryFromRow(row: InlayCatalogRow): PersistedInlayCatalogEntry | null {
  const type = inlayTypeFromContentType(row.content_type)
  if (!type) return null
  let aliases: unknown
  try {
    aliases = JSON.parse(row.aliases_json)
  } catch {
    aliases = []
  }
  return {
    assetId: row.asset_id,
    aliases: Array.isArray(aliases) ? aliases.filter((alias): alias is string => typeof alias === 'string') : [],
    ext: row.ext,
    ...(row.height !== null ? { height: row.height } : {}),
    name: row.name,
    size: row.size,
    type,
    ...(row.width !== null ? { width: row.width } : {}),
  }
}

export function listInlayCatalogEntries(db: DatabaseSync): PersistedInlayCatalogEntry[] {
  const rows = db
    .prepare(
      `
        SELECT catalog.asset_id, catalog.name, catalog.width, catalog.height, catalog.aliases_json,
               assets.ext, assets.size, assets.content_type
        FROM inlay_catalog AS catalog
        INNER JOIN assets ON assets.id = catalog.asset_id
        ORDER BY catalog.name COLLATE NOCASE, catalog.asset_id
      `,
    )
    .all() as unknown as InlayCatalogRow[]
  return rows.flatMap((row) => {
    const entry = inlayCatalogEntryFromRow(row)
    return entry ? [entry] : []
  })
}

export function upsertInlayCatalogEntry(
  db: DatabaseSync,
  input: { assetId: string; aliases: readonly string[]; height?: number; name: string; width?: number },
): PersistedInlayCatalogEntry {
  const asset = getAssetMetadataById(db, input.assetId)
  if (!asset) throw new EntityNotFoundError(`Asset not found: ${input.assetId}`)
  if (!inlayTypeFromContentType(asset.contentType)) {
    throw new ValidationError(`Asset is not a supported inlay type: ${input.assetId}`)
  }

  const existing = db.prepare('SELECT aliases_json FROM inlay_catalog WHERE asset_id = ?').get(input.assetId) as
    | { aliases_json: string }
    | undefined
  const priorAliases = existing ? (JSON.parse(existing.aliases_json) as unknown) : []
  const aliases = Array.from(
    new Set([
      ...(Array.isArray(priorAliases)
        ? priorAliases.filter((alias): alias is string => typeof alias === 'string')
        : []),
      ...input.aliases,
    ]),
  ).filter((alias) => alias !== input.assetId)

  if (input.aliases.length > 0) {
    const incomingAliases = new Set(input.aliases)
    const otherRows = db
      .prepare('SELECT asset_id, aliases_json FROM inlay_catalog WHERE asset_id != ?')
      .all(input.assetId) as unknown as Array<{ asset_id: string; aliases_json: string }>
    const rewriteAliases = db.prepare('UPDATE inlay_catalog SET aliases_json = ? WHERE asset_id = ?')
    for (const row of otherRows) {
      const parsed = JSON.parse(row.aliases_json) as unknown
      if (!Array.isArray(parsed)) continue
      const filtered = parsed.filter(
        (alias): alias is string => typeof alias === 'string' && !incomingAliases.has(alias),
      )
      if (filtered.length !== parsed.length) rewriteAliases.run(JSON.stringify(filtered), row.asset_id)
    }
  }

  db.prepare(
    `
      INSERT INTO inlay_catalog (asset_id, name, width, height, aliases_json)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(asset_id) DO UPDATE SET
        name = excluded.name,
        width = excluded.width,
        height = excluded.height,
        aliases_json = excluded.aliases_json
    `,
  ).run(input.assetId, input.name, input.width ?? null, input.height ?? null, JSON.stringify(aliases))
  recordTableWrite('inlay_catalog')

  const entry = listInlayCatalogEntries(db).find((candidate) => candidate.assetId === input.assetId)
  if (!entry) throw new Error(`Failed to read inlay catalog entry after upsert: ${input.assetId}`)
  return entry
}

export function deleteInlayCatalogEntry(db: DatabaseSync, assetId: string): boolean {
  const result = db.prepare('DELETE FROM inlay_catalog WHERE asset_id = ?').run(assetId)
  if (result.changes > 0) recordTableWrite('inlay_catalog')
  return result.changes > 0
}

export function getAllAssetMetadata(db: DatabaseSync): PersistedAsset[] {
  const rows = db
    .prepare('SELECT id, ext, size, content_type FROM assets ORDER BY id')
    .all() as unknown as AssetMetadataRow[]
  return rows.map(rowToPersistedAsset)
}

export function getAssetMetadataById(db: DatabaseSync, id: string): PersistedAsset | null {
  const row = db.prepare('SELECT id, ext, size, content_type FROM assets WHERE id = ?').get(id) as unknown as
    | AssetMetadataRow
    | undefined
  return row ? rowToPersistedAsset(row) : null
}

export function insertAssetMetadataBatch(db: DatabaseSync, assets: readonly PersistedAsset[]): void {
  if (assets.length === 0) return
  const stmt = db.prepare('INSERT OR IGNORE INTO assets (id, ext, size, content_type) VALUES (?, ?, ?, ?)')
  for (const asset of assets) {
    stmt.run(asset.id, asset.ext, asset.size, asset.contentType)
  }
}

export function deleteAssetMetadataByIds(db: DatabaseSync, ids: readonly string[]): void {
  if (ids.length === 0) return
  const stmt = db.prepare('DELETE FROM assets WHERE id = ?')
  for (const id of ids) {
    stmt.run(id)
  }
}

export function getAssetMetadataCount(db: DatabaseSync): number {
  const row = db.prepare('SELECT COUNT(*) AS count FROM assets').get() as { count: number }
  return row.count
}

export function getMissingAssetIds(db: DatabaseSync, ids: readonly string[]): string[] {
  if (ids.length === 0) return []
  const stmt = db.prepare('SELECT id FROM assets WHERE id = ?')
  return ids.filter((id) => !stmt.get(id))
}

export interface Persisted {
  _version: number
  database: unknown | null
  assets: PersistedAsset[]
}

export interface ChatHydrationPayload {
  chatId: string
  message: unknown[]
  hypaV3Data: unknown
  /** Present on single-chat hydration; omitted from bulk hydration. */
  alternates?: unknown[]
}

export interface BulkChatHydrationPayload {
  chats: ChatHydrationPayload[]
  missing: string[]
}

export interface CharacterLorebookHydrationPayload {
  characterId: string
  globalLore: unknown[]
}

export interface BulkCharacterLorebookHydrationPayload {
  characters: CharacterLorebookHydrationPayload[]
  missing: string[]
}

export interface PresetHydrationPayload {
  presetId: string
  preset: JsonRecord
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

export type BackupDatabaseValidationErrorCode = 'backup_database_missing' | 'backup_database_invalid'

export class BackupDatabaseValidationError extends ValidationError {
  constructor(readonly code: BackupDatabaseValidationErrorCode) {
    super(code)
    this.name = 'BackupDatabaseValidationError'
  }
}

export const AUTOMATIC_BACKUP_ERROR = 'automatic_backup_failed'

export class AutomaticBackupError extends Error {
  readonly code = AUTOMATIC_BACKUP_ERROR

  constructor(cause: unknown) {
    super(AUTOMATIC_BACKUP_ERROR, { cause })
    this.name = 'AutomaticBackupError'
  }
}

export class RevisionMismatchError extends Error {
  readonly currentRevision: number
  constructor(currentRevision: number, message = 'Revision mismatch') {
    super(message)
    this.name = 'RevisionMismatchError'
    this.currentRevision = currentRevision
  }
}

export class EntityNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EntityNotFoundError'
  }
}

function dbJsonPath(dataDir: string): string {
  return path.join(dataDir, 'db.json')
}

export interface LegacyDatabaseImportLogger {
  warn(bindings: Record<string, unknown>, message: string): void
  error(bindings: Record<string, unknown>, message: string): void
}

class LegacyDatabaseSnapshotParseError extends Error {
  constructor(
    readonly filePath: string,
    cause: unknown,
  ) {
    super(
      `Legacy database snapshot at ${filePath} could not be parsed. Repair or move the file, then restart the server.`,
      { cause },
    )
    this.name = 'LegacyDatabaseSnapshotParseError'
  }
}

class LegacyDatabaseSnapshotEnvelopeError extends Error {
  constructor(readonly filePath: string) {
    super(`Legacy database snapshot at ${filePath} does not contain an object database`)
    this.name = 'LegacyDatabaseSnapshotEnvelopeError'
  }
}

function logLegacyDatabaseImportWarning(
  logger: LegacyDatabaseImportLogger | undefined,
  bindings: Record<string, unknown>,
  message: string,
): void {
  if (logger) {
    logger.warn(bindings, message)
  } else {
    console.warn(message, bindings)
  }
}

function logLegacyDatabaseImportError(
  logger: LegacyDatabaseImportLogger | undefined,
  bindings: Record<string, unknown>,
  message: string,
): void {
  if (logger) {
    logger.error(bindings, message)
  } else {
    console.error(message, bindings)
  }
}

function readLegacyDatabaseSnapshot(filePath: string): Persisted {
  const raw = fs.readFileSync(filePath, 'utf8')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new LegacyDatabaseSnapshotParseError(filePath, err)
  }
  if (!isRecord(parsed) || !isRecord(parsed.database)) {
    throw new LegacyDatabaseSnapshotEnvelopeError(filePath)
  }
  return {
    _version: typeof parsed._version === 'number' ? parsed._version : PERSISTED_VERSION,
    database: parsed.database,
    assets: Array.isArray(parsed.assets) ? (parsed.assets as PersistedAsset[]) : [],
  }
}

/**
 * Import one legacy snapshot from its current path without moving or rewriting
 * it. The caller owns the surrounding transaction so restore can compose these
 * writes with its table swap and boot can make the full migration atomic.
 */
function importLegacyDatabaseSnapshot(db: DatabaseSync, filePath: string): void {
  const parsed = readLegacyDatabaseSnapshot(filePath)
  const database = parsed.database as JsonRecord

  repairPersistedGlobalLorebookIds(database)
  replaceAllSettingsInTable(db, database)
  replaceAllCharactersInTable(db, database)
  replaceAllCollectionsInTable(db, database)

  repairChatIds(database)
  const chats: { chatId: string; messages: unknown[] }[] = []
  const hypa: { chatId: string; hypaV3Data: unknown }[] = []
  eachChat(database, (chat) => {
    const messages = Array.isArray(chat.message) ? chat.message : []
    const chatId = chat.id as string
    if (messages.length > 0) chats.push({ chatId, messages })
    if (chat.hypaV3Data !== undefined) hypa.push({ chatId, hypaV3Data: chat.hypaV3Data })
  })
  if (chats.length > 0) replaceAllChatMessages(db, chats)
  if (hypa.length > 0) replaceAllChatHypaV3(db, hypa)

  if (parsed.assets.length > 0) insertAssetMetadataBatch(db, parsed.assets)
}

function nextLegacyDatabaseQuarantinePath(filePath: string): string {
  const base = `${filePath}.invalid`
  if (!fs.existsSync(base)) return base
  let suffix = 1
  while (fs.existsSync(`${base}.${suffix}`)) suffix += 1
  return `${base}.${suffix}`
}

function quarantineInvalidLegacyDatabaseSnapshot(
  filePath: string,
  logger: LegacyDatabaseImportLogger | undefined,
): void {
  const quarantinePath = nextLegacyDatabaseQuarantinePath(filePath)
  try {
    fs.renameSync(filePath, quarantinePath)
    logLegacyDatabaseImportWarning(
      logger,
      { filePath, quarantinePath },
      'Legacy database snapshot has an invalid envelope and was quarantined without being imported',
    )
  } catch (err) {
    // An invalid envelope must not crash-loop the server even when the data
    // directory cannot be renamed. Ignore it for this boot and keep the source
    // untouched so an operator can repair the filesystem problem.
    logLegacyDatabaseImportWarning(
      logger,
      { err, filePath, quarantinePath },
      'Legacy database snapshot has an invalid envelope but could not be quarantined; it was ignored for this boot',
    )
  }
}

export function emptyPersisted(): Persisted {
  return { _version: PERSISTED_VERSION, database: null, assets: [] }
}

function loadPersistedDatabase(
  db: DatabaseSync,
  _dataDir: string,
  options: { exactChatRows?: boolean } = {},
): unknown | null {
  let database: unknown = loadSettingsFromSqlite(db)
  if (database === null) return null
  const rec = database as Record<string, unknown>
  for (const field of COLLECTION_FIELDS) {
    if (field !== 'promptTemplate' && !(field in rec)) rec[field] = []
  }
  if (!('pluginCustomStorage' in rec)) rec.pluginCustomStorage = {}
  const sqliteChars = loadCharactersFromSqlite(db, options)
  if (sqliteChars.length > 0 || !Array.isArray(rec.characters)) {
    rec.characters = sqliteChars
  }
  database = loadCollectionsFromSqlite(db, rec)
  return database
}

export function loadPersisted(db: DatabaseSync, dataDir: string): Persisted {
  const database = loadPersistedDatabase(db, dataDir)
  if (database === null) return emptyPersisted()
  return {
    _version: PERSISTED_VERSION,
    database,
    assets: getAllAssetMetadata(db),
  }
}

function loadPersistedWithExactChatRows(db: DatabaseSync, dataDir: string): Persisted {
  const database = loadPersistedDatabase(db, dataDir, { exactChatRows: true })
  if (database === null) return emptyPersisted()
  return {
    _version: PERSISTED_VERSION,
    database,
    assets: getAllAssetMetadata(db),
  }
}

export function loadPersistedForSettingsMutation(db: DatabaseSync, dataDir: string): Persisted {
  const settings = loadSettingsFromSqlite(db)
  if (settings === null) return loadPersisted(db, dataDir)
  for (const field of NON_SETTINGS_FIELDS) {
    if (field in settings) return loadPersisted(db, dataDir)
  }
  return {
    _version: PERSISTED_VERSION,
    database: settings,
    assets: [],
  }
}

export function loadPersistedForCollectionMutation(
  db: DatabaseSync,
  dataDir: string,
  fieldKeys: readonly CollectionFieldKey[],
): Persisted {
  const { fields, settings } = loadDatabaseFieldsFromSqlite(db, fieldKeys)
  if (settings === null) return loadPersisted(db, dataDir)
  if (!settingsCanRepresentCollectionMutation(settings, fieldKeys)) {
    return loadPersisted(db, dataDir)
  }
  return {
    _version: PERSISTED_VERSION,
    database: { ...settings, ...fields },
    assets: [],
  }
}

function settingsCanRepresentCollectionMutation(
  settings: Record<string, unknown>,
  fieldKeys: readonly CollectionFieldKey[],
): boolean {
  const requested = new Set<string>(fieldKeys)
  for (const field of NON_SETTINGS_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(settings, field)) continue
    if (requested.has(field)) continue
    return false
  }
  return true
}

export function loadPersistedForCharacterMutation(
  db: DatabaseSync,
  dataDir: string,
  target: CharacterMutationTarget,
): Persisted {
  const settings = loadSettingsFromSqlite(db)
  if (settings === null) return loadPersisted(db, dataDir)

  const charRow = db
    .prepare('SELECT id, position, data_json FROM characters WHERE id = ?')
    .get(target.characterId) as unknown as CharacterRow | undefined
  if (!charRow) return loadPersisted(db, dataDir)

  const character = JSON.parse(charRow.data_json) as unknown
  if (!isRecord(character)) return loadPersisted(db, dataDir)
  if (!target.exactCharacterRow) character.chaId = target.characterId

  return {
    _version: PERSISTED_VERSION,
    database: { ...settings, characters: [character] },
    assets: [],
  }
}

export function loadPersistedDatabaseFields(
  db: DatabaseSync,
  _dataDir: string,
  fieldKeys: readonly string[],
): Record<string, unknown> {
  return loadDatabaseFieldsFromSqlite(db, fieldKeys).fields
}

/**
 * Character rows for resource APIs, with chat metadata retained and the
 * separately stored chat bodies omitted. When `enableLorebookStubs` is on,
 * `globalLore` stays behind the dedicated character-lorebook hydration routes.
 */
export function loadCharacterRowsForRead(db: DatabaseSync, _dataDir: string): JsonRecord[] {
  const { fields, settings } = loadDatabaseFieldsFromSqlite(db, ['characters'])
  const characters = Array.isArray(fields.characters) ? fields.characters : []
  const result = characters.filter(isRecord)
  eachChat({ characters: result }, (chat) => {
    chat.message = []
    delete chat.hypaV3Data
  })
  if (settings?.enableLorebookStubs === true) stripCharacterGlobalLoreForRead(result)
  return result
}

export function loadPresetHydration(
  db: DatabaseSync,
  dataDir: string,
  presetId: string,
): PresetHydrationPayload | null {
  const fields = loadPersistedDatabaseFields(db, dataDir, ['botPresets'])
  const presets = fields.botPresets
  if (!Array.isArray(presets)) return null
  for (const preset of presets) {
    if (!isRecord(preset)) continue
    if (preset.id === presetId) {
      return { presetId, preset }
    }
  }
  return null
}

function loadDatabaseFieldsFromSqlite(
  db: DatabaseSync,
  fieldKeys: readonly string[],
): { fields: Record<string, unknown>; settings: Record<string, unknown> | null } {
  const settings = loadSettingsFromSqlite(db)
  if (settings === null) {
    const fields: Record<string, unknown> = {}
    if (fieldKeys.includes('pluginCustomStorage')) {
      fields.pluginCustomStorage = loadPluginCustomStorageFieldFromSqlite(db) ?? {}
    }
    return { fields, settings: null }
  }

  const fields: Record<string, unknown> = {}
  for (const key of fieldKeys) {
    if (key === 'characters') {
      const sqliteChars = loadCharactersFromSqlite(db)
      if (sqliteChars.length > 0 || !Array.isArray(settings.characters)) {
        fields.characters = sqliteChars
      } else {
        fields.characters = settings.characters
      }
      continue
    }

    if (key === 'pluginCustomStorage') {
      const storage = loadPluginCustomStorageFieldFromSqlite(db)
      if (storage !== null) fields.pluginCustomStorage = storage
      else if (!Object.prototype.hasOwnProperty.call(settings, 'pluginCustomStorage')) {
        fields.pluginCustomStorage = {}
      }
      continue
    }

    const tableName = COLLECTION_TABLE_MAP[key]
    if (tableName !== undefined) {
      const collection = loadCollectionFieldFromSqlite(db, tableName)
      if (collection !== null) {
        fields[key] = collection
      } else if (Object.prototype.hasOwnProperty.call(settings, key)) {
        fields[key] = settings[key]
      } else if (key !== 'promptTemplate' && !Object.prototype.hasOwnProperty.call(settings, key)) {
        fields[key] = []
      }
      continue
    }

    if (Object.prototype.hasOwnProperty.call(settings, key)) {
      fields[key] = settings[key]
    }
  }

  return { fields, settings }
}

function loadCollectionFieldFromSqlite(db: DatabaseSync, tableName: string): unknown[] | null {
  const rows = db.prepare(`SELECT data_json FROM ${tableName} ORDER BY position`).all() as unknown as Array<{
    data_json: string
  }>
  if (rows.length === 0) return null
  return rows.map((row) => JSON.parse(row.data_json))
}

function loadPluginCustomStorageFieldFromSqlite(db: DatabaseSync): Record<string, unknown> | null {
  const rows = db.prepare('SELECT key, value_json FROM plugin_custom_storage').all() as unknown as Array<{
    key: string
    value_json: string
  }>
  if (rows.length === 0) return null
  const storage: Record<string, unknown> = {}
  for (const row of rows) {
    if (isPluginStorageEmptySentinelKey(row.key)) continue
    storage[row.key] = JSON.parse(row.value_json)
  }
  return storage
}

/**
 * Scoped character detail read for resource APIs. Reads one character and its
 * chat metadata without message/hypa bodies. It applies the same optional
 * lorebook-stub boundary as the aggregate character resource.
 */
export function loadSingleCharacterRowForRead(
  db: DatabaseSync,
  dataDir: string,
  characterId: string,
): JsonRecord | null {
  const settings = loadSettingsFromSqlite(db)
  if (settings === null) return loadSingleCharacterRowForReadBroad(db, dataDir, characterId)

  const charRow = db
    .prepare('SELECT id, position, data_json FROM characters WHERE id = ?')
    .get(characterId) as unknown as CharacterRow | undefined
  if (!charRow) return loadSingleCharacterRowForReadBroad(db, dataDir, characterId)

  const character = JSON.parse(charRow.data_json) as unknown
  if (!isRecord(character)) return loadSingleCharacterRowForReadBroad(db, dataDir, characterId)

  const chatRows = db
    .prepare('SELECT id, character_id, position, data_json FROM chats WHERE character_id = ? ORDER BY position')
    .all(charRow.id) as unknown as ChatRow[]
  character.chats = chatRows.map((row) => {
    const chat = parseStoredChatRow(row.data_json)
    if (isRecord(chat)) {
      chat.message = []
      delete chat.hypaV3Data
    }
    return chat
  })
  if (settings.enableLorebookStubs === true) delete character.globalLore
  return character
}

function loadSingleCharacterRowForReadBroad(db: DatabaseSync, dataDir: string, characterId: string): JsonRecord | null {
  return loadCharacterRowsForRead(db, dataDir).find((candidate) => candidate.chaId === characterId) ?? null
}

function stripCharacterGlobalLoreForRead(characters: readonly JsonRecord[]): void {
  for (const character of characters) delete character.globalLore
}

function selectDatabaseFields(
  database: Record<string, unknown>,
  fieldKeys: readonly string[],
): Record<string, unknown> {
  const fields: Record<string, unknown> = {}
  for (const key of fieldKeys) {
    if (Object.prototype.hasOwnProperty.call(database, key)) {
      fields[key] = database[key]
    }
  }
  return fields
}

// `loadPersistedWithMessages` is the message-aware read boundary used by
// full-corpus readers that need every chat hydrated (migration/backfill,
// export/save, and explicit broad fallbacks). Prompt assembly uses the
// scoped `loadPersistedForAssembly` path below. Messages live in the SQLite
// `messages` table; `loadPersisted` returns message-free chats.

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function parseStoredChatRow(dataJson: string): unknown {
  const chat = JSON.parse(dataJson) as unknown
  if (isRecord(chat)) repairStoredChatGenerationSettings(chat)
  return chat
}

function eachChat(database: unknown, visit: (chat: JsonRecord) => void): void {
  if (!isRecord(database) || !Array.isArray(database.characters)) return
  for (const character of database.characters) {
    if (!isRecord(character) || !Array.isArray(character.chats)) continue
    for (const chat of character.chats) {
      if (isRecord(chat)) visit(chat)
    }
  }
}

function chatIdNeedsRepair(chat: JsonRecord, seen: Set<string>): boolean {
  const id = chat.id
  return typeof id !== 'string' || id.trim() === '' || seen.has(id)
}

function repairChatIds(database: unknown): boolean {
  const seen = new Set<string>()
  let repaired = false
  eachChat(database, (chat) => {
    if (chatIdNeedsRepair(chat, seen)) {
      let id = randomUUID()
      while (seen.has(id)) id = randomUUID()
      chat.id = id
      repaired = true
    }
    seen.add(chat.id as string)
  })
  return repaired
}

function hasEmbeddedChatPayloadsOrBadIds(database: unknown): boolean {
  const seen = new Set<string>()
  let hasWork = false
  eachChat(database, (chat) => {
    if (chatIdNeedsRepair(chat, seen)) hasWork = true
    if (Array.isArray(chat.message) || chat.hypaV3Data !== undefined) hasWork = true
    if (typeof chat.id === 'string' && chat.id.trim() !== '') seen.add(chat.id)
  })
  return hasWork
}

/** `loadPersisted` + join each chat's messages (SQLite, with embedded fallback). */
export function loadPersistedWithMessages(db: DatabaseSync, dataDir: string): Persisted {
  const persisted = loadPersisted(db, dataDir)
  const grouped = getAllChatMessagesGrouped(db)
  const hypaGrouped = getAllChatHypaV3Grouped(db)
  eachChat(persisted.database, (chat) => {
    const chatId = chat.id
    if (typeof chatId !== 'string') {
      if (!Array.isArray(chat.message)) chat.message = []
      return
    }
    const rows = grouped.get(chatId)
    if (rows && rows.length > 0) {
      chat.message = rows
    } else if (!Array.isArray(chat.message)) {
      // No SQLite rows and no embedded array → genuinely empty chat.
      chat.message = []
    }
    // else: no rows but an embedded array is present → keep it (fallback).

    // hypaV3Data joins the same way. It is optional, so only set it when the
    // table has a row; otherwise keep any embedded value.
    if (hypaGrouped.has(chatId)) {
      chat.hypaV3Data = hypaGrouped.get(chatId)
    }
  })
  return persisted
}

/** Target selector for {@link loadPersistedForChatMutation}: the chat row
 *  itself, or (for the message PATCH/DELETE routes) the active message whose
 *  parent chat owns the mutation. */
export interface ChatMutationTarget {
  chatId?: string
  messageId?: string
  /** Skip persisted chat-field repair on both the scoped read and its broad
   * fallback. Used by mutations that must preserve every non-target field. */
  exactChatRow?: boolean
}

/**
 * Chat-scoped read for targeted command-mutation hot paths. A
 * message/scriptstate/generation mutation only locates one chat row and
 * mutates it (or does message-table writes through the kit writers), so it
 * must not pay `loadPersisted`'s 9-collection-table parse, the assets
 * metadata scan, or the whole characters+chats payload parse. Load
 * exactly the target chat row plus its parent character row.
 *
 * Behavior is preserved by construction:
 * - The chats table's PRIMARY KEY makes cross-character chat-id duplicates
 *   impossible in the table, so `normalizeAllCharacterChats`'s global dedup is
 *   a no-op on every state this loader serves; any state it cannot serve
 *   (unknown id, pre-extraction embedded characters) falls back to the broad
 *   `loadPersisted`, where the full normalize still runs.
 * - The single-row reads parse the identical `data_json` payloads the broad
 *   loader would have parsed for the same records.
 *
 * Never combine with a whole-database write-back (`writeDatabase`); the
 * mutation helper guards this.
 */
export function loadPersistedForChatMutation(db: DatabaseSync, dataDir: string, target: ChatMutationTarget): Persisted {
  const broadFallback = () =>
    target.exactChatRow ? loadPersistedWithExactChatRows(db, dataDir) : loadPersisted(db, dataDir)
  let chatId = target.chatId
  if (chatId === undefined && target.messageId !== undefined) {
    // Id-only resolution (no payload column) of the message's parent chat.
    const row = db
      .prepare('SELECT chat_id FROM messages WHERE uid = ? AND alternate = 0 LIMIT 1')
      .get(target.messageId) as { chat_id: string } | undefined
    chatId = row?.chat_id
  }
  if (chatId === undefined) return broadFallback()

  const chatRow = db
    .prepare('SELECT id, character_id, position, data_json FROM chats WHERE id = ?')
    .get(chatId) as unknown as ChatRow | undefined
  if (!chatRow) return broadFallback()

  const charRow = db
    .prepare('SELECT id, position, data_json FROM characters WHERE id = ?')
    .get(chatRow.character_id) as unknown as CharacterRow | undefined
  if (!charRow) return broadFallback()

  const character = JSON.parse(charRow.data_json) as Record<string, unknown>
  if (!isRecord(character)) return broadFallback()
  const chat = target.exactChatRow ? JSON.parse(chatRow.data_json) : parseStoredChatRow(chatRow.data_json)
  const chatRows = db
    .prepare('SELECT id, position FROM chats WHERE character_id = ? ORDER BY position')
    .all(chatRow.character_id) as unknown as Array<Pick<ChatRow, 'id' | 'position'>>
  character.chats = chatRows.map((row) => (row.id === chatRow.id ? chat : { id: row.id }))

  return {
    _version: PERSISTED_VERSION,
    database: { characters: [character] },
    assets: [],
  }
}

/**
 * `loadPersisted` + join ONLY the target chat's messages/hypaV3.
 * Prompt assembly reads exactly one chat's transcript, so it must not pay the
 * whole-table `getAllChatMessagesGrouped` / `getAllChatHypaV3Grouped` parse.
 * Every non-target chat gets `message = []` (downstream `eachChat`-style
 * iteration still sees an array); the target chat keeps
 * `loadPersistedWithMessages`'s exact semantics, including the embedded-array
 * fallback for a chat that is not extracted. The broad loader stays for the
 * genuine full-corpus consumers (assetGc / export / save / boot backfill).
 */
export function loadPersistedForAssembly(db: DatabaseSync, dataDir: string, chatId: string): Persisted {
  const persisted = loadPersisted(db, dataDir)
  hydrateAssemblyModuleBodies(db, persisted.database)
  const rows = getChatMessagesGroupedByIds(db, [chatId]).get(chatId)
  const hypaGrouped = getChatHypaV3GroupedByIds(db, [chatId])
  eachChat(persisted.database, (chat) => {
    if (chat.id !== chatId) {
      chat.message = []
      return
    }
    if (rows && rows.length > 0) {
      chat.message = rows
    } else if (!Array.isArray(chat.message)) {
      chat.message = []
    }
    // else: zero table rows but an embedded array → keep it (fallback).
    if (hypaGrouped.has(chatId)) {
      chat.hypaV3Data = hypaGrouped.get(chatId)
    }
  })
  return persisted
}

/**
 * Prompt assembly and post-generation module runtime need executable module
 * children (`trigger`, `regex`, `lorebook`, `assets`, ...), so keep generation
 * pinned to the authoritative server collection table whenever it exists.
 */
export function hydrateAssemblyModuleBodies(db: DatabaseSync, database: unknown): void {
  if (!isRecord(database)) return
  const modules = loadCollectionFieldFromSqlite(db, 'modules')
  if (modules === null) return
  database.modules = modules
}

/**
 * Memory-job-scoped database read. The embed/summarize batch
 * handlers read only settings-level fields (the hypa settings/presets/keys
 * and the summary-model routing fields) plus chat EXISTENCE
 * (`assertChatExists`), so they must not pay `loadPersisted`'s whole
 * characters+chats payload parse, its 9-collection-table parse, or the
 * assets metadata scan on every batch. Load the settings row, override
 * `hypaV3Presets` from its table (the only collection the memory paths
 * read), and stub `characters` to id-only chat rows.
 *
 * States the scoped read cannot serve fall back to the broad loader so
 * behavior stays identical: an uninitialized settings table returns the same
 * `null`, and a pre-extraction database (no character rows but an embedded
 * `characters` array in the settings JSON) keeps its embedded fallback.
 */
export function loadPersistedDatabaseForMemoryJob(db: DatabaseSync, dataDir: string): unknown {
  const settings = loadSettingsFromSqlite(db)
  if (settings === null) return loadPersisted(db, dataDir).database

  const charRows = db.prepare('SELECT id, position FROM characters ORDER BY position').all() as unknown as Array<
    Pick<CharacterRow, 'id' | 'position'>
  >
  if (charRows.length === 0 && Array.isArray(settings.characters)) {
    return loadPersisted(db, dataDir).database
  }

  const chatRows = db
    .prepare('SELECT id, character_id FROM chats ORDER BY character_id, position')
    .all() as unknown as Array<Pick<ChatRow, 'id' | 'character_id'>>
  const chatsByCharId = new Map<string, Array<{ id: string }>>()
  for (const row of chatRows) {
    const list = chatsByCharId.get(row.character_id) ?? []
    list.push({ id: row.id })
    chatsByCharId.set(row.character_id, list)
  }
  settings.characters = charRows.map((row) => ({
    chaId: row.id,
    chats: chatsByCharId.get(row.id) ?? [],
  }))

  // Mirror `loadCollectionsFromSqlite`: the table wins only when non-empty,
  // otherwise any embedded settings value is kept.
  const presetRows = db.prepare('SELECT data_json FROM hypa_v3_presets ORDER BY position').all() as unknown as Array<{
    data_json: string
  }>
  if (presetRows.length > 0) {
    settings.hypaV3Presets = presetRows.map((row) => JSON.parse(row.data_json))
  }
  return settings
}

/**
 * Split each chat's `message[]` into the messages table and return the
 * message-free `Persisted`. Pure SQLite write — runs inside the caller's open
 * transaction.
 *
 * The `next.database` object is mutated in place (its chats lose `message`) —
 * callers pass a throwaway clone.
 */
export function splitChatMessagesIntoTable(db: DatabaseSync, next: Persisted): Persisted {
  repairChatIds(next.database)
  const chats: { chatId: string; messages: unknown[] }[] = []
  const hypa: { chatId: string; hypaV3Data: unknown }[] = []
  eachChat(next.database, (chat) => {
    const messages = Array.isArray(chat.message) ? chat.message : []
    const chatId = chat.id as string
    chats.push({ chatId, messages })
    hypa.push({ chatId, hypaV3Data: chat.hypaV3Data })
    delete chat.message
    delete chat.hypaV3Data
  })
  replaceAllChatMessages(db, chats)
  replaceAllChatHypaV3(db, hypa)
  return next
}

/**
 * Convenience for non-transactional callers (and tests): split messages into
 * SQLite tables and sync all table families.
 */
export function writePersistedWithMessages(db: DatabaseSync, _dataDir: string, next: Persisted): void {
  const messageFree = splitChatMessagesIntoTable(db, next)
  replaceAllCharactersInTable(db, messageFree.database)
  replaceAllCollectionsInTable(db, messageFree.database)
  replaceAllSettingsInTable(db, messageFree.database)
}

/**
 * Surgical message persistence for the command path. Diff each chat's
 * `message[]` between the hydrated `baselineDatabase` and mutated `nextDatabase`,
 * writing only changed rows. Removed chats have their rows dropped. Runs inside
 * the caller's open transaction; does NOT touch db.json.
 */
export function syncChatMessages(db: DatabaseSync, baselineDatabase: unknown, nextDatabase: unknown): void {
  const baseline = new Map<string, unknown[]>()
  const baselineHypa = new Map<string, unknown>()
  eachChat(baselineDatabase, (chat) => {
    if (typeof chat.id === 'string') {
      baseline.set(chat.id, Array.isArray(chat.message) ? chat.message : [])
      baselineHypa.set(chat.id, chat.hypaV3Data)
    }
  })
  const nextIds = new Set<string>()
  eachChat(nextDatabase, (chat) => {
    if (typeof chat.id !== 'string') return
    nextIds.add(chat.id)
    const next = Array.isArray(chat.message) ? chat.message : []
    applyChatMessageDiff(db, chat.id, baseline.get(chat.id) ?? [], next)
    // Persist hypaV3Data only when it changed, like messages.
    if (JSON.stringify(baselineHypa.get(chat.id)) !== JSON.stringify(chat.hypaV3Data)) {
      setChatHypaV3(db, chat.id, chat.hypaV3Data)
    }
  })
  for (const chatId of baseline.keys()) {
    if (!nextIds.has(chatId)) {
      deleteChatMessages(db, chatId)
      deleteChatHypaV3(db, chatId)
    }
  }
}

/** Strip every chat's `message[]` + `hypaV3Data` for message-free wire/table writes. */
export function stripChatMessages(next: Persisted): Persisted {
  eachChat(next.database, (chat) => {
    delete chat.message
    delete chat.hypaV3Data
  })
  return next
}

/**
 * One-time boot migration: if a legacy `db.json` still exists, import all its
 * data into SQLite (settings, characters, collections, assets, messages) and,
 * only after the commit is checkpointed to the main database file, rename the
 * source to `db.json.migrated`. A crash after the durable commit but before the
 * rename leaves `db.json` in place for a harmless replacement import on the
 * next boot, before API writes can interleave. Once renamed, later boots are a
 * no-op.
 */
export function ensureDbJsonImported(db: DatabaseSync, dataDir: string, logger?: LegacyDatabaseImportLogger): void {
  const file = dbJsonPath(dataDir)
  if (!fs.existsSync(file)) return

  let transactionOpen = false
  try {
    db.exec('BEGIN IMMEDIATE')
    transactionOpen = true
    importLegacyDatabaseSnapshot(db, file)
    db.exec('COMMIT')
    transactionOpen = false
  } catch (err) {
    if (transactionOpen) db.exec('ROLLBACK')
    if (err instanceof LegacyDatabaseSnapshotEnvelopeError) {
      quarantineInvalidLegacyDatabaseSnapshot(file, logger)
      return
    }
    if (err instanceof LegacyDatabaseSnapshotParseError) {
      logLegacyDatabaseImportError(
        logger,
        { err: err.cause, filePath: file },
        'Legacy database snapshot could not be parsed. Repair or move the file, then restart the server; the file was left untouched',
      )
    }
    throw err
  }

  // WAL + synchronous=NORMAL can lose the newest commit on power failure.
  // Force the committed import into risu.db before retiring its only source.
  checkpointWal(db)
  fs.renameSync(file, `${file}.migrated`)
}

/**
 * One chat's hydration payload: messages, hypaV3Data, and reroll alternates for
 * the hydration endpoint. Uses the table with embedded db.json fallback for
 * chats that are not extracted. `alternates` is always present, empty when none.
 */
export function loadChatHydration(
  db: DatabaseSync,
  dataDir: string,
  chatId: string,
): { message: unknown[]; hypaV3Data: unknown; alternates: unknown[] } {
  const alternates = getAlternateMessages(db, chatId) as unknown[]
  let message = getChatMessages(db, chatId) as unknown[]
  let hypaV3Data = getChatHypaV3(db, chatId)
  if (message.length > 0) {
    // The messages table is authoritative once populated: extraction writes
    // messages and hypaV3Data together, so a missing `chat_hypa_v3` row means
    // the chat has none. A legitimately `undefined` hypaV3Data must not drop
    // the request into the whole-corpus `loadPersisted` fallback.
    return { message, hypaV3Data, alternates }
  }
  // Fallback for a chat not extracted into the table (zero message rows;
  // defensive — startup extraction normally makes the table authoritative).
  const persisted = loadPersisted(db, dataDir)
  eachChat(persisted.database, (chat) => {
    if (chat.id !== chatId) return
    if (message.length === 0 && Array.isArray(chat.message)) message = chat.message
    if (hypaV3Data === undefined && chat.hypaV3Data !== undefined) hypaV3Data = chat.hypaV3Data
  })
  return { message, hypaV3Data, alternates }
}

export interface ChatHydrationRangeInput {
  start?: number
  limit?: number
  tail?: number
}

export interface ChatHydrationRangePayload {
  message: unknown[]
  hypaV3Data: unknown
  alternates: unknown[]
  messageStart: number
  messageTotal: number
}

function normalizedMessageRange(total: number, range: ChatHydrationRangeInput): { start: number; limit: number } {
  if (Number.isInteger(range.tail) && (range.tail as number) > 0) {
    const limit = Math.min(range.tail as number, total)
    return { start: Math.max(0, total - limit), limit }
  }

  const start = Number.isInteger(range.start) && (range.start as number) > 0 ? (range.start as number) : 0
  const limit =
    Number.isInteger(range.limit) && (range.limit as number) > 0
      ? Math.min(range.limit as number, Math.max(0, total - start))
      : Math.max(0, total - start)
  return { start: Math.min(start, total), limit }
}

/**
 * One chat's hydration payload for a visible message window. The response
 * includes the transcript's total length so the client can keep stable absolute
 * message indexes while filling only loaded rows.
 */
export function loadChatHydrationRange(
  db: DatabaseSync,
  dataDir: string,
  chatId: string,
  range: ChatHydrationRangeInput,
): ChatHydrationRangePayload {
  const alternates = getAlternateMessages(db, chatId) as unknown[]
  const hypaV3Data = getChatHypaV3(db, chatId)
  const rowCount = countChatMessages(db, chatId)

  if (rowCount > 0) {
    const { start, limit } = normalizedMessageRange(rowCount, range)
    return {
      message: getChatMessagesRange(db, chatId, start, limit) as unknown[],
      hypaV3Data,
      alternates,
      messageStart: start,
      messageTotal: rowCount,
    }
  }

  // Defensive fallback for pre-extraction / embedded chat payloads. This path is
  // not expected during normal Fastify runtime, but preserves the old route's
  // behavior while still honoring the requested range.
  const full = loadChatHydration(db, dataDir, chatId)
  const { start, limit } = normalizedMessageRange(full.message.length, range)
  return {
    message: full.message.slice(start, start + limit),
    hypaV3Data: full.hypaV3Data,
    alternates,
    messageStart: start,
    messageTotal: full.message.length,
  }
}

const GENERATION_CHAT_FALLBACK_TAIL = 8

export function loadGenerationChatHydration(
  db: DatabaseSync,
  dataDir: string,
  chatId: string,
  messageId?: string,
): ChatHydrationRangePayload {
  const location = messageId ? getActiveMessageLocationById(db, messageId) : undefined
  if (location?.chatId === chatId) {
    return loadChatHydrationRange(db, dataDir, chatId, { start: location.seq })
  }
  return loadChatHydrationRange(db, dataDir, chatId, { tail: GENERATION_CHAT_FALLBACK_TAIL })
}

export function loadChatHydrations(
  db: DatabaseSync,
  dataDir: string,
  chatIds: readonly string[],
  options: { includeAlternates?: boolean } = {},
): BulkChatHydrationPayload {
  if (chatIds.length === 0) return { chats: [], missing: [] }

  const messages = getChatMessagesGroupedByIds(db, chatIds)
  const hypaV3ById = getChatHypaV3GroupedByIds(db, chatIds)
  const alternatesById = options.includeAlternates === false ? null : getAlternateMessagesGroupedByIds(db, chatIds)

  // Known-id + embedded-fallback resolution reads only the REQUESTED chat rows
  // (`WHERE id IN`), not the whole corpus. The chats table is the
  // known-id authority on exactly the states where `loadPersisted` would have
  // served it (settings present, characters extracted into SQLite — the FK ties
  // every chat row to a character row); any other state falls back to the broad
  // walk, which keeps the embedded-characters fallback and the exact `missing`
  // semantics.
  const requestedRows = sqliteIsCharacterAuthority(db) ? getChatRowsByIds(db, chatIds) : null
  if (requestedRows !== null) {
    const chats: ChatHydrationPayload[] = []
    const missing: string[] = []
    for (const chatId of chatIds) {
      const row = requestedRows.get(chatId)
      if (!row) {
        missing.push(chatId)
        continue
      }
      const messageRows = messages.get(chatId)
      const fallbackMessage = Array.isArray(row.message) ? row.message : undefined
      const payload: ChatHydrationPayload = {
        chatId,
        message: messageRows && messageRows.length > 0 ? messageRows : (fallbackMessage ?? []),
        hypaV3Data: hypaV3ById.has(chatId) ? hypaV3ById.get(chatId) : row.hypaV3Data,
      }
      if (alternatesById) payload.alternates = alternatesById.get(chatId) ?? []
      chats.push(payload)
    }
    return { chats, missing }
  }

  const fallbackById = new Map<string, { message?: unknown[]; hypaV3Data?: unknown }>()
  const knownChatIds = new Set<string>()
  const requestedChatIds = new Set(chatIds)
  const persisted = loadPersisted(db, dataDir)

  eachChat(persisted.database, (chat) => {
    if (typeof chat.id !== 'string') return
    knownChatIds.add(chat.id)
    if (!requestedChatIds.has(chat.id)) return
    fallbackById.set(chat.id, {
      message: Array.isArray(chat.message) ? chat.message : undefined,
      hypaV3Data: chat.hypaV3Data,
    })
  })

  const chats: ChatHydrationPayload[] = []
  const missing: string[] = []
  for (const chatId of chatIds) {
    if (!knownChatIds.has(chatId)) {
      missing.push(chatId)
      continue
    }

    const fallback = fallbackById.get(chatId)
    const messageRows = messages.get(chatId)
    const message = messageRows && messageRows.length > 0 ? messageRows : (fallback?.message ?? [])
    const payload: ChatHydrationPayload = {
      chatId,
      message,
      hypaV3Data: hypaV3ById.has(chatId) ? hypaV3ById.get(chatId) : fallback?.hypaV3Data,
    }
    if (alternatesById) payload.alternates = alternatesById.get(chatId) ?? []
    chats.push(payload)
  }

  return { chats, missing }
}

/**
 * Whether the SQLite character/chat tables are the known-id authority that the
 * broad `loadPersisted` walk would have used: settings initialized AND at least
 * one extracted character row. On a pre-extraction database (`characters`
 * empty), `loadPersisted` serves the settings-embedded characters instead, so
 * a scoped table read must not answer known/missing for it.
 */
function sqliteIsCharacterAuthority(db: DatabaseSync): boolean {
  if (loadSettingsFromSqlite(db) === null) return false
  const probe = db.prepare('SELECT 1 FROM characters LIMIT 1').get()
  return probe !== undefined
}

/** The requested chat rows by id (`WHERE id IN`, chunked). Non-record payloads
 *  are skipped — the broad walk's `eachChat` never visits them either, so the
 *  requested id reads as missing on both paths. */
function getChatRowsByIds(db: DatabaseSync, chatIds: readonly string[]): Map<string, JsonRecord> {
  const byId = new Map<string, JsonRecord>()
  const chunkSize = 500
  for (let index = 0; index < chatIds.length; index += chunkSize) {
    const chunk = chatIds.slice(index, index + chunkSize)
    const placeholders = chunk.map(() => '?').join(', ')
    const rows = db
      .prepare(`SELECT id, data_json FROM chats WHERE id IN (${placeholders})`)
      .all(...chunk) as unknown as Array<{ id: string; data_json: string }>
    for (const row of rows) {
      const parsed = parseStoredChatRow(row.data_json)
      if (isRecord(parsed)) byId.set(row.id, parsed)
    }
  }
  return byId
}

/**
 * One character's full `globalLore` for the hydration endpoint. In extracted
 * SQLite states this reads only the requested character row; pre-extraction
 * embedded-character states keep the broad fallback. Unknown / lore-less
 * characters return `[]`.
 */
export function loadCharacterLorebookHydration(
  db: DatabaseSync,
  dataDir: string,
  characterId: string,
): { globalLore: unknown[] } {
  if (sqliteIsCharacterAuthority(db)) {
    const character = getCharacterRowsByIds(db, [characterId]).get(characterId)
    return {
      globalLore:
        character?.chaId === characterId && Array.isArray(character.globalLore)
          ? (character.globalLore as unknown[])
          : [],
    }
  }

  const persisted = loadPersisted(db, dataDir)
  const characters =
    (
      persisted.database as {
        characters?: Array<{ chaId?: string; globalLore?: unknown } | null>
      } | null
    )?.characters ?? []
  const character = characters.find((candidate) => candidate?.chaId === characterId)
  const globalLore = character && Array.isArray(character.globalLore) ? (character.globalLore as unknown[]) : []
  return { globalLore }
}

export function loadCharacterLorebookHydrations(
  db: DatabaseSync,
  dataDir: string,
  characterIds: readonly string[],
): BulkCharacterLorebookHydrationPayload {
  if (characterIds.length === 0) return { characters: [], missing: [] }

  const requestedCharacterIds = new Set(characterIds)
  const knownCharacterIds = new Set<string>()
  const globalLoreById = new Map<string, unknown[]>()

  // Known-id + lore resolution reads only the REQUESTED character rows
  // (`WHERE id IN`), not the whole corpus; the table stores the
  // full un-stubbed `globalLore`. Same authority gate + broad fallback as
  // `loadChatHydrations`.
  let characters: ReadonlyArray<Record<string, unknown> | null>
  if (sqliteIsCharacterAuthority(db)) {
    characters = [...getCharacterRowsByIds(db, characterIds).values()]
  } else {
    const persisted = loadPersisted(db, dataDir)
    characters = (persisted.database as { characters?: Array<Record<string, unknown> | null> } | null)?.characters ?? []
  }

  for (const character of characters) {
    if (typeof character?.chaId !== 'string') continue
    knownCharacterIds.add(character.chaId)
    if (!requestedCharacterIds.has(character.chaId)) continue
    globalLoreById.set(character.chaId, Array.isArray(character.globalLore) ? (character.globalLore as unknown[]) : [])
  }

  const hydrated: CharacterLorebookHydrationPayload[] = []
  const missing: string[] = []
  for (const characterId of characterIds) {
    if (!knownCharacterIds.has(characterId)) {
      missing.push(characterId)
      continue
    }
    hydrated.push({
      characterId,
      globalLore: globalLoreById.get(characterId) ?? [],
    })
  }

  return { characters: hydrated, missing }
}

/** The requested character rows by id (`WHERE id IN`, chunked). Non-record
 *  payloads are skipped (read as missing, like the broad walk's guards). */
function getCharacterRowsByIds(db: DatabaseSync, characterIds: readonly string[]): Map<string, JsonRecord> {
  const byId = new Map<string, JsonRecord>()
  const chunkSize = 500
  for (let index = 0; index < characterIds.length; index += chunkSize) {
    const chunk = characterIds.slice(index, index + chunkSize)
    const placeholders = chunk.map(() => '?').join(', ')
    const rows = db
      .prepare(`SELECT id, data_json FROM characters WHERE id IN (${placeholders})`)
      .all(...chunk) as unknown as Array<{ id: string; data_json: string }>
    for (const row of rows) {
      const parsed = JSON.parse(row.data_json) as unknown
      if (isRecord(parsed)) byId.set(row.id, parsed)
    }
  }
  return byId
}

export function applyImport(
  db: DatabaseSync,
  dataDir: string,
  database: unknown,
  options: {
    beforeRevision?: (db: DatabaseSync) => void
    cloneBeforeMessageSplit?: boolean
    automaticBackupRetention?: number
  } = {},
): { revision: number; event: CommandEvent; databaseLineage: string; writerEpoch: number } {
  if (database === null || database === undefined) {
    throw new ValidationError('database payload missing')
  }
  createAutomaticSafetyBackup(db, dataDir, options.automaticBackupRetention)
  // The imported payload carries embedded `message[]`; split them into the
  // messages table and persist the message-free domain tables. By default we
  // persist a *clone* so the caller's `database` object is left fully hydrated —
  // downstream consumers (e.g. the legacy hypaV3 memory backfill in
  // routes/save.ts) read chat.message after this returns, and splitting mutates
  // its argument in place. SQLite writes commit atomically so table families
  // never land ahead of the message rows.
  const cloneBeforeMessageSplit = options.cloneBeforeMessageSplit ?? true
  const current = loadPersisted(db, dataDir)
  let transactionOpen = false
  db.exec('BEGIN IMMEDIATE')
  transactionOpen = true
  try {
    // A caller may pass an already-normalized throwaway object and opt out of
    // the repository clone. In that path, run the pre-revision hook before the
    // destructive message split so legacy memory backfill can still read
    // `message[]` and `hypaV3Data` from the import object.
    if (!cloneBeforeMessageSplit) {
      options.beforeRevision?.(db)
    }
    const messageFree = splitChatMessagesIntoTable(db, {
      ...current,
      database: cloneBeforeMessageSplit ? structuredClone(database) : database,
    })
    replaceAllCharactersInTable(db, messageFree.database)
    replaceAllCollectionsInTable(db, messageFree.database)
    replaceAllSettingsInTable(db, messageFree.database)
    if (cloneBeforeMessageSplit) {
      options.beforeRevision?.(db)
    }
    const databaseLineage = rotateDatabaseLineage(db)
    const event = persistRevisionedCommandEvent(db, COMMAND_EVENT_CATALOG.stateImported)
    db.exec('COMMIT')
    transactionOpen = false
    return { revision: event.revision, event, databaseLineage, writerEpoch: getDatabaseWriterMetadata(db).epoch }
  } catch (err) {
    if (transactionOpen) {
      db.exec('ROLLBACK')
    }
    throw err
  }
}

/**
 * First-run seed: write the server-owned default database to SQLite ONLY when
 * no database exists yet.
 *
 * Idempotent and clobber-safe — a valid settings object is a no-op, while
 * durable domain rows or revision history without one are a conflict. The
 * classification runs inside the same `BEGIN IMMEDIATE` transaction as the
 * write, so two clients opening the same fresh server (a second tab, a reload
 * race) can never seed twice or overwrite real data.
 */
export function initializeDefaultDatabase(db: DatabaseSync): {
  revision: number
  initialized: boolean
  event?: CommandEvent
} {
  let transactionOpen = false
  db.exec('BEGIN IMMEDIATE')
  transactionOpen = true
  try {
    const initialization = assessDatabaseInitialization(db)
    if (initialization.state === 'conflict') {
      throw new InitializeConflictError(initialization.evidence)
    }
    if (initialization.state === 'initialized') {
      // Already initialized → never overwrite. Report the live revision so the
      // caller can sync its cursor.
      const { revision } = getSchemaState(db)
      db.exec('COMMIT')
      transactionOpen = false
      return { revision, initialized: false }
    }
    const database = createInitialDatabase()
    repairPersistedGlobalLorebookIds(database)
    replaceAllCharactersInTable(db, database)
    replaceAllCollectionsInTable(db, database)
    replaceAllSettingsInTable(db, database)
    const event = persistRevisionedCommandEvent(db, COMMAND_EVENT_CATALOG.stateInitialized)
    db.exec('COMMIT')
    transactionOpen = false
    return { revision: event.revision, initialized: true, event }
  } catch (err) {
    if (transactionOpen) {
      db.exec('ROLLBACK')
    }
    throw err
  }
}

export function assetsDir(dataDir: string): string {
  return path.join(dataDir, 'assets')
}

export function assetPath(dataDir: string, entry: PersistedAsset): string {
  return path.join(assetsDir(dataDir), `${entry.id}.${entry.ext}`)
}

export function assetById(db: DatabaseSync, id: string): PersistedAsset | null {
  if (!isValidAssetId(id)) return null
  return getAssetMetadataById(db, id)
}

export interface AddAssetResult {
  entry: PersistedAsset
  created: boolean
  revision: number
  event?: CommandEvent
}

interface AddAssetInput {
  bytes: Buffer
  contentType: string
}

export interface StagedAssetInput {
  id: string
  size: number
  contentType: string
  filePath: string
}

export interface StagedAssetLiveFileCopy {
  file: string
  existedBefore: boolean
}

export interface StagedAssetPersistResult {
  entry: PersistedAsset
  created: boolean
}

export function addAsset(db: DatabaseSync, dataDir: string, args: AddAssetInput): AddAssetResult {
  return addAssets(db, dataDir, [args])[0]
}

export function addAssets(db: DatabaseSync, dataDir: string, assets: readonly AddAssetInput[]): AddAssetResult[] {
  const normalizedAssets = assets.map((asset) => {
    if (!CONTENT_TYPE_EXTENSIONS[asset.contentType]) {
      throw new ValidationError(`Unsupported content-type: ${asset.contentType}`)
    }
    const effectiveContentType = resolveEffectiveAssetContentType(asset)
    return effectiveContentType === asset.contentType ? asset : { ...asset, contentType: effectiveContentType }
  })

  const createdResults: AddAssetResult[] = []
  const results: AddAssetResult[] = []
  const currentRevision = getSchemaState(db).revision
  const createdFiles: Array<{ file: string; existedBefore: boolean }> = []
  let transactionOpen = false
  try {
    for (const asset of normalizedAssets) {
      const ext = CONTENT_TYPE_EXTENSIONS[asset.contentType]
      const sha256 = createHash('sha256').update(asset.bytes).digest('hex')
      const existing = getAssetMetadataById(db, sha256)
      if (existing) {
        if (existing.contentType !== asset.contentType) {
          throw new ValidationError(
            `Asset content-type conflict: existing ${existing.contentType}, uploaded ${asset.contentType}`,
          )
        }
        const file = assetPath(dataDir, existing)
        if (!fs.existsSync(file)) {
          fs.mkdirSync(assetsDir(dataDir), { recursive: true })
          fs.writeFileSync(file, asset.bytes)
        }
        results.push({ entry: existing, created: false, revision: currentRevision })
        continue
      }

      fs.mkdirSync(assetsDir(dataDir), { recursive: true })
      const file = path.join(assetsDir(dataDir), `${sha256}.${ext}`)
      const existedBefore = fs.existsSync(file)
      createdFiles.push({ file, existedBefore })
      fs.writeFileSync(file, asset.bytes)
      const entry: PersistedAsset = {
        id: sha256,
        ext,
        size: asset.bytes.length,
        contentType: asset.contentType,
      }
      const result = { entry, created: true, revision: currentRevision }
      createdResults.push(result)
      results.push(result)
    }

    if (createdResults.length === 0) {
      return results
    }

    db.exec('BEGIN IMMEDIATE')
    transactionOpen = true
    insertAssetMetadataBatch(
      db,
      createdResults.map((r) => r.entry),
    )
    db.exec('COMMIT')
    transactionOpen = false
    // Asset metadata is outside the projected Database domain. Registering an
    // immutable blob must not advance the global command revision: otherwise a
    // concurrent settings/chat command can conflict even though the two writes
    // cannot overlap semantically.
    return results
  } catch (err) {
    if (transactionOpen) {
      db.exec('ROLLBACK')
    }
    for (const { file, existedBefore } of createdFiles) {
      if (!existedBefore) {
        fs.rmSync(file, { force: true })
      }
    }
    throw err
  }
}

export function persistStagedAssetsInTransaction(
  db: DatabaseSync,
  dataDir: string,
  assets: readonly StagedAssetInput[],
  copiedFiles: StagedAssetLiveFileCopy[],
): StagedAssetPersistResult[] {
  if (assets.length === 0) return []
  for (const asset of assets) {
    if (!isValidAssetId(asset.id)) {
      throw new ValidationError('Local backup asset id is not a sha256 hex string')
    }
    if (!CONTENT_TYPE_EXTENSIONS[asset.contentType]) {
      throw new ValidationError(`Unsupported content-type: ${asset.contentType}`)
    }
    if (!Number.isSafeInteger(asset.size) || asset.size < 0) {
      throw new ValidationError('Local backup asset size is invalid')
    }
  }

  const createdAssets: PersistedAsset[] = []
  const results: StagedAssetPersistResult[] = []
  fs.mkdirSync(assetsDir(dataDir), { recursive: true })

  for (const asset of assets) {
    const existing = getAssetMetadataById(db, asset.id)
    if (existing) {
      const file = assetPath(dataDir, existing)
      if (!fs.existsSync(file)) {
        copiedFiles.push({ file, existedBefore: false })
        fs.copyFileSync(asset.filePath, file)
      }
      results.push({ entry: existing, created: false })
      continue
    }

    const entry: PersistedAsset = {
      id: asset.id,
      ext: CONTENT_TYPE_EXTENSIONS[asset.contentType],
      size: asset.size,
      contentType: asset.contentType,
    }
    const file = assetPath(dataDir, entry)
    const existedBefore = fs.existsSync(file)
    copiedFiles.push({ file, existedBefore })
    fs.copyFileSync(asset.filePath, file)
    createdAssets.push(entry)
    results.push({ entry, created: true })
  }

  insertAssetMetadataBatch(db, createdAssets)
  return results
}

export function cleanupCopiedStagedAssetFiles(copiedFiles: readonly StagedAssetLiveFileCopy[]): void {
  for (const { file, existedBefore } of copiedFiles) {
    if (!existedBefore) {
      fs.rmSync(file, { force: true })
    }
  }
}

export function missingAssetIds(db: DatabaseSync, ids: string[]): string[] {
  return getMissingAssetIds(db, ids)
}

export const BACKUP_MANIFEST_VERSION = 1

export const BACKUP_ID_RE = /^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}-[a-f0-9]{6}$/

export interface BackupManifest {
  _version: number
  id: string
  label: string | null
  /** Missing on backups created before backup kinds were introduced. */
  kind?: 'manual' | 'automatic'
  createdAt: string
  revision: number
  assetCount: number
}

export function isValidBackupId(id: string): boolean {
  return BACKUP_ID_RE.test(id)
}

export function generateBackupId(now: Date = new Date()): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  const ts =
    `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}` +
    `-${pad(now.getUTCHours())}-${pad(now.getUTCMinutes())}-${pad(now.getUTCSeconds())}`
  const suffix = randomBytes(3).toString('hex')
  return `${ts}-${suffix}`
}

export function backupsDir(dataDir: string): string {
  return path.join(dataDir, 'backups')
}

export function backupDir(dataDir: string, id: string): string {
  return path.join(backupsDir(dataDir), id)
}

// Exhaustive list of child entries inside `dataDir` that the backup contract
// owns. Every file/directory in this list must be snapshotted by `createBackup`
// and restored by `restoreBackup`.
//
// Implementation notes per entry:
//   - 'assets'   : content-addressed asset bytes. Copied as a directory.
//   - 'risu.db'  : SQLite database containing schema/revision state, domain tables,
//                  asset metadata, command events, chat-history tables, and Hypa
//                  V3 memory tables. Backed up after a WAL
//                  checkpoint; restored via ATTACH so the live `DatabaseSync` handle
//                  stays valid. Every table that must survive restore is listed in
//                  SQLITE_BACKUP_TABLES.
//   - 'save'     : legacy storage directory written by /api/v1/storage/*.
export const KNOWN_DATA_DIR_CHILDREN = ['assets', 'risu.db', 'save'] as const

function saveDir(dataDir: string): string {
  return path.join(dataDir, 'save')
}

function sqliteDbPath(dataDir: string): string {
  return path.join(dataDir, 'risu.db')
}

// Tables that must survive a backup/restore round-trip. Kept in sync with every
// SQLite table created by the server DDL; `createBackup` file-copies all of
// risu.db, but `restoreBackup` swaps tables one-by-one via ATTACH. A table
// absent here would not be restored, leaving live rows desynced from the restored
// SQLite snapshot.
const SQLITE_BACKUP_TABLES = [
  'schema_version',
  'command_events',
  'memory_chunks',
  'memory_summaries',
  'memory_embeddings',
  'memory_jobs',
  'messages',
  'chat_hypa_v3',
  'assets',
  'inlay_catalog',
  'characters',
  'chats',
  'modules',
  'plugins',
  'model_presets',
  'prompt_presets',
  'bot_presets',
  'prompt_templates',
  'personas',
  'loadouts',
  'lore_books',
  'translator_presets',
  'hypa_v3_presets',
  'plugin_custom_storage',
  'settings',
] as const

const REQUIRED_SQLITE_BACKUP_TABLES = [
  'schema_version',
  'settings',
] as const satisfies readonly (typeof SQLITE_BACKUP_TABLES)[number][]

type BackupDatabasePayloadStatus = 'missing' | 'invalid' | 'usable'

interface UsableBackupDatabasePayloads {
  legacyJson: boolean
  sqlite: boolean
}

function validateBackupSqlite(backupDbPath: string): BackupDatabasePayloadStatus {
  if (!fs.existsSync(backupDbPath)) return 'missing'

  try {
    const stat = fs.statSync(backupDbPath)
    if (!stat.isFile() || stat.size === 0) return 'invalid'

    const backupDb = new DatabaseSync(backupDbPath, { readOnly: true })
    try {
      const rows = backupDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
        name: string
      }>
      const tables = new Set(rows.map((row) => row.name))
      return REQUIRED_SQLITE_BACKUP_TABLES.every((table) => tables.has(table)) ? 'usable' : 'invalid'
    } finally {
      backupDb.close()
    }
  } catch {
    return 'invalid'
  }
}

function validateBackupLegacyJson(legacySnapshotPath: string): BackupDatabasePayloadStatus {
  if (!fs.existsSync(legacySnapshotPath)) return 'missing'

  try {
    const parsed = JSON.parse(fs.readFileSync(legacySnapshotPath, 'utf8')) as unknown
    return isRecord(parsed) && isRecord(parsed.database) ? 'usable' : 'invalid'
  } catch {
    return 'invalid'
  }
}

function validateBackupDatabasePayloads(
  backupDbPath: string,
  legacySnapshotPath: string,
): UsableBackupDatabasePayloads {
  const sqlite = validateBackupSqlite(backupDbPath)
  const legacyJson = validateBackupLegacyJson(legacySnapshotPath)

  // A present legacy snapshot is always imported during restore, including
  // when a SQLite snapshot is also present, so it must be valid before any
  // live directories are staged or moved.
  if (legacyJson === 'invalid') {
    throw new BackupDatabaseValidationError('backup_database_invalid')
  }
  if (sqlite === 'usable') {
    return { sqlite: true, legacyJson: legacyJson === 'usable' }
  }
  if (legacyJson === 'usable') {
    // Some transitional backups may contain a bad or empty risu.db beside a
    // valid legacy snapshot. Restore those through the legacy-only path.
    return { sqlite: false, legacyJson: true }
  }
  if (sqlite === 'missing' && legacyJson === 'missing') {
    throw new BackupDatabaseValidationError('backup_database_missing')
  }
  throw new BackupDatabaseValidationError('backup_database_invalid')
}

function checkpointWal(db: DatabaseSync): void {
  // After TRUNCATE the WAL file is removed; the main `risu.db` file contains
  // the committed state. Safe to file-copy after this call.
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  } catch {
    // Non-WAL databases (or unsupported pragma in some builds) — fall back to
    // a passive checkpoint and proceed; the copied bytes still represent the
    // committed state at this point because no writers are racing.
    db.exec('PRAGMA wal_checkpoint')
  }
}

export const AUTOMATIC_BACKUP_LABEL = 'Automatic safety snapshot'

export function createBackup(
  db: DatabaseSync,
  dataDir: string,
  label: string | null = null,
  options: { kind?: 'manual' | 'automatic' } = {},
): BackupManifest {
  const { revision } = getSchemaState(db)
  const id = generateBackupId()
  const dir = backupDir(dataDir, id)
  try {
    fs.mkdirSync(dir, { recursive: true })

    copyDirectoryIfPresent(assetsDir(dataDir), path.join(dir, 'assets'))
    // SQLite: flush WAL then file-copy.
    checkpointWal(db)
    const liveSqlite = sqliteDbPath(dataDir)
    if (fs.existsSync(liveSqlite)) {
      fs.copyFileSync(liveSqlite, path.join(dir, 'risu.db'))
    }
    // Legacy storage directory.
    copyDirectoryIfPresent(saveDir(dataDir), path.join(dir, 'save'))

    const manifest: BackupManifest = {
      _version: BACKUP_MANIFEST_VERSION,
      id,
      label,
      kind: options.kind ?? 'manual',
      createdAt: new Date().toISOString(),
      revision,
      assetCount: getAssetMetadataCount(db),
    }
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest))
    return manifest
  } catch (err) {
    // A manifest is written last, but remove partial payloads too so failed
    // snapshots never accumulate as hidden, unusable backup directories.
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      // Preserve the creation failure; callers fail closed on that cause.
    }
    throw err
  }
}

export function listBackups(dataDir: string): BackupManifest[] {
  const root = backupsDir(dataDir)
  if (!fs.existsSync(root)) return []
  const entries = fs.readdirSync(root)
  const manifests: BackupManifest[] = []
  for (const id of entries) {
    if (!isValidBackupId(id)) continue
    const manifestPath = path.join(root, id, 'manifest.json')
    if (!fs.existsSync(manifestPath)) continue
    // One unreadable/corrupt manifest must not 500 the whole backups list
    // skip the broken entry, keep listing the healthy ones. The
    // sort below relies on `createdAt`, so a parsed-but-misshapen manifest is
    // skipped too.
    let parsed: BackupManifest
    try {
      parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as BackupManifest
    } catch {
      continue
    }
    if (!parsed || typeof parsed !== 'object' || parsed.id !== id || typeof parsed.createdAt !== 'string') continue
    manifests.push(parsed)
  }
  manifests.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return manifests
}

function liveDatabaseIsInitialized(db: DatabaseSync): boolean {
  return db.prepare('SELECT 1 FROM settings WHERE id = 1').get() !== undefined
}

function pruneAutomaticBackups(dataDir: string, retention: number, protectedIds: ReadonlySet<string>): void {
  if (!Number.isInteger(retention) || retention <= 0) {
    throw new Error('automatic backup retention must be a positive integer')
  }

  const automatic = listBackups(dataDir)
    .filter((manifest) => manifest.kind === 'automatic')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  let excess = automatic.length - retention
  for (const manifest of automatic) {
    if (excess <= 0) break
    if (protectedIds.has(manifest.id)) continue
    deleteBackup(dataDir, manifest.id)
    excess -= 1
  }
}

/**
 * Capture initialized live state before a whole-database replacement. All work
 * is synchronous, so creation, retention, and the destructive transaction form
 * one event-loop critical section. A restore target can be protected from
 * retention until its payload is no longer in use.
 */
function createAutomaticSafetyBackup(
  db: DatabaseSync,
  dataDir: string,
  retention = DEFAULT_AUTOMATIC_BACKUP_RETENTION,
  protectedBackupIds: readonly string[] = [],
): BackupManifest | null {
  // First-run imports intentionally do not snapshot the empty schema. The
  // settings row is the same initialization authority used by loadPersisted.
  if (!liveDatabaseIsInitialized(db)) return null

  try {
    const manifest = createBackup(db, dataDir, AUTOMATIC_BACKUP_LABEL, { kind: 'automatic' })
    pruneAutomaticBackups(dataDir, retention, new Set([...protectedBackupIds, manifest.id]))
    return manifest
  } catch (err) {
    throw new AutomaticBackupError(err)
  }
}

function restoreSqliteFromBackup(db: DatabaseSync, backupDbPath: string | null, beforeCommit?: () => void): string {
  // Use ATTACH + table-level swap so the existing `db` handle stays valid
  // (file-rename would orphan open file descriptors and break every other
  // active route holding the same handle). The transaction is atomic with
  // respect to other queries on this connection.
  if (backupDbPath === null) {
    // No SQLite backup payload: clear live SQLite-backed state before importing
    // any legacy db.json, so rows absent from the snapshot do not survive
    // restore.
    db.exec('BEGIN')
    try {
      for (const table of SQLITE_BACKUP_TABLES) {
        if (table === 'schema_version') continue
        db.exec(`DELETE FROM ${table}`)
      }
      const databaseLineage = rotateDatabaseLineage(db)
      beforeCommit?.()
      db.exec('COMMIT')
      return databaseLineage
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }

  // ATTACH expects a SQL string literal; the path is constructed locally and
  // sanitised by replacing single quotes.
  const sqlLiteralPath = backupDbPath.replaceAll("'", "''")
  db.exec(`ATTACH DATABASE '${sqlLiteralPath}' AS bak`)
  let databaseLineage: string | undefined
  try {
    db.exec('BEGIN')
    try {
      for (const table of SQLITE_BACKUP_TABLES) {
        // Verify the table exists in the backup; older snapshots may predate
        // memory tables.
        const exists = db.prepare(`SELECT name FROM bak.sqlite_master WHERE type = 'table' AND name = ?`).get(table)
        if (table === 'schema_version') {
          // The live schema stays current because restore swaps table data, not
          // table definitions. Restore only the backup revision; copying an old
          // version would bypass migrations until the next process restart.
          if (exists) {
            db.exec(
              `UPDATE main.schema_version
               SET revision = COALESCE(
                 (SELECT revision FROM bak.schema_version WHERE id = 1),
                 revision
               )
               WHERE id = 1`,
            )
          }
          continue
        }
        db.exec(`DELETE FROM main.${table}`)
        if (exists) {
          db.exec(`INSERT INTO main.${table} SELECT * FROM bak.${table}`)
        }
      }
      repairPersistedGlobalLorebookIdsInSqlite(db)
      databaseLineage = rotateDatabaseLineage(db)
      beforeCommit?.()
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  } finally {
    db.exec('DETACH DATABASE bak')
  }
  if (!databaseLineage) {
    throw new Error('restore did not rotate database lineage')
  }
  return databaseLineage
}

export function restoreBackup(
  db: DatabaseSync,
  dataDir: string,
  id: string,
  options: { automaticBackupRetention?: number } = {},
): { revision: number; event: CommandEvent; databaseLineage: string; writerEpoch: number } {
  if (!isValidBackupId(id)) {
    throw new EntityNotFoundError(`Backup not found: ${id}`)
  }
  const manifestPath = path.join(backupDir(dataDir, id), 'manifest.json')
  const legacySnapshot = path.join(backupDir(dataDir, id), 'db.json')
  if (!fs.existsSync(manifestPath) && !fs.existsSync(legacySnapshot)) {
    throw new EntityNotFoundError(`Backup not found: ${id}`)
  }

  const backupSqlite = path.join(backupDir(dataDir, id), 'risu.db')
  const usableDatabasePayloads = validateBackupDatabasePayloads(backupSqlite, legacySnapshot)

  const automaticBackup = createAutomaticSafetyBackup(
    db,
    dataDir,
    options.automaticBackupRetention,
    // Retention must not delete an automatic snapshot while it is the active
    // restore source. The newly created snapshot is protected by the helper.
    [id],
  )

  const liveAssets = assetsDir(dataDir)
  const backupAssets = path.join(backupDir(dataDir, id), 'assets')
  const tmpAssets = path.join(dataDir, `.assets-${id}.tmp`)
  const oldAssets = path.join(dataDir, `.assets-${id}.old`)
  const liveSave = saveDir(dataDir)
  const backupSave = path.join(backupDir(dataDir, id), 'save')
  const tmpSave = path.join(dataDir, `.save-${id}.tmp`)
  const oldSave = path.join(dataDir, `.save-${id}.old`)

  rmDirectoryIfPresent(tmpAssets)
  rmDirectoryIfPresent(oldAssets)
  rmDirectoryIfPresent(tmpSave)
  rmDirectoryIfPresent(oldSave)

  if (fs.existsSync(backupAssets)) {
    fs.cpSync(backupAssets, tmpAssets, { recursive: true })
  } else {
    fs.mkdirSync(tmpAssets, { recursive: true })
  }
  if (fs.existsSync(backupSave)) {
    fs.cpSync(backupSave, tmpSave, { recursive: true })
  } else {
    fs.mkdirSync(tmpSave, { recursive: true })
  }

  if (fs.existsSync(liveAssets)) {
    fs.renameSync(liveAssets, oldAssets)
  }
  if (fs.existsSync(liveSave)) {
    fs.renameSync(liveSave, oldSave)
  }

  let event: CommandEvent | undefined
  let databaseLineage: string | undefined
  try {
    databaseLineage = restoreSqliteFromBackup(db, usableDatabasePayloads.sqlite ? backupSqlite : null, () => {
      // If the backup carries a legacy db.json, import it into SQLite inside the
      // restore transaction so a failed re-import rolls the whole restore back.
      // Read it directly from the backup: restore must never stage a stale
      // db.json in the live data directory, and the backup remains untouched.
      if (usableDatabasePayloads.legacyJson) {
        importLegacyDatabaseSnapshot(db, legacySnapshot)
      }
      event = persistRevisionedCommandEvent(db, COMMAND_EVENT_CATALOG.stateRestored)
      fs.renameSync(tmpAssets, liveAssets)
      fs.renameSync(tmpSave, liveSave)
    })
  } catch (err) {
    rmDirectoryIfPresent(liveAssets)
    if (fs.existsSync(oldAssets)) {
      fs.renameSync(oldAssets, liveAssets)
    }
    rmDirectoryIfPresent(liveSave)
    if (fs.existsSync(oldSave)) {
      fs.renameSync(oldSave, liveSave)
    }
    rmDirectoryIfPresent(tmpAssets)
    rmDirectoryIfPresent(tmpSave)
    throw err
  }

  rmDirectoryIfPresent(oldAssets)
  rmDirectoryIfPresent(oldSave)

  if (!event) {
    throw new Error('restore did not produce a command event')
  }
  if (!databaseLineage) {
    throw new Error('restore did not return database lineage')
  }
  if (automaticBackup) {
    try {
      // A retention cap of one temporarily needs both the restore source and
      // its safety snapshot. Once restore is complete, the old source may be
      // pruned without racing the operation; always retain the new snapshot.
      pruneAutomaticBackups(
        dataDir,
        options.automaticBackupRetention ?? DEFAULT_AUTOMATIC_BACKUP_RETENTION,
        new Set([automaticBackup.id]),
      )
    } catch {
      // The safety snapshot already exists and the restore has committed. Do
      // not report a false restore failure for post-operation housekeeping;
      // the next safety snapshot will retry bounded retention.
    }
  }
  return {
    revision: event.revision,
    event,
    databaseLineage,
    writerEpoch: getDatabaseWriterMetadata(db).epoch,
  }
}

export function deleteBackup(dataDir: string, id: string): void {
  if (!isValidBackupId(id)) {
    throw new EntityNotFoundError(`Backup not found: ${id}`)
  }
  const dir = backupDir(dataDir, id)
  if (!fs.existsSync(dir)) {
    throw new EntityNotFoundError(`Backup not found: ${id}`)
  }
  fs.rmSync(dir, { recursive: true, force: true })
}

function copyDirectoryIfPresent(from: string, to: string): void {
  if (!fs.existsSync(from)) return
  fs.cpSync(from, to, { recursive: true })
}

function rmDirectoryIfPresent(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true })
}
