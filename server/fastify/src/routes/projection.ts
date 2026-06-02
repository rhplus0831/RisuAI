import type { DatabaseSync } from 'node:sqlite'
import type { FastifyInstance, FastifyReply } from 'fastify'
import type { AuthState } from '../auth.js'
import { requireAuth } from '../http.js'
import { getSchemaState } from '../db.js'
import {
  loadCharacterSelectionProjection,
  loadCharacterLorebookHydration,
  loadCharacterLorebookHydrations,
  loadChatHydration,
  loadChatHydrations,
  loadPersistedDatabaseFields,
  loadStubProjection,
  loadStubbedProjectionFields,
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
  characterSelection: [],
  chat: ['characters'],
  chatFolder: ['characters'],
  message: ['characters'],
  generation: ['characters'],
  scriptDefinition: ['characters', 'modules'],
  triggerDefinition: ['characters', 'modules'],
  lorebook: ['characters', 'modules', 'loreBook', 'loreBookPage'],
  preset: ['botPresets', 'botPresetsId'],
  prompt: ['botPresets'],
  // Prompt-item commands edit the `promptTemplate` collection, so a foreign
  // refresh must reship that field — not `botPresets` (the prior bug never
  // reflected the changed prompt items).
  promptItem: ['promptTemplate'],
  persona: ['personas', 'selectedPersona'],
  module: ['modules', 'enabledModules', 'loadouts', 'characters'],
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
  'plugin',
])

const NARROW_STUBBED_PROJECTION_RESOURCES = new Set([
  'character',
  'chat',
  'chatFolder',
  'message',
  'generation',
  'scriptDefinition',
  'triggerDefinition',
  'lorebook',
  'module',
])

// Resources whose projected state intentionally sprawls across many top-level
// settings scalars or server-owned state, so the projection route cannot narrow
// them and returns `mode: 'full'` on purpose. Any other unlisted resource also
// falls back to full bootstrap, but as an *unknown* (typically foreign/future)
// resource rather than a known sprawling one. The measurement distinguishes the
// two so a later targeted-resource slice can tell an expected sprawling
// fallback from an unexpected unknown-resource fallback.
const SPRAWLING_FULL_PROJECTION_RESOURCES = new Set(['settings', 'state', 'pluginStorage'])

export type FullBootstrapFallbackClass = 'sprawling' | 'unknown'

/**
 * Classifies why a resource falls back to a full-bootstrap projection. Returns
 * `null` for resources the route can narrow (they never trigger the fallback).
 */
export function fullBootstrapFallbackClass(resource: string): FullBootstrapFallbackClass | null {
  if (resourceProjectionFields(resource) !== null) return null
  return SPRAWLING_FULL_PROJECTION_RESOURCES.has(resource) ? 'sprawling' : 'unknown'
}

const bulkChatMessagesBodySchema = {
  body: {
    type: 'object',
    required: ['ids'],
    additionalProperties: true,
    properties: {
      ids: {
        type: 'array',
        items: { type: 'string', minLength: 1 },
      },
    },
  },
} as const

const bulkCharacterLorebooksBodySchema = bulkChatMessagesBodySchema

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
  const requireProjectionAuth = async (
    req: Parameters<typeof requireAuth>[1],
    reply: FastifyReply,
  ) => {
    await requireAuth(authState, req, reply)
  }

  app.post<{ Body: { ids?: unknown } }>(
    '/api/v1/projection/chatMessages/bulk',
    {
      attachValidation: true,
      onRequest: requireProjectionAuth,
      preValidation: validateBulkChatIdsEnvelope,
      schema: bulkChatMessagesBodySchema,
    },
    async (req, reply) => {
      if (!(await requireAuth(authState, req, reply))) return
      if ((req as { validationError?: unknown }).validationError) {
        invalidBulkChatIdsReply(reply)
        return
      }
      const chatIds = readBulkIds(req.body)
      if (!chatIds) {
        invalidBulkChatIdsReply(reply)
        return
      }

      const { revision } = getSchemaState(db)
      const hydration = loadChatHydrations(db, dataDir, chatIds)
      const response = {
        revision,
        resource: 'chatMessages',
        mode: 'chat-messages-bulk' as const,
        chats: hydration.chats,
        missing: hydration.missing,
      }
      emitProjectionMetric(req.log, 'chatMessages', revision, response, {
        bulk: true,
        idCount: chatIds.length,
        returnedCount: hydration.chats.length,
        missingCount: hydration.missing.length,
      })
      return response
    },
  )

  app.post<{ Body: { ids?: unknown } }>(
    '/api/v1/projection/characterLorebooks/bulk',
    {
      attachValidation: true,
      onRequest: requireProjectionAuth,
      preValidation: validateBulkCharacterLorebookIdsEnvelope,
      schema: bulkCharacterLorebooksBodySchema,
    },
    async (req, reply) => {
      if (!(await requireAuth(authState, req, reply))) return
      if ((req as { validationError?: unknown }).validationError) {
        invalidBulkCharacterLorebookIdsReply(reply)
        return
      }
      const characterIds = readBulkIds(req.body)
      if (!characterIds) {
        invalidBulkCharacterLorebookIdsReply(reply)
        return
      }

      const { revision } = getSchemaState(db)
      const hydration = loadCharacterLorebookHydrations(db, dataDir, characterIds)
      const response = {
        revision,
        resource: 'characterLorebooks',
        mode: 'character-lorebooks-bulk' as const,
        characters: hydration.characters,
        missing: hydration.missing,
      }
      emitProjectionMetric(req.log, 'characterLorebooks', revision, response, {
        bulk: true,
        idCount: characterIds.length,
        returnedCount: hydration.characters.length,
        missingCount: hydration.missing.length,
      })
      return response
    },
  )

  app.get<{ Params: { resource: string }; Querystring: { id?: string } }>(
    '/api/v1/projection/:resource',
    { exposeHeadRoute: false },
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
        const hydration = loadCharacterLorebookHydration(db, dataDir, characterId)
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

      // Character selection only changes the active character pointer and that
      // character's `lastInteraction`. Do not ship the whole `characters` array.
      if (resource === 'characterSelection') {
        const characterId = req.query.id
        if (typeof characterId !== 'string' || characterId.trim() === '') {
          const response = { revision, resource, mode: 'full' as const }
          emitProjectionMetric(req.log, resource, revision, response)
          return response
        }

        const selection = loadCharacterSelectionProjection(db, characterId)
        if (!selection) {
          reply.code(404).send({
            error: 'character_not_found',
            reason: `Character not found: ${characterId}`,
          })
          return
        }

        const response = {
          revision,
          resource,
          mode: 'character-selection' as const,
          ...selection,
        }
        emitProjectionMetric(req.log, resource, revision, response, { id: characterId })
        return response
      }

      const fieldKeys = resourceProjectionFields(resource)

      if (fieldKeys === null) {
        // Unknown or sprawling resource: tell the client to full-bootstrap. The
        // opt-in metric records whether this is an expected sprawling resource
        // (`settings`, `state`, `pluginStorage`) or an unknown one so the cost
        // of these fallbacks can be attributed per resource.
        const response = { revision, resource, mode: 'full' as const }
        emitProjectionMetric(req.log, resource, revision, response, {
          fallbackClass: fullBootstrapFallbackClass(resource),
        })
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
        ? maskProviderSecrets(loadPersistedDatabaseFields(db, dataDir, fieldKeys))
        : NARROW_STUBBED_PROJECTION_RESOURCES.has(resource)
          ? maskProviderSecrets(loadStubbedProjectionFields(db, dataDir, fieldKeys))
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

function invalidBulkChatIdsReply(reply: FastifyReply): void {
  reply.code(400).send({
    error: 'invalid_chat_ids',
    reason: 'Expected body.ids to be an array of non-empty chat ids.',
  })
}

async function validateBulkChatIdsEnvelope(
  req: { body?: unknown },
  reply: FastifyReply,
): Promise<void> {
  if (!readBulkIds(req.body as { ids?: unknown } | undefined)) {
    invalidBulkChatIdsReply(reply)
  }
}

function invalidBulkCharacterLorebookIdsReply(reply: FastifyReply): void {
  reply.code(400).send({
    error: 'invalid_character_lorebook_ids',
    reason: 'Expected body.ids to be an array of non-empty character ids.',
  })
}

async function validateBulkCharacterLorebookIdsEnvelope(
  req: { body?: unknown },
  reply: FastifyReply,
): Promise<void> {
  if (!readBulkIds(req.body as { ids?: unknown } | undefined)) {
    invalidBulkCharacterLorebookIdsReply(reply)
  }
}

function readBulkIds(body: { ids?: unknown } | undefined): string[] | null {
  if (!body || !Array.isArray(body.ids)) return null

  const ids: string[] = []
  const seen = new Set<string>()
  for (const raw of body.ids) {
    if (typeof raw !== 'string') return null
    const id = raw.trim()
    if (!id) return null
    if (seen.has(id)) continue
    ids.push(id)
    seen.add(id)
  }
  return ids
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
  const mode =
    response && typeof response === 'object' && 'mode' in response
      ? (response as { mode?: unknown }).mode
      : undefined
  emitProtocolMetric(
    'projection_response',
    {
      resource,
      revision,
      ...(typeof mode === 'string' ? { mode } : {}),
      payloadBytes: jsonPayloadBytes(response),
      ...extra,
    },
    logger,
  )
}
