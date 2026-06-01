import fs from 'node:fs'
import type { FastifyInstance, FastifyReply } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import type { AuthState } from '../auth.js'
import { getSchemaState } from '../db.js'
import { requireAuth } from '../http.js'
import { type CommandEventSink } from '../commands/events.js'
import {
  ValidationError,
  addAsset,
  addAssets,
  assetById,
  assetPath,
  isValidAssetId,
  missingAssetIds,
  type AddAssetResult,
} from '../repository.js'
import { assetBulkUploadRateLimit, assetUploadRateLimit } from '../routeRateLimits.js'

const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable'
const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

interface ExistsBody {
  ids?: unknown
}

interface BulkAssetsBody {
  assets?: unknown
}

function applyAssetHeaders(reply: FastifyReply, contentType: string, size: number): void {
  reply.header('content-type', contentType)
  reply.header('cache-control', IMMUTABLE_CACHE)
  reply.header('content-length', String(size))
}

function assetUploadResponse(result: AddAssetResult): {
  assetId: string
  size: number
  contentType: string
  revision: number
  created: boolean
} {
  return {
    assetId: result.entry.id,
    size: result.entry.size,
    contentType: result.entry.contentType,
    revision: result.revision,
    created: result.created,
  }
}

function emitCreatedAssetEvents(
  eventSink: CommandEventSink,
  results: readonly AddAssetResult[],
): void {
  const event = results.find((result) => result.event)?.event
  if (event) {
    eventSink.emit(event)
  }
}

function readBulkAssets(body: BulkAssetsBody): { bytes: Buffer; contentType: string }[] {
  if (!Array.isArray(body.assets)) {
    throw new ValidationError('assets: { contentType: string; data: base64 }[] required')
  }
  return body.assets.map((asset, index) => {
    if (!asset || typeof asset !== 'object') {
      throw new ValidationError(`assets[${index}] must be an object`)
    }
    const record = asset as Record<string, unknown>
    if (typeof record.contentType !== 'string') {
      throw new ValidationError(`assets[${index}].contentType must be a string`)
    }
    if (typeof record.data !== 'string' || !BASE64_RE.test(record.data)) {
      throw new ValidationError(`assets[${index}].data must be base64`)
    }
    return {
      contentType: record.contentType,
      bytes: Buffer.from(record.data, 'base64'),
    }
  })
}

export function registerAssetsRoutes(
  app: FastifyInstance,
  db: DatabaseSync,
  authState: AuthState,
  dataDir: string,
  eventSink: CommandEventSink,
): void {
  app.post(
    '/api/v1/assets',
    { config: { rateLimit: assetUploadRateLimit } },
    async (req, reply) => {
      if (!(await requireAuth(authState, req, reply))) return
      const contentType = req.headers['content-type']
      if (typeof contentType !== 'string') {
        reply.code(400)
        return { error: 'Content-Type header required' }
      }
      if (!Buffer.isBuffer(req.body)) {
        reply.code(400)
        return { error: 'Body must be raw bytes of a supported asset type' }
      }
      try {
        const result = addAsset(db, dataDir, { bytes: req.body, contentType })
        // A new asset bumps the repository revision; emit so SSE subscribers
        // refresh and the uploading client can advance its cached revision,
        // avoiding a stale-revision 409 on the next command.
        emitCreatedAssetEvents(eventSink, [result])
        reply.code(result.created ? 201 : 200)
        return {
          assetId: result.entry.id,
          size: result.entry.size,
          contentType: result.entry.contentType,
          revision: result.revision,
        }
      } catch (err) {
        if (err instanceof ValidationError) {
          reply.code(400)
          return { error: err.message }
        }
        throw err
      }
    },
  )

  app.post(
    '/api/v1/assets/bulk',
    { config: { rateLimit: assetBulkUploadRateLimit } },
    async (req, reply) => {
      if (!(await requireAuth(authState, req, reply))) return
      try {
        const uploads = readBulkAssets((req.body ?? {}) as BulkAssetsBody)
        const results = addAssets(db, dataDir, uploads)
        emitCreatedAssetEvents(eventSink, results)
        reply.code(results.some((result) => result.created) ? 201 : 200)
        const revision = results.at(-1)?.revision ?? getSchemaState(db).revision
        return {
          assets: results.map(assetUploadResponse),
          revision,
        }
      } catch (err) {
        if (err instanceof ValidationError) {
          reply.code(400)
          return { error: err.message }
        }
        throw err
      }
    },
  )

  app.get<{ Params: { id: string } }>(
    '/api/v1/assets/:id',
    { exposeHeadRoute: false },
    async (req, reply) => {
      const entry = assetById(dataDir, req.params.id)
      if (!entry) {
        reply.code(404).send({ error: 'not found' })
        return
      }
      const file = assetPath(dataDir, entry)
      if (!fs.existsSync(file)) {
        reply.code(404).send({ error: 'not found' })
        return
      }
      applyAssetHeaders(reply, entry.contentType, entry.size)
      return reply.send(fs.createReadStream(file))
    },
  )

  app.head<{ Params: { id: string } }>('/api/v1/assets/:id', async (req, reply) => {
    const entry = assetById(dataDir, req.params.id)
    if (!entry) {
      reply.code(404).send()
      return
    }
    const file = assetPath(dataDir, entry)
    if (!fs.existsSync(file)) {
      reply.code(404).send()
      return
    }
    applyAssetHeaders(reply, entry.contentType, entry.size)
    reply.code(200).send()
  })

  app.post('/api/v1/assets/exists', async (req, reply) => {
    const body = (req.body ?? {}) as ExistsBody
    if (!Array.isArray(body.ids)) {
      reply.code(400)
      return { error: 'ids: string[] required' }
    }
    const validIds: string[] = []
    for (const id of body.ids) {
      if (typeof id !== 'string' || !isValidAssetId(id)) {
        reply.code(400)
        return { error: 'ids must be sha256 hex strings' }
      }
      validIds.push(id)
    }
    return { missing: missingAssetIds(dataDir, validIds) }
  })
}
