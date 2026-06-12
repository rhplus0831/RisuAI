import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { FastifyInstance } from 'fastify'
import type { FastifyRequest } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import type { AuthState } from '../auth.js'
import { COMMAND_EVENT_CATALOG, type CommandEventSink } from '../commands/events.js'
import { getSchemaState } from '../db.js'
import { requireAuth } from '../http.js'
import {
  ValidationError,
  addAssets,
  applyImport,
  assetPath,
  getAllAssetMetadata,
  loadPersistedWithMessages,
  type Persisted,
} from '../repository.js'
import { replaceLegacyHypaV3MemoryRowsInTransaction } from '../memoryLegacyImport.js'
import { decodeRisuSaveImportSnapshot, normalizeRisuSaveImportDatabase } from '../risuSave/importSnapshot.js'
import { decodeLocalBackup } from '../risuSave/localBackupImport.js'
import {
  buildRepositoryRisuSaveExportSnapshot,
  buildRisuSaveExportSnapshotFromPersisted,
  encodeRisuSaveBlockExportSnapshot,
  encodeRisuSaveLegacyExportSnapshot,
  type RisuSaveExportSnapshot,
} from '../risuSave/exportSnapshot.js'
import { buildRepositoryRisuSaveBundleExport } from '../risuSave/bundleExport.js'
import { buildRepositoryRisuLocalBackupExport } from '../risuSave/localBackupExport.js'
import {
  buildRisuSaveAssetReport,
  buildRepositoryRisuSaveAssetReport,
  summarizeRisuSaveAssetReport,
} from '../risuSave/assetReferences.js'
import type { LegacyRisuSaveEnvelopeKind } from '../risuSave/legacyEnvelopeCodec.js'
import { importRateLimit } from '../routeRateLimits.js'
import { emitProtocolMetric, protocolDurationMs, protocolMetricsEnabled, protocolNowMs } from '../protocolMetrics.js'

interface ImportBody {
  database?: unknown
}

type ExportEnvelope = LegacyRisuSaveEnvelopeKind | 'risusave-blocks'

interface ExportQuery {
  envelope?: unknown
  compression?: unknown
}

const EXPORT_FILENAME = 'database.risu'
const BUNDLE_EXPORT_FILENAME = 'database.risu.zip'
const LOCAL_BACKUP_EXPORT_FILENAME = 'database.bin'
const ESTIMATED_BACKUP_BYTES_HEADER = 'x-risu-estimated-backup-bytes'
const LOCAL_BACKUP_DATABASE_ENVELOPE = 'legacy-compressed'
const SQLITE_EXPORT_ESTIMATE_FILE = 'risu.db'
// Unlimited by default: the upload streams to a temp file and decodes in bounded
// batches, so size is constrained by disk, not memory. A finite ceiling is opt-in
// via RISU_API_IMPORT_MAX_BYTES (see config.ts).
const DEFAULT_IMPORT_MAX_BYTES = Number.POSITIVE_INFINITY
// Backstop for the bundle's inner `database.risu` when neither the import
// ceiling nor the expanded-import cap is finite (audit M9): unlike the asset
// entries, the inner `.risu` inflates fully in memory before decoding, so it
// always needs a finite expanded-size cap.
const DEFAULT_BUNDLE_INNER_RISU_MAX_EXPANDED_BYTES = 1024 * 1024 * 1024

export function registerSaveRoutes(
  app: FastifyInstance,
  db: DatabaseSync,
  authState: AuthState,
  dataDir: string,
  eventSink: CommandEventSink,
  options: { maxExpandedImportBytes?: number; importMaxBytes?: number } = {},
): void {
  const importMaxBytes = options.importMaxBytes ?? DEFAULT_IMPORT_MAX_BYTES
  // The bundle's embedded `database.risu` gets a finite expanded-size cap even
  // when the bundle import as a whole is unlimited (audit M9): the explicit
  // import ceiling when set, else the same expanded cap the ordinary
  // `/import/risusave` route enforces, else a 1 GiB backstop.
  const bundleInnerRisuMaxExpandedBytes = Number.isFinite(importMaxBytes)
    ? importMaxBytes
    : (options.maxExpandedImportBytes ?? DEFAULT_BUNDLE_INNER_RISU_MAX_EXPANDED_BYTES)
  app.post('/api/v1/import/risusave', { config: { rateLimit: importRateLimit } }, async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return
    try {
      if (req.isMultipart()) {
        const snapshot = decodeRisuSaveImportSnapshot(await readUploadedRisuSave(req), {
          maxExpandedBytes: options.maxExpandedImportBytes,
        })
        const { revision, event, assetReport } = applyImportedDatabase(db, dataDir, snapshot.database)
        eventSink.emit(event)
        return {
          revision,
          event,
          envelope: snapshot.envelope,
          importReport: {
            incompleteChatCount: snapshot.incompleteChatCount,
            unsupportedReferenceCount: snapshot.unsupportedReferences.length,
            unsupportedReferences: snapshot.unsupportedReferences,
          },
          assetReport,
        }
      }

      const body = (req.body ?? {}) as ImportBody
      const database = normalizeRisuSaveImportDatabase(body.database)
      // `normalizeRisuSaveImportDatabase` returns a request-body-isolated
      // throwaway object for JSON bodies, so the repository can split
      // message rows in place without a second full-corpus clone.
      const { revision, event, assetReport } = applyImportedDatabase(db, dataDir, database, {
        cloneBeforeMessageSplit: false,
      })
      eventSink.emit(event)
      return { revision, event, assetReport }
    } catch (err) {
      if (err instanceof ValidationError) {
        reply.code(400)
        return { error: err.message }
      }
      throw err
    }
  })

  app.post('/api/v1/import/bundle', { config: { rateLimit: importRateLimit } }, async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return
    if (!req.isMultipart()) {
      reply.code(400)
      return { error: 'backup import requires a multipart .risu.zip or .bin upload' }
    }

    let uploadPath: string | null = null
    try {
      // Stream the (potentially very large) upload to a temp file instead of
      // buffering it in memory, then stream-decode it; assets register in
      // bounded batches as they are read.
      uploadPath = await streamUploadToTempFile(req, importMaxBytes)

      let assetCreated = false
      const decoded = await decodeLocalBackup(uploadPath, {
        maxExpandedBytes: importMaxBytes,
        registerAssets: (assets) => {
          // Asset ids are content-addressed; `applyImport` (below) preserves
          // the asset metadata it sees, so registering before the database
          // makes the imported references resolve immediately. Re-registering
          // bytes that already exist is idempotent.
          const results = addAssets(db, dataDir, assets)
          const event = results.find((result) => result.event)?.event
          if (event) {
            eventSink.emit(event)
            assetCreated = true
          }
        },
      })

      const snapshot = decodeRisuSaveImportSnapshot(decoded.databaseBytes, {
        maxExpandedBytes: bundleInnerRisuMaxExpandedBytes,
      })
      const { revision, event, assetReport } = applyImportedDatabase(db, dataDir, snapshot.database)
      eventSink.emit(event)
      return {
        revision,
        event,
        format: decoded.format,
        envelope: snapshot.envelope,
        importReport: {
          incompleteChatCount: snapshot.incompleteChatCount,
          unsupportedReferenceCount: snapshot.unsupportedReferences.length,
          unsupportedReferences: snapshot.unsupportedReferences,
        },
        assetReport,
        bundleReport: {
          includedAssetCount: decoded.registeredAssetCount,
          assetsCreated: assetCreated,
        },
      }
    } catch (err) {
      if (err instanceof ValidationError) {
        reply.code(400)
        return { error: err.message }
      }
      throw err
    } finally {
      if (uploadPath) {
        await fs.promises.rm(path.dirname(uploadPath), { recursive: true, force: true }).catch(() => {})
      }
    }
  })

  app.get<{ Querystring: ExportQuery }>('/api/v1/export/risusave', { exposeHeadRoute: false }, async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return
    try {
      const exportOptions = parseExportQuery(req.query)
      // Split the snapshot hydration from the encode/output-buffer step so the
      // opt-in metric can attribute ordinary `.risu` materialization cost. The
      // snapshot→encode path is byte-identical to the prior combined call.
      const measure = protocolMetricsEnabled()
      const snapshotStart = measure ? protocolNowMs() : 0
      const snapshot = buildRepositoryRisuSaveExportSnapshot(db, dataDir)
      const snapshotLoadMs = measure ? protocolDurationMs(snapshotStart) : undefined
      const encodeStart = measure ? protocolNowMs() : 0
      const bytes = encodeRisuSaveExportSnapshot(snapshot, exportOptions)
      const encodeMs = measure ? protocolDurationMs(encodeStart) : undefined
      emitRisuSaveExportMetric(req.log, {
        bundle: false,
        envelope: exportOptions.envelope,
        compression: exportOptions.compression,
        snapshotLoadMs,
        encodeMs,
        outputBytes: bytes.byteLength,
      })
      eventSink.emit({
        ...COMMAND_EVENT_CATALOG.stateExported,
        revision: getSchemaState(db).revision,
      })
      reply.header('content-type', 'application/octet-stream')
      reply.header('content-disposition', `attachment; filename="${EXPORT_FILENAME}"`)
      return reply.send(Buffer.from(bytes))
    } catch (err) {
      if (err instanceof ValidationError) {
        reply.code(400)
        return { error: err.message }
      }
      throw err
    }
  })

  app.get<{ Querystring: ExportQuery }>('/api/v1/export/bundle', { exposeHeadRoute: false }, async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return
    try {
      const exportOptions = parseExportQuery(req.query)
      // Bundle export still materializes the embedded `.risu` bytes before
      // streaming the asset entries; measure that materialization the same way
      // as ordinary export. Asset streaming and the shared snapshot are
      // unchanged.
      const measure = protocolMetricsEnabled()
      const snapshotStart = measure ? protocolNowMs() : 0
      const persisted = loadPersistedWithMessages(db, dataDir)
      persisted.assets = getAllAssetMetadata(db)
      const estimatedBackupBytes = estimateDeviceBackupBytes(dataDir, persisted)
      const snapshot = buildRisuSaveExportSnapshotFromPersisted(persisted)
      const snapshotLoadMs = measure ? protocolDurationMs(snapshotStart) : undefined
      const encodeStart = measure ? protocolNowMs() : 0
      const risuBytes = encodeRisuSaveExportSnapshot(snapshot, exportOptions)
      const encodeMs = measure ? protocolDurationMs(encodeStart) : undefined
      emitRisuSaveExportMetric(req.log, {
        bundle: true,
        envelope: exportOptions.envelope,
        compression: exportOptions.compression,
        snapshotLoadMs,
        encodeMs,
        outputBytes: risuBytes.byteLength,
      })
      const bundle = buildRepositoryRisuSaveBundleExport({
        dataDir,
        persisted,
        risuBytes,
        envelope: exportOptions.envelope,
        compression: exportOptions.compression,
      })
      eventSink.emit({
        ...COMMAND_EVENT_CATALOG.stateExported,
        revision: getSchemaState(db).revision,
      })
      reply.header('content-type', 'application/zip')
      reply.header('content-disposition', `attachment; filename="${BUNDLE_EXPORT_FILENAME}"`)
      reply.header(ESTIMATED_BACKUP_BYTES_HEADER, String(estimatedBackupBytes))
      return reply.send(bundle.stream)
    } catch (err) {
      if (err instanceof ValidationError) {
        reply.code(400)
        return { error: err.message }
      }
      throw err
    }
  })

  app.get('/api/v1/export/local-backup', { exposeHeadRoute: false }, async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return
    try {
      // The original Risu local backup file is a `.bin` record stream whose
      // database record is named `database.risudat` and carries a legacy-
      // compressed `.risu` payload.
      const measure = protocolMetricsEnabled()
      const snapshotStart = measure ? protocolNowMs() : 0
      const persisted = loadPersistedWithMessages(db, dataDir)
      persisted.assets = getAllAssetMetadata(db)
      const estimatedBackupBytes = estimateDeviceBackupBytes(dataDir, persisted)
      const snapshot = buildRisuSaveExportSnapshotFromPersisted(persisted)
      const snapshotLoadMs = measure ? protocolDurationMs(snapshotStart) : undefined
      const encodeStart = measure ? protocolNowMs() : 0
      const risuBytes = encodeRisuSaveLegacyExportSnapshot(snapshot, LOCAL_BACKUP_DATABASE_ENVELOPE)
      const encodeMs = measure ? protocolDurationMs(encodeStart) : undefined
      emitRisuSaveExportMetric(req.log, {
        bundle: true,
        envelope: LOCAL_BACKUP_DATABASE_ENVELOPE,
        compression: false,
        snapshotLoadMs,
        encodeMs,
        outputBytes: risuBytes.byteLength,
      })
      const localBackup = buildRepositoryRisuLocalBackupExport({
        dataDir,
        persisted,
        databaseBytes: risuBytes,
        envelope: LOCAL_BACKUP_DATABASE_ENVELOPE,
      })
      eventSink.emit({
        ...COMMAND_EVENT_CATALOG.stateExported,
        revision: getSchemaState(db).revision,
      })
      reply.header('content-type', 'application/octet-stream')
      reply.header('content-disposition', `attachment; filename="${LOCAL_BACKUP_EXPORT_FILENAME}"`)
      reply.header(ESTIMATED_BACKUP_BYTES_HEADER, String(estimatedBackupBytes))
      return reply.send(localBackup.stream)
    } catch (err) {
      if (err instanceof ValidationError) {
        reply.code(400)
        return { error: err.message }
      }
      throw err
    }
  })
}

function estimateDeviceBackupBytes(dataDir: string, persisted: Persisted): number {
  return estimateSqliteFootprintBytes(dataDir) + estimateReferencedAssetBytes(dataDir, persisted)
}

function estimateSqliteFootprintBytes(dataDir: string): number {
  return safeFileSize(path.join(dataDir, SQLITE_EXPORT_ESTIMATE_FILE))
}

function estimateReferencedAssetBytes(dataDir: string, persisted: Persisted): number {
  const report = buildRisuSaveAssetReport(persisted.database, persisted.assets)
  const assetsById = new Map(persisted.assets.map((asset) => [asset.id, asset]))
  let total = 0

  for (const reference of report.referenced) {
    const asset = assetsById.get(reference.id)
    if (!asset) continue
    if (safeFileSize(assetPath(dataDir, asset)) === 0) continue
    total += asset.size
  }

  return total
}

function safeFileSize(filePath: string): number {
  try {
    const stat = fs.statSync(filePath)
    return stat.isFile() ? stat.size : 0
  } catch {
    return 0
  }
}

function emitRisuSaveExportMetric(
  logger: FastifyInstance['log'],
  fields: {
    bundle: boolean
    envelope: ExportEnvelope
    compression: boolean
    snapshotLoadMs?: number
    encodeMs?: number
    outputBytes: number
  },
): void {
  emitProtocolMetric(
    'risusave_export',
    {
      bundle: fields.bundle,
      envelope: fields.envelope,
      compression: fields.compression,
      ...(fields.snapshotLoadMs !== undefined ? { snapshotLoadMs: fields.snapshotLoadMs } : {}),
      ...(fields.encodeMs !== undefined ? { encodeMs: fields.encodeMs } : {}),
      outputBytes: fields.outputBytes,
    },
    logger,
  )
}

function encodeRisuSaveExportSnapshot(
  snapshot: RisuSaveExportSnapshot,
  options: ReturnType<typeof parseExportQuery>,
): Uint8Array {
  return options.envelope === 'risusave-blocks'
    ? encodeRisuSaveBlockExportSnapshot(snapshot, { compression: options.compression })
    : encodeRisuSaveLegacyExportSnapshot(snapshot, options.envelope)
}

function parseExportQuery(query: ExportQuery): {
  envelope: ExportEnvelope
  compression: boolean
} {
  const envelope = readExportEnvelope(query.envelope)
  const compression = readOptionalBoolean(query.compression, 'compression') ?? false
  if (envelope !== 'risusave-blocks' && query.compression !== undefined) {
    throw new ValidationError('compression is only supported for risusave-blocks exports')
  }
  return { envelope, compression }
}

function readExportEnvelope(value: unknown): ExportEnvelope {
  if (value === undefined) return 'risusave-blocks'
  if (
    value === 'risusave-blocks' ||
    value === 'legacy-raw' ||
    value === 'legacy-compressed' ||
    value === 'legacy-stream'
  ) {
    return value
  }
  throw new ValidationError('envelope must be risusave-blocks or a legacy .risu envelope')
}

function readOptionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined
  if (value === true || value === 'true') return true
  if (value === false || value === 'false') return false
  throw new ValidationError(`${label} must be true or false`)
}

async function readUploadedRisuSave(req: FastifyRequest): Promise<Uint8Array> {
  const file = await req.file()
  if (!file) {
    throw new ValidationError('risusave file missing')
  }
  const bytes = await file.toBuffer()
  if (bytes.length === 0) {
    throw new ValidationError('risusave file is empty')
  }
  return bytes
}

/**
 * Stream the uploaded multipart file to a temp file under a per-route size
 * limit (decoupled from the global body limit so large backups are accepted),
 * returning its path. The caller is responsible for removing the temp dir.
 */
async function streamUploadToTempFile(req: FastifyRequest, maxBytes: number): Promise<string> {
  const file = await req.file({ limits: { fileSize: maxBytes } })
  if (!file) {
    throw new ValidationError('backup file missing')
  }
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'risu-import-'))
  const target = path.join(dir, 'upload')
  try {
    await pipeline(file.file, fs.createWriteStream(target))
  } catch (err) {
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {})
    throw err
  }
  if (file.file.truncated) {
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {})
    throw new ValidationError('backup upload exceeds size limit')
  }
  if ((await fs.promises.stat(target)).size === 0) {
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {})
    throw new ValidationError('backup file is empty')
  }
  return target
}

function applyImportedDatabase(
  db: DatabaseSync,
  dataDir: string,
  database: unknown,
  options: { cloneBeforeMessageSplit?: boolean } = {},
): {
  revision: number
  event: ReturnType<typeof applyImport>['event']
  assetReport: ReturnType<typeof summarizeRisuSaveAssetReport>
} {
  const result = applyImport(db, dataDir, database, {
    cloneBeforeMessageSplit: options.cloneBeforeMessageSplit,
    beforeRevision: () => replaceLegacyHypaV3MemoryRowsInTransaction(db, database),
  })
  return {
    ...result,
    assetReport: summarizeRisuSaveAssetReport(buildRepositoryRisuSaveAssetReport(dataDir, db)),
  }
}
