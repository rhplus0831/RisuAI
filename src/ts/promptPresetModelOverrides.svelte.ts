import { untrack } from 'svelte'
import {
  databaseKeyForModelPresetField,
  PROMPT_PRESET_MODEL_PARAMETER_OVERRIDE_FIELDS,
  PROMPT_PRESET_MODEL_PARAMETERS_OVERRIDE_KEY,
  promptPresetModelOverrideFieldForDatabaseKey,
  promptPresetOverridesModelParameters,
} from './presetSplit'
import { collectionsResourceState, settingsResourceState } from './server/resourceState.svelte'
import { SERVER_SETTINGS_GROUP_BY_KEY } from './server/settingsGroups'
import { updatePromptPreset, type PromptPreset } from './storage/database.svelte'

type OverrideGroup = 'parameters'

const PROMPT_PRESET_MODEL_OVERRIDE_GROUPS = {
  parameters: {
    flagKey: PROMPT_PRESET_MODEL_PARAMETERS_OVERRIDE_KEY,
    fields: PROMPT_PRESET_MODEL_PARAMETER_OVERRIDE_FIELDS,
  },
} as const

export interface PromptPresetModelOverrideDraft<T> {
  value: T
}

export interface PromptPresetModelOverrideMirrorTarget {
  databaseKey: string
  presetField: string
  presetId: string
}

interface PromptPresetOwnerSnapshot {
  presets: ReadonlyArray<Record<string, unknown>>
  selectedIndex: number
}

interface SettingsOwnerValueSnapshot {
  available: boolean
  value: unknown
}

export function promptPresetModelOverrideEnabled(group: OverrideGroup): boolean {
  const preset = selectedPromptPreset()
  const enabledByGroup: Record<OverrideGroup, boolean> = {
    parameters: promptPresetOverridesModelParameters(preset),
  }
  return enabledByGroup[group]
}

export function setPromptPresetModelOverrideEnabled(group: OverrideGroup, enabled: boolean): void {
  const selected = selectedPromptPresetEntry()
  if (!selected) return
  const { index: selectedIndex, preset } = selected

  const { flagKey, fields } = PROMPT_PRESET_MODEL_OVERRIDE_GROUPS[group]
  const patch: Record<string, unknown> = { [flagKey]: enabled }

  if (enabled) {
    for (const field of fields) {
      if (Object.prototype.hasOwnProperty.call(preset, field)) continue
      const databaseKey = databaseKeyForModelPresetField(field)
      const owner = currentSettingsOwnerValueSnapshot(databaseKey)
      if (!owner.available) return
      const value = owner.value
      if (value !== undefined) patch[field] = cloneJsonValue(value)
    }
  }

  updatePromptPreset(selectedIndex, patch as Partial<PromptPreset>)
}

export function createPromptPresetModelOverrideDraft<T>(
  databaseKey: string,
  fallback: T,
): PromptPresetModelOverrideDraft<T> {
  if (!promptPresetModelOverrideFieldForDatabaseKey(databaseKey)) {
    throw new Error(`Unsupported prompt preset model override field: ${databaseKey}`)
  }

  const initialValue = currentPromptPresetModelOverrideValue(databaseKey, fallback)
  const draft = $state<PromptPresetModelOverrideDraft<T>>({ value: cloneJsonValue(initialValue) })
  let initialized = false
  let suppressDraftDispatch = false
  let previousServerSnapshot = snapshotJson(initialValue)
  let previousDraftDispatchSnapshot = snapshotJson(initialValue)

  $effect(() => {
    const serverValue = currentPromptPresetModelOverrideValue(databaseKey, fallback)
    const serverSnapshot = snapshotJson(serverValue)
    const draftSnapshot = snapshotJson(draft.value)

    if (serverSnapshot !== previousServerSnapshot && serverSnapshot !== draftSnapshot) {
      suppressDraftDispatch = true
      previousDraftDispatchSnapshot = serverSnapshot
      draft.value = cloneJsonValue(serverValue)
      queueMicrotask(() => {
        suppressDraftDispatch = false
      })
    }

    previousServerSnapshot = serverSnapshot
  })

  $effect(() => {
    const snapshot = snapshotJson(draft.value)
    if (!initialized) {
      initialized = true
      previousDraftDispatchSnapshot = snapshot
      return
    }
    if (suppressDraftDispatch) {
      previousDraftDispatchSnapshot = snapshot
      return
    }
    if (snapshot === previousDraftDispatchSnapshot) return
    previousDraftDispatchSnapshot = snapshot

    untrack(() => {
      const attempted = cloneJsonValue(draft.value)
      const target = resolvePromptPresetModelOverrideMirrorTarget(databaseKey)
      if (!target) return
      // updatePromptPreset owns the durable stable-id queue and its selected
      // settings optimistic projection, so a second raw aggregate write here
      // would sit outside queued/failure rollback ownership.
      mirrorPromptPresetModelOverrideFieldToTarget(target, attempted)
      previousServerSnapshot = snapshot
    })
  })

  return draft
}

export function currentPromptPresetModelOverrideValue<T>(databaseKey: string, fallback: T): T {
  const presetField = promptPresetModelOverrideFieldForDatabaseKey(databaseKey)
  const preset = selectedPromptPreset()
  if (presetField && preset && Object.prototype.hasOwnProperty.call(preset, presetField)) {
    return cloneJsonValue(preset[presetField]) as T
  }
  const value = currentSettingsOwnerValue(databaseKey)
  return value === undefined ? fallback : (cloneJsonValue(value) as T)
}

export function mirrorPromptPresetModelOverrideField(databaseKey: string, value: unknown): boolean {
  const target = resolvePromptPresetModelOverrideMirrorTarget(databaseKey)
  return target ? mirrorPromptPresetModelOverrideFieldToTarget(target, value) : false
}

/** Capture the prompt-preset identity for a delayed renderer write. */
export function resolvePromptPresetModelOverrideMirrorTarget(
  databaseKey: string,
): PromptPresetModelOverrideMirrorTarget | null {
  const presetField = promptPresetModelOverrideFieldForDatabaseKey(databaseKey)
  if (!presetField) return null
  const selected = selectedPromptPresetEntry()
  if (!selected) return null
  return { databaseKey, presetField, presetId: selected.preset.id as string }
}

export function currentPromptPresetModelOverrideMirrorValue(target: PromptPresetModelOverrideMirrorTarget): unknown {
  const preset = uniquePromptPresetById(target.presetId)
  if (!preset) return undefined
  if (Object.prototype.hasOwnProperty.call(preset, target.presetField)) {
    return cloneJsonValue(preset[target.presetField])
  }
  return cloneJsonValue(currentSettingsOwnerValue(target.databaseKey))
}

export function mirrorPromptPresetModelOverrideFieldToTarget(
  target: PromptPresetModelOverrideMirrorTarget,
  value: unknown,
): boolean {
  if (value === undefined) return false
  const selected = uniquePromptPresetEntryById(target.presetId)
  if (!selected) return false
  const { index, preset } = selected
  if (snapshotJson(preset[target.presetField]) === snapshotJson(value)) return false
  updatePromptPreset(index, { [target.presetField]: cloneJsonValue(value) } as Partial<PromptPreset>)
  return true
}

export function updateSelectedPromptPresetField(presetField: string, value: unknown): boolean {
  const selected = selectedPromptPresetEntry()
  if (!selected) return false
  const { index: selectedIndex, preset } = selected
  if (snapshotJson(preset[presetField]) === snapshotJson(value)) return false
  updatePromptPreset(selectedIndex, { [presetField]: cloneJsonValue(value) } as Partial<PromptPreset>)
  return true
}

function selectedPromptPreset(): Record<string, unknown> | undefined {
  return selectedPromptPresetEntry()?.preset
}

function selectedPromptPresetEntry(): { index: number; preset: Record<string, unknown> } | undefined {
  const owner = currentPromptPresetOwnerSnapshot()
  if (!owner) return undefined
  const { presets, selectedIndex } = owner
  const preset = presets?.[selectedIndex] as Record<string, unknown> | undefined
  if (!preset || typeof preset.id !== 'string' || preset.id.trim() === '') return undefined
  const matches = presets.filter((candidate) => candidate?.id === preset.id)
  return matches.length === 1 ? { index: selectedIndex, preset } : undefined
}

function uniquePromptPresetEntryById(presetId: string): { index: number; preset: Record<string, unknown> } | undefined {
  const presets = currentPromptPresetCollectionOwner()
  if (!presets || !presetId.trim()) return undefined
  const matches = presets
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate }) => candidate?.id === presetId)
  if (matches.length !== 1) return undefined
  return { index: matches[0].index, preset: matches[0].candidate as Record<string, unknown> }
}

function uniquePromptPresetById(presetId: string): Record<string, unknown> | undefined {
  return uniquePromptPresetEntryById(presetId)?.preset
}

function currentPromptPresetOwnerSnapshot(): PromptPresetOwnerSnapshot | null {
  const presets = currentPromptPresetCollectionOwner()
  const selectedIndex = currentPromptPresetSelectionOwner()
  if (!presets || selectedIndex === null || selectedIndex < 0 || selectedIndex >= presets.length) return null
  return { presets, selectedIndex }
}

function currentPromptPresetCollectionOwner(): PromptPresetOwnerSnapshot['presets'] | null {
  const status = collectionsResourceState.statuses.promptPresets
  if (collectionsResourceState.status === 'error' || status !== 'ready') return null

  const value = collectionsResourceState.values.promptPresets
  if (!Array.isArray(value)) return null
  return value as ReadonlyArray<Record<string, unknown>>
}

function currentPromptPresetSelectionOwner(): number | null {
  const status = settingsResourceState.standaloneStatuses.promptPresetsId
  if (settingsResourceState.status === 'error' || status !== 'ready') return null

  const value = settingsResourceState.value.promptPresetsId
  return Number.isInteger(value) ? (value as number) : null
}

function currentSettingsOwnerValue(key: string): unknown {
  const snapshot = currentSettingsOwnerValueSnapshot(key)
  return snapshot.available ? snapshot.value : undefined
}

function currentSettingsOwnerValueSnapshot(key: string): SettingsOwnerValueSnapshot {
  const group = SERVER_SETTINGS_GROUP_BY_KEY[key]
  const status = group ? settingsResourceState.groupStatuses[group] : settingsResourceState.status
  if (settingsResourceState.status === 'error' || status === 'error') return { available: false, value: undefined }
  if (status === 'ready') {
    return { available: true, value: (settingsResourceState.value as Record<string, unknown>)[key] }
  }
  return { available: false, value: undefined }
}

function snapshotJson(value: unknown): string {
  const snapshot = JSON.stringify(value)
  return snapshot === undefined ? '__undefined__' : snapshot
}

function cloneJsonValue<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}
