import type { DatabaseSync } from 'node:sqlite'
import type { FastifyInstance } from 'fastify'
import type { AuthState } from '../auth.js'
import { requireAuth } from '../http.js'
import { loadSettingsFromSqlite } from '../repository.js'
import { ttsSynthesisRateLimit } from '../routeRateLimits.js'
import {
  executeTtsSynthesis,
  parseTtsSynthesisRequest,
  TTS_SYNTHESIS_BODY_LIMIT,
  TtsSynthesisError,
  type TtsSynthesisExecutionOptions,
} from '../tts.js'

export type TtsSynthesisRouteOptions = Omit<TtsSynthesisExecutionOptions, 'signal'>

interface CloseEmitter {
  once(event: 'close', listener: () => void): unknown
  off(event: 'close', listener: () => void): unknown
}

export function createTtsDisconnectAbort(
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

export function registerTtsRoutes(
  app: FastifyInstance,
  db: DatabaseSync,
  authState: AuthState,
  options: TtsSynthesisRouteOptions = {},
): void {
  app.post(
    '/api/v1/tts/synthesize',
    {
      bodyLimit: TTS_SYNTHESIS_BODY_LIMIT,
      config: { rateLimit: ttsSynthesisRateLimit },
      onRequest: async (req, reply) => {
        await requireAuth(authState, req, reply)
      },
    },
    async (req, reply) => {
      reply.header('cache-control', 'no-store')
      reply.header('x-content-type-options', 'nosniff')
      const disconnect = createTtsDisconnectAbort(req.raw, reply.raw)

      try {
        const request = parseTtsSynthesisRequest(req.body)
        const settings = loadSettingsFromSqlite(db) ?? {}
        const character =
          request.credential.source === 'stored-character'
            ? loadStoredCharacter(db, request.credential.characterId)
            : undefined
        const result = await executeTtsSynthesis(
          request,
          { settings, character },
          { ...options, signal: disconnect.signal },
        )
        return reply.type(result.contentType).send(Buffer.from(result.bytes))
      } catch (error) {
        const synthesisError =
          error instanceof TtsSynthesisError ? error : new TtsSynthesisError('tts_upstream_failed', 502)
        reply.code(synthesisError.statusCode)
        return {
          error: synthesisError.code,
          ...(synthesisError.upstreamStatus === undefined ? {} : { upstreamStatus: synthesisError.upstreamStatus }),
        }
      } finally {
        disconnect.cleanup()
      }
    },
  )
}

function loadStoredCharacter(db: DatabaseSync, characterId: string): Record<string, unknown> | null {
  const row = db.prepare('SELECT data_json FROM characters WHERE id = ?').get(characterId) as
    | { data_json: string }
    | undefined
  if (!row) return null
  const parsed: unknown = JSON.parse(row.data_json)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  return { ...(parsed as Record<string, unknown>), chaId: characterId }
}
