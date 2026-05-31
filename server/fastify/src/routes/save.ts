import type { FastifyInstance } from 'fastify'
import type { FastifyRequest } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import type { AuthState } from '../auth.js'
import { COMMAND_EVENT_CATALOG, type CommandEventSink } from '../commands/events.js'
import { getSchemaState } from '../db.js'
import { requireAuth } from '../http.js'
import { ValidationError, applyImport } from '../repository.js'
import { replaceLegacyHypaV3MemoryRows } from '../memoryLegacyImport.js'
import {
  decodeRisuSaveImportSnapshot,
  normalizeRisuSaveImportDatabase,
} from '../risuSave/importSnapshot.js'
import {
  encodeRepositoryRisuSaveBlockExport,
  encodeRepositoryRisuSaveLegacyExport,
} from '../risuSave/exportSnapshot.js'
import { buildRepositoryRisuSaveBundleExport } from '../risuSave/bundleExport.js'
import {
  buildRepositoryRisuSaveAssetReport,
  summarizeRisuSaveAssetReport,
} from '../risuSave/assetReferences.js'
import type { LegacyRisuSaveEnvelopeKind } from '../risuSave/legacyEnvelopeCodec.js'

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
): void {
  app.post('/api/v1/import/risusave', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return
    try {
      if (req.isMultipart()) {
        const snapshot = decodeRisuSaveImportSnapshot(await readUploadedRisuSave(req))
        const { revision, assetReport } = applyImportedDatabase(db, dataDir, snapshot.database)
        const event = { ...COMMAND_EVENT_CATALOG.stateImported, revision }
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
      const { revision, assetReport } = applyImportedDatabase(db, dataDir, database)
      const event = { ...COMMAND_EVENT_CATALOG.stateImported, revision }
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

  app.get<{ Querystring: ExportQuery }>('/api/v1/export/risusave', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return
    try {
      const options = parseExportQuery(req.query)
      const bytes = encodeRepositoryRisuSaveExport(db, dataDir, options)
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

  app.get<{ Querystring: ExportQuery }>('/api/v1/export/bundle', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return
    try {
      const options = parseExportQuery(req.query)
      const risuBytes = encodeRepositoryRisuSaveExport(db, dataDir, options)
      const bundle = buildRepositoryRisuSaveBundleExport({
        db,
        dataDir,
        risuBytes,
        envelope: options.envelope,
        compression: options.compression,
      })
      eventSink.emit({
        ...COMMAND_EVENT_CATALOG.stateExported,
        revision: getSchemaState(db).revision,
      })
      reply.header('content-type', 'application/zip')
      reply.header('content-disposition', `attachment; filename="${BUNDLE_EXPORT_FILENAME}"`)
      return reply.send(Buffer.from(bundle.bytes))
    } catch (err) {
      if (err instanceof ValidationError) {
        reply.code(400)
        return { error: err.message }
      }
      throw err
    }
  })
}

function encodeRepositoryRisuSaveExport(
  db: DatabaseSync,
  dataDir: string,
  options: ReturnType<typeof parseExportQuery>,
): Uint8Array {
  return options.envelope === 'risusave-blocks'
    ? encodeRepositoryRisuSaveBlockExport(db, dataDir, { compression: options.compression })
    : encodeRepositoryRisuSaveLegacyExport(db, dataDir, options.envelope)
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
): { revision: number; assetReport: ReturnType<typeof summarizeRisuSaveAssetReport> } {
  const result = applyImport(db, dataDir, database)
  replaceLegacyHypaV3MemoryRows(db, database)
  return {
    ...result,
    assetReport: summarizeRisuSaveAssetReport(buildRepositoryRisuSaveAssetReport(dataDir, db)),
  }
}
