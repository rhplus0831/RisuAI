type JsonRecord = Record<string, unknown>

export const MODEL_PRESET_FIELDS = [
  'apiType',
  'openAIKey',
  'localNetworkMode',
  'localNetworkTimeoutSec',
  'temperature',
  'maxContext',
  'maxResponse',
  'frequencyPenalty',
  'PresensePenalty',
  'aiModel',
  'subModel',
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
export type ModelPresetRecord = JsonRecord & { id: string; name?: string }
export type PromptPresetRecord = JsonRecord & { id: string; name?: string }

export function extractModelPresetFields(source: unknown): JsonRecord {
  return pickPresetFields(source, MODEL_PRESET_FIELDS)
}

export function extractPromptPresetFields(source: unknown): JsonRecord {
  return pickPresetFields(source, PROMPT_PRESET_FIELDS)
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
  const payload = extractPromptPresetFields(promptPreset)
  if (isRecord(promptPreset)) {
    if (typeof promptPreset.name === 'string') payload.name = promptPreset.name
    if (typeof promptPreset.id === 'string') payload.id = promptPreset.id
  }
  return payload
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

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
