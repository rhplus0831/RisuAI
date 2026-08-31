import { get } from 'svelte/store'
import { resolveEffectiveAgentPresetId } from './agentPresetResolver'
import {
  CHAT_GENERATION_SETTINGS_INCOMPLETE_MESSAGE,
  resolveDisplayedSidebarToggles,
  resolveChatGenerationSettingsReadiness,
  type ChatGenerationAgentReference,
  type ChatGenerationAgentPresetReference,
  type ChatGenerationDisplayedSidebarToggle,
  type ChatGenerationModelPresetReference,
  type ChatGenerationModuleReference,
  type ChatGenerationPersonaReference,
  type ChatGenerationPromptPresetReference,
  type ChatGenerationRequiredSidebarToggle,
  type ChatGenerationSettings,
  type ChatGenerationSettingsMissingReason,
  type ChatGenerationSettingsReadiness,
} from './chatGenerationSettings'
import {
  dispatchSaveChatGenerationSettings,
  dispatchSaveChatGenerationSettingsWithOutcome,
  isActiveChatTargetFresh,
  type ActiveChatTarget,
  type ChatGenerationSettingsSaveOperation,
} from './chatCommands'
import { language } from '../lang'
import type { ServerCommandTransportOptions } from './server/commands'
import {
  charactersResourceState,
  collectionsResourceState,
  getCharacterResourceOwner,
  SERVER_COLLECTION_NAMES,
  settingsResourceState,
  type ServerCollectionName,
  type ServerResourceStatus,
} from './server/resourceState.svelte'
import { SERVER_SETTINGS_GROUP_BY_KEY } from './server/settingsGroups'
import { selectedCharID } from './stores.svelte'
import { getDatabase, type Chat, type Database, type character } from './storage/database.svelte'
import { resolvePersonaModuleIdsById } from './personaModuleLinks'
import { resolveUniquePromptPreset } from '@risuai/shared-core/effective-prompt-template'

type ActiveChatGenerationPromptPresetReference = ChatGenerationPromptPresetReference & {
  moduleIntergration?: unknown
}

export interface ActiveChatGenerationSettingsIdentity {
  selectedCharIndex: number
  characterIndex: number
  chatIndex: number
  characterId?: string
  chatId?: string
}

export interface ActiveChatGenerationSettingsState {
  db: Database
  identity: ActiveChatGenerationSettingsIdentity
  character?: character
  chat?: Chat
  settings?: ChatGenerationSettings
  persona?: ChatGenerationPersonaReference
  modelPreset?: ChatGenerationModelPresetReference
  promptPreset?: ChatGenerationPromptPresetReference
  effectiveAgentPresetId?: string
  agentPreset?: ChatGenerationAgentPresetReference
  readiness: ChatGenerationSettingsReadiness
  requiredSidebarToggles: ChatGenerationRequiredSidebarToggle[]
  displayedSidebarToggles: ChatGenerationDisplayedSidebarToggle[]
  staleSidebarToggleKeys: string[]
  missingLabels: string[]
}

export interface ResolveActiveChatGenerationSettingsOptions {
  db?: Database
  selectedCharIndex?: number
  chatIndex?: number
  target?: ActiveChatTarget | null
}

interface ActiveChatOwnerProjection {
  db: Database
  selectedCharIndex: number
  usesCharacterOwner: boolean
}

type OwnerRead<T> = { status: 'available'; value: T } | { status: 'unavailable'; value: T }

function explicitDatabaseProjection(db: Database): ActiveChatOwnerProjection {
  return {
    db,
    selectedCharIndex: get(selectedCharID),
    usesCharacterOwner: false,
  }
}

function activeChatOwnerProjection(): ActiveChatOwnerProjection {
  let compatibilityDatabase: Database | undefined
  const compatibility = () => (compatibilityDatabase ??= getDatabase())
  const databaseBase = activeChatDatabaseBase(compatibility)
  const characters = readCharacterOwners(compatibility)
  const personas = readCollectionOwner<ChatGenerationPersonaReference>('personas', compatibility)
  const modelPresets = readCollectionOwner<ChatGenerationModelPresetReference>('modelPresets', compatibility)
  const promptPresets = readCollectionOwner<ActiveChatGenerationPromptPresetReference>('promptPresets', compatibility)
  const modules = readCollectionOwner<ChatGenerationModuleReference>('modules', compatibility)
  const agentConfiguration = readAgentConfigurationOwner(compatibility)
  const moduleSettings = readModuleSettingsOwner(compatibility)

  const db = {
    ...databaseBase,
    characters: characters.value,
    currentChar: characters.selectedCharIndex,
    personas: personas.value,
    modelPresets: modelPresets.value,
    promptPresets: promptPresets.value,
    modules: modules.value,
    agents: agentConfiguration.value.agents,
    agentPresets: agentConfiguration.value.agentPresets,
    agentPresetDefaultId: agentConfiguration.value.agentPresetDefaultId,
    enabledModules: moduleSettings.value,
  } as unknown as Database

  return {
    db,
    selectedCharIndex: characters.selectedCharIndex,
    usesCharacterOwner: characters.usesOwner,
  }
}

function activeChatDatabaseBase(compatibility: () => Database): Partial<Database> {
  const database: Partial<Database> = {}

  if (canUseCompatibility(settingsResourceState.status)) {
    // Cold-start compatibility is deliberately read through the storage
    // adapter, not the resource facade. Project only settings here so a mixed
    // readiness state cannot smuggle stale collections or character rows into
    // the canonical generation snapshot.
    const fallback = compatibility() as unknown as Record<string, unknown>
    for (const [key, value] of Object.entries(fallback)) {
      if (key === 'characters' || SERVER_COLLECTION_NAMES.includes(key as ServerCollectionName)) continue
      ;(database as Record<string, unknown>)[key] = value
    }
  } else if (settingsResourceState.status === 'ready') {
    for (const [key, value] of Object.entries(settingsResourceState.value)) {
      const group = SERVER_SETTINGS_GROUP_BY_KEY[key]
      if (group && settingsResourceState.groupStatuses[group] !== 'ready') continue
      ;(database as Record<string, unknown>)[key] = value
    }
  }

  if (canUseCompatibility(collectionsResourceState.status)) {
    // The collection adapter is used only while the whole collection owner is
    // idle/loading. Ready or errored slices never fall back to aggregate data.
    const fallback = compatibility()
    for (const name of SERVER_COLLECTION_NAMES) {
      database[name] = fallback[name] as never
    }
  } else if (collectionsResourceState.status === 'ready') {
    for (const name of SERVER_COLLECTION_NAMES) {
      if (collectionsResourceState.statuses[name] !== 'ready') continue
      database[name] = collectionsResourceState.values[name] as never
    }
  }

  return database
}

function readCharacterOwners(compatibility: () => Database): {
  status: OwnerRead<character[]>['status']
  value: character[]
  selectedCharIndex: number
  usesOwner: boolean
} {
  if (charactersResourceState.status === 'error') {
    return { status: 'unavailable', value: [], selectedCharIndex: -1, usesOwner: false }
  }
  if (charactersResourceState.status === 'ready') {
    return {
      status: 'available',
      value: charactersResourceState.characters,
      selectedCharIndex:
        charactersResourceState.selectionRevision !== null ? charactersResourceState.currentChar : get(selectedCharID),
      usesOwner: true,
    }
  }
  if (!canUseCompatibility(charactersResourceState.status)) {
    return { status: 'unavailable', value: [], selectedCharIndex: -1, usesOwner: false }
  }
  return {
    status: 'available',
    value: safeArray(compatibility().characters),
    selectedCharIndex: get(selectedCharID),
    usesOwner: false,
  }
}

function readCollectionOwner<T extends { id?: string | null }>(
  name: ServerCollectionName,
  compatibility: () => Database,
): OwnerRead<T[]> {
  const mode = collectionOwnerMode(name)
  if (mode === 'unavailable') return { status: 'unavailable', value: [] }
  const value = mode === 'ready' ? collectionsResourceState.values[name] : compatibility()[name]
  const collection = stableReferenceCollection<T>(value)
  return collection ? { status: 'available', value: collection } : { status: 'unavailable', value: [] }
}

function collectionOwnerMode(name: ServerCollectionName): 'ready' | 'compatibility' | 'unavailable' {
  const status = collectionsResourceState.statuses[name]
  if (collectionsResourceState.status === 'error' || status === 'error') return 'unavailable'
  if (status === 'ready') return 'ready'
  if (canUseCompatibility(collectionsResourceState.status) && canUseCompatibility(status)) return 'compatibility'
  return 'unavailable'
}

function readAgentConfigurationOwner(compatibility: () => Database): OwnerRead<{
  agents: ChatGenerationAgentReference[]
  agentPresets: ChatGenerationAgentPresetReference[]
  agentPresetDefaultId?: string
}> {
  const mode = settingsGroupOwnerMode('agents')
  if (mode === 'unavailable') return unavailableAgentConfiguration()
  const source = (mode === 'ready' ? settingsResourceState.value : compatibility()) as Partial<Database>
  const agents = stableReferenceCollection<ChatGenerationAgentReference>(source.agents, true)
  const agentPresets = stableReferenceCollection<ChatGenerationAgentPresetReference>(source.agentPresets, true)
  if (!agents || !agentPresets) return unavailableAgentConfiguration()
  const defaultId = source.agentPresetDefaultId
  if (defaultId !== undefined && defaultId !== null && !nonEmptyString(defaultId)) {
    return unavailableAgentConfiguration()
  }
  return {
    status: 'available',
    value: {
      agents,
      agentPresets,
      agentPresetDefaultId: nonEmptyString(defaultId) ? defaultId : undefined,
    },
  }
}

function unavailableAgentConfiguration(): OwnerRead<{
  agents: ChatGenerationAgentReference[]
  agentPresets: ChatGenerationAgentPresetReference[]
  agentPresetDefaultId?: string
}> {
  return { status: 'unavailable', value: { agents: [], agentPresets: [] } }
}

function readModuleSettingsOwner(compatibility: () => Database): OwnerRead<string[]> {
  const mode = settingsGroupOwnerMode('modules')
  if (mode === 'unavailable') return { status: 'unavailable', value: [] }
  const source = (mode === 'ready' ? settingsResourceState.value : compatibility()) as Partial<Database>
  const enabledModules = stableStringIdList(source.enabledModules, true)
  return enabledModules ? { status: 'available', value: enabledModules } : { status: 'unavailable', value: [] }
}

function settingsGroupOwnerMode(group: 'agents' | 'modules'): 'ready' | 'compatibility' | 'unavailable' {
  const status = settingsResourceState.groupStatuses[group]
  if (settingsResourceState.status === 'error' || status === 'error') return 'unavailable'
  if (status === 'ready') return 'ready'
  if (canUseCompatibility(settingsResourceState.status) && canUseCompatibility(status)) return 'compatibility'
  return 'unavailable'
}

export type ActiveChatGenerationSettingsGuardResult =
  | { status: 'ok'; state: ActiveChatGenerationSettingsState }
  | { status: 'error'; error: string; state: ActiveChatGenerationSettingsState }

export type ActiveChatGenerationSettingsPatch = Partial<
  Omit<ChatGenerationSettings, 'sidebarToggles' | 'configured'>
> & {
  sidebarToggles?: Record<string, string | undefined>
}

export type ActiveChatGenerationSettingsSaveOptions = ServerCommandTransportOptions & {
  expectedTarget?: ActiveChatTarget | null
}

export function resolveActiveChatGenerationSettings(
  options: ResolveActiveChatGenerationSettingsOptions = {},
): ActiveChatGenerationSettingsState {
  const ownerProjection = options.db ? explicitDatabaseProjection(options.db) : activeChatOwnerProjection()
  const db = ownerProjection.db
  const characters = safeArray<character>(db.characters)
  const selectedCharIndex =
    options.selectedCharIndex ??
    (options.target ? resolveTargetCharacterIndex(characters, options.target) : ownerProjection.selectedCharIndex)
  const character = resolveUniqueCharacterAtIndex(characters, selectedCharIndex)
  const readyCharacter =
    character && ownerProjection.usesCharacterOwner && !isReadyCharacterOwner(character) ? undefined : character
  const chatIndex =
    options.chatIndex ??
    (options.target && readyCharacter
      ? resolveTargetChatIndex(characters, readyCharacter, options.target)
      : Number.isInteger(readyCharacter?.chatPage)
        ? readyCharacter.chatPage
        : -1)
  const chat =
    chatIndex >= 0 && readyCharacter ? resolveUniqueChatAtIndex(characters, readyCharacter, chatIndex) : undefined
  const settings = chat?.generationSettings
  const personas = safeArray<ChatGenerationPersonaReference>(
    db.personas as unknown as ChatGenerationPersonaReference[] | undefined,
  )
  const modelPresets = safeArray<ChatGenerationModelPresetReference>(
    db.modelPresets as unknown as ChatGenerationModelPresetReference[] | undefined,
  )
  const promptPresets = safeArray<ActiveChatGenerationPromptPresetReference>(
    db.promptPresets as unknown as ActiveChatGenerationPromptPresetReference[] | undefined,
  )
  const agentPresets = safeArray<ChatGenerationAgentPresetReference>(
    db.agentPresets as unknown as ChatGenerationAgentPresetReference[] | undefined,
  )
  const effectiveAgentPresetId = resolveEffectiveAgentPresetId(db, settings)

  const readiness = resolveReadiness(db, readyCharacter, chat, settings)
  const identity: ActiveChatGenerationSettingsIdentity = {
    selectedCharIndex,
    characterIndex: readyCharacter ? selectedCharIndex : -1,
    chatIndex: chat ? chatIndex : -1,
    characterId: readyCharacter?.chaId,
    chatId: nonEmptyString(chat?.id) ? chat.id : undefined,
  }

  return {
    db,
    identity,
    character: readyCharacter,
    chat,
    settings,
    persona: findById(personas, settings?.personaId),
    modelPreset: findById(modelPresets, settings?.modelPresetId),
    promptPreset: resolveUniquePromptPreset(promptPresets, settings?.promptPresetId),
    effectiveAgentPresetId,
    agentPreset: findById(agentPresets, effectiveAgentPresetId),
    readiness,
    requiredSidebarToggles: readiness.requirements.sidebarToggles,
    displayedSidebarToggles: resolveDisplayedToggles(db, readyCharacter, chat, settings),
    staleSidebarToggleKeys: readiness.staleSidebarToggleKeys,
    missingLabels: createChatGenerationSettingsMissingLabels(readiness.missing, readiness.requirements.sidebarToggles),
  }
}

export function getActiveChatGenerationSettingsIdentity(): ActiveChatGenerationSettingsIdentity {
  return resolveActiveChatGenerationSettings().identity
}

export function getActiveChatGenerationSettings(): ChatGenerationSettings | undefined {
  return resolveActiveChatGenerationSettings().settings
}

export function getActiveChatGenerationSettingsReadiness(): ChatGenerationSettingsReadiness {
  return resolveActiveChatGenerationSettings().readiness
}

export function getActiveChatRequiredSidebarToggles(): ChatGenerationRequiredSidebarToggle[] {
  return resolveActiveChatGenerationSettings().requiredSidebarToggles
}

export function getActiveChatGenerationSettingsMissingLabels(): string[] {
  return resolveActiveChatGenerationSettings().missingLabels
}

export function guardActiveChatGenerationSettingsForSend(
  state: ActiveChatGenerationSettingsState = resolveActiveChatGenerationSettings(),
): ActiveChatGenerationSettingsGuardResult {
  if (ensureActiveChatSidebarToggleDefaults(state)) {
    state = resolveActiveChatGenerationSettings({
      db: state.db,
      selectedCharIndex: state.identity.characterIndex,
      chatIndex: state.identity.chatIndex,
    })
  }

  if (state.readiness.ready) {
    return { status: 'ok', state }
  }
  return {
    status: 'error',
    error: createActiveChatGenerationSettingsIncompleteMessage(state),
    state,
  }
}

export function createActiveChatGenerationSettingsIncompleteMessage(
  state: Pick<ActiveChatGenerationSettingsState, 'missingLabels'>,
): string {
  const base = translatedIncompleteBaseMessage()
  if (state.missingLabels.length === 0) {
    return base
  }

  const missing = state.missingLabels.join(', ')
  const formatter = translatedIncompleteMissingFormatter()
  if (formatter) {
    return formatter(missing)
  }
  return `${base} Missing: ${missing}.`
}

export function createChatGenerationSettingsMissingLabels(
  missing: readonly ChatGenerationSettingsMissingReason[],
  requiredSidebarToggles: readonly ChatGenerationRequiredSidebarToggle[] = [],
): string[] {
  const labels: string[] = []
  const hasSpecificSidebarToggleReason = missing.some(
    (reason) => reason.code === 'sidebar_toggle_missing' || reason.code === 'sidebar_toggle_invalid',
  )

  for (const reason of missing) {
    const label = missingReasonLabel(reason, requiredSidebarToggles, hasSpecificSidebarToggleReason)
    if (label && !labels.includes(label)) labels.push(label)
  }
  return labels
}

export function createActiveChatGenerationSettingsPatch(
  patch: ActiveChatGenerationSettingsPatch,
  state: ActiveChatGenerationSettingsState = resolveActiveChatGenerationSettings(),
): ChatGenerationSettings {
  const { sidebarToggles, ...scalarPatch } = patch
  const isPromptPresetSelection = nonEmptyString(patch.promptPresetId)
  const next: ChatGenerationSettings = {
    ...cloneGenerationSettings(state.settings),
    ...scalarPatch,
    configured: true,
  }
  if (!hasOwn(next, 'jailbreakToggle')) {
    next.jailbreakToggle = false
  }

  const shouldWriteSidebarToggles =
    hasOwn(patch, 'sidebarToggles') || isPromptPresetSelection || isRecord(state.settings?.sidebarToggles)
  if (shouldWriteSidebarToggles) {
    const mergedSidebarToggles = isRecord(state.settings?.sidebarToggles) ? { ...state.settings.sidebarToggles } : {}
    if (sidebarToggles) {
      for (const [key, value] of Object.entries(sidebarToggles)) {
        if (value === undefined) {
          delete mergedSidebarToggles[key]
        } else {
          mergedSidebarToggles[key] = value
        }
      }
    }
    next.sidebarToggles = pruneStaleSidebarToggleKeys(state, {
      ...next,
      sidebarToggles: mergedSidebarToggles,
    }).sidebarToggles
  }

  const pruned = pruneStaleSidebarToggleKeys(state, next)
  return fillMissingDefaultSidebarToggles(state, pruned)
}

export function createActiveChatGenerationSettingsSelectionPatch(
  selection: Pick<
    ActiveChatGenerationSettingsPatch,
    'personaId' | 'modelPresetId' | 'modelPresetSelectionSource' | 'promptPresetId' | 'agentPresetId' | 'togglePresetId'
  >,
  state: ActiveChatGenerationSettingsState = resolveActiveChatGenerationSettings(),
): ChatGenerationSettings {
  return createActiveChatGenerationSettingsPatch(selection, state)
}

export function createActiveChatPersonaSelectionPatch(
  personaId: string | null,
  state: ActiveChatGenerationSettingsState = resolveActiveChatGenerationSettings(),
): ChatGenerationSettings {
  const next = createActiveChatGenerationSettingsPatch(personaId ? { personaId } : {}, state)
  if (!personaId) delete next.personaId
  return next
}

export function createManualModelPresetSelection(modelPresetId: string): ActiveChatGenerationSettingsPatch {
  return {
    modelPresetId,
    modelPresetSelectionSource: 'manual',
  }
}

export function createPromptPresetSelection(
  promptPresetId: string,
  promptPreset: ChatGenerationPromptPresetReference,
  state: ActiveChatGenerationSettingsState = resolveActiveChatGenerationSettings(),
): ActiveChatGenerationSettingsPatch {
  const selection: ActiveChatGenerationSettingsPatch = { promptPresetId }
  if (state.settings?.modelPresetSelectionSource === 'manual') return selection

  const recommendedModelPresetId = nonEmptyString(promptPreset.recommendedModelPresetId)
    ? promptPreset.recommendedModelPresetId
    : null
  if (
    recommendedModelPresetId &&
    safeArray<ChatGenerationModelPresetReference>(
      state.db.modelPresets as unknown as ChatGenerationModelPresetReference[] | undefined,
    ).some((preset) => preset.id === recommendedModelPresetId)
  ) {
    selection.modelPresetId = recommendedModelPresetId
    selection.modelPresetSelectionSource = 'prompt-recommendation'
  }
  return selection
}

export type ActiveChatModelPresetRecommendationState = 'none' | 'matched' | 'mismatch'

export function activeChatModelPresetRecommendationState(
  state: ActiveChatGenerationSettingsState = resolveActiveChatGenerationSettings(),
): ActiveChatModelPresetRecommendationState {
  const recommendedModelPresetId = state.promptPreset?.recommendedModelPresetId
  const selectedModelPresetId = state.settings?.modelPresetId
  if (!nonEmptyString(recommendedModelPresetId) || !nonEmptyString(selectedModelPresetId)) return 'none'
  const recommendationExists = safeArray<ChatGenerationModelPresetReference>(
    state.db.modelPresets as unknown as ChatGenerationModelPresetReference[] | undefined,
  ).some((preset) => preset.id === recommendedModelPresetId)
  if (!recommendationExists) return 'none'
  return selectedModelPresetId === recommendedModelPresetId ? 'matched' : 'mismatch'
}

export function createActiveChatGenerationSettingsDefaultValuesPatch(
  state: ActiveChatGenerationSettingsState = resolveActiveChatGenerationSettings(),
): ChatGenerationSettings {
  return createActiveChatGenerationSettingsPatch(
    {
      jailbreakToggle: false,
      sidebarToggles: createDefaultSidebarToggleValues(state),
    },
    state,
  )
}

export function fillMissingActiveChatSidebarToggleDefaults(
  state: ActiveChatGenerationSettingsState = resolveActiveChatGenerationSettings(),
): ChatGenerationSettings | undefined {
  if (!state.settings) return undefined
  return fillMissingDefaultSidebarToggles(
    state,
    pruneStaleSidebarToggleKeys(state, cloneGenerationSettings(state.settings)),
  )
}

export function ensureActiveChatSidebarToggleDefaults(
  state: ActiveChatGenerationSettingsState = resolveActiveChatGenerationSettings(),
  options: ActiveChatGenerationSettingsSaveOptions = {},
): boolean {
  if (hasStaleExpectedTarget(options)) return false
  if (hasBlockingSidebarToggleDefaultSaveReason(state)) return false

  const chatId = state.identity.chatId
  const generationSettings = fillMissingActiveChatSidebarToggleDefaults(state)
  if (!chatId || !generationSettings || isJsonValueEqual(generationSettings, state.settings)) return false

  return dispatchSaveChatGenerationSettings(chatId, generationSettings, transportOptions(options))
}

export function createActiveChatJailbreakToggleGenerationSettingsPatch(
  jailbreakToggle: boolean,
  state: ActiveChatGenerationSettingsState = resolveActiveChatGenerationSettings(),
): ChatGenerationSettings {
  return createActiveChatGenerationSettingsPatch({ jailbreakToggle }, state)
}

export function createActiveChatSidebarToggleGenerationSettingsPatch(
  key: string,
  value: string,
  state: ActiveChatGenerationSettingsState = resolveActiveChatGenerationSettings(),
): ChatGenerationSettings {
  return createActiveChatGenerationSettingsPatch({ sidebarToggles: { [key]: value } }, state)
}

export function saveActiveChatGenerationSettingsPatch(
  patch: ActiveChatGenerationSettingsPatch,
  options: ActiveChatGenerationSettingsSaveOptions = {},
): boolean {
  return saveActiveChatGenerationSettingsPatchWithOutcome(patch, options) !== null
}

export function saveActiveChatGenerationSettingsPatchWithOutcome(
  patch: ActiveChatGenerationSettingsPatch,
  options: ActiveChatGenerationSettingsSaveOptions = {},
): ChatGenerationSettingsSaveOperation | null {
  if (hasStaleExpectedTarget(options)) return null
  const state = resolveActiveChatGenerationSettings()
  const chatId = state.identity.chatId
  if (!chatId) return null
  return dispatchSaveChatGenerationSettingsWithOutcome(
    chatId,
    createActiveChatGenerationSettingsPatch(patch, state),
    transportOptions(options),
  )
}

export function saveActiveChatGenerationSettings(
  generationSettings: ChatGenerationSettings,
  options: ActiveChatGenerationSettingsSaveOptions = {},
): boolean {
  return saveActiveChatGenerationSettingsWithOutcome(generationSettings, options) !== null
}

export function saveActiveChatGenerationSettingsWithOutcome(
  generationSettings: ChatGenerationSettings,
  options: ActiveChatGenerationSettingsSaveOptions = {},
): ChatGenerationSettingsSaveOperation | null {
  if (hasStaleExpectedTarget(options)) return null
  const state = resolveActiveChatGenerationSettings()
  const chatId = state.identity.chatId
  if (!chatId) return null
  return dispatchSaveChatGenerationSettingsWithOutcome(
    chatId,
    normalizeActiveChatGenerationSettingsForSave(state, generationSettings),
    transportOptions(options),
  )
}

export function saveActiveChatGenerationSettingsSelection(
  selection: Pick<
    ActiveChatGenerationSettingsPatch,
    'personaId' | 'modelPresetId' | 'modelPresetSelectionSource' | 'promptPresetId' | 'agentPresetId' | 'togglePresetId'
  >,
  options: ActiveChatGenerationSettingsSaveOptions = {},
): boolean {
  return saveActiveChatGenerationSettingsPatch(selection, options)
}

export function saveActiveChatGenerationSettingsSelectionWithOutcome(
  selection: Pick<
    ActiveChatGenerationSettingsPatch,
    'personaId' | 'modelPresetId' | 'modelPresetSelectionSource' | 'promptPresetId' | 'agentPresetId' | 'togglePresetId'
  >,
  options: ActiveChatGenerationSettingsSaveOptions = {},
): ChatGenerationSettingsSaveOperation | null {
  return saveActiveChatGenerationSettingsPatchWithOutcome(selection, options)
}

export function saveActiveChatGenerationSettingsDefaultValues(
  options: ActiveChatGenerationSettingsSaveOptions = {},
): boolean {
  return saveActiveChatGenerationSettingsDefaultValuesWithOutcome(options) !== null
}

export function saveActiveChatGenerationSettingsDefaultValuesWithOutcome(
  options: ActiveChatGenerationSettingsSaveOptions = {},
): ChatGenerationSettingsSaveOperation | null {
  if (hasStaleExpectedTarget(options)) return null
  const state = resolveActiveChatGenerationSettings()
  const chatId = state.identity.chatId
  if (!chatId) return null
  return dispatchSaveChatGenerationSettingsWithOutcome(
    chatId,
    createActiveChatGenerationSettingsDefaultValuesPatch(state),
    transportOptions(options),
  )
}

export function saveActiveChatJailbreakToggleGenerationSettings(
  jailbreakToggle: boolean,
  options: ActiveChatGenerationSettingsSaveOptions = {},
): boolean {
  return saveActiveChatGenerationSettingsPatch({ jailbreakToggle }, options)
}

export function saveActiveChatJailbreakToggleGenerationSettingsWithOutcome(
  jailbreakToggle: boolean,
  options: ActiveChatGenerationSettingsSaveOptions = {},
): ChatGenerationSettingsSaveOperation | null {
  return saveActiveChatGenerationSettingsPatchWithOutcome({ jailbreakToggle }, options)
}

export function saveActiveChatSidebarToggleGenerationSettings(
  key: string,
  value: string,
  options: ActiveChatGenerationSettingsSaveOptions = {},
): boolean {
  return saveActiveChatGenerationSettingsPatch({ sidebarToggles: { [key]: value } }, options)
}

export function saveActiveChatSidebarToggleGenerationSettingsWithOutcome(
  key: string,
  value: string,
  options: ActiveChatGenerationSettingsSaveOptions = {},
): ChatGenerationSettingsSaveOperation | null {
  return saveActiveChatGenerationSettingsPatchWithOutcome({ sidebarToggles: { [key]: value } }, options)
}

function hasStaleExpectedTarget(options: ActiveChatGenerationSettingsSaveOptions): boolean {
  return options.expectedTarget != null && !isActiveChatTargetFresh(options.expectedTarget)
}

function transportOptions(options: ActiveChatGenerationSettingsSaveOptions): ServerCommandTransportOptions {
  const { expectedTarget: _expectedTarget, ...transport } = options
  return transport
}

function hasBlockingSidebarToggleDefaultSaveReason(state: ActiveChatGenerationSettingsState): boolean {
  return state.readiness.missing.some((reason) => {
    switch (reason.code) {
      case 'sidebar_toggles_missing':
      case 'sidebar_toggle_missing':
      case 'sidebar_toggle_invalid':
        return false
      default:
        return true
    }
  })
}

function resolveReadiness(
  db: Database,
  character: character | undefined,
  chat: Chat | undefined,
  settings: ChatGenerationSettings | undefined,
): ChatGenerationSettingsReadiness {
  const modelPresets = safeArray<ChatGenerationModelPresetReference>(
    db.modelPresets as unknown as ChatGenerationModelPresetReference[] | undefined,
  )
  const promptPresets = safeArray<ActiveChatGenerationPromptPresetReference>(
    db.promptPresets as unknown as ActiveChatGenerationPromptPresetReference[] | undefined,
  )
  const selectedPromptPreset = resolveUniquePromptPreset(promptPresets, settings?.promptPresetId)

  return resolveChatGenerationSettingsReadiness({
    settings,
    effectiveAgentPresetId: resolveEffectiveAgentPresetId(db, settings),
    personas: safeArray<ChatGenerationPersonaReference>(
      db.personas as unknown as ChatGenerationPersonaReference[] | undefined,
    ),
    modelPresets,
    promptPresets,
    agentPresets: safeArray<ChatGenerationAgentPresetReference>(
      db.agentPresets as unknown as ChatGenerationAgentPresetReference[] | undefined,
    ),
    agents: safeArray<ChatGenerationAgentReference>(db.agents as unknown as ChatGenerationAgentReference[] | undefined),
    modules: safeArray<ChatGenerationModuleReference>(
      db.modules as unknown as ChatGenerationModuleReference[] | undefined,
    ),
    enabledModuleIds: stringArray(db.enabledModules),
    chatModuleIds: stringArray(chat?.modules),
    characterModuleIds: stringArray(character?.modules),
    personaModuleIds: resolvePersonaModuleIdsById(db, settings?.personaId),
    moduleIntegration:
      typeof selectedPromptPreset?.moduleIntergration === 'string' ? selectedPromptPreset.moduleIntergration : null,
  })
}

function resolveDisplayedToggles(
  db: Database,
  character: character | undefined,
  chat: Chat | undefined,
  settings: ChatGenerationSettings | undefined,
): ChatGenerationDisplayedSidebarToggle[] {
  const modelPresets = safeArray<ChatGenerationModelPresetReference>(
    db.modelPresets as unknown as ChatGenerationModelPresetReference[] | undefined,
  )
  const promptPresets = safeArray<ActiveChatGenerationPromptPresetReference>(
    db.promptPresets as unknown as ActiveChatGenerationPromptPresetReference[] | undefined,
  )
  const selectedPromptPreset = resolveUniquePromptPreset(promptPresets, settings?.promptPresetId)

  return resolveDisplayedSidebarToggles({
    modelPresetId: settings?.modelPresetId,
    promptPresetId: settings?.promptPresetId,
    agentPresetId: resolveEffectiveAgentPresetId(db, settings),
    modelPresets,
    promptPresets,
    agentPresets: safeArray<ChatGenerationAgentPresetReference>(
      db.agentPresets as unknown as ChatGenerationAgentPresetReference[] | undefined,
    ),
    agents: safeArray<ChatGenerationAgentReference>(db.agents as unknown as ChatGenerationAgentReference[] | undefined),
    modules: safeArray<ChatGenerationModuleReference>(
      db.modules as unknown as ChatGenerationModuleReference[] | undefined,
    ),
    enabledModuleIds: stringArray(db.enabledModules),
    chatModuleIds: stringArray(chat?.modules),
    characterModuleIds: stringArray(character?.modules),
    personaModuleIds: resolvePersonaModuleIdsById(db, settings?.personaId),
    moduleIntegration:
      typeof selectedPromptPreset?.moduleIntergration === 'string' ? selectedPromptPreset.moduleIntergration : null,
  })
}

function pruneStaleSidebarToggleKeys(
  state: ActiveChatGenerationSettingsState,
  settings: ChatGenerationSettings,
): ChatGenerationSettings {
  if (!isRecord(settings.sidebarToggles)) return settings

  const readiness = resolveReadiness(state.db, state.character, state.chat, settings)
  if (readiness.staleSidebarToggleKeys.length === 0) return settings

  const sidebarToggles = { ...settings.sidebarToggles }
  for (const key of readiness.staleSidebarToggleKeys) {
    delete sidebarToggles[key]
  }
  return {
    ...settings,
    sidebarToggles,
  }
}

function fillMissingDefaultSidebarToggles(
  state: ActiveChatGenerationSettingsState,
  settings: ChatGenerationSettings,
): ChatGenerationSettings {
  const readiness = resolveReadiness(state.db, state.character, state.chat, settings)
  if (readiness.requirements.sidebarToggles.length === 0) return settings

  const sidebarToggles = isRecord(settings.sidebarToggles) ? { ...settings.sidebarToggles } : {}
  let changed = false

  for (const toggle of readiness.requirements.sidebarToggles) {
    if (typeof sidebarToggles[toggle.key] === 'string') continue
    sidebarToggles[toggle.key] = defaultSidebarToggleValue(toggle)
    changed = true
  }

  if (!changed && isRecord(settings.sidebarToggles)) return settings
  return {
    ...settings,
    sidebarToggles,
  }
}

function createDefaultSidebarToggleValues(state: ActiveChatGenerationSettingsState): Record<string, string> {
  const readiness = resolveReadiness(state.db, state.character, state.chat, state.settings)
  return Object.fromEntries(
    readiness.requirements.sidebarToggles.map((toggle) => [toggle.key, defaultSidebarToggleValue(toggle)]),
  )
}

function defaultSidebarToggleValue(toggle: ChatGenerationRequiredSidebarToggle): string {
  if (toggle.kind === 'text' || toggle.kind === 'textarea') return ''
  return '0'
}

function normalizeActiveChatGenerationSettingsForSave(
  state: ActiveChatGenerationSettingsState,
  generationSettings: ChatGenerationSettings,
): ChatGenerationSettings {
  const next: ChatGenerationSettings = {
    ...generationSettings,
    configured: true,
  }
  if (!hasOwn(next, 'jailbreakToggle')) {
    next.jailbreakToggle = false
  }
  return fillMissingDefaultSidebarToggles(state, pruneStaleSidebarToggleKeys(state, next))
}

function cloneGenerationSettings(settings: ChatGenerationSettings | undefined): ChatGenerationSettings {
  if (!settings) return {}
  const clone: ChatGenerationSettings = {}
  if (hasOwn(settings, 'configured')) clone.configured = settings.configured
  if (hasOwn(settings, 'personaId')) clone.personaId = settings.personaId
  if (hasOwn(settings, 'modelPresetId')) clone.modelPresetId = settings.modelPresetId
  if (hasOwn(settings, 'modelPresetSelectionSource')) {
    clone.modelPresetSelectionSource = settings.modelPresetSelectionSource
  }
  if (hasOwn(settings, 'promptPresetId')) clone.promptPresetId = settings.promptPresetId
  if (hasOwn(settings, 'agentPresetId')) clone.agentPresetId = settings.agentPresetId
  if (hasOwn(settings, 'togglePresetId')) clone.togglePresetId = settings.togglePresetId
  if (hasOwn(settings, 'jailbreakToggle')) clone.jailbreakToggle = settings.jailbreakToggle
  if (isRecord(settings.sidebarToggles)) clone.sidebarToggles = { ...settings.sidebarToggles }
  return clone
}

function missingReasonLabel(
  reason: ChatGenerationSettingsMissingReason,
  requiredSidebarToggles: readonly ChatGenerationRequiredSidebarToggle[],
  hasSpecificSidebarToggleReason: boolean,
): string | null {
  switch (reason.code) {
    case 'settings_missing':
      return 'Generation settings'
    case 'settings_not_configured':
      return 'Configuration confirmation'
    case 'persona_id_missing':
    case 'persona_missing':
      return 'Persona'
    case 'model_preset_id_missing':
    case 'model_preset_missing':
      return 'Model preset'
    case 'prompt_preset_id_missing':
    case 'prompt_preset_missing':
      return 'Prompt preset'
    case 'agent_preset_missing':
      return 'Agent preset'
    case 'jailbreak_toggle_missing':
    case 'jailbreak_toggle_invalid':
      return 'Jailbreak toggle'
    case 'sidebar_toggles_missing':
      return hasSpecificSidebarToggleReason ? null : 'Sidebar toggles'
    case 'sidebar_toggle_missing':
    case 'sidebar_toggle_invalid':
      return requiredSidebarToggles.find((toggle) => toggle.key === reason.toggleKey)?.label ?? reason.toggleKey
  }
}

function resolveTargetCharacterIndex(characters: readonly character[], target: ActiveChatTarget): number {
  if (target.characterId !== undefined) {
    const matches = characters
      .map((characterOwner, index) => ({ characterOwner, index }))
      .filter(({ characterOwner }) => characterOwner?.chaId === target.characterId)
    return matches.length === 1 ? matches[0].index : -1
  }
  return resolveUniqueCharacterAtIndex(characters, target.selectedCharID) ? target.selectedCharID : -1
}

function resolveTargetChatIndex(
  characters: readonly character[],
  characterOwner: character,
  target: ActiveChatTarget,
): number {
  if (target.chatId !== undefined) {
    const matches = (characterOwner.chats ?? [])
      .map((chatOwner, index) => ({ chatOwner, index }))
      .filter(({ chatOwner }) => chatOwner?.id === target.chatId)
    if (matches.length !== 1) return -1
    return resolveUniqueChatOwner(characters, characterOwner, target.chatId) === matches[0].chatOwner
      ? matches[0].index
      : -1
  }
  return resolveUniqueChatAtIndex(characters, characterOwner, target.chatPage) ? target.chatPage : -1
}

function findById<T extends { id?: string | null }>(values: readonly T[], id: string | undefined): T | undefined {
  if (!nonEmptyString(id)) return undefined
  const matches = values.filter((value) => value.id === id)
  return matches.length === 1 ? matches[0] : undefined
}

function resolveUniqueCharacterAtIndex(characters: readonly character[], index: number): character | undefined {
  if (!Number.isInteger(index) || index < 0) return undefined
  const candidate = characters[index]
  if (!nonEmptyString(candidate?.chaId)) return undefined
  return characters.filter((characterOwner) => characterOwner?.chaId === candidate.chaId).length === 1
    ? candidate
    : undefined
}

function resolveUniqueChatAtIndex(
  characters: readonly character[],
  characterOwner: character,
  index: number,
): Chat | undefined {
  if (!Number.isInteger(index) || index < 0) return undefined
  const candidate = characterOwner.chats?.[index]
  if (!nonEmptyString(candidate?.id)) return undefined
  return resolveUniqueChatOwner(characters, characterOwner, candidate.id) === candidate ? candidate : undefined
}

function resolveUniqueChatOwner(
  characters: readonly character[],
  characterOwner: character,
  chatId: string,
): Chat | undefined {
  let owner: { characterOwner: character; chatOwner: Chat } | undefined
  for (const candidateCharacter of characters) {
    for (const candidateChat of candidateCharacter.chats ?? []) {
      if (candidateChat?.id !== chatId) continue
      if (owner) return undefined
      owner = { characterOwner: candidateCharacter, chatOwner: candidateChat }
    }
  }
  return owner?.characterOwner === characterOwner ? owner.chatOwner : undefined
}

function isReadyCharacterOwner(characterOwner: character): boolean {
  return (
    nonEmptyString(characterOwner.chaId) &&
    charactersResourceState.rowStatuses[characterOwner.chaId] === 'ready' &&
    getCharacterResourceOwner(characterOwner.chaId) === characterOwner
  )
}

function stableReferenceCollection<T extends { id?: string | null }>(
  value: unknown,
  allowMissing = false,
): T[] | undefined {
  if (value === undefined && allowMissing) return []
  if (!Array.isArray(value)) return undefined
  const ids = new Set<string>()
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return undefined
    const id = (candidate as { id?: unknown }).id
    if (!nonEmptyString(id) || ids.has(id)) return undefined
    ids.add(id)
  }
  return value as T[]
}

function stableStringIdList(value: unknown, allowMissing = false): string[] | undefined {
  if (value === undefined && allowMissing) return []
  if (!Array.isArray(value)) return undefined
  const ids = new Set<string>()
  for (const candidate of value) {
    if (!nonEmptyString(candidate) || ids.has(candidate)) return undefined
    ids.add(candidate)
  }
  return value
}

function canUseCompatibility(status: ServerResourceStatus | undefined): boolean {
  return status === undefined || status === 'idle' || status === 'loading'
}

function safeArray<T>(value: readonly T[] | undefined): T[] {
  return Array.isArray(value) ? [...value] : []
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(nonEmptyString) : []
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isRecord(value: unknown): value is Record<string, string> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function isJsonValueEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function translatedIncompleteBaseMessage(): string {
  const errors = language.errors as Record<string, unknown> | undefined
  return typeof errors?.chatGenerationSettingsIncomplete === 'string'
    ? errors.chatGenerationSettingsIncomplete
    : CHAT_GENERATION_SETTINGS_INCOMPLETE_MESSAGE
}

function translatedIncompleteMissingFormatter(): ((missing: string) => string) | undefined {
  const errors = language.errors as Record<string, unknown> | undefined
  const formatter = errors?.chatGenerationSettingsIncompleteWithMissing
  return typeof formatter === 'function' ? (formatter as (missing: string) => string) : undefined
}
