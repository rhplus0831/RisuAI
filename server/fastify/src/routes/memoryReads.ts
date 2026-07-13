import type { FastifyInstance } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import type { AuthState } from '../auth.js'
import { requireAuth } from '../http.js'
import {
  deleteMemorySummary,
  getMemorySummary,
  listMemoryChunks,
  listMemorySummaries,
  updateMemorySummary,
} from '../memoryRepository.js'
import { ValidationError } from '../repository.js'

const PREFER_RETURN_MINIMAL = 'return=minimal'

interface MemoryReadParams {
  chatId: string
}

interface ListMemorySummariesQuery {
  model?: unknown
}

interface UpdateMemorySummaryBody {
  text?: unknown
  isImportant?: unknown
  categoryId?: unknown
  tags?: unknown
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function badRequest(error: string): { error: string } {
  return { error }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function prefersMinimalResponse(prefer: string | string[] | undefined): boolean {
  const preferences = Array.isArray(prefer) ? prefer : [prefer]
  return preferences.some((header) =>
    header
      ?.split(',')
      .some((preference) => preference.trim().split(';', 1)[0]?.toLowerCase() === PREFER_RETURN_MINIMAL),
  )
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

  app.patch<{ Params: { summaryId: string }; Body: UpdateMemorySummaryBody }>(
    '/api/v1/memory/summaries/:summaryId',
    async (req, reply) => {
      if (!(await requireAuth(authState, req, reply))) return
      if (!isNonEmptyString(req.params.summaryId)) {
        reply.code(400)
        return badRequest('summaryId must be a non-empty string')
      }
      if (!isObject(req.body)) {
        reply.code(400)
        return badRequest('body must be an object')
      }

      const allowedKeys = new Set(['text', 'isImportant', 'categoryId', 'tags'])
      const unexpectedKey = Object.keys(req.body).find((key) => !allowedKeys.has(key))
      if (unexpectedKey) {
        reply.code(400)
        return badRequest(`unsupported memory summary field: ${unexpectedKey}`)
      }
      if (!Object.keys(req.body).some((key) => allowedKeys.has(key))) {
        reply.code(400)
        return badRequest('memory summary update must include at least one field')
      }
      if (hasOwn(req.body, 'text') && typeof req.body.text !== 'string') {
        reply.code(400)
        return badRequest('text must be a string when provided')
      }
      if (hasOwn(req.body, 'isImportant') && typeof req.body.isImportant !== 'boolean') {
        reply.code(400)
        return badRequest('isImportant must be a boolean when provided')
      }
      if (hasOwn(req.body, 'categoryId') && req.body.categoryId !== null && typeof req.body.categoryId !== 'string') {
        reply.code(400)
        return badRequest('categoryId must be a string or null when provided')
      }
      let normalizedTags: string[] | null | undefined
      if (hasOwn(req.body, 'tags')) {
        const tags = req.body.tags
        if (tags !== null && (!Array.isArray(tags) || !tags.every((tag: unknown) => typeof tag === 'string'))) {
          reply.code(400)
          return badRequest('tags must be an array of strings or null when provided')
        }
        normalizedTags =
          tags === null
            ? null
            : [...new Set((tags as string[]).map((tag) => tag.trim()).filter((tag) => tag.length > 0))]
      }

      const existing = getMemorySummary(db, req.params.summaryId)
      if (!existing) {
        reply.code(404)
        return badRequest('memory summary not found')
      }

      const metadataPatchRequested = ['isImportant', 'categoryId', 'tags'].some((key) => hasOwn(req.body, key))
      const metadata = isObject(existing.metadata) ? { ...existing.metadata } : {}
      if (hasOwn(req.body, 'isImportant')) metadata.isImportant = req.body.isImportant
      if (hasOwn(req.body, 'categoryId')) {
        if (req.body.categoryId === null || req.body.categoryId === '') delete metadata.categoryId
        else metadata.categoryId = req.body.categoryId
      }
      if (hasOwn(req.body, 'tags')) {
        if (normalizedTags === null) {
          delete metadata.tags
        } else {
          metadata.tags = normalizedTags
        }
      }

      try {
        const summary = updateMemorySummary(db, req.params.summaryId, {
          ...(typeof req.body.text === 'string' ? { text: req.body.text, tokens: 0 } : {}),
          ...(metadataPatchRequested ? { metadata } : {}),
        })
        if (prefersMinimalResponse(req.headers.prefer)) {
          reply.header('preference-applied', PREFER_RETURN_MINIMAL)
          return { summaryId: req.params.summaryId }
        }
        return { summary }
      } catch (error) {
        if (error instanceof ValidationError) {
          reply.code(400)
          return badRequest(error.message)
        }
        throw error
      }
    },
  )

  app.delete<{ Params: { summaryId: string } }>('/api/v1/memory/summaries/:summaryId', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return
    if (!isNonEmptyString(req.params.summaryId)) {
      reply.code(400)
      return badRequest('summaryId must be a non-empty string')
    }
    const summary = deleteMemorySummary(db, req.params.summaryId)
    if (!summary) {
      reply.code(404)
      return badRequest('memory summary not found')
    }
    if (prefersMinimalResponse(req.headers.prefer)) {
      reply.header('preference-applied', PREFER_RETURN_MINIMAL)
      return { summaryId: summary.id }
    }
    return { summary }
  })
}
