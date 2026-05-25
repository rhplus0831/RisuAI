import type { FastifyInstance } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import type { AuthState } from '../auth.js'
import { normalizePresetCollection } from '../commands/presets.js'
import { requireAuth } from '../http.js'
import { ValidationError, applyImport } from '../repository.js'
import { replaceLegacyHypaV3MemoryRows } from '../memoryLegacyImport.js'

interface ImportBody {
  database?: unknown
}

export function registerSaveRoutes(
  app: FastifyInstance,
  db: DatabaseSync,
  authState: AuthState,
  dataDir: string,
): void {
  app.post('/api/v1/import/risusave', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return
    const body = (req.body ?? {}) as ImportBody
    try {
      if (
        body.database &&
        typeof body.database === 'object' &&
        !Array.isArray(body.database) &&
        ('botPresets' in body.database || 'botPresetsId' in body.database)
      ) {
        normalizePresetCollection(body.database)
      }
      const { revision } = applyImport(db, dataDir, body.database)
      replaceLegacyHypaV3MemoryRows(db, body.database)
      return { revision, assetReport: { referencedCount: 0, missingCount: 0, orphanedCount: 0 } }
    } catch (err) {
      if (err instanceof ValidationError) {
        reply.code(400)
        return { error: err.message }
      }
      throw err
    }
  })
}
