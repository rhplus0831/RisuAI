import type { FastifyInstance } from 'fastify'
import type { FastifyRequest } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import type { AuthState } from '../auth.js'
import { normalizePromptTemplateCollection } from '../commands/prompts.js'
import { normalizePresetCollection } from '../commands/presets.js'
import { normalizeTranslatorPresetCollection } from '../commands/translatorPresets.js'
import { normalizeLoadoutCollection } from '../commands/loadouts.js'
import { normalizeScriptDefinitionCollection } from '../commands/scriptDefinitions.js'
import { requireAuth } from '../http.js'
import { ValidationError, applyImport } from '../repository.js'
import { replaceLegacyHypaV3MemoryRows } from '../memoryLegacyImport.js'
import { decodeRisuSaveImportSnapshot } from '../risuSave/importSnapshot.js'

interface ImportBody {
  database?: unknown
}

const EMPTY_ASSET_REPORT = { referencedCount: 0, missingCount: 0, orphanedCount: 0 }

export function registerSaveRoutes(
  app: FastifyInstance,
  db: DatabaseSync,
  authState: AuthState,
  dataDir: string,
): void {
  app.post('/api/v1/import/risusave', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return
    try {
      if (req.isMultipart()) {
        const snapshot = decodeRisuSaveImportSnapshot(await readUploadedRisuSave(req))
        const { revision } = applyImportedDatabase(db, dataDir, snapshot.database)
        return {
          revision,
          envelope: snapshot.envelope,
          importReport: {
            unsupportedReferenceCount: snapshot.unsupportedReferences.length,
            unsupportedReferences: snapshot.unsupportedReferences,
          },
          assetReport: EMPTY_ASSET_REPORT,
        }
      }

      const body = (req.body ?? {}) as ImportBody
      normalizeJsonImportDatabase(body.database)
      const { revision } = applyImportedDatabase(db, dataDir, body.database)
      return { revision, assetReport: EMPTY_ASSET_REPORT }
    } catch (err) {
      if (err instanceof ValidationError) {
        reply.code(400)
        return { error: err.message }
      }
      throw err
    }
  })
}

async function readUploadedRisuSave(req: FastifyRequest): Promise<Uint8Array> {
  const file = await req.file()
  if (!file) {
    throw new ValidationError('risusave file missing')
  }
  const bytes = await file.toBuffer()
  if (bytes.length === 0) {
    throw new ValidationError('risusave file is empty')
  }
  return bytes
}

function normalizeJsonImportDatabase(database: unknown): void {
  if (
    database &&
    typeof database === 'object' &&
    !Array.isArray(database) &&
    ('botPresets' in database || 'botPresetsId' in database)
  ) {
    normalizePresetCollection(database)
  }
  if (
    database &&
    typeof database === 'object' &&
    !Array.isArray(database) &&
    ('translatorPresets' in database ||
      'translatorPresetId' in database ||
      'translatorPrompt' in database ||
      'translatorMaxResponse' in database)
  ) {
    normalizeTranslatorPresetCollection(database)
  }
  if (
    database &&
    typeof database === 'object' &&
    !Array.isArray(database) &&
    ('loadouts' in database || 'lastLoadedLoadoutName' in database)
  ) {
    normalizeLoadoutCollection(database)
  }
  normalizePromptTemplateCollection(database)
  normalizeScriptDefinitionCollection(database)
}

function applyImportedDatabase(
  db: DatabaseSync,
  dataDir: string,
  database: unknown,
): { revision: number } {
  const result = applyImport(db, dataDir, database)
  replaceLegacyHypaV3MemoryRows(db, database)
  return result
}
