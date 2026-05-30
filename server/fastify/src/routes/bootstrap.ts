import type { FastifyInstance } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import type { ActiveWriterState } from '../activeWriter.js'
import { registerActiveWriterSession } from '../activeWriter.js'
import type { AuthState } from '../auth.js'
import type { GenerationJobRegistry } from '../generationJobs.js'
import { requireAuth } from '../http.js'
import { getSchemaState } from '../db.js'
import { loadStubProjection } from '../repository.js'
import { maskProviderSecrets } from '../providerSecrets.js'

export const ASSET_BASE_URL = '/api/v1/assets'

export function registerBootstrapRoutes(
  app: FastifyInstance,
  db: DatabaseSync,
  authState: AuthState,
  dataDir: string,
  activeWriterState?: ActiveWriterState,
  generationJobs?: GenerationJobRegistry,
): void {
  app.get('/api/v1/bootstrap', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return
    if (activeWriterState) {
      registerActiveWriterSession(activeWriterState, req)
    }
    const { version, revision } = getSchemaState(db)
    // Lazy-projection Phase 4.3: ship chat *stubs* (metadata, no message[]). The
    // client hydrates a chat's messages on open via the projection endpoint.
    const persisted = loadStubProjection(db, dataDir)
    return {
      revision,
      schemaVersion: version,
      database: maskProviderSecrets(persisted.database),
      assetBaseUrl: ASSET_BASE_URL,
      // Durable generation (Milestone 1): the transient running generations, so a
      // returning client — even after a full reload — discovers + reattaches to an
      // in-flight generation. Server-memory only; empty when none are running.
      activeGenerationJobs: generationJobs?.activeJobs() ?? [],
    }
  })
}
