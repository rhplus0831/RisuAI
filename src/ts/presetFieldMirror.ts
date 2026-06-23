import { MODEL_PRESET_FIELDS, PROMPT_PRESET_FIELDS } from './presetSplit'
import { updateModelPreset, updatePromptPreset, type ModelPreset, type PromptPreset } from './storage/database.svelte'
import { DBState } from './stores.svelte'

const MODEL_DATABASE_KEY_TO_PRESET_KEY: Record<string, string> = {
  NAIsettings: 'NAISettings',
  reasoningEffort: 'reasonEffort',
}

const PROMPT_DATABASE_KEY_TO_PRESET_KEY: Record<string, string> = {
  presetRegex: 'presetRegex',
}

const MODEL_PRESET_FIELD_SET = new Set<string>(MODEL_PRESET_FIELDS)
const PROMPT_PRESET_FIELD_SET = new Set<string>(PROMPT_PRESET_FIELDS)

export function mirrorTopLevelPresetField(key: string, value: unknown): boolean {
  const modelPresetKey = modelPresetKeyForDatabaseKey(key)
  if (modelPresetKey) {
    return mirrorSelectedModelPresetField(modelPresetKey, value)
  }

  const promptPresetKey = promptPresetKeyForDatabaseKey(key)
  if (promptPresetKey) {
    return mirrorSelectedPromptPresetField(promptPresetKey, value)
  }
  return false
}

function modelPresetKeyForDatabaseKey(key: string): string | null {
  if (key in MODEL_DATABASE_KEY_TO_PRESET_KEY) return MODEL_DATABASE_KEY_TO_PRESET_KEY[key]
  return MODEL_PRESET_FIELD_SET.has(key) ? key : null
}

function promptPresetKeyForDatabaseKey(key: string): string | null {
  if (key === 'promptTemplate') return null
  if (key in PROMPT_DATABASE_KEY_TO_PRESET_KEY) return PROMPT_DATABASE_KEY_TO_PRESET_KEY[key]
  return PROMPT_PRESET_FIELD_SET.has(key) ? key : null
}

function mirrorSelectedModelPresetField(key: string, value: unknown): boolean {
  const index = DBState.db.modelPresetsId
  if (!Number.isInteger(index) || index < 0) return false
  const preset = DBState.db.modelPresets?.[index] as Record<string, unknown> | undefined
  if (!preset) return false
  if (snapshotJson(preset[key]) === snapshotJson(value)) return false
  updateModelPreset(index, { [key]: cloneJsonValue(value) } as Partial<ModelPreset>)
  return true
}

function mirrorSelectedPromptPresetField(key: string, value: unknown): boolean {
  const index = DBState.db.promptPresetsId
  if (!Number.isInteger(index) || index < 0) return false
  const preset = DBState.db.promptPresets?.[index] as Record<string, unknown> | undefined
  if (!preset) return false
  if (snapshotJson(preset[key]) === snapshotJson(value)) return false
  updatePromptPreset(index, { [key]: cloneJsonValue(value) } as Partial<PromptPreset>)
  return true
}

function snapshotJson(value: unknown): string {
  const snapshot = JSON.stringify(value)
  return snapshot === undefined ? '__undefined__' : snapshot
}

function cloneJsonValue<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}
