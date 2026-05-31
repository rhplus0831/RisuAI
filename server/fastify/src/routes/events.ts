import type { DatabaseSync } from 'node:sqlite'
import type { FastifyInstance } from 'fastify'
import type { AuthState } from '../auth.js'
import {
  selectCommandEventReplay,
  type CommandEvent,
  type CommandEventSink,
} from '../commands/events.js'
import { getSchemaState } from '../db.js'
import { requireAuth } from '../http.js'
import type { MemoryEvent, MemoryEventBus } from '../memoryEvents.js'
import { emitProtocolMetric } from '../protocolMetrics.js'

function writeSseComment(raw: NodeJS.WritableStream, comment: string): void {
  raw.write(`: ${comment}\n\n`)
}

function writeCommandEvent(raw: NodeJS.WritableStream, event: CommandEvent): void {
  raw.write(`id: ${event.revision}\nevent: command\ndata: ${JSON.stringify(event)}\n\n`)
}

function writeMemoryEvent(raw: NodeJS.WritableStream, event: MemoryEvent): void {
  raw.write(`event: memory\ndata: ${JSON.stringify(event)}\n\n`)
}

export function registerEventsRoutes(
  app: FastifyInstance,
  db: DatabaseSync,
  authState: AuthState,
  commandEvents: CommandEventSink,
  memoryEvents: MemoryEventBus,
): void {
  app.get('/api/v1/events', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    const cursor = readReplayCursor(req.query, req.headers['last-event-id'])
    if (cursor.status === 'error') {
      reply.code(400).send({
        error: 'invalid_event_replay_cursor',
        reason: cursor.reason,
      })
      return
    }

    const currentRevision = getSchemaState(db).revision
    const history = commandEvents.list()
    const replay =
      cursor.sinceRevision === null
        ? { status: 'ok' as const, events: [] as readonly CommandEvent[] }
        : selectCommandEventReplay(history, cursor.sinceRevision, currentRevision)

    if (replay.status === 'unavailable') {
      emitProtocolMetric(
        'event_replay',
        {
          status: 'unavailable',
          requestedRevision: cursor.sinceRevision,
          currentRevision: replay.currentRevision,
          oldestRevision: replay.oldestRevision,
          latestRevision: replay.latestRevision,
        },
        req.log,
      )
      reply.code(409).send({
        error: 'event_replay_unavailable',
        requestedRevision: cursor.sinceRevision,
        currentRevision: replay.currentRevision,
        ...(replay.oldestRevision !== undefined ? { oldestRevision: replay.oldestRevision } : {}),
        ...(replay.latestRevision !== undefined ? { latestRevision: replay.latestRevision } : {}),
      })
      return
    }
    emitProtocolMetric(
      'event_replay',
      {
        status: 'ok',
        requestedRevision: cursor.sinceRevision,
        currentRevision,
        replayedEventCount: replay.events.length,
        oldestRevision: history[0]?.revision,
        latestRevision: history.at(-1)?.revision,
      },
      req.log,
    )

    reply.hijack()
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    })
    writeSseComment(reply.raw, 'connected')
    for (const event of replay.events) {
      if (!reply.raw.writableEnded) {
        writeCommandEvent(reply.raw, event)
      }
    }

    const heartbeat = setInterval(() => {
      if (!reply.raw.writableEnded) {
        writeSseComment(reply.raw, 'heartbeat')
      }
    }, 25_000)
    heartbeat.unref()

    const unsubscribeCommand = commandEvents.subscribe((event) => {
      if (!reply.raw.writableEnded) {
        writeCommandEvent(reply.raw, event)
      }
    })
    const unsubscribeMemory = memoryEvents.subscribe((event) => {
      if (!reply.raw.writableEnded) {
        writeMemoryEvent(reply.raw, event)
      }
    })

    const cleanup = (): void => {
      clearInterval(heartbeat)
      unsubscribeCommand()
      unsubscribeMemory()
    }

    req.raw.once('close', cleanup)
  })
}

type ReplayCursorResult =
  | { status: 'ok'; sinceRevision: number | null }
  | { status: 'error'; reason: string }

function readReplayCursor(query: unknown, lastEventIdHeader: unknown): ReplayCursorResult {
  const queryValue = readQuerySinceRevision(query)
  if (queryValue !== undefined) {
    return parseCursorValue(queryValue, 'sinceRevision')
  }

  const headerValue = Array.isArray(lastEventIdHeader) ? lastEventIdHeader[0] : lastEventIdHeader
  if (headerValue !== undefined) {
    return parseCursorValue(headerValue, 'Last-Event-ID')
  }

  return { status: 'ok', sinceRevision: null }
}

function readQuerySinceRevision(query: unknown): unknown {
  if (!query || typeof query !== 'object') return undefined
  const value = (query as { sinceRevision?: unknown }).sinceRevision
  return Array.isArray(value) ? value[0] : value
}

function parseCursorValue(value: unknown, label: string): ReplayCursorResult {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return { status: 'error', reason: `${label} must be a non-negative integer` }
  }
  const text = String(value).trim()
  if (!/^\d+$/.test(text)) {
    return { status: 'error', reason: `${label} must be a non-negative integer` }
  }
  const revision = Number(text)
  if (!Number.isSafeInteger(revision)) {
    return { status: 'error', reason: `${label} must be a safe integer` }
  }
  return { status: 'ok', sinceRevision: revision }
}
