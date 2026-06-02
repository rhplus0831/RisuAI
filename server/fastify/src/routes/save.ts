import type { FastifyInstance } from 'fastify'
import type { FastifyRequest } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import type { AuthState } from '../auth.js'
import { COMMAND_EVENT_CATALOG, type CommandEventSink } from '../commands/events.js'
import { getSchemaState } from '../db.js'
import { requireAuth } from '../http.js'
import { ValidationError, applyImport, loadPersistedWithMessages } from '../repository.js'
import { replaceLegacyHypaV3MemoryRowsInTransaction } from '../memoryLegacyImport.js'
import {
  decodeRisuSaveImportSnapshot,
  normalizeRisuSaveImportDatabase,
} from '../risuSave/importSnapshot.js'
import {
  buildRepositoryRisuSaveExportSnapshot,
  buildRisuSaveExportSnapshotFromPersisted,
  encodeRisuSaveBlockExportSnapshot,
  encodeRisuSaveLegacyExportSnapshot,
  type RisuSaveExportSnapshot,
} from '../risuSave/exportSnapshot.js'
import { buildRepositoryRisuSaveBundleExport } from '../risuSave/bundleExport.js'
import {
  buildRepositoryRisuSaveAssetReport,
  summarizeRisuSaveAssetReport,
} from '../risuSave/assetReferences.js'
import type { LegacyRisuSaveEnvelopeKind } from '../risuSave/legacyEnvelopeCodec.js'
import { importRateLimit } from '../routeRateLimits.js'
import {
  emitProtocolMetric,
  protocolDurationMs,
  protocolMetricsEnabled,
  protocolNowMs,
} from '../protocolMetrics.js'

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

export function registerSaveRoutes(
  app: FastifyInstance,
  db: DatabaseSync,
  authState: AuthState,
  dataDir: string,
  eventSink: CommandEventSink,
  options: { maxExpandedImportBytes?: number } = {},
): void {
  app.post(
    '/api/v1/import/risusave',
    { config: { rateLimit: importRateLimit } },
    async (req, reply) => {
      if (!(await requireAuth(authState, req, reply))) return
      try {
        if (req.isMultipart()) {
          const snapshot = decodeRisuSaveImportSnapshot(await readUploadedRisuSave(req), {
            maxExpandedBytes: options.maxExpandedImportBytes,
          })
          const { revision, event, assetReport } = applyImportedDatabase(
            db,
            dataDir,
            snapshot.database,
          )
          eventSink.emit(event)
          return {
            revision,
            event,
            envelope: snapshot.envelope,
            importReport: {
              unsupportedReferenceCount: snapshot.unsupportedReferences.length,
              unsupportedReferences: snapshot.unsupportedReferences,
            },
            assetReport,
          }
        }

        const body = (req.body ?? {}) as ImportBody
        const database = normalizeRisuSaveImportDatabase(body.database)
        const { revision, event, assetReport } = applyImportedDatabase(db, dataDir, database)
        eventSink.emit(event)
        return { revision, event, assetReport }
      } catch (err) {
        if (err instanceof ValidationError) {
          reply.code(400)
          return { error: err.message }
        }
        throw err
      }
    },
  )

  app.get<{ Querystring: ExportQuery }>(
    '/api/v1/export/risusave',
    { exposeHeadRoute: false },
    async (req, reply) => {
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
    },
  )

  app.get<{ Querystring: ExportQuery }>(
    '/api/v1/export/bundle',
    { exposeHeadRoute: false },
    async (req, reply) => {
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
        return reply.send(bundle.stream)
      } catch (err) {
        if (err instanceof ValidationError) {
          reply.code(400)
          return { error: err.message }
        }
        throw err
      }
    },
  )
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

function applyImportedDatabase(
  db: DatabaseSync,
  dataDir: string,
  database: unknown,
): {
  revision: number
  event: ReturnType<typeof applyImport>['event']
  assetReport: ReturnType<typeof summarizeRisuSaveAssetReport>
} {
  const result = applyImport(db, dataDir, database, {
    beforeRevision: () => replaceLegacyHypaV3MemoryRowsInTransaction(db, database),
  })
  return {
    ...result,
    assetReport: summarizeRisuSaveAssetReport(buildRepositoryRisuSaveAssetReport(dataDir, db)),
  }
}
