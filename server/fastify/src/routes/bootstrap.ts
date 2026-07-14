import type { FastifyInstance } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import type { ActiveWriterState } from '../activeWriter.js'
import { registerActiveWriterSession } from '../activeWriter.js'
import type { AuthState } from '../auth.js'
import type { GenerationJobRegistry } from '../generationJobs.js'
import { requireAuth } from '../http.js'
import { getSchemaState } from '../db.js'
import type { MessageTranslationJobRegistry } from '../messageTranslationJobs.js'
import { emitProtocolMetric, jsonPayloadBytes } from '../protocolMetrics.js'

export const ASSET_BASE_URL = '/api/v1/assets'

export function registerBootstrapRoutes(
  app: FastifyInstance,
  db: DatabaseSync,
  authState: AuthState,
  _dataDir: string,
  activeWriterState?: ActiveWriterState,
  generationJobs?: GenerationJobRegistry,
  messageTranslationJobs?: MessageTranslationJobRegistry,
): void {
  app.get('/api/v1/bootstrap', { exposeHeadRoute: false }, async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return
    if (activeWriterState) {
      registerActiveWriterSession(activeWriterState, req)
    }
    const { version, revision } = getSchemaState(db)
    const response = {
      initialized: db.prepare('SELECT 1 FROM settings WHERE id = 1').get() !== undefined,
      revision,
      schemaVersion: version,
      assetBaseUrl: ASSET_BASE_URL,
      // Transient running generations so a returning client, even after a full
      // reload, can discover and reattach. Server-memory only.
      activeGenerationJobs: generationJobs?.activeJobs() ?? [],
      // Detached message translations still running server-side. Server-memory
      // only, used by the client to preserve row-level busy controls after reload.
      activeMessageTranslations: messageTranslationJobs?.activeTranslations() ?? [],
    }
    emitProtocolMetric(
      'bootstrap_projection',
      () => ({
        revision,
        payloadBytes: jsonPayloadBytes(response),
        activeGenerationJobCount: response.activeGenerationJobs.length,
        activeMessageTranslationCount: response.activeMessageTranslations.length,
      }),
      req.log,
    )
    return response
  })
}
