import { randomUUID } from 'node:crypto'
import { EntityNotFoundError, ValidationError } from '../repository.js'

type JsonRecord = Record<string, unknown>

export interface PromptItemRecord extends JsonRecord {
  id: string
  type?: unknown
}

export const PROMPT_SETTINGS_KEYS = [
  'mainPrompt',
  'jailbreak',
  'globalNote',
  'formatingOrder',
  'promptPreprocess',
  'presetRegex',
  'promptSettings',
  'promptTemplate',
  'jsonSchemaEnabled',
  'jsonSchema',
  'strictJsonSchema',
  'extractJson',
  'customPromptTemplateToggle',
  'templateDefaultVariables',
  'OAIPrediction',
  'autoSuggestPrompt',
  'systemContentReplacement',
  'systemRoleReplacement',
  'outputImageModal',
  'fallbackModels',
  'fallbackWhenBlankResponse',
  'doNotChangeFallbackModels',
] as const

const PROMPT_SETTINGS_KEY_SET = new Set<string>(PROMPT_SETTINGS_KEYS)

export function ensurePromptTemplateCollection(database: JsonRecord): PromptItemRecord[] {
  if (!Array.isArray(database.promptTemplate)) {
    database.promptTemplate = []
  }

  const seen = new Set<string>()
  const promptTemplate = (database.promptTemplate as unknown[]).map((raw) => {
    const item = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as JsonRecord) : {}
    const rawId = typeof item.id === 'string' && item.id.trim() ? item.id : randomUUID()
    const id = seen.has(rawId) ? randomUUID() : rawId
    seen.add(id)
    item.id = id
    return item as PromptItemRecord
  })
  database.promptTemplate = promptTemplate
  return promptTemplate
}

export function normalizePromptTemplateCollection(database: unknown): void {
  if (!database || typeof database !== 'object' || Array.isArray(database)) return
  const target = database as JsonRecord
  if ('promptTemplate' in target) {
    ensurePromptTemplateCollection(target)
  }
}

export function createPromptItemRecord(input: unknown): PromptItemRecord {
  const item = readJsonObject(input, 'promptItem') as PromptItemRecord
  item.id = typeof item.id === 'string' && item.id.trim() ? item.id : randomUUID()
  return item
}

export function readPromptItemId(value: unknown, label = 'itemId'): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(`${label} must be a non-empty string`)
  }
  return value
}

export function readPromptSettingsPatch(patch: unknown): JsonRecord {
  const target = readJsonObject(patch, 'patch')
  const entries = Object.entries(target)
  if (entries.length === 0) {
    throw new ValidationError('patch must include at least one prompt setting')
  }

  for (const [key, value] of entries) {
    if (!PROMPT_SETTINGS_KEY_SET.has(key)) {
      throw new ValidationError(`Unsupported prompt setting: ${key}`)
    }
    validatePromptSettingValue(key, value)
  }

  return target
}

export function findPromptItemIndex(items: readonly PromptItemRecord[], itemId: string): number {
  return items.findIndex((item) => item.id === itemId)
}

export function requirePromptItemIndex(items: readonly PromptItemRecord[], itemId: string): number {
  const index = findPromptItemIndex(items, itemId)
  if (index === -1) {
    throw new EntityNotFoundError(`Prompt item not found: ${itemId}`)
  }
  return index
}

export function validateFullPromptItemIdList(
  items: readonly PromptItemRecord[],
  itemIds: readonly unknown[],
): asserts itemIds is string[] {
  const existing = new Set(items.map((item) => item.id))
  const seen = new Set<string>()
  if (itemIds.length !== items.length) {
    throw new ValidationError('itemIds must include every existing prompt item id')
  }
  for (const id of itemIds) {
    if (typeof id !== 'string' || id.trim() === '') {
      throw new ValidationError('itemIds must contain non-empty strings')
    }
    if (seen.has(id)) {
      throw new ValidationError(`Duplicate prompt item id: ${id}`)
    }
    if (!existing.has(id)) {
      throw new ValidationError(`Unknown prompt item id: ${id}`)
    }
    seen.add(id)
  }
}

export function readJsonObject(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(`${label} must be an object`)
  }
  validateJsonValue(label, value)
  return value as JsonRecord
}

function validatePromptSettingValue(key: string, value: unknown): void {
  if (
    [
      'jsonSchemaEnabled',
      'strictJsonSchema',
      'outputImageModal',
      'fallbackWhenBlankResponse',
      'doNotChangeFallbackModels',
    ].includes(key) &&
    typeof value !== 'boolean'
  ) {
    throw new ValidationError(`${key} must be a boolean`)
  }
  if (
    [
      'jsonSchema',
      'extractJson',
      'customPromptTemplateToggle',
      'templateDefaultVariables',
      'OAIPrediction',
      'autoSuggestPrompt',
      'systemContentReplacement',
      'systemRoleReplacement',
      'mainPrompt',
      'jailbreak',
      'globalNote',
    ].includes(key) &&
    typeof value !== 'string'
  ) {
    throw new ValidationError(`${key} must be a string`)
  }
  if (key === 'promptPreprocess' && typeof value !== 'boolean') {
    throw new ValidationError('promptPreprocess must be a boolean')
  }
  if (['formatingOrder', 'presetRegex'].includes(key) && !Array.isArray(value)) {
    throw new ValidationError(`${key} must be an array`)
  }
  if (key === 'promptSettings' && (!value || typeof value !== 'object' || Array.isArray(value))) {
    throw new ValidationError('promptSettings must be an object')
  }
  if (key === 'promptTemplate' && value !== null && !Array.isArray(value)) {
    throw new ValidationError('promptTemplate must be an array or null')
  }
  if (key === 'fallbackModels' && (!value || typeof value !== 'object' || Array.isArray(value))) {
    throw new ValidationError('fallbackModels must be an object')
  }
  validateJsonValue(key, value)
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
