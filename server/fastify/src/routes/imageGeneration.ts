import type { DatabaseSync } from 'node:sqlite'
import type { FastifyInstance } from 'fastify'
import type { AuthState } from '../auth.js'
import {
  executeImageGeneration,
  IMAGE_GENERATION_MAX_REQUEST_BYTES,
  ImageGenerationError,
  parseImageGenerationRequest,
  type ImageGenerationExecutionOptions,
} from '../imageGeneration.js'
import { requireAuth } from '../http.js'
import { loadSettingsFromSqlite } from '../repository.js'
import { imageGenerationRateLimit } from '../routeRateLimits.js'

export type ImageGenerationRouteOptions = Omit<ImageGenerationExecutionOptions, 'signal'>

interface CloseEmitter {
  once(event: 'close', listener: () => void): unknown
  off(event: 'close', listener: () => void): unknown
}

export function createImageGenerationDisconnectAbort(
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

export function registerImageGenerationRoutes(
  app: FastifyInstance,
  db: DatabaseSync,
  authState: AuthState,
  options: ImageGenerationRouteOptions = {},
): void {
  app.post(
    '/api/v1/image-generation',
    {
      bodyLimit: IMAGE_GENERATION_MAX_REQUEST_BYTES,
      config: { rateLimit: imageGenerationRateLimit },
      onRequest: async (req, reply) => {
        await requireAuth(authState, req, reply)
      },
    },
    async (req, reply) => {
      reply.header('cache-control', 'no-store')
      reply.header('x-content-type-options', 'nosniff')
      const disconnect = createImageGenerationDisconnectAbort(req.raw, reply.raw)
      try {
        const request = parseImageGenerationRequest(req.body)
        const settings = loadSettingsFromSqlite(db) ?? {}
        const image = await executeImageGeneration(request, settings, {
          ...options,
          signal: disconnect.signal,
        })
        reply.type(image.contentType)
        return reply.send(image.bytes)
      } catch (error) {
        const generationError =
          error instanceof ImageGenerationError ? error : new ImageGenerationError('image_generation_failed', 502)
        reply.code(generationError.statusCode)
        return {
          error: generationError.code,
          ...(generationError.upstreamStatus === undefined ? {} : { upstreamStatus: generationError.upstreamStatus }),
        }
      } finally {
        disconnect.cleanup()
      }
    },
  )
}
