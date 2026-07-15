import type { DatabaseSync } from 'node:sqlite'
import type { FastifyInstance } from 'fastify'
import type { AuthState } from '../auth.js'
import { requireAuth } from '../http.js'
import {
  MCP_OAUTH_REFRESH_REQUEST_BODY_LIMIT_BYTES,
  executeStoredMcpOAuthRefresh,
  McpOAuthRefreshError,
  parseMcpOAuthRefreshRequest,
  type McpOAuthRefreshExecutionOptions,
} from '../mcpOAuthRefresh.js'
import { loadSettingsFromSqlite } from '../repository.js'
import { mcpOAuthRefreshRateLimit } from '../routeRateLimits.js'

export type McpOAuthRefreshRouteOptions = Omit<McpOAuthRefreshExecutionOptions, 'signal'>

interface CloseEmitter {
  once(event: 'close', listener: () => void): unknown
  off(event: 'close', listener: () => void): unknown
}

export function createMcpOAuthRefreshDisconnectAbort(
  request: CloseEmitter & { complete: boolean },
  response: CloseEmitter & { writableEnded: boolean },
): { signal: AbortSignal; cleanup: () => void } {
  const disconnect = new AbortController()
  const onRequestClose = (): void => {
    if (!request.complete) disconnect.abort()
  }
  const onResponseClose = (): void => {
    if (!response.writableEnded) disconnect.abort()
  }

  request.once('close', onRequestClose)
  response.once('close', onResponseClose)

  return {
    signal: disconnect.signal,
    cleanup: () => {
      request.off('close', onRequestClose)
      response.off('close', onResponseClose)
    },
  }
}

export function registerMcpOAuthRefreshRoutes(
  app: FastifyInstance,
  db: DatabaseSync,
  authState: AuthState,
  options: McpOAuthRefreshRouteOptions = {},
): void {
  app.post(
    '/api/v1/mcp/oauth/refresh',
    {
      bodyLimit: MCP_OAUTH_REFRESH_REQUEST_BODY_LIMIT_BYTES,
      config: { rateLimit: mcpOAuthRefreshRateLimit },
      onRequest: async (req, reply) => {
        await requireAuth(authState, req, reply)
      },
    },
    async (req, reply) => {
      reply.header('cache-control', 'no-store')
      const disconnect = createMcpOAuthRefreshDisconnectAbort(req.raw, reply.raw)

      try {
        const request = parseMcpOAuthRefreshRequest(req.body)
        const settings = loadSettingsFromSqlite(db) ?? {}
        return await executeStoredMcpOAuthRefresh(request, settings, {
          ...options,
          signal: disconnect.signal,
        })
      } catch (error) {
        const refreshError =
          error instanceof McpOAuthRefreshError ? error : new McpOAuthRefreshError('mcp_oauth_refresh_failed', 502)
        reply.code(refreshError.statusCode)
        return {
          error: refreshError.code,
          ...(refreshError.upstreamStatus === undefined ? {} : { upstreamStatus: refreshError.upstreamStatus }),
        }
      } finally {
        disconnect.cleanup()
      }
    },
  )
}
