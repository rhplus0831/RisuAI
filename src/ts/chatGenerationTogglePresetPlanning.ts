import type {
  ChatGenerationRequiredSidebarToggle,
  ChatGenerationSettings,
  ChatGenerationSidebarToggleKind,
} from './chatGenerationSettings'
import type { ChatGenerationTogglePreset } from './chatGenerationTogglePresetRecords'

export type { ChatGenerationTogglePreset }

export interface ChatGenerationTogglePresetActiveState {
  settings?: Pick<ChatGenerationSettings, 'sidebarToggles'>
  requiredSidebarToggles: readonly ChatGenerationRequiredSidebarToggle[]
}

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

export function compareChatGenerationTogglePresetToActiveState(
  preset: ChatGenerationTogglePreset,
  state: ChatGenerationTogglePresetActiveState,
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

export function createSidebarToggleValuesForActiveChat(
  preset: ChatGenerationTogglePreset,
  state: ChatGenerationTogglePresetActiveState,
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

export function captureCurrentSidebarToggleValues(
  state: ChatGenerationTogglePresetActiveState,
): Record<string, string> {
  const current = state.settings?.sidebarToggles ?? {}
  return Object.fromEntries(
    state.requiredSidebarToggles.map((toggle) => [
      toggle.key,
      typeof current[toggle.key] === 'string' ? current[toggle.key] : defaultSidebarToggleValue(toggle),
    ]),
  )
}

export function captureCurrentSidebarToggleKinds(
  state: ChatGenerationTogglePresetActiveState,
): Record<string, ChatGenerationSidebarToggleKind> {
  return Object.fromEntries(state.requiredSidebarToggles.map((toggle) => [toggle.key, toggle.kind]))
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
