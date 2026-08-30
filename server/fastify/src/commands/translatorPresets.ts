import { randomUUID } from 'node:crypto'
import {
  defaultTranslatorPrompt,
  normalizeTranslatorPreset,
  TRANSLATOR_PRESET_MAX_STEPS,
  type TranslatorPresetStep,
} from '@risuai/shared-core/translator-presets'
import { EntityNotFoundError, ValidationError } from '../repository.js'

type JsonRecord = Record<string, unknown>

export interface TranslatorPresetRecord extends JsonRecord {
  id: string
  name: string
  prompt: string
  maxResponse: number
  steps: TranslatorPresetStep[]
}

export function ensureDatabaseObject(database: unknown): JsonRecord {
  if (!database || typeof database !== 'object' || Array.isArray(database)) {
    throw new ValidationError('database must be an object before translator preset commands can run')
  }
  return database as JsonRecord
}

export function ensureTranslatorPresetCollection(database: JsonRecord): TranslatorPresetRecord[] {
  if (!Array.isArray(database.translatorPresets)) {
    database.translatorPresets = [
      repairTranslatorPresetRecord({
        name: 'Default',
        prompt: defaultTranslatorPrompt,
        maxResponse: 1000,
      }),
    ]
  }

  const seen = new Set<string>()
  const presets = (database.translatorPresets as unknown[]).map((raw, index) => {
    const preset = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as JsonRecord) : {}
    const record = repairTranslatorPresetRecord({
      id: preset.id,
      name: typeof preset.name === 'string' && preset.name.trim().length > 0 ? preset.name : `Preset ${index + 1}`,
      prompt: preset.prompt,
      maxResponse: preset.maxResponse,
      steps: preset.steps,
    })
    if (seen.has(record.id)) {
      record.id = randomUUID()
    }
    seen.add(record.id)
    return record
  })
  database.translatorPresets = presets

  if (!Number.isInteger(database.translatorPresetId as number)) {
    database.translatorPresetId = 0
  }
  if ((database.translatorPresetId as number) >= presets.length) {
    database.translatorPresetId = Math.max(presets.length - 1, 0)
  }
  if ((database.translatorPresetId as number) < 0) {
    database.translatorPresetId = 0
  }

  return presets
}

/** Import/migration-only compatibility for legacy scalar translator settings. */
export function normalizeTranslatorPresetCollectionWithLegacyCompatibility(database: unknown): void {
  if (!database || typeof database !== 'object' || Array.isArray(database)) return
  const target = database as JsonRecord
  const missingCanonicalCollection = !Array.isArray(target.translatorPresets) || target.translatorPresets.length === 0
  if (missingCanonicalCollection) {
    target.translatorPresets = [
      repairTranslatorPresetRecord({
        name: 'Default',
        prompt: stringValue(target.translatorPrompt),
        maxResponse: numberValue(target.translatorMaxResponse, 1000),
      }),
    ]
  }
  const presets = ensureTranslatorPresetCollection(target)
  if (missingCanonicalCollection) syncSelectedTranslatorPresetToLegacyFields(target, presets)
}

export function createTranslatorPresetRecord(input: unknown): TranslatorPresetRecord {
  const preset = readJsonObject(input, 'translatorPreset')
  const normalized = normalizeTranslatorPreset(preset)
  const record: TranslatorPresetRecord = {
    ...normalized,
    id: readTranslatorPresetId(preset.id, 'translatorPreset.id'),
  }
  validateTranslatorPresetRecord(record, 'translatorPreset')
  return record
}

function repairTranslatorPresetRecord(input: unknown): TranslatorPresetRecord {
  const preset = readJsonObject(input, 'translatorPreset')
  const normalized = normalizeTranslatorPreset(preset)
  const record: TranslatorPresetRecord = {
    ...normalized,
    id: typeof preset.id === 'string' && preset.id.trim() ? preset.id : randomUUID(),
  }
  validateTranslatorPresetRecord(record, 'translatorPreset')
  return record
}

export function readTranslatorPresetPatch(input: unknown): JsonRecord {
  const patch = readJsonObject(input, 'patch')
  if (Object.keys(patch).length === 0) {
    throw new ValidationError('patch must include at least one translator preset field')
  }
  const allowedFields = new Set(['id', 'name', 'prompt', 'maxResponse', 'steps'])
  for (const key of Object.keys(patch)) {
    if (!allowedFields.has(key)) throw new ValidationError(`patch.${key} is not a translator preset field`)
  }
  if ('steps' in patch) {
    if (!Array.isArray(patch.steps) || patch.steps.length === 0 || patch.steps.length > TRANSLATOR_PRESET_MAX_STEPS) {
      throw new ValidationError(`patch.steps must contain between 1 and ${TRANSLATOR_PRESET_MAX_STEPS} steps`)
    }
    const normalized = normalizeTranslatorPreset({
      name: typeof patch.name === 'string' ? patch.name : 'Patched Preset',
      prompt: typeof patch.prompt === 'string' ? patch.prompt : '',
      maxResponse: numberValue(patch.maxResponse, 1000),
      steps: patch.steps,
    })
    patch.steps = normalized.steps
    patch.prompt = normalized.prompt
    patch.maxResponse = normalized.maxResponse
  }
  validateTranslatorPresetRecord(patch, 'patch')
  return patch
}

export function applyTranslatorPresetRecordPatch(
  preset: TranslatorPresetRecord,
  patch: JsonRecord,
): TranslatorPresetRecord {
  const steps = patch.steps
    ? patch.steps
    : preset.steps.map((step, index) =>
        index === 0
          ? {
              ...step,
              ...('prompt' in patch ? { prompt: patch.prompt } : {}),
              ...('maxResponse' in patch ? { maxResponse: patch.maxResponse } : {}),
            }
          : step,
      )
  const normalized = normalizeTranslatorPreset({ ...preset, ...patch, steps })
  const record: TranslatorPresetRecord = { ...normalized, id: preset.id }
  validateTranslatorPresetRecord(record, 'translatorPreset')
  return record
}

export function readTranslatorPresetId(value: unknown, label = 'presetId'): string {
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

export function findTranslatorPresetIndex(presets: readonly TranslatorPresetRecord[], presetId: string): number {
  return presets.findIndex((preset) => preset.id === presetId)
}

export function requireTranslatorPresetIndex(presets: readonly TranslatorPresetRecord[], presetId: string): number {
  const index = findTranslatorPresetIndex(presets, presetId)
  if (index === -1) {
    throw new EntityNotFoundError(`Translator preset not found: ${presetId}`)
  }
  return index
}

export function selectedTranslatorPresetId(
  database: JsonRecord,
  presets: readonly TranslatorPresetRecord[],
): string | null {
  const index = Number.isInteger(database.translatorPresetId as number) ? (database.translatorPresetId as number) : 0
  return presets[index]?.id ?? null
}

export function syncSelectedTranslatorPresetToLegacyFields(
  database: JsonRecord,
  presets: readonly TranslatorPresetRecord[],
): void {
  const index = Number.isInteger(database.translatorPresetId as number) ? (database.translatorPresetId as number) : 0
  const preset = presets[index]
  if (!preset) return
  database.translatorPrompt = preset.prompt
  database.translatorMaxResponse = preset.maxResponse
}

export function readJsonObject(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(`${label} must be an object`)
  }
  validateJsonValue(label, value)
  return value as JsonRecord
}

function validateTranslatorPresetRecord(record: JsonRecord, label: string): void {
  if ('id' in record && (typeof record.id !== 'string' || record.id.trim() === '')) {
    throw new ValidationError(`${label}.id must be a non-empty string`)
  }
  if ('name' in record && typeof record.name !== 'string') {
    throw new ValidationError(`${label}.name must be a string`)
  }
  if ('prompt' in record && typeof record.prompt !== 'string') {
    throw new ValidationError(`${label}.prompt must be a string`)
  }
  if ('maxResponse' in record && (typeof record.maxResponse !== 'number' || !Number.isFinite(record.maxResponse))) {
    throw new ValidationError(`${label}.maxResponse must be a finite number`)
  }
  if ('steps' in record) {
    if (
      !Array.isArray(record.steps) ||
      record.steps.length === 0 ||
      record.steps.length > TRANSLATOR_PRESET_MAX_STEPS
    ) {
      throw new ValidationError(`${label}.steps must contain between 1 and ${TRANSLATOR_PRESET_MAX_STEPS} steps`)
    }
  }
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
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
