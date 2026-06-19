import { MODEL_ROLES, modelRoleProfileInheritSource, type ModelRole } from './modelRoles'
import { LLMFlags, LLMFormat, type LLMFlags as LLMFlagValue, type LLMFormat as LLMFormatValue } from './types'

export interface ModelProfileRecord {
  id: string
  name: string
  modelId?: string
  providerOptions?: ModelProfileRecordProviderOptions
  runtimeOptions?: ModelProfileRecordRuntimeOptions
  fallbacks?: ModelProfileRecordFallbackRef[]
}

export interface ModelProfileRecordFallbackRef {
  mode: 'profile'
  profileId: string
}

export interface ModelProfileRecordProviderOptions {
  apiKey?: string
  requestModel?: string
  baseUrl?: string
  reverseProxy?: {
    autofillRequestUrl?: boolean
    oobaSystemHoist?: boolean
    oobaArgs?: unknown
  }
  openrouter?: {
    fallback?: boolean
    middleOut?: boolean
    provider?: {
      order?: string[]
      only?: string[]
      ignore?: string[]
    }
  }
  nanogpt?: {
    providerHint?: string
    useSubscriptionEndpoint?: boolean
    subscriptionState?: string
  }
  ollama?: {
    url?: string
    requestFormat?: LLMFormatValue
    modelSource?: string
    thinkingMode?: string
  }
}

export interface ModelProfileRecordRuntimeOptions {
  maxContext?: number
  maxResponse?: number
  temperature?: number
  topP?: number
  topK?: number
  minP?: number
  topA?: number
  repetitionPenalty?: number
  frequencyPenalty?: number
  presencePenalty?: number
  reasoningEffort?: number
  thinkingTokens?: number
  verbosity?: number
  genTime?: number
  thinkingType?: string
  deepseekThinkingType?: string
  adaptiveThinkingEffort?: string
  deepseekReasoningEffort?: string
  extractJson?: string
  jsonSchema?: string
  customTokenizer?: string
  useStreaming?: boolean
  jsonSchemaEnabled?: boolean
  strictJsonSchema?: boolean
  outputImageModal?: boolean
  enableCustomFlags?: boolean
  dynamicOutput?: unknown
  modelTools?: string[]
  customFlags?: LLMFlagValue[]
}

export interface LegacyModelRoleProfileBinding {
  mode: 'legacy'
}

export interface InheritModelRoleProfileBinding {
  mode: 'inherit'
}

export interface DurableModelRoleProfileBinding {
  mode: 'profile'
  profileId: string
}

export type ModelRoleProfileBinding =
  | LegacyModelRoleProfileBinding
  | InheritModelRoleProfileBinding
  | DurableModelRoleProfileBinding
export type ModelRoleProfileMap = Record<ModelRole, ModelRoleProfileBinding>

export class ModelProfileRecordValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ModelProfileRecordValidationError'
  }
}

const MODEL_PROFILE_RECORD_KEYS = new Set(['id', 'name', 'modelId', 'providerOptions', 'runtimeOptions', 'fallbacks'])
const MODEL_PROFILE_FALLBACK_REF_KEYS = new Set(['mode', 'profileId'])
const MODEL_PROFILE_PROVIDER_OPTIONS_KEYS = new Set([
  'apiKey',
  'requestModel',
  'baseUrl',
  'reverseProxy',
  'openrouter',
  'nanogpt',
  'ollama',
])
const MODEL_PROFILE_REVERSE_PROXY_KEYS = new Set(['autofillRequestUrl', 'oobaSystemHoist', 'oobaArgs'])
const MODEL_PROFILE_OPENROUTER_KEYS = new Set(['fallback', 'middleOut', 'provider'])
const MODEL_PROFILE_OPENROUTER_PROVIDER_KEYS = new Set(['order', 'only', 'ignore'])
const MODEL_PROFILE_NANOGPT_KEYS = new Set(['providerHint', 'useSubscriptionEndpoint', 'subscriptionState'])
const MODEL_PROFILE_OLLAMA_KEYS = new Set(['url', 'requestFormat', 'modelSource', 'thinkingMode'])
const MODEL_PROFILE_RUNTIME_NUMBER_KEYS = [
  'maxContext',
  'maxResponse',
  'temperature',
  'topP',
  'topK',
  'minP',
  'topA',
  'repetitionPenalty',
  'frequencyPenalty',
  'presencePenalty',
  'reasoningEffort',
  'thinkingTokens',
  'verbosity',
  'genTime',
] as const
const MODEL_PROFILE_RUNTIME_STRING_KEYS = [
  'thinkingType',
  'deepseekThinkingType',
  'adaptiveThinkingEffort',
  'deepseekReasoningEffort',
  'extractJson',
  'jsonSchema',
  'customTokenizer',
] as const
const MODEL_PROFILE_RUNTIME_BOOLEAN_KEYS = [
  'useStreaming',
  'jsonSchemaEnabled',
  'strictJsonSchema',
  'outputImageModal',
  'enableCustomFlags',
] as const
const MODEL_PROFILE_RUNTIME_KEYS = new Set([
  ...MODEL_PROFILE_RUNTIME_NUMBER_KEYS,
  ...MODEL_PROFILE_RUNTIME_STRING_KEYS,
  ...MODEL_PROFILE_RUNTIME_BOOLEAN_KEYS,
  'dynamicOutput',
  'modelTools',
  'customFlags',
])
const MODEL_ROLE_PROFILE_BINDING_KEYS = new Set(['mode', 'profileId'])
const MODEL_ROLE_SET = new Set<string>(MODEL_ROLES)
const LLM_FLAG_SET = new Set<number>(Object.values(LLMFlags))

export function createDefaultModelRoleProfiles(): ModelRoleProfileMap {
  return Object.fromEntries(MODEL_ROLES.map((role) => [role, { mode: 'legacy' }])) as ModelRoleProfileMap
}

export function normalizeModelProfiles(value: unknown): ModelProfileRecord[] {
  if (!Array.isArray(value)) return []

  const profiles: ModelProfileRecord[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (!isRecord(item)) continue
    const id = stringOrBlank(item.id)
    if (!id || seen.has(id)) continue
    const name = stringOrBlank(item.name) || id
    const modelId = stringOrBlank(item.modelId)
    profiles.push(
      createModelProfileRecord({
        id,
        name,
        modelId,
        providerOptions: normalizeModelProfileProviderOptions(item.providerOptions),
        runtimeOptions: normalizeModelProfileRuntimeOptions(item.runtimeOptions),
        fallbacks: normalizeModelProfileFallbackRefs(item.fallbacks),
      }),
    )
    seen.add(id)
  }

  return profiles
}

export function normalizeModelRoleProfiles(value: unknown): ModelRoleProfileMap {
  const source = isRecord(value) ? value : {}
  const profiles = createDefaultModelRoleProfiles()
  for (const role of MODEL_ROLES) {
    const binding = normalizeModelRoleProfileBinding(source[role], role)
    if (binding) profiles[role] = binding
  }
  return profiles
}

export function readModelProfiles(value: unknown): ModelProfileRecord[] {
  if (!Array.isArray(value)) {
    throw new ModelProfileRecordValidationError('modelProfiles must be an array')
  }

  const profiles: ModelProfileRecord[] = []
  const seen = new Set<string>()
  value.forEach((item, index) => {
    const profile = readModelProfileRecord(item, `modelProfiles[${index}]`)
    if (seen.has(profile.id)) {
      throw new ModelProfileRecordValidationError(`Duplicate model profile id: ${profile.id}`)
    }
    seen.add(profile.id)
    profiles.push(profile)
  })

  return profiles
}

export function readModelRoleProfiles(value: unknown): ModelRoleProfileMap {
  if (!isRecord(value)) {
    throw new ModelProfileRecordValidationError('modelRoleProfiles must be an object')
  }

  const profiles = createDefaultModelRoleProfiles()
  for (const key of Object.keys(value)) {
    if (!MODEL_ROLE_SET.has(key)) {
      throw new ModelProfileRecordValidationError(`Unknown model role profile binding: ${key}`)
    }
  }

  for (const role of MODEL_ROLES) {
    if (Object.prototype.hasOwnProperty.call(value, role)) {
      profiles[role] = readModelRoleProfileBinding(value[role], role, `modelRoleProfiles.${role}`)
    }
  }

  return profiles
}

function readModelProfileRecord(value: unknown, path: string): ModelProfileRecord {
  if (!isRecord(value)) {
    throw new ModelProfileRecordValidationError(`${path} must be an object`)
  }

  for (const key of Object.keys(value)) {
    if (!MODEL_PROFILE_RECORD_KEYS.has(key)) {
      throw new ModelProfileRecordValidationError(`${path}.${key} is not supported`)
    }
  }

  const id = stringOrBlank(value.id)
  if (!id) {
    throw new ModelProfileRecordValidationError(`${path}.id must be a non-empty string`)
  }
  const name = stringOrBlank(value.name)
  if (!name) {
    throw new ModelProfileRecordValidationError(`${path}.name must be a non-empty string`)
  }

  if (Object.prototype.hasOwnProperty.call(value, 'modelId') && typeof value.modelId !== 'string') {
    throw new ModelProfileRecordValidationError(`${path}.modelId must be a string when present`)
  }
  const modelId = stringOrBlank(value.modelId)
  const providerOptions = Object.prototype.hasOwnProperty.call(value, 'providerOptions')
    ? readModelProfileProviderOptions(value.providerOptions, `${path}.providerOptions`)
    : undefined
  const runtimeOptions = Object.prototype.hasOwnProperty.call(value, 'runtimeOptions')
    ? readModelProfileRuntimeOptions(value.runtimeOptions, `${path}.runtimeOptions`)
    : undefined
  const fallbacks = Object.prototype.hasOwnProperty.call(value, 'fallbacks')
    ? readModelProfileFallbackRefs(value.fallbacks, `${path}.fallbacks`)
    : undefined

  return createModelProfileRecord({ id, name, modelId, providerOptions, runtimeOptions, fallbacks })
}

function createModelProfileRecord(input: {
  id: string
  name: string
  modelId?: string
  providerOptions?: ModelProfileRecordProviderOptions
  runtimeOptions?: ModelProfileRecordRuntimeOptions
  fallbacks?: ModelProfileRecordFallbackRef[]
}): ModelProfileRecord {
  return {
    id: input.id,
    name: input.name,
    ...(input.modelId ? { modelId: input.modelId } : {}),
    ...(input.providerOptions ? { providerOptions: input.providerOptions } : {}),
    ...(input.runtimeOptions ? { runtimeOptions: input.runtimeOptions } : {}),
    ...(input.fallbacks && input.fallbacks.length > 0 ? { fallbacks: input.fallbacks } : {}),
  }
}

function normalizeModelProfileFallbackRefs(value: unknown): ModelProfileRecordFallbackRef[] | undefined {
  if (!Array.isArray(value)) return undefined
  const fallbacks: ModelProfileRecordFallbackRef[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (!isRecord(item) || item.mode !== 'profile') continue
    const profileId = stringOrBlank(item.profileId)
    if (!profileId || seen.has(profileId)) continue
    fallbacks.push({ mode: 'profile', profileId })
    seen.add(profileId)
  }
  return fallbacks.length > 0 ? fallbacks : undefined
}

function readModelProfileFallbackRefs(value: unknown, path: string): ModelProfileRecordFallbackRef[] | undefined {
  if (!Array.isArray(value)) {
    throw new ModelProfileRecordValidationError(`${path} must be an array when present`)
  }
  const fallbacks: ModelProfileRecordFallbackRef[] = []
  const seen = new Set<string>()
  value.forEach((item, index) => {
    const rowPath = `${path}[${index}]`
    if (!isRecord(item)) {
      throw new ModelProfileRecordValidationError(`${rowPath} must be an object`)
    }
    for (const key of Object.keys(item)) {
      if (!MODEL_PROFILE_FALLBACK_REF_KEYS.has(key)) {
        throw new ModelProfileRecordValidationError(`${rowPath}.${key} is not supported`)
      }
    }
    if (item.mode !== 'profile') {
      throw new ModelProfileRecordValidationError(`${rowPath}.mode must be profile`)
    }
    const profileId = stringOrBlank(item.profileId)
    if (!profileId) {
      throw new ModelProfileRecordValidationError(`${rowPath}.profileId must be a non-empty string`)
    }
    if (seen.has(profileId)) {
      throw new ModelProfileRecordValidationError(`${rowPath}.profileId must not duplicate ${profileId}`)
    }
    seen.add(profileId)
    fallbacks.push({ mode: 'profile', profileId })
  })
  return fallbacks.length > 0 ? fallbacks : undefined
}

function normalizeModelProfileProviderOptions(value: unknown): ModelProfileRecordProviderOptions | undefined {
  if (!isRecord(value)) return undefined
  const options: ModelProfileRecordProviderOptions = {}
  const apiKey = stringOrBlank(value.apiKey)
  const requestModel = stringOrBlank(value.requestModel)
  const baseUrl = stringOrBlank(value.baseUrl)
  const reverseProxy = normalizeReverseProxyOptions(value.reverseProxy)
  const openrouter = normalizeOpenrouterOptions(value.openrouter)
  const nanogpt = normalizeNanoGPTOptions(value.nanogpt)
  const ollama = normalizeOllamaOptions(value.ollama)
  if (apiKey) options.apiKey = apiKey
  if (requestModel) options.requestModel = requestModel
  if (baseUrl) options.baseUrl = baseUrl
  if (reverseProxy) options.reverseProxy = reverseProxy
  if (openrouter) options.openrouter = openrouter
  if (nanogpt) options.nanogpt = nanogpt
  if (ollama) options.ollama = ollama
  return objectHasKeys(options) ? options : undefined
}

function readModelProfileProviderOptions(value: unknown, path: string): ModelProfileRecordProviderOptions | undefined {
  if (!isRecord(value)) {
    throw new ModelProfileRecordValidationError(`${path} must be an object when present`)
  }
  for (const key of Object.keys(value)) {
    if (!MODEL_PROFILE_PROVIDER_OPTIONS_KEYS.has(key)) {
      throw new ModelProfileRecordValidationError(`${path}.${key} is not supported`)
    }
  }
  if (Object.prototype.hasOwnProperty.call(value, 'requestModel') && typeof value.requestModel !== 'string') {
    throw new ModelProfileRecordValidationError(`${path}.requestModel must be a string when present`)
  }
  if (Object.prototype.hasOwnProperty.call(value, 'apiKey') && typeof value.apiKey !== 'string') {
    throw new ModelProfileRecordValidationError(`${path}.apiKey must be a string when present`)
  }
  if (Object.prototype.hasOwnProperty.call(value, 'baseUrl') && typeof value.baseUrl !== 'string') {
    throw new ModelProfileRecordValidationError(`${path}.baseUrl must be a string when present`)
  }
  if (Object.prototype.hasOwnProperty.call(value, 'reverseProxy')) {
    readReverseProxyOptions(value.reverseProxy, `${path}.reverseProxy`)
  }
  if (Object.prototype.hasOwnProperty.call(value, 'openrouter')) {
    readOpenrouterOptions(value.openrouter, `${path}.openrouter`)
  }
  if (Object.prototype.hasOwnProperty.call(value, 'nanogpt')) {
    readNanoGPTOptions(value.nanogpt, `${path}.nanogpt`)
  }
  if (Object.prototype.hasOwnProperty.call(value, 'ollama')) {
    readOllamaOptions(value.ollama, `${path}.ollama`)
  }
  return normalizeModelProfileProviderOptions(value)
}

function normalizeReverseProxyOptions(
  value: unknown,
): NonNullable<ModelProfileRecordProviderOptions['reverseProxy']> | undefined {
  if (!isRecord(value)) return undefined
  const options: NonNullable<ModelProfileRecordProviderOptions['reverseProxy']> = {}
  if (typeof value.autofillRequestUrl === 'boolean') options.autofillRequestUrl = value.autofillRequestUrl
  if (typeof value.oobaSystemHoist === 'boolean') options.oobaSystemHoist = value.oobaSystemHoist
  if (Object.prototype.hasOwnProperty.call(value, 'oobaArgs') && value.oobaArgs !== undefined) {
    options.oobaArgs = value.oobaArgs
  }
  return objectHasKeys(options) ? options : undefined
}

function readReverseProxyOptions(
  value: unknown,
  path: string,
): NonNullable<ModelProfileRecordProviderOptions['reverseProxy']> | undefined {
  if (!isRecord(value)) {
    throw new ModelProfileRecordValidationError(`${path} must be an object when present`)
  }
  for (const key of Object.keys(value)) {
    if (!MODEL_PROFILE_REVERSE_PROXY_KEYS.has(key)) {
      throw new ModelProfileRecordValidationError(`${path}.${key} is not supported`)
    }
  }
  readOptionalBoolean(value, 'autofillRequestUrl', `${path}.autofillRequestUrl`)
  readOptionalBoolean(value, 'oobaSystemHoist', `${path}.oobaSystemHoist`)
  return normalizeReverseProxyOptions(value)
}

function normalizeOpenrouterOptions(
  value: unknown,
): NonNullable<ModelProfileRecordProviderOptions['openrouter']> | undefined {
  if (!isRecord(value)) return undefined
  const options: NonNullable<ModelProfileRecordProviderOptions['openrouter']> = {}
  if (typeof value.fallback === 'boolean') options.fallback = value.fallback
  if (typeof value.middleOut === 'boolean') options.middleOut = value.middleOut
  const provider = normalizeOpenrouterProviderOptions(value.provider)
  if (provider) options.provider = provider
  return objectHasKeys(options) ? options : undefined
}

function readOpenrouterOptions(
  value: unknown,
  path: string,
): NonNullable<ModelProfileRecordProviderOptions['openrouter']> | undefined {
  if (!isRecord(value)) {
    throw new ModelProfileRecordValidationError(`${path} must be an object when present`)
  }
  for (const key of Object.keys(value)) {
    if (!MODEL_PROFILE_OPENROUTER_KEYS.has(key)) {
      throw new ModelProfileRecordValidationError(`${path}.${key} is not supported`)
    }
  }
  readOptionalBoolean(value, 'fallback', `${path}.fallback`)
  readOptionalBoolean(value, 'middleOut', `${path}.middleOut`)
  if (Object.prototype.hasOwnProperty.call(value, 'provider')) {
    readOpenrouterProviderOptions(value.provider, `${path}.provider`)
  }
  return normalizeOpenrouterOptions(value)
}

function normalizeOpenrouterProviderOptions(
  value: unknown,
): NonNullable<NonNullable<ModelProfileRecordProviderOptions['openrouter']>['provider']> | undefined {
  if (!isRecord(value)) return undefined
  const provider: NonNullable<NonNullable<ModelProfileRecordProviderOptions['openrouter']>['provider']> = {}
  const order = normalizeStringArray(value.order)
  const only = normalizeStringArray(value.only)
  const ignore = normalizeStringArray(value.ignore)
  if (order) provider.order = order
  if (only) provider.only = only
  if (ignore) provider.ignore = ignore
  return objectHasKeys(provider) ? provider : undefined
}

function readOpenrouterProviderOptions(
  value: unknown,
  path: string,
): NonNullable<NonNullable<ModelProfileRecordProviderOptions['openrouter']>['provider']> | undefined {
  if (!isRecord(value)) {
    throw new ModelProfileRecordValidationError(`${path} must be an object when present`)
  }
  for (const key of Object.keys(value)) {
    if (!MODEL_PROFILE_OPENROUTER_PROVIDER_KEYS.has(key)) {
      throw new ModelProfileRecordValidationError(`${path}.${key} is not supported`)
    }
  }
  readOptionalStringArray(value, 'order', `${path}.order`)
  readOptionalStringArray(value, 'only', `${path}.only`)
  readOptionalStringArray(value, 'ignore', `${path}.ignore`)
  return normalizeOpenrouterProviderOptions(value)
}

function normalizeNanoGPTOptions(
  value: unknown,
): NonNullable<ModelProfileRecordProviderOptions['nanogpt']> | undefined {
  if (!isRecord(value)) return undefined
  const options: NonNullable<ModelProfileRecordProviderOptions['nanogpt']> = {}
  const providerHint = stringOrBlank(value.providerHint)
  const subscriptionState = stringOrBlank(value.subscriptionState)
  if (providerHint) options.providerHint = providerHint
  if (typeof value.useSubscriptionEndpoint === 'boolean') {
    options.useSubscriptionEndpoint = value.useSubscriptionEndpoint
  }
  if (subscriptionState) options.subscriptionState = subscriptionState
  return objectHasKeys(options) ? options : undefined
}

function readNanoGPTOptions(
  value: unknown,
  path: string,
): NonNullable<ModelProfileRecordProviderOptions['nanogpt']> | undefined {
  if (!isRecord(value)) {
    throw new ModelProfileRecordValidationError(`${path} must be an object when present`)
  }
  for (const key of Object.keys(value)) {
    if (!MODEL_PROFILE_NANOGPT_KEYS.has(key)) {
      throw new ModelProfileRecordValidationError(`${path}.${key} is not supported`)
    }
  }
  readOptionalString(value, 'providerHint', `${path}.providerHint`)
  readOptionalBoolean(value, 'useSubscriptionEndpoint', `${path}.useSubscriptionEndpoint`)
  readOptionalString(value, 'subscriptionState', `${path}.subscriptionState`)
  return normalizeNanoGPTOptions(value)
}

function normalizeOllamaOptions(value: unknown): NonNullable<ModelProfileRecordProviderOptions['ollama']> | undefined {
  if (!isRecord(value)) return undefined
  const options: NonNullable<ModelProfileRecordProviderOptions['ollama']> = {}
  const url = stringOrBlank(value.url)
  const modelSource = stringOrBlank(value.modelSource)
  const thinkingMode = stringOrBlank(value.thinkingMode)
  const requestFormat = asFormat(value.requestFormat)
  if (url) options.url = url
  if (requestFormat !== undefined) options.requestFormat = requestFormat
  if (modelSource) options.modelSource = modelSource
  if (thinkingMode) options.thinkingMode = thinkingMode
  return objectHasKeys(options) ? options : undefined
}

function readOllamaOptions(
  value: unknown,
  path: string,
): NonNullable<ModelProfileRecordProviderOptions['ollama']> | undefined {
  if (!isRecord(value)) {
    throw new ModelProfileRecordValidationError(`${path} must be an object when present`)
  }
  for (const key of Object.keys(value)) {
    if (!MODEL_PROFILE_OLLAMA_KEYS.has(key)) {
      throw new ModelProfileRecordValidationError(`${path}.${key} is not supported`)
    }
  }
  readOptionalString(value, 'url', `${path}.url`)
  if (Object.prototype.hasOwnProperty.call(value, 'requestFormat') && asFormat(value.requestFormat) === undefined) {
    throw new ModelProfileRecordValidationError(`${path}.requestFormat must be a valid LLMFormat when present`)
  }
  readOptionalString(value, 'modelSource', `${path}.modelSource`)
  readOptionalString(value, 'thinkingMode', `${path}.thinkingMode`)
  return normalizeOllamaOptions(value)
}

function normalizeModelProfileRuntimeOptions(value: unknown): ModelProfileRecordRuntimeOptions | undefined {
  if (!isRecord(value)) return undefined
  const options: ModelProfileRecordRuntimeOptions = {}

  for (const key of MODEL_PROFILE_RUNTIME_NUMBER_KEYS) {
    const numeric = finiteNumber(value[key])
    if (numeric !== undefined) options[key] = numeric
  }
  for (const key of MODEL_PROFILE_RUNTIME_STRING_KEYS) {
    const normalized = stringOrBlank(value[key])
    if (normalized) options[key] = normalized
  }
  for (const key of MODEL_PROFILE_RUNTIME_BOOLEAN_KEYS) {
    if (typeof value[key] === 'boolean') options[key] = value[key]
  }

  if (Object.prototype.hasOwnProperty.call(value, 'dynamicOutput') && value.dynamicOutput !== undefined) {
    options.dynamicOutput = value.dynamicOutput
  }

  const modelTools = normalizeRuntimeStringArray(value.modelTools)
  if (modelTools) options.modelTools = modelTools

  const customFlags = normalizeRuntimeCustomFlags(value.customFlags)
  if (customFlags) options.customFlags = customFlags

  return objectHasKeys(options) ? options : undefined
}

function readModelProfileRuntimeOptions(value: unknown, path: string): ModelProfileRecordRuntimeOptions | undefined {
  if (!isRecord(value)) {
    throw new ModelProfileRecordValidationError(`${path} must be an object when present`)
  }

  for (const key of Object.keys(value)) {
    if (!MODEL_PROFILE_RUNTIME_KEYS.has(key)) {
      throw new ModelProfileRecordValidationError(`${path}.${key} is not supported`)
    }
  }

  for (const key of MODEL_PROFILE_RUNTIME_NUMBER_KEYS) {
    readOptionalFiniteNumber(value, key, `${path}.${key}`)
  }
  for (const key of MODEL_PROFILE_RUNTIME_STRING_KEYS) {
    readOptionalString(value, key, `${path}.${key}`)
  }
  for (const key of MODEL_PROFILE_RUNTIME_BOOLEAN_KEYS) {
    readOptionalBoolean(value, key, `${path}.${key}`)
  }
  readOptionalStringArray(value, 'modelTools', `${path}.modelTools`)
  readOptionalLLMFlagArray(value, 'customFlags', `${path}.customFlags`)

  return normalizeModelProfileRuntimeOptions(value)
}

function readModelRoleProfileBinding(value: unknown, role: ModelRole, path: string): ModelRoleProfileBinding {
  if (!isRecord(value)) {
    throw new ModelProfileRecordValidationError(`${path} must be an object`)
  }
  for (const key of Object.keys(value)) {
    if (!MODEL_ROLE_PROFILE_BINDING_KEYS.has(key)) {
      throw new ModelProfileRecordValidationError(`${path}.${key} is not supported`)
    }
  }
  if (value.mode === 'legacy') {
    if (Object.prototype.hasOwnProperty.call(value, 'profileId')) {
      throw new ModelProfileRecordValidationError(`${path}.profileId is only supported for profile mode`)
    }
    return { mode: 'legacy' }
  }
  if (value.mode === 'inherit') {
    if (Object.prototype.hasOwnProperty.call(value, 'profileId')) {
      throw new ModelProfileRecordValidationError(`${path}.profileId is only supported for profile mode`)
    }
    if (!modelRoleProfileInheritSource(role)) {
      throw new ModelProfileRecordValidationError(`${path}.mode does not support inherit`)
    }
    return { mode: 'inherit' }
  }
  if (value.mode === 'profile') {
    const profileId = stringOrBlank(value.profileId)
    if (!profileId) {
      throw new ModelProfileRecordValidationError(`${path}.profileId must be a non-empty string`)
    }
    return { mode: 'profile', profileId }
  }

  throw new ModelProfileRecordValidationError(`${path}.mode must be legacy, inherit, or profile`)
}

function normalizeModelRoleProfileBinding(value: unknown, role: ModelRole): ModelRoleProfileBinding | null {
  if (!isRecord(value)) return null
  if (value.mode === 'legacy') return { mode: 'legacy' }
  if (value.mode === 'inherit') {
    return modelRoleProfileInheritSource(role) && Object.keys(value).length === 1 ? { mode: 'inherit' } : null
  }
  if (value.mode !== 'profile') return null
  const profileId = stringOrBlank(value.profileId)
  return profileId ? { mode: 'profile', profileId } : null
}

function readOptionalString(value: Record<string, unknown>, key: string, path: string): void {
  if (Object.prototype.hasOwnProperty.call(value, key) && typeof value[key] !== 'string') {
    throw new ModelProfileRecordValidationError(`${path} must be a string when present`)
  }
}

function readOptionalBoolean(value: Record<string, unknown>, key: string, path: string): void {
  if (Object.prototype.hasOwnProperty.call(value, key) && typeof value[key] !== 'boolean') {
    throw new ModelProfileRecordValidationError(`${path} must be a boolean when present`)
  }
}

function readOptionalFiniteNumber(value: Record<string, unknown>, key: string, path: string): void {
  if (!Object.prototype.hasOwnProperty.call(value, key)) return
  if (typeof value[key] !== 'number' || !Number.isFinite(value[key])) {
    throw new ModelProfileRecordValidationError(`${path} must be a finite number when present`)
  }
}

function readOptionalStringArray(value: Record<string, unknown>, key: string, path: string): void {
  if (!Object.prototype.hasOwnProperty.call(value, key)) return
  const row = value[key]
  if (!Array.isArray(row) || !row.every((item) => typeof item === 'string')) {
    throw new ModelProfileRecordValidationError(`${path} must be an array of strings when present`)
  }
}

function readOptionalLLMFlagArray(value: Record<string, unknown>, key: string, path: string): void {
  if (!Object.prototype.hasOwnProperty.call(value, key)) return
  const row = value[key]
  if (!Array.isArray(row) || !row.every((item) => typeof item === 'number' && LLM_FLAG_SET.has(item))) {
    throw new ModelProfileRecordValidationError(
      `${path} must be an array of valid LLMFlags numeric values when present`,
    )
  }
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out = value.flatMap((item) => {
    const normalized = stringOrBlank(item)
    return normalized ? [normalized] : []
  })
  return out.length > 0 ? out : undefined
}

function normalizeRuntimeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.flatMap((item) => {
    const normalized = stringOrBlank(item)
    return normalized ? [normalized] : []
  })
}

function normalizeRuntimeCustomFlags(value: unknown): LLMFlagValue[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.flatMap((item) => (typeof item === 'number' && LLM_FLAG_SET.has(item) ? [item as LLMFlagValue] : []))
}

function asFormat(value: unknown): LLMFormatValue | undefined {
  return typeof value === 'number' && Object.values(LLMFormat).includes(value as LLMFormatValue)
    ? (value as LLMFormatValue)
    : undefined
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function objectHasKeys(value: object): boolean {
  return Object.keys(value).length > 0
}

function stringOrBlank(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
