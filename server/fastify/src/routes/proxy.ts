import { Readable } from 'node:stream'
import type { FastifyInstance } from 'fastify'
import type { AuthState } from '../auth.js'
import { requireAuth } from '../http.js'
import {
  createTimeoutController,
  decodeRisuUrl,
  filterResponseHeaders,
  getRequestTimeoutMs,
  normalizeForwardHeaders,
  parseRisuHeader,
} from '../proxy.js'

const METHODS_WITHOUT_BODY = new Set(['GET', 'HEAD'])

export function registerProxyRoutes(app: FastifyInstance, authState: AuthState): void {
  app.register(async (instance) => {
    instance.removeAllContentTypeParsers()
    instance.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, done) => {
      done(null, body)
    })

    instance.post('/api/v1/proxy/fetch', async (req, reply) => {
      if (!(await requireAuth(authState, req, reply))) return

      const url = decodeRisuUrl(req.headers['risu-url'])
      if (!url) {
        reply.code(400)
        return { error: 'URL has no param' }
      }

      const overrideHeaders = parseRisuHeader(req.headers['risu-header'])
      const baseHeaders =
        overrideHeaders ?? (req.headers as Record<string, unknown>)
      const headers = normalizeForwardHeaders(baseHeaders)
      if (!headers['x-forwarded-for']) {
        headers['x-forwarded-for'] = req.ip
      }

      const timeoutMs = getRequestTimeoutMs(req.headers['risu-timeout-ms'])
      const timeout = createTimeoutController(timeoutMs)

      const method = req.method
      const body =
        Buffer.isBuffer(req.body) && !METHODS_WITHOUT_BODY.has(method) && req.body.length > 0
          ? req.body
          : undefined

      try {
        const upstream = await fetch(url, {
          method,
          headers,
          body,
          signal: timeout.signal,
        })

        const filtered = filterResponseHeaders(upstream.headers)
        for (const [k, v] of Object.entries(filtered)) {
          reply.header(k, v)
        }
        reply.code(upstream.status)

        if (!upstream.body) {
          return reply.send()
        }
        return reply.send(Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]))
      } catch (err) {
        const name = (err as { name?: string } | null)?.name
        if (name === 'AbortError') {
          if (!reply.raw.headersSent) {
            reply.code(504)
            return {
              error: timeoutMs
                ? `Proxy request timed out after ${timeoutMs}ms`
                : 'Proxy request aborted',
            }
          }
          reply.raw.end()
          return
        }
        throw err
      } finally {
        timeout.cleanup()
      }
    })
  })
}
