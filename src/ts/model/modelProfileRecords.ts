import { MODEL_ROLES, modelRoleProfileInheritSource, type ModelRole } from './modelRoles'
import {
  LLMFlags,
  LLMFormat,
  LLMTokenizer,
  type LLMFlags as LLMFlagValue,
  type LLMFormat as LLMFormatValue,
  type LLMTokenizer as LLMTokenizerValue,
} from './types'

export interface ModelProfileRecord {
  id: string
  name: string
  providerId?: string
  modelId?: string
  providerOptions?: ModelProfileRecordProviderOptions
  runtimeOptions?: ModelProfileRecordRuntimeOptions
  fallbacks?: ModelProfileRecordFallbackRef[]
}

export const LLM_GATEWAY_REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
export const LLM_GATEWAY_VERBOSITIES = ['low', 'medium', 'high'] as const
export const LLM_GATEWAY_SERVICE_TIERS = ['auto', 'default', 'flex', 'priority'] as const
export const LLM_GATEWAY_ROUTING_STRATEGIES = ['auto', 'price', 'throughput', 'latency'] as const

export type LLMGatewayReasoningEffort = (typeof LLM_GATEWAY_REASONING_EFFORTS)[number]
export type LLMGatewayVerbosity = (typeof LLM_GATEWAY_VERBOSITIES)[number]
export type LLMGatewayServiceTier = (typeof LLM_GATEWAY_SERVICE_TIERS)[number]
export type LLMGatewayRoutingStrategy = (typeof LLM_GATEWAY_ROUTING_STRATEGIES)[number]

export type ModelProfileRecordFallbackRef =
  | {
      mode: 'profile'
      profileId: string
    }
  | {
      mode: 'model'
      modelId: string
    }

export interface ModelProfileRecordProviderOptions {
  credentialId?: string
  requestModel?: string
  baseUrl?: string
  extraHeaders?: Record<string, string>
  additionalParams?: Array<[string, string]>
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
  llmGateway?: {
    reasoningEffort?: LLMGatewayReasoningEffort
    verbosity?: LLMGatewayVerbosity
    serviceTier?: LLMGatewayServiceTier
    routing?: LLMGatewayRoutingStrategy
  }
  ollama?: {
    url?: string
    requestFormat?: LLMFormatValue
    modelSource?: string
    thinkingMode?: string
  }
  vertex?: {
    projectId?: string
    region?: string
  }
  customApi?: {
    tokenizer?: LLMTokenizerValue
    flags?: LLMFlagValue[]
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
  halfStreaming?: boolean
  useStreaming?: boolean
  jsonSchemaEnabled?: boolean
  strictJsonSchema?: boolean
  outputImageModal?: boolean
  enableCustomFlags?: boolean
  stripCoT?: boolean
  dynamicOutput?: unknown
  modelTools?: string[]
  customFlags?: LLMFlagValue[]
}

export type ModelRuntimeDefaults = ModelProfileRecordRuntimeOptions

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

const MODEL_PROFILE_RECORD_KEYS = new Set([
  'id',
  'name',
  'providerId',
  'modelId',
  'providerOptions',
  'runtimeOptions',
  'fallbacks',
])
const MODEL_PROFILE_FALLBACK_REF_KEYS = new Set(['mode', 'profileId', 'modelId'])
const MODEL_PROFILE_PROVIDER_OPTIONS_KEYS = new Set([
  'apiKey',
  'credentialId',
  'requestModel',
  'baseUrl',
  'extraHeaders',
  'additionalParams',
  'reverseProxy',
  'openrouter',
  'nanogpt',
  'llmGateway',
  'ollama',
  'vertex',
  'customApi',
])
const MODEL_PROFILE_REVERSE_PROXY_KEYS = new Set(['autofillRequestUrl', 'oobaSystemHoist', 'oobaArgs'])
const MODEL_PROFILE_OPENROUTER_KEYS = new Set(['fallback', 'middleOut', 'provider'])
const MODEL_PROFILE_OPENROUTER_PROVIDER_KEYS = new Set(['order', 'only', 'ignore'])
const MODEL_PROFILE_NANOGPT_KEYS = new Set(['providerHint', 'useSubscriptionEndpoint', 'subscriptionState'])
const MODEL_PROFILE_LLM_GATEWAY_KEYS = new Set(['reasoningEffort', 'verbosity', 'serviceTier', 'routing'])
const MODEL_PROFILE_OLLAMA_KEYS = new Set(['url', 'requestFormat', 'modelSource', 'thinkingMode'])
const MODEL_PROFILE_VERTEX_KEYS = new Set(['projectId', 'region', 'clientEmail', 'privateKey'])
const MODEL_PROFILE_CUSTOM_API_KEYS = new Set(['tokenizer', 'flags'])
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
  'halfStreaming',
  'useStreaming',
  'jsonSchemaEnabled',
  'strictJsonSchema',
  'outputImageModal',
  'enableCustomFlags',
  'stripCoT',
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
const LLM_TOKENIZER_SET = new Set<number>(Object.values(LLMTokenizer))
const LLM_GATEWAY_REASONING_EFFORT_SET = new Set<string>(LLM_GATEWAY_REASONING_EFFORTS)
const LLM_GATEWAY_VERBOSITY_SET = new Set<string>(LLM_GATEWAY_VERBOSITIES)
const LLM_GATEWAY_SERVICE_TIER_SET = new Set<string>(LLM_GATEWAY_SERVICE_TIERS)
const LLM_GATEWAY_ROUTING_STRATEGY_SET = new Set<string>(LLM_GATEWAY_ROUTING_STRATEGIES)

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
    const providerId = stringOrBlank(item.providerId)
    const modelId = stringOrBlank(item.modelId)
    profiles.push(
      createModelProfileRecord({
        id,
        name,
        providerId,
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

  if (Object.prototype.hasOwnProperty.call(value, 'providerId') && typeof value.providerId !== 'string') {
    throw new ModelProfileRecordValidationError(`${path}.providerId must be a string when present`)
  }
  if (Object.prototype.hasOwnProperty.call(value, 'modelId') && typeof value.modelId !== 'string') {
    throw new ModelProfileRecordValidationError(`${path}.modelId must be a string when present`)
  }
  const providerId = stringOrBlank(value.providerId)
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

  return createModelProfileRecord({ id, name, providerId, modelId, providerOptions, runtimeOptions, fallbacks })
}

function createModelProfileRecord(input: {
  id: string
  name: string
  providerId?: string
  modelId?: string
  providerOptions?: ModelProfileRecordProviderOptions
  runtimeOptions?: ModelProfileRecordRuntimeOptions
  fallbacks?: ModelProfileRecordFallbackRef[]
}): ModelProfileRecord {
  return {
    id: input.id,
    name: input.name,
    ...(input.providerId ? { providerId: input.providerId } : {}),
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
    if (!isRecord(item)) continue
    if (item.mode === 'profile') {
      const profileId = stringOrBlank(item.profileId)
      const key = `profile:${profileId}`
      if (!profileId || seen.has(key)) continue
      fallbacks.push({ mode: 'profile', profileId })
      seen.add(key)
      continue
    }
    if (item.mode === 'model') {
      const modelId = stringOrBlank(item.modelId)
      const key = `model:${modelId}`
      if (!modelId || seen.has(key)) continue
      fallbacks.push({ mode: 'model', modelId })
      seen.add(key)
    }
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
    if (item.mode === 'profile') {
      if (Object.prototype.hasOwnProperty.call(item, 'modelId')) {
        throw new ModelProfileRecordValidationError(`${rowPath}.modelId is only supported for model mode`)
      }
      const profileId = stringOrBlank(item.profileId)
      if (!profileId) {
        throw new ModelProfileRecordValidationError(`${rowPath}.profileId must be a non-empty string`)
      }
      const key = `profile:${profileId}`
      if (seen.has(key)) {
        throw new ModelProfileRecordValidationError(`${rowPath}.profileId must not duplicate ${profileId}`)
      }
      seen.add(key)
      fallbacks.push({ mode: 'profile', profileId })
      return
    }
    if (item.mode === 'model') {
      if (Object.prototype.hasOwnProperty.call(item, 'profileId')) {
        throw new ModelProfileRecordValidationError(`${rowPath}.profileId is only supported for profile mode`)
      }
      const modelId = stringOrBlank(item.modelId)
      if (!modelId) {
        throw new ModelProfileRecordValidationError(`${rowPath}.modelId must be a non-empty string`)
      }
      const key = `model:${modelId}`
      if (seen.has(key)) {
        throw new ModelProfileRecordValidationError(`${rowPath}.modelId must not duplicate ${modelId}`)
      }
      seen.add(key)
      fallbacks.push({ mode: 'model', modelId })
      return
    }
    throw new ModelProfileRecordValidationError(`${rowPath}.mode must be profile or model`)
  })
  return fallbacks.length > 0 ? fallbacks : undefined
}

export function normalizeModelProfileProviderOptions(value: unknown): ModelProfileRecordProviderOptions | undefined {
  if (!isRecord(value)) return undefined
  const options: ModelProfileRecordProviderOptions = {}
  const credentialId = stringOrBlank(value.credentialId)
  const requestModel = stringOrBlank(value.requestModel)
  const baseUrl = stringOrBlank(value.baseUrl)
  const extraHeaders = normalizeStringRecord(value.extraHeaders)
  const additionalParams = normalizeAdditionalParams(value.additionalParams)
  const reverseProxy = normalizeReverseProxyOptions(value.reverseProxy)
  const openrouter = normalizeOpenrouterOptions(value.openrouter)
  const nanogpt = normalizeNanoGPTOptions(value.nanogpt)
  const llmGateway = normalizeLLMGatewayOptions(value.llmGateway)
  const ollama = normalizeOllamaOptions(value.ollama)
  const vertex = normalizeVertexOptions(value.vertex)
  const customApi = normalizeCustomApiOptions(value.customApi)
  if (credentialId) options.credentialId = credentialId
  if (requestModel) options.requestModel = requestModel
  if (baseUrl) options.baseUrl = baseUrl
  if (extraHeaders) options.extraHeaders = extraHeaders
  if (additionalParams) options.additionalParams = additionalParams
  if (reverseProxy) options.reverseProxy = reverseProxy
  if (openrouter) options.openrouter = openrouter
  if (nanogpt) options.nanogpt = nanogpt
  if (llmGateway) options.llmGateway = llmGateway
  if (ollama) options.ollama = ollama
  if (vertex) options.vertex = vertex
  if (customApi) options.customApi = customApi
  return objectHasKeys(options) ? options : undefined
}

export function readModelProfileProviderOptions(
  value: unknown,
  path = 'providerOptions',
): ModelProfileRecordProviderOptions | undefined {
  if (!isRecord(value)) {
    throw new ModelProfileRecordValidationError(`${path} must be an object when present`)
  }
  for (const key of Object.keys(value)) {
    if (!MODEL_PROFILE_PROVIDER_OPTIONS_KEYS.has(key)) {
      throw new ModelProfileRecordValidationError(`${path}.${key} is not supported`)
    }
  }
  if (Object.prototype.hasOwnProperty.call(value, 'apiKey')) {
    throw new ModelProfileRecordValidationError(
      `${path}.apiKey is no longer supported; reference a credential via ${path}.credentialId`,
    )
  }
  if (Object.prototype.hasOwnProperty.call(value, 'credentialId')) {
    if (typeof value.credentialId !== 'string' || !stringOrBlank(value.credentialId)) {
      throw new ModelProfileRecordValidationError(`${path}.credentialId must be a non-empty string when present`)
    }
  }
  if (Object.prototype.hasOwnProperty.call(value, 'requestModel') && typeof value.requestModel !== 'string') {
    throw new ModelProfileRecordValidationError(`${path}.requestModel must be a string when present`)
  }
  if (Object.prototype.hasOwnProperty.call(value, 'baseUrl') && typeof value.baseUrl !== 'string') {
    throw new ModelProfileRecordValidationError(`${path}.baseUrl must be a string when present`)
  }
  readOptionalStringRecord(value, 'extraHeaders', `${path}.extraHeaders`)
  readOptionalAdditionalParams(value, 'additionalParams', `${path}.additionalParams`)
  if (Object.prototype.hasOwnProperty.call(value, 'reverseProxy')) {
    readReverseProxyOptions(value.reverseProxy, `${path}.reverseProxy`)
  }
  if (Object.prototype.hasOwnProperty.call(value, 'openrouter')) {
    readOpenrouterOptions(value.openrouter, `${path}.openrouter`)
  }
  if (Object.prototype.hasOwnProperty.call(value, 'nanogpt')) {
    readNanoGPTOptions(value.nanogpt, `${path}.nanogpt`)
  }
  if (Object.prototype.hasOwnProperty.call(value, 'llmGateway')) {
    readLLMGatewayOptions(value.llmGateway, `${path}.llmGateway`)
  }
  if (Object.prototype.hasOwnProperty.call(value, 'ollama')) {
    readOllamaOptions(value.ollama, `${path}.ollama`)
  }
  if (Object.prototype.hasOwnProperty.call(value, 'vertex')) {
    readVertexOptions(value.vertex, `${path}.vertex`)
  }
  if (Object.prototype.hasOwnProperty.call(value, 'customApi')) {
    readCustomApiOptions(value.customApi, `${path}.customApi`)
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

function normalizeLLMGatewayOptions(
  value: unknown,
): NonNullable<ModelProfileRecordProviderOptions['llmGateway']> | undefined {
  if (!isRecord(value)) return undefined
  const options: NonNullable<ModelProfileRecordProviderOptions['llmGateway']> = {}
  if (typeof value.reasoningEffort === 'string' && LLM_GATEWAY_REASONING_EFFORT_SET.has(value.reasoningEffort)) {
    options.reasoningEffort = value.reasoningEffort as LLMGatewayReasoningEffort
  }
  if (typeof value.verbosity === 'string' && LLM_GATEWAY_VERBOSITY_SET.has(value.verbosity)) {
    options.verbosity = value.verbosity as LLMGatewayVerbosity
  }
  if (typeof value.serviceTier === 'string' && LLM_GATEWAY_SERVICE_TIER_SET.has(value.serviceTier)) {
    options.serviceTier = value.serviceTier as LLMGatewayServiceTier
  }
  if (typeof value.routing === 'string' && LLM_GATEWAY_ROUTING_STRATEGY_SET.has(value.routing)) {
    options.routing = value.routing as LLMGatewayRoutingStrategy
  }
  return objectHasKeys(options) ? options : undefined
}

function readLLMGatewayOptions(
  value: unknown,
  path: string,
): NonNullable<ModelProfileRecordProviderOptions['llmGateway']> | undefined {
  if (!isRecord(value)) {
    throw new ModelProfileRecordValidationError(`${path} must be an object when present`)
  }
  for (const key of Object.keys(value)) {
    if (!MODEL_PROFILE_LLM_GATEWAY_KEYS.has(key)) {
      throw new ModelProfileRecordValidationError(`${path}.${key} is not supported`)
    }
  }
  readOptionalEnum(
    value,
    'reasoningEffort',
    LLM_GATEWAY_REASONING_EFFORT_SET,
    `${path}.reasoningEffort`,
    LLM_GATEWAY_REASONING_EFFORTS,
  )
  readOptionalEnum(value, 'verbosity', LLM_GATEWAY_VERBOSITY_SET, `${path}.verbosity`, LLM_GATEWAY_VERBOSITIES)
  readOptionalEnum(value, 'serviceTier', LLM_GATEWAY_SERVICE_TIER_SET, `${path}.serviceTier`, LLM_GATEWAY_SERVICE_TIERS)
  readOptionalEnum(
    value,
    'routing',
    LLM_GATEWAY_ROUTING_STRATEGY_SET,
    `${path}.routing`,
    LLM_GATEWAY_ROUTING_STRATEGIES,
  )
  return normalizeLLMGatewayOptions(value)
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

function normalizeVertexOptions(value: unknown): NonNullable<ModelProfileRecordProviderOptions['vertex']> | undefined {
  if (!isRecord(value)) return undefined
  const options: NonNullable<ModelProfileRecordProviderOptions['vertex']> = {}
  const projectId = stringOrBlank(value.projectId)
  const region = stringOrBlank(value.region)
  if (projectId) options.projectId = projectId
  if (region) options.region = region
  return objectHasKeys(options) ? options : undefined
}

function readVertexOptions(
  value: unknown,
  path: string,
): NonNullable<ModelProfileRecordProviderOptions['vertex']> | undefined {
  if (!isRecord(value)) {
    throw new ModelProfileRecordValidationError(`${path} must be an object when present`)
  }
  for (const key of Object.keys(value)) {
    if (!MODEL_PROFILE_VERTEX_KEYS.has(key)) {
      throw new ModelProfileRecordValidationError(`${path}.${key} is not supported`)
    }
  }
  if (Object.prototype.hasOwnProperty.call(value, 'clientEmail')) {
    throw new ModelProfileRecordValidationError(
      `${path}.clientEmail is no longer supported; reference a credential via providerOptions.credentialId`,
    )
  }
  if (Object.prototype.hasOwnProperty.call(value, 'privateKey')) {
    throw new ModelProfileRecordValidationError(
      `${path}.privateKey is no longer supported; reference a credential via providerOptions.credentialId`,
    )
  }
  readOptionalString(value, 'projectId', `${path}.projectId`)
  readOptionalString(value, 'region', `${path}.region`)
  return normalizeVertexOptions(value)
}

function normalizeCustomApiOptions(
  value: unknown,
): NonNullable<ModelProfileRecordProviderOptions['customApi']> | undefined {
  if (!isRecord(value)) return undefined
  const options: NonNullable<ModelProfileRecordProviderOptions['customApi']> = {}
  const tokenizer = asTokenizer(value.tokenizer)
  const flags = normalizeRuntimeCustomFlags(value.flags)
  if (tokenizer !== undefined) options.tokenizer = tokenizer
  if (flags) options.flags = flags
  return objectHasKeys(options) ? options : undefined
}

function readCustomApiOptions(
  value: unknown,
  path: string,
): NonNullable<ModelProfileRecordProviderOptions['customApi']> | undefined {
  if (!isRecord(value)) {
    throw new ModelProfileRecordValidationError(`${path} must be an object when present`)
  }
  for (const key of Object.keys(value)) {
    if (!MODEL_PROFILE_CUSTOM_API_KEYS.has(key)) {
      throw new ModelProfileRecordValidationError(`${path}.${key} is not supported`)
    }
  }
  if (Object.prototype.hasOwnProperty.call(value, 'tokenizer') && asTokenizer(value.tokenizer) === undefined) {
    throw new ModelProfileRecordValidationError(`${path}.tokenizer must be a valid LLMTokenizer when present`)
  }
  readOptionalLLMFlagArray(value, 'flags', `${path}.flags`)
  return normalizeCustomApiOptions(value)
}

export function normalizeModelProfileRuntimeOptions(value: unknown): ModelProfileRecordRuntimeOptions | undefined {
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

export function normalizeModelRuntimeDefaults(value: unknown): ModelRuntimeDefaults {
  return normalizeModelProfileRuntimeOptions(value) ?? {}
}

export function readModelRuntimeDefaults(value: unknown): ModelRuntimeDefaults {
  return readModelProfileRuntimeOptions(value, 'modelRuntimeDefaults') ?? {}
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

function readOptionalEnum(
  value: Record<string, unknown>,
  key: string,
  allowed: ReadonlySet<string>,
  path: string,
  values: readonly string[],
): void {
  if (!Object.prototype.hasOwnProperty.call(value, key)) return
  if (typeof value[key] !== 'string' || !allowed.has(value[key])) {
    throw new ModelProfileRecordValidationError(`${path} must be one of ${values.join(', ')} when present`)
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

function readOptionalStringRecord(value: Record<string, unknown>, key: string, path: string): void {
  if (!Object.prototype.hasOwnProperty.call(value, key)) return
  const row = value[key]
  if (!isRecord(row) || !Object.values(row).every((item) => typeof item === 'string')) {
    throw new ModelProfileRecordValidationError(`${path} must be an object with string values when present`)
  }
}

function readOptionalAdditionalParams(value: Record<string, unknown>, key: string, path: string): void {
  if (!Object.prototype.hasOwnProperty.call(value, key)) return
  const row = value[key]
  if (
    !Array.isArray(row) ||
    !row.every(
      (item) => Array.isArray(item) && item.length === 2 && typeof item[0] === 'string' && typeof item[1] === 'string',
    )
  ) {
    throw new ModelProfileRecordValidationError(`${path} must be an array of [string, string] pairs when present`)
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

function normalizeStringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined
  const out: Record<string, string> = {}
  for (const [rawKey, rawValue] of Object.entries(value)) {
    if (typeof rawValue !== 'string') continue
    const key = rawKey.trim()
    if (!key) continue
    out[key] = rawValue.trim()
  }
  return objectHasKeys(out) ? out : undefined
}

function normalizeAdditionalParams(value: unknown): Array<[string, string]> | undefined {
  if (!Array.isArray(value)) return undefined
  const out: Array<[string, string]> = []
  for (const row of value) {
    if (!Array.isArray(row) || typeof row[0] !== 'string' || typeof row[1] !== 'string') continue
    const key = row[0].trim()
    if (!key) continue
    out.push([key, row[1].trim()])
  }
  return out.length > 0 ? out : undefined
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

function asTokenizer(value: unknown): LLMTokenizerValue | undefined {
  return typeof value === 'number' && LLM_TOKENIZER_SET.has(value) ? (value as LLMTokenizerValue) : undefined
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
