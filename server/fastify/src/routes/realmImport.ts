import type { FastifyInstance } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import * as fflate from 'fflate'
import type { AuthState } from '../auth.js'
import { requireAuth } from '../http.js'
import { getSchemaState } from '../db.js'
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
  CONTENT_TYPE_EXTENSIONS,
  type AddAssetResult,
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
const EXTENSION_CONTENT_TYPES = Object.fromEntries(
  Object.entries(CONTENT_TYPE_EXTENSIONS).map(([contentType, ext]) => [ext, contentType]),
) as Record<string, string>
EXTENSION_CONTENT_TYPES.jpeg = 'image/jpeg'

interface RealmImportBody {
  id?: unknown
  baseRevision?: unknown
  allowLowLevelAccess?: unknown
}

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

      if (CHARX_CONTENT_TYPES.has(dynamic.contentType)) {
        const result = await importRealmCharx({
          db,
          dataDir,
          eventSink,
          bytes: dynamic.bytes,
          allowLowLevelAccess: body.allowLowLevelAccess === true,
        })

        return {
          revision: result.revision,
          event: result.event,
          characterId: result.extra.characterId,
        }
      }

      {
        reply.code(415)
        return {
          error: `Unsupported Realm download content-type: ${dynamic.contentType}`,
          code: 'unsupported_realm_download',
        }
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
): Promise<{ contentType: string; body: unknown; bytes: Buffer }> {
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
    return { contentType, body: null, bytes: Buffer.from(await res.arrayBuffer()) }
  }
  let body: unknown
  try {
    body = await res.json()
  } catch {
    throw new UpstreamError('Realm download returned invalid JSON', 502)
  }
  return { contentType, body, bytes: Buffer.alloc(0) }
}

async function importRealmCharx(args: {
  db: DatabaseSync
  dataDir: string
  eventSink: CommandEventSink
  bytes: Buffer
  allowLowLevelAccess: boolean
}): Promise<JsonCommandMutationResult<{ characterId: string }>> {
  const files = unzipCharx(args.bytes)
  const cardBytes = files['card.json']
  if (!cardBytes) {
    throw new ValidationError('Realm charx must include card.json')
  }
  const card = parseJsonBytes(cardBytes, 'card.json')
  const data = readRecord(readRecord(card, 'card').data, 'card.data')
  const extensions = readOptionalRecord(data.extensions)
  const risuai = readOptionalRecord(extensions?.risuai)
  if (risuai?.lowLevelAccess === true && !args.allowLowLevelAccess) {
    throw new LowLevelAccessImportError()
  }

  const assetDict: Record<string, string> = {}
  for (const [fileName, bytes] of Object.entries(files)) {
    if (fileName === 'card.json' || fileName === 'module.risum' || fileName.endsWith('.json')) {
      continue
    }
    if (bytes.byteLength > MAX_CHARX_ASSET_SIZE_BYTES) {
      throw new ValidationError(`Realm charx asset too large: ${fileName}`)
    }
    assetDict[fileName] = await saveFetchedAsset({
      db: args.db,
      dataDir: args.dataDir,
      eventSink: args.eventSink,
      source: { kind: 'bytes', bytes: Buffer.from(bytes), fileName },
      hubUrl: '',
    })
  }

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

function unzipCharx(bytes: Buffer): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {}
  let parseError: Error | null = null

  try {
    const unzip = new fflate.Unzip()
    unzip.register(fflate.UnzipInflate)
    unzip.onfile = (file) => {
      const chunks: Uint8Array[] = []
      let totalBytes = 0

      file.ondata = (err, data, final) => {
        if (err) {
          parseError = err
          return
        }
        if (data.byteLength > 0) {
          totalBytes += data.byteLength
          chunks.push(data)
        }
        if (final) {
          files[file.name] = concatBytes(chunks, totalBytes)
        }
      }
      file.start()
    }
    unzip.push(new Uint8Array(bytes), true)
    if (parseError) throw parseError
    return files
  } catch (err) {
    throw new ValidationError(
      err instanceof Error ? `Malformed Realm charx: ${err.message}` : 'Malformed Realm charx',
    )
  }
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
