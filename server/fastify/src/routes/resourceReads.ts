import type { DatabaseSync } from 'node:sqlite'
import type { FastifyInstance, FastifyReply } from 'fastify'
import type { AuthState } from '../auth.js'
import { getSchemaState } from '../db.js'
import { requireAuth } from '../http.js'
import { maskProviderSecretsInPlace } from '../providerSecrets.js'
import { READABLE_SETTINGS_GROUPS, SETTINGS_GROUP_KEYS, type ReadableSettingsGroup } from './commands.js'
import {
  COLLECTION_FIELDS,
  loadCharacterLorebookHydration,
  loadCharacterLorebookHydrations,
  loadCharacterSelectionProjection,
  loadCharacterRowsForRead,
  loadChatHydration,
  loadChatHydrationRange,
  loadChatHydrations,
  loadGenerationChatHydration,
  loadPersistedDatabaseFields,
  loadPresetHydration,
  loadSettingsFromSqlite,
  loadSingleCharacterRowForRead,
} from '../repository.js'

const PLUGIN_STORAGE_COLLECTION = 'pluginCustomStorage' as const
const READABLE_COLLECTION_NAMES = [...COLLECTION_FIELDS, PLUGIN_STORAGE_COLLECTION] as const
type ReadableCollectionName = (typeof READABLE_COLLECTION_NAMES)[number]
const READABLE_COLLECTION_NAME_SET = new Set<string>(READABLE_COLLECTION_NAMES)
const LEGACY_BOT_PRESET_SHELL_FIELDS = [
  'id',
  'name',
  'image',
  'metadata',
  'customPromptTemplateToggle',
  'moduleIntergration',
] as const

interface ChatMessageRangeQuery {
  start?: string
  limit?: string
  tail?: string
  generationMessageId?: string
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

  app.get('/api/v1/settings', { exposeHeadRoute: false }, async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return
    const { revision } = getSchemaState(db)
    const settings = loadSettingsFromSqlite(db)
    return {
      revision,
      settings: maskProviderSecretsInPlace(settings ?? {}),
    }
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
    // hypaV3Presets is command-owned by the memory group but persists in its
    // own collection table. Keep this endpoint settings-only; the dedicated
    // cross-resource event invalidates that collection separately.
    const keys = SETTINGS_GROUP_KEYS[group].filter(
      (key) =>
        key !== 'hypaV3Presets' &&
        (group === 'models' ||
          READABLE_SETTINGS_GROUPS.find((candidate) => SETTINGS_GROUP_KEYS[candidate].includes(key)) === group),
    )
    const { revision } = getSchemaState(db)
    return {
      revision,
      group,
      settings: maskProviderSecretsInPlace(loadPersistedDatabaseFields(db, dataDir, keys)),
    }
  })

  app.get('/api/v1/collections', { exposeHeadRoute: false }, async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return
    const { revision } = getSchemaState(db)
    return {
      revision,
      collections: loadCollections(db, dataDir, READABLE_COLLECTION_NAMES, {
        suppressSelectedPromptTemplateProjection: true,
      }),
    }
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
    return {
      revision,
      collections: loadCollections(db, dataDir, [req.params.name]),
    }
  })

  app.get('/api/v1/characters', { exposeHeadRoute: false }, async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return
    const { revision } = getSchemaState(db)
    const settings = loadPersistedDatabaseFields(db, dataDir, ['characterOrder', 'currentChar'])
    const characterEnvelope = maskProviderSecretsInPlace({ characters: loadCharacterRowsForRead(db, dataDir) })
    return {
      revision,
      characters: characterEnvelope.characters,
      characterOrder: Array.isArray(settings.characterOrder) ? settings.characterOrder : [],
      currentChar: Number.isInteger(settings.currentChar) ? settings.currentChar : -1,
    }
  })

  app.get('/api/v1/characters/order', { exposeHeadRoute: false }, async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return
    const { revision } = getSchemaState(db)
    const settings = loadPersistedDatabaseFields(db, dataDir, ['characterOrder'])
    return {
      revision,
      characterOrder: Array.isArray(settings.characterOrder) ? settings.characterOrder : [],
    }
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
      return { revision, ...selection }
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
    return { revision, character: envelope.characters[0] }
  })

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
        return {
          revision,
          chatId: req.params.id,
          message: hydration.message,
          hypaV3Data: hydration.hypaV3Data,
          alternates: hydration.alternates,
          messageStart: hydration.messageStart,
          messageTotal: hydration.messageTotal,
        }
      }
      if (range) {
        const hydration = loadChatHydrationRange(db, dataDir, req.params.id, range)
        return {
          revision,
          chatId: req.params.id,
          message: hydration.message,
          hypaV3Data: hydration.hypaV3Data,
          alternates: hydration.alternates,
          messageStart: hydration.messageStart,
          messageTotal: hydration.messageTotal,
        }
      }

      const hydration = loadChatHydration(db, dataDir, req.params.id)
      return {
        revision,
        chatId: req.params.id,
        message: hydration.message,
        hypaV3Data: hydration.hypaV3Data,
        alternates: hydration.alternates,
      }
    },
  )

  app.post<{ Body: { ids?: unknown } }>(
    '/api/v1/chats/messages/bulk',
    { onRequest: requireReadAuth },
    async (req, reply) => {
      const chatIds = readBulkIds(req.body)
      if (!chatIds) {
        reply.code(400).send({
          error: 'invalid_chat_ids',
          reason: 'Expected body.ids to be an array of non-empty chat ids.',
        })
        return
      }
      const { revision } = getSchemaState(db)
      const hydration = loadChatHydrations(db, dataDir, chatIds, { includeAlternates: false })
      return {
        revision,
        chats: hydration.chats,
        missing: hydration.missing,
      }
    },
  )

  app.get<{ Params: { id: string } }>(
    '/api/v1/characters/:id/lorebook',
    { exposeHeadRoute: false },
    async (req, reply) => {
      if (!(await requireAuth(authState, req, reply))) return
      const { revision } = getSchemaState(db)
      const hydration = loadCharacterLorebookHydration(db, dataDir, req.params.id)
      return {
        revision,
        characterId: req.params.id,
        globalLore: hydration.globalLore,
      }
    },
  )

  app.post<{ Body: { ids?: unknown } }>(
    '/api/v1/characters/lorebooks/bulk',
    { onRequest: requireReadAuth },
    async (req, reply) => {
      const characterIds = readBulkIds(req.body)
      if (!characterIds) {
        reply.code(400).send({
          error: 'invalid_character_lorebook_ids',
          reason: 'Expected body.ids to be an array of non-empty character ids.',
        })
        return
      }
      const { revision } = getSchemaState(db)
      const hydration = loadCharacterLorebookHydrations(db, dataDir, characterIds)
      return {
        revision,
        characters: hydration.characters,
        missing: hydration.missing,
      }
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
    return { revision, preset: envelope.botPresets[0] }
  })

  app.get<{ Params: { id: string } }>(
    '/api/v1/prompt-presets/:id/template',
    { exposeHeadRoute: false },
    async (req, reply) => {
      if (!(await requireAuth(authState, req, reply))) return
      const fields = loadPersistedDatabaseFields(db, dataDir, ['promptPresets'])
      const presets = Array.isArray(fields.promptPresets) ? fields.promptPresets : []
      const matches = presets.filter((candidate) => isRecord(candidate) && candidate.id === req.params.id)
      if (matches.length === 0) {
        reply.code(404).send({
          error: 'prompt_preset_not_found',
          reason: `Prompt preset not found: ${req.params.id}`,
        })
        return
      }
      if (matches.length !== 1) {
        reply.code(409).send({
          error: 'prompt_preset_ambiguous',
          reason: `Prompt preset id is not unique: ${req.params.id}`,
        })
        return
      }
      const preset = matches[0]
      const { revision } = getSchemaState(db)
      return {
        revision,
        promptPresetId: req.params.id,
        promptTemplate: Object.prototype.hasOwnProperty.call(preset, 'promptTemplate') ? preset.promptTemplate : null,
      }
    },
  )
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
      isCanonicalPromptPresetShellList(promptPresetShells)
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

function isReadableCollectionName(value: string): value is ReadableCollectionName {
  return READABLE_COLLECTION_NAME_SET.has(value)
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
