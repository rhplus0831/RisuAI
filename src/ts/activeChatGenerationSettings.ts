import { get } from 'svelte/store'
import { resolveEffectiveAgentPresetId } from './agentPresetResolver'
import {
  CHAT_GENERATION_SETTINGS_INCOMPLETE_MESSAGE,
  resolveDisplayedSidebarToggles,
  resolveChatGenerationSettingsReadiness,
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
import { getResourceDatabase } from './server/resourceState.svelte'
import { selectedCharID } from './stores.svelte'
import type { Chat, Database, character } from './storage/database.svelte'

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
  const db = options.db ?? getResourceDatabase()
  const selectedCharIndex = options.selectedCharIndex ?? get(selectedCharID)
  const characters = safeArray<character>(db.characters)
  const character = characters[selectedCharIndex]
  const chatIndex = Number.isInteger(character?.chatPage) ? character.chatPage : -1
  const chat = chatIndex >= 0 ? character?.chats?.[chatIndex] : undefined
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

  const readiness = resolveReadiness(db, character, chat, settings)
  const identity: ActiveChatGenerationSettingsIdentity = {
    selectedCharIndex,
    characterIndex: character ? selectedCharIndex : -1,
    chatIndex: chat ? chatIndex : -1,
    characterId: character?.chaId,
    chatId: nonEmptyString(chat?.id) ? chat.id : undefined,
  }

  return {
    db,
    identity,
    character,
    chat,
    settings,
    persona: findById(personas, settings?.personaId),
    modelPreset: findById(modelPresets, settings?.modelPresetId),
    promptPreset: findById(promptPresets, settings?.promptPresetId),
    effectiveAgentPresetId,
    agentPreset: findById(agentPresets, effectiveAgentPresetId),
    readiness,
    requiredSidebarToggles: readiness.requirements.sidebarToggles,
    displayedSidebarToggles: resolveDisplayedToggles(db, character, chat, settings),
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
    state = resolveActiveChatGenerationSettings()
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
    'personaId' | 'modelPresetId' | 'promptPresetId' | 'agentPresetId' | 'togglePresetId'
  >,
  state: ActiveChatGenerationSettingsState = resolveActiveChatGenerationSettings(),
): ChatGenerationSettings {
  return createActiveChatGenerationSettingsPatch(selection, state)
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
    'personaId' | 'modelPresetId' | 'promptPresetId' | 'agentPresetId' | 'togglePresetId'
  >,
  options: ActiveChatGenerationSettingsSaveOptions = {},
): boolean {
  return saveActiveChatGenerationSettingsPatch(selection, options)
}

export function saveActiveChatGenerationSettingsSelectionWithOutcome(
  selection: Pick<
    ActiveChatGenerationSettingsPatch,
    'personaId' | 'modelPresetId' | 'promptPresetId' | 'agentPresetId' | 'togglePresetId'
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
  const selectedPromptPreset = findById(promptPresets, settings?.promptPresetId)

  return resolveChatGenerationSettingsReadiness({
    settings,
    personas: safeArray<ChatGenerationPersonaReference>(
      db.personas as unknown as ChatGenerationPersonaReference[] | undefined,
    ),
    modelPresets,
    promptPresets,
    agentPresets: safeArray<ChatGenerationAgentPresetReference>(
      db.agentPresets as unknown as ChatGenerationAgentPresetReference[] | undefined,
    ),
    modules: safeArray<ChatGenerationModuleReference>(
      db.modules as unknown as ChatGenerationModuleReference[] | undefined,
    ),
    enabledModuleIds: stringArray(db.enabledModules),
    chatModuleIds: stringArray(chat?.modules),
    characterModuleIds: stringArray(character?.modules),
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
  const selectedPromptPreset = findById(promptPresets, settings?.promptPresetId)

  return resolveDisplayedSidebarToggles({
    modelPresetId: settings?.modelPresetId,
    promptPresetId: settings?.promptPresetId,
    modelPresets,
    promptPresets,
    modules: safeArray<ChatGenerationModuleReference>(
      db.modules as unknown as ChatGenerationModuleReference[] | undefined,
    ),
    enabledModuleIds: stringArray(db.enabledModules),
    chatModuleIds: stringArray(chat?.modules),
    characterModuleIds: stringArray(character?.modules),
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

function findById<T extends { id?: string | null }>(values: readonly T[], id: string | undefined): T | undefined {
  if (!nonEmptyString(id)) return undefined
  return values.find((value) => value.id === id)
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
