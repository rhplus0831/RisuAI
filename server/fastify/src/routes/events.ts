import type { FastifyInstance } from 'fastify'
import type { AuthState } from '../auth.js'
import type { CommandEvent, CommandEventSink } from '../commands/events.js'
import { requireAuth } from '../http.js'

function writeSseComment(raw: NodeJS.WritableStream, comment: string): void {
  raw.write(`: ${comment}\n\n`)
}

function writeCommandEvent(raw: NodeJS.WritableStream, event: CommandEvent): void {
  raw.write(`event: command\ndata: ${JSON.stringify(event)}\n\n`)
}

export function registerEventsRoutes(
  app: FastifyInstance,
  authState: AuthState,
  commandEvents: CommandEventSink,
): void {
  app.get('/api/v1/events', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    reply.hijack()
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    })
    writeSseComment(reply.raw, 'connected')

    const heartbeat = setInterval(() => {
      if (!reply.raw.writableEnded) {
        writeSseComment(reply.raw, 'heartbeat')
      }
    }, 25_000)
    heartbeat.unref()

    const unsubscribe = commandEvents.subscribe((event) => {
      if (!reply.raw.writableEnded) {
        writeCommandEvent(reply.raw, event)
      }
    })

    const cleanup = (): void => {
      clearInterval(heartbeat)
      unsubscribe()
    }

    req.raw.once('close', cleanup)
  })
}
