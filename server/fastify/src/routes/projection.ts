import type { FastifyInstance } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import type { AuthState } from '../auth.js'
import { requireAuth } from '../http.js'
import { getSchemaState } from '../db.js'
import { loadPersistedWithMessages } from '../repository.js'
import { maskProviderSecrets } from '../providerSecrets.js'

// Targeted per-resource projection (lazy-projection Phase 2).
//
// Maps a command-event `resource` to the set of top-level `database` keys it
// owns, so a *foreign* command event can refresh only those keys instead of
// replacing the whole projection. The map is derived from what each resource's
// server command handler writes; it is deliberately generous (a command that
// cross-writes a sibling array lists both keys) so a targeted refresh never
// under-applies. Resources whose state sprawls across the settings scalars
// (`settings`, `state`) — or any resource not listed — fall back to a full
// bootstrap (`mode: 'full'`), which is correct and self-healing.
//
// Under the single-writer invariant the only foreign command events that
// actually occur are server-originated ones (`generation.persisted`,
// `asset.created`); the rest of the map exists for completeness and for the
// gap/reconnect recovery path. Phases 4–5 add entity-scoped hydration on top of
// this same client fetch+merge primitive.
const RESOURCE_PROJECTION_FIELDS: Record<string, string[]> = {
  character: ['characters', 'characterOrder'],
  chat: ['characters'],
  chatFolder: ['characters'],
  message: ['characters'],
  generation: ['characters'],
  scriptDefinition: ['characters', 'modules'],
  triggerDefinition: ['characters', 'modules'],
  lorebook: ['characters', 'modules', 'loreBook'],
  preset: ['botPresets', 'botPresetsId'],
  prompt: ['botPresets'],
  promptItem: ['botPresets'],
  persona: ['personas', 'selectedPersona'],
  module: ['modules', 'enabledModules', 'loadouts'],
  plugin: ['plugins', 'currentPluginProvider'],
  loadout: ['loadouts'],
  translatorPreset: [
    'translatorPresets',
    'translatorPresetId',
    'translatorPrompt',
    'translatorMaxResponse',
  ],
  // `asset.created` bumps the global revision but does not change the projected
  // `database` (asset metadata lives outside it), so its targeted refresh is a
  // no-op that only advances the client's revision cursor.
  asset: [],
}

export function resourceProjectionFields(resource: string): string[] | null {
  return Object.prototype.hasOwnProperty.call(RESOURCE_PROJECTION_FIELDS, resource)
    ? RESOURCE_PROJECTION_FIELDS[resource]
    : null
}

export function registerProjectionRoutes(
  app: FastifyInstance,
  db: DatabaseSync,
  authState: AuthState,
  dataDir: string,
): void {
  app.get<{ Params: { resource: string } }>(
    '/api/v1/projection/:resource',
    async (req, reply) => {
      if (!(await requireAuth(authState, req, reply))) return
      const { resource } = req.params
      const { revision } = getSchemaState(db)
      const fieldKeys = resourceProjectionFields(resource)

      if (fieldKeys === null) {
        // Unknown or sprawling resource: tell the client to full-bootstrap.
        return { revision, resource, mode: 'full' as const }
      }

      const persisted = loadPersistedWithMessages(db, dataDir)
      const masked = maskProviderSecrets(persisted.database)
      const source =
        masked && typeof masked === 'object' && !Array.isArray(masked)
          ? (masked as Record<string, unknown>)
          : {}
      const fields: Record<string, unknown> = {}
      for (const key of fieldKeys) {
        if (Object.prototype.hasOwnProperty.call(source, key)) {
          fields[key] = source[key]
        }
      }

      return { revision, resource, mode: 'fields' as const, fields }
    },
  )
}
