import type { DatabaseSync } from 'node:sqlite'
import type { FastifyInstance } from 'fastify'
import type { AuthState } from '../auth.js'
import { requireAuth } from '../http.js'
import {
  executeProviderOperation,
  parseProviderOperationRequest,
  ProviderOperationError,
  type ProviderOperationExecutionOptions,
} from '../providerOperations.js'
import { loadSettingsFromSqlite } from '../repository.js'
import { providerOperationRateLimit } from '../routeRateLimits.js'

export type ProviderOperationRouteOptions = Omit<ProviderOperationExecutionOptions, 'signal'>

interface CloseEmitter {
  once(event: 'close', listener: () => void): unknown
  off(event: 'close', listener: () => void): unknown
}

export function createProviderOperationDisconnectAbort(
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

export function registerProviderOperationRoutes(
  app: FastifyInstance,
  db: DatabaseSync,
  authState: AuthState,
  options: ProviderOperationRouteOptions = {},
): void {
  app.post(
    '/api/v1/provider-operations',
    {
      config: { rateLimit: providerOperationRateLimit },
      onRequest: async (req, reply) => {
        await requireAuth(authState, req, reply)
      },
    },
    async (req, reply) => {
      reply.header('cache-control', 'no-store')
      const disconnect = createProviderOperationDisconnectAbort(req.raw, reply.raw)

      try {
        const request = parseProviderOperationRequest(req.body)
        const settings = loadSettingsFromSqlite(db) ?? {}
        const data = await executeProviderOperation(request, settings, {
          ...options,
          signal: disconnect.signal,
        })
        return { operation: request.operation, data }
      } catch (error) {
        const operationError =
          error instanceof ProviderOperationError ? error : new ProviderOperationError('provider_operation_failed', 502)
        reply.code(operationError.statusCode)
        return {
          error: operationError.code,
          ...(operationError.upstreamStatus === undefined ? {} : { upstreamStatus: operationError.upstreamStatus }),
        }
      } finally {
        disconnect.cleanup()
      }
    },
  )
}
