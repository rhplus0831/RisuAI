import type { FastifyInstance } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import type { AuthState } from '../auth.js'
import { requireAuth } from '../http.js'
import { listMemoryChunks, listMemorySummaries } from '../memoryRepository.js'

interface MemoryReadParams {
  chatId: string
}

interface ListMemorySummariesQuery {
  model?: unknown
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function badRequest(error: string): { error: string } {
  return { error }
}

export function registerMemoryReadRoutes(app: FastifyInstance, db: DatabaseSync, authState: AuthState): void {
  app.get<{ Params: MemoryReadParams }>('/api/v1/memory/chunks/:chatId', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return
    if (!isNonEmptyString(req.params.chatId)) {
      reply.code(400)
      return badRequest('chatId must be a non-empty string')
    }

    return { chunks: listMemoryChunks(db, { chatId: req.params.chatId }) }
  })

  app.get<{ Params: MemoryReadParams; Querystring: ListMemorySummariesQuery }>(
    '/api/v1/memory/summaries/:chatId',
    async (req, reply) => {
      if (!(await requireAuth(authState, req, reply))) return
      if (!isNonEmptyString(req.params.chatId)) {
        reply.code(400)
        return badRequest('chatId must be a non-empty string')
      }
      if (req.query.model !== undefined && !isNonEmptyString(req.query.model)) {
        reply.code(400)
        return badRequest('model must be a non-empty string when provided')
      }

      return {
        summaries: listMemorySummaries(db, {
          chatId: req.params.chatId,
          model: typeof req.query.model === 'string' ? req.query.model : undefined,
        }),
      }
    },
  )
}
