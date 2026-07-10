import type { DatabaseSync } from 'node:sqlite'
import type { FastifyInstance, FastifyReply } from 'fastify'
import type { AuthState } from '../auth.js'
import { requireAuth } from '../http.js'
import { getSchemaState } from '../db.js'
import {
  MODEL_PRESET_FIELDS,
  PROMPT_PRESET_FIELDS,
  PROMPT_PRESET_MODEL_OTHERS_OVERRIDE_FIELDS,
  PROMPT_PRESET_MODEL_PARAMETER_OVERRIDE_FIELDS,
  databaseKeyForModelPresetField,
  type ModelPresetField,
  type PromptPresetField,
  type PromptPresetModelOverrideField,
  type PromptPresetModelParameterOverrideField,
  type PromptPresetModelOthersOverrideField,
} from '../../../../src/ts/presetSplit.js'
import {
  loadCharacterSelectionProjection,
  loadCharacterLorebookHydration,
  loadCharacterLorebookHydrations,
  loadChatHydration,
  loadChatHydrationRange,
  loadChatHydrations,
  loadGenerationChatHydration,
  loadPersistedDatabaseFields,
  loadPresetHydration,
  loadSingleCharacterStubRow,
  loadStubbedProjectionFields,
} from '../repository.js'
import { maskProviderSecrets, maskProviderSecretsInPlace } from '../providerSecrets.js'
import { emitProtocolMetric, jsonPayloadBytes } from '../protocolMetrics.js'
import { SETTINGS_GROUP_KEYS, type SettingsGroup } from './commands.js'

function promptPresetProjectionField(field: PromptPresetField): string {
  if (field === 'regex' || field === 'presetRegex') return 'presetRegex'
  return field
}

function modelPresetProjectionField(field: ModelPresetField): string {
  return databaseKeyForModelPresetField(field)
}

function modelOverrideProjectionField(
  field:
    | PromptPresetModelOverrideField
    | PromptPresetModelParameterOverrideField
    | PromptPresetModelOthersOverrideField,
): string {
  return databaseKeyForModelPresetField(field)
}

function uniqueProjectionFields(fields: readonly string[]): string[] {
  return Array.from(new Set(fields))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

const PROMPT_PRESET_PROJECTION_FIELDS = uniqueProjectionFields([
  'promptPresets',
  'promptPresetsId',
  ...PROMPT_PRESET_FIELDS.map(promptPresetProjectionField),
  ...PROMPT_PRESET_MODEL_PARAMETER_OVERRIDE_FIELDS.map(modelOverrideProjectionField),
  ...PROMPT_PRESET_MODEL_OTHERS_OVERRIDE_FIELDS.map(modelOverrideProjectionField),
])

const MODEL_PRESET_PROJECTION_FIELDS = uniqueProjectionFields([
  'modelPresets',
  'modelPresetsId',
  ...MODEL_PRESET_FIELDS.map(modelPresetProjectionField),
])

// Targeted per-resource projection.
//
// Maps a command-event `resource` to the set of top-level `database` keys it
// owns, so a *foreign* command event can refresh only those keys instead of
// replacing the whole projection. The map is derived from what each resource's
// server command handler writes; it is deliberately generous (a command that
// cross-writes a sibling array lists both keys) so a targeted refresh never
// under-applies. Group-keyed `settings` events use their authoritative command
// group below; historical settings events without that id, resources whose
// state still sprawls across server-owned state (`state`), and any resource not
// listed fall back to a full bootstrap (`mode: 'full'`), which is correct and
// self-healing.
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
  // Ordinary message events are handled by a per-chat branch below; this empty
  // field mapping marks them as narrowable for fallback classification.
  message: [],
  generation: ['characters'],
  // Character scripts/triggers write only a character row's
  // customscript/triggerscript; the cross-module repair is validate-only, so a
  // foreign refresh ships `characters` (not `modules`). The module
  // scripts/triggers routes emit the module-scoped resources below.
  scriptDefinition: ['characters'],
  triggerDefinition: ['characters'],
  // Module scripts/triggers rewrite only the `modules` table (character repairs
  // validate-only), so a foreign refresh ships just `modules`.
  moduleScriptDefinition: ['modules'],
  moduleTriggerDefinition: ['modules'],
  // Global-lorebook commands (create/patch/delete/reorder/select/entries) change
  // only the global lorebook collection + page pointer.
  globalLorebook: ['loreBook', 'loreBookPage'],
  // Legacy/recovery only: no live command still emits `lorebook` (the global
  // commands moved to `globalLorebook`; the character/chat/module lorebook-entry
  // commands moved to characterLorebook/chat/moduleUpdated). Kept broad so a
  // replayed historical `lorebook` event from an older event log still applies.
  lorebook: ['characters', 'modules', 'loreBook', 'loreBookPage'],
  preset: ['botPresets', 'botPresetsId'],
  // Selecting, deleting, or updating the selected model preset also applies
  // its fields (then the selected prompt preset's model overrides) to root
  // settings. Ship that effective surface with the collection and pointer.
  modelPreset: MODEL_PRESET_PROJECTION_FIELDS,
  // Prompt-preset select/update commands apply the selected preset onto root
  // prompt/model-adjacent settings, and may also replace the promptTemplate
  // collection. Refresh the applied surface, not just the preset pointer.
  promptPreset: PROMPT_PRESET_PROJECTION_FIELDS,
  legacyBotPreset: ['botPresets', 'botPresetsId', 'modelPresets', 'modelPresetsId', 'promptPresets', 'promptPresetsId'],
  modelProfile: ['modelProfiles', 'modelRoleProfiles', 'modelRuntimeDefaults'],
  agentPreset: ['agentPresets', 'agentPresetDefaultId'],
  // Preset deletion can atomically clear chat-scoped selections and loadout
  // references in addition to the settings-backed preset collection.
  agentPresetDeleted: ['agentPresets', 'agentPresetDefaultId', 'characters', 'loadouts'],
  // `prompt` writes scattered settings scalars, so it full-bootstraps via
  // SPRAWLING_FULL_PROJECTION_RESOURCES. Prompt-item commands edit the
  // `promptTemplate` collection, so foreign refreshes reship that field.
  promptItem: ['promptTemplate'],
  // persona select/delete also mirror the legacy profile scalars into settings
  // (when mirrorLegacyProfile is on), so a foreign refresh must reship them too.
  persona: ['personas', 'selectedPersona', 'username', 'userIcon', 'personaPrompt', 'userNote'],
  // `module` (create/delete) stays broad: create can normalize sibling arrays
  // and delete cross-writes characters/chats/loadouts via removeModuleReferences.
  // Update/enable/reorder commands emit module-scoped resources below, so
  // one-row edits stay narrow.
  module: ['modules', 'enabledModules', 'loadouts', 'characters'],
  moduleUpdated: ['modules'],
  moduleReordered: ['modules'],
  moduleEnabled: ['enabledModules'],
  plugin: ['plugins', 'currentPluginProvider'],
  // loadout touch/delete also write the `lastLoadedLoadoutName` settings scalar,
  // so a foreign refresh must reship it alongside the loadouts collection.
  loadout: ['loadouts', 'lastLoadedLoadoutName'],
  translatorPreset: ['translatorPresets', 'translatorPresetId', 'translatorPrompt', 'translatorMaxResponse'],
  // Generation assembly projections have a dedicated composite response below;
  // listing the resource here keeps fallback metrics from misclassifying it as
  // an unknown full-bootstrap resource.
  generationAssembly: [],
  // `asset.created` bumps the global revision but does not change the projected
  // `database` (asset metadata lives outside it), so its targeted refresh is a
  // no-op that only advances the client's revision cursor.
  asset: [],
}

const NARROW_FIELD_PROJECTION_RESOURCES = new Set([
  'settings',
  'preset',
  'modelPreset',
  'promptPreset',
  'legacyBotPreset',
  'promptItem',
  'persona',
  'translatorPreset',
  'loadout',
  'plugin',
])

// Resources whose projected state intentionally sprawls across many top-level
// settings scalars or server-owned state, so the projection route cannot narrow
// them and returns `mode: 'full'` on purpose. `settings` remains in this set for
// historical or malformed events without a recognized command-group id; valid
// grouped events are narrowed by resourceProjectionFields. Any other unlisted
// resource also falls back to full bootstrap, but as an *unknown* (typically foreign)
// resource rather than a known sprawling one. The measurement distinguishes the
// two so targeted-resource metrics can tell an expected sprawling
// fallback from an unexpected unknown-resource fallback.
const SPRAWLING_FULL_PROJECTION_RESOURCES = new Set([
  'settings',
  'state',
  'pluginStorage',
  // `prompt` (prompt-settings) writes ~21 scattered settings scalars; a foreign
  // refresh must full-bootstrap rather than enumerate them.
  'prompt',
])

export type FullBootstrapFallbackClass = 'sprawling' | 'unknown'

/**
 * Classifies why a resource falls back to a full-bootstrap projection. Returns
 * `null` for resources the route can narrow (they never trigger the fallback).
 */
export function fullBootstrapFallbackClass(resource: string, id?: string): FullBootstrapFallbackClass | null {
  if (resourceProjectionFields(resource, id) !== null) return null
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

export function resourceProjectionFields(resource: string, id?: string): readonly string[] | null {
  if (
    resource === 'settings' &&
    typeof id === 'string' &&
    Object.prototype.hasOwnProperty.call(SETTINGS_GROUP_KEYS, id)
  ) {
    return SETTINGS_GROUP_KEYS[id as SettingsGroup]
  }
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
  const requireProjectionAuth = async (req: Parameters<typeof requireAuth>[1], reply: FastifyReply) => {
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
      const hydration = loadChatHydrations(db, dataDir, chatIds, { includeAlternates: false })
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

  app.get<{
    Params: { resource: string }
    Querystring: {
      id?: string
      parentId?: string
      start?: string
      limit?: string
      tail?: string
    }
  }>('/api/v1/projection/:resource', { exposeHeadRoute: false }, async (req, reply) => {
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
      const range = readChatMessageRange(req.query)
      if (range === 'invalid') {
        reply.code(400).send({
          error: 'invalid_chat_message_range',
          reason: 'Expected tail, or start and limit, to be positive integers.',
        })
        return
      }
      if (range) {
        const hydration = loadChatHydrationRange(db, dataDir, chatId, range)
        const response = {
          revision,
          resource,
          mode: 'chat-messages' as const,
          chatId,
          message: hydration.message,
          hypaV3Data: hydration.hypaV3Data,
          messageStart: hydration.messageStart,
          messageTotal: hydration.messageTotal,
          // Preserved reroll candidates. Present, possibly empty; the client
          // uses them to seed reroll/swipe state after hydration.
          alternates: hydration.alternates,
        }
        emitProjectionMetric(req.log, resource, revision, response, {
          id: chatId,
          messageStart: hydration.messageStart,
          messageTotal: hydration.messageTotal,
          returnedCount: hydration.message.length,
        })
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
        // Preserved reroll candidates. Present, possibly empty; the client
        // uses them to seed reroll/swipe state after hydration.
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

    // Per-character row: character field edits, module-link reorders, and chat
    // / chat-folder metadata edits each write a single character row. A foreign
    // refresh ships just that character (message-free, masked) instead of the
    // whole `characters` array. The character id is `parentId` for chat/folder
    // events (which key by chatId/folderId) and `id` for character events.
    if (resource === 'characterRow') {
      const characterId =
        typeof req.query.parentId === 'string' && req.query.parentId.trim() !== '' ? req.query.parentId : req.query.id
      if (typeof characterId !== 'string' || characterId.trim() === '') {
        const response = { revision, resource, mode: 'full' as const }
        emitProjectionMetric(req.log, resource, revision, response)
        return response
      }
      const character = loadSingleCharacterRow(db, dataDir, characterId)
      if (!character) {
        reply.code(404).send({
          error: 'character_not_found',
          reason: `Character not found: ${characterId}`,
        })
        return
      }
      const response = {
        revision,
        resource,
        mode: 'character-row' as const,
        characterId,
        character,
      }
      emitProjectionMetric(req.log, resource, revision, response, { id: characterId })
      return response
    }

    // Assembly-time input transforms can persist a rewritten transcript and
    // chat scriptstate in the same revision. Reconcile both pieces together;
    // neither the row-only nor message-only projection is sufficient.
    if (resource === 'generationAssembly') {
      const chatId = req.query.id
      const characterId = req.query.parentId
      if (
        typeof chatId !== 'string' ||
        chatId.trim() === '' ||
        typeof characterId !== 'string' ||
        characterId.trim() === ''
      ) {
        const response = { revision, resource, mode: 'full' as const }
        emitProjectionMetric(req.log, resource, revision, response)
        return response
      }
      const character = loadSingleCharacterRow(db, dataDir, characterId)
      const chats = (character as { chats?: Array<{ id?: unknown }> } | null)?.chats
      if (!character || !Array.isArray(chats) || !chats.some((chat) => chat?.id === chatId)) {
        reply.code(404).send({
          error: 'generation_assembly_target_not_found',
          reason: `Chat ${chatId} was not found under character ${characterId}.`,
        })
        return
      }
      const hydration = loadChatHydration(db, dataDir, chatId)
      const response = {
        revision,
        resource,
        mode: 'generation-assembly' as const,
        characterId,
        character,
        chatId,
        message: hydration.message,
        hypaV3Data: hydration.hypaV3Data,
        alternates: hydration.alternates,
      }
      emitProjectionMetric(req.log, resource, revision, response, {
        id: chatId,
        characterId,
        returnedCount: hydration.message.length,
      })
      return response
    }

    // Ordinary message commands only change one chat's message rows. Delete,
    // truncate, and replace events do not carry a surviving anchor/range, and a
    // same-length replacement can change any row, so ship the complete affected
    // transcript rather than an unsafe tail window.
    if (resource === 'message') {
      const chatId = req.query.parentId
      if (typeof chatId === 'string' && chatId.trim() !== '') {
        const hydration = loadChatHydration(db, dataDir, chatId)
        const response = {
          revision,
          resource,
          mode: 'chat-messages' as const,
          chatId,
          message: hydration.message,
          hypaV3Data: hydration.hypaV3Data,
          alternates: hydration.alternates,
        }
        emitProjectionMetric(req.log, resource, revision, response, {
          id: chatId,
          returnedCount: hydration.message.length,
        })
        return response
      }
    }

    // Per-chat generation: `generation.persisted` is the one foreign-firing
    // command (server-owned post-generation). It only changes one chat's
    // messages, so ship that chat's message tail (keyed by the event's
    // `parentId` = chatId) instead of re-stubbing every character. Without a
    // chat id (e.g. a recovery fetch) it falls through to the broad fields path.
    if (resource === 'generation') {
      const chatId = req.query.parentId
      if (typeof chatId === 'string' && chatId.trim() !== '') {
        const messageId = typeof req.query.id === 'string' && req.query.id.trim() !== '' ? req.query.id : undefined
        const hydration = loadGenerationChatHydration(db, dataDir, chatId, messageId)
        const response = {
          revision,
          resource,
          mode: 'generation-chat' as const,
          chatId,
          message: hydration.message,
          hypaV3Data: hydration.hypaV3Data,
          messageStart: hydration.messageStart,
          messageTotal: hydration.messageTotal,
          alternates: hydration.alternates,
        }
        emitProjectionMetric(req.log, resource, revision, response, {
          id: chatId,
          messageStart: hydration.messageStart,
          messageTotal: hydration.messageTotal,
          returnedCount: hydration.message.length,
        })
        return response
      }
    }

    // Per-preset hydration fills bootstrap/list stubs when a client needs
    // promptTemplate or the full generation settings for a preset switch/diff.
    if (resource === 'preset') {
      const presetId = req.query.id
      if (typeof presetId === 'string' && presetId.trim() !== '') {
        const hydration = loadPresetHydration(db, dataDir, presetId)
        if (!hydration) {
          reply.code(404).send({
            error: 'preset_not_found',
            reason: `Preset not found: ${presetId}`,
          })
          return
        }
        const response = {
          revision,
          resource,
          mode: 'preset' as const,
          presetId,
          preset: maskProviderSecrets(hydration.preset),
        }
        emitProjectionMetric(req.log, resource, revision, response, { id: presetId })
        return response
      }
    }

    if (resource === 'promptItem') {
      const fields = loadPersistedDatabaseFields(db, dataDir, [
        'botPresets',
        'promptPresets',
        'promptPresetsId',
        'promptTemplate',
      ])
      const ownerId =
        typeof req.query.parentId === 'string' && req.query.parentId.trim() !== '' ? req.query.parentId : null
      const promptPresets = Array.isArray(fields.promptPresets) ? fields.promptPresets : []
      const requestedPreset = ownerId
        ? promptPresets.find((preset) => isRecord(preset) && preset.id === ownerId)
        : undefined
      const selectedPreset =
        ownerId === null && Number.isInteger(fields.promptPresetsId)
          ? promptPresets[fields.promptPresetsId as number]
          : undefined
      const targetPreset = ownerId ? requestedPreset : selectedPreset

      if (ownerId && !requestedPreset) {
        reply.code(404).send({
          error: 'prompt_preset_not_found',
          reason: `Prompt preset not found: ${ownerId}`,
        })
        return
      }

      const promptItemFields: Record<string, unknown> = {}
      if (isRecord(targetPreset)) {
        if (
          ownerId === null &&
          isDefaultPromptPresetScaffold(targetPreset) &&
          Object.prototype.hasOwnProperty.call(fields, 'promptTemplate')
        ) {
          promptItemFields.promptTemplate = hasLegacyBotPresetTemplates(fields) ? null : fields.promptTemplate
        } else if (ownerId !== null || !isDefaultPromptPresetScaffold(targetPreset)) {
          promptItemFields.promptTemplate = Object.prototype.hasOwnProperty.call(targetPreset, 'promptTemplate')
            ? targetPreset.promptTemplate
            : null
        }
      } else if (Object.prototype.hasOwnProperty.call(fields, 'promptTemplate')) {
        promptItemFields.promptTemplate = fields.promptTemplate
      }

      const response = { revision, resource, mode: 'fields' as const, fields: maskProviderSecrets(promptItemFields) }
      emitProjectionMetric(req.log, resource, revision, response, {
        fieldCount: Object.keys(promptItemFields).length,
        fieldKeys: ['promptTemplate'],
        ...(ownerId ? { parentId: ownerId } : {}),
      })
      return response
    }

    const fieldKeys = resourceProjectionFields(resource, req.query.id)

    if (fieldKeys === null) {
      // Unknown or sprawling resource: tell the client to full-bootstrap. The
      // opt-in metric records whether this is an expected sprawling resource
      // (`settings`, `state`, `pluginStorage`) or an unknown one so the cost
      // of these fallbacks can be attributed per resource.
      const response = { revision, resource, mode: 'full' as const }
      emitProjectionMetric(req.log, resource, revision, response, {
        fallbackClass: fullBootstrapFallbackClass(resource, req.query.id),
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
      : maskProviderSecrets(loadStubbedProjectionFields(db, dataDir, fieldKeys))
    if (resource === 'preset') {
      const projected = loadStubbedProjectionFields(db, dataDir, fieldKeys)
      fields.botPresets = projected.botPresets
    }
    if (resource === 'promptPreset') {
      projectEmptyAppliedPromptTemplate(fields)
    }

    const response = { revision, resource, mode: 'fields' as const, fields }
    emitProjectionMetric(req.log, resource, revision, response, {
      fieldCount: Object.keys(fields).length,
      fieldKeys,
    })
    return response
  })
}

function invalidBulkChatIdsReply(reply: FastifyReply): void {
  reply.code(400).send({
    error: 'invalid_chat_ids',
    reason: 'Expected body.ids to be an array of non-empty chat ids.',
  })
}

async function validateBulkChatIdsEnvelope(req: { body?: unknown }, reply: FastifyReply): Promise<void> {
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

async function validateBulkCharacterLorebookIdsEnvelope(req: { body?: unknown }, reply: FastifyReply): Promise<void> {
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

function projectEmptyAppliedPromptTemplate(fields: Record<string, unknown>): void {
  if (Object.prototype.hasOwnProperty.call(fields, 'promptTemplate')) return
  const presets = fields.promptPresets
  const selectedIndex = fields.promptPresetsId
  if (!Array.isArray(presets) || !Number.isInteger(selectedIndex)) return

  const selectedPreset = presets[selectedIndex as number]
  if (isRecord(selectedPreset) && Object.prototype.hasOwnProperty.call(selectedPreset, 'promptTemplate')) {
    fields.promptTemplate = []
  }
}

function isDefaultPromptPresetScaffold(preset: Record<string, unknown>): boolean {
  return preset.id === 'default-prompt-preset' && preset.name === 'Default Prompt'
}

function hasLegacyBotPresetTemplates(fields: Record<string, unknown>): boolean {
  const botPresets = fields.botPresets
  return (
    Array.isArray(botPresets) &&
    botPresets.some((preset) => isRecord(preset) && Object.prototype.hasOwnProperty.call(preset, 'promptTemplate'))
  )
}

function readPositiveInteger(value: string | undefined): number | null {
  if (value === undefined) return null
  if (!/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function readNonNegativeInteger(value: string | undefined): number | null {
  if (value === undefined) return null
  if (!/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

function readChatMessageRange(query: {
  start?: string
  limit?: string
  tail?: string
}): { start?: number; limit?: number; tail?: number } | 'invalid' | null {
  const hasTail = query.tail !== undefined
  const hasStart = query.start !== undefined
  const hasLimit = query.limit !== undefined
  if (!hasTail && !hasStart && !hasLimit) return null
  if (hasTail && (hasStart || hasLimit)) return 'invalid'

  if (hasTail) {
    const tail = readPositiveInteger(query.tail)
    return tail === null ? 'invalid' : { tail }
  }

  const start = readNonNegativeInteger(query.start)
  const limit = readPositiveInteger(query.limit)
  if (start === null || limit === null) return 'invalid'
  return { start, limit }
}

function loadSingleCharacterRow(
  db: DatabaseSync,
  dataDir: string,
  characterId: string,
): Record<string, unknown> | null {
  // Single-row read one character + its chat rows, stubbed exactly
  // like the broad loader (message-free chats, lorebook stubs). The loader
  // returns a freshly parsed object this route owns, so mask it in place;
  // wrapping it in `{ characters: [...] }` keeps the row under the same
  // root-relative secret paths the whole-database mask applies.
  const character = loadSingleCharacterStubRow(db, dataDir, characterId)
  if (!character) return null
  return maskProviderSecretsInPlace({ characters: [character] }).characters[0]
}

function emitProjectionMetric(
  logger: FastifyInstance['log'],
  resource: string,
  revision: number,
  response: unknown,
  extra: Record<string, unknown> = {},
): void {
  // Thunk `jsonPayloadBytes` re-serializes the full response, so
  // the fields must only be built after the metrics-enabled guard.
  emitProtocolMetric(
    'projection_response',
    () => {
      const mode =
        response && typeof response === 'object' && 'mode' in response
          ? (response as { mode?: unknown }).mode
          : undefined
      return {
        resource,
        revision,
        ...(typeof mode === 'string' ? { mode } : {}),
        payloadBytes: jsonPayloadBytes(response),
        ...extra,
      }
    },
    logger,
  )
}
