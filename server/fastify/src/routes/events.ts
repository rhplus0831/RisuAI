import type { DatabaseSync } from 'node:sqlite'
import type { FastifyInstance } from 'fastify'
import type { AuthState } from '../auth.js'
import {
  listPersistedCommandEventHistory,
  selectCommandEventReplay,
  type CommandEvent,
  type CommandEventSink,
} from '../commands/events.js'
import { getSchemaState } from '../db.js'
import { requireAuth } from '../http.js'
import type { MemoryEvent, MemoryEventBus } from '../memoryEvents.js'
import { emitProtocolMetric, protocolMetricsEnabled } from '../protocolMetrics.js'
import { writeBoundedRaw } from '../streamBackpressure.js'

function formatSseComment(comment: string): string {
  return `: ${comment}\n\n`
}

function formatCommandEvent(event: CommandEvent): string {
  return `id: ${event.revision}\nevent: command\ndata: ${JSON.stringify(event)}\n\n`
}

function formatMemoryEvent(event: MemoryEvent): string {
  return `event: memory\ndata: ${JSON.stringify(event)}\n\n`
}

export function registerEventsRoutes(
  app: FastifyInstance,
  db: DatabaseSync,
  authState: AuthState,
  commandEvents: CommandEventSink,
  memoryEvents: MemoryEventBus,
): void {
  app.get('/api/v1/events', { exposeHeadRoute: false }, async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    const cursor = readReplayCursor(req.query, req.headers['last-event-id'])
    if (cursor.status === 'error') {
      reply.code(400).send({
        error: 'invalid_event_replay_cursor',
        reason: cursor.reason,
      })
      return
    }

    let liveCommandDelivery = false
    const queuedCommandEvents: CommandEvent[] = []
    let heartbeat: NodeJS.Timeout | null = null
    let unsubscribeCommand: (() => void) | null = null
    let unsubscribeMemory: (() => void) | null = null
    let cleanedUp = false
    const cleanup = (): void => {
      if (cleanedUp) return
      cleanedUp = true
      if (heartbeat) {
        clearInterval(heartbeat)
      }
      unsubscribeCommand?.()
      unsubscribeMemory?.()
    }
    const sendFrame = (text: string): boolean => writeBoundedRaw(reply.raw, text, { onOverflow: cleanup })
    unsubscribeCommand = commandEvents.subscribe((event) => {
      if (liveCommandDelivery) {
        if (!reply.raw.writableEnded) {
          sendFrame(formatCommandEvent(event))
        }
        return
      }
      queuedCommandEvents.push(event)
    })
    req.raw.once('close', cleanup)

    const currentRevision = getSchemaState(db).revision
    // The full history read+map exists for replay — and for the opt-in
    // replay metric's oldest/latest fields, so metric output stays identical
    // when metrics are on. A fresh no-replay connect in the default config
    // must not pay it (audit L10).
    const history =
      cursor.sinceRevision !== null || protocolMetricsEnabled()
        ? listPersistedCommandEventHistory(db)
        : ([] as readonly CommandEvent[])
    const replay =
      cursor.sinceRevision === null
        ? { status: 'ok' as const, events: [] as readonly CommandEvent[] }
        : selectCommandEventReplay(history, cursor.sinceRevision, currentRevision)

    if (replay.status === 'unavailable') {
      cleanup()
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
    sendFrame(formatSseComment('connected'))
    for (const event of replay.events) {
      if (!reply.raw.writableEnded) {
        sendFrame(formatCommandEvent(event))
      }
    }
    for (const event of queuedCommandEvents) {
      if (!reply.raw.writableEnded && (cursor.sinceRevision === null || event.revision > currentRevision)) {
        sendFrame(formatCommandEvent(event))
      }
    }
    queuedCommandEvents.length = 0
    liveCommandDelivery = true

    const armed = armSseLiveDelivery({
      tornDown: () => cleanedUp,
      startHeartbeat: () =>
        setInterval(() => {
          if (!reply.raw.writableEnded) {
            sendFrame(formatSseComment('heartbeat'))
          }
        }, 25_000),
      subscribeMemory: () =>
        memoryEvents.subscribe((event) => {
          if (!reply.raw.writableEnded) {
            sendFrame(formatMemoryEvent(event))
          }
        }),
    })
    heartbeat = armed.heartbeat
    unsubscribeMemory = armed.unsubscribeMemory
  })
}

/**
 * Arm the live-delivery legs (heartbeat interval + memory-event fanout) after
 * the replay flush. When the flush itself tore the stream down — a
 * slow-consumer overflow runs `cleanup` mid-handler via `writeBoundedRaw`'s
 * `onOverflow` — arming anyway would leak both forever: `cleanup` already ran
 * and its `cleanedUp` latch keeps it from ever running again (audit L11).
 * Exported for the regression test.
 */
export function armSseLiveDelivery(args: {
  tornDown: () => boolean
  startHeartbeat: () => NodeJS.Timeout
  subscribeMemory: () => () => void
}): { heartbeat: NodeJS.Timeout | null; unsubscribeMemory: (() => void) | null } {
  if (args.tornDown()) {
    return { heartbeat: null, unsubscribeMemory: null }
  }
  const heartbeat = args.startHeartbeat()
  heartbeat.unref()
  return { heartbeat, unsubscribeMemory: args.subscribeMemory() }
}

type ReplayCursorResult = { status: 'ok'; sinceRevision: number | null } | { status: 'error'; reason: string }

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
