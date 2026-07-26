import type { FastifyInstance } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import type { AuthState } from '../auth.js'
import { requireAuth } from '../http.js'
import { loadSettingsFromSqlite } from '../repository.js'
import {
  deleteRequestHistoryRecord,
  getRequestHistoryRecord,
  listRequestHistory,
  normalizeRequestHistoryLimit,
  pruneRequestHistory,
} from '../requestHistory.js'

function configuredLimit(db: DatabaseSync): number {
  return normalizeRequestHistoryLimit(loadSettingsFromSqlite(db)?.requestHistoryLimit)
}

function historyId(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 ? value : null
}

export function registerRequestHistoryRoutes(app: FastifyInstance, db: DatabaseSync, authState: AuthState): void {
  app.get('/api/v1/request-history', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return
    reply.header('cache-control', 'no-store')
    const limit = configuredLimit(db)
    return { limit, records: listRequestHistory(db, limit) }
  })

  app.get<{ Params: { id: string } }>('/api/v1/request-history/:id', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return
    reply.header('cache-control', 'no-store')
    const id = historyId(req.params.id)
    if (!id) {
      reply.code(400)
      return { error: 'invalid request history id' }
    }
    pruneRequestHistory(db, configuredLimit(db))
    const record = getRequestHistoryRecord(db, id)
    if (!record) {
      reply.code(404)
      return { error: 'request history record not found' }
    }
    return { record }
  })

  app.delete<{ Params: { id: string } }>('/api/v1/request-history/:id', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return
    const id = historyId(req.params.id)
    if (!id) {
      reply.code(400)
      return { error: 'invalid request history id' }
    }
    if (!deleteRequestHistoryRecord(db, id)) {
      reply.code(404)
      return { error: 'request history record not found' }
    }
    return { id }
  })
}
