import { get } from 'svelte/store'
import {
  CHAT_GENERATION_SETTINGS_INCOMPLETE_MESSAGE,
  resolveChatGenerationSettingsReadiness,
  type ChatGenerationModuleReference,
  type ChatGenerationPersonaReference,
  type ChatGenerationPresetReference,
  type ChatGenerationRequiredSidebarToggle,
  type ChatGenerationSettings,
  type ChatGenerationSettingsMissingReason,
  type ChatGenerationSettingsReadiness,
} from './chatGenerationSettings'
import { dispatchSaveChatGenerationSettings } from './chatCommands'
import { language } from '../lang'
import type { ServerCommandTransportOptions } from './server/commands'
import { DBState, selectedCharID } from './stores.svelte'
import type { Chat, Database, character } from './storage/database.svelte'

type ActiveChatGenerationPresetReference = ChatGenerationPresetReference & {
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
  preset?: ChatGenerationPresetReference
  readiness: ChatGenerationSettingsReadiness
  requiredSidebarToggles: ChatGenerationRequiredSidebarToggle[]
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

export function resolveActiveChatGenerationSettings(
  options: ResolveActiveChatGenerationSettingsOptions = {},
): ActiveChatGenerationSettingsState {
  const db = options.db ?? DBState.db
  const selectedCharIndex = options.selectedCharIndex ?? get(selectedCharID)
  const characters = safeArray<character>(db.characters)
  const character = characters[selectedCharIndex]
  const chatIndex = Number.isInteger(character?.chatPage) ? character.chatPage : -1
  const chat = chatIndex >= 0 ? character?.chats?.[chatIndex] : undefined
  const settings = chat?.generationSettings
  const personas = safeArray<ChatGenerationPersonaReference>(
    db.personas as unknown as ChatGenerationPersonaReference[] | undefined,
  )
  const presets = safeArray<ActiveChatGenerationPresetReference>(
    db.botPresets as unknown as ActiveChatGenerationPresetReference[] | undefined,
  )

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
    preset: findById(presets, settings?.presetId),
    readiness,
    requiredSidebarToggles: readiness.requirements.sidebarToggles,
    staleSidebarToggleKeys: readiness.staleSidebarToggleKeys,
    missingLabels: createChatGenerationSettingsMissingLabels(
      readiness.missing,
      readiness.requirements.sidebarToggles,
    ),
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
    (reason) =>
      reason.code === 'sidebar_toggle_missing' || reason.code === 'sidebar_toggle_invalid',
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
  const isPresetSelection = nonEmptyString(patch.presetId)
  const next: ChatGenerationSettings = {
    ...cloneGenerationSettings(state.settings),
    ...scalarPatch,
    configured: true,
  }
  if (!hasOwn(next, 'jailbreakToggle')) {
    next.jailbreakToggle = false
  }

  const shouldWriteSidebarToggles =
    hasOwn(patch, 'sidebarToggles') || isPresetSelection || isRecord(state.settings?.sidebarToggles)
  if (shouldWriteSidebarToggles) {
    const mergedSidebarToggles = isRecord(state.settings?.sidebarToggles)
      ? { ...state.settings.sidebarToggles }
      : {}
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
  if (isPresetSelection) {
    return fillMissingDefaultSidebarToggles(state, pruned)
  }
  return pruned
}

export function createActiveChatGenerationSettingsSelectionPatch(
  selection: Pick<ActiveChatGenerationSettingsPatch, 'personaId' | 'presetId'>,
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
  options: ServerCommandTransportOptions = {},
): boolean {
  const state = resolveActiveChatGenerationSettings()
  const chatId = state.identity.chatId
  if (!chatId) return false
  return dispatchSaveChatGenerationSettings(
    chatId,
    createActiveChatGenerationSettingsPatch(patch, state),
    options,
  )
}

export function saveActiveChatGenerationSettings(
  generationSettings: ChatGenerationSettings,
  options: ServerCommandTransportOptions = {},
): boolean {
  const state = resolveActiveChatGenerationSettings()
  const chatId = state.identity.chatId
  if (!chatId) return false
  return dispatchSaveChatGenerationSettings(
    chatId,
    normalizeActiveChatGenerationSettingsForSave(state, generationSettings),
    options,
  )
}

export function saveActiveChatGenerationSettingsSelection(
  selection: Pick<ActiveChatGenerationSettingsPatch, 'personaId' | 'presetId'>,
  options: ServerCommandTransportOptions = {},
): boolean {
  return saveActiveChatGenerationSettingsPatch(selection, options)
}

export function saveActiveChatGenerationSettingsDefaultValues(
  options: ServerCommandTransportOptions = {},
): boolean {
  const state = resolveActiveChatGenerationSettings()
  const chatId = state.identity.chatId
  if (!chatId) return false
  return dispatchSaveChatGenerationSettings(
    chatId,
    createActiveChatGenerationSettingsDefaultValuesPatch(state),
    options,
  )
}

export function saveActiveChatJailbreakToggleGenerationSettings(
  jailbreakToggle: boolean,
  options: ServerCommandTransportOptions = {},
): boolean {
  return saveActiveChatGenerationSettingsPatch({ jailbreakToggle }, options)
}

export function saveActiveChatSidebarToggleGenerationSettings(
  key: string,
  value: string,
  options: ServerCommandTransportOptions = {},
): boolean {
  return saveActiveChatGenerationSettingsPatch({ sidebarToggles: { [key]: value } }, options)
}

function resolveReadiness(
  db: Database,
  character: character | undefined,
  chat: Chat | undefined,
  settings: ChatGenerationSettings | undefined,
): ChatGenerationSettingsReadiness {
  const presets = safeArray<ActiveChatGenerationPresetReference>(
    db.botPresets as unknown as ActiveChatGenerationPresetReference[] | undefined,
  )
  const selectedPreset = findById(presets, settings?.presetId)

  return resolveChatGenerationSettingsReadiness({
    settings,
    personas: safeArray<ChatGenerationPersonaReference>(
      db.personas as unknown as ChatGenerationPersonaReference[] | undefined,
    ),
    presets,
    modules: safeArray<ChatGenerationModuleReference>(
      db.modules as unknown as ChatGenerationModuleReference[] | undefined,
    ),
    enabledModuleIds: stringArray(db.enabledModules),
    chatModuleIds: stringArray(chat?.modules),
    characterModuleIds: stringArray(character?.modules),
    moduleIntegration:
      typeof selectedPreset?.moduleIntergration === 'string'
        ? selectedPreset.moduleIntergration
        : null,
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

function createDefaultSidebarToggleValues(
  state: ActiveChatGenerationSettingsState,
): Record<string, string> {
  const readiness = resolveReadiness(state.db, state.character, state.chat, state.settings)
  return Object.fromEntries(
    readiness.requirements.sidebarToggles.map((toggle) => [
      toggle.key,
      defaultSidebarToggleValue(toggle),
    ]),
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
  return pruneStaleSidebarToggleKeys(state, next)
}

function cloneGenerationSettings(
  settings: ChatGenerationSettings | undefined,
): ChatGenerationSettings {
  if (!settings) return {}
  const clone: ChatGenerationSettings = {}
  if (hasOwn(settings, 'configured')) clone.configured = settings.configured
  if (hasOwn(settings, 'personaId')) clone.personaId = settings.personaId
  if (hasOwn(settings, 'presetId')) clone.presetId = settings.presetId
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
    case 'preset_id_missing':
    case 'preset_missing':
      return 'Preset'
    case 'jailbreak_toggle_missing':
    case 'jailbreak_toggle_invalid':
      return 'Jailbreak toggle'
    case 'sidebar_toggles_missing':
      return hasSpecificSidebarToggleReason ? null : 'Sidebar toggles'
    case 'sidebar_toggle_missing':
    case 'sidebar_toggle_invalid':
      return (
        requiredSidebarToggles.find((toggle) => toggle.key === reason.toggleKey)?.label ??
        reason.toggleKey
      )
  }
}

function findById<T extends { id?: string | null }>(
  values: readonly T[],
  id: string | undefined,
): T | undefined {
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
