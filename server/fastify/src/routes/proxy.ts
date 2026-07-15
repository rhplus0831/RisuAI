import { Readable } from 'node:stream'
import type { FastifyInstance, HTTPMethods } from 'fastify'
import type { AuthState } from '../auth.js'
import { requireAuth } from '../http.js'
import {
  bufferToBodyInit,
  createTimeoutController,
  decodeRisuUrl,
  filterResponseHeaders,
  getRequestTimeoutMs,
  normalizeForwardHeaders,
  parseRisuHeader,
} from '../proxy.js'
import { proxyFetchRateLimit } from '../routeRateLimits.js'

const METHODS_WITHOUT_BODY = new Set(['GET', 'HEAD'])
const PROXY_FETCH_METHODS: HTTPMethods[] = ['GET', 'POST', 'PUT', 'DELETE']

export function registerProxyRoutes(app: FastifyInstance, authState: AuthState): void {
  app.register(async (instance) => {
    instance.removeAllContentTypeParsers()
    instance.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, done) => {
      done(null, body)
    })

    instance.route({
      method: PROXY_FETCH_METHODS,
      url: '/api/v1/proxy/fetch',
      config: { rateLimit: proxyFetchRateLimit },
      onRequest: async (req, reply) => {
        await requireAuth(authState, req, reply)
      },
      handler: async (req, reply) => {
        const url = decodeRisuUrl(req.headers['risu-url'])
        if (!url) {
          reply.code(400)
          return { error: 'URL has no param' }
        }

        const overrideHeaders = parseRisuHeader(req.headers['risu-header'])
        const baseHeaders = overrideHeaders ?? (req.headers as Record<string, unknown>)
        const headers = normalizeForwardHeaders(baseHeaders)
        if (!headers['x-forwarded-for']) {
          headers['x-forwarded-for'] = req.ip
        }

        const timeoutMs = getRequestTimeoutMs(req.headers['risu-timeout-ms'])
        const timeout = createTimeoutController(timeoutMs)
        // Abort the upstream when the browser disconnects. Without
        // this, a cancelled/navigated-away client leaves the server reading the
        // provider until undici's own timeout.
        const closeController = new AbortController()
        const onClose = (): void => closeController.abort()
        req.raw.once('close', onClose)
        const signal = AbortSignal.any([timeout.signal, closeController.signal])

        const method = req.method
        const body =
          Buffer.isBuffer(req.body) && !METHODS_WITHOUT_BODY.has(method) && req.body.length > 0 ? req.body : undefined

        try {
          const upstream = await fetch(url, {
            method,
            headers,
            body: body ? bufferToBodyInit(body) : undefined,
            signal,
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
          if (signal.aborted || name === 'AbortError') {
            if (!reply.raw.headersSent) {
              reply.code(504)
              return {
                error:
                  timeout.timedOut() && !closeController.signal.aborted
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
          req.raw.off('close', onClose)
        }
      },
    })
  })
}
