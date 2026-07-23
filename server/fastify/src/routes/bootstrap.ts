import type { FastifyInstance } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import type { ActiveWriterState } from '../activeWriter.js'
import { registerActiveWriterSession, requestedWriterWasActive } from '../activeWriter.js'
import type { AuthState } from '../auth.js'
import type { GenerationJobRegistry } from '../generationJobs.js'
import { requireAuth } from '../http.js'
import { getSchemaState } from '../db.js'
import type { MessageTranslationJobRegistry } from '../messageTranslationJobs.js'
import type { GreetingTranslationJobRegistry } from '../greetingTranslationJobs.js'
import { emitProtocolMetric, jsonPayloadBytes } from '../protocolMetrics.js'
import { getDatabaseLineage, getDatabaseWriterMetadata } from '../databaseLineage.js'
import { assessDatabaseInitialization } from '../databaseInitialization.js'

export const ASSET_BASE_URL = '/api/v1/assets'

export function registerBootstrapRoutes(
  app: FastifyInstance,
  db: DatabaseSync,
  authState: AuthState,
  _dataDir: string,
  activeWriterState?: ActiveWriterState,
  generationJobs?: GenerationJobRegistry,
  messageTranslationJobs?: MessageTranslationJobRegistry,
  greetingTranslationJobs?: GreetingTranslationJobRegistry,
): void {
  app.get('/api/v1/bootstrap', { exposeHeadRoute: false }, async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return
    const wasRequestedWriterActive = activeWriterState ? requestedWriterWasActive(activeWriterState, req) : undefined
    if (activeWriterState) {
      registerActiveWriterSession(activeWriterState, req)
    }
    const { version, revision } = getSchemaState(db)
    const response = {
      // A damaged database with durable user data must never invite the client
      // to run first-use initialization. The initialize command uses this same
      // classifier and returns a conflict if a race reaches it anyway.
      initialized: assessDatabaseInitialization(db).state !== 'uninitialized',
      revision,
      schemaVersion: version,
      databaseLineage: getDatabaseLineage(db),
      writerEpoch: activeWriterState?.epoch ?? getDatabaseWriterMetadata(db).epoch,
      ...(wasRequestedWriterActive === undefined ? {} : { requestedWriterWasActive: wasRequestedWriterActive }),
      assetBaseUrl: ASSET_BASE_URL,
      // Transient running generations so a returning client, even after a full
      // reload, can discover and reattach. Server-memory only.
      activeGenerationJobs: generationJobs?.activeJobs() ?? [],
      // Detached message translations and their short-lived terminal outcomes.
      // This lets a returning browser preserve busy controls, report failures,
      // and rehydrate successful translations after reload.
      activeMessageTranslations: messageTranslationJobs?.translations() ?? [],
      activeGreetingTranslations: greetingTranslationJobs?.translations() ?? [],
    }
    emitProtocolMetric(
      'bootstrap_projection',
      () => ({
        revision,
        payloadBytes: jsonPayloadBytes(response),
        activeGenerationJobCount: response.activeGenerationJobs.length,
        activeMessageTranslationCount: response.activeMessageTranslations.length,
        activeGreetingTranslationCount: response.activeGreetingTranslations.length,
      }),
      req.log,
    )
    return response
  })
}
