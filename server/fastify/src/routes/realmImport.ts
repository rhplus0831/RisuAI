import type { FastifyInstance } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import * as fflate from 'fflate'
import type { AuthState } from '../auth.js'
import { requireAuth } from '../http.js'
import { bumpRevision, getSchemaState } from '../db.js'
import { COMMAND_EVENT_CATALOG, type CommandEventSink } from '../commands/events.js'
import {
  applyJsonCommandMutation,
  readBaseRevision,
  type JsonCommandMutationResult,
} from '../commands/mutations.js'
import {
  createCharacterRecord,
  ensureCharacterCollection,
  ensureDatabaseObject as ensureCharacterDatabaseObject,
  findCharacterIndex,
} from '../commands/characters.js'
import {
  ValidationError,
  addAsset,
  assetPath,
  assetsDir,
  CONTENT_TYPE_EXTENSIONS,
  loadPersisted,
  writePersisted,
  type AddAssetResult,
  type PersistedAsset,
} from '../repository.js'
import {
  LowLevelAccessImportError,
  convertRealmCharacterCard,
  type RealmAssetSource,
} from '../realmImport/characterCard.js'

type JsonRecord = Record<string, unknown>

const REALM_DYNAMIC_PATH = '/api/v1/download/dynamic/'
const CHARX_CONTENT_TYPES = new Set(['application/charx', 'application/zip'])
const MAX_CHARX_ASSET_SIZE_BYTES = 50 * 1024 * 1024
const MAX_REALM_CHARX_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024
const CHARX_STREAM_CHUNK_BYTES = 64 * 1024
const EXTENSION_CONTENT_TYPES = Object.fromEntries(
  Object.entries(CONTENT_TYPE_EXTENSIONS).map(([contentType, ext]) => [ext, contentType]),
) as Record<string, string>
EXTENSION_CONTENT_TYPES.jpeg = 'image/jpeg'

interface RealmImportBody {
  id?: unknown
  baseRevision?: unknown
  allowLowLevelAccess?: unknown
}

interface StagedCharxAsset {
  fileName: string
  filePath: string
  byteLength: number
}

type RealmDynamicPayload =
  | {
      contentType: 'application/json'
      body: unknown
      bytes?: never
      filePath?: never
      tempDir?: never
    }
  | { contentType: string; body: null; bytes?: never; filePath: string; tempDir: string }

class UpstreamError extends Error {
  constructor(
    message: string,
    readonly statusCode = 502,
  ) {
    super(message)
    this.name = 'UpstreamError'
  }
}

export function registerRealmImportRoutes(
  app: FastifyInstance,
  db: DatabaseSync,
  authState: AuthState,
  dataDir: string,
  eventSink: CommandEventSink,
  options: { hubUrl: string; realmUrl?: string },
): void {
  const hubUrl = options.hubUrl.replace(/\/+$/, '')
  const realmUrl = (options.realmUrl ?? 'https://realm.risuai.net').replace(/\/+$/, '')

  app.post('/api/v1/import/realm-character', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    try {
      const body = (req.body ?? {}) as RealmImportBody
      // Validate the caller's revision before doing potentially expensive
      // upstream fetches. Asset writes below intentionally advance the revision;
      // the final character command uses the then-current revision.
      const requestedBaseRevision = readBaseRevision(body)
      const currentRevision = getSchemaState(db).revision
      if (requestedBaseRevision !== currentRevision) {
        reply.code(409)
        return { error: 'Revision mismatch', currentRevision }
      }

      const id = readRealmId(body.id)
      const dynamic = await fetchRealmDynamicPayload(realmUrl, id)
      try {
        if (dynamic.contentType === 'application/json') {
          const payload = readRecord(dynamic.body, 'Realm download response')
          const card = readRecord(payload.card, 'Realm download response.card')
          const data = readRecord(card.data, 'Realm download response.card.data')
          const extensions = ensureRecordField(data, 'extensions')
          const risuai = ensureRecordField(extensions, 'risuai')
          risuai.risuRealmImportId = id
          if (risuai.lowLevelAccess === true && body.allowLowLevelAccess !== true) {
            throw new LowLevelAccessImportError()
          }

          const imgResource = readNonEmptyString(payload.img, 'Realm download response.img')
          const mainImageId = await saveFetchedAsset({
            db,
            dataDir,
            eventSink,
            source: { kind: 'resource', id: imgResource, fileName: 'realm.png' },
            hubUrl,
          })

          const character = await convertRealmCharacterCard(card, {
            mainImageId,
            allowLowLevelAccess: body.allowLowLevelAccess === true,
            storeAsset: (source) => saveFetchedAsset({ db, dataDir, eventSink, source, hubUrl }),
          })

          const result = appendRealmCharacter({
            db,
            dataDir,
            eventSink,
            character,
          })

          return {
            revision: result.revision,
            event: result.event,
            characterId: result.extra.characterId,
          }
        }

        if (CHARX_CONTENT_TYPES.has(dynamic.contentType) && dynamic.filePath && dynamic.tempDir) {
          const result = await importRealmCharx({
            db,
            dataDir,
            eventSink,
            filePath: dynamic.filePath,
            tempDir: dynamic.tempDir,
            allowLowLevelAccess: body.allowLowLevelAccess === true,
          })

          return {
            revision: result.revision,
            event: result.event,
            characterId: result.extra.characterId,
          }
        }

        reply.code(415)
        return {
          error: `Unsupported Realm download content-type: ${dynamic.contentType}`,
          code: 'unsupported_realm_download',
        }
      } finally {
        await cleanupRealmDynamicPayload(dynamic)
      }
    } catch (err) {
      if (err instanceof LowLevelAccessImportError) {
        reply.code(409)
        return { error: err.message, code: 'low_level_access_confirmation_required' }
      }
      if (err instanceof ValidationError) {
        reply.code(400)
        return { error: err.message }
      }
      if (err instanceof UpstreamError) {
        reply.code(err.statusCode)
        return { error: err.message }
      }
      throw err
    }
  })
}

async function fetchRealmDynamicPayload(
  realmUrl: string,
  id: string,
): Promise<RealmDynamicPayload> {
  const url = `${realmUrl}${REALM_DYNAMIC_PATH}${encodeURIComponent(id)}?cors=true`
  const res = await fetch(url, {
    headers: {
      'x-risu-api-version': '4',
    },
  })
  if (!res.ok) {
    throw new UpstreamError(`Realm download failed: ${res.status}`, 502)
  }
  const contentType = normalizeContentType(res.headers.get('content-type'))
  if (contentType !== 'application/json') {
    return { contentType, body: null, ...(await writeRealmDownloadToTempFile(res)) }
  }
  let body: unknown
  try {
    body = await res.json()
  } catch {
    throw new UpstreamError('Realm download returned invalid JSON', 502)
  }
  return { contentType, body }
}

async function writeRealmDownloadToTempFile(
  res: Response,
): Promise<{ filePath: string; tempDir: string }> {
  const tempDir = await fs.promises.mkdtemp(path.join(tmpdir(), 'risu-realm-charx-'))
  const filePath = path.join(tempDir, 'realm.charx')
  let totalBytes = 0

  try {
    if (!res.body) {
      await fs.promises.writeFile(filePath, Buffer.alloc(0))
      return { filePath, tempDir }
    }

    const byteCounter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        totalBytes += chunk.byteLength
        if (totalBytes > MAX_REALM_CHARX_DOWNLOAD_BYTES) {
          callback(new UpstreamError('Realm download too large', 413))
          return
        }
        callback(null, chunk)
      },
    })

    await pipeline(
      Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]),
      byteCounter,
      fs.createWriteStream(filePath),
    )
    return { filePath, tempDir }
  } catch (err) {
    await fs.promises.rm(tempDir, { recursive: true, force: true })
    throw err
  }
}

async function cleanupRealmDynamicPayload(dynamic: RealmDynamicPayload): Promise<void> {
  if (!dynamic.tempDir) return
  await fs.promises.rm(dynamic.tempDir, { recursive: true, force: true })
}

async function importRealmCharx(args: {
  db: DatabaseSync
  dataDir: string
  eventSink: CommandEventSink
  filePath: string
  tempDir: string
  allowLowLevelAccess: boolean
}): Promise<JsonCommandMutationResult<{ characterId: string }>> {
  const cardBytes = await readCharxCard(args.filePath)
  const card = parseJsonBytes(cardBytes, 'card.json')
  const data = readRecord(readRecord(card, 'card').data, 'card.data')
  const extensions = readOptionalRecord(data.extensions)
  const risuai = readOptionalRecord(extensions?.risuai)
  if (risuai?.lowLevelAccess === true && !args.allowLowLevelAccess) {
    throw new LowLevelAccessImportError()
  }

  const stagedAssets = await stageCharxAssets(args.filePath, path.join(args.tempDir, 'assets'))
  const assetDict = saveStagedCharxAssets({
    db: args.db,
    dataDir: args.dataDir,
    eventSink: args.eventSink,
    stagedAssets,
  })

  const character = await convertRealmCharacterCard(card, {
    allowLowLevelAccess: args.allowLowLevelAccess,
    assetDict,
    storeAsset: (source) =>
      saveFetchedAsset({
        db: args.db,
        dataDir: args.dataDir,
        eventSink: args.eventSink,
        source,
        hubUrl: '',
      }),
  })

  return appendRealmCharacter({
    db: args.db,
    dataDir: args.dataDir,
    eventSink: args.eventSink,
    character,
  })
}

function appendRealmCharacter(args: {
  db: DatabaseSync
  dataDir: string
  eventSink: CommandEventSink
  character: JsonRecord
}): JsonCommandMutationResult<{ characterId: string }> {
  const baseRevision = getSchemaState(args.db).revision
  const characterRecord = createCharacterRecord(args.character, { assetDataDir: args.dataDir })
  return applyJsonCommandMutation<{ characterId: string }>({
    db: args.db,
    dataDir: args.dataDir,
    baseRevision,
    eventSink: args.eventSink,
    mutate(database) {
      const target = ensureCharacterDatabaseObject(database)
      const characters = ensureCharacterCollection(target)
      if (findCharacterIndex(characters, characterRecord.chaId) !== -1) {
        throw new ValidationError(`Duplicate character id: ${characterRecord.chaId}`)
      }
      characters.push(characterRecord)
      ensureCharacterCollection(target)
      return {
        event: { ...COMMAND_EVENT_CATALOG.characterCreated, id: characterRecord.chaId },
        extra: { characterId: characterRecord.chaId },
      }
    },
  })
}

async function readCharxCard(filePath: string): Promise<Uint8Array> {
  let cardBytes: Uint8Array | null = null

  await streamCharxFile(filePath, (file, setError) => {
    const chunks: Uint8Array[] = []
    let totalBytes = 0
    const shouldCollect = file.name === 'card.json'

    file.ondata = (err, data, final) => {
      if (err) {
        setError(err)
        return
      }
      if (shouldCollect && data.byteLength > 0) {
        totalBytes += data.byteLength
        chunks.push(data)
      }
      if (shouldCollect && final) {
        cardBytes = concatBytes(chunks, totalBytes)
      }
    }
    file.start()
  })

  if (!cardBytes) {
    throw new ValidationError('Realm charx must include card.json')
  }
  return cardBytes
}

async function stageCharxAssets(filePath: string, stageDir: string): Promise<StagedCharxAsset[]> {
  await fs.promises.mkdir(stageDir, { recursive: true })
  const stagedAssets: StagedCharxAsset[] = []
  let nextAssetIndex = 0

  await streamCharxFile(filePath, (file, setError) => {
    const shouldStage =
      file.name !== 'card.json' && file.name !== 'module.risum' && !file.name.endsWith('.json')
    let fd: number | null = null
    let stagedPath = ''
    let byteLength = 0
    let failed = false

    const closeStageFile = () => {
      if (fd === null) return
      fs.closeSync(fd)
      fd = null
    }

    file.ondata = (err, data, final) => {
      if (err) {
        closeStageFile()
        setError(err)
        return
      }
      if (!shouldStage) return

      if (fd === null && !failed) {
        stagedPath = path.join(stageDir, `${nextAssetIndex++}.asset`)
        fd = fs.openSync(stagedPath, 'w')
      }

      if (data.byteLength > 0 && fd !== null) {
        byteLength += data.byteLength
        if (byteLength > MAX_CHARX_ASSET_SIZE_BYTES) {
          failed = true
          closeStageFile()
          fs.rmSync(stagedPath, { force: true })
          setError(new ValidationError(`Realm charx asset too large: ${file.name}`))
          return
        }
        fs.writeSync(fd, data)
      }

      if (final && !failed) {
        closeStageFile()
        if (byteLength === 0) {
          setError(new ValidationError('Realm asset payload is empty'))
          return
        }
        stagedAssets.push({ fileName: file.name, filePath: stagedPath, byteLength })
      }
    }
    file.start()
  })

  return stagedAssets
}

async function streamCharxFile(
  filePath: string,
  onFile: (file: fflate.UnzipFile, setError: (err: Error) => void) => void,
): Promise<void> {
  let parseError: Error | null = null
  const setError = (err: Error) => {
    parseError ??= err
  }

  try {
    const unzip = new fflate.Unzip()
    unzip.register(fflate.UnzipInflate)
    unzip.onfile = (file) => {
      if (parseError) return
      try {
        onFile(file, setError)
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)))
      }
    }

    for await (const chunk of fs.createReadStream(filePath, {
      highWaterMark: CHARX_STREAM_CHUNK_BYTES,
    })) {
      if (parseError) break
      unzip.push(chunk, false)
    }
    if (!parseError) {
      unzip.push(new Uint8Array(), true)
    }
    if (parseError) throw parseError
  } catch (err) {
    throwCharxReadError(err)
  }
}

function throwCharxReadError(err: unknown): never {
  if (err instanceof ValidationError) {
    throw err
  }
  throw new ValidationError(
    err instanceof Error ? `Malformed Realm charx: ${err.message}` : 'Malformed Realm charx',
  )
}

function saveStagedCharxAssets(args: {
  db: DatabaseSync
  dataDir: string
  eventSink: CommandEventSink
  stagedAssets: StagedCharxAsset[]
}): Record<string, string> {
  const persisted = loadPersisted(args.dataDir)
  const nextAssets = [...persisted.assets]
  const assetById = new Map(nextAssets.map((asset) => [asset.id, asset]))
  const createdAssets: PersistedAsset[] = []
  const assetDict: Record<string, string> = {}

  fs.mkdirSync(assetsDir(args.dataDir), { recursive: true })

  for (const staged of args.stagedAssets) {
    const bytes = fs.readFileSync(staged.filePath)
    if (bytes.length === 0) {
      throw new ValidationError('Realm asset payload is empty')
    }
    const contentType = resolveAssetContentType({
      kind: 'bytes',
      fileName: staged.fileName,
    })
    const ext = CONTENT_TYPE_EXTENSIONS[contentType]
    if (!ext) {
      throw new ValidationError(`Unsupported content-type: ${contentType}`)
    }

    const id = createHash('sha256').update(bytes).digest('hex')
    let entry = assetById.get(id)
    if (entry) {
      const file = assetPath(args.dataDir, entry)
      if (!fs.existsSync(file)) {
        fs.writeFileSync(file, bytes)
      }
      assetDict[staged.fileName] = entry.id
      continue
    }

    entry = {
      id,
      ext,
      size: bytes.length,
      contentType,
    }
    fs.writeFileSync(path.join(assetsDir(args.dataDir), `${id}.${ext}`), bytes)
    nextAssets.push(entry)
    assetById.set(id, entry)
    createdAssets.push(entry)
    assetDict[staged.fileName] = entry.id
  }

  if (createdAssets.length > 0) {
    writePersisted(args.dataDir, { ...persisted, assets: nextAssets })
    const revision = bumpRevision(args.db)
    for (const entry of createdAssets) {
      args.eventSink.emit({
        ...COMMAND_EVENT_CATALOG.assetCreated,
        revision,
        id: entry.id,
      })
    }
  }

  return assetDict
}

function concatBytes(chunks: Uint8Array[], byteLength: number): Uint8Array {
  if (chunks.length === 1) return chunks[0]
  const result = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

function parseJsonBytes(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new ValidationError(`${label} must contain valid JSON`)
  }
}

async function saveFetchedAsset(args: {
  db: DatabaseSync
  dataDir: string
  eventSink: CommandEventSink
  source: RealmAssetSource
  hubUrl: string
}): Promise<string> {
  const bytes =
    args.source.kind === 'bytes'
      ? (args.source.bytes ?? Buffer.alloc(0))
      : await fetchHubResource(args.hubUrl, readRealmId(args.source.id))
  if (bytes.length === 0) {
    throw new ValidationError('Realm asset payload is empty')
  }
  const contentType = resolveAssetContentType(args.source)
  const result = addAsset(args.db, args.dataDir, { bytes, contentType })
  emitAssetEvent(args.eventSink, result)
  return result.entry.id
}

async function fetchHubResource(hubUrl: string, id: string): Promise<Buffer> {
  const res = await fetch(`${hubUrl}/resource/${encodeURIComponent(id)}`)
  if (!res.ok) {
    throw new UpstreamError(`Realm resource ${id} failed: ${res.status}`, 502)
  }
  return Buffer.from(await res.arrayBuffer())
}

function emitAssetEvent(eventSink: CommandEventSink, result: AddAssetResult): void {
  if (!result.created) return
  eventSink.emit({
    ...COMMAND_EVENT_CATALOG.assetCreated,
    revision: result.revision,
    id: result.entry.id,
  })
}

function resolveAssetContentType(source: RealmAssetSource): string {
  if (source.contentType && CONTENT_TYPE_EXTENSIONS[source.contentType]) {
    return source.contentType
  }
  const ext = extensionFromFileName(source.fileName)
  return ext ? (EXTENSION_CONTENT_TYPES[ext] ?? 'image/png') : 'image/png'
}

function extensionFromFileName(fileName: string | undefined): string | null {
  if (!fileName) return null
  const ext = fileName.split('.').pop()?.toLowerCase()
  return ext && ext !== fileName.toLowerCase() ? ext : null
}

function normalizeContentType(value: string | null): string {
  return (value ?? 'application/octet-stream').split(';')[0].trim().toLowerCase()
}

function readRealmId(value: unknown): string {
  return readNonEmptyString(value, 'id')
}

function readNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(`${label} must be a non-empty string`)
  }
  return value
}

function readRecord(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(`${label} must be an object`)
  }
  return value as JsonRecord
}

function readOptionalRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as JsonRecord
}

function ensureRecordField(record: JsonRecord, key: string): JsonRecord {
  const existing = record[key]
  if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
    return existing as JsonRecord
  }
  const next: JsonRecord = {}
  record[key] = next
  return next
}
