import type { Database, character } from '../storage/database.svelte'
import type { ChatGenerationSettings } from '../chatGenerationSettings'
import { normalizeAgentPresets, validateAgentPresetRecord } from '../agentPresetRecords'
import { changeLanguage } from '../../lang'
import { shouldPreserveLiveChatGenerationSettingsForResource } from './chatGenerationSettingsResourceGuard'
import { isCanonicalLoadoutCollection } from './loadoutCanonical'
import { isModelProfileSettingsGroup, type SettingsGroup } from './settingsGroups'
import type { PromptItemMutationOperation, PromptTemplateOwnerStateSnapshot } from './commands'

let nextCharacterRowProjectionEpoch = 0
let characterRowProjectionBaseline = 0
const characterRowProjectionEpochs = new Map<string, number>()
const chatBodyResourceRevisions = new Map<string, number>()
let nextChatBodyProjectionEpoch = 0
let chatBodyProjectionBaseline = 0
const chatBodyProjectionEpochs = new Map<string, number>()
const characterLorebookBodyResourceRevisions = new Map<string, number>()
let nextCharacterLorebookBodyProjectionEpoch = 0
let characterLorebookBodyProjectionBaseline = 0
const characterLorebookBodyProjectionEpochs = new Map<string, number>()
let nextCharacterLorebookProjectionEpoch = 0
let characterLorebookProjectionBaseline = 0
const characterLorebookProjectionEpochs = new Map<string, number>()
let nextCollectionProjectionEpoch = 0
let collectionProjectionBaseline = 0
const collectionProjectionEpochs = new Map<ServerCollectionName, number>()
const collectionAcknowledgementTaints = new Set<ServerCollectionName>()
let lorebookPageProjectionEpoch = 0
let settingsProjectionEpoch = 0
let settingsAcknowledgementTainted = false
let nextSettingsProjectionEpoch = 0
let settingsProjectionBaseline = 0
const settingsGroupProjectionEpochs = new Map<SettingsGroup, number>()
const settingsGroupAcknowledgementTaints = new Set<SettingsGroup>()

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

/** Whether a newer authoritative transcript body has already been applied. */
export function hasNewerChatBodyResourceRevision(chatId: string, revision: number): boolean {
  return (chatBodyResourceRevisions.get(chatId) ?? -1) > revision
}

/** Record an authoritative transcript-body apply without claiming the parent character row. */
export function markChatBodyResourceRevision(chatId: string, revision: number): void {
  if (!nonEmptyString(chatId) || !Number.isInteger(revision) || revision < 0) return
  chatBodyResourceRevisions.set(chatId, Math.max(chatBodyResourceRevisions.get(chatId) ?? -1, revision))
}

function advanceChatBodyProjectionEpoch(chatId: string): void {
  chatBodyProjectionEpochs.set(chatId, ++nextChatBodyProjectionEpoch)
}

function advanceAllChatBodyProjectionEpochs(): void {
  chatBodyProjectionBaseline = ++nextChatBodyProjectionEpoch
  chatBodyProjectionEpochs.clear()
}

export function captureChatBodyProjectionEpoch(chatId: string): number {
  return chatBodyProjectionEpochs.get(chatId) ?? chatBodyProjectionBaseline
}

export function hasChatBodyProjectionEpochChanged(chatId: string, epoch: number): boolean {
  return captureChatBodyProjectionEpoch(chatId) !== epoch
}

/** Record a transcript-body apply or accepted local mutation. */
export function markChatBodyProjectionApplied(chatId: string): void {
  if (nonEmptyString(chatId)) advanceChatBodyProjectionEpoch(chatId)
}

/** Whether a newer authoritative character-lorebook body has already been applied. */
export function hasNewerCharacterLorebookBodyResourceRevision(characterId: string, revision: number): boolean {
  return (characterLorebookBodyResourceRevisions.get(characterId) ?? -1) > revision
}

/** Record an authoritative lorebook-body apply without claiming the parent character row. */
export function markCharacterLorebookBodyResourceRevision(characterId: string, revision: number): void {
  if (!nonEmptyString(characterId) || !Number.isInteger(revision) || revision < 0) return
  characterLorebookBodyResourceRevisions.set(
    characterId,
    Math.max(characterLorebookBodyResourceRevisions.get(characterId) ?? -1, revision),
  )
}

function advanceCharacterLorebookBodyProjectionEpoch(characterId: string): void {
  characterLorebookBodyProjectionEpochs.set(characterId, ++nextCharacterLorebookBodyProjectionEpoch)
}

function advanceAllCharacterLorebookBodyProjectionEpochs(): void {
  characterLorebookBodyProjectionBaseline = ++nextCharacterLorebookBodyProjectionEpoch
  characterLorebookBodyProjectionEpochs.clear()
}

export function captureCharacterLorebookBodyProjectionEpoch(characterId: string): number {
  return characterLorebookBodyProjectionEpochs.get(characterId) ?? characterLorebookBodyProjectionBaseline
}

export function hasCharacterLorebookBodyProjectionEpochChanged(characterId: string, epoch: number): boolean {
  return captureCharacterLorebookBodyProjectionEpoch(characterId) !== epoch
}

function resetCharacterBodyResourceRevisions(): void {
  chatBodyResourceRevisions.clear()
  characterLorebookBodyResourceRevisions.clear()
}

function pruneCharacterBodyResourceRevisions(characters: readonly character[]): void {
  const characterIds = new Set<string>()
  const chatIds = new Set<string>()
  for (const candidate of characters) {
    if (nonEmptyString(candidate?.chaId)) characterIds.add(candidate.chaId)
    for (const chat of candidate?.chats ?? []) {
      if (nonEmptyString(chat?.id)) chatIds.add(chat.id)
    }
  }
  for (const chatId of chatBodyResourceRevisions.keys()) {
    if (!chatIds.has(chatId)) chatBodyResourceRevisions.delete(chatId)
  }
  for (const characterId of characterLorebookBodyResourceRevisions.keys()) {
    if (!characterIds.has(characterId)) characterLorebookBodyResourceRevisions.delete(characterId)
  }
}

function markRemovedCharacterBodyProjections(
  previousCharacters: readonly character[],
  nextCharacters: readonly character[],
): void {
  const nextCharacterIds = new Set(
    nextCharacters.filter((candidate) => nonEmptyString(candidate?.chaId)).map((candidate) => candidate.chaId),
  )
  const nextChatIds = new Set(
    nextCharacters.flatMap((candidate) =>
      (candidate?.chats ?? []).filter((chat) => nonEmptyString(chat?.id)).map((chat) => chat.id),
    ),
  )
  for (const character of previousCharacters) {
    if (nonEmptyString(character?.chaId) && !nextCharacterIds.has(character.chaId)) {
      markCharacterLorebookProjectionApplied(character.chaId)
    }
    for (const chat of character?.chats ?? []) {
      if (nonEmptyString(chat?.id) && !nextChatIds.has(chat.id)) markChatBodyProjectionApplied(chat.id)
    }
  }
}

function advanceCharacterLorebookProjectionEpoch(characterId: string): void {
  characterLorebookProjectionEpochs.set(characterId, ++nextCharacterLorebookProjectionEpoch)
}

function advanceAllCharacterLorebookProjectionEpochs(): void {
  characterLorebookProjectionBaseline = ++nextCharacterLorebookProjectionEpoch
  characterLorebookProjectionEpochs.clear()
}

export function captureCharacterLorebookProjectionEpoch(characterId: string): number {
  return characterLorebookProjectionEpochs.get(characterId) ?? characterLorebookProjectionBaseline
}

export function hasCharacterLorebookProjectionEpochChanged(characterId: string, epoch: number): boolean {
  return captureCharacterLorebookProjectionEpoch(characterId) !== epoch
}

/** Record a successful authoritative character-lorebook-only projection apply. */
export function markCharacterLorebookProjectionApplied(characterId: string): void {
  if (!nonEmptyString(characterId)) return
  advanceCharacterLorebookProjectionEpoch(characterId)
  advanceCharacterLorebookBodyProjectionEpoch(characterId)
}

function advanceCollectionProjectionEpoch(name: ServerCollectionName): void {
  collectionProjectionEpochs.set(name, ++nextCollectionProjectionEpoch)
  collectionAcknowledgementTaints.delete(name)
}

function advanceAllCollectionProjectionEpochs(): void {
  collectionProjectionBaseline = ++nextCollectionProjectionEpoch
  collectionProjectionEpochs.clear()
  collectionAcknowledgementTaints.clear()
}

export function captureCollectionProjectionEpoch(name: ServerCollectionName): number {
  return collectionProjectionEpochs.get(name) ?? collectionProjectionBaseline
}

export function hasCollectionProjectionEpochChanged(name: ServerCollectionName, epoch: number): boolean {
  return captureCollectionProjectionEpoch(name) !== epoch
}

export function isCollectionAcknowledgementTainted(name: ServerCollectionName): boolean {
  return collectionAcknowledgementTaints.has(name)
}

export function markCollectionAcknowledgementTainted(name: ServerCollectionName): void {
  collectionAcknowledgementTaints.add(name)
}

export function captureSettingsProjectionEpoch(): number {
  return settingsProjectionEpoch
}

export function hasSettingsProjectionEpochChanged(epoch: number): boolean {
  return captureSettingsProjectionEpoch() !== epoch
}

export function isSettingsAcknowledgementTainted(): boolean {
  return settingsAcknowledgementTainted
}

export function markSettingsAcknowledgementTainted(): void {
  settingsAcknowledgementTainted = true
}

function advanceSettingsProjectionEpoch(options: { authoritativeFull?: boolean } = {}): void {
  settingsProjectionEpoch += 1
  if (options.authoritativeFull) settingsAcknowledgementTainted = false
}

function advanceLorebookPageProjectionEpoch(): void {
  lorebookPageProjectionEpoch += 1
}

export function captureLorebookPageProjectionEpoch(): number {
  return lorebookPageProjectionEpoch
}

export function hasLorebookPageProjectionEpochChanged(epoch: number): boolean {
  return captureLorebookPageProjectionEpoch() !== epoch
}

function advanceSettingsGroupProjectionEpoch(group: SettingsGroup): void {
  settingsGroupProjectionEpochs.set(group, ++nextSettingsProjectionEpoch)
  settingsGroupAcknowledgementTaints.delete(group)
}

function advanceAllSettingsProjectionEpochs(): void {
  settingsProjectionBaseline = ++nextSettingsProjectionEpoch
  settingsGroupProjectionEpochs.clear()
  settingsGroupAcknowledgementTaints.clear()
}

export function captureSettingsGroupProjectionEpoch(group: SettingsGroup): number {
  return settingsGroupProjectionEpochs.get(group) ?? settingsProjectionBaseline
}

export function hasSettingsGroupProjectionEpochChanged(group: SettingsGroup, epoch: number): boolean {
  return captureSettingsGroupProjectionEpoch(group) !== epoch
}

export function isSettingsGroupAcknowledgementTainted(group: SettingsGroup): boolean {
  return settingsGroupAcknowledgementTaints.has(group)
}

export function markSettingsGroupAcknowledgementTainted(group: SettingsGroup): void {
  settingsGroupAcknowledgementTaints.add(group)
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

export type ServerLegacyPresetResourceBaseline = ReadonlyMap<string, Record<string, unknown>>

export interface ServerLegacyPresetRowResourcePayload {
  revision: number
  presetId: string
  preset: Record<string, unknown>
  baseline?: ServerLegacyPresetResourceBaseline
}

export interface ServerLegacyPresetCollectionResourcePayload {
  revision: number
  shells: readonly unknown[]
  presetRows: readonly Record<string, unknown>[]
  baseline?: ServerLegacyPresetResourceBaseline
}

export type ServerJsonFieldState = { present: false } | { present: true; value: unknown }

export interface ServerLegacyPresetPatchLocalEffectPayload {
  revision: number
  presetId: string
  fields: Record<
    string,
    {
      attempted: ServerJsonFieldState
      canonical: ServerJsonFieldState
    }
  >
}

export interface ServerPersonaPatchLocalEffectPayload {
  revision: number
  personaId: string
  attemptedPatch: Record<string, unknown>
  attemptedPersona: Record<string, unknown>
  attemptedLegacyProfile: {
    username: string
    userIcon: string
    personaPrompt: string
    userNote: string
  }
  legacyProfileProjectionApplied: boolean
}

export interface ServerPersonaMutationLocalEffectPayload {
  revision: number
  operation: 'create' | 'delete' | 'select' | 'reorder'
  collectionWritten: boolean
  settingsWritten: boolean
}

export interface ServerTranslatorPresetPatchLocalEffectPayload {
  revision: number
  presetId: string
  attemptedPatch: Record<string, unknown>
  attemptedPreset: Record<string, unknown>
  selectedPresetId: string
}

export interface ServerAgentPresetPatchLocalEffectPayload {
  revision: number
  presetId: string
  fields: Record<
    string,
    {
      attempted: ServerJsonFieldState
      canonical: ServerJsonFieldState
    }
  >
  updatedAt: number
}

export interface ServerAgentPresetStepPatchLocalEffectPayload extends ServerAgentPresetPatchLocalEffectPayload {
  stepId: string
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

export interface ServerPromptItemMutationLocalEffectPayload {
  revision: number
  operation: PromptItemMutationOperation
  promptPresetId: string | null
  itemId?: string
  itemIds?: readonly string[]
  enabled?: boolean
  ownerState: PromptTemplateOwnerStateSnapshot
}

export interface ServerSplitPresetPatchLocalEffectPayload {
  revision: number
  presetKind: 'model' | 'prompt'
  presetId: string
  attemptedPatch: Record<string, unknown>
  preset: Record<string, unknown>
  attemptedSettings: Record<string, unknown>
  settings: Record<string, unknown>
  selectedProjectionApplied: boolean
  ownerProjectionApplied: boolean
}

export interface ServerLoadoutMutationLocalEffectPayload {
  revision: number
  operation: 'create' | 'delete' | 'favorite' | 'touch'
  loadoutId: string
}

export interface ServerLorebookMutationLocalEffectPayload {
  revision: number
  scope: 'global' | 'character' | 'chat'
  operation: 'replace' | 'upsert' | 'delete' | 'reorder'
  lorebookId?: string
  characterId?: string
  chatId?: string
}

export interface ServerGlobalLorebookMutationLocalEffectPayload {
  revision: number
  operation: 'create' | 'update' | 'delete' | 'reorder' | 'select'
  lorebookId?: string
  lorebookIds?: readonly string[]
  selectedLorebookId?: string | null
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
  loreBookPageRevision: number | null
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
  loreBookPageRevision: null,
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
  const preserveLoreBookPage = (settingsResourceState.loreBookPageRevision ?? -1) > payload.revision
  const liveSettings = settingsResourceState.value as Record<string, unknown>
  const hasLiveLoreBookPage = Object.prototype.hasOwnProperty.call(liveSettings, 'loreBookPage')
  const liveLoreBookPage = preserveLoreBookPage ? cloneJsonValue(liveSettings.loreBookPage) : undefined
  settingsResourceState.value = cloneJsonValue(payload.settings)
  if (preserveEnabledModules) {
    ;(settingsResourceState.value as Record<string, unknown>).enabledModules = liveEnabledModules
  }
  if (preserveLoreBookPage) {
    if (hasLiveLoreBookPage) {
      ;(settingsResourceState.value as Record<string, unknown>).loreBookPage = liveLoreBookPage
    } else {
      delete (settingsResourceState.value as Record<string, unknown>).loreBookPage
    }
  }
  settingsResourceState.revision =
    preserveEnabledModules || preserveLoreBookPage
      ? maxRevision(settingsResourceState.revision, payload.revision)
      : payload.revision
  settingsResourceState.fullRevision = payload.revision
  settingsResourceState.enabledModulesRevision = preserveEnabledModules
    ? settingsResourceState.enabledModulesRevision
    : null
  settingsResourceState.loreBookPageRevision = preserveLoreBookPage ? settingsResourceState.loreBookPageRevision : null
  settingsResourceState.groupRevisions = {}
  settingsResourceState.status = 'ready'
  settingsResourceState.error = null
  applyRuntimeLanguage(settingsResourceState.value.language)
  advanceAllSettingsProjectionEpochs()
  advanceSettingsProjectionEpoch({ authoritativeFull: true })
  if (!preserveLoreBookPage) advanceLorebookPageProjectionEpoch()
  markResourceDatabaseChanged()
  return true
}

export function applySettingsGroupResource(
  payload: ServerSettingsGroupResourcePayload,
  groupKeys: readonly string[],
): boolean {
  const sharedModelProfileRevision = isModelProfileSettingsGroup(payload.group)
    ? Math.max(settingsResourceState.groupRevisions.providers ?? -1, settingsResourceState.groupRevisions.models ?? -1)
    : -1
  const currentRevision = Math.max(
    settingsResourceState.fullRevision ?? -1,
    settingsResourceState.groupRevisions[payload.group] ?? -1,
    sharedModelProfileRevision,
    payload.group === 'modules' ? (settingsResourceState.enabledModulesRevision ?? -1) : -1,
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
  if (payload.group === 'providers') settingsResourceState.groupRevisions.models = payload.revision
  if (payload.group === 'modules') settingsResourceState.enabledModulesRevision = payload.revision
  settingsResourceState.revision = maxRevision(settingsResourceState.revision, payload.revision)
  settingsResourceState.status = 'ready'
  settingsResourceState.error = null
  if (groupKeys.includes('language')) applyRuntimeLanguage(target.language)
  advanceSettingsGroupProjectionEpoch(payload.group)
  if (payload.group === 'providers') advanceSettingsGroupProjectionEpoch('models')
  advanceSettingsProjectionEpoch()
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
  if (attemptedKeys.includes('language')) applyRuntimeLanguage(settingsTarget.language)

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

/**
 * Fence response-confirmed optimistic top-level lorebook mutations. The list
 * and its selected-page pointer are separate server resources, so each slice
 * advances independently while retaining any newer queued optimistic value.
 */
export function applyGlobalLorebookMutationLocalEffect(
  payload: ServerGlobalLorebookMutationLocalEffectPayload,
): boolean {
  if (!isGlobalLorebookMutationOperation(payload.operation)) return false

  const changesCollection = payload.operation !== 'select'
  const changesPage =
    payload.operation === 'delete' || payload.operation === 'reorder' || payload.operation === 'select'
  if (payload.operation === 'reorder') {
    if (!isUniqueStringArray(payload.lorebookIds) || !isNullableNonEmptyString(payload.selectedLorebookId)) {
      return false
    }
    if (payload.selectedLorebookId !== null && !payload.lorebookIds.includes(payload.selectedLorebookId)) return false
  } else if (!nonEmptyString(payload.lorebookId)) {
    return false
  }
  if (payload.operation === 'select' && payload.selectedLorebookId !== payload.lorebookId) return false

  const knownCollectionRevision = Math.max(
    collectionsResourceState.fullRevision ?? -1,
    collectionsResourceState.revisions.loreBook ?? -1,
  )
  const knownPageRevision = Math.max(
    settingsResourceState.fullRevision ?? -1,
    settingsResourceState.loreBookPageRevision ?? -1,
  )
  const shouldFenceCollection = changesCollection && knownCollectionRevision < payload.revision
  const shouldFencePage = changesPage && knownPageRevision < payload.revision
  if (!shouldFenceCollection && !shouldFencePage) return true

  if (
    shouldFenceCollection &&
    (collectionsResourceState.statuses.loreBook !== 'ready' ||
      !isCanonicalGlobalLorebookCollectionProjection(collectionsResourceState.values.loreBook))
  ) {
    return false
  }
  if (shouldFencePage && !isStableGlobalLorebookPageProjection()) return false

  if (shouldFenceCollection) {
    collectionsResourceState.revisions.loreBook = payload.revision
    collectionsResourceState.revision = maxRevision(collectionsResourceState.revision, payload.revision)
    collectionsResourceState.statuses.loreBook = 'ready'
    delete collectionsResourceState.errors.loreBook
  }
  if (shouldFencePage) {
    settingsResourceState.loreBookPageRevision = payload.revision
    settingsResourceState.revision = maxRevision(settingsResourceState.revision, payload.revision)
    settingsResourceState.status = 'ready'
    settingsResourceState.error = null
  }
  markResourceDatabaseChanged()
  return true
}

/**
 * Fence an accepted optimistic lorebook-entry mutation. The bridge already
 * contains the accepted collection (and may contain a newer queued edit), so
 * only advance the owning resource revision after validating the live target.
 */
export function applyLorebookMutationLocalEffect(payload: ServerLorebookMutationLocalEffectPayload): boolean {
  if (!isLorebookMutationOperation(payload.operation)) return false

  if (payload.scope === 'global') {
    const knownRevision = Math.max(
      collectionsResourceState.fullRevision ?? -1,
      collectionsResourceState.revisions.loreBook ?? -1,
    )
    if (knownRevision >= payload.revision) return true
    if (
      collectionsResourceState.statuses.loreBook !== 'ready' ||
      !nonEmptyString(payload.lorebookId) ||
      !isCanonicalGlobalLorebookTarget(payload.lorebookId)
    ) {
      return false
    }

    collectionsResourceState.revisions.loreBook = payload.revision
    collectionsResourceState.revision = maxRevision(collectionsResourceState.revision, payload.revision)
    collectionsResourceState.statuses.loreBook = 'ready'
    delete collectionsResourceState.errors.loreBook
    markResourceDatabaseChanged()
    return true
  }

  if (!nonEmptyString(payload.characterId)) return false
  const knownRevision = Math.max(
    charactersResourceState.listRevision ?? -1,
    charactersResourceState.rowRevisions[payload.characterId] ?? -1,
  )
  if (knownRevision >= payload.revision) return true
  if (charactersResourceState.rowStatuses[payload.characterId] !== 'ready') return false

  const targetIsCanonical =
    payload.scope === 'character'
      ? payload.chatId === undefined && isCanonicalCharacterLorebookTarget(payload.characterId)
      : nonEmptyString(payload.chatId) && isCanonicalChatLorebookTarget(payload.characterId, payload.chatId)
  if (!targetIsCanonical) return false

  charactersResourceState.rowRevisions[payload.characterId] = payload.revision
  charactersResourceState.rowStatuses[payload.characterId] = 'ready'
  delete charactersResourceState.rowErrors[payload.characterId]
  charactersResourceState.revision = maxRevision(charactersResourceState.revision, payload.revision)
  if (payload.scope === 'character') {
    markCharacterLorebookBodyResourceRevision(payload.characterId, payload.revision)
    markCharacterLorebookProjectionApplied(payload.characterId)
  }
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

/**
 * Fence an accepted optimistic prompt-owner mutation without replacing its
 * resident body. Each write only validates its canonical structural outcome;
 * unrelated row fields may already contain later accepted optimistic edits.
 * Every ambiguous command failure taints the owner before a later response can
 * take this path.
 */
export function applyPromptItemMutationLocalEffect(payload: ServerPromptItemMutationLocalEffectPayload): boolean {
  if (
    (payload.promptPresetId !== null && !nonEmptyString(payload.promptPresetId)) ||
    !isPromptItemMutationOperation(payload.operation) ||
    !isCanonicalPromptTemplateOwnerState(payload.ownerState) ||
    !promptItemMutationMatchesOwnerState(payload)
  ) {
    return false
  }

  const collectionName: ServerCollectionName = payload.promptPresetId === null ? 'promptTemplate' : 'promptPresets'
  const liveOwnerState = readCanonicalLivePromptTemplateOwnerState(payload.promptPresetId)
  if (!liveOwnerState || !livePromptTemplateOwnerSupportsOperation(payload, liveOwnerState)) return false
  if (
    collectionsResourceState.status !== 'ready' ||
    (payload.ownerState.enabled && collectionsResourceState.statuses[collectionName] !== 'ready') ||
    (payload.promptPresetId !== null && collectionsResourceState.statuses.promptPresets !== 'ready')
  ) {
    return false
  }

  const knownRevision = Math.max(
    collectionsResourceState.fullRevision ?? -1,
    collectionsResourceState.revisions[collectionName] ?? -1,
  )
  if (knownRevision >= payload.revision) return true

  collectionsResourceState.revisions[collectionName] = payload.revision
  collectionsResourceState.revision = maxRevision(collectionsResourceState.revision, payload.revision)
  collectionsResourceState.statuses[collectionName] = 'ready'
  delete collectionsResourceState.errors[collectionName]
  markResourceDatabaseChanged()
  return true
}

/**
 * Apply a response-confirmed split-preset field PATCH without re-reading the
 * complete collection and, when selected fields were projected, settings.
 * Canonical values only replace this attempt while its exact optimistic value
 * is still live, preserving a later coalesced edit to the same field.
 */
export function applySplitPresetPatchLocalEffect(payload: ServerSplitPresetPatchLocalEffectPayload): boolean {
  if (!nonEmptyString(payload.presetId) || (payload.presetKind !== 'model' && payload.presetKind !== 'prompt')) {
    return false
  }
  const attemptedKeys = Object.keys(payload.attemptedPatch).sort()
  if (
    attemptedKeys.length === 0 ||
    !isJsonValueEqual(attemptedKeys, Object.keys(payload.preset).sort()) ||
    !isJsonValueEqual(Object.keys(payload.attemptedSettings).sort(), Object.keys(payload.settings).sort())
  ) {
    return false
  }

  const collectionName: ServerCollectionName = payload.presetKind === 'model' ? 'modelPresets' : 'promptPresets'
  const presets = collectionsResourceState.values[collectionName]
  if (!Array.isArray(presets) || collectionsResourceState.statuses[collectionName] !== 'ready') return false
  const matches = presets.filter(
    (candidate) => isPlainRecord(candidate) && candidate.id === payload.presetId,
  ) as Record<string, unknown>[]
  if (matches.length !== 1 || !isUniquePresetCollection(presets)) return false
  if (collectionsResourceState.revisions[collectionName] === undefined) return false

  if (payload.selectedProjectionApplied) {
    if (settingsResourceState.status !== 'ready' || settingsResourceState.fullRevision === null) return false
  } else if (Object.keys(payload.attemptedSettings).length > 0) {
    return false
  }

  if (payload.ownerProjectionApplied) {
    if (
      payload.presetKind !== 'prompt' ||
      !Object.prototype.hasOwnProperty.call(payload.attemptedPatch, 'promptTemplate') ||
      !Object.prototype.hasOwnProperty.call(payload.preset, 'promptTemplate') ||
      collectionsResourceState.statuses.promptTemplate !== 'ready' ||
      collectionsResourceState.revisions.promptTemplate === undefined
    ) {
      return false
    }
    if (isJsonValueEqual(collectionsResourceState.values.promptTemplate, payload.attemptedPatch.promptTemplate)) {
      collectionsResourceState.values.promptTemplate = cloneJsonValue(payload.preset.promptTemplate) as never
    }
    collectionsResourceState.revisions.promptTemplate = payload.revision
    collectionsResourceState.statuses.promptTemplate = 'ready'
    delete collectionsResourceState.errors.promptTemplate
  }

  const preset = matches[0]
  for (const key of attemptedKeys) {
    if (isJsonValueEqual(preset[key], payload.attemptedPatch[key])) {
      preset[key] = cloneJsonValue(payload.preset[key])
    }
  }

  if (payload.selectedProjectionApplied) {
    const settings = settingsResourceState.value as Record<string, unknown>
    for (const key of Object.keys(payload.attemptedSettings)) {
      if (isJsonValueEqual(settings[key], payload.attemptedSettings[key])) {
        settings[key] = cloneJsonValue(payload.settings[key])
      }
    }
    settingsResourceState.fullRevision = payload.revision
    settingsResourceState.revision = maxRevision(settingsResourceState.revision, payload.revision)
    settingsResourceState.status = 'ready'
    settingsResourceState.error = null
  }

  collectionsResourceState.revisions[collectionName] = payload.revision
  collectionsResourceState.revision = maxRevision(collectionsResourceState.revision, payload.revision)
  collectionsResourceState.statuses[collectionName] = 'ready'
  delete collectionsResourceState.errors[collectionName]
  markResourceDatabaseChanged()
  return true
}

/** Fence an accepted optimistic loadout mutation without re-reading the collection or settings. */
export function applyLoadoutMutationLocalEffect(payload: ServerLoadoutMutationLocalEffectPayload): boolean {
  if (!nonEmptyString(payload.loadoutId)) return false
  if (!['create', 'delete', 'favorite', 'touch'].includes(payload.operation)) return false

  const loadouts = collectionsResourceState.values.loadouts
  if (collectionsResourceState.statuses.loadouts !== 'ready' || !isCanonicalLoadoutCollection(loadouts)) {
    return false
  }
  if (
    payload.operation === 'touch' &&
    (settingsResourceState.status !== 'ready' ||
      typeof (settingsResourceState.value as Record<string, unknown>).lastLoadedLoadoutName !== 'string')
  ) {
    return false
  }

  const knownCollectionRevision = Math.max(
    collectionsResourceState.fullRevision ?? -1,
    collectionsResourceState.revisions.loadouts ?? -1,
  )
  const knownSettingsRevision = Math.max(
    settingsResourceState.fullRevision ?? -1,
    settingsResourceState.groupRevisions.sidebar ?? -1,
  )
  let changed = false
  if (knownCollectionRevision < payload.revision) {
    collectionsResourceState.revisions.loadouts = payload.revision
    collectionsResourceState.revision = maxRevision(collectionsResourceState.revision, payload.revision)
    collectionsResourceState.statuses.loadouts = 'ready'
    delete collectionsResourceState.errors.loadouts
    changed = true
  }
  if (payload.operation === 'touch' && knownSettingsRevision < payload.revision) {
    settingsResourceState.groupRevisions.sidebar = payload.revision
    settingsResourceState.revision = maxRevision(settingsResourceState.revision, payload.revision)
    settingsResourceState.status = 'ready'
    settingsResourceState.error = null
    changed = true
  }
  if (changed) markResourceDatabaseChanged()
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
    advanceCollectionProjectionEpoch(name)
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

/**
 * Snapshot the resident legacy-preset rows that a targeted read may replace.
 * Fields edited while the read is in flight are retained when its response is
 * reconciled, instead of being rewound to the request-time server value.
 */
export function captureLegacyPresetResourceBaseline(
  presetIds: readonly (string | undefined)[],
): ServerLegacyPresetResourceBaseline {
  const requestedIds = new Set(presetIds.filter(nonEmptyString))
  const baseline = new Map<string, Record<string, unknown>>()
  const presets = collectionsResourceState.values.botPresets
  if (!Array.isArray(presets)) return baseline

  for (const candidate of presets) {
    if (!isPlainRecord(candidate) || !nonEmptyString(candidate.id) || !requestedIds.has(candidate.id)) continue
    baseline.set(candidate.id, cloneJsonValue(candidate))
  }
  return baseline
}

/** Apply one authoritative hydrated legacy-preset row by stable id. */
export function applyLegacyPresetRowResource(payload: ServerLegacyPresetRowResourcePayload): boolean {
  const currentRevision = collectionsResourceState.revisions.botPresets ?? null
  if (isOlderRevision(payload.revision, currentRevision)) return false
  if (!nonEmptyString(payload.presetId) || payload.preset.id !== payload.presetId) return false

  const presets = collectionsResourceState.values.botPresets
  if (!Array.isArray(presets)) return false
  const currentById = uniqueLegacyPresetRowsById(presets)
  if (!currentById) return false
  const current = currentById.get(payload.presetId)
  if (!current) return false

  const next = overlayConcurrentLegacyPresetFields(payload.preset, current, payload.baseline?.get(payload.presetId))
  collectionsResourceState.values.botPresets = presets.map((candidate) =>
    isPlainRecord(candidate) && candidate.id === payload.presetId ? next : candidate,
  ) as never
  markLegacyPresetCollectionApplied(payload.revision)
  return true
}

/**
 * Apply only response-confirmed canonical legacy-preset fields while fencing
 * the accepted row revision. This acknowledgement deliberately does not
 * advance the collection projection epoch or clear its taint; only an
 * authoritative collection/row projection can do that.
 */
export function applyLegacyPresetPatchLocalEffect(payload: ServerLegacyPresetPatchLocalEffectPayload): boolean {
  if (
    !Number.isInteger(payload.revision) ||
    payload.revision < 0 ||
    !nonEmptyString(payload.presetId) ||
    !isPlainRecord(payload.fields)
  ) {
    return false
  }
  for (const [key, field] of Object.entries(payload.fields)) {
    if (
      !nonEmptyString(key) ||
      key === 'id' ||
      !isPlainRecord(field) ||
      !isCanonicalJsonFieldState(field.attempted) ||
      !isCanonicalJsonFieldState(field.canonical)
    ) {
      return false
    }
  }

  const knownRevision = Math.max(
    collectionsResourceState.fullRevision ?? -1,
    collectionsResourceState.revisions.botPresets ?? -1,
  )
  if (knownRevision >= payload.revision) return true
  if (
    collectionsResourceState.statuses.botPresets !== 'ready' ||
    collectionsResourceState.revisions.botPresets === undefined
  ) {
    return false
  }

  const presets = collectionsResourceState.values.botPresets
  if (!Array.isArray(presets) || !isUniquePresetCollection(presets)) return false
  const matches = presets.filter((candidate) => isPlainRecord(candidate) && candidate.id === payload.presetId)
  if (matches.length !== 1) return false
  const preset = matches[0] as unknown as Record<string, unknown>

  for (const [key, field] of Object.entries(payload.fields)) {
    if (!jsonFieldStateMatches(preset, key, field.attempted)) continue
    if (field.canonical.present) preset[key] = cloneJsonValue(field.canonical.value)
    else delete preset[key]
  }

  collectionsResourceState.revisions.botPresets = payload.revision
  collectionsResourceState.revision = maxRevision(collectionsResourceState.revision, payload.revision)
  collectionsResourceState.statuses.botPresets = 'ready'
  delete collectionsResourceState.errors.botPresets
  markResourceDatabaseChanged()
  return true
}

/**
 * Fence a response-confirmed persona PATCH without re-reading the complete
 * persona collection or settings row. The optimistic row and legacy mirror
 * are already resident; advancing only their revision fences preserves any
 * later local edits. Authoritative reads alone advance projection epochs and
 * clear acknowledgement taints.
 */
export function applyPersonaPatchLocalEffect(payload: ServerPersonaPatchLocalEffectPayload): boolean {
  const legacyKeys = ['username', 'userIcon', 'personaPrompt', 'userNote'] as const
  const attemptedPatchKeys = isPlainRecord(payload.attemptedPatch) ? Object.keys(payload.attemptedPatch) : []
  if (
    !Number.isInteger(payload.revision) ||
    payload.revision < 0 ||
    !nonEmptyString(payload.personaId) ||
    !isPlainRecord(payload.attemptedPatch) ||
    attemptedPatchKeys.length === 0 ||
    !isJsonValue(payload.attemptedPatch) ||
    !isPlainRecord(payload.attemptedPersona) ||
    !isJsonValue(payload.attemptedPersona) ||
    payload.attemptedPersona.id !== payload.personaId ||
    !isPlainRecord(payload.attemptedLegacyProfile) ||
    !isJsonValueEqual(Object.keys(payload.attemptedLegacyProfile).sort(), [...legacyKeys].sort()) ||
    legacyKeys.some((key) => typeof payload.attemptedLegacyProfile[key] !== 'string') ||
    typeof payload.legacyProfileProjectionApplied !== 'boolean' ||
    attemptedPatchKeys.some(
      (key) =>
        !Object.prototype.hasOwnProperty.call(payload.attemptedPersona, key) ||
        !isJsonValueEqual(payload.attemptedPersona[key], payload.attemptedPatch[key]),
    )
  ) {
    return false
  }

  if (payload.legacyProfileProjectionApplied) {
    const expectedLegacyProfile = {
      username: typeof payload.attemptedPersona.name === 'string' ? payload.attemptedPersona.name : '',
      userIcon: typeof payload.attemptedPersona.icon === 'string' ? payload.attemptedPersona.icon : '',
      personaPrompt:
        typeof payload.attemptedPersona.personaPrompt === 'string' ? payload.attemptedPersona.personaPrompt : '',
      userNote: typeof payload.attemptedPersona.note === 'string' ? payload.attemptedPersona.note : '',
    }
    if (legacyKeys.some((key) => payload.attemptedLegacyProfile[key] !== expectedLegacyProfile[key])) return false
  }

  const knownCollectionRevision = Math.max(
    collectionsResourceState.fullRevision ?? -1,
    collectionsResourceState.revisions.personas ?? -1,
  )
  const knownSettingsRevision = settingsResourceState.fullRevision ?? -1
  if (
    knownCollectionRevision >= payload.revision &&
    (!payload.legacyProfileProjectionApplied || knownSettingsRevision >= payload.revision)
  ) {
    return true
  }

  const personas = collectionsResourceState.values.personas
  if (
    collectionsResourceState.statuses.personas !== 'ready' ||
    collectionsResourceState.revisions.personas === undefined ||
    !Array.isArray(personas) ||
    !isUniquePresetCollection(personas)
  ) {
    return false
  }
  const matches = personas.filter((candidate) => isPlainRecord(candidate) && candidate.id === payload.personaId)
  // A later optimistic delete can remove this row before the accepted PATCH
  // response is reconciled. The receipt only fences revisions and never
  // reapplies fields, so zero matches is safe; duplicates remain ambiguous.
  if (matches.length > 1) return false

  if (
    payload.legacyProfileProjectionApplied &&
    (settingsResourceState.status !== 'ready' || settingsResourceState.fullRevision === null)
  ) {
    return false
  }

  collectionsResourceState.revisions.personas = payload.revision
  collectionsResourceState.revision = maxRevision(collectionsResourceState.revision, payload.revision)
  collectionsResourceState.statuses.personas = 'ready'
  delete collectionsResourceState.errors.personas

  if (payload.legacyProfileProjectionApplied) {
    settingsResourceState.fullRevision = payload.revision
    settingsResourceState.revision = maxRevision(settingsResourceState.revision, payload.revision)
    settingsResourceState.status = 'ready'
    settingsResourceState.error = null
  }

  markResourceDatabaseChanged()
  return true
}

/**
 * Fence the exact slices written by an accepted optimistic persona structure
 * mutation. The response certificate already proved the final ordering,
 * selection, and any saved/mirrored profile, so retain newer optimistic values
 * and advance only the collection/settings revisions the server actually wrote.
 */
export function applyPersonaMutationLocalEffect(payload: ServerPersonaMutationLocalEffectPayload): boolean {
  if (
    !Number.isInteger(payload.revision) ||
    payload.revision < 0 ||
    !['create', 'delete', 'select', 'reorder'].includes(payload.operation) ||
    typeof payload.collectionWritten !== 'boolean' ||
    typeof payload.settingsWritten !== 'boolean' ||
    ((payload.operation === 'create' || payload.operation === 'delete' || payload.operation === 'reorder') &&
      !payload.collectionWritten)
  ) {
    return false
  }

  const knownCollectionRevision = Math.max(
    collectionsResourceState.fullRevision ?? -1,
    collectionsResourceState.revisions.personas ?? -1,
  )
  const knownSettingsRevision = settingsResourceState.fullRevision ?? -1
  if (
    (payload.collectionWritten || payload.settingsWritten) &&
    (!payload.collectionWritten || knownCollectionRevision >= payload.revision) &&
    (!payload.settingsWritten || knownSettingsRevision >= payload.revision)
  ) {
    return true
  }

  const personas = collectionsResourceState.values.personas
  if (
    collectionsResourceState.statuses.personas !== 'ready' ||
    collectionsResourceState.revisions.personas === undefined ||
    !Array.isArray(personas) ||
    !isUniquePresetCollection(personas)
  ) {
    return false
  }

  if (payload.settingsWritten) {
    const settings = settingsResourceState.value as Record<string, unknown>
    const selectedPersona = settings.selectedPersona
    if (
      settingsResourceState.status !== 'ready' ||
      settingsResourceState.fullRevision === null ||
      !Number.isInteger(selectedPersona) ||
      (selectedPersona as number) < 0 ||
      (selectedPersona as number) >= personas.length ||
      typeof settings.username !== 'string' ||
      typeof settings.userIcon !== 'string' ||
      typeof settings.personaPrompt !== 'string' ||
      typeof settings.userNote !== 'string'
    ) {
      return false
    }
  }

  let changed = false
  if (payload.collectionWritten && knownCollectionRevision < payload.revision) {
    collectionsResourceState.revisions.personas = payload.revision
    collectionsResourceState.revision = maxRevision(collectionsResourceState.revision, payload.revision)
    collectionsResourceState.statuses.personas = 'ready'
    delete collectionsResourceState.errors.personas
    changed = true
  }
  if (payload.settingsWritten && knownSettingsRevision < payload.revision) {
    settingsResourceState.fullRevision = payload.revision
    settingsResourceState.revision = maxRevision(settingsResourceState.revision, payload.revision)
    settingsResourceState.status = 'ready'
    settingsResourceState.error = null
    changed = true
  }
  if (changed) markResourceDatabaseChanged()
  return true
}

/**
 * Fence both tables written by one accepted translator-preset PATCH. The
 * optimistic row and its selected legacy mirror are already resident, so this
 * advances only the collection and language-group revision fences. Projection
 * epochs and acknowledgement taints remain owned by authoritative reads.
 */
export function applyTranslatorPresetPatchLocalEffect(payload: ServerTranslatorPresetPatchLocalEffectPayload): boolean {
  const attemptedKeys = isPlainRecord(payload.attemptedPatch) ? Object.keys(payload.attemptedPatch).sort() : []
  const allowedKeys = new Set(['name', 'prompt', 'maxResponse'])
  if (
    !Number.isInteger(payload.revision) ||
    payload.revision < 0 ||
    !nonEmptyString(payload.presetId) ||
    !nonEmptyString(payload.selectedPresetId) ||
    !isPlainRecord(payload.attemptedPatch) ||
    attemptedKeys.length === 0 ||
    attemptedKeys.some((key) => !allowedKeys.has(key) || !isJsonValue(payload.attemptedPatch[key])) ||
    !isCanonicalTranslatorPresetRecord(payload.attemptedPreset) ||
    payload.attemptedPreset.id !== payload.presetId ||
    attemptedKeys.some((key) => !isJsonValueEqual(payload.attemptedPreset[key], payload.attemptedPatch[key]))
  ) {
    return false
  }

  const presets = collectionsResourceState.values.translatorPresets
  const settings = settingsResourceState.value as Record<string, unknown>
  const knownCollectionRevision = Math.max(
    collectionsResourceState.fullRevision ?? -1,
    collectionsResourceState.revisions.translatorPresets ?? -1,
  )
  const knownLanguageRevision = Math.max(
    settingsResourceState.fullRevision ?? -1,
    settingsResourceState.groupRevisions.language ?? -1,
  )
  if (
    collectionsResourceState.statuses.translatorPresets !== 'ready' ||
    collectionsResourceState.revisions.translatorPresets === undefined ||
    settingsResourceState.status !== 'ready' ||
    knownLanguageRevision < 0 ||
    !Array.isArray(presets) ||
    !isCanonicalTranslatorPresetCollection(presets)
  ) {
    return false
  }

  const targetMatches = presets.filter((preset) => preset.id === payload.presetId)
  const selectedIndex = settings.translatorPresetId
  if (
    !Number.isInteger(selectedIndex) ||
    (selectedIndex as number) < 0 ||
    (selectedIndex as number) >= presets.length
  ) {
    return false
  }
  const selectedPreset = presets[selectedIndex as number]
  if (
    targetMatches.length !== 1 ||
    selectedPreset.id !== payload.selectedPresetId ||
    !isJsonValueEqual(settings.translatorPrompt, selectedPreset.prompt) ||
    !isJsonValueEqual(settings.translatorMaxResponse, selectedPreset.maxResponse)
  ) {
    return false
  }

  if (knownCollectionRevision < payload.revision) {
    collectionsResourceState.revisions.translatorPresets = payload.revision
    collectionsResourceState.revision = maxRevision(collectionsResourceState.revision, payload.revision)
    collectionsResourceState.statuses.translatorPresets = 'ready'
    delete collectionsResourceState.errors.translatorPresets
  }
  if (knownLanguageRevision < payload.revision) {
    settingsResourceState.groupRevisions.language = payload.revision
    settingsResourceState.revision = maxRevision(settingsResourceState.revision, payload.revision)
    settingsResourceState.status = 'ready'
    settingsResourceState.error = null
  }
  markResourceDatabaseChanged()
  return true
}

/**
 * Apply response-confirmed Agent Preset fields while fencing only the read-only
 * `agents` settings projection. Field-state comparisons retain a newer local
 * edit to the same field; the server-owned timestamp advances independently.
 * Authoritative settings reads alone advance projection epochs or clear taint.
 */
export function applyAgentPresetPatchLocalEffect(payload: ServerAgentPresetPatchLocalEffectPayload): boolean {
  return applyAgentPresetFieldPatchLocalEffect(payload)
}

export function applyAgentPresetStepPatchLocalEffect(payload: ServerAgentPresetStepPatchLocalEffectPayload): boolean {
  return applyAgentPresetFieldPatchLocalEffect(payload)
}

function applyAgentPresetFieldPatchLocalEffect(
  payload: ServerAgentPresetPatchLocalEffectPayload | ServerAgentPresetStepPatchLocalEffectPayload,
): boolean {
  const isStepPatch = 'stepId' in payload
  const allowedKeys = isStepPatch
    ? new Set([
        'name',
        'enabled',
        'phase',
        'dependencies',
        'instruction',
        'model',
        'runtime',
        'inputScopes',
        'outputKey',
        'outputFormat',
        'destination',
        'failurePolicy',
      ])
    : new Set(['name', 'description', 'enabled', 'maxConcurrency'])
  const fieldEntries = isPlainRecord(payload.fields) ? Object.entries(payload.fields) : []
  if (
    !Number.isInteger(payload.revision) ||
    payload.revision < 0 ||
    !nonEmptyString(payload.presetId) ||
    (isStepPatch && !nonEmptyString(payload.stepId)) ||
    fieldEntries.length === 0 ||
    typeof payload.updatedAt !== 'number' ||
    !Number.isFinite(payload.updatedAt) ||
    payload.updatedAt < 0
  ) {
    return false
  }
  for (const [key, field] of fieldEntries) {
    if (
      !allowedKeys.has(key) ||
      !isPlainRecord(field) ||
      !isCanonicalJsonFieldState(field.attempted) ||
      !isCanonicalJsonFieldState(field.canonical) ||
      (isStepPatch && !field.canonical.present) ||
      (!isStepPatch && !field.canonical.present && key !== 'description' && key !== 'maxConcurrency')
    ) {
      return false
    }
  }

  const knownRevision = Math.max(
    settingsResourceState.fullRevision ?? -1,
    settingsResourceState.groupRevisions.agents ?? -1,
  )
  if (knownRevision >= payload.revision) return true
  const settings = settingsResourceState.value as Record<string, unknown>
  const presets = settings.agentPresets
  if (
    settingsResourceState.status !== 'ready' ||
    knownRevision < 0 ||
    !Array.isArray(presets) ||
    !isUniqueAgentPresetProjection(presets)
  ) {
    return false
  }

  const presetIndexes = presets.flatMap((candidate, index) =>
    isPlainRecord(candidate) && candidate.id === payload.presetId ? [index] : [],
  )
  if (presetIndexes.length !== 1) return false
  const presetIndex = presetIndexes[0]
  const preset = presets[presetIndex] as Record<string, unknown>
  const nextPreset = cloneJsonValue(preset)
  let target = preset
  let nextTarget = nextPreset
  if (isStepPatch) {
    const steps = preset.steps
    const nextSteps = nextPreset.steps
    if (!Array.isArray(steps) || !Array.isArray(nextSteps)) return false
    const stepIndexes = steps.flatMap((candidate, index) =>
      isPlainRecord(candidate) && candidate.id === payload.stepId ? [index] : [],
    )
    if (stepIndexes.length !== 1) return false
    const stepIndex = stepIndexes[0]
    target = steps[stepIndex] as Record<string, unknown>
    nextTarget = nextSteps[stepIndex] as Record<string, unknown>
  }

  for (const [key, field] of fieldEntries) {
    if (!jsonFieldStateMatches(target, key, field.attempted)) continue
    if (field.canonical.present) nextTarget[key] = cloneJsonValue(field.canonical.value)
    else delete nextTarget[key]
  }
  nextPreset.updatedAt = payload.updatedAt
  if (isStepPatch && !isCanonicalValidAgentPreset(nextPreset)) return false
  presets[presetIndex] = nextPreset
  settingsResourceState.groupRevisions.agents = payload.revision
  settingsResourceState.revision = maxRevision(settingsResourceState.revision, payload.revision)
  settingsResourceState.status = 'ready'
  settingsResourceState.error = null
  markResourceDatabaseChanged()
  return true
}

function isCanonicalValidAgentPreset(value: Record<string, unknown>): boolean {
  const normalized = normalizeAgentPresets([value])
  return (
    normalized.length === 1 &&
    isJsonValueEqual(value, normalized[0]) &&
    validateAgentPresetRecord(normalized[0]).length === 0
  )
}

function isUniqueAgentPresetProjection(value: readonly unknown[]): boolean {
  const presetIds = new Set<string>()
  for (const candidate of value) {
    if (!isPlainRecord(candidate) || !nonEmptyString(candidate.id) || presetIds.has(candidate.id)) return false
    presetIds.add(candidate.id)
    if (!Array.isArray(candidate.steps)) return false
    const stepIds = new Set<string>()
    for (const step of candidate.steps) {
      if (!isPlainRecord(step) || !nonEmptyString(step.id) || stepIds.has(step.id)) return false
      stepIds.add(step.id)
    }
  }
  return true
}

/**
 * Reconcile authoritative legacy-preset membership and shell metadata while
 * retaining already-hydrated bodies for rows that did not change.
 */
export function applyLegacyPresetCollectionResource(payload: ServerLegacyPresetCollectionResourcePayload): boolean {
  const currentRevision = collectionsResourceState.revisions.botPresets ?? null
  if (isOlderRevision(payload.revision, currentRevision)) return false

  const shellsById = uniqueLegacyPresetRowsById(payload.shells)
  const changedById = uniqueLegacyPresetRowsById(payload.presetRows)
  const currentPresets = collectionsResourceState.values.botPresets
  const currentById = Array.isArray(currentPresets) ? uniqueLegacyPresetRowsById(currentPresets) : new Map()
  if (!shellsById || !changedById || !currentById) return false
  for (const presetId of changedById.keys()) {
    if (!shellsById.has(presetId)) return false
  }

  const nextPresets = payload.shells.map((candidate) => {
    const shell = candidate as Record<string, unknown>
    const presetId = shell.id as string
    const changed = changedById.get(presetId)
    const current = currentById.get(presetId)
    if (changed) {
      return overlayConcurrentLegacyPresetFields(changed, current, payload.baseline?.get(presetId))
    }
    if (current) return { ...cloneJsonValue(current), ...cloneJsonValue(shell) }
    return cloneJsonValue(shell)
  })

  collectionsResourceState.values.botPresets = nextPresets as never
  markLegacyPresetCollectionApplied(payload.revision)
  return true
}

function markLegacyPresetCollectionApplied(revision: number): void {
  collectionsResourceState.revisions.botPresets = revision
  collectionsResourceState.revision = maxRevision(collectionsResourceState.revision, revision)
  collectionsResourceState.statuses.botPresets = 'ready'
  delete collectionsResourceState.errors.botPresets
  advanceCollectionProjectionEpoch('botPresets')
  markResourceDatabaseChanged()
}

function uniqueLegacyPresetRowsById(rows: readonly unknown[]): Map<string, Record<string, unknown>> | null {
  const byId = new Map<string, Record<string, unknown>>()
  for (const candidate of rows) {
    if (!isPlainRecord(candidate) || !nonEmptyString(candidate.id) || byId.has(candidate.id)) return null
    byId.set(candidate.id, candidate)
  }
  return byId
}

function overlayConcurrentLegacyPresetFields(
  authoritative: Record<string, unknown>,
  current: Record<string, unknown> | undefined,
  baseline: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const next = cloneJsonValue(authoritative)
  if (!current || !baseline) return next

  for (const key of new Set([...Object.keys(baseline), ...Object.keys(current)])) {
    if (key === 'id') continue
    const currentHasKey = Object.prototype.hasOwnProperty.call(current, key)
    const baselineHasKey = Object.prototype.hasOwnProperty.call(baseline, key)
    if (currentHasKey === baselineHasKey && isJsonValueEqual(current[key], baseline[key])) continue
    if (currentHasKey) next[key] = cloneJsonValue(current[key])
    else delete next[key]
  }
  return next
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
  if (!preserveResidentChatBodies) resetCharacterBodyResourceRevisions()
  const previousCharacters = charactersResourceState.characters
  const appliedLorebookBodyIds = new Set<string>()
  const existingById = preserveResidentChatBodies
    ? new Map(
        charactersResourceState.characters
          .filter((candidate) => nonEmptyString(candidate?.chaId))
          .map((candidate) => [candidate.chaId, candidate]),
      )
    : null
  charactersResourceState.characters = payload.characters.map((candidate) => {
    const nextCharacter = cloneJsonValue(candidate)
    const appliesLorebookBody =
      nextCharacter.globalLore !== undefined &&
      !hasNewerCharacterLorebookBodyResourceRevision(nextCharacter.chaId, payload.revision)
    if (appliesLorebookBody) appliedLorebookBodyIds.add(nextCharacter.chaId)
    return preserveResidentCharacterChatBodies(nextCharacter, existingById?.get(candidate.chaId), payload.revision)
  })
  if (preserveResidentChatBodies) {
    markRemovedCharacterBodyProjections(previousCharacters, charactersResourceState.characters)
  }
  pruneCharacterBodyResourceRevisions(charactersResourceState.characters)
  for (const characterId of appliedLorebookBodyIds) {
    markCharacterLorebookBodyResourceRevision(characterId, payload.revision)
    if (preserveResidentChatBodies) advanceCharacterLorebookBodyProjectionEpoch(characterId)
  }
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
  if (!preserveResidentChatBodies) advanceAllChatBodyProjectionEpochs()
  if (!preserveResidentChatBodies) advanceAllCharacterLorebookBodyProjectionEpochs()
  advanceAllCharacterLorebookProjectionEpochs()
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
  const previousCharacter = index >= 0 ? charactersResourceState.characters[index] : undefined
  const incomingCharacter = cloneJsonValue(payload.character)
  const appliesLorebookBody =
    incomingCharacter.globalLore !== undefined &&
    !hasNewerCharacterLorebookBodyResourceRevision(characterId, payload.revision)
  const nextCharacter = preserveResidentCharacterChatBodies(incomingCharacter, previousCharacter, payload.revision)
  if (index >= 0) {
    charactersResourceState.characters[index] = nextCharacter
  } else {
    charactersResourceState.characters.push(nextCharacter)
  }
  if (previousCharacter) {
    markRemovedCharacterBodyProjections([previousCharacter], [nextCharacter])
  }
  pruneCharacterBodyResourceRevisions(charactersResourceState.characters)
  if (appliesLorebookBody) {
    markCharacterLorebookBodyResourceRevision(characterId, payload.revision)
    advanceCharacterLorebookBodyProjectionEpoch(characterId)
  }
  charactersResourceState.rowRevisions[characterId] = payload.revision
  charactersResourceState.rowStatuses[characterId] = 'ready'
  delete charactersResourceState.rowErrors[characterId]
  charactersResourceState.revision = maxRevision(charactersResourceState.revision, payload.revision)
  advanceCharacterRowProjectionEpoch(characterId)
  advanceCharacterLorebookProjectionEpoch(characterId)
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
  settingsResourceState.loreBookPageRevision = null
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
  resetCharacterBodyResourceRevisions()
  advanceAllSettingsProjectionEpochs()
  advanceSettingsProjectionEpoch({ authoritativeFull: true })
  advanceLorebookPageProjectionEpoch()
  advanceAllCollectionProjectionEpochs()
  advanceAllCharacterRowProjectionEpochs()
  advanceAllChatBodyProjectionEpochs()
  advanceAllCharacterLorebookBodyProjectionEpochs()
  advanceAllCharacterLorebookProjectionEpochs()
  markResourceDatabaseChanged()
}

export function replaceResourceDatabase(database: Database, revision?: number): void {
  resetCharacterBodyResourceRevisions()
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
  settingsResourceState.loreBookPageRevision = null
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
  advanceAllSettingsProjectionEpochs()
  advanceSettingsProjectionEpoch({ authoritativeFull: true })
  advanceLorebookPageProjectionEpoch()
  advanceAllCollectionProjectionEpochs()
  advanceAllCharacterRowProjectionEpochs()
  advanceAllChatBodyProjectionEpochs()
  advanceAllCharacterLorebookBodyProjectionEpochs()
  advanceAllCharacterLorebookProjectionEpochs()
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

function preserveResidentCharacterChatBodies(
  incoming: character,
  existing: character | undefined,
  incomingRevision: number,
): character {
  if (existing && Array.isArray(incoming.chats) && Array.isArray(existing.chats)) {
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
  const bodyIsNewer = hasNewerCharacterLorebookBodyResourceRevision(incoming.chaId, incomingRevision)
  if (bodyIsNewer) {
    if (existing?.globalLore !== undefined) {
      incoming.globalLore = existing.globalLore
    } else {
      delete incoming.globalLore
    }
  } else if (incoming.globalLore === undefined && existing?.globalLore !== undefined) {
    incoming.globalLore = existing.globalLore
  }
  return incoming
}

function applyRuntimeLanguage(value: unknown): void {
  changeLanguage(typeof value === 'string' ? value : 'en')
}

function shouldUseCharacterPointerResource(property: 'characterOrder' | 'currentChar'): boolean {
  const targetedRevision =
    property === 'characterOrder' ? charactersResourceState.orderRevision : charactersResourceState.selectionRevision
  const pointerRevision = Math.max(charactersResourceState.listRevision ?? -1, targetedRevision ?? -1)
  if (pointerRevision < 0) return false
  return settingsResourceState.fullRevision === null || pointerRevision >= settingsResourceState.fullRevision
}

function isLorebookMutationOperation(value: unknown): value is ServerLorebookMutationLocalEffectPayload['operation'] {
  return value === 'replace' || value === 'upsert' || value === 'delete' || value === 'reorder'
}

function isGlobalLorebookMutationOperation(
  value: unknown,
): value is ServerGlobalLorebookMutationLocalEffectPayload['operation'] {
  return value === 'create' || value === 'update' || value === 'delete' || value === 'reorder' || value === 'select'
}

function isCanonicalGlobalLorebookCollectionProjection(value: unknown): boolean {
  if (!Array.isArray(value)) return false
  const ids = new Set<string>()
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false
    const record = candidate as Record<string, unknown>
    if (!nonEmptyString(record.id) || ids.has(record.id)) return false
    if (!nonEmptyString(record.name) || !isCanonicalLorebookEntries(record.data)) return false
    ids.add(record.id)
  }
  return true
}

function isStableGlobalLorebookPageProjection(): boolean {
  if (settingsResourceState.status !== 'ready' || collectionsResourceState.statuses.loreBook !== 'ready') return false
  const lorebooks = collectionsResourceState.values.loreBook
  if (!Array.isArray(lorebooks)) return false
  const ids = new Set<string>()
  for (const candidate of lorebooks) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false
    const id = (candidate as Record<string, unknown>).id
    if (!nonEmptyString(id) || ids.has(id)) return false
    ids.add(id)
  }
  const page = (settingsResourceState.value as Record<string, unknown>).loreBookPage
  return (
    Number.isInteger(page) &&
    (lorebooks.length === 0 ? page === 0 : (page as number) >= 0 && (page as number) < lorebooks.length)
  )
}

function isNullableNonEmptyString(value: unknown): value is string | null {
  return value === null || nonEmptyString(value)
}

function isCanonicalGlobalLorebookTarget(lorebookId: string): boolean {
  const lorebooks = collectionsResourceState.values.loreBook
  if (!Array.isArray(lorebooks)) return false

  const ids = new Set<string>()
  let target: Record<string, unknown> | null = null
  for (const candidate of lorebooks) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false
    const record = candidate as Record<string, unknown>
    if (!nonEmptyString(record.id) || ids.has(record.id)) return false
    ids.add(record.id)
    if (record.id === lorebookId) target = record
  }
  return !!target && nonEmptyString(target.name) && isCanonicalLorebookEntries(target.data)
}

function isCanonicalCharacterLorebookTarget(characterId: string): boolean {
  const matches = charactersResourceState.characters.filter((candidate) => candidate?.chaId === characterId)
  return matches.length === 1 && isCanonicalLorebookEntries(matches[0].globalLore)
}

function isCanonicalChatLorebookTarget(characterId: string, chatId: string): boolean {
  let target: unknown = null
  let matches = 0
  for (const character of charactersResourceState.characters) {
    for (const chat of character.chats ?? []) {
      if (chat?.id !== chatId) continue
      matches += 1
      if (character.chaId === characterId) target = chat.localLore
    }
  }
  return matches === 1 && isCanonicalLorebookEntries(target)
}

function isCanonicalLorebookEntries(value: unknown): boolean {
  if (!Array.isArray(value)) return false
  const ids = new Set<string>()
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false
    const entry = candidate as Record<string, unknown>
    if (!nonEmptyString(entry.id) || ids.has(entry.id)) return false
    if (
      typeof entry.key !== 'string' ||
      typeof entry.secondkey !== 'string' ||
      typeof entry.insertorder !== 'number' ||
      !Number.isFinite(entry.insertorder) ||
      typeof entry.comment !== 'string' ||
      typeof entry.content !== 'string' ||
      typeof entry.mode !== 'string' ||
      typeof entry.alwaysActive !== 'boolean' ||
      typeof entry.selective !== 'boolean' ||
      (entry.folder !== undefined && typeof entry.folder !== 'string')
    ) {
      return false
    }
    ids.add(entry.id)
  }
  return true
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

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isCanonicalJsonFieldState(value: unknown): value is ServerJsonFieldState {
  if (!isPlainRecord(value) || typeof value.present !== 'boolean') return false
  const keys = Object.keys(value).sort()
  if (!value.present) return isJsonValueEqual(keys, ['present'])
  return isJsonValueEqual(keys, ['present', 'value']) && isJsonValue(value.value)
}

function jsonFieldStateMatches(record: Record<string, unknown>, key: string, state: ServerJsonFieldState): boolean {
  const present = Object.prototype.hasOwnProperty.call(record, key)
  if (present !== state.present) return false
  return !state.present || isJsonValueEqual(record[key], state.value)
}

function isJsonValue(value: unknown, ancestors = new Set<object>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (!value || typeof value !== 'object' || ancestors.has(value)) return false
  const prototype = Object.getPrototypeOf(value)
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return false

  ancestors.add(value)
  const valid = Array.isArray(value)
    ? value.every((entry, index) => Object.prototype.hasOwnProperty.call(value, index) && isJsonValue(entry, ancestors))
    : Object.values(value).every((entry) => isJsonValue(entry, ancestors))
  ancestors.delete(value)
  return valid
}

function isUniquePresetCollection(value: readonly unknown[]): boolean {
  const ids = new Set<string>()
  for (const candidate of value) {
    if (!isPlainRecord(candidate) || !nonEmptyString(candidate.id) || ids.has(candidate.id)) return false
    ids.add(candidate.id)
  }
  return true
}

function isCanonicalTranslatorPresetRecord(value: unknown): value is {
  id: string
  name: string
  prompt: string
  maxResponse: number
} {
  if (!isPlainRecord(value)) return false
  return (
    isJsonValueEqual(Object.keys(value).sort(), ['id', 'maxResponse', 'name', 'prompt']) &&
    nonEmptyString(value.id) &&
    typeof value.name === 'string' &&
    typeof value.prompt === 'string' &&
    typeof value.maxResponse === 'number' &&
    Number.isFinite(value.maxResponse)
  )
}

function isCanonicalTranslatorPresetCollection(
  value: readonly unknown[],
): value is Array<{ id: string; name: string; prompt: string; maxResponse: number }> {
  return value.every(isCanonicalTranslatorPresetRecord) && isUniquePresetCollection(value)
}

function cloneJsonValue<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}

function isUniqueStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => nonEmptyString(entry)) && new Set(value).size === value.length
}

function isPromptItemMutationOperation(value: unknown): value is PromptItemMutationOperation {
  return value === 'create' || value === 'update' || value === 'delete' || value === 'reorder' || value === 'enable'
}

function isCanonicalPromptTemplateOwnerState(value: unknown): value is PromptTemplateOwnerStateSnapshot {
  if (!isPlainRecord(value)) return false
  if (value.enabled === false) return Object.keys(value).length === 1
  return value.enabled === true && Object.keys(value).length === 2 && isCanonicalPromptItemArray(value.items)
}

function isCanonicalPromptItemArray(value: unknown): value is Array<Record<string, unknown> & { id: string }> {
  if (!Array.isArray(value)) return false
  const seen = new Set<string>()
  for (const candidate of value) {
    if (!isPlainRecord(candidate) || !nonEmptyString(candidate.id) || seen.has(candidate.id)) return false
    seen.add(candidate.id)
  }
  return true
}

function promptItemMutationMatchesOwnerState(payload: ServerPromptItemMutationLocalEffectPayload): boolean {
  const items = payload.ownerState.enabled ? payload.ownerState.items : null
  if (payload.operation === 'create' || payload.operation === 'update') {
    return nonEmptyString(payload.itemId) && !!items?.some((item) => item.id === payload.itemId)
  }
  if (payload.operation === 'delete') {
    return nonEmptyString(payload.itemId) && !!items && items.every((item) => item.id !== payload.itemId)
  }
  if (payload.operation === 'reorder') {
    return (
      isUniqueStringArray(payload.itemIds) &&
      !!items &&
      isJsonValueEqual(
        items.map((item) => item.id),
        payload.itemIds,
      )
    )
  }
  return typeof payload.enabled === 'boolean' && payload.ownerState.enabled === payload.enabled
}

function readCanonicalLivePromptTemplateOwnerState(
  promptPresetId: string | null,
): PromptTemplateOwnerStateSnapshot | null {
  if (promptPresetId === null) {
    return readCanonicalPromptTemplateValue(
      Object.prototype.hasOwnProperty.call(collectionsResourceState.values, 'promptTemplate'),
      collectionsResourceState.values.promptTemplate,
    )
  }

  const presets = collectionsResourceState.values.promptPresets
  if (!Array.isArray(presets)) return null
  const seen = new Set<string>()
  let owner: Record<string, unknown> | null = null
  for (const candidate of presets) {
    if (!isPlainRecord(candidate) || !nonEmptyString(candidate.id) || seen.has(candidate.id)) return null
    seen.add(candidate.id)
    if (candidate.id === promptPresetId) owner = candidate
  }
  if (!owner) return null
  return readCanonicalPromptTemplateValue(
    Object.prototype.hasOwnProperty.call(owner, 'promptTemplate'),
    owner.promptTemplate,
  )
}

function readCanonicalPromptTemplateValue(enabled: boolean, value: unknown): PromptTemplateOwnerStateSnapshot | null {
  if (!enabled) return { enabled: false }
  return isCanonicalPromptItemArray(value) ? { enabled: true, items: value } : null
}

function livePromptTemplateOwnerSupportsOperation(
  payload: ServerPromptItemMutationLocalEffectPayload,
  liveOwnerState: PromptTemplateOwnerStateSnapshot,
): boolean {
  if (payload.operation === 'create' || payload.operation === 'update') {
    return liveOwnerState.enabled && liveOwnerState.items.some((item) => item.id === payload.itemId)
  }
  if (payload.operation === 'delete') {
    return !liveOwnerState.enabled || liveOwnerState.items.every((item) => item.id !== payload.itemId)
  }
  if (payload.operation === 'reorder') {
    return (
      liveOwnerState.enabled &&
      isJsonValueEqual(
        liveOwnerState.items.map((item) => item.id),
        payload.itemIds,
      )
    )
  }
  return liveOwnerState.enabled === payload.enabled
}

function isJsonValueEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}
