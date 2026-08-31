import {
  createActiveChatGenerationSettingsPatch,
  resolveActiveChatGenerationSettings,
  saveActiveChatGenerationSettingsWithOutcome,
  type ActiveChatGenerationSettingsSaveOptions,
} from './activeChatGenerationSettings'
import {
  cloneChatGenerationTogglePresetList,
  normalizeChatGenerationTogglePresets,
  type ChatGenerationTogglePreset,
} from './chatGenerationTogglePresetRecords'
import {
  captureCurrentSidebarToggleKinds,
  captureCurrentSidebarToggleValues,
  createSidebarToggleValuesForActiveChat,
} from './chatGenerationTogglePresetPlanning'
import { applyServerBackedSettingsPatch } from './server/settingsBridge.svelte'
import { settingsResourceState } from './server/resourceState.svelte'
import { isActiveChatTargetFresh } from './chatCommands'
import type { ChatGenerationSettingsSaveOperation } from './chatCommands'
import { createNonSecurityUuid } from './nonSecurityUuid'

const CHAT_GENERATION_TOGGLE_PRESETS_FIELD = 'chatGenerationTogglePresets' as const

export type { ChatGenerationTogglePreset }
export {
  compareChatGenerationTogglePresetToActiveState,
  createChatGenerationTogglePresetPickValues,
  getChatGenerationTogglePresetPickEligibility,
  sortChatGenerationTogglePresetsBySimilarity,
} from './chatGenerationTogglePresetPlanning'
export type {
  ChatGenerationTogglePresetComparison,
  ChatGenerationTogglePresetPickEligibility,
  ChatGenerationToggleSimilarityToggle,
} from './chatGenerationTogglePresetPlanning'

export function getChatGenerationTogglePresets(): ChatGenerationTogglePreset[] {
  const status = settingsResourceState.groupStatuses.sidebar
  if (settingsResourceState.status === 'error' || status === 'error') return []
  if (status === 'ready') {
    return normalizeStableTogglePresetOwner(settingsResourceState.value.chatGenerationTogglePresets)
  }
  return []
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
  return applyChatGenerationTogglePresetWithOutcome(presetId, options) !== null
}

export function applyChatGenerationTogglePresetWithOutcome(
  presetId: string,
  options: Pick<ActiveChatGenerationSettingsSaveOptions, 'expectedTarget'> = {},
): ChatGenerationSettingsSaveOperation | null {
  if (options.expectedTarget !== undefined && !isActiveChatTargetFresh(options.expectedTarget)) return null

  const preset = getChatGenerationTogglePresets().find((candidate) => candidate.id === presetId)
  if (!preset) return null

  const state = resolveActiveChatGenerationSettings()
  if (!state.identity.chatId) return null

  const generationSettings = createActiveChatGenerationSettingsPatch(
    {
      sidebarToggles: createSidebarToggleValuesForActiveChat(preset, state),
    },
    state,
  )
  return saveActiveChatGenerationSettingsWithOutcome(generationSettings, options)
}

export function deleteChatGenerationTogglePreset(presetId: string): boolean {
  const presets = getChatGenerationTogglePresets()
  const next = presets.filter((preset) => preset.id !== presetId)
  if (next.length === presets.length) return false
  writeChatGenerationTogglePresets(next)
  return true
}

export function renameChatGenerationTogglePreset(presetId: string, name: string): boolean {
  const trimmedName = name.trim()
  if (!trimmedName) return false
  const presets = getChatGenerationTogglePresets()
  const presetIndex = presets.findIndex((preset) => preset.id === presetId)
  if (presetIndex < 0 || presets[presetIndex].name === trimmedName) return false
  const nextPresets = presets.slice()
  nextPresets[presetIndex] = { ...presets[presetIndex], name: trimmedName, updatedAt: Date.now() }
  writeChatGenerationTogglePresets(nextPresets)
  return true
}

function writeChatGenerationTogglePresets(presets: readonly ChatGenerationTogglePreset[]): void {
  applyServerBackedSettingsPatch({
    [CHAT_GENERATION_TOGGLE_PRESETS_FIELD]: cloneChatGenerationTogglePresetList(presets),
  })
}

function normalizeStableTogglePresetOwner(value: unknown): ChatGenerationTogglePreset[] {
  if (!Array.isArray(value)) return []
  const normalized = normalizeChatGenerationTogglePresets(value)
  return normalized.length === value.length ? normalized : []
}
