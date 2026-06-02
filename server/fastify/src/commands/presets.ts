import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { EntityNotFoundError, ValidationError } from '../repository.js'
import { validateOptionalServerAssetRef } from './assets.js'

type JsonRecord = Record<string, unknown>
type AssetValidationOptions = { assetDb?: DatabaseSync }

export interface PresetRecord extends JsonRecord {
  id: string
  name?: string
}

const SNAPSHOT_KEYS: Array<[string, string]> = [
  ['name', 'name'],
  ['apiType', 'apiType'],
  ['openAIKey', 'openAIKey'],
  ['localNetworkMode', 'localNetworkMode'],
  ['localNetworkTimeoutSec', 'localNetworkTimeoutSec'],
  ['mainPrompt', 'mainPrompt'],
  ['jailbreak', 'jailbreak'],
  ['globalNote', 'globalNote'],
  ['temperature', 'temperature'],
  ['maxContext', 'maxContext'],
  ['maxResponse', 'maxResponse'],
  ['frequencyPenalty', 'frequencyPenalty'],
  ['PresensePenalty', 'PresensePenalty'],
  ['formatingOrder', 'formatingOrder'],
  ['aiModel', 'aiModel'],
  ['subModel', 'subModel'],
  ['currentPluginProvider', 'currentPluginProvider'],
  ['textgenWebUIStreamURL', 'textgenWebUIStreamURL'],
  ['textgenWebUIBlockingURL', 'textgenWebUIBlockingURL'],
  ['forceReplaceUrl', 'forceReplaceUrl'],
  ['promptPreprocess', 'promptPreprocess'],
  ['bias', 'bias'],
  ['koboldURL', 'koboldURL'],
  ['proxyKey', 'proxyKey'],
  ['ooba', 'ooba'],
  ['ainconfig', 'ainconfig'],
  ['proxyRequestModel', 'proxyRequestModel'],
  ['openrouterRequestModel', 'openrouterRequestModel'],
  ['NAISettings', 'NAIsettings'],
  ['promptTemplate', 'promptTemplate'],
  ['NAIadventure', 'NAIadventure'],
  ['NAIappendName', 'NAIappendName'],
  ['localStopStrings', 'localStopStrings'],
  ['autoSuggestPrompt', 'autoSuggestPrompt'],
  ['customProxyRequestModel', 'customProxyRequestModel'],
  ['reverseProxyOobaArgs', 'reverseProxyOobaArgs'],
  ['top_p', 'top_p'],
  ['promptSettings', 'promptSettings'],
  ['repetition_penalty', 'repetition_penalty'],
  ['min_p', 'min_p'],
  ['top_a', 'top_a'],
  ['openrouterProvider', 'openrouterProvider'],
  ['useInstructPrompt', 'useInstructPrompt'],
  ['customPromptTemplateToggle', 'customPromptTemplateToggle'],
  ['templateDefaultVariables', 'templateDefaultVariables'],
  ['moduleIntergration', 'moduleIntergration'],
  ['top_k', 'top_k'],
  ['instructChatTemplate', 'instructChatTemplate'],
  ['JinjaTemplate', 'JinjaTemplate'],
  ['jsonSchemaEnabled', 'jsonSchemaEnabled'],
  ['jsonSchema', 'jsonSchema'],
  ['strictJsonSchema', 'strictJsonSchema'],
  ['extractJson', 'extractJson'],
  ['seperateParametersEnabled', 'seperateParametersEnabled'],
  ['seperateParameters', 'seperateParameters'],
  ['customAPIFormat', 'customAPIFormat'],
  ['systemContentReplacement', 'systemContentReplacement'],
  ['systemRoleReplacement', 'systemRoleReplacement'],
  ['customFlags', 'customFlags'],
  ['enableCustomFlags', 'enableCustomFlags'],
  ['regex', 'presetRegex'],
  ['reasonEffort', 'reasoningEffort'],
  ['thinkingTokens', 'thinkingTokens'],
  ['thinkingType', 'thinkingType'],
  ['deepseekThinkingType', 'deepseekThinkingType'],
  ['adaptiveThinkingEffort', 'adaptiveThinkingEffort'],
  ['deepseekReasoningEffort', 'deepseekReasoningEffort'],
  ['outputImageModal', 'outputImageModal'],
  ['seperateModelsForAxModels', 'seperateModelsForAxModels'],
  ['seperateModels', 'seperateModels'],
  ['modelTools', 'modelTools'],
  ['fallbackModels', 'fallbackModels'],
  ['fallbackWhenBlankResponse', 'fallbackWhenBlankResponse'],
  ['verbosity', 'verbosity'],
  ['dynamicOutput', 'dynamicOutput'],
]

const APPLY_KEYS = SNAPSHOT_KEYS.filter(([presetKey]) => presetKey !== 'name')

export function readJsonObject(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(`${label} must be an object`)
  }
  validateJsonValue(label, value)
  return value as JsonRecord
}

export function readPresetId(value: unknown, label = 'presetId'): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(`${label} must be a non-empty string`)
  }
  return value
}

export function readOptionalBoolean(value: unknown, label: string, fallback: boolean): boolean {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') {
    throw new ValidationError(`${label} must be a boolean`)
  }
  return value
}

export function readOptionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') {
    throw new ValidationError(`${label} must be a string`)
  }
  return value
}

export function ensureDatabaseObject(database: unknown): JsonRecord {
  if (!database || typeof database !== 'object' || Array.isArray(database)) {
    throw new ValidationError('database must be an object before preset commands can run')
  }
  return database as JsonRecord
}

export function ensurePresetCollection(database: JsonRecord): PresetRecord[] {
  if (!Array.isArray(database.botPresets)) {
    database.botPresets = []
  }

  const seen = new Set<string>()
  const presets = (database.botPresets as unknown[]).map((raw) => {
    const preset = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as JsonRecord) : {}
    const rawId = typeof preset.id === 'string' && preset.id.trim() ? preset.id : randomUUID()
    const id = seen.has(rawId) ? randomUUID() : rawId
    seen.add(id)
    preset.id = id
    return preset as PresetRecord
  })
  database.botPresets = presets

  if (!Number.isInteger(database.botPresetsId as number)) {
    database.botPresetsId = presets.length > 0 ? 0 : -1
  }
  if ((database.botPresetsId as number) >= presets.length) {
    database.botPresetsId = presets.length > 0 ? presets.length - 1 : -1
  }
  if ((database.botPresetsId as number) < -1) {
    database.botPresetsId = presets.length > 0 ? 0 : -1
  }

  return presets
}

export function normalizePresetCollection(database: unknown): void {
  const target = ensureDatabaseObject(database)
  ensurePresetCollection(target)
}

export function createPresetRecord(
  input: JsonRecord,
  fallbackName = 'New Preset',
  options: AssetValidationOptions = {},
): PresetRecord {
  const preset = cloneJson(input) as PresetRecord
  preset.id = readPresetId(preset.id, 'preset.id')
  if (preset.name !== undefined && typeof preset.name !== 'string') {
    throw new ValidationError('preset.name must be a string')
  }
  validatePresetAssetRefs(preset, 'preset', options)
  preset.name ??= fallbackName
  return preset
}

export function readPresetPatch(
  input: JsonRecord,
  options: AssetValidationOptions = {},
): JsonRecord {
  const patch = cloneJson(input) as JsonRecord
  validatePresetAssetRefs(patch, 'patch', options)
  return patch
}

export function findPresetIndex(presets: readonly PresetRecord[], presetId: string): number {
  return presets.findIndex((preset) => preset.id === presetId)
}

export function requirePresetIndex(presets: readonly PresetRecord[], presetId: string): number {
  const index = findPresetIndex(presets, presetId)
  if (index === -1) {
    throw new EntityNotFoundError(`Preset not found: ${presetId}`)
  }
  return index
}

export function selectedPresetId(database: JsonRecord, presets: readonly PresetRecord[]): string | null {
  const index = Number.isInteger(database.botPresetsId as number)
    ? (database.botPresetsId as number)
    : -1
  return presets[index]?.id ?? null
}

export function saveCurrentPresetSnapshot(database: JsonRecord, presets: PresetRecord[]): void {
  const index = Number.isInteger(database.botPresetsId as number)
    ? (database.botPresetsId as number)
    : -1
  if (index < 0 || index >= presets.length) return

  const current = presets[index]
  const snapshot: PresetRecord = {
    id: current.id,
    name: typeof current.name === 'string' ? current.name : 'New Preset',
  }
  for (const [presetKey, databaseKey] of SNAPSHOT_KEYS) {
    if (presetKey === 'name') continue
    if (Object.prototype.hasOwnProperty.call(database, databaseKey)) {
      snapshot[presetKey] = cloneJson(database[databaseKey])
    }
  }
  snapshot.image = current.image ?? ''
  presets[index] = snapshot
}

export function applyPreset(database: JsonRecord, preset: PresetRecord): void {
  for (const [presetKey, databaseKey] of APPLY_KEYS) {
    if (Object.prototype.hasOwnProperty.call(preset, presetKey)) {
      database[databaseKey] = cloneJson(preset[presetKey])
    }
  }
}

/** Whether `applyPreset` would overwrite the `promptTemplate` collection for this
 *  preset — i.e. the preset carries a `promptTemplate`. The only collection field
 *  `applyPreset` writes; the apply path co-writes the prompt-items table only then. */
export function presetAppliesPromptTemplate(preset: PresetRecord): boolean {
  return Object.prototype.hasOwnProperty.call(preset, 'promptTemplate')
}

export function validateFullPresetIdList(presets: readonly PresetRecord[], presetIds: readonly string[]): void {
  const existing = new Set(presets.map((preset) => preset.id))
  const seen = new Set<string>()
  if (presetIds.length !== presets.length) {
    throw new ValidationError('presetIds must include every existing preset id')
  }
  for (const id of presetIds) {
    if (typeof id !== 'string' || id.trim() === '') {
      throw new ValidationError('presetIds must contain non-empty strings')
    }
    if (seen.has(id)) {
      throw new ValidationError(`Duplicate preset id: ${id}`)
    }
    if (!existing.has(id)) {
      throw new ValidationError(`Unknown preset id: ${id}`)
    }
    seen.add(id)
  }
}

function validatePresetAssetRefs(
  record: JsonRecord,
  label: string,
  options: AssetValidationOptions,
): void {
  if (options.assetDb && 'image' in record) {
    validateOptionalServerAssetRef(options.assetDb, record.image, `${label}.image`)
  }
}

function validateJsonValue(label: string, value: unknown): void {
  try {
    JSON.stringify(value)
  } catch {
    throw new ValidationError(`${label} must be JSON-serializable`)
  }
  if (value === undefined) {
    throw new ValidationError(`${label} must be JSON-serializable`)
  }
}

function cloneJson<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}
