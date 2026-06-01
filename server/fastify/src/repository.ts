import { createHash, randomBytes, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { createInitialDatabase } from './databaseDefaults.js'
import { bumpRevision, getSchemaState } from './db.js'
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

interface AssetMetadataIndex {
  signature: string
  byId: Map<string, PersistedAsset>
}

const assetMetadataIndexes = new Map<string, AssetMetadataIndex>()

function dbJsonSignature(dataDir: string): string {
  try {
    const stat = fs.statSync(dbJsonPath(dataDir), { bigint: true })
    return `${stat.mtimeNs}:${stat.size}`
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return 'missing'
    }
    throw err
  }
}

function invalidateAssetMetadataIndex(dataDir: string): void {
  assetMetadataIndexes.delete(dataDir)
}

function getAssetMetadataIndex(dataDir: string): AssetMetadataIndex {
  const signature = dbJsonSignature(dataDir)
  const cached = assetMetadataIndexes.get(dataDir)
  if (cached?.signature === signature) return cached

  const persisted = loadPersisted(dataDir)
  const next: AssetMetadataIndex = {
    signature,
    byId: new Map(persisted.assets.map((asset) => [asset.id, asset])),
  }
  assetMetadataIndexes.set(dataDir, next)
  return next
}

export function emptyPersisted(): Persisted {
  return { _version: PERSISTED_VERSION, database: null, assets: [] }
}

export function loadPersisted(dataDir: string): Persisted {
  const file = dbJsonPath(dataDir)
  if (!fs.existsSync(file)) {
    return emptyPersisted()
  }
  const raw = fs.readFileSync(file, 'utf8')
  const parsed = JSON.parse(raw) as Partial<Persisted>
  const version = typeof parsed._version === 'number' ? parsed._version : PERSISTED_VERSION
  if (version > PERSISTED_VERSION) {
    throw new Error(`db.json _version ${version} is newer than supported ${PERSISTED_VERSION}`)
  }
  return {
    _version: PERSISTED_VERSION,
    database: parsed.database ?? null,
    assets: Array.isArray(parsed.assets) ? (parsed.assets as PersistedAsset[]) : [],
  }
}

export function loadPersistedDatabaseFields(
  dataDir: string,
  fieldKeys: readonly string[],
): Record<string, unknown> {
  const persisted = loadPersisted(dataDir)
  const database = persisted.database
  if (!isRecord(database)) return {}
  return selectDatabaseFields(database, fieldKeys)
}

export function loadCharacterProjectionFields(
  dataDir: string,
  fieldKeys: readonly string[],
): Record<string, unknown> {
  const persisted = loadPersisted(dataDir)
  const database = persisted.database
  if (!isRecord(database)) return {}

  const fields = selectDatabaseFields(database, fieldKeys)
  eachChat(fields, (chat) => {
    chat.message = []
    delete chat.hypaV3Data
  })
  if (database.enableLorebookStubs === true) {
    stripCharacterGlobalLore(fields)
  }
  return fields
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

export function writePersisted(dataDir: string, next: Persisted): void {
  fs.mkdirSync(dataDir, { recursive: true })
  const file = dbJsonPath(dataDir)
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(next))
  fs.renameSync(tmp, file)
  invalidateAssetMetadataIndex(dataDir)
}

// Chat messages live in SQLite, not in db.json.
//
// `loadPersisted` / `writePersisted` operate on the message-free `db.json` blob
// (the asset-GC / memory / backup paths that never look at messages keep using
// them). The `*WithMessages` variants below are the message-aware boundary used
// by every reader that needs a fully-hydrated `Database` (mutation engine,
// bootstrap, projection, prompt assembly, risuSave export) and the writers that
// persist message edits (mutation engine, import).
//
// Join rule (lossless migration): a chat's messages come from the SQLite rows;
// if a chat has *no* rows yet but still carries an embedded `message[]` in
// db.json (un-migrated / freshly-imported-by-hand data), the embedded array is
// used as the source. The next `writePersistedWithMessages` extracts it into the
// table and strips it from db.json, so db.json converges to message-free.

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
  const persisted = loadPersisted(dataDir)
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

/**
 * Split each chat's `message[]` into the messages table and return the
 * message-free `Persisted`. Pure SQLite write — it does NOT touch db.json. Run
 * inside the caller's open transaction; persist the returned value with
 * `writePersisted` only AFTER the transaction COMMITs. Ordering matters: the
 * durable db.json write must never land ahead of the message rows + revision
 * bump, so a crash between the two stores leaves db.json *behind* (re-applied by
 * the next write) instead of pairing new chat metadata with stale messages.
 *
 * The `next.database` object is mutated in place (its chats lose `message`) —
 * callers pass a throwaway clone.
 *
 * Invariant: `next.database` is a *complete* hydrated database (every chat
 * present). The table is rebuilt wholesale, which also reclaims rows for deleted
 * chats.
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
 * Convenience for non-transactional callers (and tests): split messages into the
 * table and write the message-free db.json in one step. Transactional callers
 * use `splitChatMessagesIntoTable` + a post-COMMIT `writePersisted` instead.
 */
export function writePersistedWithMessages(
  db: DatabaseSync,
  dataDir: string,
  next: Persisted,
): void {
  writePersisted(dataDir, splitChatMessagesIntoTable(db, next))
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

/** Strip every chat's `message[]` + `hypaV3Data` for message-free db.json/wire. */
export function stripChatMessages(next: Persisted): Persisted {
  eachChat(next.database, (chat) => {
    delete chat.message
    delete chat.hypaV3Data
  })
  return next
}

/**
 * One-time proactive extraction: if `db.json` still carries embedded
 * `chat.message[]`, move every chat's messages into the table and rewrite db.json
 * message-free. Idempotent and safe to call on every boot.
 */
export function ensureMessagesExtracted(db: DatabaseSync, dataDir: string): void {
  const raw = loadPersisted(dataDir)
  if (!hasEmbeddedChatPayloadsOrBadIds(raw.database)) return

  const hydrated = loadPersistedWithMessages(db, dataDir)
  let transactionOpen = false
  db.exec('BEGIN IMMEDIATE')
  transactionOpen = true
  try {
    const messageFree = splitChatMessagesIntoTable(db, hydrated)
    db.exec('COMMIT')
    transactionOpen = false
    writePersisted(dataDir, messageFree)
  } catch (err) {
    if (transactionOpen) db.exec('ROLLBACK')
    throw err
  }
}

/**
 * The bootstrap / foreign-event projection of the database: chat *metadata* only,
 * every `chat.message[]` replaced by an empty array. The client hydrates a chat's
 * messages on open. Prompt assembly keeps using `loadPersistedWithMessages` —
 * only the wire projection is stubbed.
 */
export function loadStubProjection(db: DatabaseSync, dataDir: string): Persisted {
  const persisted = loadPersisted(dataDir)
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
  if (message.length > 0 && hypaV3Data !== undefined) {
    return { message, hypaV3Data, alternates }
  }
  // Fallback for a chat not yet extracted into the table (defensive — startup
  // extraction normally makes the table authoritative).
  const persisted = loadPersisted(dataDir)
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
  const messages = getChatMessagesGroupedByIds(db, chatIds)
  const hypaV3ById = getChatHypaV3GroupedByIds(db, chatIds)
  const alternatesById = getAlternateMessagesGroupedByIds(db, chatIds)
  const fallbackById = new Map<string, { message?: unknown[]; hypaV3Data?: unknown }>()
  const knownChatIds = new Set<string>()
  const requestedChatIds = new Set(chatIds)
  const persisted = loadPersisted(dataDir)

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
 * One character's full `globalLore` for the hydration endpoint. Reads the full,
 * un-stubbed db.json and returns `[]` for an unknown / lore-less character.
 */
export function loadCharacterLorebookHydration(
  dataDir: string,
  characterId: string,
): { globalLore: unknown[] } {
  const persisted = loadPersisted(dataDir)
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

export function applyImport(
  db: DatabaseSync,
  dataDir: string,
  database: unknown,
): { revision: number } {
  if (database === null || database === undefined) {
    throw new ValidationError('database payload missing')
  }
  // The imported payload carries embedded `message[]`; split them into the
  // messages table and write a message-free db.json. We persist a *clone* so the
  // caller's `database` object is left fully hydrated — downstream consumers
  // (e.g. the legacy hypaV3 memory backfill in routes/save.ts) read chat.message
  // after this returns, and splitting mutates its argument in place. db.json is
  // written only after COMMIT so it never lands ahead of the message rows.
  const current = loadPersisted(dataDir)
  let transactionOpen = false
  db.exec('BEGIN IMMEDIATE')
  transactionOpen = true
  try {
    const messageFree = splitChatMessagesIntoTable(db, {
      ...current,
      database: structuredClone(database),
    })
    const revision = bumpRevision(db)
    db.exec('COMMIT')
    transactionOpen = false
    writePersisted(dataDir, messageFree)
    return { revision }
  } catch (err) {
    if (transactionOpen) {
      db.exec('ROLLBACK')
    }
    throw err
  }
}

/**
 * First-run seed: write the server-owned default database to db.json ONLY when
 * no database exists yet.
 *
 * Idempotent and clobber-safe — if a database is already present (a non-null
 * object), this is a no-op that returns the current revision without writing or
 * bumping. The presence check runs inside the same `BEGIN IMMEDIATE`
 * transaction as the write, so two clients opening the same fresh server (a
 * second tab, a reload race) can never seed twice or overwrite real data.
 *
 * The initial database has no chats/messages, so it can be persisted directly
 * after COMMIT without the import path's message extraction pass.
 */
export function initializeDefaultDatabase(
  db: DatabaseSync,
  dataDir: string,
): { revision: number; initialized: boolean } {
  let transactionOpen = false
  db.exec('BEGIN IMMEDIATE')
  transactionOpen = true
  try {
    const current = loadPersisted(dataDir)
    if (current.database !== null && current.database !== undefined) {
      // Already initialized → never overwrite. Report the live revision so the
      // caller can sync its cursor.
      const { revision } = getSchemaState(db)
      db.exec('COMMIT')
      transactionOpen = false
      return { revision, initialized: false }
    }
    const messageFree = {
      ...current,
      database: createInitialDatabase(),
    }
    const revision = bumpRevision(db)
    db.exec('COMMIT')
    transactionOpen = false
    writePersisted(dataDir, messageFree)
    return { revision, initialized: true }
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

export function assetById(dataDir: string, id: string): PersistedAsset | null {
  if (!isValidAssetId(id)) return null
  return getAssetMetadataIndex(dataDir).byId.get(id) ?? null
}

export interface AddAssetResult {
  entry: PersistedAsset
  created: boolean
  revision: number
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

  const persisted = loadPersisted(dataDir)
  const assetById = new Map(persisted.assets.map((asset) => [asset.id, asset]))
  const nextAssets = [...persisted.assets]
  const createdResults: AddAssetResult[] = []
  const results: AddAssetResult[] = []
  const currentRevision = getSchemaState(db).revision

  for (const asset of assets) {
    const ext = CONTENT_TYPE_EXTENSIONS[asset.contentType]
    const sha256 = createHash('sha256').update(asset.bytes).digest('hex')
    const existing = assetById.get(sha256)
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
    fs.writeFileSync(file, asset.bytes)
    const entry: PersistedAsset = {
      id: sha256,
      ext,
      size: asset.bytes.length,
      contentType: asset.contentType,
    }
    nextAssets.push(entry)
    assetById.set(entry.id, entry)
    const result = { entry, created: true, revision: currentRevision }
    createdResults.push(result)
    results.push(result)
  }

  if (createdResults.length === 0) {
    return results
  }

  writePersisted(dataDir, { ...persisted, assets: nextAssets })
  const revision = bumpRevision(db)
  return results.map((result) => ({ ...result, revision }))
}

export function missingAssetIds(dataDir: string, ids: string[]): string[] {
  const index = getAssetMetadataIndex(dataDir)
  return ids.filter((id) => !index.byId.has(id))
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
export const KNOWN_DATA_DIR_CHILDREN = ['db.json', 'assets', 'risu.db', 'save'] as const

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
  const persisted = loadPersisted(dataDir)
  const { revision } = getSchemaState(db)
  const id = generateBackupId()
  const dir = backupDir(dataDir, id)
  fs.mkdirSync(dir, { recursive: true })

  // Snapshot every KNOWN_DATA_DIR_CHILDREN entry.
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify(persisted))
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
    assetCount: persisted.assets.length,
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

function restoreSqliteFromBackup(db: DatabaseSync, backupDbPath: string): void {
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
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  } finally {
    db.exec('DETACH DATABASE bak')
  }
}

export function restoreBackup(db: DatabaseSync, dataDir: string, id: string): { revision: number } {
  if (!isValidBackupId(id)) {
    throw new EntityNotFoundError(`Backup not found: ${id}`)
  }
  const snapshot = path.join(backupDir(dataDir, id), 'db.json')
  if (!fs.existsSync(snapshot)) {
    throw new EntityNotFoundError(`Backup not found: ${id}`)
  }

  // Stage each KNOWN_DATA_DIR_CHILDREN entry under a temp path, then swap
  // them into place. The SQLite restore uses ATTACH to preserve `db`.
  const live = path.join(dataDir, 'db.json')
  const tmp = `${live}.tmp`
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

  // Stage assets and save dirs as temp copies.
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

  // Stage db.json snapshot.
  fs.copyFileSync(snapshot, tmp)

  // Move live directories aside so the swap can roll back.
  if (fs.existsSync(liveAssets)) {
    fs.renameSync(liveAssets, oldAssets)
  }
  if (fs.existsSync(liveSave)) {
    fs.renameSync(liveSave, oldSave)
  }

  try {
    // SQLite: ATTACH-based table swap (no file rename — preserves db handle).
    restoreSqliteFromBackup(db, backupSqlite)
    // File swaps: assets, save, db.json.
    fs.renameSync(tmpAssets, liveAssets)
    fs.renameSync(tmpSave, liveSave)
    fs.renameSync(tmp, live)
    invalidateAssetMetadataIndex(dataDir)
  } catch (err) {
    rmDirectoryIfPresent(liveAssets)
    if (fs.existsSync(oldAssets)) {
      fs.renameSync(oldAssets, liveAssets)
    }
    rmDirectoryIfPresent(liveSave)
    if (fs.existsSync(oldSave)) {
      fs.renameSync(oldSave, liveSave)
    }
    throw err
  }

  rmDirectoryIfPresent(oldAssets)
  rmDirectoryIfPresent(oldSave)
  const revision = bumpRevision(db)
  return { revision }
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
