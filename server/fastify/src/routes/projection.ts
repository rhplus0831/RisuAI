import type { FastifyInstance } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import type { AuthState } from '../auth.js'
import { requireAuth } from '../http.js'
import { getSchemaState } from '../db.js'
import {
  loadCharacterLorebookHydration,
  loadChatHydration,
  loadPersistedDatabaseFields,
  loadStubProjection,
} from '../repository.js'
import { maskProviderSecrets } from '../providerSecrets.js'
import { emitProtocolMetric, jsonPayloadBytes } from '../protocolMetrics.js'

// Targeted per-resource projection.
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
// gap/reconnect recovery path.
const RESOURCE_PROJECTION_FIELDS: Record<string, string[]> = {
  character: ['characters', 'characterOrder', 'currentChar'],
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

const NARROW_FIELD_PROJECTION_RESOURCES = new Set([
  'preset',
  'prompt',
  'promptItem',
  'persona',
  'translatorPreset',
  'loadout',
])

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
  app.get<{ Params: { resource: string }; Querystring: { id?: string } }>(
    '/api/v1/projection/:resource',
    async (req, reply) => {
      if (!(await requireAuth(authState, req, reply))) return
      const { resource } = req.params
      const { revision } = getSchemaState(db)

      // Per-chat message hydration fills the stubbed `message[]` on chat-open.
      // Distinct from the event-driven `chat` resource, which projects metadata.
      if (resource === 'chatMessages') {
        const chatId = req.query.id
        if (typeof chatId !== 'string' || chatId.trim() === '') {
          const response = { revision, resource, mode: 'full' as const }
          emitProjectionMetric(req.log, resource, revision, response)
          return response
        }
        const hydration = loadChatHydration(db, dataDir, chatId)
        const response = {
          revision,
          resource,
          mode: 'chat-messages' as const,
          chatId,
          message: hydration.message,
          hypaV3Data: hydration.hypaV3Data,
          // Preserved reroll candidates. Present, possibly empty; the current
          // client ignores it.
          alternates: hydration.alternates,
        }
        emitProjectionMetric(req.log, resource, revision, response, { id: chatId })
        return response
      }

      // Per-character `globalLore` hydration fills the stubbed globalLore on
      // character-open when `enableLorebookStubs` is on.
      if (resource === 'characterLorebook') {
        const characterId = req.query.id
        if (typeof characterId !== 'string' || characterId.trim() === '') {
          const response = { revision, resource, mode: 'full' as const }
          emitProjectionMetric(req.log, resource, revision, response)
          return response
        }
        const hydration = loadCharacterLorebookHydration(dataDir, characterId)
        const response = {
          revision,
          resource,
          mode: 'character-lorebook' as const,
          characterId,
          globalLore: hydration.globalLore,
        }
        emitProjectionMetric(req.log, resource, revision, response, { id: characterId })
        return response
      }

      const fieldKeys = resourceProjectionFields(resource)

      if (fieldKeys === null) {
        // Unknown or sprawling resource: tell the client to full-bootstrap.
        const response = { revision, resource, mode: 'full' as const }
        emitProjectionMetric(req.log, resource, revision, response)
        return response
      }

      if (fieldKeys.length === 0) {
        const response = { revision, resource, mode: 'fields' as const, fields: {} }
        emitProjectionMetric(req.log, resource, revision, response, {
          fieldCount: 0,
          fieldKeys,
        })
        return response
      }

      const fields = NARROW_FIELD_PROJECTION_RESOURCES.has(resource)
        ? maskProviderSecrets(loadPersistedDatabaseFields(dataDir, fieldKeys))
        : loadStubProjectionFields(db, dataDir, fieldKeys)

      const response = { revision, resource, mode: 'fields' as const, fields }
      emitProjectionMetric(req.log, resource, revision, response, {
        fieldCount: Object.keys(fields).length,
        fieldKeys,
      })
      return response
    },
  )
}

function loadStubProjectionFields(
  db: DatabaseSync,
  dataDir: string,
  fieldKeys: readonly string[],
): Record<string, unknown> {
  // Ship chat stubs (message-free) here too; the client re-hydrates the open
  // chat after merging a `characters` projection (see bootstrap.ts hydration).
  const persisted = loadStubProjection(db, dataDir)
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
  return fields
}

function emitProjectionMetric(
  logger: FastifyInstance['log'],
  resource: string,
  revision: number,
  response: unknown,
  extra: Record<string, unknown> = {},
): void {
  emitProtocolMetric(
    'projection_response',
    {
      resource,
      revision,
      payloadBytes: jsonPayloadBytes(response),
      ...extra,
    },
    logger,
  )
}
