import { MODEL_PRESET_FIELDS, PROMPT_PRESET_FIELDS } from './presetSplit'
import {
  getDatabase,
  updateModelPreset,
  updatePromptPreset,
  type ModelPreset,
  type PresetMutationOutcome,
  type PromptPreset,
} from './storage/database.svelte'

const MODEL_DATABASE_KEY_TO_PRESET_KEY: Record<string, string> = {
  NAIsettings: 'NAISettings',
  reasoningEffort: 'reasonEffort',
}

const PROMPT_DATABASE_KEY_TO_PRESET_KEY: Record<string, string> = {
  presetRegex: 'presetRegex',
}

const MODEL_PRESET_FIELD_SET = new Set<string>(MODEL_PRESET_FIELDS)
const PROMPT_PRESET_FIELD_SET = new Set<string>(PROMPT_PRESET_FIELDS)

export type TopLevelPresetFieldMirrorTarget =
  | {
      kind: 'model'
      databaseKey: string
      presetKey: string
      presetId: string
    }
  | {
      kind: 'prompt'
      databaseKey: string
      presetKey: string
      presetId: string
    }

export function mirrorTopLevelPresetField(key: string, value: unknown): boolean {
  return mirrorTopLevelPresetFieldWithOutcome(key, value) !== null
}

export function mirrorTopLevelPresetFieldWithOutcome(
  key: string,
  value: unknown,
): Promise<PresetMutationOutcome> | null {
  const target = resolveTopLevelPresetFieldMirrorTarget(key)
  return target ? mirrorTopLevelPresetFieldToTargetWithOutcome(target, value) : null
}

/**
 * Resolve the selected preset once so delayed settings writes keep targeting
 * the preset the user actually edited, even if selection changes meanwhile.
 */
export function resolveTopLevelPresetFieldMirrorTarget(key: string): TopLevelPresetFieldMirrorTarget | null {
  const modelPresetKey = modelPresetKeyForDatabaseKey(key)
  if (modelPresetKey) {
    const index = getDatabase().modelPresetsId
    const presetId = Number.isInteger(index) && index >= 0 ? getDatabase().modelPresets?.[index]?.id : undefined
    if (!presetId || uniquePresetIndex(getDatabase().modelPresets, presetId) < 0) return null
    return { kind: 'model', databaseKey: key, presetKey: modelPresetKey, presetId }
  }

  const promptPresetKey = promptPresetKeyForDatabaseKey(key)
  if (promptPresetKey) {
    const index = getDatabase().promptPresetsId
    const presetId = Number.isInteger(index) && index >= 0 ? getDatabase().promptPresets?.[index]?.id : undefined
    if (!presetId || uniquePresetIndex(getDatabase().promptPresets, presetId) < 0) return null
    return { kind: 'prompt', databaseKey: key, presetKey: promptPresetKey, presetId }
  }
  return null
}

export function currentTopLevelPresetFieldMirrorValue(target: TopLevelPresetFieldMirrorTarget): unknown {
  const presets = target.kind === 'model' ? getDatabase().modelPresets : getDatabase().promptPresets
  const index = uniquePresetIndex(presets, target.presetId)
  if (index < 0) return undefined
  const preset = presets[index] as Record<string, unknown>
  return cloneJsonValue(preset[target.presetKey])
}

export function mirrorTopLevelPresetFieldToTarget(target: TopLevelPresetFieldMirrorTarget, value: unknown): boolean {
  return mirrorTopLevelPresetFieldToTargetWithOutcome(target, value) !== null
}

export function mirrorTopLevelPresetFieldToTargetWithOutcome(
  target: TopLevelPresetFieldMirrorTarget,
  value: unknown,
): Promise<PresetMutationOutcome> | null {
  if (target.kind === 'model') {
    const index = uniquePresetIndex(getDatabase().modelPresets, target.presetId)
    if (index < 0) return null
    const preset = getDatabase().modelPresets[index] as Record<string, unknown>
    if (snapshotJson(preset[target.presetKey]) === snapshotJson(value)) return null
    return updateModelPreset(index, { [target.presetKey]: cloneJsonValue(value) } as Partial<ModelPreset>)
  }

  const index = uniquePresetIndex(getDatabase().promptPresets, target.presetId)
  if (index < 0) return null
  const preset = getDatabase().promptPresets[index] as Record<string, unknown>
  if (snapshotJson(preset[target.presetKey]) === snapshotJson(value)) return null
  return updatePromptPreset(index, { [target.presetKey]: cloneJsonValue(value) } as Partial<PromptPreset>)
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

function snapshotJson(value: unknown): string {
  const snapshot = JSON.stringify(value)
  return snapshot === undefined ? '__undefined__' : snapshot
}

function uniquePresetIndex(presets: ReadonlyArray<{ id?: unknown }> | undefined, presetId: unknown): number {
  if (!Array.isArray(presets) || typeof presetId !== 'string' || presetId.trim() === '') return -1
  const matches = presets.map((preset, index) => ({ preset, index })).filter(({ preset }) => preset?.id === presetId)
  return matches.length === 1 ? matches[0].index : -1
}

function cloneJsonValue<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}
