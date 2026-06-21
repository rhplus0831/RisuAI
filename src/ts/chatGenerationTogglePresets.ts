import {
  createActiveChatGenerationSettingsPatch,
  resolveActiveChatGenerationSettings,
  saveActiveChatGenerationSettings,
  type ActiveChatGenerationSettingsState,
} from './activeChatGenerationSettings'
import type { ChatGenerationRequiredSidebarToggle, ChatGenerationSettings } from './chatGenerationSettings'
import {
  cloneChatGenerationTogglePresetList,
  normalizeChatGenerationTogglePresets,
  type ChatGenerationTogglePreset,
} from './chatGenerationTogglePresetRecords'
import { applyServerBackedSettingsPatch } from './server/settingsBridge.svelte'
import { DBState } from './stores.svelte'

const CHAT_GENERATION_TOGGLE_PRESETS_FIELD = 'chatGenerationTogglePresets' as const

export type { ChatGenerationTogglePreset }

export function getChatGenerationTogglePresets(): ChatGenerationTogglePreset[] {
  return normalizeChatGenerationTogglePresets(DBState.db.chatGenerationTogglePresets)
}

export function saveCurrentChatGenerationTogglePreset(name: string): ChatGenerationTogglePreset | null {
  const trimmedName = name.trim()
  if (!trimmedName) return null

  const state = resolveActiveChatGenerationSettings()
  if (!state.identity.chatId) return null

  const now = Date.now()
  const preset: ChatGenerationTogglePreset = {
    id: crypto.randomUUID(),
    name: trimmedName,
    createdAt: now,
    updatedAt: now,
    jailbreakToggle: state.settings?.jailbreakToggle === true,
    sidebarToggles: captureCurrentSidebarToggleValues(state),
  }

  writeChatGenerationTogglePresets([...getChatGenerationTogglePresets(), preset])
  return preset
}

export function applyChatGenerationTogglePreset(presetId: string): boolean {
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
  return saveActiveChatGenerationSettings(generationSettings)
}

export function deleteChatGenerationTogglePreset(presetId: string): boolean {
  const presets = getChatGenerationTogglePresets()
  const next = presets.filter((preset) => preset.id !== presetId)
  if (next.length === presets.length) return false
  writeChatGenerationTogglePresets(next)
  return true
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
