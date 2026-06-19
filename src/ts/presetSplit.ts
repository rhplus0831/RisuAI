type JsonRecord = Record<string, unknown>

export const MODEL_PRESET_FIELDS = [
  'apiType',
  'openAIKey',
  'localNetworkMode',
  'localNetworkTimeoutSec',
  'additionalParams',
  'temperature',
  'maxContext',
  'maxResponse',
  'frequencyPenalty',
  'PresensePenalty',
  'aiModel',
  'subModel',
  'modelRoles',
  'modelProfiles',
  'modelRoleProfiles',
  'currentPluginProvider',
  'textgenWebUIStreamURL',
  'textgenWebUIBlockingURL',
  'forceReplaceUrl',
  'koboldURL',
  'proxyKey',
  'ooba',
  'ainconfig',
  'proxyRequestModel',
  'openrouterRequestModel',
  'NAISettings',
  'localStopStrings',
  'customProxyRequestModel',
  'reverseProxyOobaArgs',
  'top_p',
  'repetition_penalty',
  'min_p',
  'top_a',
  'openrouterProvider',
  'useInstructPrompt',
  'top_k',
  'instructChatTemplate',
  'JinjaTemplate',
  'jsonSchemaEnabled',
  'jsonSchema',
  'strictJsonSchema',
  'extractJson',
  'seperateParametersEnabled',
  'seperateParameters',
  'customAPIFormat',
  'systemContentReplacement',
  'systemRoleReplacement',
  'customFlags',
  'enableCustomFlags',
  'reasonEffort',
  'thinkingTokens',
  'thinkingType',
  'deepseekThinkingType',
  'adaptiveThinkingEffort',
  'deepseekReasoningEffort',
  'outputImageModal',
  'seperateModelsForAxModels',
  'seperateModels',
  'modelTools',
  'fallbackModels',
  'fallbackWhenBlankResponse',
  'verbosity',
  'dynamicOutput',
] as const

export const PROMPT_PRESET_MODEL_PARAMETERS_OVERRIDE_KEY = 'overrideModelParameters' as const

export const PROMPT_PRESET_MODEL_PARAMETER_OVERRIDE_FIELDS = [
  'temperature',
  'maxContext',
  'maxResponse',
  'frequencyPenalty',
  'PresensePenalty',
  'ooba',
  'ainconfig',
  'NAISettings',
  'localStopStrings',
  'top_p',
  'repetition_penalty',
  'min_p',
  'top_a',
  'top_k',
  'reasonEffort',
  'thinkingTokens',
  'thinkingType',
  'deepseekThinkingType',
  'adaptiveThinkingEffort',
  'deepseekReasoningEffort',
  'seperateParametersEnabled',
  'seperateParameters',
  'verbosity',
] as const satisfies readonly ModelPresetField[]

export const PROMPT_PRESET_MODEL_OTHERS_OVERRIDE_FIELDS = [
  'additionalParams',
  'jsonSchemaEnabled',
  'jsonSchema',
  'strictJsonSchema',
  'extractJson',
  'systemContentReplacement',
  'systemRoleReplacement',
  'customFlags',
  'enableCustomFlags',
  'outputImageModal',
  'modelRoles',
  'modelRoleProfiles',
  'seperateModelsForAxModels',
  'seperateModels',
  'fallbackModels',
  'fallbackWhenBlankResponse',
  'modelTools',
  'dynamicOutput',
] as const satisfies readonly ModelPresetField[]

export const PROMPT_PRESET_MODEL_OVERRIDE_FIELDS = [
  ...PROMPT_PRESET_MODEL_PARAMETER_OVERRIDE_FIELDS,
  ...PROMPT_PRESET_MODEL_OTHERS_OVERRIDE_FIELDS,
] as const

export const PROMPT_PRESET_FIELDS = [
  'mainPrompt',
  'jailbreak',
  'globalNote',
  'formatingOrder',
  'promptPreprocess',
  'bias',
  'autoSuggestPrompt',
  'autoSuggestPrefix',
  'autoSuggestClean',
  'promptTemplate',
  'NAIadventure',
  'NAIappendName',
  'promptSettings',
  'customPromptTemplateToggle',
  'templateDefaultVariables',
  'moduleIntergration',
  'regex',
  'presetRegex',
] as const

export type ModelPresetField = (typeof MODEL_PRESET_FIELDS)[number]
export type PromptPresetField = (typeof PROMPT_PRESET_FIELDS)[number]
export type PromptPresetModelParameterOverrideField = (typeof PROMPT_PRESET_MODEL_PARAMETER_OVERRIDE_FIELDS)[number]
export type PromptPresetModelOthersOverrideField = (typeof PROMPT_PRESET_MODEL_OTHERS_OVERRIDE_FIELDS)[number]
export type PromptPresetModelOverrideField = (typeof PROMPT_PRESET_MODEL_OVERRIDE_FIELDS)[number]
export type ModelPresetRecord = JsonRecord & { id: string; name?: string }
export type PromptPresetRecord = JsonRecord & { id: string; name?: string }
export type EffectivePresetCompositionScope = 'full-generation' | 'model-runtime'

export interface EffectivePresetCompositionOptions {
  modelPreset?: unknown
  promptPreset?: unknown
  scope?: EffectivePresetCompositionScope
}

export interface ComposeEffectivePresetSettingsInput extends EffectivePresetCompositionOptions {
  base: JsonRecord
}

const MODEL_PRESET_DATABASE_KEY_OVERRIDES: Partial<Record<ModelPresetField, string>> = {
  NAISettings: 'NAIsettings',
  reasonEffort: 'reasoningEffort',
}

const MODEL_PRESET_FIELD_BY_DATABASE_KEY: Record<string, ModelPresetField> = MODEL_PRESET_FIELDS.reduce(
  (acc, field) => {
    acc[MODEL_PRESET_DATABASE_KEY_OVERRIDES[field] ?? field] = field
    return acc
  },
  {} as Record<string, ModelPresetField>,
)

const PROMPT_PRESET_MODEL_PARAMETER_OVERRIDE_FIELD_SET = new Set<string>(PROMPT_PRESET_MODEL_PARAMETER_OVERRIDE_FIELDS)
const PROMPT_PRESET_MODEL_OTHERS_OVERRIDE_FIELD_SET = new Set<string>(PROMPT_PRESET_MODEL_OTHERS_OVERRIDE_FIELDS)
const PROMPT_PRESET_MODEL_OVERRIDE_FIELD_SET = new Set<string>(PROMPT_PRESET_MODEL_OVERRIDE_FIELDS)

export function extractModelPresetFields(source: unknown): JsonRecord {
  return pickPresetFields(source, MODEL_PRESET_FIELDS)
}

export function extractPromptPresetFields(source: unknown): JsonRecord {
  return pickPresetFields(source, PROMPT_PRESET_FIELDS)
}

export function extractPromptPresetModelOverrideFields(source: unknown): JsonRecord {
  const picked = pickPresetFields(source, PROMPT_PRESET_MODEL_OVERRIDE_FIELDS)
  if (!isRecord(source)) return picked
  if (typeof source[PROMPT_PRESET_MODEL_PARAMETERS_OVERRIDE_KEY] === 'boolean') {
    picked[PROMPT_PRESET_MODEL_PARAMETERS_OVERRIDE_KEY] = source[PROMPT_PRESET_MODEL_PARAMETERS_OVERRIDE_KEY]
  }
  return picked
}

export function createExtractedModelPreset(
  legacyPreset: unknown,
  identity: { id: string; name?: string },
): ModelPresetRecord {
  return {
    id: identity.id,
    name: identity.name,
    ...extractModelPresetFields(legacyPreset),
  }
}

export function createExtractedPromptPreset(
  legacyPreset: unknown,
  identity: { id: string; name?: string },
): PromptPresetRecord {
  return {
    id: identity.id,
    name: identity.name,
    ...extractPromptPresetFields(legacyPreset),
    ...extractPromptPresetModelOverrideFields(legacyPreset),
  }
}

export function modelPresetFingerprint(preset: unknown): string {
  return stableStringify(extractModelPresetFields(preset))
}

export function findEquivalentModelPreset<T extends { id?: string | null }>(
  presets: readonly T[],
  candidate: unknown,
): T | undefined {
  const fingerprint = modelPresetFingerprint(candidate)
  return presets.find((preset) => modelPresetFingerprint(preset) === fingerprint)
}

export function promptPresetExportPayload(promptPreset: unknown): JsonRecord {
  const payload = {
    ...extractPromptPresetFields(promptPreset),
    ...extractPromptPresetModelOverrideFields(promptPreset),
  }
  if (isRecord(promptPreset)) {
    if (typeof promptPreset.name === 'string') payload.name = promptPreset.name
    if (typeof promptPreset.id === 'string') payload.id = promptPreset.id
  }
  return payload
}

export function databaseKeyForModelPresetField(field: string): string {
  return MODEL_PRESET_DATABASE_KEY_OVERRIDES[field as ModelPresetField] ?? field
}

export function modelPresetFieldForDatabaseKey(key: string): ModelPresetField | null {
  return MODEL_PRESET_FIELD_BY_DATABASE_KEY[key] ?? null
}

export function promptPresetModelOverrideFieldForDatabaseKey(key: string): PromptPresetModelOverrideField | null {
  const field = modelPresetFieldForDatabaseKey(key)
  if (!field || !PROMPT_PRESET_MODEL_OVERRIDE_FIELD_SET.has(field)) return null
  return field as PromptPresetModelOverrideField
}

export function isPromptPresetModelParameterOverrideField(
  field: string,
): field is PromptPresetModelParameterOverrideField {
  return PROMPT_PRESET_MODEL_PARAMETER_OVERRIDE_FIELD_SET.has(field)
}

export function isPromptPresetModelOthersOverrideField(field: string): field is PromptPresetModelOthersOverrideField {
  return PROMPT_PRESET_MODEL_OTHERS_OVERRIDE_FIELD_SET.has(field)
}

export function promptPresetOverridesModelParameters(preset: unknown): boolean {
  return isRecord(preset) && preset[PROMPT_PRESET_MODEL_PARAMETERS_OVERRIDE_KEY] === true
}

export function resolvePromptPresetRegexField(source: unknown): { present: boolean; value: unknown } {
  if (!isRecord(source)) return { present: false, value: undefined }

  const hasLegacyRegex = Object.prototype.hasOwnProperty.call(source, 'regex')
  const hasPresetRegex = Object.prototype.hasOwnProperty.call(source, 'presetRegex')
  if (!hasLegacyRegex && !hasPresetRegex) return { present: false, value: undefined }

  const legacyRegex = source.regex
  const presetRegex = source.presetRegex

  if (isNonEmptyArray(presetRegex)) return { present: true, value: presetRegex }
  if (isNonEmptyArray(legacyRegex)) return { present: true, value: legacyRegex }
  if (hasPresetRegex) return { present: true, value: presetRegex }
  return { present: true, value: legacyRegex }
}

export function composeEffectivePresetSettings(input: ComposeEffectivePresetSettingsInput): JsonRecord {
  const effective = cloneRecord(input.base)
  applyEffectivePresetComposition(effective, input)
  return effective
}

export function applyEffectivePresetComposition(target: JsonRecord, options: EffectivePresetCompositionOptions): void {
  const scope = options.scope ?? 'full-generation'
  applyMappedPresetFields(target, options.modelPreset, MODEL_PRESET_FIELDS)

  if (scope === 'full-generation') {
    applyPromptPresetFields(target, options.promptPreset)
  }

  applyPromptPresetModelOverrides(target, options.promptPreset)
}

function applyPromptPresetFields(target: JsonRecord, promptPreset: unknown): void {
  if (!isRecord(promptPreset)) return
  for (const field of PROMPT_PRESET_FIELDS) {
    if (field === 'regex' || field === 'presetRegex') continue
    if (!Object.prototype.hasOwnProperty.call(promptPreset, field)) continue
    target[field] = cloneJsonValue(promptPreset[field])
  }

  const regexField = resolvePromptPresetRegexField(promptPreset)
  if (regexField.present) {
    target.presetRegex = cloneJsonValue(regexField.value)
  }
}

function applyPromptPresetModelOverrides(target: JsonRecord, promptPreset: unknown): void {
  if (promptPresetOverridesModelParameters(promptPreset)) {
    applyMappedPresetFields(target, promptPreset, PROMPT_PRESET_MODEL_PARAMETER_OVERRIDE_FIELDS)
  }
  applyMappedPresetFields(target, promptPreset, PROMPT_PRESET_MODEL_OTHERS_OVERRIDE_FIELDS)
}

function applyMappedPresetFields(target: JsonRecord, preset: unknown, fields: readonly string[]): void {
  if (!isRecord(preset)) return
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(preset, field)) continue
    target[databaseKeyForModelPresetField(field)] = cloneJsonValue(preset[field])
  }
}

function cloneRecord(source: JsonRecord): JsonRecord {
  const cloned: JsonRecord = {}
  for (const [key, value] of Object.entries(source)) {
    cloned[key] = cloneJsonValue(value)
  }
  return cloned
}

function pickPresetFields(source: unknown, fields: readonly string[]): JsonRecord {
  if (!isRecord(source)) return {}
  const picked: JsonRecord = {}
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(source, field)) {
      picked[field] = cloneJsonValue(source[field])
    }
  }
  return picked
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJsonValue(value))
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue)
  if (!isRecord(value)) return value
  const sorted: JsonRecord = {}
  for (const key of Object.keys(value).sort()) {
    sorted[key] = sortJsonValue(value[key])
  }
  return sorted
}

function cloneJsonValue<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}

function isNonEmptyArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value) && value.length > 0
}

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
