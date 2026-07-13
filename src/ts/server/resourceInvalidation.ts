import type { CommandEvent } from './commands'
import { SERVER_SETTINGS_KEYS_BY_GROUP, isSettingsGroup, type SettingsGroup } from './settingsGroups'
import {
  fetchServerBulkCharacterLorebooks,
  fetchServerCharacterLorebook,
  fetchServerChatMessages,
  fetchServerGenerationChatMessages,
  fetchServerLegacyPreset,
} from './hydrationReads'
import {
  currentPromptTemplateOwnerId,
  ensurePromptTemplateHydrated,
  invalidatePromptTemplateHydration,
  markPromptTemplateProjectionApplied,
  resetPromptTemplateHydration,
} from './promptTemplateHydration'
import {
  fetchServerCharacter,
  fetchServerCharacterOrder,
  fetchServerCharacterSelection,
  fetchServerCharacters,
  fetchServerCollection,
  fetchServerCollections,
  fetchServerSettings,
  fetchServerSettingsGroup,
} from './resourceReads'
import {
  applyCharacterOrderResource,
  applyCharacterResource,
  applyCharacterSelectionResource,
  applyCharactersResource,
  applyCollectionsResource,
  applyLegacyPresetCollectionResource,
  applyLegacyPresetRowResource,
  applySettingsResource,
  applySettingsGroupResource,
  captureLegacyPresetResourceBaseline,
  charactersResourceState,
  collectionsResourceState,
  markCharacterLorebookProjectionApplied,
  settingsResourceState,
  type ServerCollectionName,
  type ServerCollectionsResourcePayload,
  type ServerLegacyPresetResourceBaseline,
} from './resourceState.svelte'
import { withServerResourceApply } from './resourceWriteGuard.svelte'
import { createDestructiveRefreshToken } from './staleStateGuards'

export const FULL_RESOURCE_REFRESH_MAX_ATTEMPTS = 3

export type ServerResourceRefreshResult =
  | { status: 'ok'; revision: number; scope: 'full' | 'targeted' | 'none' }
  | { status: 'error'; error: string }
  | { status: 'unavailable' }

export interface ServerResourceInvalidationHooks {
  mergePendingPluginStorage(value: Record<string, unknown>): Record<string, unknown>
  applyChatMessages(
    chatId: string,
    message: unknown[],
    hypaV3Data: unknown,
    alternates: unknown[],
    range?: { start: number; total: number },
  ): boolean
  applyCharacterLorebook(characterId: string, globalLore: unknown[]): boolean
  markCharacterLorebookHydrated(characterId: string): void
  triggerOpenChatGenerationReattach(): void
  clearActiveMessageTranslation(messageId: string): void
}

export interface ServerResourceRefreshOptions {
  signal?: AbortSignal | null
  hooks?: Partial<ServerResourceInvalidationHooks>
}

export interface ServerResourceInvalidationOptions extends ServerResourceRefreshOptions {
  appliedRevision?: number | null
}

interface RefreshPlan {
  settings: boolean
  settingsGroups: Set<SettingsGroup>
  collections: Set<ServerCollectionName>
  allCharacters: boolean
  characterIds: Set<string>
  characterOrder: boolean
  characterSelectionIds: Set<string>
  chatIds: Set<string>
  generationChatMessageIds: Map<string, string>
  lorebookCharacterIds: Set<string>
  translatedMessageIds: Set<string>
  promptTemplateOwnerIds: Set<string>
  legacyPresetIds: Set<string>
  refreshSelectedPromptTemplate: boolean
  full: boolean
}

type SettingsReadResult = Awaited<ReturnType<typeof fetchServerSettings>>
type SettingsGroupReadResult = Awaited<ReturnType<typeof fetchServerSettingsGroup>>
type CollectionReadResult = Awaited<ReturnType<typeof fetchServerCollection>>
type CharactersReadResult = Awaited<ReturnType<typeof fetchServerCharacters>>
type CharacterReadResult = Awaited<ReturnType<typeof fetchServerCharacter>>
type CharacterOrderReadResult = Awaited<ReturnType<typeof fetchServerCharacterOrder>>
type CharacterSelectionReadResult = Awaited<ReturnType<typeof fetchServerCharacterSelection>>
type ChatReadResult = Awaited<ReturnType<typeof fetchServerChatMessages>>
type LorebookReadResult = Awaited<ReturnType<typeof fetchServerCharacterLorebook>>
type BulkLorebookReadResult = Awaited<ReturnType<typeof fetchServerBulkCharacterLorebooks>>
type LegacyPresetReadResult = Awaited<ReturnType<typeof fetchServerLegacyPreset>>
type LegacyPresetCollectionReadResult =
  | {
      status: 'ok'
      revision: number
      shells: unknown[]
      presetRows: Record<string, unknown>[]
      baseline: ServerLegacyPresetResourceBaseline
    }
  | { status: 'error'; error: string }
  | { status: 'unavailable' }

type CompletedTargetedRead =
  | { kind: 'settings'; result: SettingsReadResult }
  | { kind: 'settingsGroup'; group: SettingsGroup; result: SettingsGroupReadResult }
  | { kind: 'collection'; name: ServerCollectionName; result: CollectionReadResult }
  | {
      kind: 'legacyPresetRow'
      presetId: string
      baseline: ServerLegacyPresetResourceBaseline
      result: LegacyPresetReadResult
    }
  | { kind: 'legacyPresetCollection'; result: LegacyPresetCollectionReadResult }
  | { kind: 'characters'; result: CharactersReadResult }
  | { kind: 'character'; characterId: string; result: CharacterReadResult }
  | { kind: 'characterOrder'; result: CharacterOrderReadResult }
  | { kind: 'characterSelection'; characterId: string; result: CharacterSelectionReadResult }
  | { kind: 'chat'; chatId: string; result: ChatReadResult }
  | { kind: 'lorebook'; characterId: string; result: LorebookReadResult }
  | { kind: 'lorebooks'; characterIds: string[]; result: BulkLorebookReadResult }

/** Load and apply the complete API-backed database resource set at startup. */
export async function loadInitialServerResources(
  options: ServerResourceRefreshOptions = {},
): Promise<ServerResourceRefreshResult> {
  return refreshAllServerResources(options)
}

/**
 * Refresh all database resources at one common server revision. If concurrent
 * writes make the three reads disagree, retry the complete read set a bounded
 * number of times. Nothing is applied until one consistent set is available.
 */
export async function refreshAllServerResources(
  options: ServerResourceRefreshOptions = {},
): Promise<ServerResourceRefreshResult> {
  for (let attempt = 0; attempt < FULL_RESOURCE_REFRESH_MAX_ATTEMPTS; attempt += 1) {
    const [settings, collections, characters] = await Promise.all([
      fetchServerSettings(options.signal),
      fetchServerCollections(options.signal),
      fetchServerCharacters(options.signal),
    ])

    if (settings.status !== 'ok') return failedRead(settings)
    if (collections.status !== 'ok') return failedRead(collections)
    if (characters.status !== 'ok') return failedRead(characters)

    const revisions = new Set([settings.revision, collections.revision, characters.revision])
    if (revisions.size !== 1) continue

    const revision = settings.revision
    // Any full-refresh apply attempt can replace optimistic projections, even
    // when a later slice rejects the response. Invalidate local-effect tokens
    // before touching the first slice so partial failures also fail closed.
    createDestructiveRefreshToken('full-server-resource-refresh')
    try {
      const mergedCollections = withPendingPluginStorage(collections, options.hooks?.mergePendingPluginStorage)
      const { settingsApplied, collectionsApplied, charactersApplied } = withServerResourceApply(() => ({
        settingsApplied: applySettingsResource(settings),
        collectionsApplied: applyCollectionsResource(mergedCollections),
        // A complete refresh is used for startup, revision gaps, restores, and
        // unknown resources. Character reads intentionally omit transcripts,
        // so retaining same-id resident bodies here could preserve stale chat
        // data across a restore. Leave the chats as API-hydration stubs.
        charactersApplied: applyCharactersResource(characters, { preserveResidentChatBodies: false }),
      }))
      if (collectionsApplied) resetPromptTemplateHydration()
      if (
        (!settingsApplied && !settingsFullAlreadyAtLeast(revision)) ||
        (!collectionsApplied && !collectionsAlreadyAtLeast(revision)) ||
        (!charactersApplied && !charactersAlreadyAtLeast(revision))
      ) {
        return { status: 'error', error: 'Failed to apply a complete server resource refresh' }
      }
      return { status: 'ok', revision, scope: 'full' }
    } catch (error) {
      return { status: 'error', error: error instanceof Error ? error.message : String(error) }
    }
  }

  return {
    status: 'error',
    error: `Server resource revisions did not converge after ${FULL_RESOURCE_REFRESH_MAX_ATTEMPTS} attempts`,
  }
}

/**
 * Refresh only the resource slices invalidated by one command event or a
 * coalesced, contiguous event batch. Unknown/sprawling resources, revision
 * gaps, and events missing required entity ids use a complete refresh.
 */
export async function refreshInvalidatedServerResources(
  events: CommandEvent | readonly CommandEvent[],
  options: ServerResourceInvalidationOptions = {},
): Promise<ServerResourceRefreshResult> {
  const batch = Array.isArray(events) ? [...events] : [events]
  if (batch.length === 0) {
    const revision = normalizeAppliedRevision(options.appliedRevision)
    return revision === null
      ? { status: 'error', error: 'At least one command event is required' }
      : { status: 'ok', revision, scope: 'none' }
  }

  const normalized = normalizeEventBatch(batch, options.appliedRevision)
  if (normalized.kind === 'error') return { status: 'error', error: normalized.error }
  if (normalized.kind === 'none') return { status: 'ok', revision: normalized.revision, scope: 'none' }
  if (normalized.kind === 'full') return refreshAllServerResources(options)

  const plan = createRefreshPlan()
  for (const event of normalized.events) {
    addEventToRefreshPlan(plan, event)
    if (plan.full) return refreshAllServerResources(options)
  }

  const missingHook = missingRequiredHook(plan, options.hooks)
  if (missingHook) {
    return { status: 'error', error: `Server resource invalidation requires the ${missingHook} hook` }
  }

  const completed = await runTargetedReads(plan, options.signal)
  const failed = firstFailedTargetedRead(completed)
  if (failed) return failed

  for (const entry of completed) {
    if (entry.result.status !== 'ok') continue
    if (entry.result.revision < normalized.revision) {
      return {
        status: 'error',
        error: `Server ${targetedReadLabel(entry)} response revision ${entry.result.revision} is older than event revision ${normalized.revision}`,
      }
    }
  }

  if (completed.length > 0) {
    try {
      const failedApply = withServerResourceApply(() => {
        for (const entry of completed) {
          if (entry.result.status !== 'ok') continue
          if (!applyTargetedRead(entry, options.hooks)) return targetedReadLabel(entry)
        }
        return null
      })
      if (failedApply) {
        return { status: 'error', error: `Failed to apply server ${failedApply} response` }
      }
    } catch (error) {
      return { status: 'error', error: error instanceof Error ? error.message : String(error) }
    }
  }

  const promptTemplateRefreshError = await refreshInvalidatedPromptTemplateOwners(plan, normalized.revision)
  if (promptTemplateRefreshError) return { status: 'error', error: promptTemplateRefreshError }

  if (plan.chatIds.size > 0 || plan.generationChatMessageIds.size > 0) {
    options.hooks?.triggerOpenChatGenerationReattach?.()
  }
  for (const messageId of plan.translatedMessageIds) options.hooks?.clearActiveMessageTranslation?.(messageId)

  return { status: 'ok', revision: normalized.revision, scope: 'targeted' }
}

function createRefreshPlan(): RefreshPlan {
  return {
    settings: false,
    settingsGroups: new Set(),
    collections: new Set(),
    allCharacters: false,
    characterIds: new Set(),
    characterOrder: false,
    characterSelectionIds: new Set(),
    chatIds: new Set(),
    generationChatMessageIds: new Map(),
    lorebookCharacterIds: new Set(),
    translatedMessageIds: new Set(),
    promptTemplateOwnerIds: new Set(),
    legacyPresetIds: new Set(),
    refreshSelectedPromptTemplate: false,
    full: false,
  }
}

function addEventToRefreshPlan(plan: RefreshPlan, event: CommandEvent): void {
  const addCharacter = (characterId: string | undefined): void => {
    if (!nonEmptyString(characterId)) {
      plan.full = true
      return
    }
    if (!plan.allCharacters) plan.characterIds.add(characterId)
  }
  const addChat = (chatId: string | undefined): void => {
    if (!nonEmptyString(chatId)) {
      plan.full = true
      return
    }
    plan.chatIds.add(chatId)
    plan.generationChatMessageIds.delete(chatId)
  }
  const addGenerationChat = (chatId: string | undefined, messageId: string | undefined): void => {
    if (!nonEmptyString(chatId)) {
      plan.full = true
      return
    }
    if (plan.chatIds.has(chatId)) return
    if (!nonEmptyString(messageId) || plan.generationChatMessageIds.has(chatId)) {
      // A missing anchor or two generation writes in one chat cannot be safely
      // represented by one suffix: later revision order need not match message
      // sequence order. Fall back to one authoritative full transcript.
      addChat(chatId)
      return
    }
    plan.generationChatMessageIds.set(chatId, messageId)
  }
  const addLorebook = (characterId: string | undefined): void => {
    if (!nonEmptyString(characterId)) {
      plan.full = true
      return
    }
    plan.lorebookCharacterIds.add(characterId)
  }
  const addAllCharacters = (): void => {
    plan.allCharacters = true
    plan.characterIds.clear()
  }
  const addFullSettings = (): void => {
    plan.settings = true
    plan.settingsGroups.clear()
  }
  const addSettingsGroup = (group: SettingsGroup): void => {
    if (!plan.settings) plan.settingsGroups.add(group)
  }
  const addLegacyPresetId = (presetId: string | undefined): void => {
    if (nonEmptyString(presetId)) plan.legacyPresetIds.add(presetId)
  }
  const addChangedLegacyPresetIds = (): void => {
    switch (event.type) {
      case 'preset.reordered':
        return
      case 'preset.selected':
      case 'preset.deleted':
        // Selection changes only snapshot the outgoing preset. A deletion id
        // disappears from the authoritative shells and is filtered later.
        addLegacyPresetId(event.parentId)
        return
      default:
        addLegacyPresetId(event.id)
        addLegacyPresetId(event.parentId)
    }
  }

  switch (event.resource) {
    case 'asset':
    case 'revisionOnly':
      return
    case 'settings':
      if (!isSettingsGroup(event.id)) {
        plan.full = true
        return
      }
      addSettingsGroup(event.id)
      return
    case 'modelProfile':
      addSettingsGroup('models')
      return
    case 'agentPreset':
      if (!isWellFormedAgentPresetEvent(event)) {
        plan.full = true
        return
      }
      addSettingsGroup('agents')
      return
    case 'prompt':
      addSettingsGroup('prompt')
      return
    case 'moduleEnabled':
      addSettingsGroup('modules')
      return
    case 'settingsWithHypaV3Presets':
      if (event.id !== 'memory') {
        plan.full = true
        return
      }
      addSettingsGroup('memory')
      plan.collections.add('hypaV3Presets')
      return
    case 'character':
      addAllCharacters()
      return
    case 'characterOrder':
      plan.characterOrder = true
      return
    case 'characterSelection':
      if (!nonEmptyString(event.id)) {
        plan.full = true
        return
      }
      plan.characterSelectionIds.add(event.id)
      return
    case 'characterRow':
      addCharacter(event.parentId ?? event.id)
      return
    case 'scriptDefinition':
    case 'triggerDefinition':
      addCharacter(event.id)
      return
    case 'chat':
    case 'chatFolder':
      addCharacter(event.parentId)
      return
    case 'chatTranscript':
      addCharacter(event.parentId)
      addChat(event.id)
      return
    case 'message':
      if (nonEmptyString(event.id)) plan.translatedMessageIds.add(event.id)
      addChat(event.parentId)
      return
    case 'generation':
      addGenerationChat(event.parentId, event.id)
      return
    case 'characterLorebook':
      addLorebook(event.id)
      return
    case 'presetRow':
      if (!nonEmptyString(event.id)) {
        plan.full = true
        return
      }
      addLegacyPresetId(event.id)
      return
    case 'presetCollection':
      plan.collections.add('botPresets')
      addChangedLegacyPresetIds()
      return
    case 'presetCollectionWithPointer':
      addFullSettings()
      plan.collections.add('botPresets')
      addChangedLegacyPresetIds()
      return
    case 'presetPointer':
      addFullSettings()
      addLegacyPresetId(event.parentId)
      return
    case 'preset':
    case 'presetApplied':
      addFullSettings()
      plan.collections.add('botPresets')
      addChangedLegacyPresetIds()
      return
    case 'modelPreset':
      addFullSettings()
      plan.collections.add('modelPresets')
      return
    case 'promptPreset':
      addFullSettings()
      plan.collections.add('promptPresets')
      plan.refreshSelectedPromptTemplate = true
      return
    case 'legacyBotPreset':
      addFullSettings()
      plan.collections.add('botPresets')
      plan.collections.add('modelPresets')
      plan.collections.add('promptPresets')
      plan.refreshSelectedPromptTemplate = true
      return
    case 'promptItem':
      if (nonEmptyString(event.parentId)) {
        plan.promptTemplateOwnerIds.add(event.parentId)
      } else {
        plan.collections.add('promptTemplate')
      }
      return
    case 'persona':
      addFullSettings()
      plan.collections.add('personas')
      return
    case 'translatorPreset':
      addFullSettings()
      plan.collections.add('translatorPresets')
      return
    case 'loadout':
      if (
        event.type !== 'loadout.created' &&
        event.type !== 'loadout.updated' &&
        event.type !== 'loadout.deleted' &&
        event.type !== 'loadout.favorited' &&
        event.type !== 'loadout.touched'
      ) {
        plan.full = true
        return
      }
      if (event.type === 'loadout.touched') addSettingsGroup('sidebar')
      plan.collections.add('loadouts')
      return
    case 'globalLorebook':
      if (event.parentId !== undefined) {
        plan.full = true
        return
      }
      if (
        event.type === 'lorebook.created' ||
        event.type === 'lorebook.updated' ||
        event.type === 'lorebook.entries.replaced'
      ) {
        if (!nonEmptyString(event.id)) {
          plan.full = true
          return
        }
        plan.collections.add('loreBook')
        return
      }
      if (event.type === 'lorebook.selected') {
        if (!nonEmptyString(event.id)) {
          plan.full = true
          return
        }
        addFullSettings()
        return
      }
      if (event.type === 'lorebook.deleted') {
        if (!nonEmptyString(event.id)) {
          plan.full = true
          return
        }
        addFullSettings()
        plan.collections.add('loreBook')
        return
      }
      if (event.type === 'lorebook.reordered' && event.id === undefined) {
        addFullSettings()
        plan.collections.add('loreBook')
        return
      }
      plan.full = true
      return
    case 'moduleCreated':
    case 'moduleUpdated':
    case 'moduleReordered':
    case 'moduleScriptDefinition':
    case 'moduleTriggerDefinition':
      plan.collections.add('modules')
      return
    case 'module':
      addSettingsGroup('modules')
      plan.collections.add('modules')
      plan.collections.add('loadouts')
      addAllCharacters()
      return
    case 'pluginCollection':
      plan.collections.add('plugins')
      return
    case 'pluginProvider':
      addSettingsGroup('providers')
      return
    case 'pluginCollectionWithProvider':
      addSettingsGroup('providers')
      plan.collections.add('plugins')
      return
    case 'plugin':
      // Compatibility with retained events from older servers.
      addFullSettings()
      plan.collections.add('plugins')
      return
    case 'pluginStorage':
      plan.collections.add('pluginCustomStorage')
      return
    case 'agentPresetDeleted':
      if (!isWellFormedAgentPresetDeleteEvent(event)) {
        plan.full = true
        return
      }
      addSettingsGroup('agents')
      plan.collections.add('loadouts')
      addAllCharacters()
      return
    case 'lorebook':
    case 'state':
    default:
      plan.full = true
  }
}

function isWellFormedAgentPresetEvent(event: CommandEvent): boolean {
  const hasId = nonEmptyString(event.id)
  const hasParentId = nonEmptyString(event.parentId)
  switch (event.type) {
    case 'agentPreset.created':
    case 'agentPreset.updated':
      return hasId && event.parentId === undefined
    case 'agentPreset.duplicated':
      return hasId && hasParentId
    case 'agentPreset.reordered':
      return event.id === undefined && event.parentId === undefined
    case 'agentPreset.default.updated':
      return (event.id === undefined || hasId) && event.parentId === undefined
    case 'agentPreset.step.created':
    case 'agentPreset.step.updated':
    case 'agentPreset.step.duplicated':
    case 'agentPreset.step.deleted':
      return hasId && hasParentId
    case 'agentPreset.step.reordered':
      return hasId && event.parentId === undefined
    default:
      return false
  }
}

function isWellFormedAgentPresetDeleteEvent(event: CommandEvent): boolean {
  return event.type === 'agentPreset.deleted' && nonEmptyString(event.id) && event.parentId === undefined
}

async function runTargetedReads(
  plan: RefreshPlan,
  signal: AbortSignal | null | undefined,
): Promise<CompletedTargetedRead[]> {
  const reads: Array<Promise<CompletedTargetedRead>> = []
  if (plan.settings) {
    reads.push(fetchServerSettings(signal).then((result) => ({ kind: 'settings' as const, result })))
  }
  for (const group of plan.settingsGroups) {
    reads.push(
      fetchServerSettingsGroup(group, signal).then((result) => ({
        kind: 'settingsGroup' as const,
        group,
        result,
      })),
    )
  }
  for (const name of plan.collections) {
    if (name === 'botPresets') continue
    reads.push(fetchServerCollection(name, signal).then((result) => ({ kind: 'collection' as const, name, result })))
  }
  const legacyPresetIds = [...plan.legacyPresetIds]
  const legacyPresetBaseline = captureLegacyPresetResourceBaseline(legacyPresetIds)
  if (plan.collections.has('botPresets')) {
    reads.push(
      readLegacyPresetCollection(legacyPresetIds, legacyPresetBaseline, signal).then((result) => ({
        kind: 'legacyPresetCollection' as const,
        result,
      })),
    )
  } else {
    for (const presetId of legacyPresetIds) {
      reads.push(
        fetchServerLegacyPreset(presetId, { signal }).then((result) => ({
          kind: 'legacyPresetRow' as const,
          presetId,
          baseline: legacyPresetBaseline,
          result,
        })),
      )
    }
  }
  if (plan.allCharacters) {
    reads.push(fetchServerCharacters(signal).then((result) => ({ kind: 'characters' as const, result })))
  } else {
    for (const characterId of plan.characterIds) {
      reads.push(
        fetchServerCharacter(characterId, signal).then((result) => ({
          kind: 'character' as const,
          characterId,
          result,
        })),
      )
    }
    if (plan.characterOrder) {
      reads.push(fetchServerCharacterOrder(signal).then((result) => ({ kind: 'characterOrder' as const, result })))
    }
    for (const characterId of plan.characterSelectionIds) {
      reads.push(
        fetchServerCharacterSelection(characterId, signal).then((result) => ({
          kind: 'characterSelection' as const,
          characterId,
          result,
        })),
      )
    }
  }
  // The bulk chat endpoint intentionally omits alternates. Invalidation must
  // retain that authoritative swipe/reroll state, so fetch each changed chat
  // concurrently through the single-chat endpoint instead.
  for (const chatId of plan.chatIds) {
    reads.push(
      fetchServerChatMessages(chatId, { signal }).then((result) => ({ kind: 'chat' as const, chatId, result })),
    )
  }
  for (const [chatId, messageId] of plan.generationChatMessageIds) {
    reads.push(
      fetchServerGenerationChatMessages(chatId, messageId, { signal }).then((result) => ({
        kind: 'chat' as const,
        chatId,
        result,
      })),
    )
  }

  const lorebookCharacterIds = [...plan.lorebookCharacterIds]
  if (lorebookCharacterIds.length === 1) {
    const characterId = lorebookCharacterIds[0]
    reads.push(
      fetchServerCharacterLorebook(characterId, { signal }).then((result) => ({
        kind: 'lorebook' as const,
        characterId,
        result,
      })),
    )
  } else if (lorebookCharacterIds.length > 1) {
    reads.push(
      fetchServerBulkCharacterLorebooks(lorebookCharacterIds, { signal }).then((result) => ({
        kind: 'lorebooks' as const,
        characterIds: lorebookCharacterIds,
        result,
      })),
    )
  }
  return Promise.all(reads)
}

async function readLegacyPresetCollection(
  changedPresetIds: readonly string[],
  baseline: ServerLegacyPresetResourceBaseline,
  signal: AbortSignal | null | undefined,
): Promise<LegacyPresetCollectionReadResult> {
  for (let attempt = 0; attempt < FULL_RESOURCE_REFRESH_MAX_ATTEMPTS; attempt += 1) {
    const collection = await fetchServerCollection('botPresets', signal)
    if (collection.status !== 'ok') return collection
    const shells = collection.collections.botPresets
    if (!Array.isArray(shells)) {
      return { status: 'error', error: 'Invalid legacy preset collection response' }
    }
    const shellIds = uniqueLegacyPresetIds(shells)
    if (!shellIds) return { status: 'error', error: 'Invalid legacy preset collection response' }

    const requestedIds = changedPresetIds.filter((presetId) => shellIds.has(presetId))
    const presetReads = await Promise.all(requestedIds.map((presetId) => fetchServerLegacyPreset(presetId, { signal })))
    const failed = presetReads.find((result) => result.status !== 'ok')
    if (failed) return failed
    const rows = presetReads as Array<Extract<LegacyPresetReadResult, { status: 'ok' }>>
    if (rows.some((result) => result.revision !== collection.revision)) continue
    if (
      rows.some((result, index) => result.presetId !== requestedIds[index] || result.preset.id !== requestedIds[index])
    ) {
      return { status: 'error', error: 'Invalid legacy preset row response' }
    }
    return {
      status: 'ok',
      revision: collection.revision,
      shells,
      presetRows: rows.map((result) => result.preset),
      baseline,
    }
  }

  return {
    status: 'error',
    error: `Legacy preset resource revisions did not converge after ${FULL_RESOURCE_REFRESH_MAX_ATTEMPTS} attempts`,
  }
}

function uniqueLegacyPresetIds(rows: readonly unknown[]): Set<string> | null {
  const ids = new Set<string>()
  for (const candidate of rows) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null
    const presetId = (candidate as Record<string, unknown>).id
    if (!nonEmptyString(presetId) || ids.has(presetId)) return null
    ids.add(presetId)
  }
  return ids
}

function applyTargetedRead(
  entry: CompletedTargetedRead,
  hooks: Partial<ServerResourceInvalidationHooks> | undefined,
): boolean {
  switch (entry.kind) {
    case 'settings':
      return (
        entry.result.status !== 'ok' ||
        applySettingsResource(entry.result) ||
        settingsFullAlreadyAtLeast(entry.result.revision)
      )
    case 'settingsGroup':
      return (
        entry.result.status !== 'ok' ||
        applySettingsGroupResource(entry.result, SERVER_SETTINGS_KEYS_BY_GROUP[entry.group]) ||
        settingsGroupAlreadyAtLeast(entry.group, entry.result.revision)
      )
    case 'collection': {
      if (entry.result.status !== 'ok') return true
      const payload =
        entry.name === 'pluginCustomStorage'
          ? withPendingPluginStorage(entry.result, hooks?.mergePendingPluginStorage)
          : entry.result
      const applied = applyCollectionsResource(payload, entry.name)
      if (applied && entry.name === 'promptPresets') resetPromptTemplateHydration()
      const alreadyApplied = (collectionsResourceState.revisions[entry.name] ?? -1) >= entry.result.revision
      if (applied && entry.name === 'promptTemplate') {
        markPromptTemplateProjectionApplied(null, entry.result.revision)
      }
      return applied || alreadyApplied
    }
    case 'legacyPresetRow':
      if (entry.result.status !== 'ok') return true
      if (entry.result.presetId !== entry.presetId || entry.result.preset.id !== entry.presetId) return false
      return (
        applyLegacyPresetRowResource({
          revision: entry.result.revision,
          presetId: entry.presetId,
          preset: entry.result.preset,
          baseline: entry.baseline,
        }) || (collectionsResourceState.revisions.botPresets ?? -1) > entry.result.revision
      )
    case 'legacyPresetCollection':
      return (
        entry.result.status !== 'ok' ||
        applyLegacyPresetCollectionResource(entry.result) ||
        (collectionsResourceState.revisions.botPresets ?? -1) > entry.result.revision
      )
    case 'characters':
      return (
        entry.result.status !== 'ok' ||
        applyCharactersResource(entry.result) ||
        charactersAlreadyAtLeast(entry.result.revision)
      )
    case 'character':
      return (
        entry.result.status !== 'ok' ||
        applyCharacterResource(entry.result) ||
        characterAlreadyAtLeast(entry.characterId, entry.result.revision)
      )
    case 'characterOrder':
      return (
        entry.result.status !== 'ok' ||
        applyCharacterOrderResource(entry.result) ||
        (charactersResourceState.orderRevision ?? -1) >= entry.result.revision
      )
    case 'characterSelection':
      return (
        entry.result.status !== 'ok' ||
        applyCharacterSelectionResource(entry.result) ||
        characterSelectionAlreadyAtLeast(entry.characterId, entry.result.revision)
      )
    case 'chat':
      return (
        entry.result.status !== 'ok' || (entry.result.chatId === entry.chatId && applyChatMessages(entry.result, hooks))
      )
    case 'lorebook':
      return entry.result.status !== 'ok' || applyCharacterLorebook(entry.result, hooks)
    case 'lorebooks': {
      const result = entry.result
      if (result.status !== 'ok') return true
      const missing = new Set(result.missing)
      if (entry.characterIds.some((characterId) => missing.has(characterId))) return false
      return entry.characterIds.every((characterId) => {
        const character = result.characters.find((candidate) => candidate.characterId === characterId)
        return character
          ? applyCharacterLorebook({ status: 'ok', revision: result.revision, ...character }, hooks)
          : false
      })
    }
  }
}

async function refreshInvalidatedPromptTemplateOwners(
  plan: RefreshPlan,
  minimumRevision: number,
): Promise<string | null> {
  const ownerIds = new Set(plan.promptTemplateOwnerIds)
  if (plan.refreshSelectedPromptTemplate) {
    const selectedOwnerId = currentPromptTemplateOwnerId()
    if (selectedOwnerId !== null) ownerIds.add(selectedOwnerId)
  }
  if (ownerIds.size === 0) return null

  const selectedOwnerId = currentPromptTemplateOwnerId()
  for (const ownerId of ownerIds) invalidatePromptTemplateHydration(ownerId)
  const results = await Promise.all(
    [...ownerIds].map((ownerId) =>
      ensurePromptTemplateHydrated({
        applyProjection: ownerId === selectedOwnerId,
        force: true,
        minimumRevision,
        promptPresetId: ownerId,
      }),
    ),
  )
  return results.every(Boolean) ? null : 'Failed to refresh an invalidated prompt-template owner'
}

function applyChatMessages(
  result: Extract<ChatReadResult, { status: 'ok' }>,
  hooks: Partial<ServerResourceInvalidationHooks> | undefined,
): boolean {
  const characterId = characterIdForChat(result.chatId)
  if (!characterId) return false
  if (characterAlreadyNewer(characterId, result.revision)) return true
  if (!hooks?.applyChatMessages) return false
  const range =
    typeof result.messageStart === 'number' && typeof result.messageTotal === 'number'
      ? { start: result.messageStart, total: result.messageTotal }
      : undefined
  const applied = hooks.applyChatMessages(result.chatId, result.message, result.hypaV3Data, result.alternates, range)
  if (applied) markCharacterBodyRevision(characterId, result.revision)
  return applied
}

function applyCharacterLorebook(
  result: Extract<LorebookReadResult, { status: 'ok' }>,
  hooks: Partial<ServerResourceInvalidationHooks> | undefined,
): boolean {
  if (!charactersResourceState.characters.some((candidate) => candidate?.chaId === result.characterId)) return false
  if (characterAlreadyNewer(result.characterId, result.revision)) return true
  if (!hooks?.applyCharacterLorebook) return false
  const applied = hooks.applyCharacterLorebook(result.characterId, result.globalLore)
  if (applied) {
    hooks.markCharacterLorebookHydrated?.(result.characterId)
    markCharacterBodyRevision(result.characterId, result.revision)
    markCharacterLorebookProjectionApplied(result.characterId)
  }
  return applied
}

function characterIdForChat(chatId: string): string | undefined {
  for (const character of charactersResourceState.characters) {
    if (character.chats?.some((candidate) => candidate?.id === chatId)) return character.chaId
  }
  return undefined
}

function markCharacterBodyRevision(characterId: string, revision: number): void {
  charactersResourceState.rowRevisions[characterId] = Math.max(
    charactersResourceState.rowRevisions[characterId] ?? -1,
    revision,
  )
  charactersResourceState.revision = Math.max(charactersResourceState.revision ?? -1, revision)
  charactersResourceState.rowStatuses[characterId] = 'ready'
  delete charactersResourceState.rowErrors[characterId]
}

function withPendingPluginStorage<T extends ServerCollectionsResourcePayload>(
  payload: T,
  mergePendingPluginStorage: ServerResourceInvalidationHooks['mergePendingPluginStorage'] | undefined,
): T {
  if (!Object.prototype.hasOwnProperty.call(payload.collections, 'pluginCustomStorage')) return payload
  const current = payload.collections.pluginCustomStorage
  const authoritative = current && typeof current === 'object' && !Array.isArray(current) ? current : {}
  return {
    ...payload,
    collections: {
      ...payload.collections,
      pluginCustomStorage: mergePendingPluginStorage ? mergePendingPluginStorage(authoritative) : authoritative,
    },
  }
}

function missingRequiredHook(
  plan: RefreshPlan,
  hooks: Partial<ServerResourceInvalidationHooks> | undefined,
): keyof ServerResourceInvalidationHooks | null {
  const hasChatReads = plan.chatIds.size > 0 || plan.generationChatMessageIds.size > 0
  if (hasChatReads && !hooks?.applyChatMessages) return 'applyChatMessages'
  if (hasChatReads && !hooks?.triggerOpenChatGenerationReattach) {
    return 'triggerOpenChatGenerationReattach'
  }
  if (plan.translatedMessageIds.size > 0 && !hooks?.clearActiveMessageTranslation) {
    return 'clearActiveMessageTranslation'
  }
  if (plan.lorebookCharacterIds.size > 0 && !hooks?.applyCharacterLorebook) return 'applyCharacterLorebook'
  if (plan.lorebookCharacterIds.size > 0 && !hooks?.markCharacterLorebookHydrated) {
    return 'markCharacterLorebookHydrated'
  }
  return null
}

function firstFailedTargetedRead(
  reads: readonly CompletedTargetedRead[],
): Exclude<ServerResourceRefreshResult, { status: 'ok' }> | null {
  for (const entry of reads) {
    if (entry.result.status === 'error') return { status: 'error', error: entry.result.error }
    if (entry.result.status === 'unavailable') return { status: 'unavailable' }
  }
  return null
}

function failedRead(
  result: { status: 'error'; error: string } | { status: 'unavailable' },
): Exclude<ServerResourceRefreshResult, { status: 'ok' }> {
  return result.status === 'error' ? { status: 'error', error: result.error } : { status: 'unavailable' }
}

function targetedReadLabel(entry: CompletedTargetedRead): string {
  switch (entry.kind) {
    case 'settings':
      return 'settings'
    case 'settingsGroup':
      return `${entry.group} settings`
    case 'collection':
      return `${entry.name} collection`
    case 'legacyPresetRow':
      return `legacy preset ${entry.presetId}`
    case 'legacyPresetCollection':
      return 'legacy preset collection'
    case 'characters':
      return 'characters'
    case 'character':
      return `character ${entry.characterId}`
    case 'characterOrder':
      return 'character order'
    case 'characterSelection':
      return `character ${entry.characterId} selection`
    case 'chat':
      return `chat ${entry.chatId}`
    case 'lorebook':
      return `character ${entry.characterId} lorebook`
    case 'lorebooks':
      return `${entry.characterIds.length} character lorebooks`
  }
}

type NormalizedEventBatch =
  | { kind: 'targeted'; events: CommandEvent[]; revision: number }
  | { kind: 'full' }
  | { kind: 'none'; revision: number }
  | { kind: 'error'; error: string }

function normalizeEventBatch(
  events: readonly CommandEvent[],
  appliedRevisionInput: number | null | undefined,
): NormalizedEventBatch {
  if (events.some((event) => !Number.isInteger(event.revision) || event.revision < 0)) {
    return { kind: 'error', error: 'Command event revisions must be non-negative integers' }
  }
  const appliedRevision = normalizeAppliedRevision(appliedRevisionInput)
  if (appliedRevisionInput !== undefined && appliedRevisionInput !== null && appliedRevision === null) {
    return { kind: 'error', error: 'Applied revision must be a non-negative integer or null' }
  }
  if (appliedRevisionInput === null) return { kind: 'full' }

  const sorted = [...events].sort((left, right) => left.revision - right.revision)
  const relevant = appliedRevision === null ? sorted : sorted.filter((event) => event.revision > appliedRevision)
  if (relevant.length === 0) {
    return appliedRevision === null
      ? { kind: 'error', error: 'At least one unapplied command event is required' }
      : { kind: 'none', revision: appliedRevision }
  }

  const revisions = Array.from(new Set(relevant.map((event) => event.revision))).sort((left, right) => left - right)
  if (appliedRevision !== null && revisions[0] !== appliedRevision + 1) return { kind: 'full' }
  for (let index = 1; index < revisions.length; index += 1) {
    if (revisions[index] !== revisions[index - 1] + 1) return { kind: 'full' }
  }

  return { kind: 'targeted', events: relevant, revision: revisions.at(-1) as number }
}

function normalizeAppliedRevision(value: number | null | undefined): number | null {
  return Number.isInteger(value) && (value as number) >= 0 ? (value as number) : null
}

function settingsFullAlreadyAtLeast(revision: number): boolean {
  return (settingsResourceState.fullRevision ?? -1) >= revision
}

function settingsGroupAlreadyAtLeast(group: SettingsGroup, revision: number): boolean {
  return (
    Math.max(settingsResourceState.fullRevision ?? -1, settingsResourceState.groupRevisions[group] ?? -1) >= revision
  )
}

function collectionsAlreadyAtLeast(revision: number): boolean {
  return (collectionsResourceState.revision ?? -1) >= revision
}

function charactersAlreadyAtLeast(revision: number): boolean {
  return (charactersResourceState.revision ?? -1) >= revision
}

function characterAlreadyAtLeast(characterId: string, revision: number): boolean {
  return (
    Math.max(charactersResourceState.listRevision ?? -1, charactersResourceState.rowRevisions[characterId] ?? -1) >=
    revision
  )
}

function characterAlreadyNewer(characterId: string, revision: number): boolean {
  return (
    Math.max(charactersResourceState.listRevision ?? -1, charactersResourceState.rowRevisions[characterId] ?? -1) >
    revision
  )
}

function characterSelectionAlreadyAtLeast(characterId: string, revision: number): boolean {
  return (
    charactersResourceState.characters.some((candidate) => candidate?.chaId === characterId) &&
    (charactersResourceState.selectionRevision ?? -1) >= revision &&
    (charactersResourceState.rowRevisions[characterId] ?? -1) >= revision
  )
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}
