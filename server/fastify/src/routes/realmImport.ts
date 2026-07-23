import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import { createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import * as fflate from 'fflate'
import type { AuthState } from '../auth.js'
import { readActiveWriterSessionId } from '../activeWriter.js'
import { requireAuth } from '../http.js'
import { getSchemaState } from '../db.js'
import {
  COMMAND_EVENT_CATALOG,
  persistRevisionedCommandEvent,
  type CommandEventOrigin,
  type CommandEventSink,
} from '../commands/events.js'
import {
  TARGETED_MUTATION_PATHS,
  applyTargetedCommandMutation,
  readBaseRevision,
  type JsonCommandMutationResult,
} from '../commands/mutations.js'
import { createCharacterRecord, type CharacterRecord } from '../commands/characters.js'
import { ensureCharacterChats } from '../commands/chats.js'
import { repairLorebookEntries } from '../commands/lorebooks.js'
import {
  ValidationError,
  addAsset,
  assetPath,
  assetsDir,
  characterRowExists,
  CONTENT_TYPE_EXTENSIONS,
  deleteAssetMetadataByIds,
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
const MAX_CHARX_MODULE_SIZE_BYTES = 50 * 1024 * 1024
const DEFAULT_REALM_CHARX_EXPANDED_IMPORT_BYTES = 310 * 1024 * 1024
const DEFAULT_REALM_DYNAMIC_JSON_BYTES = 100 * 1024 * 1024
const REALM_CHARX_DOWNLOAD_CAP_MULTIPLIER = 3
const DEFAULT_REALM_IMPORT_DEADLINE_MS = 600_000
const DEFAULT_PENDING_REALM_CHARX_IMPORT_TTL_MS = 10 * 60_000
const CHARX_STREAM_CHUNK_BYTES = 64 * 1024
const FETCHED_ASSET_STAGE_PREFIX = 'risu-realm-json-assets-'
const RISU_MODULE_MAGIC_BYTE = 111
const RISU_MODULE_VERSION = 0
const RPACK_DECODE_MAP = Buffer.from(
  'LPeEi8ll+7afrrMDLQFpdB/ko+zuXDQhk0oPauJiAp4inP08/HHHxq1ZZwVwbYpEEvokhl+v0XpHzv5QY91RBm8Y4FKoCZ1Wc0y4U2zDoA4Zzz4NfgcyaEbqSPmZLqukSSBeVTU4DLzTsVgWeSgKGuHyzcQ526K6YHJ2fZXvf8jA3jeUv7UUgZIlRazn9WanKzZawRPjSzrojYMbfCewmkLrh6rcVI54JtJXKdS3+C+PiXXwQXfCHv/YFRHlBJcX8zHQmwDXyrRPKjvZsmvaXaE/MGG9kT1O5t++TYKMHSMQmGT0hTN7kEO7qYjx1qUc9sxuuVsLlu3V6cXLCKaAQA==',
  'base64',
)
const EXTENSION_CONTENT_TYPES = Object.fromEntries(
  Object.entries(CONTENT_TYPE_EXTENSIONS).map(([contentType, ext]) => [ext, contentType]),
) as Record<string, string>
EXTENSION_CONTENT_TYPES.jpeg = 'image/jpeg'

interface RealmImportBody {
  id?: unknown
  baseRevision?: unknown
  allowLowLevelAccess?: unknown
  pendingImportToken?: unknown
}

export type RealmImportProgressPhase = 'validate' | 'download' | 'extract' | 'assets' | 'convert' | 'commit'

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

interface StagedFetchedAsset {
  byteLength: number
  contentType: string
  filePath: string
  id: string
}

interface FetchedAssetBudget {
  maxAssetBytes: number
  maxTotalBytes: number
  totalBytes: number
}

interface RealmImportAbort {
  signal: AbortSignal
  cleanup(): void
}

interface PendingRealmCharxImport {
  id: string
  filePath: string
  tempDir: string
  expiresAt: number
  timer: ReturnType<typeof setTimeout>
}

type PendingRealmCharxImports = Map<string, PendingRealmCharxImport>

interface RealmCharxModuleMetadata {
  regex?: unknown[]
  trigger?: unknown[]
  lorebook?: unknown[]
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

class PendingLowLevelAccessImportError extends LowLevelAccessImportError {
  constructor(readonly pendingImportToken: string) {
    super()
    this.name = 'PendingLowLevelAccessImportError'
  }
}

export function registerRealmImportRoutes(
  app: FastifyInstance,
  db: DatabaseSync,
  authState: AuthState,
  dataDir: string,
  eventSink: CommandEventSink,
  options: {
    hubUrl: string
    realmUrl?: string
    maxExpandedImportBytes?: number
    deadlineMs?: number
    maxDynamicJsonBytes?: number
    maxFetchedAssetBytes?: number
    maxFetchedAssetTotalBytes?: number
  },
): void {
  const hubUrl = options.hubUrl.replace(/\/+$/, '')
  const realmUrl = (options.realmUrl ?? 'https://realm.risuai.net').replace(/\/+$/, '')
  const deadlineMs = normalizePositiveInteger(options.deadlineMs, DEFAULT_REALM_IMPORT_DEADLINE_MS)
  const pendingCharxImports: PendingRealmCharxImports = new Map()

  app.addHook('onClose', async () => {
    await cleanupPendingRealmCharxImports(pendingCharxImports)
  })

  app.post('/api/v1/import/realm-character', { config: { rateLimit: importRateLimit } }, async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    const abort = createRealmImportAbort(req, reply, deadlineMs)
    try {
      const body = (req.body ?? {}) as RealmImportBody
      const writerSessionId = readActiveWriterSessionId(req)
      const eventOrigin = writerSessionId ? { writerSessionId } : undefined
      if (acceptsProgressStream(req.headers.accept)) {
        await streamRealmImport(reply, (reportProgress) =>
          runRealmImport({
            db,
            dataDir,
            eventSink,
            eventOrigin,
            body,
            hubUrl,
            realmUrl,
            maxExpandedImportBytes: options.maxExpandedImportBytes,
            maxDynamicJsonBytes: options.maxDynamicJsonBytes,
            maxFetchedAssetBytes: options.maxFetchedAssetBytes,
            maxFetchedAssetTotalBytes: options.maxFetchedAssetTotalBytes,
            pendingCharxImports,
            signal: abort.signal,
            reportProgress,
          }),
        )
        return
      }
      return await runRealmImport({
        db,
        dataDir,
        eventSink,
        eventOrigin,
        body,
        hubUrl,
        realmUrl,
        maxExpandedImportBytes: options.maxExpandedImportBytes,
        maxDynamicJsonBytes: options.maxDynamicJsonBytes,
        maxFetchedAssetBytes: options.maxFetchedAssetBytes,
        maxFetchedAssetTotalBytes: options.maxFetchedAssetTotalBytes,
        pendingCharxImports,
        signal: abort.signal,
      })
    } catch (err) {
      if (err instanceof RevisionConflictError) {
        reply.code(409)
        return { error: err.message, currentRevision: err.currentRevision }
      }
      if (err instanceof LowLevelAccessImportError) {
        reply.code(409)
        return lowLevelAccessResponseBody(err)
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
    } finally {
      abort.cleanup()
    }
  })
}

function createRealmImportAbort(req: FastifyRequest, reply: FastifyReply, deadlineMs: number): RealmImportAbort {
  const controller = new AbortController()

  const abortOnce = (reason: UpstreamError): void => {
    if (!controller.signal.aborted) {
      controller.abort(reason)
    }
  }

  const timer = setTimeout(
    () => abortOnce(new UpstreamError(`Realm import timed out after ${deadlineMs}ms`, 504)),
    deadlineMs,
  )
  timer.unref?.()

  const onRequestClose = (): void => {
    if (!req.raw.complete) {
      abortOnce(new UpstreamError('Realm import aborted by client disconnect', 499))
    }
  }
  const onResponseClose = (): void => {
    if (!reply.raw.writableEnded) {
      abortOnce(new UpstreamError('Realm import aborted by client disconnect', 499))
    }
  }

  req.raw.once('close', onRequestClose)
  reply.raw.once('close', onResponseClose)

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer)
      req.raw.off('close', onRequestClose)
      reply.raw.off('close', onResponseClose)
    },
  }
}

async function runRealmImport(args: {
  db: DatabaseSync
  dataDir: string
  eventSink: CommandEventSink
  eventOrigin?: CommandEventOrigin
  body: RealmImportBody
  hubUrl: string
  realmUrl: string
  maxExpandedImportBytes?: number
  maxDynamicJsonBytes?: number
  maxFetchedAssetBytes?: number
  maxFetchedAssetTotalBytes?: number
  pendingCharxImports: PendingRealmCharxImports
  signal: AbortSignal
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
  const pendingImportToken = readOptionalToken(args.body.pendingImportToken)
  if (pendingImportToken) {
    const pendingImport = getPendingRealmCharxImport(args.pendingCharxImports, pendingImportToken, id)
    if (!pendingImport) {
      throw new ValidationError('Realm import confirmation expired; please retry the import')
    }
    if (args.body.allowLowLevelAccess !== true) {
      throw new PendingLowLevelAccessImportError(pendingImportToken)
    }

    const claimedImport = takePendingRealmCharxImport(args.pendingCharxImports, pendingImportToken)
    if (!claimedImport) {
      throw new ValidationError('Realm import confirmation expired; please retry the import')
    }
    try {
      reportProgress({ phase: 'download', message: 'Using downloaded Realm character', percent: 30 })
      const result = await importRealmCharx({
        db: args.db,
        dataDir: args.dataDir,
        eventSink: args.eventSink,
        eventOrigin: args.eventOrigin,
        filePath: claimedImport.filePath,
        tempDir: claimedImport.tempDir,
        allowLowLevelAccess: true,
        maxExpandedImportBytes: args.maxExpandedImportBytes,
        maxFetchedAssetBytes: args.maxFetchedAssetBytes,
        maxFetchedAssetTotalBytes: args.maxFetchedAssetTotalBytes,
        signal: args.signal,
        reportProgress,
      })

      reportProgress({ phase: 'commit', message: 'Realm import complete', percent: 100 })
      return {
        revision: result.revision,
        event: result.event,
        characterId: result.extra.characterId,
      }
    } finally {
      await cleanupPendingRealmCharxImport(claimedImport)
    }
  }

  reportProgress({ phase: 'download', message: 'Downloading Realm character', percent: 5 })
  const dynamic = await fetchRealmDynamicPayload(
    args.realmUrl,
    id,
    args.signal,
    args.maxExpandedImportBytes,
    args.maxDynamicJsonBytes,
    (percent) => {
      reportProgress({
        phase: 'download',
        message: 'Downloading Realm character',
        percent: scaleProgress(percent, 5, 30),
      })
    },
  )
  let shouldCleanupDynamicPayload = true
  try {
    reportProgress({ phase: 'download', message: 'Realm character downloaded', percent: 30 })
    if (dynamic.contentType === 'application/json') {
      return await importRealmJsonCard({
        db: args.db,
        dataDir: args.dataDir,
        eventSink: args.eventSink,
        eventOrigin: args.eventOrigin,
        body: args.body,
        dynamicBody: dynamic.body,
        hubUrl: args.hubUrl,
        id,
        maxExpandedImportBytes: args.maxExpandedImportBytes,
        maxFetchedAssetBytes: args.maxFetchedAssetBytes,
        maxFetchedAssetTotalBytes: args.maxFetchedAssetTotalBytes,
        signal: args.signal,
        reportProgress,
      })
    }

    if (CHARX_CONTENT_TYPES.has(dynamic.contentType) && dynamic.filePath && dynamic.tempDir) {
      try {
        const result = await importRealmCharx({
          db: args.db,
          dataDir: args.dataDir,
          eventSink: args.eventSink,
          eventOrigin: args.eventOrigin,
          filePath: dynamic.filePath,
          tempDir: dynamic.tempDir,
          allowLowLevelAccess: args.body.allowLowLevelAccess === true,
          maxExpandedImportBytes: args.maxExpandedImportBytes,
          maxFetchedAssetBytes: args.maxFetchedAssetBytes,
          maxFetchedAssetTotalBytes: args.maxFetchedAssetTotalBytes,
          signal: args.signal,
          reportProgress,
        })

        reportProgress({ phase: 'commit', message: 'Realm import complete', percent: 100 })
        return {
          revision: result.revision,
          event: result.event,
          characterId: result.extra.characterId,
        }
      } catch (err) {
        if (err instanceof LowLevelAccessImportError && args.body.allowLowLevelAccess !== true) {
          const pendingImportToken = createPendingRealmCharxImport(args.pendingCharxImports, {
            id,
            filePath: dynamic.filePath,
            tempDir: dynamic.tempDir,
          })
          shouldCleanupDynamicPayload = false
          throw new PendingLowLevelAccessImportError(pendingImportToken)
        }
        throw err
      }
    }

    throw new UnsupportedRealmDownloadError(dynamic.contentType)
  } finally {
    if (shouldCleanupDynamicPayload) {
      await cleanupRealmDynamicPayload(dynamic)
    }
  }
}

async function importRealmJsonCard(args: {
  db: DatabaseSync
  dataDir: string
  eventSink: CommandEventSink
  eventOrigin?: CommandEventOrigin
  body: RealmImportBody
  dynamicBody: unknown
  hubUrl: string
  id: string
  maxExpandedImportBytes?: number
  maxFetchedAssetBytes?: number
  maxFetchedAssetTotalBytes?: number
  signal: AbortSignal
  reportProgress: RealmImportProgressReporter
}): Promise<{ revision: number; event: unknown; characterId: string }> {
  const payload = readRecord(args.dynamicBody, 'Realm download response')
  const card = readRecord(payload.card, 'Realm download response.card')
  const data = readRecord(card.data, 'Realm download response.card.data')
  const extensions = ensureRecordField(data, 'extensions')
  const risuai = ensureRecordField(extensions, 'risuai')
  extensions.risuRealmImportId = args.id
  if (risuai.lowLevelAccess === true && args.body.allowLowLevelAccess !== true) {
    throw new LowLevelAccessImportError()
  }

  args.reportProgress({ phase: 'assets', message: 'Saving main image', percent: 35 })
  const imgResource = readNonEmptyString(payload.img, 'Realm download response.img')
  const stageDir = await fs.promises.mkdtemp(path.join(tmpdir(), FETCHED_ASSET_STAGE_PREFIX))
  const stagedAssets: StagedFetchedAsset[] = []
  const fetchedAssetBudget = createFetchedAssetBudget({
    maxExpandedImportBytes: args.maxExpandedImportBytes,
    maxFetchedAssetBytes: args.maxFetchedAssetBytes,
    maxFetchedAssetTotalBytes: args.maxFetchedAssetTotalBytes,
  })
  let nextAssetIndex = 0
  const stageAsset = async (source: RealmAssetSource): Promise<string> => {
    const staged = await stageFetchedAsset({
      source,
      hubUrl: args.hubUrl,
      signal: args.signal,
      stagePath: path.join(stageDir, `${nextAssetIndex++}.asset`),
      budget: fetchedAssetBudget,
    })
    stagedAssets.push(staged)
    return staged.id
  }

  try {
    const mainImageId = await stageAsset({
      kind: 'resource',
      id: imgResource,
      fileName: 'realm.png',
    })

    const assetProgress = createCountingAssetProgress(card, args.reportProgress, 40, 82)
    args.reportProgress({ phase: 'convert', message: 'Converting character card', percent: 40 })
    const character = await convertRealmCharacterCard(card, {
      mainImageId,
      allowLowLevelAccess: args.body.allowLowLevelAccess === true,
      storeAsset: async (source) => {
        const assetId = await stageAsset(source)
        assetProgress()
        return assetId
      },
    })

    args.reportProgress({ phase: 'assets', message: 'Saving card assets', percent: 82 })
    const assetResults = persistStagedFetchedAssets({
      db: args.db,
      dataDir: args.dataDir,
      eventSink: args.eventSink,
      assets: stagedAssets,
    })

    args.reportProgress({ phase: 'commit', message: 'Saving character', percent: 90 })
    let result: JsonCommandMutationResult<{ characterId: string }>
    try {
      result = appendRealmCharacter({
        db: args.db,
        dataDir: args.dataDir,
        eventSink: args.eventSink,
        eventOrigin: args.eventOrigin,
        character,
      })
    } catch (err) {
      try {
        cleanupCreatedAssetResults({
          db: args.db,
          dataDir: args.dataDir,
          results: assetResults,
        })
      } catch (cleanupErr) {
        emitProtocolMetric('realm_import_asset_cleanup_failed', {
          createdAssetCount: assetResults.filter((result) => result.created).length,
          error: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
        })
      }
      throw err
    }

    args.reportProgress({ phase: 'commit', message: 'Realm import complete', percent: 100 })
    return {
      revision: result.revision,
      event: result.event,
      characterId: result.extra.characterId,
    }
  } finally {
    await fs.promises.rm(stageDir, { recursive: true, force: true })
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
      write('low_level_access', lowLevelAccessResponseBody(err))
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

function lowLevelAccessResponseBody(err: LowLevelAccessImportError): JsonRecord {
  return {
    error: err.message,
    code: 'low_level_access_confirmation_required',
    ...(err instanceof PendingLowLevelAccessImportError ? { pendingImportToken: err.pendingImportToken } : {}),
  }
}

async function fetchRealmDynamicPayload(
  realmUrl: string,
  id: string,
  signal: AbortSignal,
  maxExpandedImportBytes?: number,
  maxDynamicJsonBytes?: number,
  reportDownloadProgress?: (percent: number) => void,
): Promise<RealmDynamicPayload> {
  const url = `${realmUrl}${REALM_DYNAMIC_PATH}${encodeURIComponent(id)}?cors=true`
  let res: Response
  try {
    res = await fetch(url, {
      headers: {
        'x-risu-api-version': '4',
      },
      signal,
    })
  } catch (err) {
    if (signal.aborted) throwRealmImportAbort(signal)
    throw err
  }
  if (!res.ok) {
    throw new UpstreamError(`Realm download failed: ${res.status}`, 502)
  }
  const contentType = normalizeContentType(res.headers.get('content-type'))
  if (contentType !== 'application/json') {
    return {
      contentType,
      body: null,
      ...(await writeRealmDownloadToTempFile(res, {
        maxDownloadBytes: realmCharxDownloadLimit(maxExpandedImportBytes),
        reportDownloadProgress,
        signal,
      })),
    }
  }
  const body = await readRealmDynamicJsonBody(res, {
    maxBytes: realmDynamicJsonLimit(maxDynamicJsonBytes),
    signal,
  })
  return { contentType, body }
}

async function writeRealmDownloadToTempFile(
  res: Response,
  options: {
    maxDownloadBytes: number
    reportDownloadProgress?: (percent: number) => void
    signal: AbortSignal
  },
): Promise<{ filePath: string; tempDir: string }> {
  const contentLength = readPositiveContentLength(res.headers.get('content-length'))
  if (contentLength !== null && contentLength > options.maxDownloadBytes) {
    await cancelResponseBody(res)
    throw createRealmCharxDownloadLimitError()
  }

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
        if (options.signal.aborted) {
          callback(options.signal.reason instanceof Error ? options.signal.reason : new Error())
          return
        }
        totalBytes += chunk.byteLength
        if (totalBytes > options.maxDownloadBytes) {
          callback(createRealmCharxDownloadLimitError())
          return
        }
        if (contentLength !== null) {
          options.reportDownloadProgress?.(Math.min(100, (totalBytes / contentLength) * 100))
        }
        callback(null, chunk)
      },
    })

    await pipeline(
      Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]),
      byteCounter,
      fs.createWriteStream(filePath),
    )
    throwIfRealmImportAborted(options.signal)
    return { filePath, tempDir }
  } catch (err) {
    await cancelResponseBody(res)
    await fs.promises.rm(tempDir, { recursive: true, force: true })
    if (options.signal.aborted) throwRealmImportAbort(options.signal)
    throw err
  }
}

async function readRealmDynamicJsonBody(
  res: Response,
  options: { maxBytes: number; signal: AbortSignal },
): Promise<unknown> {
  const contentLength = readPositiveContentLength(res.headers.get('content-length'))
  if (contentLength !== null && contentLength > options.maxBytes) {
    await cancelResponseBody(res)
    throw createRealmDynamicJsonLimitError()
  }

  const bytes = await readBoundedResponseBody(res, {
    maxBytes: options.maxBytes,
    signal: options.signal,
    createLimitError: createRealmDynamicJsonLimitError,
  })
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new UpstreamError('Realm download returned invalid JSON', 502)
  }
}

async function readBoundedResponseBody(
  res: Response,
  options: {
    maxBytes: number
    signal: AbortSignal
    createLimitError: () => Error
  },
): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array()
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0

  try {
    while (true) {
      throwIfRealmImportAborted(options.signal)
      const { done, value } = await reader.read()
      throwIfRealmImportAborted(options.signal)
      if (done) break
      if (!value || value.byteLength === 0) continue
      totalBytes += value.byteLength
      if (totalBytes > options.maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw options.createLimitError()
      }
      chunks.push(value)
    }
  } catch (err) {
    if (options.signal.aborted) throwRealmImportAbort(options.signal)
    throw err
  } finally {
    reader.releaseLock()
  }

  return concatBytes(chunks, totalBytes)
}

function realmCharxDownloadLimit(maxExpandedImportBytes: number | undefined): number {
  const expandedLimit =
    typeof maxExpandedImportBytes === 'number' && Number.isFinite(maxExpandedImportBytes) && maxExpandedImportBytes > 0
      ? Math.floor(maxExpandedImportBytes)
      : DEFAULT_REALM_CHARX_EXPANDED_IMPORT_BYTES
  return expandedLimit * REALM_CHARX_DOWNLOAD_CAP_MULTIPLIER
}

function realmDynamicJsonLimit(maxDynamicJsonBytes: number | undefined): number {
  return normalizePositiveInteger(maxDynamicJsonBytes, DEFAULT_REALM_DYNAMIC_JSON_BYTES)
}

function createRealmCharxDownloadLimitError(): UpstreamError {
  return new UpstreamError('Realm charx download exceeds size limit', 413)
}

function createRealmDynamicJsonLimitError(): UpstreamError {
  return new UpstreamError('Realm dynamic JSON exceeds size limit', 413)
}

async function cancelResponseBody(res: Response): Promise<void> {
  if (!res.body) return
  try {
    await res.body.cancel()
  } catch {
    // Best-effort cancellation: the caller still returns the size-limit error.
  }
}

async function cleanupRealmDynamicPayload(dynamic: RealmDynamicPayload): Promise<void> {
  if (!dynamic.tempDir) return
  await fs.promises.rm(dynamic.tempDir, { recursive: true, force: true })
}

function createPendingRealmCharxImport(
  pendingImports: PendingRealmCharxImports,
  input: { id: string; filePath: string; tempDir: string },
): string {
  let token = randomBytes(16).toString('hex')
  while (pendingImports.has(token)) {
    token = randomBytes(16).toString('hex')
  }

  const entry: PendingRealmCharxImport = {
    ...input,
    expiresAt: Date.now() + DEFAULT_PENDING_REALM_CHARX_IMPORT_TTL_MS,
    timer: setTimeout(() => {
      const pending = pendingImports.get(token)
      if (!pending) return
      pendingImports.delete(token)
      void cleanupPendingRealmCharxImport(pending)
    }, DEFAULT_PENDING_REALM_CHARX_IMPORT_TTL_MS),
  }
  entry.timer.unref?.()
  pendingImports.set(token, entry)
  return token
}

function getPendingRealmCharxImport(
  pendingImports: PendingRealmCharxImports,
  token: string,
  id: string,
): PendingRealmCharxImport | null {
  const pending = pendingImports.get(token)
  if (!pending || pending.id !== id) return null
  if (pending.expiresAt < Date.now()) {
    pendingImports.delete(token)
    void cleanupPendingRealmCharxImport(pending)
    return null
  }
  return pending
}

function takePendingRealmCharxImport(
  pendingImports: PendingRealmCharxImports,
  token: string,
): PendingRealmCharxImport | null {
  const pending = pendingImports.get(token)
  if (!pending) return null
  pendingImports.delete(token)
  clearTimeout(pending.timer)
  return pending
}

async function cleanupPendingRealmCharxImport(pending: PendingRealmCharxImport): Promise<void> {
  clearTimeout(pending.timer)
  await fs.promises.rm(pending.tempDir, { recursive: true, force: true })
}

async function cleanupPendingRealmCharxImports(pendingImports: PendingRealmCharxImports): Promise<void> {
  const pending = [...pendingImports.values()]
  pendingImports.clear()
  await Promise.all(pending.map((entry) => cleanupPendingRealmCharxImport(entry)))
}

async function importRealmCharx(args: {
  db: DatabaseSync
  dataDir: string
  eventSink: CommandEventSink
  eventOrigin?: CommandEventOrigin
  filePath: string
  tempDir: string
  allowLowLevelAccess: boolean
  maxExpandedImportBytes?: number
  maxFetchedAssetBytes?: number
  maxFetchedAssetTotalBytes?: number
  signal: AbortSignal
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

  const moduleBytes = await readCharxModule(args.filePath, args.maxExpandedImportBytes)
  const moduleMetadata = moduleBytes ? readRealmCharxModuleMetadata(moduleBytes) : null
  if (moduleMetadata) {
    mergeRealmCharxModuleMetadata(data, moduleMetadata)
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
        maxExpandedImportBytes: args.maxExpandedImportBytes,
        maxFetchedAssetBytes: args.maxFetchedAssetBytes,
        maxFetchedAssetTotalBytes: args.maxFetchedAssetTotalBytes,
        signal: args.signal,
      }),
  })
  if (moduleMetadata?.lorebook) {
    character.globalLore = repairLorebookEntries(
      cloneJson(moduleMetadata.lorebook),
      `character ${String(character.chaId)}.globalLore`,
    )
  }

  args.reportProgress?.({ phase: 'commit', message: 'Saving character', percent: 92 })
  return appendRealmCharacter({
    db: args.db,
    dataDir: args.dataDir,
    eventSink: args.eventSink,
    eventOrigin: args.eventOrigin,
    character,
  })
}

function appendRealmCharacter(args: {
  db: DatabaseSync
  dataDir: string
  eventSink: CommandEventSink
  eventOrigin?: CommandEventOrigin
  character: JsonRecord
}): JsonCommandMutationResult<{ characterId: string }> {
  const baseRevision = getSchemaState(args.db).revision
  const chatCarrier = { ...args.character } as CharacterRecord
  const chats = ensureCharacterChats(chatCarrier)
  const characterRecord = createCharacterRecord(
    {
      ...args.character,
      chats: [],
      chatFolders: chatCarrier.chatFolders,
      chatPage: chatCarrier.chatPage,
    },
    { assetDb: args.db },
  )
  return applyTargetedCommandMutation<{ characterId: string }>({
    db: args.db,
    dataDir: args.dataDir,
    baseRevision,
    eventSink: args.eventSink,
    eventOrigin: args.eventOrigin,
    mutationPath: TARGETED_MUTATION_PATHS.characterRow,
    skipDatabaseLoad: true,
    mutate(_database, innerDb) {
      if (characterRowExists(innerDb, characterRecord.chaId)) {
        throw new ValidationError(`Duplicate character id: ${characterRecord.chaId}`)
      }
      const position = nextCharacterRowPosition(innerDb)
      insertCharacterRow(innerDb, position, characterRecord)
      insertRealmCharacterChats(innerDb, characterRecord.chaId, chats)
      updateSettingsForCharacterAppend(innerDb, characterRecord.chaId, characterRecord, position + 1)
      return {
        event: { ...COMMAND_EVENT_CATALOG.characterCreated, id: characterRecord.chaId },
        extra: { characterId: characterRecord.chaId },
      }
    },
  })
}

function insertRealmCharacterChats(db: DatabaseSync, characterId: string, chats: readonly JsonRecord[]): void {
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

async function readCharxCard(filePath: string, maxExpandedBytes: number | undefined): Promise<Uint8Array> {
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

async function readCharxModule(filePath: string, maxExpandedBytes: number | undefined): Promise<Uint8Array | null> {
  let moduleBytes: Uint8Array | null = null

  await streamCharxFile(filePath, (file, setError) => {
    const chunks: Uint8Array[] = []
    let totalBytes = 0
    const shouldCollect = file.name === 'module.risum'

    file.ondata = (err, data, final) => {
      if (err) {
        setError(err)
        return
      }
      if (shouldCollect && data.byteLength > 0) {
        totalBytes += data.byteLength
        if (totalBytes > MAX_CHARX_MODULE_SIZE_BYTES || exceedsFiniteLimit(totalBytes, maxExpandedBytes)) {
          setError(new ValidationError('Realm charx module payload exceeds size limit'))
          return
        }
        chunks.push(data)
      }
      if (shouldCollect && final) {
        moduleBytes = concatBytes(chunks, totalBytes)
      }
    }
    file.start()
  })

  return moduleBytes
}

function readRealmCharxModuleMetadata(bytes: Uint8Array): RealmCharxModuleMetadata {
  let pos = 0
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)

  const readByte = (): number => {
    if (pos + 1 > buf.length) {
      throw new ValidationError('Malformed Realm charx module: unexpected end of file')
    }
    const byte = buf.readUInt8(pos)
    pos += 1
    return byte
  }
  const readLength = (): number => {
    if (pos + 4 > buf.length) {
      throw new ValidationError('Malformed Realm charx module: unexpected end of file')
    }
    const length = buf.readUInt32LE(pos)
    pos += 4
    return length
  }
  const readData = (length: number): Uint8Array => {
    if (length < 0 || pos + length > buf.length) {
      throw new ValidationError('Malformed Realm charx module: unexpected end of file')
    }
    const data = buf.subarray(pos, pos + length)
    pos += length
    return data
  }

  if (readByte() !== RISU_MODULE_MAGIC_BYTE) {
    throw new ValidationError('Malformed Realm charx module: invalid magic number')
  }
  if (readByte() !== RISU_MODULE_VERSION) {
    throw new ValidationError('Malformed Realm charx module: invalid version')
  }

  const headerLength = readLength()
  const header = parseJsonBytes(decodeRpack(readData(headerLength)), 'module.risum header')
  const headerRecord = readRecord(header, 'module.risum header')
  if (headerRecord.type !== 'risuModule') {
    throw new ValidationError('Malformed Realm charx module: invalid module type')
  }

  const module = readRecord(headerRecord.module, 'module.risum header.module')
  if (typeof module.name !== 'string' || module.name.trim() === '') {
    throw new ValidationError('Malformed Realm charx module: invalid module name')
  }
  if (typeof module.id !== 'string' || module.id.trim() === '') {
    throw new ValidationError('Malformed Realm charx module: invalid module id')
  }

  return {
    ...(Array.isArray(module.regex) ? { regex: cloneJson(module.regex) } : {}),
    ...(Array.isArray(module.trigger) ? { trigger: cloneJson(module.trigger) } : {}),
    ...(Array.isArray(module.lorebook) ? { lorebook: cloneJson(module.lorebook) } : {}),
  }
}

function mergeRealmCharxModuleMetadata(data: JsonRecord, module: RealmCharxModuleMetadata): void {
  const extensions = ensureRecordField(data, 'extensions')
  const risuai = ensureRecordField(extensions, 'risuai')
  if (module.regex) {
    risuai.customScripts = cloneJson(module.regex)
  }
  if (module.trigger) {
    risuai.triggerscript = cloneJson(module.trigger)
  }
}

function decodeRpack(data: Uint8Array): Uint8Array {
  const result = Buffer.alloc(data.byteLength)
  for (let i = 0; i < data.byteLength; i += 1) {
    result[i] = RPACK_DECODE_MAP[data[i]]
  }
  return result
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
    const shouldStage = file.name !== 'card.json' && file.name !== 'module.risum' && !file.name.endsWith('.json')
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
  throw new ValidationError(err instanceof Error ? `Malformed Realm charx: ${err.message}` : 'Malformed Realm charx')
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

async function stageFetchedAsset(args: {
  source: RealmAssetSource
  hubUrl: string
  signal: AbortSignal
  stagePath: string
  budget: FetchedAssetBudget
}): Promise<StagedFetchedAsset> {
  const contentType = resolveAssetContentType(args.source)
  if (args.source.kind === 'bytes') {
    const bytes = args.source.bytes ?? Buffer.alloc(0)
    if (bytes.length === 0) {
      throw new ValidationError('Realm asset payload is empty')
    }
    reserveFetchedAssetBytes(args.budget, bytes.length, args.source.fileName)
    await fs.promises.writeFile(args.stagePath, bytes)
    return {
      byteLength: bytes.length,
      contentType,
      filePath: args.stagePath,
      id: createHash('sha256').update(bytes).digest('hex'),
    }
  }

  const staged = await fetchHubResourceToTempFile({
    hubUrl: args.hubUrl,
    id: readRealmId(args.source.id),
    filePath: args.stagePath,
    signal: args.signal,
    budget: args.budget,
    label: args.source.fileName ?? args.source.id,
  })
  return {
    byteLength: staged.byteLength,
    contentType,
    filePath: args.stagePath,
    id: staged.id,
  }
}

function persistStagedFetchedAssets(args: {
  db: DatabaseSync
  dataDir: string
  eventSink: CommandEventSink
  assets: readonly StagedFetchedAsset[]
}): AddAssetResult[] {
  if (args.assets.length === 0) return []
  for (const asset of args.assets) {
    if (!CONTENT_TYPE_EXTENSIONS[asset.contentType]) {
      throw new ValidationError(`Unsupported content-type: ${asset.contentType}`)
    }
  }

  const createdResults: AddAssetResult[] = []
  const results: AddAssetResult[] = []
  const currentRevision = getSchemaState(args.db).revision
  const createdFiles: Array<{ file: string; existedBefore: boolean }> = []
  let transactionOpen = false

  try {
    fs.mkdirSync(assetsDir(args.dataDir), { recursive: true })
    for (const asset of args.assets) {
      const ext = CONTENT_TYPE_EXTENSIONS[asset.contentType]
      const existing = getAssetMetadataById(args.db, asset.id)
      if (existing) {
        const file = assetPath(args.dataDir, existing)
        if (!fs.existsSync(file)) {
          fs.copyFileSync(asset.filePath, file)
        }
        results.push({ entry: existing, created: false, revision: currentRevision })
        continue
      }

      const file = path.join(assetsDir(args.dataDir), `${asset.id}.${ext}`)
      const existedBefore = fs.existsSync(file)
      createdFiles.push({ file, existedBefore })
      fs.copyFileSync(asset.filePath, file)
      const entry: PersistedAsset = {
        id: asset.id,
        ext,
        size: asset.byteLength,
        contentType: asset.contentType,
      }
      const result = { entry, created: true, revision: currentRevision }
      createdResults.push(result)
      results.push(result)
    }

    if (createdResults.length === 0) {
      return results
    }

    args.db.exec('BEGIN IMMEDIATE')
    transactionOpen = true
    insertAssetMetadataBatch(
      args.db,
      createdResults.map((result) => result.entry),
    )
    const event = persistRevisionedCommandEvent(args.db, {
      ...COMMAND_EVENT_CATALOG.assetCreated,
      ...(createdResults.length === 1 ? { id: createdResults[0].entry.id } : {}),
    })
    args.db.exec('COMMIT')
    transactionOpen = false
    const eventResults = results.map((result) => ({ ...result, revision: event.revision, event }))
    emitCreatedAssetEvents(args.eventSink, eventResults)
    return eventResults
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

function cleanupCreatedAssetResults(args: {
  db: DatabaseSync
  dataDir: string
  results: readonly AddAssetResult[]
}): void {
  const created = new Map<string, PersistedAsset>()
  for (const result of args.results) {
    if (result.created) {
      created.set(result.entry.id, result.entry)
    }
  }
  if (created.size === 0) return

  let transactionOpen = false
  args.db.exec('BEGIN IMMEDIATE')
  transactionOpen = true
  try {
    deleteAssetMetadataByIds(args.db, [...created.keys()])
    args.db.exec('COMMIT')
    transactionOpen = false
  } catch (err) {
    if (transactionOpen) {
      args.db.exec('ROLLBACK')
    }
    throw err
  }

  for (const asset of created.values()) {
    fs.rmSync(assetPath(args.dataDir, asset), { force: true })
  }
}

async function saveFetchedAsset(args: {
  db: DatabaseSync
  dataDir: string
  eventSink: CommandEventSink
  source: RealmAssetSource
  hubUrl: string
  maxExpandedImportBytes?: number
  maxFetchedAssetBytes?: number
  maxFetchedAssetTotalBytes?: number
  signal: AbortSignal
}): Promise<string> {
  if (args.source.kind === 'bytes') {
    const bytes = args.source.bytes ?? Buffer.alloc(0)
    if (bytes.length === 0) {
      throw new ValidationError('Realm asset payload is empty')
    }
    const contentType = resolveAssetContentType(args.source)
    const result = addAsset(args.db, args.dataDir, { bytes, contentType })
    emitAssetEvent(args.eventSink, result)
    return result.entry.id
  }

  const stageDir = await fs.promises.mkdtemp(path.join(tmpdir(), FETCHED_ASSET_STAGE_PREFIX))
  try {
    const staged = await stageFetchedAsset({
      source: args.source,
      hubUrl: args.hubUrl,
      signal: args.signal,
      stagePath: path.join(stageDir, '0.asset'),
      budget: createFetchedAssetBudget({
        maxExpandedImportBytes: args.maxExpandedImportBytes,
        maxFetchedAssetBytes: args.maxFetchedAssetBytes,
        maxFetchedAssetTotalBytes: args.maxFetchedAssetTotalBytes,
      }),
    })
    const results = persistStagedFetchedAssets({
      db: args.db,
      dataDir: args.dataDir,
      eventSink: args.eventSink,
      assets: [staged],
    })
    return results[0].entry.id
  } finally {
    await fs.promises.rm(stageDir, { recursive: true, force: true })
  }
}

async function fetchHubResourceToTempFile(args: {
  hubUrl: string
  id: string
  filePath: string
  signal: AbortSignal
  budget: FetchedAssetBudget
  label?: string
}): Promise<{ byteLength: number; id: string }> {
  let res: Response
  try {
    res = await fetch(`${args.hubUrl}/resource/${encodeURIComponent(args.id)}`, {
      signal: args.signal,
    })
  } catch (err) {
    if (args.signal.aborted) throwRealmImportAbort(args.signal)
    throw err
  }
  if (!res.ok) {
    throw new UpstreamError(`Realm resource ${args.id} failed: ${res.status}`, 502)
  }

  const contentLength = readPositiveContentLength(res.headers.get('content-length'))
  if (contentLength !== null) {
    if (contentLength > args.budget.maxAssetBytes) {
      await cancelResponseBody(res)
      throw createFetchedAssetTooLargeError(args.label)
    }
    if (args.budget.totalBytes + contentLength > args.budget.maxTotalBytes) {
      await cancelResponseBody(res)
      throw createFetchedAssetTotalLimitError()
    }
  }

  const hash = createHash('sha256')
  let totalBytes = 0

  try {
    if (!res.body) {
      await fs.promises.writeFile(args.filePath, Buffer.alloc(0))
    } else {
      const byteCounter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          if (args.signal.aborted) {
            callback(args.signal.reason instanceof Error ? args.signal.reason : new Error())
            return
          }
          totalBytes += chunk.byteLength
          if (totalBytes > args.budget.maxAssetBytes) {
            callback(createFetchedAssetTooLargeError(args.label))
            return
          }
          if (args.budget.totalBytes + totalBytes > args.budget.maxTotalBytes) {
            callback(createFetchedAssetTotalLimitError())
            return
          }
          hash.update(chunk)
          callback(null, chunk)
        },
      })
      await pipeline(
        Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]),
        byteCounter,
        fs.createWriteStream(args.filePath),
      )
    }
    throwIfRealmImportAborted(args.signal)
    if (totalBytes === 0) {
      throw new ValidationError('Realm asset payload is empty')
    }
    args.budget.totalBytes += totalBytes
    return { byteLength: totalBytes, id: hash.digest('hex') }
  } catch (err) {
    await cancelResponseBody(res)
    await fs.promises.rm(args.filePath, { force: true })
    if (args.signal.aborted) throwRealmImportAbort(args.signal)
    throw err
  }
}

function createFetchedAssetBudget(args: {
  maxExpandedImportBytes?: number
  maxFetchedAssetBytes?: number
  maxFetchedAssetTotalBytes?: number
}): FetchedAssetBudget {
  const maxTotalBytes = normalizePositiveInteger(
    args.maxFetchedAssetTotalBytes,
    normalizePositiveInteger(args.maxExpandedImportBytes, DEFAULT_REALM_CHARX_EXPANDED_IMPORT_BYTES),
  )
  return {
    maxAssetBytes: normalizePositiveInteger(args.maxFetchedAssetBytes, MAX_CHARX_ASSET_SIZE_BYTES),
    maxTotalBytes,
    totalBytes: 0,
  }
}

function reserveFetchedAssetBytes(budget: FetchedAssetBudget, byteLength: number, label?: string): void {
  if (byteLength > budget.maxAssetBytes) {
    throw createFetchedAssetTooLargeError(label)
  }
  if (budget.totalBytes + byteLength > budget.maxTotalBytes) {
    throw createFetchedAssetTotalLimitError()
  }
  budget.totalBytes += byteLength
}

function createFetchedAssetTooLargeError(label: string | undefined): ValidationError {
  return new ValidationError(label ? `Realm fetched asset too large: ${label}` : 'Realm fetched asset too large')
}

function createFetchedAssetTotalLimitError(): ValidationError {
  return new ValidationError('Realm fetched assets exceed size limit')
}

function emitAssetEvent(eventSink: CommandEventSink, result: AddAssetResult): void {
  if (!result.created) return
  if (result.event) {
    eventSink.emit(result.event)
  }
}

function emitCreatedAssetEvents(eventSink: CommandEventSink, results: readonly AddAssetResult[]): void {
  const event = results.find((result) => result.event)?.event
  if (event) {
    eventSink.emit(event)
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

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

function throwIfRealmImportAborted(signal: AbortSignal): void {
  if (signal.aborted) throwRealmImportAbort(signal)
}

function throwRealmImportAbort(signal: AbortSignal): never {
  if (signal.reason instanceof Error) {
    throw signal.reason
  }
  throw new UpstreamError('Realm import aborted', 499)
}

function scaleProgress(percent: number, start: number, end: number): number {
  const clamped = Math.max(0, Math.min(100, percent))
  return start + ((end - start) * clamped) / 100
}

function createMonotonicProgressReporter(reportProgress?: RealmImportProgressReporter): RealmImportProgressReporter {
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

function readOptionalToken(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
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

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
