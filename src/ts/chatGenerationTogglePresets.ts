import {
  createActiveChatGenerationSettingsPatch,
  resolveActiveChatGenerationSettings,
  saveActiveChatGenerationSettings,
  type ActiveChatGenerationSettingsSaveOptions,
  type ActiveChatGenerationSettingsState,
} from './activeChatGenerationSettings'
import type {
  ChatGenerationRequiredSidebarToggle,
  ChatGenerationSettings,
  ChatGenerationSidebarToggleKind,
} from './chatGenerationSettings'
import {
  cloneChatGenerationTogglePresetList,
  normalizeChatGenerationTogglePresets,
  type ChatGenerationTogglePreset,
} from './chatGenerationTogglePresetRecords'
import { applyServerBackedSettingsPatch } from './server/settingsBridge.svelte'
import { getResourceDatabase as getDatabase } from './server/resourceState.svelte'
import { isActiveChatTargetFresh } from './chatCommands'
import { createNonSecurityUuid } from './nonSecurityUuid'

const CHAT_GENERATION_TOGGLE_PRESETS_FIELD = 'chatGenerationTogglePresets' as const

export type { ChatGenerationTogglePreset }

export interface ChatGenerationTogglePresetComparison {
  hasAnyDifference: boolean
  hasToggleTypeMismatch: boolean
  jailbreakToggleDiffers: boolean
  differingSidebarToggleKeys: ReadonlySet<string>
  missingSidebarToggleKeys: readonly string[]
  staleSidebarToggleKeys: readonly string[]
  kindMismatchSidebarToggleKeys: readonly string[]
}

export function getChatGenerationTogglePresets(): ChatGenerationTogglePreset[] {
  return normalizeChatGenerationTogglePresets(getDatabase().chatGenerationTogglePresets)
}

export function saveCurrentChatGenerationTogglePreset(
  name: string,
  options: Pick<ActiveChatGenerationSettingsSaveOptions, 'expectedTarget'> = {},
): ChatGenerationTogglePreset | null {
  const trimmedName = name.trim()
  if (!trimmedName) return null

  if (options.expectedTarget !== undefined && !isActiveChatTargetFresh(options.expectedTarget)) return null

  const state = resolveActiveChatGenerationSettings()
  if (!state.identity.chatId) return null

  const now = Date.now()
  const preset: ChatGenerationTogglePreset = {
    id: createNonSecurityUuid(),
    name: trimmedName,
    createdAt: now,
    updatedAt: now,
    jailbreakToggle: state.settings?.jailbreakToggle === true,
    sidebarToggles: captureCurrentSidebarToggleValues(state),
    sidebarToggleKinds: captureCurrentSidebarToggleKinds(state),
  }

  writeChatGenerationTogglePresets([...getChatGenerationTogglePresets(), preset])
  return preset
}

export function overwriteCurrentChatGenerationTogglePreset(
  presetId: string,
  options: Pick<ActiveChatGenerationSettingsSaveOptions, 'expectedTarget'> = {},
): ChatGenerationTogglePreset | null {
  const presets = getChatGenerationTogglePresets()
  const presetIndex = presets.findIndex((preset) => preset.id === presetId)
  if (presetIndex < 0) return null

  if (options.expectedTarget !== undefined && !isActiveChatTargetFresh(options.expectedTarget)) return null

  const state = resolveActiveChatGenerationSettings()
  if (!state.identity.chatId) return null

  const nextPreset: ChatGenerationTogglePreset = {
    ...presets[presetIndex],
    updatedAt: Date.now(),
    jailbreakToggle: state.settings?.jailbreakToggle === true,
    sidebarToggles: captureCurrentSidebarToggleValues(state),
    sidebarToggleKinds: captureCurrentSidebarToggleKinds(state),
  }
  const nextPresets = presets.slice()
  nextPresets[presetIndex] = nextPreset
  writeChatGenerationTogglePresets(nextPresets)
  return nextPreset
}

export function applyChatGenerationTogglePreset(
  presetId: string,
  options: Pick<ActiveChatGenerationSettingsSaveOptions, 'expectedTarget'> = {},
): boolean {
  if (options.expectedTarget !== undefined && !isActiveChatTargetFresh(options.expectedTarget)) return false

  const preset = getChatGenerationTogglePresets().find((candidate) => candidate.id === presetId)
  if (!preset) return false

  const state = resolveActiveChatGenerationSettings()
  if (!state.identity.chatId) return false

  const generationSettings = createActiveChatGenerationSettingsPatch(
    {
      jailbreakToggle: preset.jailbreakToggle,
      sidebarToggles: createSidebarToggleValuesForActiveChat(preset, state),
    },
    state,
  )
  return saveActiveChatGenerationSettings(generationSettings, options)
}

export function deleteChatGenerationTogglePreset(presetId: string): boolean {
  const presets = getChatGenerationTogglePresets()
  const next = presets.filter((preset) => preset.id !== presetId)
  if (next.length === presets.length) return false
  writeChatGenerationTogglePresets(next)
  return true
}

export function compareChatGenerationTogglePresetToActiveState(
  preset: ChatGenerationTogglePreset,
  state: ActiveChatGenerationSettingsState,
): ChatGenerationTogglePresetComparison {
  const currentSidebarToggleValues = captureCurrentSidebarToggleValues(state)
  const currentSidebarToggleKinds = captureCurrentSidebarToggleKinds(state)
  const currentSidebarToggleKeys = state.requiredSidebarToggles.map((toggle) => toggle.key)
  const currentSidebarToggleKeySet = new Set(currentSidebarToggleKeys)
  const savedSidebarToggleKeys = new Set([
    ...Object.keys(preset.sidebarToggles),
    ...Object.keys(preset.sidebarToggleKinds),
  ])
  const differingSidebarToggleKeys = new Set<string>()
  const missingSidebarToggleKeys: string[] = []
  const kindMismatchSidebarToggleKeys: string[] = []

  for (const key of currentSidebarToggleKeys) {
    const hasSavedValue = Object.hasOwn(preset.sidebarToggles, key)
    if (!hasSavedValue) {
      missingSidebarToggleKeys.push(key)
      differingSidebarToggleKeys.add(key)
      continue
    }

    const savedKind = preset.sidebarToggleKinds[key]
    const currentKind = currentSidebarToggleKinds[key]
    if (savedKind !== undefined && savedKind !== currentKind) {
      kindMismatchSidebarToggleKeys.push(key)
      differingSidebarToggleKeys.add(key)
      continue
    }

    if (preset.sidebarToggles[key] !== currentSidebarToggleValues[key]) {
      differingSidebarToggleKeys.add(key)
    }
  }

  const staleSidebarToggleKeys = [...savedSidebarToggleKeys].filter((key) => !currentSidebarToggleKeySet.has(key))
  const jailbreakToggleDiffers =
    state.readiness.requirements.jailbreakToggle.displayed &&
    preset.jailbreakToggle !== (state.settings?.jailbreakToggle === true)
  const hasToggleTypeMismatch =
    missingSidebarToggleKeys.length > 0 || staleSidebarToggleKeys.length > 0 || kindMismatchSidebarToggleKeys.length > 0

  return {
    hasAnyDifference:
      jailbreakToggleDiffers || differingSidebarToggleKeys.size > 0 || staleSidebarToggleKeys.length > 0,
    hasToggleTypeMismatch,
    jailbreakToggleDiffers,
    differingSidebarToggleKeys,
    missingSidebarToggleKeys,
    staleSidebarToggleKeys,
    kindMismatchSidebarToggleKeys,
  }
}

function writeChatGenerationTogglePresets(presets: readonly ChatGenerationTogglePreset[]): void {
  applyServerBackedSettingsPatch({
    [CHAT_GENERATION_TOGGLE_PRESETS_FIELD]: cloneChatGenerationTogglePresetList(presets),
  })
}

function captureCurrentSidebarToggleValues(state: ActiveChatGenerationSettingsState): Record<string, string> {
  const current = state.settings?.sidebarToggles ?? {}
  return Object.fromEntries(
    state.requiredSidebarToggles.map((toggle) => [
      toggle.key,
      typeof current[toggle.key] === 'string' ? current[toggle.key] : defaultSidebarToggleValue(toggle),
    ]),
  )
}

function captureCurrentSidebarToggleKinds(
  state: ActiveChatGenerationSettingsState,
): Record<string, ChatGenerationSidebarToggleKind> {
  return Object.fromEntries(state.requiredSidebarToggles.map((toggle) => [toggle.key, toggle.kind]))
}

function createSidebarToggleValuesForActiveChat(
  preset: ChatGenerationTogglePreset,
  state: ActiveChatGenerationSettingsState,
): NonNullable<ChatGenerationSettings['sidebarToggles']> {
  return Object.fromEntries(
    state.requiredSidebarToggles.map((toggle) => [
      toggle.key,
      typeof preset.sidebarToggles[toggle.key] === 'string'
        ? preset.sidebarToggles[toggle.key]
        : defaultSidebarToggleValue(toggle),
    ]),
  )
}

function defaultSidebarToggleValue(toggle: ChatGenerationRequiredSidebarToggle): string {
  if (toggle.kind === 'text' || toggle.kind === 'textarea') return ''
  return '0'
}
