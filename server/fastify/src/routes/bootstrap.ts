import type { FastifyInstance } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import type { ActiveWriterState } from '../activeWriter.js'
import { registerActiveWriterSession } from '../activeWriter.js'
import type { AuthState } from '../auth.js'
import { requireAuth } from '../http.js'
import { getSchemaState } from '../db.js'
import { loadPersisted } from '../repository.js'
import { maskProviderSecrets } from '../providerSecrets.js'

export const ASSET_BASE_URL = '/api/v1/assets'

export function registerBootstrapRoutes(
  app: FastifyInstance,
  db: DatabaseSync,
  authState: AuthState,
  dataDir: string,
  activeWriterState?: ActiveWriterState,
): void {
  app.get('/api/v1/bootstrap', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return
    if (activeWriterState) {
      registerActiveWriterSession(activeWriterState, req)
    }
    const { version, revision } = getSchemaState(db)
    const persisted = loadPersisted(dataDir)
    return {
      revision,
      schemaVersion: version,
      database: maskProviderSecrets(persisted.database),
      assetBaseUrl: ASSET_BASE_URL,
    }
  })
}
