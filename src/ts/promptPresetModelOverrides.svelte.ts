import { untrack } from 'svelte'
import {
  databaseKeyForModelPresetField,
  PROMPT_PRESET_MODEL_PARAMETER_OVERRIDE_FIELDS,
  PROMPT_PRESET_MODEL_PARAMETERS_OVERRIDE_KEY,
  promptPresetModelOverrideFieldForDatabaseKey,
  promptPresetOverridesModelParameters,
} from './presetSplit'
import { updatePromptPreset, type PromptPreset } from './storage/database.svelte'
import { DBState } from './stores.svelte'
import { withTrustedServerProjectionWrite } from './server/projectionWriteGuard.svelte'

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

export function promptPresetModelOverrideEnabled(group: OverrideGroup): boolean {
  const preset = selectedPromptPreset()
  const enabledByGroup: Record<OverrideGroup, boolean> = {
    parameters: promptPresetOverridesModelParameters(preset),
  }
  return enabledByGroup[group]
}

export function setPromptPresetModelOverrideEnabled(group: OverrideGroup, enabled: boolean): void {
  const selectedIndex = DBState.db.promptPresetsId
  if (!Number.isInteger(selectedIndex) || selectedIndex < 0) return
  const preset = DBState.db.promptPresets?.[selectedIndex] as Record<string, unknown> | undefined
  if (!preset) return

  const { flagKey, fields } = PROMPT_PRESET_MODEL_OVERRIDE_GROUPS[group]
  const patch: Record<string, unknown> = { [flagKey]: enabled }

  if (enabled) {
    const db = DBState.db as unknown as Record<string, unknown>
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
      withTrustedServerProjectionWrite(() => {
        const target = DBState.db as unknown as Record<string, unknown>
        target[databaseKey] = attempted
      })
      mirrorPromptPresetModelOverrideField(databaseKey, attempted)
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
  const value = (DBState.db as unknown as Record<string, unknown> | undefined)?.[databaseKey]
  return value === undefined ? fallback : (cloneJsonValue(value) as T)
}

export function mirrorPromptPresetModelOverrideField(databaseKey: string, value: unknown): boolean {
  const presetField = promptPresetModelOverrideFieldForDatabaseKey(databaseKey)
  if (!presetField || value === undefined) return false
  return updateSelectedPromptPresetField(presetField, value)
}

export function updateSelectedPromptPresetField(presetField: string, value: unknown): boolean {
  const selectedIndex = DBState.db.promptPresetsId
  if (!Number.isInteger(selectedIndex) || selectedIndex < 0) return false
  const preset = DBState.db.promptPresets?.[selectedIndex] as Record<string, unknown> | undefined
  if (!preset) return false
  if (snapshotJson(preset[presetField]) === snapshotJson(value)) return false
  updatePromptPreset(selectedIndex, { [presetField]: cloneJsonValue(value) } as Partial<PromptPreset>)
  return true
}

function selectedPromptPreset(): Record<string, unknown> | undefined {
  const selectedIndex = DBState.db.promptPresetsId
  if (!Number.isInteger(selectedIndex) || selectedIndex < 0) return undefined
  return DBState.db.promptPresets?.[selectedIndex] as Record<string, unknown> | undefined
}

function snapshotJson(value: unknown): string {
  const snapshot = JSON.stringify(value)
  return snapshot === undefined ? '__undefined__' : snapshot
}

function cloneJsonValue<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}
