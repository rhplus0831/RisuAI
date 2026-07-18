import type { DatabaseSync } from 'node:sqlite'
import type { FastifyInstance } from 'fastify'
import type { AuthState } from '../auth.js'
import { COMMAND_EVENT_CATALOG, type CommandEventSink } from '../commands/events.js'
import { applyTargetedCommandMutation, TARGETED_MUTATION_PATHS } from '../commands/mutations.js'
import { getSchemaState } from '../db.js'
import { requireAuth } from '../http.js'
import {
  MCP_OAUTH_REFRESH_REQUEST_BODY_LIMIT_BYTES,
  executeStoredMcpOAuthRefresh,
  McpOAuthRefreshError,
  parseMcpOAuthRefreshRequest,
  resolveStoredMcpOAuthRefreshRecord,
  type McpOAuthRefreshExecutionOptions,
} from '../mcpOAuthRefresh.js'
import { extractSettings, loadSettingsFromSqlite, writeSettingsOnly } from '../repository.js'
import { mcpOAuthRefreshRateLimit } from '../routeRateLimits.js'

export type McpOAuthRefreshRouteOptions = Omit<McpOAuthRefreshExecutionOptions, 'signal' | 'onRotatedRefreshToken'>

class McpOAuthRefreshRotationSupersededError extends Error {}

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
  dataDir: string,
  eventSink: CommandEventSink,
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
          onRotatedRefreshToken: (rotation) => {
            persistRotatedMcpOAuthRefreshToken(db, dataDir, eventSink, rotation)
          },
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

export function persistRotatedMcpOAuthRefreshToken(
  db: DatabaseSync,
  dataDir: string,
  eventSink: CommandEventSink,
  rotation: { url: string; previousRefreshToken: string; refreshToken: string },
): boolean {
  try {
    applyTargetedCommandMutation({
      db,
      dataDir,
      baseRevision: getSchemaState(db).revision,
      eventSink,
      mutationPath: TARGETED_MUTATION_PATHS.settings,
      settingsScopedRead: true,
      mutate(database, innerDb) {
        if (!database || typeof database !== 'object' || Array.isArray(database)) {
          throw new McpOAuthRefreshError('mcp_oauth_refresh_configuration_invalid', 400)
        }
        const target = database as Record<string, unknown>
        const current = resolveStoredMcpOAuthRefreshRecord(target, rotation.url)
        if (current.refreshToken !== rotation.previousRefreshToken) {
          throw new McpOAuthRefreshRotationSupersededError()
        }
        const refreshes = target.authRefreshes as unknown[]
        const index = refreshes.findIndex(
          (value) =>
            !!value &&
            typeof value === 'object' &&
            !Array.isArray(value) &&
            (value as Record<string, unknown>).url === rotation.url,
        )
        if (index === -1) throw new McpOAuthRefreshError('mcp_oauth_refresh_not_found', 404)
        refreshes[index] = {
          ...(refreshes[index] as Record<string, unknown>),
          refreshToken: rotation.refreshToken,
        }
        writeSettingsOnly(innerDb, extractSettings(target))
        return {
          event: {
            ...COMMAND_EVENT_CATALOG.settingsUpdated,
            id: 'providers',
          },
        }
      },
    })
    return true
  } catch (error) {
    if (error instanceof McpOAuthRefreshRotationSupersededError) return false
    throw error
  }
}
