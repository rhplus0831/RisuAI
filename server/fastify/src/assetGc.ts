import fs from 'node:fs'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import {
  assetPath,
  assetsDir,
  deleteAssetMetadataByIds,
  getAllAssetMetadata,
  isValidAssetId,
  type PersistedAsset,
} from './repository.js'
import {
  type RisuSaveAssetReport,
  type RisuSaveAssetReferenceSource,
  buildRisuSaveAssetReport,
  collectInlayAssetReferenceSources,
  collectMessageInlayReferences,
} from './risuSave/assetReferences.js'

// How often the periodic sweep runs. Asset GC is cheap but can delete metadata
// and files when it reclaims, so it runs well outside the request hot path.
export const ASSET_GC_INTERVAL_MS = 15 * 60_000

// An unreferenced asset must have been on disk (by file mtime) for at least this
// long before it is eligible for deletion. This closes the upload→reference
// race: an asset is uploaded by one request and referenced by a later mutation,
// so a sweep that runs in between must not reclaim the freshly-written bytes.
export const ASSET_GC_GRACE_MS = 60 * 60_000

export interface AssetGcOptions {
  /** SQLite connection used to project all durable reference surfaces. */
  db?: DatabaseSync
  /** Minimum age (by file mtime) before an unreferenced asset may be deleted. */
  graceMs?: number
  /** Injectable clock (ms epoch) for tests. */
  now?: () => number
}

export interface AssetGcResult {
  /** sha256 ids whose metadata entry (and file, if present) were removed. */
  deletedAssetIds: string[]
  /** stray asset files (no metadata entry, unreferenced) that were removed. */
  deletedStrayFiles: string[]
  /** orphaned/stray candidates skipped because they are within the grace window. */
  skippedByGrace: number
  /** total orphaned metadata entries considered this run. */
  scannedOrphans: number
}

type JsonRecord = Record<string, unknown>

interface CollectionReferenceRow {
  value: unknown
}

interface CharacterReferenceRow {
  id: string
  image: unknown
  notificationImage: unknown
  emotionImagesJson: unknown
  additionalAssetsJson: unknown
  ccAssetsJson: unknown
  vitsFilesJson: unknown
  prebuiltAssetExcludeJson: unknown
  gptSoVitsAssetId: unknown
  firstMessage: unknown
  alternateGreetingsJson: unknown
  backgroundHTML: unknown
  creatorNotes: unknown
  name: unknown
  nickname: unknown
  desc: unknown
  personality: unknown
  scenario: unknown
  exampleMessage: unknown
}

interface ChatReferenceRow {
  id: string
  characterId: string
  dataId: unknown
  messageJson: unknown
}

function fileAgeMs(file: string, now: number): number | null {
  try {
    const stat = fs.statSync(file)
    return now - stat.mtimeMs
  } catch {
    // File missing or unreadable.
    return null
  }
}

function readRecord(value: unknown): JsonRecord | null {
  return !!value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : null
}

function readJsonFragment(value: unknown): unknown {
  if (typeof value !== 'string') return undefined
  try {
    return JSON.parse(value) as unknown
  } catch {
    return undefined
  }
}

function setIfPresent(record: JsonRecord, key: string, value: unknown): void {
  if (value !== null && value !== undefined) record[key] = value
}

function loadSettingsReferenceShape(db: DatabaseSync): JsonRecord | null {
  const row = db.prepare('SELECT data_json FROM settings WHERE id = 1').get() as { data_json: string } | undefined
  if (!row) return null
  const parsed = JSON.parse(row.data_json) as unknown
  return readRecord(parsed)
}

function collectionRows(db: DatabaseSync, tableName: string, fieldPath: string): unknown[] {
  const rows = db
    .prepare(`SELECT json_extract(data_json, ?) AS value FROM ${tableName} ORDER BY position`)
    .all(fieldPath) as unknown as CollectionReferenceRow[]
  return rows.map((row) => row.value)
}

function collectionRowsWithJsonFragment(db: DatabaseSync, tableName: string, fieldPath: string): unknown[] {
  return collectionRows(db, tableName, fieldPath).map(readJsonFragment)
}

function applyCollectionOverride(
  database: JsonRecord,
  field: string,
  rows: unknown[],
  buildRow: (value: unknown) => JsonRecord,
): void {
  if (rows.length === 0) return
  database[field] = rows.map(buildRow)
}

function loadCharacterReferenceRows(db: DatabaseSync): CharacterReferenceRow[] {
  return db
    .prepare(
      `
      SELECT
        id,
        json_extract(data_json, '$.image') AS image,
        json_extract(data_json, '$.notificationImage') AS notificationImage,
        json_extract(data_json, '$.emotionImages') AS emotionImagesJson,
        json_extract(data_json, '$.additionalAssets') AS additionalAssetsJson,
        json_extract(data_json, '$.ccAssets') AS ccAssetsJson,
        json_extract(data_json, '$.vits.files') AS vitsFilesJson,
        json_extract(data_json, '$.prebuiltAssetExclude') AS prebuiltAssetExcludeJson,
        json_extract(data_json, '$.gptSoVitsConfig.ref_audio_data.assetId') AS gptSoVitsAssetId,
        json_extract(data_json, '$.firstMessage') AS firstMessage,
        json_extract(data_json, '$.alternateGreetings') AS alternateGreetingsJson,
        json_extract(data_json, '$.backgroundHTML') AS backgroundHTML,
        json_extract(data_json, '$.creatorNotes') AS creatorNotes,
        json_extract(data_json, '$.name') AS name,
        json_extract(data_json, '$.nickname') AS nickname,
        json_extract(data_json, '$.desc') AS desc,
        json_extract(data_json, '$.personality') AS personality,
        json_extract(data_json, '$.scenario') AS scenario,
        json_extract(data_json, '$.exampleMessage') AS exampleMessage
      FROM characters
      ORDER BY position
    `,
    )
    .all() as unknown as CharacterReferenceRow[]
}

function loadChatReferenceRows(db: DatabaseSync): ChatReferenceRow[] {
  return db
    .prepare(
      `
      SELECT
        id,
        character_id AS characterId,
        json_extract(data_json, '$.id') AS dataId,
        json_extract(data_json, '$.message') AS messageJson
      FROM chats
      ORDER BY character_id, position
    `,
    )
    .all() as unknown as ChatReferenceRow[]
}

function buildMinimalCharacter(row: CharacterReferenceRow, chats: unknown[]): JsonRecord {
  const character: JsonRecord = { chats }
  setIfPresent(character, 'image', row.image)
  setIfPresent(character, 'notificationImage', row.notificationImage)
  setIfPresent(character, 'emotionImages', readJsonFragment(row.emotionImagesJson))
  setIfPresent(character, 'additionalAssets', readJsonFragment(row.additionalAssetsJson))
  setIfPresent(character, 'ccAssets', readJsonFragment(row.ccAssetsJson))
  setIfPresent(character, 'prebuiltAssetExclude', readJsonFragment(row.prebuiltAssetExcludeJson))
  const vitsFiles = readJsonFragment(row.vitsFilesJson)
  if (vitsFiles !== undefined) character.vits = { files: vitsFiles }
  if (row.gptSoVitsAssetId !== null && row.gptSoVitsAssetId !== undefined) {
    character.gptSoVitsConfig = { ref_audio_data: { assetId: row.gptSoVitsAssetId } }
  }
  setIfPresent(character, 'firstMessage', row.firstMessage)
  setIfPresent(character, 'alternateGreetings', readJsonFragment(row.alternateGreetingsJson))
  setIfPresent(character, 'backgroundHTML', row.backgroundHTML)
  setIfPresent(character, 'creatorNotes', row.creatorNotes)
  setIfPresent(character, 'name', row.name)
  setIfPresent(character, 'nickname', row.nickname)
  setIfPresent(character, 'desc', row.desc)
  setIfPresent(character, 'personality', row.personality)
  setIfPresent(character, 'scenario', row.scenario)
  setIfPresent(character, 'exampleMessage', row.exampleMessage)
  return character
}

function buildMinimalChat(row: ChatReferenceRow): JsonRecord {
  const chat: JsonRecord = {}
  chat.id = typeof row.dataId === 'string' ? row.dataId : row.id
  const message = readJsonFragment(row.messageJson)
  if (message !== undefined) chat.message = message
  return chat
}

function loadAssetGcReferenceDatabase(db: DatabaseSync): unknown {
  const settings = loadSettingsReferenceShape(db)
  if (settings === null) return null

  const database: JsonRecord = { ...settings }

  applyCollectionOverride(database, 'modules', collectionRowsWithJsonFragment(db, 'modules', '$.assets'), (assets) => ({
    assets,
  }))
  applyCollectionOverride(database, 'personas', collectionRows(db, 'personas', '$.icon'), (icon) => ({
    icon,
  }))
  applyCollectionOverride(database, 'botPresets', collectionRows(db, 'bot_presets', '$.image'), (image) => ({ image }))
  applyCollectionOverride(database, 'modelPresets', collectionRows(db, 'model_presets', '$.image'), (image) => ({
    image,
  }))
  applyCollectionOverride(database, 'promptPresets', collectionRows(db, 'prompt_presets', '$.image'), (image) => ({
    image,
  }))

  const pluginCustomStorage = loadPluginCustomStorageReferenceShape(db)
  if (pluginCustomStorage !== null) database.pluginCustomStorage = pluginCustomStorage

  const characterRows = loadCharacterReferenceRows(db)
  if (characterRows.length > 0 || !Array.isArray(settings.characters)) {
    const chatsByCharacterId = new Map<string, unknown[]>()
    for (const row of loadChatReferenceRows(db)) {
      const chats = chatsByCharacterId.get(row.characterId) ?? []
      chats.push(buildMinimalChat(row))
      chatsByCharacterId.set(row.characterId, chats)
    }
    database.characters = characterRows.map((row) => buildMinimalCharacter(row, chatsByCharacterId.get(row.id) ?? []))
  }

  return database
}

export function buildAssetGcRisuSaveAssetReport(
  db: DatabaseSync,
  assets: readonly PersistedAsset[],
): RisuSaveAssetReport {
  // Extra references (including catalog membership) must still participate on
  // a freshly initialized database whose settings row has not been created.
  const database = loadAssetGcReferenceDatabase(db) ?? {}
  return buildRisuSaveAssetReport(database, assets, [
    ...collectMessageInlayReferences(db, database),
    ...collectInlayCatalogReferences(db),
    ...collectPendingFinalizationInlayReferences(db),
  ])
}

function loadPluginCustomStorageReferenceShape(db: DatabaseSync): JsonRecord | null {
  const rows = db.prepare('SELECT key, value_json FROM plugin_custom_storage ORDER BY key').all() as Array<{
    key: string
    value_json: string
  }>
  if (rows.length === 0) return null
  const storage: JsonRecord = {}
  for (const row of rows) {
    const value = readJsonFragment(row.value_json)
    if (value !== undefined) storage[row.key] = value
  }
  return storage
}

function collectInlayCatalogReferences(db: DatabaseSync): RisuSaveAssetReferenceSource[] {
  const rows = db.prepare('SELECT asset_id FROM inlay_catalog ORDER BY asset_id').all() as Array<{ asset_id: string }>
  return rows.map((row, index) => ({
    value: row.asset_id,
    path: `inlayCatalog[${index}].assetId`,
  }))
}

function collectPendingFinalizationInlayReferences(db: DatabaseSync): RisuSaveAssetReferenceSource[] {
  const messageRows = db
    .prepare(
      `
        SELECT generation_id, json_extract(message_json, '$.data') AS data
        FROM generation_finalization_retries
        WHERE status = 'pending'
        ORDER BY generation_id
      `,
    )
    .all() as Array<{ generation_id: string; data: unknown }>
  const alternateRows = db
    .prepare(
      `
        SELECT
          retries.generation_id,
          CAST(alternates.key AS INTEGER) AS message_index,
          CASE
            WHEN alternates.type = 'object' THEN json_extract(alternates.value, '$.data')
            ELSE NULL
          END AS data
        FROM generation_finalization_retries AS retries,
          json_each(retries.alternate_messages_json) AS alternates
        WHERE retries.status = 'pending'
        ORDER BY retries.generation_id, CAST(alternates.key AS INTEGER)
      `,
    )
    .all() as Array<{ generation_id: string; message_index: number; data: unknown }>

  return [
    ...messageRows.flatMap((row) =>
      collectInlayAssetReferenceSources(
        row.data,
        `generationFinalizationRetries[${JSON.stringify(row.generation_id)}].message.data`,
      ),
    ),
    ...alternateRows.flatMap((row) =>
      collectInlayAssetReferenceSources(
        row.data,
        `generationFinalizationRetries[${JSON.stringify(row.generation_id)}].alternateMessages[${row.message_index}].data`,
      ),
    ),
  ]
}

/**
 * Reference-counted, server-side asset garbage collection.
 *
 * Walks a minimal reference projection to compute the referenced
 * asset set (via the same walker `risuSave` uses for its orphan report), then
 * deletes content-addressed assets that nothing references — reference-counting
 * across the whole corpus, so a `sha256`-shared asset is only reclaimed at zero
 * references. A grace window (by file mtime) protects just-uploaded bytes.
 *
 * The metadata read-modify-write is fully synchronous (no `await`), so it is
 * atomic with respect to every other request handler in this single-threaded
 * process — the same property the command mutation path relies on. No revision
 * bump and no command event: an orphaned asset is by definition unreferenced by
 * the complete reference corpus, so no client-visible state changes.
 */
export function runAssetGc(dataDir: string, opts: AssetGcOptions = {}): AssetGcResult {
  const graceMs = opts.graceMs ?? ASSET_GC_GRACE_MS
  const now = opts.now ? opts.now() : Date.now()

  const result: AssetGcResult = {
    deletedAssetIds: [],
    deletedStrayFiles: [],
    skippedByGrace: 0,
    scannedOrphans: 0,
  }

  if (!opts.db) return result

  // Message and pending-finalization inlays come from column-only SQL token
  // scans — no whole-corpus message hydrate / per-row body JSON.parse on this
  // periodic synchronous sweep. The scoped reference projection covers every
  // other shared-walker field without loading assets twice or hydrating the
  // character/chat corpus into a persisted Database.
  const assets = getAllAssetMetadata(opts.db)
  const report = buildAssetGcRisuSaveAssetReport(opts.db, assets)
  result.scannedOrphans = report.orphaned.length

  const referencedIds = new Set(report.referenced.map((reference) => reference.id))
  const deletedIds = new Set<string>()
  const filesToDelete: string[] = []

  for (const orphan of report.orphaned) {
    const file = assetPath(dataDir, orphan)
    const age = fileAgeMs(file, now)
    if (age === null) {
      deletedIds.add(orphan.id)
      result.deletedAssetIds.push(orphan.id)
      continue
    }
    if (age < graceMs) {
      result.skippedByGrace++
      continue
    }
    deletedIds.add(orphan.id)
    result.deletedAssetIds.push(orphan.id)
    filesToDelete.push(file)
  }

  if (deletedIds.size > 0) {
    deleteAssetMetadataByIds(opts.db, [...deletedIds])
  }

  for (const file of filesToDelete) {
    try {
      fs.rmSync(file, { force: true })
    } catch {
      // ignore
    }
  }

  const storedIds = new Set(assets.map((asset) => asset.id))
  const dir = assetsDir(dataDir)
  let entries: string[] = []
  try {
    entries = fs.readdirSync(dir)
  } catch {
    entries = []
  }
  for (const name of entries) {
    const id = name.replace(/\.[^.]+$/, '')
    if (!isValidAssetId(id)) continue
    if (storedIds.has(id) || referencedIds.has(id) || deletedIds.has(id)) continue
    const file = path.join(dir, name)
    const age = fileAgeMs(file, now)
    if (age === null) continue
    if (age < graceMs) {
      result.skippedByGrace++
      continue
    }
    try {
      fs.rmSync(file, { force: true })
      result.deletedStrayFiles.push(name)
    } catch {
      // ignore
    }
  }

  return result
}
