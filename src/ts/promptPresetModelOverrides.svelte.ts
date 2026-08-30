import { untrack } from 'svelte'
import {
  databaseKeyForModelPresetField,
  PROMPT_PRESET_MODEL_PARAMETER_OVERRIDE_FIELDS,
  PROMPT_PRESET_MODEL_PARAMETERS_OVERRIDE_KEY,
  promptPresetModelOverrideFieldForDatabaseKey,
  promptPresetOverridesModelParameters,
} from './presetSplit'
import { getDatabase, updatePromptPreset, type PromptPreset } from './storage/database.svelte'
import { withTrustedResourceWrite } from './server/resourceWriteGuard.svelte'

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
    const db = getDatabase() as unknown as Record<string, unknown>
    for (const field of fields) {
      if (Object.prototype.hasOwnProperty.call(preset, field)) continue
      const databaseKey = databaseKeyForModelPresetField(field)
      const value = db[databaseKey]
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
      withTrustedResourceWrite(() => {
        const database = getDatabase() as unknown as Record<string, unknown>
        database[databaseKey] = attempted
      })
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
  const value = (getDatabase() as unknown as Record<string, unknown> | undefined)?.[databaseKey]
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
  const selectedIndex = getDatabase().promptPresetsId
  const selected = selectedPromptPresetEntry()
  if (!selected || selected.index !== selectedIndex) return null
  return { databaseKey, presetField, presetId: selected.preset.id as string }
}

export function currentPromptPresetModelOverrideMirrorValue(target: PromptPresetModelOverrideMirrorTarget): unknown {
  const preset = uniquePromptPresetById(target.presetId)
  if (!preset) return undefined
  if (Object.prototype.hasOwnProperty.call(preset, target.presetField)) {
    return cloneJsonValue(preset[target.presetField])
  }
  return cloneJsonValue((getDatabase() as unknown as Record<string, unknown>)[target.databaseKey])
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
  const selectedIndex = getDatabase().promptPresetsId
  if (!Number.isInteger(selectedIndex) || selectedIndex < 0) return undefined
  const presets = getDatabase().promptPresets
  if (!Array.isArray(presets)) return undefined
  const preset = presets?.[selectedIndex] as Record<string, unknown> | undefined
  if (!preset || typeof preset.id !== 'string' || preset.id.trim() === '') return undefined
  const matches = presets.filter((candidate) => candidate?.id === preset.id)
  return matches.length === 1 ? { index: selectedIndex, preset } : undefined
}

function uniquePromptPresetEntryById(presetId: string): { index: number; preset: Record<string, unknown> } | undefined {
  const presets = getDatabase().promptPresets
  if (!Array.isArray(presets) || !presetId.trim()) return undefined
  const matches = presets
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate }) => candidate?.id === presetId)
  if (matches.length !== 1) return undefined
  return { index: matches[0].index, preset: matches[0].candidate as Record<string, unknown> }
}

function uniquePromptPresetById(presetId: string): Record<string, unknown> | undefined {
  return uniquePromptPresetEntryById(presetId)?.preset
}

function snapshotJson(value: unknown): string {
  const snapshot = JSON.stringify(value)
  return snapshot === undefined ? '__undefined__' : snapshot
}

function cloneJsonValue<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}
