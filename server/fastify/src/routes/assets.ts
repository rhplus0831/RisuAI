import fs from 'node:fs'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import { type AuthState, hasPassword, verifyAssertion } from '../auth.js'
import { extractRisuAuth } from '../http.js'
import {
  ValidationError,
  addAsset,
  assetById,
  assetPath,
  isValidAssetId,
  missingAssetIds,
} from '../repository.js'

const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable'

interface ExistsBody {
  ids?: unknown
}

async function requireAuth(
  state: AuthState,
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<boolean> {
  if (!hasPassword(state)) return true
  const token = extractRisuAuth(req)
  if (!token) {
    reply.code(401).send({ error: 'Auth required' })
    return false
  }
  const result = await verifyAssertion(state, token)
  if (!result.ok) {
    reply.code(401).send({ error: 'Auth required' })
    return false
  }
  return true
}

function applyAssetHeaders(reply: FastifyReply, contentType: string, size: number): void {
  reply.header('content-type', contentType)
  reply.header('cache-control', IMMUTABLE_CACHE)
  reply.header('content-length', String(size))
}

export function registerAssetsRoutes(
  app: FastifyInstance,
  db: DatabaseSync,
  authState: AuthState,
  dataDir: string,
): void {
  app.post('/api/v1/assets', async (req, reply) => {
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
  })

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
