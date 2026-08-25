import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { SERVER_CHARACTER_SUMMARY_VERSION } from '../../../../src/ts/server/characterSummaryProtocol.js'
import {
  SERVER_SHELL_PROTOCOL_VERSION,
  SERVER_SHELL_SETTINGS_KEYS,
  type ServerShellSettings,
} from '../../../../src/ts/server/shellProtocol.js'
import {
  isServerStandaloneSettingName,
  type ServerStandaloneSettingName,
} from '../../../../src/ts/server/standaloneSettingsProtocol.js'
import type { AuthState } from '../auth.js'
import { getSchemaState } from '../db.js'
import { requireAuth } from '../http.js'
import { maskProviderSecretsInPlace } from '../providerSecrets.js'
import { emitProtocolMetric, jsonPayloadBytes, protocolElapsedMs } from '../protocolMetrics.js'
import { readRequestTraceUid } from '../requestTrace.js'
import { createInitialDatabase } from '../databaseDefaults.js'
import { READABLE_SETTINGS_GROUPS, SETTINGS_GROUP_KEYS, type ReadableSettingsGroup } from './commands.js'
import {
  COLLECTION_FIELDS,
  loadCharacterLorebookHydration,
  loadCharacterLorebookHydrations,
  loadCharacterSelectionProjection,
  loadCharacterSummariesForRead,
  loadCharacterRowsForRead,
  loadChatHydration,
  loadChatHydrationRange,
  loadChatHydrations,
  loadGenerationChatHydration,
  listInlayCatalogEntries,
  loadPersistedDatabaseFields,
  loadPresetHydration,
  loadSettingsFromSqlite,
  loadSettingsWithTranslatorPresetsFromSqlite,
  loadSingleCharacterRowForRead,
  ValidationError,
} from '../repository.js'
import { listSourceValidGreetingTranslations } from '../translation/greetingTranslationStore.js'
import { resolveRawMessageTranslatorIdentity } from '../translation/rawMessageTranslation.js'

const PLUGIN_STORAGE_COLLECTION = 'pluginCustomStorage' as const
const READABLE_COLLECTION_NAMES = [...COLLECTION_FIELDS, PLUGIN_STORAGE_COLLECTION] as const
type ReadableCollectionName = (typeof READABLE_COLLECTION_NAMES)[number]
const READABLE_COLLECTION_NAME_SET = new Set<string>(READABLE_COLLECTION_NAMES)
const RESOURCE_CACHE_VERSION = 2 as const
const RESOURCE_CACHE_ALGORITHM = 'sha256' as const
const RESOURCE_CACHE_MAX_HASHES = 10_000
const RESOURCE_CACHE_MAX_BODY_BYTES = 1024 * 1024
export const BULK_RESOURCE_MAX_IDS = 32
export const BULK_RESOURCE_MAX_BODY_BYTES = 64 * 1024
const SHA256_HEX_RE = /^[a-f0-9]{64}$/
const RESOURCE_CACHE_METADATA = {
  version: RESOURCE_CACHE_VERSION,
  algorithm: RESOURCE_CACHE_ALGORITHM,
} as const
const LEGACY_BOT_PRESET_SHELL_FIELDS = [
  'id',
  'name',
  'image',
  'metadata',
  'customPromptTemplateToggle',
  'moduleIntergration',
] as const
const DEFAULT_SHELL_DATABASE = createInitialDatabase()

interface ChatMessageRangeQuery {
  start?: string
  limit?: string
  tail?: string
  generationMessageId?: string
}

interface ParsedResourceCacheRequest {
  hashes: ReadonlyMap<string, ReadonlySet<string>>
}

interface CacheSubstitutionResult<T = unknown> {
  value: T
  hits: number
  misses: number
}

type PromptPresetTemplateReadResult =
  | { status: 'not-found' }
  | { status: 'ambiguous' }
  | {
      status: 'found'
      promptTemplate: unknown
      selectedFallbackPromptTemplate?: unknown
    }

export function registerResourceReadRoutes(
  app: FastifyInstance,
  db: DatabaseSync,
  authState: AuthState,
  dataDir: string,
): void {
  const requireReadAuth = async (req: Parameters<typeof requireAuth>[1], reply: FastifyReply) => {
    await requireAuth(authState, req, reply)
  }
  const cacheReadRouteOptions = () => ({
    onRequest: requireReadAuth,
    bodyLimit: RESOURCE_CACHE_MAX_BODY_BYTES,
  })

  app.get('/api/v1/settings', { exposeHeadRoute: false }, async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return
    const { revision } = getSchemaState(db)
    const settings = loadSettingsFromSqlite(db)
    return metricResourceResponse(req, reply, 'settings', revision, {
      revision,
      settings: maskProviderSecretsInPlace(settings ?? {}),
    })
  })

  app.get('/api/v1/resources/shell', { exposeHeadRoute: false }, async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return
    const { revision } = getSchemaState(db)
    const persistedSettings = loadPersistedDatabaseFields(db, dataDir, SERVER_SHELL_SETTINGS_KEYS)
    const settings = Object.fromEntries(
      SERVER_SHELL_SETTINGS_KEYS.map((key) => [
        key,
        Object.prototype.hasOwnProperty.call(persistedSettings, key)
          ? persistedSettings[key]
          : DEFAULT_SHELL_DATABASE[key],
      ]),
    ) as ServerShellSettings
    const characterSettings = loadPersistedDatabaseFields(db, dataDir, ['characterOrder', 'currentChar'])
    return metricResourceResponse(req, reply, 'shell', revision, {
      protocolVersion: SERVER_SHELL_PROTOCOL_VERSION,
      revision,
      settings,
      characters: {
        version: SERVER_CHARACTER_SUMMARY_VERSION,
        revision,
        characters: loadCharacterSummariesForRead(db),
        characterOrder: Array.isArray(characterSettings.characterOrder) ? characterSettings.characterOrder : [],
        currentChar: Number.isInteger(characterSettings.currentChar) ? characterSettings.currentChar : -1,
      },
    })
  })

  app.get<{ Params: { setting: string } }>(
    '/api/v1/resources/settings/:setting',
    { exposeHeadRoute: false },
    async (req, reply) => {
      if (!(await requireAuth(authState, req, reply))) return
      if (!isServerStandaloneSettingName(req.params.setting)) {
        reply.code(404).send({
          error: 'standalone_setting_not_found',
          reason: `Unknown standalone setting: ${req.params.setting}`,
        })
        return
      }
      const setting = req.params.setting as ServerStandaloneSettingName
      const { revision } = getSchemaState(db)
      const persisted = loadPersistedDatabaseFields(db, dataDir, [setting])
      const present = Object.prototype.hasOwnProperty.call(persisted, setting)
      return metricResourceResponse(
        req,
        reply,
        'settings',
        revision,
        {
          revision,
          setting,
          state: present ? { present: true, value: persisted[setting] } : { present: false },
        },
        { setting },
      )
    },
  )

  app.get('/api/v1/inlay-assets', { exposeHeadRoute: false }, async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return
    const { revision } = getSchemaState(db)
    return metricResourceResponse(req, reply, 'inlayCatalog', revision, {
      revision,
      assets: listInlayCatalogEntries(db),
    })
  })

  app.post<{ Body: unknown }>('/api/v1/settings', cacheReadRouteOptions(), async (req, reply) => {
    const cacheRequest = parseResourceCacheRequest(req.body, ['settings'])
    if (typeof cacheRequest === 'string') {
      return sendInvalidResourceCacheRequest(reply, cacheRequest)
    }
    const { revision } = getSchemaState(db)
    const settings = maskProviderSecretsInPlace(loadSettingsFromSqlite(db) ?? {})
    const substitution = substituteCachedValue(settings, cacheRequest.hashes.get('settings'))
    return metricResourceResponse(
      req,
      reply,
      'settings',
      revision,
      {
        revision,
        cache: RESOURCE_CACHE_METADATA,
        settings: substitution.value,
      },
      cacheMetricFields(substitution),
    )
  })

  app.get<{ Params: { group: string } }>('/api/v1/settings/:group', { exposeHeadRoute: false }, async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return
    if (!READABLE_SETTINGS_GROUPS.includes(req.params.group as ReadableSettingsGroup)) {
      reply.code(404).send({
        error: 'settings_group_not_found',
        reason: `Unknown settings group: ${req.params.group}`,
      })
      return
    }
    const group = req.params.group as ReadableSettingsGroup
    const { revision } = getSchemaState(db)
    return metricResourceResponse(
      req,
      reply,
      'settings',
      revision,
      {
        revision,
        group,
        settings: loadSettingsGroup(db, dataDir, group),
      },
      { group },
    )
  })

  app.post<{ Params: { group: string }; Body: unknown }>(
    '/api/v1/settings/:group',
    cacheReadRouteOptions(),
    async (req, reply) => {
      if (!READABLE_SETTINGS_GROUPS.includes(req.params.group as ReadableSettingsGroup)) {
        reply.code(404).send({
          error: 'settings_group_not_found',
          reason: `Unknown settings group: ${req.params.group}`,
        })
        return
      }
      const cacheRequest = parseResourceCacheRequest(req.body, ['settings'])
      if (typeof cacheRequest === 'string') {
        return sendInvalidResourceCacheRequest(reply, cacheRequest)
      }
      const group = req.params.group as ReadableSettingsGroup
      const { revision } = getSchemaState(db)
      const substitution = substituteCachedValue(
        loadSettingsGroup(db, dataDir, group),
        cacheRequest.hashes.get('settings'),
      )
      return metricResourceResponse(
        req,
        reply,
        'settings',
        revision,
        {
          revision,
          group,
          cache: RESOURCE_CACHE_METADATA,
          settings: substitution.value,
        },
        { group, ...cacheMetricFields(substitution) },
      )
    },
  )

  app.get('/api/v1/collections', { exposeHeadRoute: false }, async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return
    const { revision } = getSchemaState(db)
    return metricResourceResponse(req, reply, 'collections', revision, {
      revision,
      collections: loadCollections(db, dataDir, READABLE_COLLECTION_NAMES, {
        suppressSelectedPromptTemplateProjection: true,
      }),
    })
  })

  app.post<{ Body: unknown }>('/api/v1/collections', cacheReadRouteOptions(), async (req, reply) => {
    const cacheRequest = parseResourceCacheRequest(req.body, READABLE_COLLECTION_NAMES)
    if (typeof cacheRequest === 'string') {
      return sendInvalidResourceCacheRequest(reply, cacheRequest)
    }
    const { revision } = getSchemaState(db)
    const substitution = substituteCachedCollections(
      loadCollections(db, dataDir, READABLE_COLLECTION_NAMES, {
        suppressSelectedPromptTemplateProjection: true,
      }),
      cacheRequest,
    )
    return metricResourceResponse(
      req,
      reply,
      'collections',
      revision,
      {
        revision,
        cache: RESOURCE_CACHE_METADATA,
        collections: substitution.value,
      },
      cacheMetricFields(substitution),
    )
  })

  app.get<{ Params: { name: string } }>('/api/v1/collections/:name', { exposeHeadRoute: false }, async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return
    if (!isReadableCollectionName(req.params.name)) {
      reply.code(404).send({
        error: 'collection_not_found',
        reason: `Unknown collection: ${req.params.name}`,
      })
      return
    }
    const { revision } = getSchemaState(db)
    return metricResourceResponse(
      req,
      reply,
      'collection',
      revision,
      {
        revision,
        collections: loadCollections(db, dataDir, [req.params.name]),
      },
      { collection: req.params.name },
    )
  })

  app.post<{ Params: { name: string }; Body: unknown }>(
    '/api/v1/collections/:name',
    cacheReadRouteOptions(),
    async (req, reply) => {
      if (!isReadableCollectionName(req.params.name)) {
        reply.code(404).send({
          error: 'collection_not_found',
          reason: `Unknown collection: ${req.params.name}`,
        })
        return
      }
      const cacheRequest = parseResourceCacheRequest(req.body, [req.params.name])
      if (typeof cacheRequest === 'string') {
        return sendInvalidResourceCacheRequest(reply, cacheRequest)
      }
      const { revision } = getSchemaState(db)
      const substitution = substituteCachedCollections(loadCollections(db, dataDir, [req.params.name]), cacheRequest)
      return metricResourceResponse(
        req,
        reply,
        'collection',
        revision,
        {
          revision,
          cache: RESOURCE_CACHE_METADATA,
          collections: substitution.value,
        },
        { collection: req.params.name, ...cacheMetricFields(substitution) },
      )
    },
  )

  app.get('/api/v1/characters/aggregate', { exposeHeadRoute: false }, async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return
    const { revision } = getSchemaState(db)
    const settings = loadPersistedDatabaseFields(db, dataDir, ['characterOrder', 'currentChar'])
    const characterEnvelope = maskProviderSecretsInPlace({ characters: loadCharacterRowsForRead(db, dataDir) })
    return metricResourceResponse(req, reply, 'characters', revision, {
      revision,
      characters: characterEnvelope.characters,
      characterOrder: Array.isArray(settings.characterOrder) ? settings.characterOrder : [],
      currentChar: Number.isInteger(settings.currentChar) ? settings.currentChar : -1,
    })
  })

  app.post<{ Body: unknown }>('/api/v1/characters/aggregate', cacheReadRouteOptions(), async (req, reply) => {
    const cacheRequest = parseResourceCacheRequest(req.body, ['characters'])
    if (typeof cacheRequest === 'string') {
      return sendInvalidResourceCacheRequest(reply, cacheRequest)
    }
    const { revision } = getSchemaState(db)
    const settings = loadPersistedDatabaseFields(db, dataDir, ['characterOrder', 'currentChar'])
    const characterEnvelope = maskProviderSecretsInPlace({ characters: loadCharacterRowsForRead(db, dataDir) })
    const substitution = substituteCachedArray(characterEnvelope.characters, cacheRequest.hashes.get('characters'))
    return metricResourceResponse(
      req,
      reply,
      'characters',
      revision,
      {
        revision,
        cache: RESOURCE_CACHE_METADATA,
        characters: substitution.value,
        characterOrder: Array.isArray(settings.characterOrder) ? settings.characterOrder : [],
        currentChar: Number.isInteger(settings.currentChar) ? settings.currentChar : -1,
      },
      cacheMetricFields(substitution),
    )
  })

  app.get('/api/v1/characters', { exposeHeadRoute: false }, async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return
    const { revision } = getSchemaState(db)
    const settings = loadPersistedDatabaseFields(db, dataDir, ['characterOrder', 'currentChar'])
    return metricResourceResponse(req, reply, 'characters', revision, {
      version: SERVER_CHARACTER_SUMMARY_VERSION,
      revision,
      characters: loadCharacterSummariesForRead(db),
      characterOrder: Array.isArray(settings.characterOrder) ? settings.characterOrder : [],
      currentChar: Number.isInteger(settings.currentChar) ? settings.currentChar : -1,
    })
  })

  app.post<{ Body: unknown }>('/api/v1/characters', cacheReadRouteOptions(), async (req, reply) => {
    const cacheRequest = parseResourceCacheRequest(req.body, ['characters'])
    if (typeof cacheRequest === 'string') {
      return sendInvalidResourceCacheRequest(reply, cacheRequest)
    }
    const { revision } = getSchemaState(db)
    const settings = loadPersistedDatabaseFields(db, dataDir, ['characterOrder', 'currentChar'])
    const substitution = substituteCachedArray(loadCharacterSummariesForRead(db), cacheRequest.hashes.get('characters'))
    return metricResourceResponse(
      req,
      reply,
      'characters',
      revision,
      {
        version: SERVER_CHARACTER_SUMMARY_VERSION,
        revision,
        cache: RESOURCE_CACHE_METADATA,
        characters: substitution.value,
        characterOrder: Array.isArray(settings.characterOrder) ? settings.characterOrder : [],
        currentChar: Number.isInteger(settings.currentChar) ? settings.currentChar : -1,
      },
      cacheMetricFields(substitution),
    )
  })

  app.get('/api/v1/characters/order', { exposeHeadRoute: false }, async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return
    const { revision } = getSchemaState(db)
    const settings = loadPersistedDatabaseFields(db, dataDir, ['characterOrder'])
    return metricResourceResponse(req, reply, 'characterOrder', revision, {
      revision,
      characterOrder: Array.isArray(settings.characterOrder) ? settings.characterOrder : [],
    })
  })

  app.get<{ Params: { id: string } }>(
    '/api/v1/characters/:id/selection',
    { exposeHeadRoute: false },
    async (req, reply) => {
      if (!(await requireAuth(authState, req, reply))) return
      const selection = loadCharacterSelectionProjection(db, req.params.id)
      if (!selection) {
        reply.code(404).send({
          error: 'character_not_found',
          reason: `Character not found: ${req.params.id}`,
        })
        return
      }
      const { revision } = getSchemaState(db)
      return metricResourceResponse(
        req,
        reply,
        'characterSelection',
        revision,
        { revision, ...selection },
        { detailRead: true },
      )
    },
  )

  app.get<{ Params: { id: string } }>('/api/v1/characters/:id', { exposeHeadRoute: false }, async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return
    const character = loadSingleCharacterRowForRead(db, dataDir, req.params.id)
    if (!character) {
      reply.code(404).send({
        error: 'character_not_found',
        reason: `Character not found: ${req.params.id}`,
      })
      return
    }
    const { revision } = getSchemaState(db)
    const envelope = maskProviderSecretsInPlace({ characters: [character] })
    return metricResourceResponse(
      req,
      reply,
      'character',
      revision,
      { revision, character: envelope.characters[0] },
      { detailRead: true },
    )
  })

  app.get<{ Params: { characterId: string } }>(
    '/api/v1/characters/:characterId/greeting-translations',
    { exposeHeadRoute: false },
    async (req, reply) => {
      if (!(await requireAuth(authState, req, reply))) return
      const character = loadSingleCharacterRowForRead(db, dataDir, req.params.characterId)
      if (!character) {
        reply.code(404).send({
          error: 'character_not_found',
          reason: `Character not found: ${req.params.characterId}`,
        })
        return
      }
      const { revision } = getSchemaState(db)
      const settings = loadSettingsWithTranslatorPresetsFromSqlite(db)
      let settingsHash: string | null = null
      if (settings !== null) {
        try {
          settingsHash = resolveRawMessageTranslatorIdentity({ settings, character }).settingsHash
        } catch (error) {
          if (!(error instanceof ValidationError)) throw error
        }
      }
      const translations = settingsHash
        ? listSourceValidGreetingTranslations(db, req.params.characterId, character, settingsHash).map((row) => ({
            greetingIndex: row.greetingIndex,
            translation: row.translation,
          }))
        : []
      return metricResourceResponse(
        req,
        reply,
        'greetingTranslations',
        revision,
        {
          revision,
          characterId: req.params.characterId,
          settingsHash,
          translations,
        },
        { detailRead: true },
      )
    },
  )

  app.get<{ Params: { id: string }; Querystring: ChatMessageRangeQuery }>(
    '/api/v1/chats/:id/messages',
    { exposeHeadRoute: false },
    async (req, reply) => {
      if (!(await requireAuth(authState, req, reply))) return
      const generationMessageId = readGenerationMessageId(req.query)
      if (generationMessageId === 'invalid') {
        reply.code(400).send({
          error: 'invalid_chat_message_range',
          reason:
            'Use generationMessageId=<message id>, tail=<positive integer>, or start=<non-negative integer>&limit=<positive integer>.',
        })
        return
      }
      const range = readChatMessageRange(req.query)
      if (range === 'invalid') {
        reply.code(400).send({
          error: 'invalid_chat_message_range',
          reason: 'Use tail=<positive integer> or start=<non-negative integer>&limit=<positive integer>.',
        })
        return
      }

      const { revision } = getSchemaState(db)
      if (generationMessageId) {
        const hydration = loadGenerationChatHydration(db, dataDir, req.params.id, generationMessageId)
        return metricResourceResponse(
          req,
          reply,
          'chatMessages',
          revision,
          {
            revision,
            chatId: req.params.id,
            message: hydration.message,
            alternates: hydration.alternates,
            messageStart: hydration.messageStart,
            messageTotal: hydration.messageTotal,
          },
          { readMode: 'generation' },
        )
      }
      if (range) {
        const hydration = loadChatHydrationRange(db, dataDir, req.params.id, range)
        return metricResourceResponse(
          req,
          reply,
          'chatMessages',
          revision,
          {
            revision,
            chatId: req.params.id,
            message: hydration.message,
            hypaV3Data: hydration.hypaV3Data,
            alternates: hydration.alternates,
            messageStart: hydration.messageStart,
            messageTotal: hydration.messageTotal,
          },
          { readMode: 'range' },
        )
      }

      const hydration = loadChatHydration(db, dataDir, req.params.id)
      return metricResourceResponse(
        req,
        reply,
        'chatMessages',
        revision,
        {
          revision,
          chatId: req.params.id,
          message: hydration.message,
          hypaV3Data: hydration.hypaV3Data,
          alternates: hydration.alternates,
        },
        { readMode: 'full' },
      )
    },
  )

  app.post<{ Body: { ids?: unknown } }>(
    '/api/v1/chats/messages/bulk',
    { onRequest: requireReadAuth, bodyLimit: BULK_RESOURCE_MAX_BODY_BYTES },
    async (req, reply) => {
      const result = readBulkIds(req.body)
      if (result.status === 'invalid') {
        reply.code(400).send({
          error: 'invalid_chat_ids',
          reason: 'Expected body.ids to be an array of non-empty chat ids.',
        })
        return
      }
      if (result.status === 'too-many') {
        reply.code(413).send({
          error: 'bulk_resource_limit_exceeded',
          maxItems: BULK_RESOURCE_MAX_IDS,
        })
        return
      }
      const chatIds = result.ids
      const { revision } = getSchemaState(db)
      const hydration = loadChatHydrations(db, dataDir, chatIds, { includeAlternates: true })
      return metricResourceResponse(
        req,
        reply,
        'chatMessages',
        revision,
        {
          revision,
          chats: hydration.chats,
          missing: hydration.missing,
        },
        { bulk: true, idCount: chatIds.length },
      )
    },
  )

  app.get<{ Params: { id: string } }>(
    '/api/v1/characters/:id/lorebook',
    { exposeHeadRoute: false },
    async (req, reply) => {
      if (!(await requireAuth(authState, req, reply))) return
      const { revision } = getSchemaState(db)
      const hydration = loadCharacterLorebookHydration(db, dataDir, req.params.id)
      return metricResourceResponse(
        req,
        reply,
        'characterLorebook',
        revision,
        {
          revision,
          characterId: req.params.id,
          globalLore: hydration.globalLore,
        },
        { detailRead: true },
      )
    },
  )

  app.post<{ Params: { id: string }; Body: unknown }>(
    '/api/v1/characters/:id/lorebook',
    cacheReadRouteOptions(),
    async (req, reply) => {
      const cacheRequest = parseResourceCacheRequest(req.body, ['globalLore'])
      if (typeof cacheRequest === 'string') {
        return sendInvalidResourceCacheRequest(reply, cacheRequest)
      }
      const { revision } = getSchemaState(db)
      const hydration = loadCharacterLorebookHydration(db, dataDir, req.params.id)
      const substitution = substituteCachedArray(hydration.globalLore, cacheRequest.hashes.get('globalLore'))
      return metricResourceResponse(
        req,
        reply,
        'characterLorebook',
        revision,
        {
          revision,
          characterId: req.params.id,
          cache: RESOURCE_CACHE_METADATA,
          globalLore: substitution.value,
        },
        { detailRead: true, ...cacheMetricFields(substitution) },
      )
    },
  )

  app.post<{ Body: { ids?: unknown } }>(
    '/api/v1/characters/lorebooks/bulk',
    { onRequest: requireReadAuth, bodyLimit: BULK_RESOURCE_MAX_BODY_BYTES },
    async (req, reply) => {
      const result = readBulkIds(req.body)
      if (result.status === 'invalid') {
        reply.code(400).send({
          error: 'invalid_character_lorebook_ids',
          reason: 'Expected body.ids to be an array of non-empty character ids.',
        })
        return
      }
      if (result.status === 'too-many') {
        reply.code(413).send({
          error: 'bulk_resource_limit_exceeded',
          maxItems: BULK_RESOURCE_MAX_IDS,
        })
        return
      }
      const characterIds = result.ids
      const { revision } = getSchemaState(db)
      const hydration = loadCharacterLorebookHydrations(db, dataDir, characterIds)
      return metricResourceResponse(
        req,
        reply,
        'characterLorebooks',
        revision,
        {
          revision,
          characters: hydration.characters,
          missing: hydration.missing,
        },
        { bulk: true, idCount: characterIds.length },
      )
    },
  )

  app.get<{ Params: { id: string } }>('/api/v1/legacy-presets/:id', { exposeHeadRoute: false }, async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return
    const hydration = loadPresetHydration(db, dataDir, req.params.id)
    if (!hydration) {
      reply.code(404).send({
        error: 'preset_not_found',
        reason: `Preset not found: ${req.params.id}`,
      })
      return
    }
    const { revision } = getSchemaState(db)
    const envelope = maskProviderSecretsInPlace({ botPresets: [hydration.preset] })
    return metricResourceResponse(
      req,
      reply,
      'legacyPreset',
      revision,
      { revision, preset: envelope.botPresets[0] },
      { detailRead: true },
    )
  })

  app.post<{ Params: { id: string }; Body: unknown }>(
    '/api/v1/legacy-presets/:id',
    cacheReadRouteOptions(),
    async (req, reply) => {
      const cacheRequest = parseResourceCacheRequest(req.body, ['preset'])
      if (typeof cacheRequest === 'string') {
        return sendInvalidResourceCacheRequest(reply, cacheRequest)
      }
      const hydration = loadPresetHydration(db, dataDir, req.params.id)
      if (!hydration) {
        reply.code(404).send({
          error: 'preset_not_found',
          reason: `Preset not found: ${req.params.id}`,
        })
        return
      }
      const { revision } = getSchemaState(db)
      const envelope = maskProviderSecretsInPlace({ botPresets: [hydration.preset] })
      const substitution = substituteCachedValue(envelope.botPresets[0], cacheRequest.hashes.get('preset'))
      return metricResourceResponse(
        req,
        reply,
        'legacyPreset',
        revision,
        {
          revision,
          cache: RESOURCE_CACHE_METADATA,
          preset: substitution.value,
        },
        { detailRead: true, ...cacheMetricFields(substitution) },
      )
    },
  )

  app.get<{ Params: { id: string } }>(
    '/api/v1/prompt-presets/:id/template',
    { exposeHeadRoute: false },
    async (req, reply) => {
      if (!(await requireAuth(authState, req, reply))) return
      const hydration = loadPromptPresetTemplateForRead(db, dataDir, req.params.id)
      if (hydration.status === 'not-found') {
        reply.code(404).send({
          error: 'prompt_preset_not_found',
          reason: `Prompt preset not found: ${req.params.id}`,
        })
        return
      }
      if (hydration.status === 'ambiguous') {
        reply.code(409).send({
          error: 'prompt_preset_ambiguous',
          reason: `Prompt preset id is not unique: ${req.params.id}`,
        })
        return
      }
      const { revision } = getSchemaState(db)
      return metricResourceResponse(
        req,
        reply,
        'promptPresetTemplate',
        revision,
        {
          revision,
          promptPresetId: req.params.id,
          promptTemplate: hydration.promptTemplate,
          ...(Object.prototype.hasOwnProperty.call(hydration, 'selectedFallbackPromptTemplate')
            ? { selectedFallbackPromptTemplate: hydration.selectedFallbackPromptTemplate }
            : {}),
        },
        { detailRead: true },
      )
    },
  )

  app.post<{ Params: { id: string }; Body: unknown }>(
    '/api/v1/prompt-presets/:id/template',
    cacheReadRouteOptions(),
    async (req, reply) => {
      const cacheRequest = parseResourceCacheRequest(req.body, ['promptTemplate', 'selectedFallbackPromptTemplate'])
      if (typeof cacheRequest === 'string') {
        return sendInvalidResourceCacheRequest(reply, cacheRequest)
      }
      const hydration = loadPromptPresetTemplateForRead(db, dataDir, req.params.id)
      if (hydration.status === 'not-found') {
        reply.code(404).send({
          error: 'prompt_preset_not_found',
          reason: `Prompt preset not found: ${req.params.id}`,
        })
        return
      }
      if (hydration.status === 'ambiguous') {
        reply.code(409).send({
          error: 'prompt_preset_ambiguous',
          reason: `Prompt preset id is not unique: ${req.params.id}`,
        })
        return
      }

      const promptTemplateSubstitution = substituteCachedArrayOrValue(
        hydration.promptTemplate,
        cacheRequest.hashes.get('promptTemplate'),
      )
      const { revision } = getSchemaState(db)
      const response: Record<string, unknown> = {
        revision,
        promptPresetId: req.params.id,
        cache: RESOURCE_CACHE_METADATA,
        promptTemplate: promptTemplateSubstitution.value,
      }
      let hits = promptTemplateSubstitution.hits
      let misses = promptTemplateSubstitution.misses
      if (Object.prototype.hasOwnProperty.call(hydration, 'selectedFallbackPromptTemplate')) {
        const fallbackSubstitution = substituteCachedArrayOrValue(
          hydration.selectedFallbackPromptTemplate,
          cacheRequest.hashes.get('selectedFallbackPromptTemplate'),
        )
        response.selectedFallbackPromptTemplate = fallbackSubstitution.value
        hits += fallbackSubstitution.hits
        misses += fallbackSubstitution.misses
      }
      return metricResourceResponse(req, reply, 'promptPresetTemplate', revision, response, {
        detailRead: true,
        ...cacheMetricFields({ value: response, hits, misses }),
      })
    },
  )
}

function loadPromptPresetTemplateForRead(
  db: DatabaseSync,
  dataDir: string,
  promptPresetId: string,
): PromptPresetTemplateReadResult {
  const fields = loadPersistedDatabaseFields(db, dataDir, [
    'promptPresets',
    'promptPresetsId',
    'promptTemplate',
    'botPresets',
  ])
  const presets = Array.isArray(fields.promptPresets) ? fields.promptPresets : []
  const matches = presets.filter((candidate) => isRecord(candidate) && candidate.id === promptPresetId)
  if (matches.length === 0) return { status: 'not-found' }
  if (matches.length !== 1) return { status: 'ambiguous' }

  const preset = matches[0]
  const usesSelectedFallback =
    !Object.prototype.hasOwnProperty.call(preset, 'promptTemplate') &&
    Number.isInteger(fields.promptPresetsId) &&
    presets[fields.promptPresetsId as number] === preset &&
    isDefaultPromptPresetScaffold(preset) &&
    Object.prototype.hasOwnProperty.call(fields, 'promptTemplate') &&
    !hasLegacyBotPresetTemplates(fields)
  return {
    status: 'found',
    promptTemplate: Object.prototype.hasOwnProperty.call(preset, 'promptTemplate') ? preset.promptTemplate : null,
    ...(usesSelectedFallback ? { selectedFallbackPromptTemplate: fields.promptTemplate } : {}),
  }
}

function metricResourceResponse<T>(
  request: FastifyRequest,
  reply: FastifyReply,
  resource: string,
  revision: number,
  response: T,
  extra: Record<string, unknown> = {},
): T {
  emitProtocolMetric(
    'resource_response',
    () => {
      const requestUid = readRequestTraceUid(request)
      return {
        resource,
        revision,
        ...extra,
        durationMs: protocolElapsedMs(reply.elapsedTime),
        ...(requestUid ? { requestUid } : {}),
        payloadBytes: jsonPayloadBytes(response),
      }
    },
    request.log,
  )
  return response
}

function loadSettingsGroup(db: DatabaseSync, dataDir: string, group: ReadableSettingsGroup): Record<string, unknown> {
  // hypaV3Presets is command-owned by the memory group but persists in its
  // own collection table. Keep this endpoint settings-only; the dedicated
  // cross-resource event invalidates that collection separately.
  const groupKeys =
    group === 'language' ? [...SETTINGS_GROUP_KEYS[group], 'translatorPresetId'] : SETTINGS_GROUP_KEYS[group]
  const keys = groupKeys.filter(
    (key) =>
      key !== 'hypaV3Presets' &&
      (group === 'models' ||
        (group === 'language' && key === 'translatorPresetId') ||
        READABLE_SETTINGS_GROUPS.find((candidate) => SETTINGS_GROUP_KEYS[candidate].includes(key)) === group),
  )
  return maskProviderSecretsInPlace(loadPersistedDatabaseFields(db, dataDir, keys))
}

function parseResourceCacheRequest(
  body: unknown,
  allowedResourceNames: readonly string[],
): ParsedResourceCacheRequest | string {
  if (!isRecord(body)) return 'body must be an object'
  const bodyKeys = Object.keys(body)
  if (bodyKeys.length !== 1 || bodyKeys[0] !== 'cache') {
    return 'body must contain only cache'
  }
  if (!isRecord(body.cache)) return 'body.cache must be an object'
  const cacheKeys = Object.keys(body.cache).sort()
  if (cacheKeys.length !== 2 || cacheKeys[0] !== 'hashes' || cacheKeys[1] !== 'version') {
    return 'body.cache must contain only version and hashes'
  }
  if (body.cache.version !== RESOURCE_CACHE_VERSION) {
    return `body.cache.version must equal ${RESOURCE_CACHE_VERSION}`
  }
  if (!isRecord(body.cache.hashes)) return 'body.cache.hashes must be an object'

  const allowed = new Set(allowedResourceNames)
  const hashes = new Map<string, ReadonlySet<string>>()
  let totalHashes = 0
  for (const [resourceName, rawHashes] of Object.entries(body.cache.hashes)) {
    if (!allowed.has(resourceName)) {
      return `Unknown cache resource: ${resourceName}`
    }
    if (!Array.isArray(rawHashes)) {
      return `body.cache.hashes.${resourceName} must be an array`
    }
    const resourceHashes = new Set<string>()
    for (const rawHash of rawHashes) {
      totalHashes += 1
      if (totalHashes > RESOURCE_CACHE_MAX_HASHES) {
        return `body.cache.hashes must contain at most ${RESOURCE_CACHE_MAX_HASHES} hashes`
      }
      if (typeof rawHash !== 'string' || !SHA256_HEX_RE.test(rawHash)) {
        return `body.cache.hashes.${resourceName} must contain only lowercase SHA-256 hex strings`
      }
      resourceHashes.add(rawHash)
    }
    hashes.set(resourceName, resourceHashes)
  }
  return { hashes }
}

function sendInvalidResourceCacheRequest(reply: FastifyReply, reason: string): FastifyReply {
  return reply.code(400).send({
    error: 'invalid_resource_cache_request',
    reason,
  })
}

function substituteCachedCollections(
  collections: Record<string, unknown>,
  cacheRequest: ParsedResourceCacheRequest,
): CacheSubstitutionResult<Record<string, unknown>> {
  const value: Record<string, unknown> = {}
  let hits = 0
  let misses = 0
  for (const [name, collection] of Object.entries(collections)) {
    const substitution =
      name === PLUGIN_STORAGE_COLLECTION
        ? substituteCachedValue(collection, cacheRequest.hashes.get(name))
        : Array.isArray(collection)
          ? substituteCachedArray(collection, cacheRequest.hashes.get(name))
          : { value: collection, hits: 0, misses: 1 }
    value[name] = substitution.value
    hits += substitution.hits
    misses += substitution.misses
  }
  return { value, hits, misses }
}

function substituteCachedArray(
  values: readonly unknown[],
  cachedHashes: ReadonlySet<string> | undefined,
): CacheSubstitutionResult<Array<{ hash: string } | { value: unknown }>> {
  const value: Array<{ hash: string } | { value: unknown }> = []
  let hits = 0
  let misses = 0
  for (const item of values) {
    const hash = sha256JsonValue(item)
    if (cachedHashes?.has(hash)) {
      value.push({ hash })
      hits += 1
    } else {
      value.push({ value: item })
      misses += 1
    }
  }
  return { value, hits, misses }
}

function substituteCachedArrayOrValue(
  value: unknown,
  cachedHashes: ReadonlySet<string> | undefined,
): CacheSubstitutionResult {
  return Array.isArray(value) ? substituteCachedArray(value, cachedHashes) : substituteCachedValue(value, cachedHashes)
}

function substituteCachedValue(value: unknown, cachedHashes: ReadonlySet<string> | undefined): CacheSubstitutionResult {
  const hash = sha256JsonValue(value)
  if (cachedHashes?.has(hash)) return { value: hash, hits: 1, misses: 0 }
  return { value, hits: 0, misses: 1 }
}

function sha256JsonValue(value: unknown): string {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) {
    throw new TypeError('Resource cache values must be JSON-serializable')
  }
  return createHash('sha256').update(serialized, 'utf8').digest('hex')
}

function cacheMetricFields(substitution: CacheSubstitutionResult): Record<string, unknown> {
  return {
    cacheVersion: RESOURCE_CACHE_VERSION,
    cacheAlgorithm: RESOURCE_CACHE_ALGORITHM,
    cacheHits: substitution.hits,
    cacheMisses: substitution.misses,
  }
}

function loadCollections(
  db: DatabaseSync,
  dataDir: string,
  names: readonly ReadableCollectionName[],
  options: { suppressSelectedPromptTemplateProjection?: boolean } = {},
): Record<string, unknown> {
  const readsSelectedPromptPreset =
    options.suppressSelectedPromptTemplateProjection &&
    names.includes('promptPresets') &&
    names.includes('promptTemplate')
  const collections = loadPersistedDatabaseFields(
    db,
    dataDir,
    readsSelectedPromptPreset ? [...names, 'promptPresetsId'] : names,
  )
  const selectedPromptPresetIndex = collections.promptPresetsId
  delete collections.promptPresetsId

  if (Array.isArray(collections.promptPresets)) {
    const selectedPromptPreset = Number.isInteger(selectedPromptPresetIndex)
      ? collections.promptPresets[selectedPromptPresetIndex as number]
      : undefined
    const preservesSelectedFallback =
      isRecord(selectedPromptPreset) &&
      !Object.prototype.hasOwnProperty.call(selectedPromptPreset, 'promptTemplate') &&
      isDefaultPromptPresetScaffold(selectedPromptPreset) &&
      Object.prototype.hasOwnProperty.call(collections, 'promptTemplate') &&
      !hasLegacyBotPresetTemplates(collections)
    const promptPresetShells = collections.promptPresets.map((candidate) => {
      if (!isRecord(candidate) || !Object.prototype.hasOwnProperty.call(candidate, 'promptTemplate')) {
        return candidate
      }
      const shell = { ...candidate }
      delete shell.promptTemplate
      return shell
    })
    collections.promptPresets = promptPresetShells

    if (
      options.suppressSelectedPromptTemplateProjection &&
      names.includes('promptTemplate') &&
      Number.isInteger(selectedPromptPresetIndex) &&
      (selectedPromptPresetIndex as number) >= 0 &&
      (selectedPromptPresetIndex as number) < promptPresetShells.length &&
      isCanonicalPromptPresetShellList(promptPresetShells) &&
      !preservesSelectedFallback
    ) {
      // The selected modern preset owns this body. The top-level collection is
      // only its compatibility projection, so avoid returning the same large
      // template twice in the aggregate response. The browser hydrates the
      // selected owner through /prompt-presets/:id/template.
      collections.promptTemplate = []
    }
  }

  if (Array.isArray(collections.botPresets)) {
    collections.botPresets = collections.botPresets.map((candidate) => {
      if (!isRecord(candidate)) return candidate
      const shell: Record<string, unknown> = {}
      for (const field of LEGACY_BOT_PRESET_SHELL_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(candidate, field)) shell[field] = candidate[field]
      }
      return shell
    })
  }

  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(collections, name)) continue
    collections[name] = name === PLUGIN_STORAGE_COLLECTION ? {} : []
  }
  return maskProviderSecretsInPlace(collections)
}

function isCanonicalPromptPresetShellList(value: readonly unknown[]): boolean {
  const ids = new Set<string>()
  for (const candidate of value) {
    if (!isRecord(candidate) || typeof candidate.id !== 'string' || candidate.id.trim() === '') return false
    if (ids.has(candidate.id)) return false
    ids.add(candidate.id)
  }
  return true
}

function isDefaultPromptPresetScaffold(preset: Record<string, unknown>): boolean {
  return preset.id === 'default-prompt-preset' && preset.name === 'Default Prompt'
}

function hasLegacyBotPresetTemplates(fields: Record<string, unknown>): boolean {
  return (
    Array.isArray(fields.botPresets) &&
    fields.botPresets.some(
      (preset) => isRecord(preset) && Object.prototype.hasOwnProperty.call(preset, 'promptTemplate'),
    )
  )
}

function isReadableCollectionName(value: string): value is ReadableCollectionName {
  return READABLE_COLLECTION_NAME_SET.has(value)
}

type BulkIdReadResult = { status: 'ok'; ids: string[] } | { status: 'invalid' } | { status: 'too-many' }

function readBulkIds(body: { ids?: unknown } | undefined): BulkIdReadResult {
  if (!body || !Array.isArray(body.ids)) return { status: 'invalid' }
  if (body.ids.length > BULK_RESOURCE_MAX_IDS) return { status: 'too-many' }
  const ids: string[] = []
  const seen = new Set<string>()
  for (const raw of body.ids) {
    if (typeof raw !== 'string') return { status: 'invalid' }
    const id = raw.trim()
    if (!id) return { status: 'invalid' }
    if (seen.has(id)) continue
    ids.push(id)
    seen.add(id)
  }
  return { status: 'ok', ids }
}

function readPositiveInteger(value: string | undefined): number | null {
  if (value === undefined || !/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function readNonNegativeInteger(value: string | undefined): number | null {
  if (value === undefined || !/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

function readChatMessageRange(
  query: ChatMessageRangeQuery,
): { start?: number; limit?: number; tail?: number } | 'invalid' | null {
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

function readGenerationMessageId(query: ChatMessageRangeQuery): string | 'invalid' | null {
  if (query.generationMessageId === undefined) return null
  if (query.start !== undefined || query.limit !== undefined || query.tail !== undefined) return 'invalid'
  return typeof query.generationMessageId === 'string' && query.generationMessageId.trim() !== ''
    ? query.generationMessageId
    : 'invalid'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
