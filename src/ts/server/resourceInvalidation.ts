import type { CommandEvent } from './commands'
import {
  fetchServerBulkCharacterLorebooks,
  fetchServerCharacterLorebook,
  fetchServerChatMessages,
  fetchServerGenerationChatMessages,
} from './hydrationReads'
import {
  fetchServerCharacter,
  fetchServerCharacterOrder,
  fetchServerCharacterSelection,
  fetchServerCharacters,
  fetchServerCollection,
  fetchServerCollections,
  fetchServerSettings,
} from './resourceReads'
import {
  applyCharacterOrderResource,
  applyCharacterResource,
  applyCharacterSelectionResource,
  applyCharactersResource,
  applyCollectionsResource,
  applySettingsResource,
  charactersResourceState,
  collectionsResourceState,
  settingsResourceState,
  type ServerCollectionName,
  type ServerCollectionsResourcePayload,
} from './resourceState.svelte'
import { withServerResourceApply } from './resourceWriteGuard.svelte'

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
  collections: Set<ServerCollectionName>
  allCharacters: boolean
  characterIds: Set<string>
  characterOrder: boolean
  characterSelectionIds: Set<string>
  chatIds: Set<string>
  generationChatMessageIds: Map<string, string>
  lorebookCharacterIds: Set<string>
  translatedMessageIds: Set<string>
  full: boolean
}

type SettingsReadResult = Awaited<ReturnType<typeof fetchServerSettings>>
type CollectionReadResult = Awaited<ReturnType<typeof fetchServerCollection>>
type CharactersReadResult = Awaited<ReturnType<typeof fetchServerCharacters>>
type CharacterReadResult = Awaited<ReturnType<typeof fetchServerCharacter>>
type CharacterOrderReadResult = Awaited<ReturnType<typeof fetchServerCharacterOrder>>
type CharacterSelectionReadResult = Awaited<ReturnType<typeof fetchServerCharacterSelection>>
type ChatReadResult = Awaited<ReturnType<typeof fetchServerChatMessages>>
type LorebookReadResult = Awaited<ReturnType<typeof fetchServerCharacterLorebook>>
type BulkLorebookReadResult = Awaited<ReturnType<typeof fetchServerBulkCharacterLorebooks>>

type CompletedTargetedRead =
  | { kind: 'settings'; result: SettingsReadResult }
  | { kind: 'collection'; name: ServerCollectionName; result: CollectionReadResult }
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
      if (
        (!settingsApplied && !settingsAlreadyAtLeast(revision)) ||
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

  if (plan.chatIds.size > 0 || plan.generationChatMessageIds.size > 0) {
    options.hooks?.triggerOpenChatGenerationReattach?.()
  }
  for (const messageId of plan.translatedMessageIds) options.hooks?.clearActiveMessageTranslation?.(messageId)

  return { status: 'ok', revision: normalized.revision, scope: 'targeted' }
}

function createRefreshPlan(): RefreshPlan {
  return {
    settings: false,
    collections: new Set(),
    allCharacters: false,
    characterIds: new Set(),
    characterOrder: false,
    characterSelectionIds: new Set(),
    chatIds: new Set(),
    generationChatMessageIds: new Map(),
    lorebookCharacterIds: new Set(),
    translatedMessageIds: new Set(),
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

  switch (event.resource) {
    case 'asset':
    case 'revisionOnly':
      return
    case 'settings':
    case 'modelProfile':
    case 'agentPreset':
    case 'prompt':
    case 'moduleEnabled':
      plan.settings = true
      return
    case 'settingsWithHypaV3Presets':
      plan.settings = true
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
    case 'presetCollection':
      plan.collections.add('botPresets')
      return
    case 'presetCollectionWithPointer':
      plan.settings = true
      plan.collections.add('botPresets')
      return
    case 'presetPointer':
      plan.settings = true
      return
    case 'preset':
    case 'presetApplied':
      plan.settings = true
      plan.collections.add('botPresets')
      return
    case 'modelPreset':
      plan.settings = true
      plan.collections.add('modelPresets')
      return
    case 'promptPreset':
      plan.settings = true
      plan.collections.add('promptPresets')
      plan.collections.add('promptTemplate')
      return
    case 'legacyBotPreset':
      plan.settings = true
      plan.collections.add('botPresets')
      plan.collections.add('modelPresets')
      plan.collections.add('promptPresets')
      return
    case 'promptItem':
      plan.collections.add('promptPresets')
      plan.collections.add('promptTemplate')
      return
    case 'persona':
      plan.settings = true
      plan.collections.add('personas')
      return
    case 'translatorPreset':
      plan.settings = true
      plan.collections.add('translatorPresets')
      return
    case 'loadout':
      plan.settings = true
      plan.collections.add('loadouts')
      return
    case 'globalLorebook':
      plan.settings = true
      plan.collections.add('loreBook')
      return
    case 'moduleCreated':
    case 'moduleUpdated':
    case 'moduleReordered':
    case 'moduleScriptDefinition':
    case 'moduleTriggerDefinition':
      plan.collections.add('modules')
      return
    case 'module':
      plan.settings = true
      plan.collections.add('modules')
      plan.collections.add('loadouts')
      addAllCharacters()
      return
    case 'plugin':
      plan.settings = true
      plan.collections.add('plugins')
      return
    case 'pluginStorage':
      plan.collections.add('pluginCustomStorage')
      return
    case 'agentPresetDeleted':
      plan.settings = true
      plan.collections.add('loadouts')
      addAllCharacters()
      return
    case 'lorebook':
    case 'state':
    default:
      plan.full = true
  }
}

async function runTargetedReads(
  plan: RefreshPlan,
  signal: AbortSignal | null | undefined,
): Promise<CompletedTargetedRead[]> {
  const reads: Array<Promise<CompletedTargetedRead>> = []
  if (plan.settings) {
    reads.push(fetchServerSettings(signal).then((result) => ({ kind: 'settings' as const, result })))
  }
  for (const name of plan.collections) {
    reads.push(fetchServerCollection(name, signal).then((result) => ({ kind: 'collection' as const, name, result })))
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

function applyTargetedRead(
  entry: CompletedTargetedRead,
  hooks: Partial<ServerResourceInvalidationHooks> | undefined,
): boolean {
  switch (entry.kind) {
    case 'settings':
      return (
        entry.result.status !== 'ok' ||
        applySettingsResource(entry.result) ||
        settingsAlreadyAtLeast(entry.result.revision)
      )
    case 'collection': {
      if (entry.result.status !== 'ok') return true
      const payload =
        entry.name === 'pluginCustomStorage'
          ? withPendingPluginStorage(entry.result, hooks?.mergePendingPluginStorage)
          : entry.result
      return (
        applyCollectionsResource(payload, entry.name) ||
        (collectionsResourceState.revisions[entry.name] ?? -1) >= entry.result.revision
      )
    }
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
    case 'collection':
      return `${entry.name} collection`
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

function settingsAlreadyAtLeast(revision: number): boolean {
  return (settingsResourceState.revision ?? -1) >= revision
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
