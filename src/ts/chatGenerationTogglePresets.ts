import {
  createActiveChatGenerationSettingsPatch,
  resolveActiveChatGenerationSettings,
  saveActiveChatGenerationSettingsWithOutcome,
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
import type { ChatGenerationSettingsSaveOperation } from './chatCommands'
import { createNonSecurityUuid } from './nonSecurityUuid'

const CHAT_GENERATION_TOGGLE_PRESETS_FIELD = 'chatGenerationTogglePresets' as const

export type { ChatGenerationTogglePreset }

export interface ChatGenerationTogglePresetComparison {
  hasAnyDifference: boolean
  hasToggleTypeMismatch: boolean
  differingSidebarToggleKeys: ReadonlySet<string>
  missingSidebarToggleKeys: readonly string[]
  staleSidebarToggleKeys: readonly string[]
  kindMismatchSidebarToggleKeys: readonly string[]
}

export interface ChatGenerationToggleSimilarityToggle {
  key: string
  kind: ChatGenerationSidebarToggleKind
  value: string
}

export interface ChatGenerationTogglePresetPickEligibility {
  eligible: boolean
  missingSidebarToggleKeys: readonly string[]
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
  const hasToggleTypeMismatch =
    missingSidebarToggleKeys.length > 0 || staleSidebarToggleKeys.length > 0 || kindMismatchSidebarToggleKeys.length > 0

  return {
    hasAnyDifference: differingSidebarToggleKeys.size > 0 || staleSidebarToggleKeys.length > 0,
    hasToggleTypeMismatch,
    differingSidebarToggleKeys,
    missingSidebarToggleKeys,
    staleSidebarToggleKeys,
    kindMismatchSidebarToggleKeys,
  }
}

export function sortChatGenerationTogglePresetsBySimilarity(
  presets: readonly ChatGenerationTogglePreset[],
  currentToggles: readonly ChatGenerationToggleSimilarityToggle[],
): ChatGenerationTogglePreset[] {
  const currentKeySet = new Set(currentToggles.map((toggle) => toggle.key))
  const currentActiveCount = countActiveCurrentToggles(currentToggles)

  return [...presets].sort((left, right) => {
    const similarityDifference =
      jaccardSimilarity(presetKeySet(right), currentKeySet) - jaccardSimilarity(presetKeySet(left), currentKeySet)
    if (similarityDifference !== 0) return similarityDifference

    const leftActiveDifference = Math.abs(countActivePresetToggles(left) - currentActiveCount)
    const rightActiveDifference = Math.abs(countActivePresetToggles(right) - currentActiveCount)
    if (leftActiveDifference !== rightActiveDifference) return leftActiveDifference - rightActiveDifference
    if (left.updatedAt !== right.updatedAt) return right.updatedAt - left.updatedAt
    return left.name < right.name ? -1 : left.name > right.name ? 1 : 0
  })
}

export function getChatGenerationTogglePresetPickEligibility(
  preset: ChatGenerationTogglePreset,
  sourceToggles: readonly Pick<ChatGenerationRequiredSidebarToggle, 'key' | 'kind'>[],
): ChatGenerationTogglePresetPickEligibility {
  const missingSidebarToggleKeys: string[] = []
  const kindMismatchSidebarToggleKeys: string[] = []

  for (const toggle of sourceToggles) {
    if (!Object.hasOwn(preset.sidebarToggles, toggle.key)) {
      missingSidebarToggleKeys.push(toggle.key)
      continue
    }
    const savedKind = preset.sidebarToggleKinds[toggle.key]
    if (savedKind !== undefined && savedKind !== toggle.kind) {
      kindMismatchSidebarToggleKeys.push(toggle.key)
    }
  }

  return {
    eligible: missingSidebarToggleKeys.length === 0 && kindMismatchSidebarToggleKeys.length === 0,
    missingSidebarToggleKeys,
    kindMismatchSidebarToggleKeys,
  }
}

export function createChatGenerationTogglePresetPickValues(
  preset: ChatGenerationTogglePreset,
  sourceToggles: readonly Pick<ChatGenerationRequiredSidebarToggle, 'key' | 'kind'>[],
): Record<string, string> | null {
  if (!getChatGenerationTogglePresetPickEligibility(preset, sourceToggles).eligible) return null
  return Object.fromEntries(sourceToggles.map((toggle) => [toggle.key, preset.sidebarToggles[toggle.key]]))
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

function presetKeySet(preset: ChatGenerationTogglePreset): Set<string> {
  return new Set(Object.keys(preset.sidebarToggles))
}

function jaccardSimilarity(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  const union = new Set([...left, ...right])
  if (union.size === 0) return 1
  let intersectionSize = 0
  for (const key of left) {
    if (right.has(key)) intersectionSize += 1
  }
  return intersectionSize / union.size
}

function countActivePresetToggles(preset: ChatGenerationTogglePreset): number {
  let count = 0
  for (const [key, value] of Object.entries(preset.sidebarToggles)) {
    if (preset.sidebarToggleKinds[key] === 'boolean' && value === '1') count += 1
  }
  return count
}

function countActiveCurrentToggles(toggles: readonly ChatGenerationToggleSimilarityToggle[]): number {
  return toggles.filter((toggle) => toggle.kind === 'boolean' && toggle.value === '1').length
}
