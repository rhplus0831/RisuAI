import type { DatabaseSync } from 'node:sqlite'
import type { FastifyInstance } from 'fastify'
import type { AuthState } from '../auth.js'
import { requireAuth } from '../http.js'
import {
  executeOpenAITranscription,
  OPENAI_TRANSCRIPTION_MAX_FILE_BYTES,
  OpenAITranscriptionError,
  type OpenAITranscriptionExecutionOptions,
} from '../openAITranscription.js'
import { loadSettingsFromSqlite } from '../repository.js'
import { openAITranscriptionRateLimit } from '../routeRateLimits.js'

export type OpenAITranscriptionRouteOptions = Omit<OpenAITranscriptionExecutionOptions, 'signal'>

export function registerOpenAITranscriptionRoutes(
  app: FastifyInstance,
  db: DatabaseSync,
  authState: AuthState,
  options: OpenAITranscriptionRouteOptions = {},
): void {
  app.post(
    '/api/v1/media/openai/transcriptions',
    {
      config: { rateLimit: openAITranscriptionRateLimit },
      onRequest: async (request, reply) => {
        await requireAuth(authState, request, reply)
      },
    },
    async (request, reply) => {
      reply.header('cache-control', 'no-store')
      const disconnect = new AbortController()
      const onClose = (): void => {
        if (!reply.raw.writableEnded) disconnect.abort()
      }
      reply.raw.once('close', onClose)

      try {
        const part = await request.file({
          limits: { fileSize: OPENAI_TRANSCRIPTION_MAX_FILE_BYTES, files: 1, fields: 0, parts: 1 },
        })
        if (!part) throw new OpenAITranscriptionError('invalid_openai_transcription_request', 400)
        const bytes = await part.toBuffer()
        if (part.file.truncated) throw new OpenAITranscriptionError('invalid_openai_transcription_request', 400)

        const vtt = await executeOpenAITranscription(
          { bytes, filename: part.filename },
          loadSettingsFromSqlite(db) ?? {},
          { ...options, signal: disconnect.signal },
        )
        reply.type('text/vtt; charset=utf-8')
        return vtt
      } catch (error) {
        const operationError =
          error instanceof OpenAITranscriptionError
            ? error
            : new OpenAITranscriptionError('invalid_openai_transcription_request', 400)
        reply.code(operationError.statusCode)
        return {
          error: operationError.code,
          ...(operationError.upstreamStatus === undefined ? {} : { upstreamStatus: operationError.upstreamStatus }),
        }
      } finally {
        reply.raw.off('close', onClose)
      }
    },
  )
}
