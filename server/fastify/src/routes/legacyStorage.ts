import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { AuthState } from '../auth.js'
import { requireAuth } from '../http.js'

const HEX_RE = /^[0-9a-fA-F]+$/

function isHexFilename(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && HEX_RE.test(value)
}

function ensureSaveDir(dataDir: string): string {
  const savePath = path.join(dataDir, 'save')
  fs.mkdirSync(savePath, { recursive: true })
  return savePath
}

interface CryptoBody {
  data?: unknown
}

export function registerLegacyStorageRoutes(
  app: FastifyInstance,
  authState: AuthState,
  dataDir: string,
): void {
  app.register(async (instance) => {
    instance.removeAllContentTypeParsers()
    instance.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, done) => {
      done(null, body)
    })

    instance.get('/api/v1/storage/list', async (req, reply) => {
      if (!(await requireAuth(authState, req, reply))) return
      const savePath = ensureSaveDir(dataDir)
      const entries = await fs.promises.readdir(savePath)
      const content = entries
        .filter((name) => HEX_RE.test(name))
        .map((name) => Buffer.from(name, 'hex').toString('utf-8'))
      return { success: true, content }
    })

    instance.get('/api/v1/storage/read', async (req, reply) => {
      if (!(await requireAuth(authState, req, reply))) return
      const raw = req.headers['file-path']
      const filePath = Array.isArray(raw) ? raw[0] : raw
      if (!filePath) {
        reply.code(400)
        return { error: 'File path required' }
      }
      if (!isHexFilename(filePath)) {
        reply.code(400)
        return { error: 'Invalid path' }
      }
      const savePath = ensureSaveDir(dataDir)
      const onDisk = path.join(savePath, filePath)
      if (!fs.existsSync(onDisk)) {
        reply.header('content-type', 'application/octet-stream')
        return reply.send()
      }
      reply.header('content-type', 'application/octet-stream')
      return reply.send(fs.createReadStream(onDisk))
    })

    instance.post('/api/v1/storage/write', async (req, reply) => {
      if (!(await requireAuth(authState, req, reply))) return
      const raw = req.headers['file-path']
      const filePath = Array.isArray(raw) ? raw[0] : raw
      if (!filePath) {
        reply.code(400)
        return { error: 'File path required' }
      }
      if (!isHexFilename(filePath)) {
        reply.code(400)
        return { error: 'Invalid path' }
      }
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        reply.code(400)
        return { error: 'Body required' }
      }
      const savePath = ensureSaveDir(dataDir)
      await fs.promises.writeFile(path.join(savePath, filePath), req.body)
      return { success: true }
    })

    instance.post('/api/v1/storage/remove', async (req, reply) => {
      if (!(await requireAuth(authState, req, reply))) return
      const raw = req.headers['file-path']
      const header = Array.isArray(raw) ? raw[0] : raw
      if (!header) {
        reply.code(400)
        return { error: 'File path required' }
      }
      const filePaths = header.split('$$').filter((p) => p.length > 0)
      for (const filePath of filePaths) {
        if (!isHexFilename(filePath)) {
          reply.code(400)
          return { error: 'Invalid path' }
        }
      }
      const savePath = ensureSaveDir(dataDir)
      for (const filePath of filePaths) {
        const onDisk = path.join(savePath, filePath)
        try {
          await fs.promises.rm(onDisk, { force: true })
        } catch (err) {
          req.log.warn({ err, filePath }, 'storage remove failed')
        }
      }
      return { success: true }
    })
  })

  app.post('/api/v1/auth/crypto', async (req, reply) => {
    const body = (req.body ?? {}) as CryptoBody
    if (typeof body.data !== 'string') {
      reply.code(400)
      return { error: 'data: string required' }
    }
    const hash = createHash('sha256')
    hash.update(Buffer.from(body.data, 'utf-8'))
    return hash.digest('hex')
  })
}
