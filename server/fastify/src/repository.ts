import { createHash, randomBytes, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { createInitialDatabase } from './databaseDefaults.js'
import { getSchemaState } from './db.js'
import {
  COMMAND_EVENT_CATALOG,
  persistRevisionedCommandEvent,
  type CommandEvent,
} from './commands/events.js'
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
  getChatMessagesGroupedByIds,
  replaceAllChatHypaV3,
  replaceAllChatMessages,
  setChatHypaV3,
} from './messageStore.js'

export const CONTENT_TYPE_EXTENSIONS: Record<string, string> = {
  'application/x-onnx': 'onnx',
  'application/x-risu-inlay-signature+json': 'json',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'audio/mpeg': 'mp3',
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

interface AssetMetadataRow {
  id: string
  ext: string
  size: number
  content_type: string
}

function rowToPersistedAsset(row: AssetMetadataRow): PersistedAsset {
  return { id: row.id, ext: row.ext, size: row.size, contentType: row.content_type }
}

const COLLECTION_FIELDS = [
  'modules',
  'plugins',
  'botPresets',
  'promptTemplate',
  'personas',
  'loadouts',
  'loreBook',
  'translatorPresets',
  'hypaV3Presets',
] as const

const NON_SETTINGS_FIELDS = new Set<string>([
  'characters',
  ...COLLECTION_FIELDS,
  'pluginCustomStorage',
])

const COLLECTION_TABLE_MAP: Record<string, string> = {
  modules: 'modules',
  plugins: 'plugins',
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

function loadCollectionsFromSqlite(
  db: DatabaseSync,
  database: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...database }
  for (const [field, tableName] of Object.entries(COLLECTION_TABLE_MAP)) {
    const rows = db
      .prepare(`SELECT data_json FROM ${tableName} ORDER BY position`)
      .all() as unknown as Array<{ data_json: string }>
    if (rows.length > 0) {
      merged[field] = rows.map((r) => JSON.parse(r.data_json))
    }
    // SQLite empty → keep existing value ([] marker or absent); don't fabricate a field.
  }
  const storageRows = db
    .prepare('SELECT key, value_json FROM plugin_custom_storage')
    .all() as unknown as Array<{ key: string; value_json: string }>
  if (storageRows.length > 0) {
    const storage: Record<string, unknown> = {}
    for (const row of storageRows) {
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
    recordTableWrite(tableName)
    db.exec(`DELETE FROM ${tableName}`)
    const arr = database[field]
    if (!Array.isArray(arr) || arr.length === 0) continue
    const stmt = db.prepare(`INSERT INTO ${tableName} (position, data_json) VALUES (?, ?)`)
    for (let i = 0; i < arr.length; i++) {
      stmt.run(i, JSON.stringify(arr[i]))
    }
  }
  recordTableWrite('plugin_custom_storage')
  db.exec('DELETE FROM plugin_custom_storage')
  const storage = database.pluginCustomStorage
  if (isRecord(storage)) {
    const stmt = db.prepare(
      'INSERT INTO plugin_custom_storage (key, value_json) VALUES (?, ?)',
    )
    for (const [key, value] of Object.entries(storage)) {
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

function loadSettingsFromSqlite(db: DatabaseSync): Record<string, unknown> | null {
  const row = db
    .prepare('SELECT data_json FROM settings WHERE id = 1')
    .get() as { data_json: string } | undefined
  if (!row) return null
  const parsed = JSON.parse(row.data_json)
  return isRecord(parsed) ? parsed : null
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

export interface CharacterSelectionProjection {
  characterId: string
  currentChar: number
  lastInteraction?: number
}

function loadCharactersFromSqlite(db: DatabaseSync): unknown[] {
  const charRows = db
    .prepare('SELECT id, position, data_json FROM characters ORDER BY position')
    .all() as unknown as CharacterRow[]
  if (charRows.length === 0) return []

  const chatRows = db
    .prepare('SELECT id, character_id, position, data_json FROM chats ORDER BY character_id, position')
    .all() as unknown as ChatRow[]

  const chatsByCharId = new Map<string, unknown[]>()
  for (const row of chatRows) {
    const chat = JSON.parse(row.data_json) as Record<string, unknown>
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
  const characters =
    isRecord(database) && Array.isArray(database.characters) ? database.characters : []

  recordTableWrite('characters')
  recordTableWrite('chats')
  db.exec('DELETE FROM chats')
  db.exec('DELETE FROM characters')

  if (characters.length === 0) return

  const insertChar = db.prepare(
    'INSERT INTO characters (id, position, data_json) VALUES (?, ?, ?)',
  )
  const insertChat = db.prepare(
    'INSERT INTO chats (id, character_id, position, data_json) VALUES (?, ?, ?, ?)',
  )

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
      insertChat.run(chatId, chaId, j, JSON.stringify(chatClean))
    }
  }
}

export function loadCharacterSelectionRows(
  db: DatabaseSync,
  characterId: string,
): CharacterSelectionRows {
  const settings = loadSettingsFromSqlite(db)
  if (settings === null) {
    throw new ValidationError('database must be an object before character commands can run')
  }

  const row = db
    .prepare('SELECT id, position, data_json FROM characters WHERE id = ?')
    .get(characterId) as CharacterRow | undefined
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
  db.prepare('UPDATE characters SET data_json = ? WHERE id = ?').run(
    JSON.stringify(rows.character),
    rows.characterId,
  )
  recordTableWrite('settings')
  db.prepare('UPDATE settings SET data_json = ? WHERE id = 1').run(JSON.stringify(rows.settings))
}

export function loadCharacterSelectionProjection(
  db: DatabaseSync,
  characterId: string,
): CharacterSelectionProjection | null {
  const row = db
    .prepare('SELECT position, data_json FROM characters WHERE id = ?')
    .get(characterId) as Pick<CharacterRow, 'position' | 'data_json'> | undefined
  if (!row) return null

  const settings = loadSettingsFromSqlite(db)
  const currentChar =
    settings !== null && Number.isInteger(settings.currentChar)
      ? (settings.currentChar as number)
      : row.position
  const character = JSON.parse(row.data_json)
  const lastInteraction = isRecord(character) ? character.lastInteraction : undefined
  return {
    characterId,
    currentChar,
    ...(typeof lastInteraction === 'number' ? { lastInteraction } : {}),
  }
}

// --- Targeted writer kit (Phase 0) ------------------------------------------
// Narrow SQLite writers that touch exactly the rows a single command changed,
// the building blocks the Tier write slices route the over-broad commands onto.
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
export function writeSingleCharacterRow(
  db: DatabaseSync,
  characterId: string,
  character: JsonRecord,
): void {
  const { chats: _chats, ...charWithoutChats } = character
  recordTableWrite('characters')
  db.prepare('UPDATE characters SET data_json = ? WHERE id = ?').run(
    JSON.stringify(charWithoutChats),
    characterId,
  )
}

/** `UPDATE chats WHERE id=?` for one chat row. `message` / `hypaV3Data` are
 *  stripped to match the storage contract (they live in the message store). */
export function writeSingleChatRow(db: DatabaseSync, chatId: string, chat: JsonRecord): void {
  const { message: _msg, hypaV3Data: _hypa, ...chatClean } = chat
  recordTableWrite('chats')
  db.prepare('UPDATE chats SET data_json = ? WHERE id = ?').run(JSON.stringify(chatClean), chatId)
}

/** Delete one chat row from the `chats` table (scoped by its parent character).
 *  Pairs with the message-store deletes for a chat removal; the caller re-stamps
 *  the remaining rows' positions. Keyed by character so a character-wide delete
 *  can iterate it. */
export function deleteCharacterChatRow(
  db: DatabaseSync,
  chatId: string,
  characterId: string,
): void {
  recordTableWrite('chats')
  db.prepare('DELETE FROM chats WHERE id = ? AND character_id = ?').run(chatId, characterId)
}

/** Delete one character's row and compact the positions of the rows after it so
 *  the `characters` table stays contiguous (matching the broad rewrite). Pairs
 *  with `deleteCharacterChats` + the message-store deletes for a character
 *  removal. Remaining rows keep their rowids (UPDATE/DELETE, no reINSERT). */
export function deleteCharacterRow(db: DatabaseSync, characterId: string): void {
  recordTableWrite('characters')
  const row = db.prepare('SELECT position FROM characters WHERE id = ?').get(characterId) as
    | { position: number }
    | undefined
  db.prepare('DELETE FROM characters WHERE id = ?').run(characterId)
  if (row) {
    db.prepare('UPDATE characters SET position = position - 1 WHERE position > ?').run(row.position)
  }
}

/** Delete every chat row belonging to a character in one statement. The chats'
 *  message / hypa rows are cleaned separately via the message-store deletes. */
export function deleteCharacterChats(db: DatabaseSync, characterId: string): void {
  recordTableWrite('chats')
  db.prepare('DELETE FROM chats WHERE character_id = ?').run(characterId)
}

/** Re-stamp one character's chat rows in place: `position` = array index and the
 *  updated `data_json`, keyed by id, for reorder / folder-cascade edits where the
 *  chat set is unchanged. Each row keeps its rowid (UPDATE, not DELETE+reINSERT);
 *  `message` / `hypaV3Data` are stripped (they live in the message store). */
export function writeCharacterChatRows(
  db: DatabaseSync,
  characterId: string,
  chats: readonly JsonRecord[],
): void {
  recordTableWrite('chats')
  const stmt = db.prepare(
    'UPDATE chats SET position = ?, data_json = ? WHERE id = ? AND character_id = ?',
  )
  for (let i = 0; i < chats.length; i++) {
    const chat = chats[i]
    const chatId = chat.id
    if (typeof chatId !== 'string') continue
    const { message: _msg, hypaV3Data: _hypa, ...chatClean } = chat
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
  recordTableWrite('chats')
  db.prepare('INSERT INTO chats (id, character_id, position, data_json) VALUES (?, ?, ?, ?)').run(
    chatId,
    characterId,
    position,
    JSON.stringify(chatClean),
  )
}

function collectionTableForField(field: string): string {
  const tableName = COLLECTION_TABLE_MAP[field]
  if (!tableName) {
    throw new ValidationError(`Unknown collection field: ${field}`)
  }
  return tableName
}

/** Rebuild one collection table (DELETE + ordered reinsert) for
 *  create/delete/reorder. Leaves the other eight tables untouched. */
export function writeSingleCollectionTable(
  db: DatabaseSync,
  field: string,
  array: readonly unknown[],
): void {
  const tableName = collectionTableForField(field)
  recordTableWrite(tableName)
  db.exec(`DELETE FROM ${tableName}`)
  if (array.length === 0) return
  const stmt = db.prepare(`INSERT INTO ${tableName} (position, data_json) VALUES (?, ?)`)
  for (let i = 0; i < array.length; i++) {
    stmt.run(i, JSON.stringify(array[i]))
  }
}

/** `UPDATE <collection> WHERE position=?` for a single pure field edit. Keeps
 *  the row's rowid stable (no delete+reinsert). */
export function writeSingleCollectionRow(
  db: DatabaseSync,
  field: string,
  position: number,
  value: unknown,
): void {
  const tableName = collectionTableForField(field)
  recordTableWrite(tableName)
  db.prepare(`UPDATE ${tableName} SET data_json = ? WHERE position = ?`).run(
    JSON.stringify(value),
    position,
  )
}

// The `promptTemplate` collection (`prompt_templates` table) is written through
// these named wrappers, never the bare field string, so the EC4 "promptTemplate
// is not a generic-settings key" audit can keep its literal-`'promptTemplate'`
// scan over `routes/commands.ts` while the targeted-collection writes (the preset
// apply path and the prompt-items family) still address the table directly.
export function writePromptTemplatesTable(db: DatabaseSync, items: readonly unknown[]): void {
  writeSingleCollectionTable(db, 'promptTemplate', items)
}

export function writePromptTemplateRow(db: DatabaseSync, position: number, value: unknown): void {
  writeSingleCollectionRow(db, 'promptTemplate', position, value)
}

/** Single-key upsert on `plugin_custom_storage`. */
export function writePluginStorageKey(db: DatabaseSync, key: string, value: unknown): void {
  recordTableWrite('plugin_custom_storage')
  db.prepare(
    'INSERT INTO plugin_custom_storage (key, value_json) VALUES (?, ?) ' +
      'ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json',
  ).run(key, JSON.stringify(value ?? null))
}

/** Single-key delete on `plugin_custom_storage`. */
export function deletePluginStorageKey(db: DatabaseSync, key: string): void {
  recordTableWrite('plugin_custom_storage')
  db.prepare('DELETE FROM plugin_custom_storage WHERE key = ?').run(key)
}

/** Rewrite the whole `plugin_custom_storage` table (DELETE-all + reinsert) to
 *  match the given key/value map. The bulk command's clear/replace semantics;
 *  mirrors the `plugin_custom_storage` tail of `replaceAllCollectionsInTable` but
 *  touches only that one table. */
export function replacePluginStorage(db: DatabaseSync, storage: Record<string, unknown>): void {
  recordTableWrite('plugin_custom_storage')
  db.exec('DELETE FROM plugin_custom_storage')
  const keys = Object.keys(storage)
  if (keys.length === 0) return
  const stmt = db.prepare('INSERT INTO plugin_custom_storage (key, value_json) VALUES (?, ?)')
  for (const key of keys) {
    stmt.run(key, JSON.stringify(storage[key] ?? null))
  }
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

export function getAllAssetMetadata(db: DatabaseSync): PersistedAsset[] {
  const rows = db
    .prepare('SELECT id, ext, size, content_type FROM assets ORDER BY id')
    .all() as unknown as AssetMetadataRow[]
  return rows.map(rowToPersistedAsset)
}

export function getAssetMetadataById(db: DatabaseSync, id: string): PersistedAsset | null {
  const row = db
    .prepare('SELECT id, ext, size, content_type FROM assets WHERE id = ?')
    .get(id) as unknown as AssetMetadataRow | undefined
  return row ? rowToPersistedAsset(row) : null
}

export function insertAssetMetadataBatch(
  db: DatabaseSync,
  assets: readonly PersistedAsset[],
): void {
  if (assets.length === 0) return
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO assets (id, ext, size, content_type) VALUES (?, ?, ?, ?)',
  )
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
  alternates: unknown[]
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

export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
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


export function emptyPersisted(): Persisted {
  return { _version: PERSISTED_VERSION, database: null, assets: [] }
}

export function loadPersisted(db: DatabaseSync, _dataDir: string): Persisted {
  let database: unknown = loadSettingsFromSqlite(db)
  if (database === null) return emptyPersisted()
  const rec = database as Record<string, unknown>
  for (const field of COLLECTION_FIELDS) {
    if (field !== 'promptTemplate' && !(field in rec)) rec[field] = []
  }
  if (!('pluginCustomStorage' in rec)) rec.pluginCustomStorage = {}
  const sqliteChars = loadCharactersFromSqlite(db)
  if (sqliteChars.length > 0 || !Array.isArray(rec.characters)) {
    rec.characters = sqliteChars
  }
  database = loadCollectionsFromSqlite(db, rec)
  return {
    _version: PERSISTED_VERSION,
    database,
    assets: getAllAssetMetadata(db),
  }
}


export function loadPersistedDatabaseFields(
  db: DatabaseSync,
  dataDir: string,
  fieldKeys: readonly string[],
): Record<string, unknown> {
  const persisted = loadPersisted(db, dataDir)
  const database = persisted.database
  if (!isRecord(database)) return {}
  return selectDatabaseFields(database, fieldKeys)
}

export function loadStubbedProjectionFields(
  db: DatabaseSync,
  dataDir: string,
  fieldKeys: readonly string[],
): Record<string, unknown> {
  const persisted = loadPersisted(db, dataDir)
  const database = persisted.database
  if (!isRecord(database)) return {}

  const fields = selectDatabaseFields(database, fieldKeys)
  // Preserve the wire projection contract for any targeted resource that ships
  // characters: chat payloads and optional character lorebooks stay lazy.
  eachChat(fields, (chat) => {
    chat.message = []
    delete chat.hypaV3Data
  })
  if (database.enableLorebookStubs === true) {
    stripCharacterGlobalLore(fields)
  }
  return fields
}

/**
 * Single-character stub row for the `characterRow` projection (audit M4). The
 * route ships exactly one character, so it must not pay
 * `loadCharactersFromSqlite`'s whole characters+chats payload parse. Read the
 * one character row (`WHERE id = ?`, precedent: `loadCharacterSelectionRows`)
 * plus its chat rows (`WHERE character_id = ?`) and apply the same stub
 * contract as `loadStubbedProjectionFields`: message-free chats, and a
 * stripped `globalLore` when `enableLorebookStubs` is on.
 *
 * Any state the single-row read cannot serve falls back to the broad stubbed
 * loader so behavior stays identical: an uninitialized settings table, a
 * non-object character payload, or a missing SQLite row (unknown id -> the
 * same `null` 404; a pre-extraction database keeps its embedded-characters
 * fallback). The returned row is freshly parsed and owned by the caller.
 */
export function loadSingleCharacterStubRow(
  db: DatabaseSync,
  dataDir: string,
  characterId: string,
): JsonRecord | null {
  const settings = loadSettingsFromSqlite(db)
  if (settings === null) return loadSingleCharacterStubRowBroad(db, dataDir, characterId)

  const charRow = db
    .prepare('SELECT id, position, data_json FROM characters WHERE id = ?')
    .get(characterId) as CharacterRow | undefined
  if (!charRow) return loadSingleCharacterStubRowBroad(db, dataDir, characterId)

  const character = JSON.parse(charRow.data_json) as unknown
  if (!isRecord(character)) return loadSingleCharacterStubRowBroad(db, dataDir, characterId)

  const chatRows = db
    .prepare(
      'SELECT id, character_id, position, data_json FROM chats WHERE character_id = ? ORDER BY position',
    )
    .all(charRow.id) as unknown as ChatRow[]
  character.chats = chatRows.map((row) => {
    const chat = JSON.parse(row.data_json) as unknown
    if (isRecord(chat)) {
      chat.message = []
      delete chat.hypaV3Data
    }
    return chat
  })

  if (settings.enableLorebookStubs === true) delete character.globalLore
  return character
}

function loadSingleCharacterStubRowBroad(
  db: DatabaseSync,
  dataDir: string,
  characterId: string,
): JsonRecord | null {
  const fields = loadStubbedProjectionFields(db, dataDir, ['characters'])
  const characters = Array.isArray(fields.characters) ? fields.characters : []
  const character = characters.find(
    (candidate) => isRecord(candidate) && candidate.chaId === characterId,
  )
  return isRecord(character) ? character : null
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
// export/save, and explicit broad fallbacks). Prompt assembly now uses the
// scoped `loadPersistedForAssembly` path below. Messages live in the SQLite
// `messages` table; `loadPersisted` returns message-free chats.

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
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
}

/**
 * Chat-scoped read for the targeted command-mutation hot paths (audit M3, L5,
 * L6). A message/scriptstate/generation mutation only locates one chat row and
 * mutates it (or does message-table writes through the kit writers), so it
 * must not pay `loadPersisted`'s 9-collection-table parse (M3), the assets
 * metadata scan (L5), or the whole characters+chats payload parse (L6). Load
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
export function loadPersistedForChatMutation(
  db: DatabaseSync,
  dataDir: string,
  target: ChatMutationTarget,
): Persisted {
  let chatId = target.chatId
  if (chatId === undefined && target.messageId !== undefined) {
    // Id-only resolution (no payload column) of the message's parent chat.
    const row = db
      .prepare('SELECT chat_id FROM messages WHERE uid = ? AND alternate = 0 LIMIT 1')
      .get(target.messageId) as { chat_id: string } | undefined
    chatId = row?.chat_id
  }
  if (chatId === undefined) return loadPersisted(db, dataDir)

  const chatRow = db
    .prepare('SELECT id, character_id, position, data_json FROM chats WHERE id = ?')
    .get(chatId) as ChatRow | undefined
  if (!chatRow) return loadPersisted(db, dataDir)

  const charRow = db
    .prepare('SELECT id, position, data_json FROM characters WHERE id = ?')
    .get(chatRow.character_id) as CharacterRow | undefined
  if (!charRow) return loadPersisted(db, dataDir)

  const character = JSON.parse(charRow.data_json) as Record<string, unknown>
  if (!isRecord(character)) return loadPersisted(db, dataDir)
  const chat = JSON.parse(chatRow.data_json) as unknown
  character.chats = [chat]

  return {
    _version: PERSISTED_VERSION,
    database: { characters: [character] },
    assets: [],
  }
}

/**
 * `loadPersisted` + join ONLY the target chat's messages/hypaV3 (audit M1).
 * Prompt assembly reads exactly one chat's transcript, so it must not pay the
 * whole-table `getAllChatMessagesGrouped` / `getAllChatHypaV3Grouped` parse.
 * Every non-target chat gets `message = []` (downstream `eachChat`-style
 * iteration still sees an array); the target chat keeps
 * `loadPersistedWithMessages`'s exact semantics, including the embedded-array
 * fallback for a not-yet-extracted chat. The broad loader stays for the
 * genuine full-corpus consumers (assetGc / export / save / boot backfill).
 */
export function loadPersistedForAssembly(
  db: DatabaseSync,
  dataDir: string,
  chatId: string,
): Persisted {
  const persisted = loadPersisted(db, dataDir)
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
export function writePersistedWithMessages(
  db: DatabaseSync,
  _dataDir: string,
  next: Persisted,
): void {
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
export function syncChatMessages(
  db: DatabaseSync,
  baselineDatabase: unknown,
  nextDatabase: unknown,
): void {
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
 * data into SQLite (settings, characters, collections, assets, messages) and
 * rename the file to `db.json.migrated`. Idempotent and safe to call on every
 * boot — a no-op once the file is gone.
 */
export function ensureDbJsonImported(db: DatabaseSync, dataDir: string): void {
  const file = dbJsonPath(dataDir)
  if (!fs.existsSync(file)) return
  const raw = fs.readFileSync(file, 'utf8')
  const parsed = JSON.parse(raw) as Partial<Persisted>
  const database = parsed.database

  if (isRecord(database)) {
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
  }

  const legacyAssets = Array.isArray(parsed.assets) ? (parsed.assets as PersistedAsset[]) : []
  if (legacyAssets.length > 0) insertAssetMetadataBatch(db, legacyAssets)

  fs.renameSync(file, `${file}.migrated`)
}

/**
 * The bootstrap / foreign-event projection of the database: chat *metadata* only,
 * every `chat.message[]` replaced by an empty array. The client hydrates a chat's
 * messages on open. Full-corpus consumers keep their broad loaders; only the
 * wire projection is stubbed.
 */
export function loadStubProjection(db: DatabaseSync, dataDir: string): Persisted {
  const persisted = loadPersisted(db, dataDir)
  eachChat(persisted.database, (chat) => {
    chat.message = []
    delete chat.hypaV3Data
  })
  stubCharacterLorebooks(persisted)
  return persisted
}

/**
 * Lazy-projection Phase 5 (EXPERIMENTAL, off by default — `enableLorebookStubs`):
 * strip every character's `globalLore` so the projection ships it as a stub. The
 * client hydrates a character's globalLore on character-open
 * (`GET /api/v1/projection/characterLorebook?id=`), and the lorebook watcher's
 * hydrated-character registry keeps a re-stub from being persisted as a deletion.
 *
 * TODO: Requires validation in the real app. The full client `globalLore` reader
 * surface (cbs.ts `{{lorebook}}`, triggers, slash commands, bulk export/tokenizer)
 * has NOT been validated against stubbed characters — keep this setting OFF until
 * it is.
 */
function stubCharacterLorebooks(persisted: Persisted): void {
  if (!isRecord(persisted.database) || persisted.database.enableLorebookStubs !== true) return
  stripCharacterGlobalLore(persisted.database)
}

function stripCharacterGlobalLore(database: unknown): void {
  const characters =
    isRecord(database) && Array.isArray(database.characters) ? database.characters : []
  for (const character of characters) {
    if (character && typeof character === 'object') delete character.globalLore
  }
}

/**
 * One chat's hydration payload: messages, hypaV3Data, and reroll alternates for
 * the hydration endpoint. Uses the table with embedded db.json fallback for
 * not-yet-extracted chats. `alternates` is always present, empty when none.
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
    // the request into the whole-corpus `loadPersisted` fallback (audit H1).
    return { message, hypaV3Data, alternates }
  }
  // Fallback for a chat not yet extracted into the table (zero message rows;
  // defensive — startup extraction normally makes the table authoritative).
  const persisted = loadPersisted(db, dataDir)
  eachChat(persisted.database, (chat) => {
    if (chat.id !== chatId) return
    if (message.length === 0 && Array.isArray(chat.message)) message = chat.message
    if (hypaV3Data === undefined && chat.hypaV3Data !== undefined) hypaV3Data = chat.hypaV3Data
  })
  return { message, hypaV3Data, alternates }
}

export function loadChatHydrations(
  db: DatabaseSync,
  dataDir: string,
  chatIds: readonly string[],
): BulkChatHydrationPayload {
  if (chatIds.length === 0) return { chats: [], missing: [] }

  const messages = getChatMessagesGroupedByIds(db, chatIds)
  const hypaV3ById = getChatHypaV3GroupedByIds(db, chatIds)
  const alternatesById = getAlternateMessagesGroupedByIds(db, chatIds)

  // Known-id + embedded-fallback resolution reads only the REQUESTED chat rows
  // (`WHERE id IN`), not the whole corpus (audit U1). The chats table is the
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
      chats.push({
        chatId,
        message: messageRows && messageRows.length > 0 ? messageRows : (fallbackMessage ?? []),
        hypaV3Data: hypaV3ById.has(chatId) ? hypaV3ById.get(chatId) : row.hypaV3Data,
        alternates: alternatesById.get(chatId) ?? [],
      })
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
    chats.push({
      chatId,
      message,
      hypaV3Data: hypaV3ById.has(chatId) ? hypaV3ById.get(chatId) : fallback?.hypaV3Data,
      alternates: alternatesById.get(chatId) ?? [],
    })
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
      const parsed = JSON.parse(row.data_json) as unknown
      if (isRecord(parsed)) byId.set(row.id, parsed)
    }
  }
  return byId
}

/**
 * One character's full `globalLore` for the hydration endpoint. Reads the full,
 * un-stubbed db.json and returns `[]` for an unknown / lore-less character.
 */
export function loadCharacterLorebookHydration(
  db: DatabaseSync,
  dataDir: string,
  characterId: string,
): { globalLore: unknown[] } {
  const persisted = loadPersisted(db, dataDir)
  const characters =
    (
      persisted.database as {
        characters?: Array<{ chaId?: string; globalLore?: unknown } | null>
      } | null
    )?.characters ?? []
  const character = characters.find((candidate) => candidate?.chaId === characterId)
  const globalLore =
    character && Array.isArray(character.globalLore) ? (character.globalLore as unknown[]) : []
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
  // (`WHERE id IN`), not the whole corpus (audit U1); the table stores the
  // full un-stubbed `globalLore`. Same authority gate + broad fallback as
  // `loadChatHydrations`.
  let characters: ReadonlyArray<Record<string, unknown> | null>
  if (sqliteIsCharacterAuthority(db)) {
    characters = [...getCharacterRowsByIds(db, characterIds).values()]
  } else {
    const persisted = loadPersisted(db, dataDir)
    characters =
      (persisted.database as { characters?: Array<Record<string, unknown> | null> } | null)
        ?.characters ?? []
  }

  for (const character of characters) {
    if (typeof character?.chaId !== 'string') continue
    knownCharacterIds.add(character.chaId)
    if (!requestedCharacterIds.has(character.chaId)) continue
    globalLoreById.set(
      character.chaId,
      Array.isArray(character.globalLore) ? (character.globalLore as unknown[]) : [],
    )
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
function getCharacterRowsByIds(
  db: DatabaseSync,
  characterIds: readonly string[],
): Map<string, JsonRecord> {
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
  options: { beforeRevision?: (db: DatabaseSync) => void } = {},
): { revision: number; event: CommandEvent } {
  if (database === null || database === undefined) {
    throw new ValidationError('database payload missing')
  }
  // The imported payload carries embedded `message[]`; split them into the
  // messages table and write a message-free db.json. We persist a *clone* so the
  // caller's `database` object is left fully hydrated — downstream consumers
  // (e.g. the legacy hypaV3 memory backfill in routes/save.ts) read chat.message
  // after this returns, and splitting mutates its argument in place. db.json is
  // written only after COMMIT so it never lands ahead of the message rows.
  const current = loadPersisted(db, dataDir)
  let transactionOpen = false
  db.exec('BEGIN IMMEDIATE')
  transactionOpen = true
  try {
    const messageFree = splitChatMessagesIntoTable(db, {
      ...current,
      database: structuredClone(database),
    })
    replaceAllCharactersInTable(db, messageFree.database)
    replaceAllCollectionsInTable(db, messageFree.database)
    replaceAllSettingsInTable(db, messageFree.database)
    options.beforeRevision?.(db)
    const event = persistRevisionedCommandEvent(db, COMMAND_EVENT_CATALOG.stateImported)
    db.exec('COMMIT')
    transactionOpen = false
    return { revision: event.revision, event }
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
 * Idempotent and clobber-safe — if a database is already present (a non-null
 * object), this is a no-op that returns the current revision without writing or
 * bumping. The presence check runs inside the same `BEGIN IMMEDIATE`
 * transaction as the write, so two clients opening the same fresh server (a
 * second tab, a reload race) can never seed twice or overwrite real data.
 */
export function initializeDefaultDatabase(
  db: DatabaseSync,
  dataDir: string,
): { revision: number; initialized: boolean; event?: CommandEvent } {
  let transactionOpen = false
  db.exec('BEGIN IMMEDIATE')
  transactionOpen = true
  try {
    const current = loadPersisted(db, dataDir)
    if (current.database !== null && current.database !== undefined) {
      // Already initialized → never overwrite. Report the live revision so the
      // caller can sync its cursor.
      const { revision } = getSchemaState(db)
      db.exec('COMMIT')
      transactionOpen = false
      return { revision, initialized: false }
    }
    const database = createInitialDatabase()
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

export function addAsset(db: DatabaseSync, dataDir: string, args: AddAssetInput): AddAssetResult {
  return addAssets(db, dataDir, [args])[0]
}

export function addAssets(
  db: DatabaseSync,
  dataDir: string,
  assets: readonly AddAssetInput[],
): AddAssetResult[] {
  for (const asset of assets) {
    if (!CONTENT_TYPE_EXTENSIONS[asset.contentType]) {
      throw new ValidationError(`Unsupported content-type: ${asset.contentType}`)
    }
  }

  const createdResults: AddAssetResult[] = []
  const results: AddAssetResult[] = []
  const currentRevision = getSchemaState(db).revision
  const createdFiles: Array<{ file: string; existedBefore: boolean }> = []
  let transactionOpen = false
  try {
    for (const asset of assets) {
      const ext = CONTENT_TYPE_EXTENSIONS[asset.contentType]
      const sha256 = createHash('sha256').update(asset.bytes).digest('hex')
      const existing = getAssetMetadataById(db, sha256)
      if (existing) {
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
    const event = persistRevisionedCommandEvent(db, {
      ...COMMAND_EVENT_CATALOG.assetCreated,
      ...(createdResults.length === 1 ? { id: createdResults[0].entry.id } : {}),
    })
    db.exec('COMMIT')
    transactionOpen = false
    return results.map((result) => ({ ...result, revision: event.revision, event }))
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

export function missingAssetIds(db: DatabaseSync, ids: string[]): string[] {
  return getMissingAssetIds(db, ids)
}

export const BACKUP_MANIFEST_VERSION = 1

export const BACKUP_ID_RE = /^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}-[a-f0-9]{6}$/

export interface BackupManifest {
  _version: number
  id: string
  label: string | null
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
//   - 'db.json'  : the user-owned JSON state. Copied via file write/rename.
//   - 'assets'   : asset bytes referenced from db.json. Copied as a directory.
//   - 'risu.db'  : SQLite database (schema_version + hypa-v3 memory tables +
//                  chat-history tables). Backed up after a WAL checkpoint; restored
//                  via ATTACH so the live `DatabaseSync` handle stays valid. Every
//                  table that must survive restore is listed in SQLITE_BACKUP_TABLES.
//   - 'save'     : legacy storage directory written by /api/v1/storage/*.
export const KNOWN_DATA_DIR_CHILDREN = ['assets', 'risu.db', 'save'] as const

function saveDir(dataDir: string): string {
  return path.join(dataDir, 'save')
}

function sqliteDbPath(dataDir: string): string {
  return path.join(dataDir, 'risu.db')
}

// Tables that must survive a backup/restore round-trip. Kept in sync with
// `createMemoryTables`, the chat-history tables (`createMessageTable` /
// `createChatBlobTable`), command event replay history, and `schema_version` in `db.ts`. `createBackup`
// file-copies all of risu.db, but `restoreBackup` swaps tables one-by-one via
// ATTACH. A table absent here would not be restored, leaving live rows desynced
// from the restored db.json.
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
  'characters',
  'chats',
  'modules',
  'plugins',
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

export function createBackup(
  db: DatabaseSync,
  dataDir: string,
  label: string | null = null,
): BackupManifest {
  const { revision } = getSchemaState(db)
  const id = generateBackupId()
  const dir = backupDir(dataDir, id)
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
    createdAt: new Date().toISOString(),
    revision,
    assetCount: getAssetMetadataCount(db),
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest))
  return manifest
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
    const raw = fs.readFileSync(manifestPath, 'utf8')
    const parsed = JSON.parse(raw) as BackupManifest
    manifests.push(parsed)
  }
  manifests.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return manifests
}

function restoreSqliteFromBackup(
  db: DatabaseSync,
  backupDbPath: string,
  beforeCommit?: () => void,
): void {
  // Use ATTACH + table-level swap so the existing `db` handle stays valid
  // (file-rename would orphan open file descriptors and break every other
  // active route holding the same handle). The transaction is atomic with
  // respect to other queries on this connection.
  if (!fs.existsSync(backupDbPath)) {
    // No SQLite backup payload: clear live memory rows so the restore is
    // consistent with a snapshot taken without SQLite backup state.
    db.exec('BEGIN')
    try {
      for (const table of SQLITE_BACKUP_TABLES) {
        if (table === 'schema_version') continue
        db.exec(`DELETE FROM ${table}`)
      }
      beforeCommit?.()
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
    return
  }

  // ATTACH expects a SQL string literal; the path is constructed locally and
  // sanitised by replacing single quotes.
  const sqlLiteralPath = backupDbPath.replaceAll("'", "''")
  db.exec(`ATTACH DATABASE '${sqlLiteralPath}' AS bak`)
  try {
    db.exec('BEGIN')
    try {
      for (const table of SQLITE_BACKUP_TABLES) {
        // Verify the table exists in the backup; older snapshots may predate
        // memory tables.
        const exists = db
          .prepare(`SELECT name FROM bak.sqlite_master WHERE type = 'table' AND name = ?`)
          .get(table)
        if (table === 'schema_version') {
          // Special-case: schema_version has the PK row (id=1). Update in
          // place from the backup rather than DELETE+INSERT to avoid
          // re-triggering INSERT OR IGNORE seed.
          if (exists) {
            db.exec(
              `INSERT OR REPLACE INTO main.schema_version (id, version, revision)
               SELECT id, version, revision FROM bak.schema_version`,
            )
          }
          continue
        }
        db.exec(`DELETE FROM main.${table}`)
        if (exists) {
          db.exec(`INSERT INTO main.${table} SELECT * FROM bak.${table}`)
        }
      }
      beforeCommit?.()
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  } finally {
    db.exec('DETACH DATABASE bak')
  }
}

export function restoreBackup(
  db: DatabaseSync,
  dataDir: string,
  id: string,
): { revision: number; event: CommandEvent } {
  if (!isValidBackupId(id)) {
    throw new EntityNotFoundError(`Backup not found: ${id}`)
  }
  const manifestPath = path.join(backupDir(dataDir, id), 'manifest.json')
  const legacySnapshot = path.join(backupDir(dataDir, id), 'db.json')
  if (!fs.existsSync(manifestPath) && !fs.existsSync(legacySnapshot)) {
    throw new EntityNotFoundError(`Backup not found: ${id}`)
  }

  const liveAssets = assetsDir(dataDir)
  const backupAssets = path.join(backupDir(dataDir, id), 'assets')
  const tmpAssets = path.join(dataDir, `.assets-${id}.tmp`)
  const oldAssets = path.join(dataDir, `.assets-${id}.old`)
  const liveSave = saveDir(dataDir)
  const backupSave = path.join(backupDir(dataDir, id), 'save')
  const tmpSave = path.join(dataDir, `.save-${id}.tmp`)
  const oldSave = path.join(dataDir, `.save-${id}.old`)
  const backupSqlite = path.join(backupDir(dataDir, id), 'risu.db')

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
  try {
    restoreSqliteFromBackup(db, backupSqlite, () => {
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

  // If the backup predates Phase 5 and carries a db.json, import it into
  // SQLite so no legacy data is lost.
  if (fs.existsSync(legacySnapshot)) {
    const liveDbJson = dbJsonPath(dataDir)
    fs.copyFileSync(legacySnapshot, liveDbJson)
    ensureDbJsonImported(db, dataDir)
  }

  if (!event) {
    throw new Error('restore did not produce a command event')
  }
  return { revision: event.revision, event }
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
