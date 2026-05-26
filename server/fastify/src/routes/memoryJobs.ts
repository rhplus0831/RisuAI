import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import type { AuthState } from '../auth.js'
import { requireAuth } from '../http.js'
import {
  MEMORY_JOB_KINDS,
  MEMORY_JOB_STATUSES,
  cancelMemoryJob,
  enqueueMemoryJob,
  getMemoryJob,
  listMemoryJobs,
  type MemoryJobKind,
  type MemoryJobStatus,
} from '../memoryRepository.js'
import {
  buildMemoryJobEvent,
  emitMemoryEventSafely,
  type MemoryEventSink,
} from '../memoryEvents.js'
import { ValidationError } from '../repository.js'

interface CreateMemoryJobBody {
  chatId?: unknown
  kind?: unknown
  payload?: unknown
  maxAttempts?: unknown
  nextRunAt?: unknown
}

interface ListMemoryJobsQuery {
  chatId?: unknown
  kind?: unknown
  status?: unknown
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isMemoryJobKind(value: unknown): value is MemoryJobKind {
  return typeof value === 'string' && (MEMORY_JOB_KINDS as readonly string[]).includes(value)
}

function isMemoryJobStatus(value: unknown): value is MemoryJobStatus {
  return typeof value === 'string' && (MEMORY_JOB_STATUSES as readonly string[]).includes(value)
}

function activeJobCount(db: DatabaseSync, chatId: string): number {
  return listMemoryJobs(db, { chatId, statuses: ['pending', 'running'] }).length
}

function emitRouteJobEvent(
  db: DatabaseSync,
  onEvent: MemoryEventSink | undefined,
  jobId: string,
): void {
  if (!onEvent) return
  const job = getMemoryJob(db, jobId)
  if (!job) return
  emitMemoryEventSafely(
    onEvent,
    buildMemoryJobEvent(job, {
      includeHypaV3Progress: true,
      queuedCount: activeJobCount(db, job.chatId),
    }),
  )
}

function badRequest(error: string): { error: string } {
  return { error }
}

export function registerMemoryJobRoutes(
  app: FastifyInstance,
  db: DatabaseSync,
  authState: AuthState,
  options: { onEvent?: MemoryEventSink } = {},
): void {
  app.post('/api/v1/memory/jobs', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return
    const body = (req.body ?? {}) as CreateMemoryJobBody
    if (!isObject(body)) {
      reply.code(400)
      return badRequest('body must be an object')
    }
    if (!isNonEmptyString(body.chatId)) {
      reply.code(400)
      return badRequest('chatId must be a non-empty string')
    }
    if (!isMemoryJobKind(body.kind)) {
      reply.code(400)
      return badRequest('kind must be one of: chunk, embed, summarize')
    }
    const maxAttempts = body.maxAttempts
    if (
      maxAttempts !== undefined &&
      (typeof maxAttempts !== 'number' || !Number.isInteger(maxAttempts) || maxAttempts <= 0)
    ) {
      reply.code(400)
      return badRequest('maxAttempts must be a positive integer when provided')
    }
    if (body.nextRunAt !== undefined) {
      if (typeof body.nextRunAt !== 'string' || Number.isNaN(Date.parse(body.nextRunAt))) {
        reply.code(400)
        return badRequest('nextRunAt must be a valid timestamp when provided')
      }
    }

    try {
      const job = enqueueMemoryJob(db, {
        id: randomUUID(),
        chatId: body.chatId,
        kind: body.kind,
        payload: body.payload ?? {},
        maxAttempts: typeof maxAttempts === 'number' ? maxAttempts : undefined,
        nextRunAt: typeof body.nextRunAt === 'string' ? body.nextRunAt : undefined,
      })
      emitRouteJobEvent(db, options.onEvent, job.id)
      reply.code(201)
      return { job }
    } catch (err) {
      if (err instanceof ValidationError) {
        reply.code(400)
        return badRequest(err.message)
      }
      throw err
    }
  })

  app.get<{ Querystring: ListMemoryJobsQuery }>('/api/v1/memory/jobs', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return
    const query = req.query
    if (query.chatId !== undefined && !isNonEmptyString(query.chatId)) {
      reply.code(400)
      return badRequest('chatId must be a non-empty string when provided')
    }
    if (query.kind !== undefined && !isMemoryJobKind(query.kind)) {
      reply.code(400)
      return badRequest('kind must be one of: chunk, embed, summarize')
    }
    if (query.status !== undefined && !isMemoryJobStatus(query.status)) {
      reply.code(400)
      return badRequest('status must be one of: pending, running, completed, failed, cancelled')
    }

    const jobs = listMemoryJobs(db, {
      chatId: typeof query.chatId === 'string' ? query.chatId : undefined,
      kind: isMemoryJobKind(query.kind) ? query.kind : undefined,
      status: isMemoryJobStatus(query.status) ? query.status : undefined,
      statuses: query.status === undefined ? ['pending', 'running'] : undefined,
    })
    return { jobs }
  })

  app.delete<{ Params: { id: string } }>('/api/v1/memory/jobs/:id', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return
    const job = cancelMemoryJob(db, req.params.id)
    if (!job) {
      reply.code(404)
      return { error: 'memory job not found or not cancellable' }
    }
    emitRouteJobEvent(db, options.onEvent, job.id)
    return { job }
  })
}
