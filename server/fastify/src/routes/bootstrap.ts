import type { FastifyInstance } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import type { ActiveWriterState } from '../activeWriter.js'
import { registerActiveWriterSession } from '../activeWriter.js'
import type { AuthState } from '../auth.js'
import type { GenerationJobRegistry } from '../generationJobs.js'
import { requireAuth } from '../http.js'
import { getSchemaState } from '../db.js'
import { loadBootstrapProjectionDatabase } from '../repository.js'
import { maskProviderSecretsInPlace } from '../providerSecrets.js'
import { emitProtocolMetric, jsonPayloadBytes } from '../protocolMetrics.js'

export const ASSET_BASE_URL = '/api/v1/assets'

export function registerBootstrapRoutes(
  app: FastifyInstance,
  db: DatabaseSync,
  authState: AuthState,
  dataDir: string,
  activeWriterState?: ActiveWriterState,
  generationJobs?: GenerationJobRegistry,
): void {
  app.get('/api/v1/bootstrap', { exposeHeadRoute: false }, async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return
    if (activeWriterState) {
      registerActiveWriterSession(activeWriterState, req)
    }
    const { version, revision } = getSchemaState(db)
    // Ship chat stubs (metadata, no message[]); the client hydrates messages via
    // the projection endpoint when a chat opens.
    const database = loadBootstrapProjectionDatabase(db, dataDir)
    const response = {
      revision,
      schemaVersion: version,
      // In-place mask `loadBootstrapProjectionDatabase` freshly builds this
      // object and nothing else references it, so the response skips the
      // whole-stubbed-DB JSON round-trip clone the copying mask pays.
      database: maskProviderSecretsInPlace(database),
      assetBaseUrl: ASSET_BASE_URL,
      // Transient running generations so a returning client, even after a full
      // reload, can discover and reattach. Server-memory only.
      activeGenerationJobs: generationJobs?.activeJobs() ?? [],
    }
    // Thunk `jsonPayloadBytes` re-serializes the whole bootstrap
    // payload, so the fields must only be built after the metrics-enabled guard.
    emitProtocolMetric(
      'bootstrap_projection',
      () => ({
        revision,
        payloadBytes: jsonPayloadBytes(response),
        activeGenerationJobCount: response.activeGenerationJobs.length,
      }),
      req.log,
    )
    return response
  })
}
