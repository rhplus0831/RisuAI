import { type PersistedAsset, isValidAssetId } from '../repository.js'

type JsonRecord = Record<string, unknown>
type AssetReferenceRewriter = (value: string) => string

const LOCAL_ASSET_PATH_RE = /^assets\/([a-f0-9]{64})\.[a-z0-9]+$/i
const INLAY_TOKEN_RE = /\{\{(inlay|inlayed|inlayeddata)::(.+?)\}\}/g

/**
 * Original Risu stores local-backup asset records under `assets/<record name>`
 * and keeps that full path in its database. Fastify stores only the sha256 id,
 * so make the portable `.bin` database use the original path convention.
 *
 * The original exporter also deliberately omits the obsolete account object;
 * keep migrated account ids/tokens out of portable local backups here.
 */
export function prepareLegacyLocalBackupExportDatabase(
  database: JsonRecord,
  assets: readonly PersistedAsset[],
): JsonRecord {
  const prepared = structuredClone(database)
  delete prepared.account

  const pathsById = new Map(assets.map((asset) => [asset.id, `assets/${asset.id}.${asset.ext}`]))
  rewriteKnownAssetReferences(prepared, (value) => {
    const id = assetIdFromReference(value)
    return id ? (pathsById.get(id) ?? value) : value
  })
  return prepared
}

/**
 * Legacy `.bin` databases use original-Risu asset paths. Convert the known
 * reference fields back to Fastify's canonical sha256 ids before persistence so
 * subsequent server commands continue to satisfy their asset-id invariants.
 */
export function normalizeLegacyLocalBackupImportDatabase(
  database: JsonRecord,
  assetReferenceAliases: ReadonlyMap<string, string> = new Map(),
): JsonRecord {
  const normalized = structuredClone(database)
  rewriteKnownAssetReferences(normalized, (value) => {
    const aliasedId = assetReferenceAliases.get(value)
    if (aliasedId && isValidAssetId(aliasedId)) return aliasedId
    return assetIdFromLocalPath(value) ?? value
  })
  return normalized
}

function rewriteKnownAssetReferences(database: JsonRecord, rewrite: AssetReferenceRewriter): void {
  rewriteField(database, 'userIcon', rewrite)
  rewriteField(database, 'customBackground', rewrite)

  for (const persona of readRecords(database.personas)) {
    rewriteField(persona, 'icon', rewrite)
  }

  for (const entry of readRecords(database.characterOrder)) {
    rewriteField(entry, 'img', rewrite)
    rewriteField(entry, 'imgFile', rewrite)
  }

  for (const collectionName of ['botPresets', 'modelPresets', 'promptPresets']) {
    for (const preset of readRecords(database[collectionName])) {
      rewriteField(preset, 'image', rewrite)
    }
  }

  for (const module of readRecords(database.modules)) {
    rewriteTupleReferences(module.assets, rewrite)
  }

  for (const character of readRecords(database.characters)) {
    rewriteField(character, 'image', rewrite)
    rewriteField(character, 'notificationImage', rewrite)
    rewriteTupleReferences(character.emotionImages, rewrite)
    rewriteTupleReferences(character.additionalAssets, rewrite)
    rewriteChatInlayReferences(character.chats, rewrite)
    rewriteCcAssetReferences(character.ccAssets, rewrite)
    rewriteVitsReferences(character.vits, rewrite)
    rewriteReferenceList(character, 'prebuiltAssetExclude', rewrite)
    rewriteGptSoVitsReference(character.gptSoVitsConfig, rewrite)
  }
}

function rewriteField(record: JsonRecord, key: string, rewrite: AssetReferenceRewriter): void {
  const value = record[key]
  if (typeof value === 'string') {
    record[key] = rewrite(value)
  }
}

function rewriteTupleReferences(value: unknown, rewrite: AssetReferenceRewriter): void {
  for (const entry of readArray(value)) {
    if (Array.isArray(entry) && typeof entry[1] === 'string') {
      entry[1] = rewrite(entry[1])
    }
  }
}

function rewriteChatInlayReferences(value: unknown, rewrite: AssetReferenceRewriter): void {
  for (const chat of readRecords(value)) {
    for (const message of readRecords(chat.message)) {
      if (typeof message.data !== 'string') continue
      message.data = message.data.replace(INLAY_TOKEN_RE, (match, tag: string, reference: string) => {
        const rewritten = rewrite(reference)
        return rewritten === reference ? match : `{{${tag}::${rewritten}}}`
      })
    }
  }
}

function rewriteCcAssetReferences(value: unknown, rewrite: AssetReferenceRewriter): void {
  for (const asset of readRecords(value)) {
    rewriteField(asset, 'uri', rewrite)
  }
}

function rewriteVitsReferences(value: unknown, rewrite: AssetReferenceRewriter): void {
  const files = readRecord(readRecord(value)?.files)
  if (!files) return
  for (const key of Object.keys(files)) {
    rewriteField(files, key, rewrite)
  }
}

function rewriteReferenceList(record: JsonRecord, key: string, rewrite: AssetReferenceRewriter): void {
  const value = record[key]
  if (!Array.isArray(value)) return
  record[key] = value.map((entry) => (typeof entry === 'string' ? rewrite(entry) : entry))
}

function rewriteGptSoVitsReference(value: unknown, rewrite: AssetReferenceRewriter): void {
  const refAudio = readRecord(readRecord(value)?.ref_audio_data)
  if (refAudio) {
    rewriteField(refAudio, 'assetId', rewrite)
  }
}

function assetIdFromReference(value: string): string | null {
  return isValidAssetId(value) ? value : assetIdFromLocalPath(value)
}

function assetIdFromLocalPath(value: string): string | null {
  const match = LOCAL_ASSET_PATH_RE.exec(value)
  if (!match) return null
  const id = match[1].toLowerCase()
  return isValidAssetId(id) ? id : null
}

function readRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as JsonRecord
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function readRecords(value: unknown): JsonRecord[] {
  return readArray(value).flatMap((entry) => {
    const record = readRecord(entry)
    return record ? [record] : []
  })
}
