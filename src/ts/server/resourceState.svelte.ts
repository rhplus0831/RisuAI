import type { Database, character } from '../storage/database.svelte'
import type { ChatGenerationSettings } from '../chatGenerationSettings'
import { shouldPreserveLiveChatGenerationSettingsForResource } from './chatGenerationSettingsResourceGuard'
import type { SettingsGroup } from './settingsGroups'

let nextCharacterRowProjectionEpoch = 0
let characterRowProjectionBaseline = 0
const characterRowProjectionEpochs = new Map<string, number>()

function advanceCharacterRowProjectionEpoch(characterId: string): void {
  characterRowProjectionEpochs.set(characterId, ++nextCharacterRowProjectionEpoch)
}

function advanceAllCharacterRowProjectionEpochs(): void {
  characterRowProjectionBaseline = ++nextCharacterRowProjectionEpoch
  characterRowProjectionEpochs.clear()
}

export function captureCharacterRowProjectionEpoch(characterId: string): number {
  return characterRowProjectionEpochs.get(characterId) ?? characterRowProjectionBaseline
}

export function hasCharacterRowProjectionEpochChanged(characterId: string, epoch: number): boolean {
  return captureCharacterRowProjectionEpoch(characterId) !== epoch
}

export const SERVER_COLLECTION_NAMES = [
  'modules',
  'plugins',
  'modelPresets',
  'promptPresets',
  'botPresets',
  'promptTemplate',
  'personas',
  'loadouts',
  'loreBook',
  'translatorPresets',
  'hypaV3Presets',
  'pluginCustomStorage',
] as const

export type ServerCollectionName = (typeof SERVER_COLLECTION_NAMES)[number]
export type ServerCollectionValues = Pick<Database, ServerCollectionName>
export type ServerSettingsValues = Partial<
  Omit<Database, 'characters' | ServerCollectionName> & {
    currentChar: number
  }
>

export interface ServerSettingsResourcePayload {
  revision: number
  settings: ServerSettingsValues
}

export interface ServerSettingsGroupResourcePayload {
  revision: number
  group: SettingsGroup
  settings: ServerSettingsValues
}

export interface ServerCollectionsResourcePayload {
  revision: number
  collections: Partial<ServerCollectionValues>
}

export interface ServerCharactersResourcePayload {
  revision: number
  characters: character[]
  characterOrder: Database['characterOrder']
  currentChar: number
}

export interface ServerCharacterResourcePayload {
  revision: number
  character: character
}

export interface ServerCharacterOrderResourcePayload {
  revision: number
  characterOrder: Database['characterOrder']
}

export interface ServerCharacterSelectionResourcePayload {
  revision: number
  characterId: string
  currentChar: number
  lastInteraction?: number
}

export interface ServerChatGenerationSettingsLocalEffectPayload {
  revision: number
  characterId: string
  chatId: string
  attemptedGenerationSettings: ChatGenerationSettings
  generationSettings: ChatGenerationSettings
}

export interface ServerCharacterPatchLocalEffectPayload {
  revision: number
  characterId: string
  patch: Record<string, unknown>
}

export interface ServerCharacterSelectionLocalEffectPayload {
  revision: number
  characterId: string
  lastInteraction: number
}

export interface ServerCharacterCollectionMutationLocalEffectPayload {
  revision: number
  operation: 'create' | 'createAndSelect' | 'delete'
  characterId: string
  selectedCharacterId: string | null
}

export interface ServerChatPatchLocalEffectPayload {
  revision: number
  characterId: string
  chatId: string
  patch: Record<string, unknown>
  select: boolean
}

export interface ServerSettingsPatchLocalEffectPayload {
  revision: number
  group: SettingsGroup
  attemptedPatch: Record<string, unknown>
  settings: Record<string, unknown>
}

export interface ServerPluginStorageLocalEffectPayload {
  revision: number
}

export interface ServerPluginCollectionMutationLocalEffectPayload {
  revision: number
  operation: 'create' | 'update' | 'delete' | 'enable' | 'reorder'
  pluginId?: string
  pluginIds?: readonly string[]
}

export interface ServerPluginProviderLocalEffectPayload {
  revision: number
  provider: string
}

export interface ServerModuleCollectionMutationLocalEffectPayload {
  revision: number
  operation: 'create' | 'update' | 'reorder' | 'lorebooks' | 'scripts' | 'triggers'
  moduleId?: string
  moduleIds?: readonly string[]
}

export interface ServerModuleEnabledLocalEffectPayload {
  revision: number
  moduleId: string
  enabled: boolean
}

export interface ServerCharacterRowMutationLocalEffectPayload {
  revision: number
  characterId: string
  targetId: string
}

export interface ServerCharacterOrderLocalEffectPayload {
  revision: number
  attemptedOrder: readonly unknown[]
}

export type ServerResourceStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface SettingsResourceState {
  value: ServerSettingsValues
  revision: number | null
  fullRevision: number | null
  enabledModulesRevision: number | null
  groupRevisions: Partial<Record<SettingsGroup, number>>
  status: ServerResourceStatus
  error: string | null
}

export interface CollectionsResourceState {
  values: Partial<ServerCollectionValues>
  revision: number | null
  fullRevision: number | null
  revisions: Partial<Record<ServerCollectionName, number>>
  status: ServerResourceStatus
  statuses: Partial<Record<ServerCollectionName, ServerResourceStatus>>
  error: string | null
  errors: Partial<Record<ServerCollectionName, string>>
}

export interface CharactersResourceState {
  characters: character[]
  characterOrder: Database['characterOrder']
  currentChar: number
  revision: number | null
  listRevision: number | null
  orderRevision: number | null
  selectionRevision: number | null
  rowRevisions: Record<string, number>
  status: ServerResourceStatus
  rowStatuses: Record<string, ServerResourceStatus>
  error: string | null
  rowErrors: Record<string, string>
}

export const settingsResourceState = $state<SettingsResourceState>({
  value: {},
  revision: null,
  fullRevision: null,
  enabledModulesRevision: null,
  groupRevisions: {},
  status: 'idle',
  error: null,
})

export const collectionsResourceState = $state<CollectionsResourceState>({
  values: {},
  revision: null,
  fullRevision: null,
  revisions: {},
  status: 'idle',
  statuses: {},
  error: null,
  errors: {},
})

export const charactersResourceState = $state<CharactersResourceState>({
  characters: [],
  characterOrder: [],
  currentChar: -1,
  revision: null,
  listRevision: null,
  orderRevision: null,
  selectionRevision: null,
  rowRevisions: {},
  status: 'idle',
  rowStatuses: {},
  error: null,
  rowErrors: {},
})

const collectionNameSet = new Set<string>(SERVER_COLLECTION_NAMES)
const guardedResourceValueMemo = new WeakMap<object, object>()
let resourceDatabaseWriteDepth = 0
let resourceDatabaseWriteGuardEnabled = false
let resourceDatabaseWriteChanged = false
let resourceDatabaseFacadeEpoch = $state(0)

export function setResourceDatabaseWriteGuardEnabled(enabled: boolean): void {
  resourceDatabaseWriteGuardEnabled = enabled
}

export function isResourceDatabaseWriteActive(): boolean {
  return resourceDatabaseWriteDepth > 0
}

export function getResourceDatabaseFacadeEpoch(): number {
  return resourceDatabaseFacadeEpoch
}

export function isServerCollectionName(value: string): value is ServerCollectionName {
  return collectionNameSet.has(value)
}

export function beginSettingsResourceLoad(): void {
  settingsResourceState.status = 'loading'
  settingsResourceState.error = null
}

export function failSettingsResourceLoad(error: string): void {
  settingsResourceState.status = 'error'
  settingsResourceState.error = error
}

export function applySettingsResource(payload: ServerSettingsResourcePayload): boolean {
  if (isOlderRevision(payload.revision, settingsResourceState.fullRevision)) return false
  if (Object.values(settingsResourceState.groupRevisions).some((revision) => revision > payload.revision)) return false
  const preserveEnabledModules = (settingsResourceState.enabledModulesRevision ?? -1) > payload.revision
  const liveEnabledModules = preserveEnabledModules
    ? cloneJsonValue((settingsResourceState.value as Record<string, unknown>).enabledModules)
    : undefined
  settingsResourceState.value = cloneJsonValue(payload.settings)
  if (preserveEnabledModules) {
    ;(settingsResourceState.value as Record<string, unknown>).enabledModules = liveEnabledModules
  }
  settingsResourceState.revision = preserveEnabledModules
    ? maxRevision(settingsResourceState.revision, payload.revision)
    : payload.revision
  settingsResourceState.fullRevision = payload.revision
  settingsResourceState.enabledModulesRevision = preserveEnabledModules
    ? settingsResourceState.enabledModulesRevision
    : null
  settingsResourceState.groupRevisions = {}
  settingsResourceState.status = 'ready'
  settingsResourceState.error = null
  markResourceDatabaseChanged()
  return true
}

export function applySettingsGroupResource(
  payload: ServerSettingsGroupResourcePayload,
  groupKeys: readonly string[],
): boolean {
  const currentRevision = Math.max(
    settingsResourceState.fullRevision ?? -1,
    settingsResourceState.groupRevisions[payload.group] ?? -1,
  )
  if (payload.revision < currentRevision) return false

  const target = settingsResourceState.value as Record<string, unknown>
  const incoming = payload.settings as Record<string, unknown>
  for (const key of groupKeys) {
    if (key === 'hypaV3Presets') continue
    if (Object.prototype.hasOwnProperty.call(incoming, key)) {
      target[key] = cloneJsonValue(incoming[key])
    } else {
      delete target[key]
    }
  }
  settingsResourceState.groupRevisions[payload.group] = payload.revision
  settingsResourceState.revision = maxRevision(settingsResourceState.revision, payload.revision)
  settingsResourceState.status = 'ready'
  settingsResourceState.error = null
  markResourceDatabaseChanged()
  return true
}

/**
 * Apply the canonical keys returned by an accepted settings command without
 * re-reading the complete settings group. A later queued edit may already be
 * visible, so canonicalize a key only while its live value still matches the
 * value sent by this command; either way, advance the relevant revision fence.
 */
export function applySettingsPatchLocalEffect(payload: ServerSettingsPatchLocalEffectPayload): boolean {
  const attemptedKeys = Object.keys(payload.attemptedPatch).sort()
  const canonicalKeys = Object.keys(payload.settings).sort()
  if (attemptedKeys.length === 0 || !isJsonValueEqual(attemptedKeys, canonicalKeys)) return false

  const writesHypaV3Presets = attemptedKeys.includes('hypaV3Presets')
  const knownSettingsRevision = Math.max(
    settingsResourceState.fullRevision ?? -1,
    settingsResourceState.groupRevisions[payload.group] ?? -1,
  )
  const knownHypaV3PresetsRevision = Math.max(
    collectionsResourceState.fullRevision ?? -1,
    collectionsResourceState.revisions.hypaV3Presets ?? -1,
  )
  if (
    knownSettingsRevision >= payload.revision &&
    (!writesHypaV3Presets || knownHypaV3PresetsRevision >= payload.revision)
  ) {
    return true
  }

  const settingsTarget = settingsResourceState.value as Record<string, unknown>
  for (const key of attemptedKeys) {
    if (key === 'hypaV3Presets') {
      if (isJsonValueEqual(collectionsResourceState.values.hypaV3Presets, payload.attemptedPatch[key])) {
        collectionsResourceState.values.hypaV3Presets = cloneJsonValue(payload.settings[key]) as never
      }
      continue
    }
    if (isJsonValueEqual(settingsTarget[key], payload.attemptedPatch[key])) {
      settingsTarget[key] = cloneJsonValue(payload.settings[key])
    }
  }

  if (knownSettingsRevision < payload.revision) {
    settingsResourceState.groupRevisions[payload.group] = payload.revision
    settingsResourceState.revision = maxRevision(settingsResourceState.revision, payload.revision)
    settingsResourceState.status = 'ready'
    settingsResourceState.error = null
  }
  if (writesHypaV3Presets && knownHypaV3PresetsRevision < payload.revision) {
    collectionsResourceState.revisions.hypaV3Presets = payload.revision
    collectionsResourceState.revision = maxRevision(collectionsResourceState.revision, payload.revision)
    collectionsResourceState.statuses.hypaV3Presets = 'ready'
    delete collectionsResourceState.errors.hypaV3Presets
  }
  markResourceDatabaseChanged()
  return true
}

/**
 * Fence a response-confirmed optimistic plugin-storage mutation. Storage
 * values are arbitrary and potentially large, so avoid re-downloading the
 * complete map after the server accepted the exact JSON already shown locally.
 */
export function applyPluginStorageLocalEffect(payload: ServerPluginStorageLocalEffectPayload): boolean {
  const knownRevision = Math.max(
    collectionsResourceState.fullRevision ?? -1,
    collectionsResourceState.revisions.pluginCustomStorage ?? -1,
  )
  if (knownRevision >= payload.revision) return true

  const storage = collectionsResourceState.values.pluginCustomStorage
  if (!storage || typeof storage !== 'object' || Array.isArray(storage)) return false
  if (collectionsResourceState.statuses.pluginCustomStorage !== 'ready') return false

  collectionsResourceState.revisions.pluginCustomStorage = payload.revision
  collectionsResourceState.revision = maxRevision(collectionsResourceState.revision, payload.revision)
  collectionsResourceState.statuses.pluginCustomStorage = 'ready'
  delete collectionsResourceState.errors.pluginCustomStorage
  markResourceDatabaseChanged()
  return true
}

/**
 * Fence a response-confirmed optimistic plugin-record mutation. Plugin scripts
 * can be large, and the browser already holds the exact accepted record or
 * ordering. Preserve any newer queued mutation while preventing older
 * collection reads from replacing it.
 */
export function applyPluginCollectionMutationLocalEffect(
  payload: ServerPluginCollectionMutationLocalEffectPayload,
): boolean {
  const knownRevision = Math.max(
    collectionsResourceState.fullRevision ?? -1,
    collectionsResourceState.revisions.plugins ?? -1,
  )
  if (knownRevision >= payload.revision) return true

  const plugins = collectionsResourceState.values.plugins
  if (!Array.isArray(plugins) || collectionsResourceState.statuses.plugins !== 'ready') return false
  if (payload.operation === 'reorder') {
    if (!isUniqueStringArray(payload.pluginIds)) return false
  } else if (!nonEmptyString(payload.pluginId)) {
    return false
  }

  collectionsResourceState.revisions.plugins = payload.revision
  collectionsResourceState.revision = maxRevision(collectionsResourceState.revision, payload.revision)
  collectionsResourceState.statuses.plugins = 'ready'
  delete collectionsResourceState.errors.plugins
  markResourceDatabaseChanged()
  return true
}

/** Fence an accepted optimistic plugin-provider selection without a settings read. */
export function applyPluginProviderLocalEffect(payload: ServerPluginProviderLocalEffectPayload): boolean {
  const knownRevision = Math.max(
    settingsResourceState.fullRevision ?? -1,
    settingsResourceState.groupRevisions.providers ?? -1,
  )
  if (knownRevision >= payload.revision) return true

  const provider = (settingsResourceState.value as Record<string, unknown>).currentPluginProvider
  if (typeof provider !== 'string' || typeof payload.provider !== 'string') return false

  // A later queued provider selection may already be visible. The response
  // effect proves this earlier value was accepted, so advance the fence while
  // deliberately retaining the newer optimistic provider.

  settingsResourceState.groupRevisions.providers = payload.revision
  settingsResourceState.revision = maxRevision(settingsResourceState.revision, payload.revision)
  settingsResourceState.status = 'ready'
  settingsResourceState.error = null
  markResourceDatabaseChanged()
  return true
}

/** Fence an accepted optimistic module-record mutation without re-downloading large module definitions. */
export function applyModuleCollectionMutationLocalEffect(
  payload: ServerModuleCollectionMutationLocalEffectPayload,
): boolean {
  const knownRevision = Math.max(
    collectionsResourceState.fullRevision ?? -1,
    collectionsResourceState.revisions.modules ?? -1,
  )
  if (knownRevision >= payload.revision) return true

  const modules = collectionsResourceState.values.modules
  if (!isNormalizedModuleCollectionProjection(modules) || collectionsResourceState.statuses.modules !== 'ready') {
    return false
  }
  if (payload.operation === 'reorder') {
    if (!isUniqueStringArray(payload.moduleIds)) return false
  } else if (!nonEmptyString(payload.moduleId)) {
    return false
  }

  collectionsResourceState.revisions.modules = payload.revision
  collectionsResourceState.revision = maxRevision(collectionsResourceState.revision, payload.revision)
  collectionsResourceState.statuses.modules = 'ready'
  delete collectionsResourceState.errors.modules
  markResourceDatabaseChanged()
  return true
}

/** Fence one accepted optimistic enabledModules membership write without a full settings read. */
export function applyModuleEnabledLocalEffect(payload: ServerModuleEnabledLocalEffectPayload): boolean {
  const knownRevision = Math.max(
    settingsResourceState.fullRevision ?? -1,
    settingsResourceState.enabledModulesRevision ?? -1,
  )
  if (knownRevision >= payload.revision) return true
  if (!nonEmptyString(payload.moduleId) || typeof payload.enabled !== 'boolean') return false

  const enabledModules = (settingsResourceState.value as Record<string, unknown>).enabledModules
  if (settingsResourceState.status !== 'ready' || !isUniqueStringArray(enabledModules)) {
    return false
  }

  settingsResourceState.enabledModulesRevision = payload.revision
  settingsResourceState.revision = maxRevision(settingsResourceState.revision, payload.revision)
  settingsResourceState.status = 'ready'
  settingsResourceState.error = null
  markResourceDatabaseChanged()
  return true
}

export function beginCollectionsResourceLoad(name?: ServerCollectionName): void {
  if (name) {
    collectionsResourceState.statuses[name] = 'loading'
    delete collectionsResourceState.errors[name]
    return
  }
  collectionsResourceState.status = 'loading'
  collectionsResourceState.error = null
}

export function failCollectionsResourceLoad(error: string, name?: ServerCollectionName): void {
  if (name) {
    collectionsResourceState.statuses[name] = 'error'
    collectionsResourceState.errors[name] = error
    return
  }
  collectionsResourceState.status = 'error'
  collectionsResourceState.error = error
}

export function applyCollectionsResource(
  payload: ServerCollectionsResourcePayload,
  requestedName?: ServerCollectionName,
): boolean {
  const names = requestedName
    ? [requestedName]
    : SERVER_COLLECTION_NAMES.filter((name) => Object.prototype.hasOwnProperty.call(payload.collections, name))
  if (requestedName && !Object.prototype.hasOwnProperty.call(payload.collections, requestedName)) return false

  let applied = false
  for (const name of names) {
    if (isOlderRevision(payload.revision, collectionsResourceState.revisions[name] ?? null)) continue
    collectionsResourceState.values[name] = cloneJsonValue(payload.collections[name]) as never
    collectionsResourceState.revisions[name] = payload.revision
    collectionsResourceState.statuses[name] = 'ready'
    delete collectionsResourceState.errors[name]
    applied = true
  }

  if (!requestedName && !isOlderRevision(payload.revision, collectionsResourceState.fullRevision)) {
    collectionsResourceState.fullRevision = payload.revision
    collectionsResourceState.status = 'ready'
    collectionsResourceState.error = null
  }
  if (applied) {
    collectionsResourceState.revision = maxRevision(collectionsResourceState.revision, payload.revision)
    markResourceDatabaseChanged()
  }
  return applied
}

export function beginCharactersResourceLoad(characterId?: string): void {
  if (characterId) {
    charactersResourceState.rowStatuses[characterId] = 'loading'
    delete charactersResourceState.rowErrors[characterId]
    return
  }
  charactersResourceState.status = 'loading'
  charactersResourceState.error = null
}

export function failCharactersResourceLoad(error: string, characterId?: string): void {
  if (characterId) {
    charactersResourceState.rowStatuses[characterId] = 'error'
    charactersResourceState.rowErrors[characterId] = error
    return
  }
  charactersResourceState.status = 'error'
  charactersResourceState.error = error
}

export function applyCharactersResource(
  payload: ServerCharactersResourcePayload,
  options: { preserveResidentChatBodies?: boolean } = {},
): boolean {
  if (isOlderRevision(payload.revision, charactersResourceState.listRevision)) return false
  if (isOlderRevision(payload.revision, charactersResourceState.orderRevision)) return false
  if (isOlderRevision(payload.revision, charactersResourceState.selectionRevision)) return false
  if (Object.values(charactersResourceState.rowRevisions).some((revision) => revision > payload.revision)) return false

  const preserveResidentChatBodies = options.preserveResidentChatBodies ?? true
  const existingById = preserveResidentChatBodies
    ? new Map(
        charactersResourceState.characters
          .filter((candidate) => nonEmptyString(candidate?.chaId))
          .map((candidate) => [candidate.chaId, candidate]),
      )
    : null
  charactersResourceState.characters = payload.characters.map((candidate) => {
    const nextCharacter = cloneJsonValue(candidate)
    return existingById
      ? preserveResidentCharacterChatBodies(nextCharacter, existingById.get(candidate.chaId))
      : nextCharacter
  })
  charactersResourceState.characterOrder = cloneJsonValue(payload.characterOrder)
  charactersResourceState.currentChar = payload.currentChar
  charactersResourceState.revision = maxRevision(charactersResourceState.revision, payload.revision)
  charactersResourceState.listRevision = payload.revision
  charactersResourceState.orderRevision = payload.revision
  charactersResourceState.selectionRevision = payload.revision
  charactersResourceState.rowRevisions = Object.fromEntries(
    payload.characters
      .filter((candidate) => nonEmptyString(candidate?.chaId))
      .map((candidate) => [candidate.chaId, payload.revision]),
  )
  charactersResourceState.rowStatuses = Object.fromEntries(
    payload.characters
      .filter((candidate) => nonEmptyString(candidate?.chaId))
      .map((candidate) => [candidate.chaId, 'ready']),
  )
  charactersResourceState.rowErrors = {}
  charactersResourceState.status = 'ready'
  charactersResourceState.error = null
  advanceAllCharacterRowProjectionEpochs()
  markResourceDatabaseChanged()
  return true
}

/**
 * Fence an accepted optimistic character create/delete without replacing the
 * live collection. Later queued list, order, or selection edits may already be
 * visible, so this only advances revision ownership after validating that the
 * local projection remains a normalized collection with the expected target.
 */
export function applyCharacterCollectionMutationLocalEffect(
  payload: ServerCharacterCollectionMutationLocalEffectPayload,
): boolean {
  if ((charactersResourceState.listRevision ?? -1) >= payload.revision) return true
  if (charactersResourceState.status !== 'ready' || !nonEmptyString(payload.characterId)) return false
  if (payload.selectedCharacterId !== null && !nonEmptyString(payload.selectedCharacterId)) return false
  if (
    payload.operation === 'createAndSelect'
      ? payload.selectedCharacterId !== payload.characterId
      : payload.selectedCharacterId === payload.characterId
  ) {
    return false
  }
  if (!isNormalizedCharacterCollectionProjection()) return false

  const targetPresent = charactersResourceState.characters.some((candidate) => candidate?.chaId === payload.characterId)
  if (payload.operation === 'delete' ? targetPresent : !targetPresent) return false

  charactersResourceState.listRevision = maxRevision(charactersResourceState.listRevision, payload.revision)
  charactersResourceState.orderRevision = maxRevision(charactersResourceState.orderRevision, payload.revision)
  charactersResourceState.selectionRevision = maxRevision(charactersResourceState.selectionRevision, payload.revision)
  charactersResourceState.rowRevisions[payload.characterId] = Math.max(
    charactersResourceState.rowRevisions[payload.characterId] ?? -1,
    payload.revision,
  )
  if (payload.operation === 'delete') {
    delete charactersResourceState.rowStatuses[payload.characterId]
    delete charactersResourceState.rowErrors[payload.characterId]
  } else {
    charactersResourceState.rowStatuses[payload.characterId] = 'ready'
    delete charactersResourceState.rowErrors[payload.characterId]
  }
  charactersResourceState.revision = maxRevision(charactersResourceState.revision, payload.revision)
  charactersResourceState.status = 'ready'
  charactersResourceState.error = null
  markResourceDatabaseChanged()
  return true
}

export function applyCharacterResource(payload: ServerCharacterResourcePayload): boolean {
  const characterId = payload.character?.chaId
  if (!nonEmptyString(characterId)) return false
  if (isOlderRevision(payload.revision, charactersResourceState.rowRevisions[characterId] ?? null)) return false
  if (isOlderRevision(payload.revision, charactersResourceState.listRevision)) return false

  const index = charactersResourceState.characters.findIndex((candidate) => candidate?.chaId === characterId)
  const nextCharacter = preserveResidentCharacterChatBodies(
    cloneJsonValue(payload.character),
    index >= 0 ? charactersResourceState.characters[index] : undefined,
  )
  if (index >= 0) {
    charactersResourceState.characters[index] = nextCharacter
  } else {
    charactersResourceState.characters.push(nextCharacter)
  }
  charactersResourceState.rowRevisions[characterId] = payload.revision
  charactersResourceState.rowStatuses[characterId] = 'ready'
  delete charactersResourceState.rowErrors[characterId]
  charactersResourceState.revision = maxRevision(charactersResourceState.revision, payload.revision)
  advanceCharacterRowProjectionEpoch(characterId)
  markResourceDatabaseChanged()
  return true
}

export function applyCharacterOrderResource(payload: ServerCharacterOrderResourcePayload): boolean {
  if (isOlderRevision(payload.revision, charactersResourceState.listRevision)) return false
  if (isOlderRevision(payload.revision, charactersResourceState.orderRevision)) return false

  charactersResourceState.characterOrder = cloneJsonValue(payload.characterOrder)
  charactersResourceState.orderRevision = payload.revision
  charactersResourceState.revision = maxRevision(charactersResourceState.revision, payload.revision)
  markResourceDatabaseChanged()
  return true
}

/** Fence an exact optimistic character-order write without re-reading it. */
export function applyCharacterOrderLocalEffect(payload: ServerCharacterOrderLocalEffectPayload): boolean {
  const knownRevision = Math.max(
    charactersResourceState.listRevision ?? -1,
    charactersResourceState.orderRevision ?? -1,
  )
  if (knownRevision >= payload.revision) return true
  if (!Array.isArray(payload.attemptedOrder)) return false

  charactersResourceState.orderRevision = payload.revision
  charactersResourceState.revision = maxRevision(charactersResourceState.revision, payload.revision)
  markResourceDatabaseChanged()
  return true
}

export function applyCharacterSelectionResource(payload: ServerCharacterSelectionResourcePayload): boolean {
  if (isOlderRevision(payload.revision, charactersResourceState.listRevision)) return false
  if (isOlderRevision(payload.revision, charactersResourceState.selectionRevision)) return false
  if (isOlderRevision(payload.revision, charactersResourceState.rowRevisions[payload.characterId] ?? null)) return false

  const characterIndex = charactersResourceState.characters.findIndex(
    (candidate) => candidate?.chaId === payload.characterId,
  )
  if (
    characterIndex < 0 ||
    payload.currentChar < 0 ||
    payload.currentChar >= charactersResourceState.characters.length
  ) {
    return false
  }

  charactersResourceState.currentChar = payload.currentChar
  if (typeof payload.lastInteraction === 'number') {
    charactersResourceState.characters[characterIndex].lastInteraction = payload.lastInteraction
  }
  charactersResourceState.selectionRevision = payload.revision
  charactersResourceState.rowRevisions[payload.characterId] = payload.revision
  charactersResourceState.rowStatuses[payload.characterId] = 'ready'
  delete charactersResourceState.rowErrors[payload.characterId]
  charactersResourceState.revision = maxRevision(charactersResourceState.revision, payload.revision)
  markResourceDatabaseChanged()
  return true
}

/**
 * Apply the authoritative result of this client's accepted chat-generation
 * settings command without re-reading the complete parent character. A newer
 * optimistic edit may already be visible while an older command response is
 * being reconciled; in that case keep the live overlay while still fencing the
 * accepted row revision.
 */
export function applyChatGenerationSettingsLocalEffect(
  payload: ServerChatGenerationSettingsLocalEffectPayload,
): boolean {
  const knownRowRevision = Math.max(
    charactersResourceState.listRevision ?? -1,
    charactersResourceState.rowRevisions[payload.characterId] ?? -1,
  )
  if (knownRowRevision >= payload.revision) return true

  const character = charactersResourceState.characters.find((candidate) => candidate?.chaId === payload.characterId)
  const chat = character?.chats?.find((candidate) => candidate?.id === payload.chatId)
  if (!chat) return false

  if (isJsonValueEqual(chat.generationSettings, payload.attemptedGenerationSettings)) {
    chat.generationSettings = cloneJsonValue(payload.generationSettings)
  }
  charactersResourceState.rowRevisions[payload.characterId] = payload.revision
  charactersResourceState.rowStatuses[payload.characterId] = 'ready'
  delete charactersResourceState.rowErrors[payload.characterId]
  charactersResourceState.revision = maxRevision(charactersResourceState.revision, payload.revision)
  markResourceDatabaseChanged()
  return true
}

/**
 * Acknowledge an accepted optimistic character patch without re-reading the
 * complete row. The live row may already contain a newer queued edit, so the
 * acknowledgement only fences its revision and never reapplies older fields.
 */
export function applyCharacterPatchLocalEffect(payload: ServerCharacterPatchLocalEffectPayload): boolean {
  const knownRowRevision = Math.max(
    charactersResourceState.listRevision ?? -1,
    charactersResourceState.rowRevisions[payload.characterId] ?? -1,
  )
  if (knownRowRevision >= payload.revision) return true
  if (Object.keys(payload.patch).length === 0) return false

  // A newer optimistic delete can remove the row before this accepted patch is
  // reconciled. Fence the acknowledgement anyway so the following delete event
  // can reconcile instead of trying to read a row that no longer exists.
  charactersResourceState.rowRevisions[payload.characterId] = payload.revision
  charactersResourceState.rowStatuses[payload.characterId] = 'ready'
  delete charactersResourceState.rowErrors[payload.characterId]
  charactersResourceState.revision = maxRevision(charactersResourceState.revision, payload.revision)
  markResourceDatabaseChanged()
  return true
}

/**
 * Fence an accepted optimistic write to a chat/folder field stored beneath one
 * character row. The caller already applied the exact field mutation, and a
 * newer queued edit must remain untouched.
 */
export function applyCharacterRowMutationLocalEffect(payload: ServerCharacterRowMutationLocalEffectPayload): boolean {
  const knownRowRevision = Math.max(
    charactersResourceState.listRevision ?? -1,
    charactersResourceState.rowRevisions[payload.characterId] ?? -1,
  )
  if (knownRowRevision >= payload.revision) return true
  if (!nonEmptyString(payload.targetId)) return false

  charactersResourceState.rowRevisions[payload.characterId] = payload.revision
  charactersResourceState.rowStatuses[payload.characterId] = 'ready'
  delete charactersResourceState.rowErrors[payload.characterId]
  charactersResourceState.revision = maxRevision(charactersResourceState.revision, payload.revision)
  markResourceDatabaseChanged()
  return true
}

/**
 * Fence a response-confirmed optimistic character selection. A later selection
 * or delete may already be visible, so keep the live pointers and timestamp.
 */
export function applyCharacterSelectionLocalEffect(payload: ServerCharacterSelectionLocalEffectPayload): boolean {
  const knownSelectionRevision = Math.max(
    charactersResourceState.listRevision ?? -1,
    charactersResourceState.selectionRevision ?? -1,
    charactersResourceState.rowRevisions[payload.characterId] ?? -1,
  )
  if (knownSelectionRevision >= payload.revision) return true
  if (!Number.isFinite(payload.lastInteraction)) return false

  charactersResourceState.selectionRevision = payload.revision
  charactersResourceState.rowRevisions[payload.characterId] = payload.revision
  charactersResourceState.rowStatuses[payload.characterId] = 'ready'
  delete charactersResourceState.rowErrors[payload.characterId]
  charactersResourceState.revision = maxRevision(charactersResourceState.revision, payload.revision)
  markResourceDatabaseChanged()
  return true
}

/**
 * Fence an accepted optimistic chat metadata or selection update. Later chat
 * edits, selections, or deletion remain untouched while the parent-row fence
 * prevents an older character response from overwriting them.
 */
export function applyChatPatchLocalEffect(payload: ServerChatPatchLocalEffectPayload): boolean {
  const knownRowRevision = Math.max(
    charactersResourceState.listRevision ?? -1,
    charactersResourceState.rowRevisions[payload.characterId] ?? -1,
  )
  if (knownRowRevision >= payload.revision) return true
  if (Object.keys(payload.patch).length === 0 && !payload.select) return false

  charactersResourceState.rowRevisions[payload.characterId] = payload.revision
  charactersResourceState.rowStatuses[payload.characterId] = 'ready'
  delete charactersResourceState.rowErrors[payload.characterId]
  charactersResourceState.revision = maxRevision(charactersResourceState.revision, payload.revision)
  markResourceDatabaseChanged()
  return true
}

export function resetServerResourceState(): void {
  settingsResourceState.value = {}
  settingsResourceState.revision = null
  settingsResourceState.fullRevision = null
  settingsResourceState.enabledModulesRevision = null
  settingsResourceState.groupRevisions = {}
  settingsResourceState.status = 'idle'
  settingsResourceState.error = null

  collectionsResourceState.values = {}
  collectionsResourceState.revision = null
  collectionsResourceState.fullRevision = null
  collectionsResourceState.revisions = {}
  collectionsResourceState.status = 'idle'
  collectionsResourceState.statuses = {}
  collectionsResourceState.error = null
  collectionsResourceState.errors = {}

  charactersResourceState.characters = []
  charactersResourceState.characterOrder = []
  charactersResourceState.currentChar = -1
  charactersResourceState.revision = null
  charactersResourceState.listRevision = null
  charactersResourceState.orderRevision = null
  charactersResourceState.selectionRevision = null
  charactersResourceState.rowRevisions = {}
  charactersResourceState.status = 'idle'
  charactersResourceState.rowStatuses = {}
  charactersResourceState.error = null
  charactersResourceState.rowErrors = {}
  advanceAllCharacterRowProjectionEpochs()
  markResourceDatabaseChanged()
}

export function replaceResourceDatabase(database: Database, revision?: number): void {
  const nextRevision = normalizeOptionalRevision(revision)
  const databaseRecord = cloneJsonValue(database) as unknown as Record<string, unknown>
  const settings: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(databaseRecord)) {
    if (key === 'characters' || isServerCollectionName(key)) continue
    settings[key] = value
  }

  settingsResourceState.value = settings as ServerSettingsValues
  settingsResourceState.revision = nextRevision
  settingsResourceState.fullRevision = nextRevision
  settingsResourceState.enabledModulesRevision = null
  settingsResourceState.groupRevisions = {}
  settingsResourceState.status = 'ready'
  settingsResourceState.error = null

  const collections: Partial<ServerCollectionValues> = {}
  const collectionStatuses: Partial<Record<ServerCollectionName, ServerResourceStatus>> = {}
  const collectionRevisions: Partial<Record<ServerCollectionName, number>> = {}
  for (const name of SERVER_COLLECTION_NAMES) {
    if (!Object.prototype.hasOwnProperty.call(databaseRecord, name)) continue
    collections[name] = databaseRecord[name] as never
    collectionStatuses[name] = 'ready'
    if (nextRevision !== null) collectionRevisions[name] = nextRevision
  }
  collectionsResourceState.values = collections
  collectionsResourceState.revision = nextRevision
  collectionsResourceState.fullRevision = nextRevision
  collectionsResourceState.revisions = collectionRevisions
  collectionsResourceState.status = 'ready'
  collectionsResourceState.statuses = collectionStatuses
  collectionsResourceState.error = null
  collectionsResourceState.errors = {}

  const characters = Array.isArray(databaseRecord.characters)
    ? (databaseRecord.characters as unknown as character[])
    : []
  charactersResourceState.characters = characters
  charactersResourceState.characterOrder = Array.isArray(databaseRecord.characterOrder)
    ? (databaseRecord.characterOrder as Database['characterOrder'])
    : []
  charactersResourceState.currentChar = Number.isInteger(databaseRecord.currentChar)
    ? (databaseRecord.currentChar as number)
    : -1
  charactersResourceState.revision = nextRevision
  charactersResourceState.listRevision = nextRevision
  charactersResourceState.orderRevision = nextRevision
  charactersResourceState.selectionRevision = nextRevision
  charactersResourceState.rowRevisions =
    nextRevision === null
      ? {}
      : Object.fromEntries(
          characters
            .filter((candidate) => nonEmptyString(candidate?.chaId))
            .map((candidate) => [candidate.chaId, nextRevision]),
        )
  charactersResourceState.status = 'ready'
  charactersResourceState.rowStatuses = Object.fromEntries(
    characters.filter((candidate) => nonEmptyString(candidate?.chaId)).map((candidate) => [candidate.chaId, 'ready']),
  )
  charactersResourceState.error = null
  charactersResourceState.rowErrors = {}
  advanceAllCharacterRowProjectionEpochs()
  markResourceDatabaseChanged()
}

export function areServerDatabaseResourcesReady(): boolean {
  return (
    settingsResourceState.status === 'ready' &&
    collectionsResourceState.status === 'ready' &&
    charactersResourceState.status === 'ready'
  )
}

export function composeResourceDatabaseSnapshot(): Database {
  return cloneJsonValue(composeResourceDatabaseRecord()) as unknown as Database
}

export function getResourceDatabase(options: { snapshot?: boolean } = {}): Database {
  // A consumer that only retains the deprecated whole-database facade still
  // tracks resource-backed writes without requiring a new proxy identity.
  void resourceDatabaseFacadeEpoch
  return options.snapshot ? composeResourceDatabaseSnapshot() : resourceDatabaseCompatibilityProxy
}

export function withResourceDatabaseWrite<T>(callback: (database: Database) => T): T {
  const outermost = resourceDatabaseWriteDepth === 0
  if (outermost) resourceDatabaseWriteChanged = false
  resourceDatabaseWriteDepth += 1
  let finished = false
  const finish = () => {
    if (finished) return
    resourceDatabaseWriteDepth -= 1
    if (resourceDatabaseWriteDepth === 0 && resourceDatabaseWriteChanged) {
      resourceDatabaseFacadeEpoch += 1
      resourceDatabaseWriteChanged = false
    }
    finished = true
  }
  try {
    const result = callback(resourceDatabaseCompatibilityProxy)
    if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
      return Promise.resolve(result).finally(finish) as T
    }
    finish()
    return result
  } catch (error) {
    finish()
    throw error
  }
}

export const resourceDatabaseCompatibilityProxy = new Proxy({} as Database, {
  get(_target, property) {
    if (property === Symbol.toStringTag) return 'ResourceDatabase'
    if (property === 'toJSON') return composeResourceDatabaseSnapshot
    if (typeof property !== 'string') return undefined
    return guardResourceDatabaseValue(resourceDatabaseField(property))
  },
  has(_target, property) {
    return typeof property === 'string' && resourceDatabaseKeys().includes(property)
  },
  ownKeys() {
    return resourceDatabaseKeys()
  },
  getOwnPropertyDescriptor(_target, property) {
    if (typeof property !== 'string' || !resourceDatabaseKeys().includes(property)) return undefined
    return {
      configurable: true,
      enumerable: true,
      value: guardResourceDatabaseValue(resourceDatabaseField(property)),
      writable: true,
    }
  },
  set(_target, property, value) {
    assertResourceDatabaseWriteAllowed()
    if (typeof property !== 'string') return false
    setResourceDatabaseField(property, value)
    markResourceDatabaseChanged()
    return true
  },
  deleteProperty(_target, property) {
    assertResourceDatabaseWriteAllowed()
    if (typeof property !== 'string') return false
    deleteResourceDatabaseField(property)
    markResourceDatabaseChanged()
    return true
  },
  defineProperty(_target, property, descriptor) {
    assertResourceDatabaseWriteAllowed()
    if (typeof property !== 'string' || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) return false
    setResourceDatabaseField(property, descriptor.value)
    markResourceDatabaseChanged()
    return true
  },
})

function composeResourceDatabaseRecord(): Record<string, unknown> {
  const record: Record<string, unknown> = {
    ...(settingsResourceState.value as Record<string, unknown>),
    ...(collectionsResourceState.values as Record<string, unknown>),
    characters: charactersResourceState.characters,
  }
  if (shouldUseCharacterPointerResource('characterOrder')) {
    record.characterOrder = charactersResourceState.characterOrder
  }
  if (shouldUseCharacterPointerResource('currentChar')) {
    record.currentChar = charactersResourceState.currentChar
  }
  return record
}

function resourceDatabaseField(property: string): unknown {
  if (property === 'characters') return charactersResourceState.characters
  if (property === 'characterOrder' || property === 'currentChar') {
    if (shouldUseCharacterPointerResource(property)) {
      return property === 'characterOrder'
        ? charactersResourceState.characterOrder
        : charactersResourceState.currentChar
    }
  }
  if (isServerCollectionName(property)) {
    return collectionsResourceState.values[property]
  }
  return (settingsResourceState.value as Record<string, unknown>)[property]
}

function resourceDatabaseKeys(): string[] {
  const keys = new Set<string>([
    ...Object.keys(settingsResourceState.value),
    ...Object.keys(collectionsResourceState.values),
    'characters',
  ])
  if (shouldUseCharacterPointerResource('characterOrder')) keys.add('characterOrder')
  if (shouldUseCharacterPointerResource('currentChar')) keys.add('currentChar')
  return Array.from(keys)
}

function setResourceDatabaseField(property: string, value: unknown): void {
  if (property === 'characters') {
    charactersResourceState.characters = value as character[]
    charactersResourceState.status = 'ready'
    return
  }
  if (isServerCollectionName(property)) {
    collectionsResourceState.values[property] = value as never
    collectionsResourceState.statuses[property] = 'ready'
    return
  }
  ;(settingsResourceState.value as Record<string, unknown>)[property] = value
  settingsResourceState.status = 'ready'
  mirrorCharacterPointerField(property, value)
}

function deleteResourceDatabaseField(property: string): void {
  if (property === 'characters') {
    charactersResourceState.characters = []
    charactersResourceState.rowRevisions = {}
    charactersResourceState.rowStatuses = {}
    charactersResourceState.rowErrors = {}
    return
  }
  if (isServerCollectionName(property)) {
    delete collectionsResourceState.values[property]
    delete collectionsResourceState.revisions[property]
    delete collectionsResourceState.statuses[property]
    delete collectionsResourceState.errors[property]
    return
  }
  delete (settingsResourceState.value as Record<string, unknown>)[property]
  if (property === 'characterOrder') charactersResourceState.characterOrder = []
  if (property === 'currentChar') charactersResourceState.currentChar = -1
}

function mirrorCharacterPointerField(property: string, value: unknown): void {
  if (property === 'characterOrder' && Array.isArray(value)) {
    charactersResourceState.characterOrder = value as Database['characterOrder']
  }
  if (property === 'currentChar' && Number.isInteger(value)) {
    charactersResourceState.currentChar = value as number
  }
}

function guardResourceDatabaseValue<T>(value: T): T {
  if (!value || typeof value !== 'object') return value
  const existing = guardedResourceValueMemo.get(value)
  if (existing) return existing as T

  const guarded = new Proxy(value as object, {
    get(target, property, receiver) {
      return guardResourceDatabaseValue(Reflect.get(target, property, receiver))
    },
    set(target, property, nextValue, receiver) {
      assertResourceDatabaseWriteAllowed()
      const applied = Reflect.set(target, property, nextValue, receiver)
      if (applied) markResourceDatabaseChanged()
      return applied
    },
    deleteProperty(target, property) {
      assertResourceDatabaseWriteAllowed()
      const applied = Reflect.deleteProperty(target, property)
      if (applied) markResourceDatabaseChanged()
      return applied
    },
    defineProperty(target, property, descriptor) {
      assertResourceDatabaseWriteAllowed()
      const applied = Reflect.defineProperty(target, property, descriptor)
      if (applied) markResourceDatabaseChanged()
      return applied
    },
  })
  guardedResourceValueMemo.set(value, guarded)
  return guarded as T
}

function assertResourceDatabaseWriteAllowed(): void {
  if (resourceDatabaseWriteGuardEnabled && resourceDatabaseWriteDepth === 0) {
    throw new TypeError('The resource database compatibility view is read-only outside withResourceDatabaseWrite')
  }
}

function markResourceDatabaseChanged(): void {
  if (resourceDatabaseWriteDepth > 0) {
    resourceDatabaseWriteChanged = true
    return
  }
  resourceDatabaseFacadeEpoch += 1
}

function preserveResidentCharacterChatBodies(incoming: character, existing: character | undefined): character {
  if (!existing) return incoming
  if (Array.isArray(incoming.chats) && Array.isArray(existing.chats)) {
    const existingChatsById = new Map(
      existing.chats.filter((chat) => nonEmptyString(chat?.id)).map((chat) => [chat.id, chat]),
    )
    for (const chat of incoming.chats) {
      if (!nonEmptyString(chat?.id)) continue
      const resident = existingChatsById.get(chat.id)
      if (!resident) continue
      if (Array.isArray(resident.message)) chat.message = resident.message
      if (Object.prototype.hasOwnProperty.call(resident, 'hypaV3Data')) {
        chat.hypaV3Data = resident.hypaV3Data
      }
      if (shouldPreserveLiveChatGenerationSettingsForResource(chat.id, chat.generationSettings)) {
        if (Object.prototype.hasOwnProperty.call(resident, 'generationSettings')) {
          chat.generationSettings = resident.generationSettings
        } else {
          delete chat.generationSettings
        }
      }
    }
  }
  if (incoming.globalLore === undefined && existing.globalLore !== undefined) {
    incoming.globalLore = existing.globalLore
  }
  return incoming
}

function shouldUseCharacterPointerResource(property: 'characterOrder' | 'currentChar'): boolean {
  const targetedRevision =
    property === 'characterOrder' ? charactersResourceState.orderRevision : charactersResourceState.selectionRevision
  const pointerRevision = Math.max(charactersResourceState.listRevision ?? -1, targetedRevision ?? -1)
  if (pointerRevision < 0) return false
  return settingsResourceState.fullRevision === null || pointerRevision >= settingsResourceState.fullRevision
}

function isNormalizedModuleCollectionProjection(value: unknown): boolean {
  if (!Array.isArray(value)) return false
  const ids = new Set<string>()
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false
    const record = candidate as Record<string, unknown>
    const moduleId = record.id
    if (!nonEmptyString(moduleId) || ids.has(moduleId)) return false
    if (!nonEmptyString(record.name) || typeof record.description !== 'string') return false
    ids.add(moduleId)
  }
  return true
}

function isNormalizedCharacterCollectionProjection(): boolean {
  const characters = charactersResourceState.characters
  const characterOrder = charactersResourceState.characterOrder
  const currentChar = charactersResourceState.currentChar
  if (!Array.isArray(characters) || !Array.isArray(characterOrder) || !Number.isInteger(currentChar)) return false
  if (characters.length === 0 ? currentChar !== -1 : currentChar < -1 || currentChar >= characters.length) return false

  const characterIds = new Set<string>()
  const activeIds = new Set<string>()
  for (const candidate of characters) {
    const characterId = candidate?.chaId
    if (!nonEmptyString(characterId) || characterIds.has(characterId)) return false
    characterIds.add(characterId)
    if (characterId !== '§temp' && !candidate.trashTime) activeIds.add(characterId)
  }

  const seenCharacterIds = new Set<string>()
  const seenFolderIds = new Set<string>()
  for (const entry of characterOrder) {
    if (typeof entry === 'string') {
      if (!activeIds.has(entry) || seenCharacterIds.has(entry)) return false
      seenCharacterIds.add(entry)
      continue
    }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false
    if (!nonEmptyString(entry.id) || seenFolderIds.has(entry.id)) return false
    if (typeof entry.name !== 'string' || typeof entry.color !== 'string' || !Array.isArray(entry.data)) return false
    if (entry.data.length === 0) return false
    if (entry.imgFile !== undefined && entry.imgFile !== null && typeof entry.imgFile !== 'string') return false
    if (entry.img !== undefined && typeof entry.img !== 'string') return false
    seenFolderIds.add(entry.id)
    for (const characterId of entry.data) {
      if (!activeIds.has(characterId) || seenCharacterIds.has(characterId)) return false
      seenCharacterIds.add(characterId)
    }
  }
  return seenCharacterIds.size === activeIds.size
}

function isOlderRevision(revision: number, current: number | null): boolean {
  return current !== null && revision < current
}

function maxRevision(current: number | null, next: number): number {
  return current === null ? next : Math.max(current, next)
}

function normalizeOptionalRevision(revision: number | undefined): number | null {
  if (revision === undefined) return null
  if (!Number.isInteger(revision) || revision < 0) {
    throw new TypeError('Resource database revision must be a non-negative integer')
  }
  return revision
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function cloneJsonValue<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}

function isUniqueStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => nonEmptyString(entry)) && new Set(value).size === value.length
}

function isJsonValueEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}
