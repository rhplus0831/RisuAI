import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { FastifyInstance, HTTPMethods } from 'fastify'
import type { AuthState } from '../auth.js'
import { requireAuth } from '../http.js'
import {
  bufferToBodyInit,
  createTimeoutController,
  decodeRisuUrl,
  filterPluginResponseHeaders,
  filterResponseHeaders,
  getRequestTimeoutMs,
  normalizeForwardHeaders,
  parseRisuHeader,
} from '../proxy.js'
import { proxyFetchRateLimit } from '../routeRateLimits.js'
import { PluginNetworkTargetError, requestPluginNetworkWithRedirects } from '../pluginNetwork.js'

const METHODS_WITHOUT_BODY = new Set(['GET', 'HEAD'])
const PROXY_FETCH_METHODS: HTTPMethods[] = ['GET', 'POST', 'PUT', 'DELETE']
const PLUGIN_PROXY_FETCH_METHODS: HTTPMethods[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']

export interface ProxyDisconnectController {
  signal: AbortSignal
  cleanup(): void
}

export function createProxyDisconnectController(
  request: Pick<IncomingMessage, 'aborted' | 'complete' | 'destroyed' | 'off' | 'once'>,
  response: Pick<ServerResponse, 'destroyed' | 'off' | 'once' | 'writableEnded'>,
): ProxyDisconnectController {
  const controller = new AbortController()
  const onRequestClose = (): void => {
    if (!request.complete) controller.abort()
  }
  const onResponseClose = (): void => {
    if (!response.writableEnded) controller.abort()
  }
  request.once('close', onRequestClose)
  response.once('close', onResponseClose)
  if (request.aborted || (request.destroyed && !request.complete) || (response.destroyed && !response.writableEnded)) {
    controller.abort()
  }
  return {
    signal: controller.signal,
    cleanup() {
      request.off('close', onRequestClose)
      response.off('close', onResponseClose)
    },
  }
}

export function registerProxyRoutes(app: FastifyInstance, authState: AuthState): void {
  app.register(async (instance) => {
    instance.removeAllContentTypeParsers()
    instance.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, done) => {
      done(null, body)
    })

    instance.route({
      method: PROXY_FETCH_METHODS,
      url: '/api/v1/proxy/fetch',
      exposeHeadRoute: false,
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
        const disconnect = createProxyDisconnectController(req.raw, reply.raw)
        const signal = AbortSignal.any([timeout.signal, disconnect.signal])
        let cleanupDeferredToStream = false
        let cleanedUp = false
        const cleanup = (): void => {
          if (cleanedUp) return
          cleanedUp = true
          timeout.cleanup()
          disconnect.cleanup()
          reply.raw.off('finish', cleanup)
          reply.raw.off('close', cleanup)
        }

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
          const stream = Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0])
          cleanupDeferredToStream = true
          stream.once('end', cleanup)
          stream.once('close', cleanup)
          stream.once('error', cleanup)
          reply.raw.once('finish', cleanup)
          reply.raw.once('close', cleanup)
          return reply.send(stream)
        } catch (err) {
          const name = (err as { name?: string } | null)?.name
          if (signal.aborted || name === 'AbortError') {
            if (!reply.raw.headersSent) {
              reply.code(504)
              return {
                error:
                  timeout.timedOut() && !disconnect.signal.aborted
                    ? `Proxy request timed out after ${timeoutMs}ms`
                    : 'Proxy request aborted',
              }
            }
            reply.raw.end()
            return
          }
          throw err
        } finally {
          if (!cleanupDeferredToStream) cleanup()
        }
      },
    })

    instance.route({
      method: PLUGIN_PROXY_FETCH_METHODS,
      url: '/api/v1/proxy/plugin-fetch',
      exposeHeadRoute: false,
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
        for (const name of Object.keys(headers)) {
          const normalized = name.toLowerCase()
          if (normalized.startsWith('risu-') || normalized === 'x-risu-tk') {
            delete headers[name]
          }
        }
        const normalizedHeaderNames = new Set(Object.keys(headers).map((name) => name.toLowerCase()))
        if (!normalizedHeaderNames.has('accept')) headers.accept = '*/*'
        if (!normalizedHeaderNames.has('user-agent')) headers['user-agent'] = 'undici'
        const timeoutMs = getRequestTimeoutMs(req.headers['risu-timeout-ms'])
        const timeout = createTimeoutController(timeoutMs)
        const disconnect = createProxyDisconnectController(req.raw, reply.raw)
        const signal = AbortSignal.any([timeout.signal, disconnect.signal])
        let cleanupDeferredToStream = false
        let cleanedUp = false
        const cleanup = (): void => {
          if (cleanedUp) return
          cleanedUp = true
          timeout.cleanup()
          disconnect.cleanup()
          reply.raw.off('finish', cleanup)
          reply.raw.off('close', cleanup)
        }

        const method = req.method
        const body =
          Buffer.isBuffer(req.body) && !METHODS_WITHOUT_BODY.has(method) && req.body.length > 0 ? req.body : undefined

        try {
          const upstream = await requestPluginNetworkWithRedirects(url, {
            method,
            headers,
            body,
            signal,
          })

          const responseHeaders = new Headers()
          for (const [name, value] of Object.entries(upstream.headers)) {
            if (typeof value === 'string') {
              responseHeaders.set(name, value)
            } else if (Array.isArray(value)) {
              for (const entry of value) responseHeaders.append(name, entry)
            }
          }
          const filtered = filterPluginResponseHeaders(responseHeaders)
          for (const [name, value] of Object.entries(filtered)) {
            reply.header(name, value)
          }
          reply.code(upstream.statusCode ?? 502)
          if (upstream.statusMessage) reply.raw.statusMessage = upstream.statusMessage
          cleanupDeferredToStream = true
          upstream.once('end', cleanup)
          upstream.once('close', cleanup)
          upstream.once('error', cleanup)
          reply.raw.once('finish', cleanup)
          reply.raw.once('close', cleanup)
          if (upstream.readableEnded) cleanup()
          return reply.send(upstream)
        } catch (error) {
          if (error instanceof PluginNetworkTargetError) {
            if (!reply.raw.headersSent) {
              reply.code(error.statusCode)
              return { error: error.message }
            }
            reply.raw.end()
            return
          }
          const name = (error as { name?: string } | null)?.name
          if (signal.aborted || name === 'AbortError') {
            if (!reply.raw.headersSent) {
              reply.code(504)
              return {
                error:
                  timeout.timedOut() && !disconnect.signal.aborted
                    ? `Plugin proxy request timed out after ${timeoutMs}ms`
                    : 'Plugin proxy request aborted',
              }
            }
            reply.raw.end()
            return
          }
          throw error
        } finally {
          if (!cleanupDeferredToStream) cleanup()
        }
      },
    })
  })
}
