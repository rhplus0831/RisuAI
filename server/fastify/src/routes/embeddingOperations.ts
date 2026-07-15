import type { DatabaseSync } from 'node:sqlite'
import type { FastifyInstance } from 'fastify'
import type { AuthState } from '../auth.js'
import {
  EMBEDDING_OPERATION_BODY_LIMIT,
  EmbeddingOperationError,
  executeEmbeddingOperation,
  parseEmbeddingOperationRequest,
  type EmbeddingOperationExecutionOptions,
} from '../embeddingOperations.js'
import { requireAuth } from '../http.js'
import { loadSettingsFromSqlite } from '../repository.js'
import { providerOperationRateLimit } from '../routeRateLimits.js'

export type EmbeddingOperationRouteOptions = Omit<EmbeddingOperationExecutionOptions, 'signal'>

interface CloseEmitter {
  once(event: 'close', listener: () => void): unknown
  off(event: 'close', listener: () => void): unknown
}

export function createEmbeddingOperationDisconnectAbort(
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

export function registerEmbeddingOperationRoutes(
  app: FastifyInstance,
  db: DatabaseSync,
  authState: AuthState,
  options: EmbeddingOperationRouteOptions = {},
): void {
  app.post(
    '/api/v1/embedding-operations',
    {
      bodyLimit: EMBEDDING_OPERATION_BODY_LIMIT,
      config: { rateLimit: providerOperationRateLimit },
      onRequest: async (req, reply) => {
        await requireAuth(authState, req, reply)
      },
    },
    async (req, reply) => {
      reply.header('cache-control', 'no-store')
      const disconnect = createEmbeddingOperationDisconnectAbort(req.raw, reply.raw)
      try {
        const request = parseEmbeddingOperationRequest(req.body)
        const settings = loadSettingsFromSqlite(db) ?? {}
        return await executeEmbeddingOperation(request, settings, {
          ...options,
          signal: disconnect.signal,
        })
      } catch (error) {
        const operationError =
          error instanceof EmbeddingOperationError
            ? error
            : new EmbeddingOperationError('embedding_operation_failed', 502)
        reply.code(operationError.statusCode)
        return { error: operationError.code }
      } finally {
        disconnect.cleanup()
      }
    },
  )
}
