import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

export const ACTIVE_WRITER_SESSION_HEADER = 'risu-writer-session'

export interface ActiveWriterState {
  sessionId: string | null
}

export function createActiveWriterState(): ActiveWriterState {
  return { sessionId: null }
}

export function registerActiveWriterSession(state: ActiveWriterState, req: FastifyRequest): void {
  const sessionId = readActiveWriterSessionId(req)
  if (sessionId !== null) {
    state.sessionId = sessionId
  }
}

export function registerActiveWriterGuard(app: FastifyInstance, state: ActiveWriterState): void {
  app.addHook('preHandler', async (req, reply) => {
    if (!isServerOwnedMutation(req)) return
    if (isActiveWriter(state, req)) return
    sendStaleWriterReply(reply)
  })
}

function isActiveWriter(state: ActiveWriterState, req: FastifyRequest): boolean {
  if (state.sessionId === null) return true
  return readActiveWriterSessionId(req) === state.sessionId
}

function readActiveWriterSessionId(req: FastifyRequest): string | null {
  const raw = req.headers[ACTIVE_WRITER_SESSION_HEADER]
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value !== 'string') return null
  const sessionId = value.trim()
  if (sessionId.length === 0 || sessionId.length > 128) return null
  return sessionId
}

function sendStaleWriterReply(reply: FastifyReply): void {
  reply.code(423).send({
    error: 'active_writer_stale',
    reason: 'A newer browser session is now the active writer. Reload this session before saving.',
  })
}

function isServerOwnedMutation(req: FastifyRequest): boolean {
  const method = req.method.toUpperCase()
  if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) return false

  const path = req.url.split('?')[0] ?? req.url
  if (path.startsWith('/api/v1/commands/')) return true
  if (method === 'POST' && path === '/api/v1/import/risusave') return true
  if (method === 'POST' && path === '/api/v1/assets') return true
  if (path.startsWith('/api/v1/backups')) return true
  if (method === 'POST' && path === '/api/v1/generate/chat') return true
  if (method === 'POST' && path === '/api/v1/generate/preview-prompt') return true
  if (method === 'POST' && path === '/api/v1/memory/jobs') return true
  if (method === 'DELETE' && path.startsWith('/api/v1/memory/jobs/')) return true
  return (
    method === 'POST' && (path === '/api/v1/storage/write' || path === '/api/v1/storage/remove')
  )
}
