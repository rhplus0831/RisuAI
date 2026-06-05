import type { FastifyInstance, FastifyReply } from 'fastify'
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
import { getSchemaState } from '../db.js'
import {
  COMMAND_EVENT_CATALOG,
  persistRevisionedCommandEvent,
  type CommandEventSink,
} from '../commands/events.js'
import {
  TARGETED_MUTATION_PATHS,
  applyTargetedCommandMutation,
  readBaseRevision,
  type JsonCommandMutationResult,
} from '../commands/mutations.js'
import { createCharacterRecord } from '../commands/characters.js'
import {
  ValidationError,
  addAsset,
  assetPath,
  assetsDir,
  characterRowExists,
  CONTENT_TYPE_EXTENSIONS,
  getAssetMetadataById,
  insertCharacterChatRow,
  insertCharacterRow,
  insertAssetMetadataBatch,
  nextCharacterRowPosition,
  type AddAssetResult,
  type PersistedAsset,
  updateSettingsForCharacterAppend,
} from '../repository.js'
import { replaceActiveChatMessages, setChatHypaV3 } from '../messageStore.js'
import { importRateLimit } from '../routeRateLimits.js'
import {
  LowLevelAccessImportError,
  convertRealmCharacterCard,
  type RealmAssetSource,
} from '../realmImport/characterCard.js'
import { emitProtocolMetric } from '../protocolMetrics.js'

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

export type RealmImportProgressPhase =
  | 'validate'
  | 'download'
  | 'extract'
  | 'assets'
  | 'convert'
  | 'commit'

export interface RealmImportProgress {
  phase: RealmImportProgressPhase
  message: string
  percent: number
}

type RealmImportProgressReporter = (progress: RealmImportProgress) => void

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

class RevisionConflictError extends Error {
  constructor(readonly currentRevision: number) {
    super('Revision mismatch')
    this.name = 'RevisionConflictError'
  }
}

class UnsupportedRealmDownloadError extends Error {
  constructor(readonly contentType: string) {
    super(`Unsupported Realm download content-type: ${contentType}`)
    this.name = 'UnsupportedRealmDownloadError'
  }
}

export function registerRealmImportRoutes(
  app: FastifyInstance,
  db: DatabaseSync,
  authState: AuthState,
  dataDir: string,
  eventSink: CommandEventSink,
  options: { hubUrl: string; realmUrl?: string; maxExpandedImportBytes?: number },
): void {
  const hubUrl = options.hubUrl.replace(/\/+$/, '')
  const realmUrl = (options.realmUrl ?? 'https://realm.risuai.net').replace(/\/+$/, '')

  app.post(
    '/api/v1/import/realm-character',
    { config: { rateLimit: importRateLimit } },
    async (req, reply) => {
      if (!(await requireAuth(authState, req, reply))) return

      try {
        const body = (req.body ?? {}) as RealmImportBody
        if (acceptsProgressStream(req.headers.accept)) {
          await streamRealmImport(reply, (reportProgress) =>
            runRealmImport({
              db,
              dataDir,
              eventSink,
              body,
              hubUrl,
              realmUrl,
              maxExpandedImportBytes: options.maxExpandedImportBytes,
              reportProgress,
            }),
          )
          return
        }
        return await runRealmImport({
          db,
          dataDir,
          eventSink,
          body,
          hubUrl,
          realmUrl,
          maxExpandedImportBytes: options.maxExpandedImportBytes,
        })
      } catch (err) {
        if (err instanceof RevisionConflictError) {
          reply.code(409)
          return { error: err.message, currentRevision: err.currentRevision }
        }
        if (err instanceof LowLevelAccessImportError) {
          reply.code(409)
          return { error: err.message, code: 'low_level_access_confirmation_required' }
        }
        if (err instanceof UnsupportedRealmDownloadError) {
          reply.code(415)
          return { error: err.message, code: 'unsupported_realm_download' }
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
    },
  )
}

async function runRealmImport(args: {
  db: DatabaseSync
  dataDir: string
  eventSink: CommandEventSink
  body: RealmImportBody
  hubUrl: string
  realmUrl: string
  maxExpandedImportBytes?: number
  reportProgress?: RealmImportProgressReporter
}): Promise<{ revision: number; event: unknown; characterId: string }> {
  const reportProgress = createMonotonicProgressReporter(args.reportProgress)
  reportProgress({ phase: 'validate', message: 'Preparing Realm import', percent: 1 })

  // Validate the caller's revision before doing potentially expensive
  // upstream fetches. Asset writes below intentionally advance the revision;
  // the final character command uses the then-current revision.
  const requestedBaseRevision = readBaseRevision(args.body)
  const currentRevision = getSchemaState(args.db).revision
  if (requestedBaseRevision !== currentRevision) {
    throw new RevisionConflictError(currentRevision)
  }

  const id = readRealmId(args.body.id)
  reportProgress({ phase: 'download', message: 'Downloading Realm character', percent: 5 })
  const dynamic = await fetchRealmDynamicPayload(args.realmUrl, id, (percent) => {
    reportProgress({
      phase: 'download',
      message: 'Downloading Realm character',
      percent: scaleProgress(percent, 5, 30),
    })
  })
  try {
    reportProgress({ phase: 'download', message: 'Realm character downloaded', percent: 30 })
    if (dynamic.contentType === 'application/json') {
      return await importRealmJsonCard({
        db: args.db,
        dataDir: args.dataDir,
        eventSink: args.eventSink,
        body: args.body,
        dynamicBody: dynamic.body,
        hubUrl: args.hubUrl,
        id,
        reportProgress,
      })
    }

    if (CHARX_CONTENT_TYPES.has(dynamic.contentType) && dynamic.filePath && dynamic.tempDir) {
      const result = await importRealmCharx({
        db: args.db,
        dataDir: args.dataDir,
        eventSink: args.eventSink,
        filePath: dynamic.filePath,
        tempDir: dynamic.tempDir,
        allowLowLevelAccess: args.body.allowLowLevelAccess === true,
        maxExpandedImportBytes: args.maxExpandedImportBytes,
        reportProgress,
      })

      reportProgress({ phase: 'commit', message: 'Realm import complete', percent: 100 })
      return {
        revision: result.revision,
        event: result.event,
        characterId: result.extra.characterId,
      }
    }

    throw new UnsupportedRealmDownloadError(dynamic.contentType)
  } finally {
    await cleanupRealmDynamicPayload(dynamic)
  }
}

async function importRealmJsonCard(args: {
  db: DatabaseSync
  dataDir: string
  eventSink: CommandEventSink
  body: RealmImportBody
  dynamicBody: unknown
  hubUrl: string
  id: string
  reportProgress: RealmImportProgressReporter
}): Promise<{ revision: number; event: unknown; characterId: string }> {
  const payload = readRecord(args.dynamicBody, 'Realm download response')
  const card = readRecord(payload.card, 'Realm download response.card')
  const data = readRecord(card.data, 'Realm download response.card.data')
  const extensions = ensureRecordField(data, 'extensions')
  const risuai = ensureRecordField(extensions, 'risuai')
  risuai.risuRealmImportId = args.id
  if (risuai.lowLevelAccess === true && args.body.allowLowLevelAccess !== true) {
    throw new LowLevelAccessImportError()
  }

  args.reportProgress({ phase: 'assets', message: 'Saving main image', percent: 35 })
  const imgResource = readNonEmptyString(payload.img, 'Realm download response.img')
  const mainImageId = await saveFetchedAsset({
    db: args.db,
    dataDir: args.dataDir,
    eventSink: args.eventSink,
    source: { kind: 'resource', id: imgResource, fileName: 'realm.png' },
    hubUrl: args.hubUrl,
  })

  const assetProgress = createCountingAssetProgress(card, args.reportProgress, 40, 82)
  args.reportProgress({ phase: 'convert', message: 'Converting character card', percent: 40 })
  const character = await convertRealmCharacterCard(card, {
    mainImageId,
    allowLowLevelAccess: args.body.allowLowLevelAccess === true,
    storeAsset: async (source) => {
      const assetId = await saveFetchedAsset({
        db: args.db,
        dataDir: args.dataDir,
        eventSink: args.eventSink,
        source,
        hubUrl: args.hubUrl,
      })
      assetProgress()
      return assetId
    },
  })

  args.reportProgress({ phase: 'commit', message: 'Saving character', percent: 90 })
  const result = appendRealmCharacter({
    db: args.db,
    dataDir: args.dataDir,
    eventSink: args.eventSink,
    character,
  })

  args.reportProgress({ phase: 'commit', message: 'Realm import complete', percent: 100 })
  return {
    revision: result.revision,
    event: result.event,
    characterId: result.extra.characterId,
  }
}

async function streamRealmImport(
  reply: FastifyReply,
  run: (
    reportProgress: RealmImportProgressReporter,
  ) => Promise<{ revision: number; event: unknown; characterId: string }>,
): Promise<void> {
  reply.hijack()
  reply.raw.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  })

  const write = (event: string, payload: unknown): void => {
    if (!reply.raw.writableEnded) {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`)
    }
  }

  try {
    const result = await run((progress) => write('progress', progress))
    write('done', result)
  } catch (err) {
    if (err instanceof RevisionConflictError) {
      write('conflict', { error: err.message, currentRevision: err.currentRevision })
    } else if (err instanceof LowLevelAccessImportError) {
      write('low_level_access', {
        error: err.message,
        code: 'low_level_access_confirmation_required',
      })
    } else if (err instanceof UnsupportedRealmDownloadError) {
      write('unsupported', { error: err.message, code: 'unsupported_realm_download' })
    } else if (err instanceof ValidationError || err instanceof UpstreamError) {
      write('error', { error: err.message })
    } else {
      write('error', { error: err instanceof Error ? err.message : String(err) })
    }
  } finally {
    reply.raw.end()
  }
}

function acceptsProgressStream(accept: unknown): boolean {
  return typeof accept === 'string' && accept.includes('text/event-stream')
}

async function fetchRealmDynamicPayload(
  realmUrl: string,
  id: string,
  reportDownloadProgress?: (percent: number) => void,
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
    return {
      contentType,
      body: null,
      ...(await writeRealmDownloadToTempFile(res, reportDownloadProgress)),
    }
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
  reportDownloadProgress?: (percent: number) => void,
): Promise<{ filePath: string; tempDir: string }> {
  const tempDir = await fs.promises.mkdtemp(path.join(tmpdir(), 'risu-realm-charx-'))
  const filePath = path.join(tempDir, 'realm.charx')
  let totalBytes = 0
  const contentLength = readPositiveContentLength(res.headers.get('content-length'))

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
        if (contentLength) {
          reportDownloadProgress?.(Math.min(100, (totalBytes / contentLength) * 100))
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
  maxExpandedImportBytes?: number
  reportProgress?: RealmImportProgressReporter
}): Promise<JsonCommandMutationResult<{ characterId: string }>> {
  args.reportProgress?.({ phase: 'extract', message: 'Reading character card', percent: 32 })
  const cardBytes = await readCharxCard(args.filePath, args.maxExpandedImportBytes)
  const card = parseJsonBytes(cardBytes, 'card.json')
  const data = readRecord(readRecord(card, 'card').data, 'card.data')
  const extensions = readOptionalRecord(data.extensions)
  const risuai = readOptionalRecord(extensions?.risuai)
  if (risuai?.lowLevelAccess === true && !args.allowLowLevelAccess) {
    throw new LowLevelAccessImportError()
  }

  args.reportProgress?.({ phase: 'extract', message: 'Extracting package assets', percent: 38 })
  const assetTotal = countEmbeddedCardAssets(card)
  const extractProgress = createStepProgress({
    phase: 'extract',
    message: 'Extracting package assets',
    reportProgress: args.reportProgress,
    total: assetTotal,
    start: 38,
    end: 62,
  })
  const stagedAssets = await stageCharxAssets(args.filePath, path.join(args.tempDir, 'assets'), {
    initialExpandedBytes: cardBytes.byteLength,
    maxExpandedBytes: args.maxExpandedImportBytes,
    onAssetStaged: extractProgress,
  })
  emitProtocolMetric('realm_import_staged_assets', {
    stagedAssetCount: stagedAssets.length,
    stagedAssetBytes: stagedAssets.reduce((sum, asset) => sum + asset.byteLength, 0),
  })
  args.reportProgress?.({ phase: 'assets', message: 'Saving package assets', percent: 65 })
  const persistProgress = createStepProgress({
    phase: 'assets',
    message: 'Saving package assets',
    reportProgress: args.reportProgress,
    total: stagedAssets.length,
    start: 65,
    end: 82,
  })
  const assetDict = saveStagedCharxAssets({
    db: args.db,
    dataDir: args.dataDir,
    eventSink: args.eventSink,
    stagedAssets,
    onAssetSaved: persistProgress,
  })

  args.reportProgress?.({ phase: 'convert', message: 'Converting character card', percent: 85 })
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

  args.reportProgress?.({ phase: 'commit', message: 'Saving character', percent: 92 })
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
  const characterRecord = createCharacterRecord(args.character, { assetDb: args.db })
  return applyTargetedCommandMutation<{ characterId: string }>({
    db: args.db,
    dataDir: args.dataDir,
    baseRevision,
    eventSink: args.eventSink,
    mutationPath: TARGETED_MUTATION_PATHS.characterRow,
    skipDatabaseLoad: true,
    mutate(_database, innerDb) {
      if (characterRowExists(innerDb, characterRecord.chaId)) {
        throw new ValidationError(`Duplicate character id: ${characterRecord.chaId}`)
      }
      const position = nextCharacterRowPosition(innerDb)
      insertCharacterRow(innerDb, position, characterRecord)
      insertRealmCharacterChats(innerDb, characterRecord.chaId, characterRecord)
      updateSettingsForCharacterAppend(
        innerDb,
        characterRecord.chaId,
        characterRecord,
        position + 1,
      )
      return {
        event: { ...COMMAND_EVENT_CATALOG.characterCreated, id: characterRecord.chaId },
        extra: { characterId: characterRecord.chaId },
      }
    },
  })
}

function insertRealmCharacterChats(
  db: DatabaseSync,
  characterId: string,
  character: JsonRecord,
): void {
  const chats = Array.isArray(character.chats) ? character.chats : []
  for (let position = 0; position < chats.length; position++) {
    const chat = readOptionalRecord(chats[position])
    if (!chat || typeof chat.id !== 'string') continue

    insertCharacterChatRow(db, characterId, position, chat)
    if (Array.isArray(chat.message) && chat.message.length > 0) {
      replaceActiveChatMessages(db, chat.id, chat.message)
    }
    if (chat.hypaV3Data !== undefined) {
      setChatHypaV3(db, chat.id, chat.hypaV3Data)
    }
  }
}

async function readCharxCard(
  filePath: string,
  maxExpandedBytes: number | undefined,
): Promise<Uint8Array> {
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
        if (exceedsFiniteLimit(totalBytes, maxExpandedBytes)) {
          setError(new ValidationError('Realm charx expanded payload exceeds size limit'))
          return
        }
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

async function stageCharxAssets(
  filePath: string,
  stageDir: string,
  options: {
    initialExpandedBytes?: number
    maxExpandedBytes?: number
    onAssetStaged?: () => void
  } = {},
): Promise<StagedCharxAsset[]> {
  await fs.promises.mkdir(stageDir, { recursive: true })
  const stagedAssets: StagedCharxAsset[] = []
  let nextAssetIndex = 0
  let totalExpandedBytes = options.initialExpandedBytes ?? 0

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

      if (data.byteLength > 0 && file.name !== 'card.json') {
        totalExpandedBytes += data.byteLength
        if (exceedsFiniteLimit(totalExpandedBytes, options.maxExpandedBytes)) {
          failed = true
          closeStageFile()
          if (stagedPath) fs.rmSync(stagedPath, { force: true })
          setError(new ValidationError('Realm charx expanded payload exceeds size limit'))
          return
        }
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
        options.onAssetStaged?.()
      }
    }
    file.start()
  })

  return stagedAssets
}

function exceedsFiniteLimit(byteLength: number, limit: number | undefined): boolean {
  return limit !== undefined && Number.isFinite(limit) && byteLength > limit
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
  onAssetSaved?: () => void
}): Record<string, string> {
  const createdAssets: PersistedAsset[] = []
  const createdFiles: Array<{ file: string; existedBefore: boolean }> = []
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
    const existing = getAssetMetadataById(args.db, id)
    if (existing) {
      const file = assetPath(args.dataDir, existing)
      if (!fs.existsSync(file)) {
        fs.writeFileSync(file, bytes)
      }
      assetDict[staged.fileName] = existing.id
      args.onAssetSaved?.()
      continue
    }

    const entry: PersistedAsset = {
      id,
      ext,
      size: bytes.length,
      contentType,
    }
    const file = path.join(assetsDir(args.dataDir), `${id}.${ext}`)
    const existedBefore = fs.existsSync(file)
    fs.writeFileSync(file, bytes)
    createdFiles.push({ file, existedBefore })
    createdAssets.push(entry)
    assetDict[staged.fileName] = entry.id
    args.onAssetSaved?.()
  }

  if (createdAssets.length > 0) {
    let transactionOpen = false
    args.db.exec('BEGIN IMMEDIATE')
    transactionOpen = true
    try {
      insertAssetMetadataBatch(args.db, createdAssets)
      const event = persistRevisionedCommandEvent(args.db, {
        ...COMMAND_EVENT_CATALOG.assetCreated,
        ...(createdAssets.length === 1 ? { id: createdAssets[0].id } : {}),
      })
      args.db.exec('COMMIT')
      transactionOpen = false
      args.eventSink.emit(event)
    } catch (err) {
      if (transactionOpen) {
        args.db.exec('ROLLBACK')
      }
      for (const { file, existedBefore } of createdFiles) {
        if (!existedBefore) {
          fs.rmSync(file, { force: true })
        }
      }
      throw err
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
  if (result.event) {
    eventSink.emit(result.event)
  }
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

function readPositiveContentLength(value: string | null): number | null {
  if (!value) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function scaleProgress(percent: number, start: number, end: number): number {
  const clamped = Math.max(0, Math.min(100, percent))
  return start + ((end - start) * clamped) / 100
}

function createMonotonicProgressReporter(
  reportProgress?: RealmImportProgressReporter,
): RealmImportProgressReporter {
  let lastPercent = 0
  return (progress) => {
    if (!reportProgress) return
    const percent = Math.max(lastPercent, Math.min(100, Math.max(0, progress.percent)))
    lastPercent = percent
    reportProgress({ ...progress, percent: Number(percent.toFixed(2)) })
  }
}

function createStepProgress(args: {
  phase: RealmImportProgressPhase
  message: string
  reportProgress?: RealmImportProgressReporter
  total: number
  start: number
  end: number
}): () => void {
  let completed = 0
  return () => {
    completed += 1
    if (!args.reportProgress || args.total < 1) return
    args.reportProgress({
      phase: args.phase,
      message: args.message,
      percent: scaleProgress((completed / args.total) * 100, args.start, args.end),
    })
  }
}

function createCountingAssetProgress(
  card: JsonRecord,
  reportProgress: RealmImportProgressReporter,
  start: number,
  end: number,
): () => void {
  return createStepProgress({
    phase: 'assets',
    message: 'Saving card assets',
    reportProgress,
    total: countExternalCardAssets(card),
    start,
    end,
  })
}

function countExternalCardAssets(card: JsonRecord): number {
  const data = readOptionalRecord(card.data)
  const risuExt = readOptionalRecord(readOptionalRecord(data?.extensions)?.risuai)
  let count = 0
  for (const entry of arrayValue(risuExt?.emotions)) {
    if (Array.isArray(entry) && typeof entry[1] === 'string' && !entry[1].startsWith('__asset:')) {
      count += 1
    }
  }
  for (const entry of arrayValue(risuExt?.additionalAssets)) {
    if (Array.isArray(entry) && typeof entry[1] === 'string' && !entry[1].startsWith('__asset:')) {
      count += 1
    }
  }
  const vits = readOptionalRecord(risuExt?.vits)
  if (vits) {
    for (const value of Object.values(vits)) {
      if (typeof value === 'string' && !value.startsWith('__asset:')) count += 1
    }
  }
  for (const asset of arrayValue(data?.assets)) {
    const record = readOptionalRecord(asset)
    const uri = typeof record?.uri === 'string' ? record.uri : ''
    if (uri.startsWith('data:')) count += 1
  }
  return count
}

function countEmbeddedCardAssets(card: unknown): number {
  const root = readOptionalRecord(card)
  const data = readOptionalRecord(root?.data)
  let count = 0
  for (const asset of arrayValue(data?.assets)) {
    const record = readOptionalRecord(asset)
    const uri = typeof record?.uri === 'string' ? record.uri : ''
    if (uri.startsWith('__asset:') || uri.startsWith('embeded://')) count += 1
  }
  return count
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
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
