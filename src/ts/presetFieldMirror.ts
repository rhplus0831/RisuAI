import { MODEL_PRESET_FIELDS, PROMPT_PRESET_FIELDS } from './presetSplit'
import { collectionsResourceState, settingsResourceState } from './server/resourceState.svelte'
import {
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

type SplitPresetKind = TopLevelPresetFieldMirrorTarget['kind']

interface SplitPresetOwnerSnapshot {
  presets: ReadonlyArray<Record<string, unknown>>
  selectedIndex: number
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
    const owner = currentSplitPresetOwnerSnapshot('model')
    if (!owner) return null
    const presetId = owner.presets[owner.selectedIndex]?.id
    if (typeof presetId !== 'string' || uniquePresetIndex(owner.presets, presetId) < 0) return null
    return { kind: 'model', databaseKey: key, presetKey: modelPresetKey, presetId }
  }

  const promptPresetKey = promptPresetKeyForDatabaseKey(key)
  if (promptPresetKey) {
    const owner = currentSplitPresetOwnerSnapshot('prompt')
    if (!owner) return null
    const presetId = owner.presets[owner.selectedIndex]?.id
    if (typeof presetId !== 'string' || uniquePresetIndex(owner.presets, presetId) < 0) return null
    return { kind: 'prompt', databaseKey: key, presetKey: promptPresetKey, presetId }
  }
  return null
}

export function currentTopLevelPresetFieldMirrorValue(target: TopLevelPresetFieldMirrorTarget): unknown {
  const presets = currentSplitPresetCollectionOwner(target.kind)
  if (!presets) return undefined
  const index = uniquePresetIndex(presets, target.presetId)
  if (index < 0) return undefined
  const preset = presets[index]
  return cloneJsonValue(preset[target.presetKey])
}

export function mirrorTopLevelPresetFieldToTarget(target: TopLevelPresetFieldMirrorTarget, value: unknown): boolean {
  return mirrorTopLevelPresetFieldToTargetWithOutcome(target, value) !== null
}

export function mirrorTopLevelPresetFieldToTargetWithOutcome(
  target: TopLevelPresetFieldMirrorTarget,
  value: unknown,
): Promise<PresetMutationOutcome> | null {
  const presets = currentSplitPresetCollectionOwner(target.kind)
  if (!presets) return null
  const index = uniquePresetIndex(presets, target.presetId)
  if (index < 0) return null
  const preset = presets[index]
  if (snapshotJson(preset[target.presetKey]) === snapshotJson(value)) return null

  // Narrow compatibility mutation seam: these storage commands still own the
  // durable stable-id queue, optimistic selected-settings projection, and
  // field-scoped terminal rollback. The owner snapshot above prevents this
  // index adapter from resolving or retargeting against the aggregate facade.
  if (target.kind === 'model') {
    return updateModelPreset(index, { [target.presetKey]: cloneJsonValue(value) } as Partial<ModelPreset>)
  }

  return updatePromptPreset(index, { [target.presetKey]: cloneJsonValue(value) } as Partial<PromptPreset>)
}

function currentSplitPresetOwnerSnapshot(kind: SplitPresetKind): SplitPresetOwnerSnapshot | null {
  const presets = currentSplitPresetCollectionOwner(kind)
  const selectedIndex = currentSplitPresetSelectionOwner(kind)
  if (!presets || selectedIndex === null || selectedIndex < 0 || selectedIndex >= presets.length) return null
  return { presets, selectedIndex }
}

function currentSplitPresetCollectionOwner(kind: SplitPresetKind): SplitPresetOwnerSnapshot['presets'] | null {
  const collectionName = kind === 'model' ? 'modelPresets' : 'promptPresets'
  const status = collectionsResourceState.statuses[collectionName]
  if (collectionsResourceState.status === 'error' || status !== 'ready') return null

  const value = collectionsResourceState.values[collectionName]
  if (!Array.isArray(value)) return null
  return value as ReadonlyArray<Record<string, unknown>>
}

function currentSplitPresetSelectionOwner(kind: SplitPresetKind): number | null {
  const selectionKey = kind === 'model' ? 'modelPresetsId' : 'promptPresetsId'
  const status = settingsResourceState.standaloneStatuses[selectionKey]
  if (settingsResourceState.status === 'error' || status !== 'ready') return null

  const value = settingsResourceState.value[selectionKey]
  return Number.isInteger(value) ? (value as number) : null
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
