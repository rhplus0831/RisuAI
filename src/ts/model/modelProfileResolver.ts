import type { Database } from '../storage/database.svelte'
import {
  LEGACY_FALLBACK_MODEL_KEYS,
  type LegacyFallbackModelKey,
  type LegacyModelMode,
  type ModelRole,
  type ModelRoleLike,
  modelRoleProfileInheritSource,
  modelRoleToLegacyModelMode,
  normalizeLegacyFallbackModels,
  normalizeModelRole,
  normalizeModelRoleOverrides,
  resolveModelForRole,
} from './modelRoles'
import {
  ClaudeParameters,
  LLMFlags,
  LLMFormat,
  LLMProvider,
  LLMTokenizer,
  OpenAIParameters,
  ProviderNames,
  type LLMModel,
  type LLMTokenizer as LLMTokenizerValue,
} from './types'
import { AnthropicModels } from './providers/anthropic'
import { GoogleModels } from './providers/google'
import { OpenAIModels } from './providers/openai'
import {
  resolveProviderCapability,
  type CustomModelEntryLike,
  type ProviderCapabilityInput,
  type ProviderCapabilityVerdict,
  type ProviderUnsupportedReason,
} from '../process/request/providerCapability'
import {
  normalizeModelRuntimeDefaults,
  normalizeModelProfiles,
  normalizeModelRoleProfiles,
  type ModelProfileRecord,
  type ModelProfileRecordFallbackRef,
  type ModelProfileRecordProviderOptions,
  type ModelProfileRecordRuntimeOptions,
} from './modelProfileRecords'
import { normalizeProviderCredentials, type ProviderCredentialRecord } from './providerCredentialRecords'

export type ModelProfileSourceKind =
  | 'staticModel'
  | 'legacy-aiModel'
  | 'legacy-subModel'
  | 'legacy-modelRoles'
  | 'legacy-seperateModels'
  | 'legacy-inherit'
  | 'durable-profile'

export interface ModelProfileResolutionSource {
  kind: ModelProfileSourceKind
  role: ModelRole
  legacyMode: LegacyModelMode
  field?: string
  profileId?: string
  profileName?: string
  bypassesRoleResolution: boolean
}

export const FIRST_CLASS_MODEL_PROFILE_PROVIDER_IDS = [
  'openai',
  'anthropic',
  'google',
  'vertex',
  'ollama',
  'custom-api',
  'debug-echo',
] as const

export type FirstClassModelProfileProviderId = (typeof FIRST_CLASS_MODEL_PROFILE_PROVIDER_IDS)[number]

export type ModelProfileStatusBucket = 'ready' | 'incomplete' | 'compatibility' | 'unsupported'

export type ModelProfileStatusReason =
  | 'legacy-mode'
  | 'static-model'
  | 'missing-provider-id'
  | 'inferred-provider-id'
  | 'profile-not-found'
  | 'profile-model-missing'
  | 'credential-missing'
  | 'api-key-missing'
  | 'base-url-missing'
  | 'request-model-missing'
  | 'vertex-project-id-missing'
  | 'vertex-region-missing'
  | 'vertex-client-email-missing'
  | 'vertex-private-key-missing'
  | 'unsupported-provider-id'
  | 'unsupported-model'
  | 'provider-capability-incomplete'
  | 'provider-capability-unsupported'

export interface ModelProfileStatus {
  bucket: ModelProfileStatusBucket
  reasons: ModelProfileStatusReason[]
  providerId?: FirstClassModelProfileProviderId
  providerIdSource?: 'explicit' | 'inferred'
  unsupportedProviderId?: string
  providerCapabilityReason?: ProviderUnsupportedReason
}

export interface ResolvedModelProfileModelInfo extends LLMModel {
  unsupportedReason?: string
}

export interface CustomModelProfileDependency {
  id: string
  internalId?: string
  url?: string
  key?: string
  format?: LLMFormat
  tokenizer?: LLMTokenizerValue
  params?: string
  flags?: LLMFlags[]
}

export type ModelProfileFallbackRef =
  | {
      kind: 'legacy-model-id'
      fallbackKey: LegacyFallbackModelKey
      modelId: string
    }
  | {
      kind: 'profile-id'
      profileId: string
    }

export interface ModelProfileProviderOptions {
  provider?: string
  apiKey?: string
  baseUrl?: string
  endpoint?: string
  keyIdentifier?: string
  extraHeaders?: Record<string, string>
  additionalParams?: Array<[string, string]>
  requestModel: string
  customModel?: CustomModelProfileDependency
  reverseProxy?: {
    autofillRequestUrl: boolean
    oobaSystemHoist: boolean
    oobaArgs?: unknown
    risuIdentify?: boolean
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
    apiKey?: string
    requestFormat?: LLMFormat
    model?: string
    modelSource?: string
    thinkingMode?: string
    cloud: boolean
  }
  vertex?: {
    projectId?: string
    region?: string
    clientEmail?: string
    privateKey?: string
  }
}

export interface ModelProfileRuntimeOptions {
  maxContext?: number
  maxResponse?: number
  temperature?: number
  rawTemperature?: number
  topP?: number
  topK?: number
  minP?: number
  topA?: number
  repetitionPenalty?: number
  frequencyPenalty?: number
  presencePenalty?: number
  reasoningEffort?: number
  thinkingTokens?: number
  thinkingType?: string
  deepseekThinkingType?: string
  adaptiveThinkingEffort?: string
  deepseekReasoningEffort?: string
  verbosity?: number
  useStreaming?: boolean
  genTime?: number
  extractJson?: string
  jsonSchemaEnabled?: boolean
  jsonSchema?: string
  strictJsonSchema?: boolean
  outputImageModal?: boolean
  dynamicOutput?: unknown
  modelTools: string[]
  enableCustomFlags?: boolean
  customFlags?: LLMFlags[]
  customTokenizer?: string
}

export interface ResolvedModelProfile {
  role: ModelRole
  legacyMode: LegacyModelMode
  profileId: string
  legacy: true
  source: ModelProfileResolutionSource
  modelId: string
  requestModel: string
  modelInfo: ResolvedModelProfileModelInfo
  providerOptions: ModelProfileProviderOptions
  runtimeOptions: ModelProfileRuntimeOptions
  providerCapabilityInput: ProviderCapabilityInput
  providerCapability: ProviderCapabilityVerdict
  status: ModelProfileStatus
  fallbacks: ModelProfileFallbackRef[]
}

export interface ResolveModelProfileArgs {
  database: Database
  role?: ModelRoleLike
  staticModel?: string | null
  lookupModelInfo?: (database: Database, modelId: string) => LLMModel | null | undefined
}

interface ModelProfileSelection {
  modelId: string
  profileId?: string
  profileRequestModel?: string
  profileProviderOptions?: EffectiveModelProfileRecordProviderOptions
  profileRuntimeOptions?: ModelProfileRecordRuntimeOptions
  profileFallbacks?: ModelProfileRecordFallbackRef[]
  profileProviderId?: string
  profileStatusReasons?: ModelProfileStatusReason[]
  source: ModelProfileResolutionSource
}

interface EffectiveModelProfileRecordProviderOptions extends ModelProfileRecordProviderOptions {
  apiKey?: string
  vertex?: NonNullable<ModelProfileRecordProviderOptions['vertex']> & {
    clientEmail?: string
    privateKey?: string
  }
}

const DEFAULT_OPENAI_FLAGS = [LLMFlags.hasFullSystemPrompt, LLMFlags.hasStreaming]
const FIRST_SYSTEM_FLAGS = [LLMFlags.hasFirstSystemPrompt]
const ALTERNATING_FLAGS = [
  LLMFlags.hasFirstSystemPrompt,
  LLMFlags.requiresAlternateRole,
  LLMFlags.mustStartWithUserInput,
]
const OPENAI_WITH_IMAGE_FLAGS = [LLMFlags.hasFullSystemPrompt, LLMFlags.hasImageInput, LLMFlags.hasStreaming]
const OPENAI_EXTENDED_PARAMETERS = [
  'temperature',
  'top_p',
  'frequency_penalty',
  'presence_penalty',
  'repetition_penalty',
  'min_p',
  'top_a',
  'top_k',
  'thinking_tokens',
] as LLMModel['parameters']
const NANOGPT_BASE_URL = 'https://nano-gpt.com/api/v1'
const NANOGPT_SUBSCRIPTION_BASE_URL = 'https://nano-gpt.com/api/subscription/v1'
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'
const FIRST_CLASS_MODEL_PROFILE_PROVIDER_ID_SET = new Set<string>(FIRST_CLASS_MODEL_PROFILE_PROVIDER_IDS)
const OPENAI_MODEL_IDS = new Set(
  OpenAIModels.flatMap((model) => [model.id, model.internalID]).filter(
    (id): id is string => typeof id === 'string' && id.length > 0,
  ),
)
const ANTHROPIC_MODEL_IDS = new Set(
  AnthropicModels.flatMap((model) => [model.id, model.internalID]).filter(
    (id): id is string => typeof id === 'string' && id.length > 0,
  ),
)
const GOOGLE_MODEL_IDS = new Set(
  GoogleModels.flatMap((model) => [model.id, model.internalID]).filter(
    (id): id is string => typeof id === 'string' && id.length > 0,
  ),
)
const HARD_RUNTIME_DEFAULTS: ModelProfileRecordRuntimeOptions = {
  maxContext: 4000,
  maxResponse: 500,
  temperature: 80,
  topP: 1,
  topK: 0,
  minP: 0,
  topA: 0,
  repetitionPenalty: 1,
  frequencyPenalty: 70,
  presencePenalty: 70,
  reasoningEffort: 0,
  thinkingType: 'budget',
  deepseekThinkingType: 'off',
  adaptiveThinkingEffort: 'high',
  deepseekReasoningEffort: 'high',
  verbosity: 1,
  useStreaming: false,
  genTime: 1,
  extractJson: '',
  jsonSchemaEnabled: false,
  jsonSchema: '',
  strictJsonSchema: true,
  outputImageModal: false,
  modelTools: [],
  enableCustomFlags: false,
  customFlags: [],
  customTokenizer: 'tik',
}

const SERVER_SAFE_MODELS: LLMModel[] = [
  ...OpenAIModels,
  ...OpenAIModels.filter((model) => model.format === LLMFormat.OpenAICompatible).map((model) => ({
    ...model,
    format: LLMFormat.OpenAIResponseAPI,
    flags: [...model.flags, LLMFlags.hasPrefill],
    id: `${model.id}-response-api`,
    name: `${model.name} (Response API)`,
    fullName: `${model.fullName ?? model.name} (Response API)`,
    recommended: false,
  })),
  ...AnthropicModels,
  ...GoogleModels,
  ...GoogleModels.map((model) => ({
    ...model,
    id: `${model.id}-vertex`,
    name: `${model.name} Vertex`,
    fullName: `${model.fullName ?? model.name} Vertex`,
    flags: [...model.flags],
    recommended: !!model.recommended,
    provider: LLMProvider.VertexAI,
    format: LLMFormat.VertexAIGemini,
  })),
  model({
    id: 'openrouter',
    name: 'OpenRouter',
    provider: LLMProvider.AsIs,
    format: LLMFormat.OpenAICompatible,
    flags: OPENAI_WITH_IMAGE_FLAGS,
    parameters: OPENAI_EXTENDED_PARAMETERS,
    tokenizer: LLMTokenizer.Unknown,
    recommended: true,
  }),
  model({
    id: 'nanogpt',
    name: 'NanoGPT',
    provider: LLMProvider.NanoGPT,
    format: LLMFormat.NanoGPT,
    flags: [...OPENAI_WITH_IMAGE_FLAGS, LLMFlags.OAICompletionTokens],
    parameters: OpenAIParameters,
    tokenizer: LLMTokenizer.Unknown,
    recommended: true,
  }),
  model({
    id: 'ollama-hosted',
    name: 'Local',
    fullName: 'Ollama Local',
    provider: LLMProvider.Ollama,
    format: LLMFormat.Ollama,
    flags: DEFAULT_OPENAI_FLAGS,
    parameters: OpenAIParameters,
    tokenizer: LLMTokenizer.Unknown,
    recommended: true,
  }),
  model({
    id: 'ollama-cloud',
    name: 'Cloud',
    fullName: 'Ollama Cloud',
    provider: LLMProvider.Ollama,
    format: LLMFormat.Ollama,
    flags: DEFAULT_OPENAI_FLAGS,
    parameters: OpenAIParameters,
    tokenizer: LLMTokenizer.Unknown,
    recommended: true,
  }),
  model({
    id: 'reverse_proxy',
    name: 'Custom API',
    provider: LLMProvider.AsIs,
    format: LLMFormat.OpenAICompatible,
    flags: DEFAULT_OPENAI_FLAGS,
    parameters: OPENAI_EXTENDED_PARAMETERS,
    tokenizer: LLMTokenizer.Unknown,
    recommended: true,
  }),
  model({
    id: 'echo_model',
    name: 'Echo',
    provider: LLMProvider.Echo,
    format: LLMFormat.Echo,
    flags: [LLMFlags.hasFullSystemPrompt],
    parameters: [],
    tokenizer: LLMTokenizer.Unknown,
  }),
  model({
    id: 'kobold',
    name: 'Kobold',
    provider: LLMProvider.AsIs,
    format: LLMFormat.Kobold,
    flags: FIRST_SYSTEM_FLAGS,
    parameters: ['temperature', 'top_p', 'repetition_penalty', 'top_k', 'top_a'],
    tokenizer: LLMTokenizer.Unknown,
    recommended: true,
  }),
  model({
    id: 'ooba',
    name: 'Ooba',
    provider: LLMProvider.AsIs,
    format: LLMFormat.Ooba,
    flags: FIRST_SYSTEM_FLAGS,
    parameters: [],
    tokenizer: LLMTokenizer.Llama,
    recommended: true,
  }),
  model({
    id: 'mancer',
    name: 'Mancer',
    provider: LLMProvider.AsIs,
    format: LLMFormat.OobaLegacy,
    flags: FIRST_SYSTEM_FLAGS,
    parameters: [],
    tokenizer: LLMTokenizer.Llama,
  }),
  model({
    id: 'custom',
    name: 'Plugin Legacy',
    provider: LLMProvider.AsIs,
    format: LLMFormat.Plugin,
    flags: [LLMFlags.hasFullSystemPrompt],
    parameters: OPENAI_EXTENDED_PARAMETERS,
    tokenizer: LLMTokenizer.Unknown,
  }),
  model({
    id: 'novelai',
    name: 'Clio',
    provider: LLMProvider.NovelAI,
    format: LLMFormat.NovelAI,
    flags: [LLMFlags.hasFirstSystemPrompt],
    parameters: [],
    tokenizer: LLMTokenizer.NovelAI,
  }),
  model({
    id: 'novelai_kayra',
    name: 'Kayra',
    provider: LLMProvider.NovelAI,
    format: LLMFormat.NovelAI,
    flags: [LLMFlags.hasFirstSystemPrompt],
    parameters: [],
    tokenizer: LLMTokenizer.NovelAI,
  }),
  model({
    id: 'novellist',
    name: 'SuperTrin',
    provider: LLMProvider.NovelList,
    format: LLMFormat.NovelList,
    flags: [],
    parameters: [],
    tokenizer: LLMTokenizer.NovelList,
  }),
  model({
    id: 'novellist_damsel',
    name: 'Damsel',
    provider: LLMProvider.NovelList,
    format: LLMFormat.NovelList,
    flags: [],
    parameters: [],
    tokenizer: LLMTokenizer.NovelList,
  }),
  model({
    id: 'cohere-command-r',
    internalID: 'command-r',
    name: 'Command R',
    provider: LLMProvider.Cohere,
    format: LLMFormat.Cohere,
    flags: ALTERNATING_FLAGS,
    parameters: ['temperature', 'top_k', 'top_p', 'presence_penalty', 'frequency_penalty'],
    tokenizer: LLMTokenizer.Cohere,
    recommended: true,
  }),
]

function model(model: LLMModel): LLMModel {
  return model
}

export function resolveModelProfile({
  database,
  role,
  staticModel,
  lookupModelInfo,
}: ResolveModelProfileArgs): ResolvedModelProfile {
  const roleLike = role ?? 'model'
  const normalizedRole = normalizeModelRole(roleLike) ?? 'chatMain'
  const staticModelId = nonBlankString(staticModel)
  const selection: ModelProfileSelection = staticModelId
    ? {
        modelId: staticModelId,
        profileId: undefined,
        source: {
          kind: 'staticModel' as const,
          role: normalizedRole,
          legacyMode: modelRoleToLegacyModelMode(normalizedRole),
          field: 'staticModel',
          bypassesRoleResolution: true,
        },
      }
    : (resolveDurableModelSelection(database, normalizedRole) ?? resolveLegacyModelSelection(database, normalizedRole))
  return resolveModelProfileSelection({ database, normalizedRole, selection, staticModelId, lookupModelInfo })
}

export function resolveModelProfileByProfileId({
  database,
  role,
  profileId,
  lookupModelInfo,
}: ResolveModelProfileArgs & { profileId: string }): ResolvedModelProfile | null {
  const roleLike = role ?? 'model'
  const normalizedRole = normalizeModelRole(roleLike) ?? 'chatMain'
  const selection = resolveDurableProfileSelection(database, normalizedRole, profileId, {
    field: 'fallbackProfileId',
    bypassesRoleResolution: true,
    includeFallbacks: false,
    allowBroken: false,
  })
  if (!selection) return null
  return resolveModelProfileSelection({
    database,
    normalizedRole,
    selection,
    staticModelId: undefined,
    lookupModelInfo,
  })
}

export function modelProfileGenerationBlockReason(profile: ResolvedModelProfile): string | null {
  if (profile.source.kind !== 'durable-profile') return null
  if (profile.status.bucket !== 'incomplete' && profile.status.bucket !== 'unsupported') return null

  const profileLabel = profile.source.profileName
    ? `"${profile.source.profileName}"`
    : profile.source.profileId
      ? `id "${profile.source.profileId}"`
      : 'the selected durable profile'
  const reasons =
    profile.status.reasons.length > 0 ? profile.status.reasons.join(', ') : `status-${profile.status.bucket}`
  const details = [`reasons: ${reasons}`]
  if (profile.status.providerId) details.push(`provider: ${profile.status.providerId}`)
  if (profile.status.unsupportedProviderId)
    details.push(`unsupported provider: ${profile.status.unsupportedProviderId}`)
  if (profile.status.providerCapabilityReason) {
    details.push(`provider capability: ${profile.status.providerCapabilityReason}`)
  }

  return `Model profile ${profileLabel} is ${profile.status.bucket} and cannot be used for generation (${details.join('; ')}). Complete the profile configuration or select a supported profile before retrying.`
}

export function assertModelProfileGenerationReady(profile: ResolvedModelProfile): void {
  const reason = modelProfileGenerationBlockReason(profile)
  if (reason) throw new Error(reason)
}

function resolveModelProfileSelection({
  database,
  normalizedRole,
  selection,
  staticModelId,
  lookupModelInfo,
}: {
  database: Database
  normalizedRole: ModelRole
  selection: ModelProfileSelection
  staticModelId?: string
  lookupModelInfo?: (database: Database, modelId: string) => LLMModel | null | undefined
}): ResolvedModelProfile {
  const profileBound = selection.source.kind === 'durable-profile'
  const effectiveSelection = profileBound ? resolveProfileCredential(database, selection) : selection
  const runtimeSource = profileBound
    ? resolveProfileBoundRuntimeSource(database, effectiveSelection.profileRuntimeOptions)
    : effectiveSelection.profileRuntimeOptions
  const effectiveProvider = profileBound ? resolveEffectiveFirstClassProvider(effectiveSelection) : null
  const lookedUp = effectiveProvider ? undefined : lookupModelInfo?.(database, effectiveSelection.modelId)
  const baseModelInfo = lookedUp
    ? withCustomFlags(database, cloneModelInfo(lookedUp), runtimeSource, { useLegacyFallback: !profileBound })
    : effectiveProvider
      ? resolveFirstClassModelInfo(
          effectiveProvider.providerId,
          effectiveSelection.modelId,
          effectiveSelection.profileProviderOptions,
        )
      : resolveServerSafeModelInfo(database, effectiveSelection.modelId, runtimeSource, {
          useLegacyFallback: !profileBound,
        })
  const modelInfo = effectiveProvider
    ? withCustomFlags(database, baseModelInfo, runtimeSource, { useLegacyFallback: false })
    : withDurableModelInfoOptions(
        effectiveSelection.modelId,
        effectiveSelection.profileProviderOptions,
        database,
        baseModelInfo,
      )
  const requestModel = resolveProfileRequestModelFromParts(
    database,
    effectiveSelection.modelId,
    modelInfo,
    effectiveSelection.profileRequestModel,
    effectiveProvider?.providerId,
  )
  const providerOptions = effectiveProvider
    ? resolveFirstClassProviderOptions(
        effectiveProvider.providerId,
        modelInfo,
        requestModel,
        effectiveSelection.profileProviderOptions,
      )
    : resolveProviderOptions(
        database,
        effectiveSelection.modelId,
        modelInfo,
        requestModel,
        effectiveSelection.profileProviderOptions,
      )
  const runtimeOptions = resolveRuntimeOptions(database, modelInfo, runtimeSource, {
    useLegacyFallback: !profileBound,
  })
  const providerCapabilityInput = effectiveProvider
    ? buildFirstClassProviderCapabilityInput(
        effectiveProvider.providerId,
        effectiveSelection.modelId,
        modelInfo,
        providerOptions,
      )
    : buildProfileProviderCapabilityInputForDatabase(
        database,
        effectiveSelection.modelId,
        modelInfo,
        providerOptions,
        effectiveSelection.profileProviderOptions,
      )
  const providerCapability = resolveProviderCapability(providerCapabilityInput)
  const status = resolveModelProfileStatus({
    selection: effectiveSelection,
    modelInfo,
    providerOptions,
    providerCapability,
    effectiveProvider,
  })
  const profile: Omit<
    ResolvedModelProfile,
    'providerCapabilityInput' | 'providerCapability' | 'requestModel' | 'providerOptions' | 'status'
  > & {
    requestModel: string
    providerOptions: ModelProfileProviderOptions
  } = {
    role: normalizedRole,
    legacyMode: selection.source.legacyMode,
    profileId:
      'profileId' in effectiveSelection && effectiveSelection.profileId
        ? effectiveSelection.profileId
        : `legacy:${effectiveSelection.source.field ?? effectiveSelection.source.kind}:${effectiveSelection.modelId}`,
    legacy: true,
    source: effectiveSelection.source,
    modelId: effectiveSelection.modelId,
    requestModel,
    modelInfo,
    providerOptions,
    runtimeOptions,
    fallbacks: staticModelId
      ? []
      : effectiveSelection.profileFallbacks
        ? resolveDurableFallbackRefs(effectiveSelection.profileFallbacks, normalizedRole)
        : resolveLegacyFallbackRefs(database, normalizedRole),
  }

  return {
    ...profile,
    providerOptions: {
      ...providerOptions,
      provider: providerCapability.routable ? providerCapability.provider : providerOptions.provider,
    },
    providerCapabilityInput,
    providerCapability,
    status,
  }
}

function resolveProfileCredential(database: Database, selection: ModelProfileSelection): ModelProfileSelection {
  const credentialId = nonBlankString(selection.profileProviderOptions?.credentialId)
  if (!credentialId) return selection

  const credential = normalizeProviderCredentials(database.providerCredentials ?? []).find(
    (candidate) => candidate.id === credentialId,
  )
  if (!credential) {
    return {
      ...selection,
      profileStatusReasons: uniqueReasons([...(selection.profileStatusReasons ?? []), 'credential-missing']),
    }
  }

  return {
    ...selection,
    profileProviderOptions: mergeCredentialProviderOptions(selection.profileProviderOptions, credential),
  }
}

function mergeCredentialProviderOptions(
  stored: EffectiveModelProfileRecordProviderOptions | undefined,
  credential: ProviderCredentialRecord,
): EffectiveModelProfileRecordProviderOptions {
  const options: EffectiveModelProfileRecordProviderOptions = { ...(stored ?? {}) }
  if (credential.type === 'apiKey') {
    options.apiKey = credential.apiKey
    return options
  }

  options.vertex = {
    ...(stored?.vertex ?? {}),
    clientEmail: credential.vertex?.clientEmail,
    privateKey: credential.vertex?.privateKey,
  }
  return options
}

function resolveDurableFallbackRefs(
  fallbacks: ModelProfileRecordFallbackRef[],
  role: ModelRole,
): ModelProfileFallbackRef[] {
  const fallbackKey = fallbackKeyForRole(role) ?? 'model'
  return fallbacks.map((fallback) => {
    if (fallback.mode === 'model') {
      return {
        kind: 'legacy-model-id',
        fallbackKey,
        modelId: fallback.modelId,
      }
    }
    return {
      kind: 'profile-id',
      profileId: fallback.profileId,
    }
  })
}

export function resolveLegacyFallbackRefs(database: Database, roleLike: ModelRoleLike): ModelProfileFallbackRef[] {
  const role = normalizeModelRole(roleLike)
  if (!role) return []
  const fallbackKey = fallbackKeyForRole(role)
  if (fallbackKey === null) return []
  const fallbackModels = normalizeLegacyFallbackModels(database.fallbackModels)
  return fallbackModels[fallbackKey].map((modelId) => ({
    kind: 'legacy-model-id',
    fallbackKey,
    modelId,
  }))
}

export function resolveServerSafeModelInfo(
  database: Database,
  modelId: string,
  durableRuntimeOptions?: ModelProfileRecordRuntimeOptions,
  options: { useLegacyFallback?: boolean } = {},
): ResolvedModelProfileModelInfo {
  const id = nonBlankString(modelId) ?? ''
  if (!id) return unknownModel('')
  const useLegacyFallback = options.useLegacyFallback !== false

  if (id === 'reverse_proxy') {
    return withCustomFlags(
      database,
      completeModel({
        id,
        name: 'Custom API',
        internalID: nonBlankString(database.customProxyRequestModel) ?? id,
        provider: LLMProvider.AsIs,
        format: asFormat(database.customAPIFormat, LLMFormat.OpenAICompatible),
        flags: DEFAULT_OPENAI_FLAGS,
        parameters: OPENAI_EXTENDED_PARAMETERS,
        tokenizer: LLMTokenizer.Unknown,
      }),
      durableRuntimeOptions,
    )
  }

  if (id.startsWith('xcustom:::')) {
    const entry = findXcustomEntry(database, id)
    if (entry) {
      return withCustomFlags(
        database,
        completeModel({
          id: nonBlankString(entry.id) ?? id,
          name: nonBlankString(entry.name) ?? nonBlankString(entry.id) ?? id,
          internalID: nonBlankString(entry.internalId) ?? nonBlankString(entry.id) ?? id,
          provider: LLMProvider.AsIs,
          format: asFormat(entry.format, LLMFormat.OpenAICompatible),
          flags: Array.isArray(entry.flags) ? [...entry.flags] : DEFAULT_OPENAI_FLAGS,
          parameters: OPENAI_EXTENDED_PARAMETERS,
          tokenizer: asTokenizer(entry.tokenizer, LLMTokenizer.Unknown),
        }),
        durableRuntimeOptions,
      )
    }
  }

  if (id === 'ollama-cloud') {
    return withCustomFlags(
      database,
      completeModel({
        id,
        name: 'Cloud',
        fullName: 'Ollama Cloud',
        provider: LLMProvider.Ollama,
        format: asFormat(database.ollamaRequestFormat, LLMFormat.OpenAICompatible),
        flags: DEFAULT_OPENAI_FLAGS,
        parameters: OpenAIParameters,
        tokenizer: LLMTokenizer.Unknown,
      }),
      durableRuntimeOptions,
    )
  }

  const staticModel = SERVER_SAFE_MODELS.find((candidate) => candidate.id === id)
  if (staticModel) return withCustomFlags(database, cloneModelInfo(staticModel), durableRuntimeOptions)

  if (id.startsWith('horde:::')) {
    const name = id.slice('horde:::'.length)
    return completeModel({
      id,
      name,
      internalID: name,
      provider: LLMProvider.Horde,
      format: LLMFormat.Horde,
      flags: FIRST_SYSTEM_FLAGS,
      parameters: OpenAIParameters,
      tokenizer: LLMTokenizer.Unknown,
    })
  }
  if (nonBlankString(database.ollamaURL) && id.includes('ollama')) {
    return withCustomFlags(
      database,
      completeModel({
        id,
        name: id,
        provider: LLMProvider.Ollama,
        format: LLMFormat.Ollama,
        flags: ALTERNATING_FLAGS,
        parameters: OpenAIParameters,
        tokenizer: LLMTokenizer.Unknown,
      }),
      durableRuntimeOptions,
    )
  }
  if (id.startsWith('deepseek-')) {
    return withCustomFlags(
      database,
      completeModel({
        id,
        name: id,
        provider: LLMProvider.DeepSeek,
        format: LLMFormat.OpenAICompatible,
        flags: [
          LLMFlags.hasFirstSystemPrompt,
          LLMFlags.requiresAlternateRole,
          LLMFlags.mustStartWithUserInput,
          LLMFlags.hasPrefill,
          LLMFlags.deepSeekPrefix,
          LLMFlags.deepSeekThinkingInput,
          LLMFlags.deepSeekThinkingOutput,
          LLMFlags.hasStreaming,
        ],
        parameters: ['frequency_penalty', 'presence_penalty', 'temperature', 'top_p'],
        tokenizer: id.startsWith('deepseek-v4') ? LLMTokenizer.DeepSeekV4 : LLMTokenizer.DeepSeek,
        endpoint: 'https://api.deepseek.com/beta/chat/completions',
        keyIdentifier: 'deepseek',
      }),
      durableRuntimeOptions,
    )
  }
  if (id.startsWith('deepinfra_')) {
    const internalID = id.slice('deepinfra_'.length)
    return withCustomFlags(
      database,
      completeModel({
        id: internalID,
        name: internalID,
        internalID,
        provider: LLMProvider.DeepInfra,
        format: LLMFormat.OpenAICompatible,
        flags: [
          LLMFlags.hasFirstSystemPrompt,
          LLMFlags.requiresAlternateRole,
          LLMFlags.mustStartWithUserInput,
          LLMFlags.hasPrefill,
          LLMFlags.deepSeekThinkingOutput,
          LLMFlags.hasStreaming,
        ],
        parameters: ['frequency_penalty', 'presence_penalty', 'temperature', 'top_p'],
        tokenizer: LLMTokenizer.DeepSeek,
        endpoint: 'https://api.deepinfra.com/v1/openai/chat/completions',
        keyIdentifier: 'deepinfra',
        recommended: true,
      }),
      durableRuntimeOptions,
    )
  }
  if (id.startsWith('anthropic.')) {
    return withCustomFlags(
      database,
      completeModel({
        id,
        name: id,
        internalID: id,
        provider: LLMProvider.AWS,
        format: LLMFormat.AWSBedrockClaude,
        flags: FIRST_SYSTEM_FLAGS,
        parameters: ClaudeParameters,
        tokenizer: LLMTokenizer.Claude,
      }),
      durableRuntimeOptions,
    )
  }
  if (id.startsWith('claude-')) {
    return withCustomFlags(
      database,
      completeModel({
        id,
        name: id,
        provider: LLMProvider.Anthropic,
        format: LLMFormat.Anthropic,
        flags: FIRST_SYSTEM_FLAGS,
        parameters: ClaudeParameters,
        tokenizer: LLMTokenizer.Claude,
      }),
      durableRuntimeOptions,
    )
  }
  if (id.startsWith('mistral') || id.startsWith('magistral')) {
    return withCustomFlags(
      database,
      completeModel({
        id,
        name: id,
        provider: LLMProvider.Mistral,
        format: LLMFormat.Mistral,
        flags: ALTERNATING_FLAGS,
        parameters: ['temperature', 'presence_penalty', 'frequency_penalty', 'top_p'],
        tokenizer: LLMTokenizer.Mistral,
      }),
      durableRuntimeOptions,
    )
  }
  if (id.startsWith('cohere-')) {
    return withCustomFlags(
      database,
      completeModel({
        id,
        name: id,
        provider: LLMProvider.Cohere,
        format: LLMFormat.Cohere,
        flags: ALTERNATING_FLAGS,
        parameters: ['temperature', 'top_k', 'top_p', 'presence_penalty', 'frequency_penalty'],
        tokenizer: LLMTokenizer.Cohere,
      }),
      durableRuntimeOptions,
    )
  }
  if (id.startsWith('gemini-')) {
    const isVertex =
      id.endsWith('-vertex') || (useLegacyFallback && nonBlankString(database.vertexClientEmail) !== undefined)
    return withCustomFlags(
      database,
      completeModel({
        id,
        name: id,
        internalID: isVertex ? id.replace(/-vertex$/, '') : id,
        provider: isVertex ? LLMProvider.VertexAI : LLMProvider.GoogleCloud,
        format: isVertex ? LLMFormat.VertexAIGemini : LLMFormat.GoogleCloud,
        flags: ALTERNATING_FLAGS,
        parameters: OpenAIParameters,
        tokenizer: LLMTokenizer.GoogleCloud,
      }),
      durableRuntimeOptions,
    )
  }
  if (id.includes('instruct')) {
    return withCustomFlags(
      database,
      completeModel({
        id,
        name: id,
        provider: LLMProvider.AsIs,
        format: LLMFormat.OpenAILegacyInstruct,
        flags: DEFAULT_OPENAI_FLAGS,
        parameters: OpenAIParameters,
        tokenizer: LLMTokenizer.Unknown,
      }),
      durableRuntimeOptions,
    )
  }
  if (id.endsWith('-response-api')) {
    return withCustomFlags(
      database,
      completeModel({
        id,
        name: id,
        internalID: id.slice(0, -'-response-api'.length),
        provider: LLMProvider.OpenAI,
        format: LLMFormat.OpenAIResponseAPI,
        flags: [...DEFAULT_OPENAI_FLAGS, LLMFlags.hasPrefill],
        parameters: OpenAIParameters,
        tokenizer: LLMTokenizer.tiktokenO200Base,
      }),
      durableRuntimeOptions,
    )
  }
  if (id.startsWith('hf:::')) {
    const name = id.slice('hf:::'.length)
    return completeModel({
      id,
      name,
      shortName: name,
      fullName: name,
      internalID: name,
      provider: LLMProvider.WebLLM,
      format: LLMFormat.WebLLM,
      flags: [],
      parameters: OpenAIParameters,
      tokenizer: LLMTokenizer.Local,
    })
  }
  if (id.startsWith('pluginmodel:::')) {
    return completeModel({
      id,
      name: id,
      provider: LLMProvider.AsIs,
      format: LLMFormat.Plugin,
      flags: DEFAULT_OPENAI_FLAGS,
      parameters: OpenAIParameters,
      tokenizer: LLMTokenizer.Unknown,
    })
  }
  if (nonBlankString(database.koboldURL)) {
    return completeModel({
      id,
      name: id,
      provider: LLMProvider.AsIs,
      format: LLMFormat.Kobold,
      flags: FIRST_SYSTEM_FLAGS,
      parameters: ['temperature', 'top_p', 'repetition_penalty', 'top_k', 'top_a'],
      tokenizer: LLMTokenizer.Unknown,
    })
  }
  if (nonBlankString(database.textgenWebUIBlockingURL)) {
    return completeModel({
      id,
      name: id,
      provider: LLMProvider.AsIs,
      format: LLMFormat.OobaLegacy,
      flags: FIRST_SYSTEM_FLAGS,
      parameters: [],
      tokenizer: LLMTokenizer.Llama,
    })
  }

  return withCustomFlags(database, unknownModel(id), durableRuntimeOptions)
}

/**
 * Resolve the tokenizer family for a model without importing the browser-bound
 * model registry. Server prompt budgeting uses this narrow helper to mirror
 * the client's automatic tokenizer routing from the same static model data as
 * profile resolution.
 */
export function resolveServerSafeTokenizerFamily(database: Database, modelId: string): LLMTokenizerValue {
  return resolveServerSafeModelInfo(database, modelId).tokenizer
}

export function buildProfileProviderCapabilityInput(
  profile: Pick<ResolvedModelProfile, 'modelId' | 'modelInfo'> &
    Partial<Pick<ResolvedModelProfile, 'providerCapabilityInput'>> & {
      providerOptions?: ModelProfileProviderOptions
    },
): ProviderCapabilityInput {
  if (profile.providerCapabilityInput) {
    return cloneProviderCapabilityInput(profile.providerCapabilityInput)
  }
  const modelInfo = profile.modelInfo
  const providerOptions = profile.providerOptions
  const customModel = providerOptions?.customModel
  const keyIdentifier = nonBlankString(modelInfo.keyIdentifier)
  return {
    format: profile.modelId === 'ollama-cloud' ? LLMFormat.Ollama : modelInfo.format,
    aiModel: profile.modelId,
    endpoint: nonBlankString(modelInfo.endpoint),
    keyIdentifier,
    internalID: nonBlankString(modelInfo.internalID),
    config: {
      forceReplaceUrl: profile.modelId === 'reverse_proxy' ? providerOptions?.baseUrl : undefined,
      proxyKey: profile.modelId === 'reverse_proxy' ? providerOptions?.apiKey : undefined,
      oaiCompApiKeys:
        keyIdentifier && providerOptions?.apiKey ? { [keyIdentifier]: providerOptions.apiKey } : undefined,
      customModels: customModel
        ? [
            {
              id: customModel.id,
              url: customModel.url,
              key: customModel.key,
              format: customModel.format,
            },
          ]
        : undefined,
      claudeAPIKey: modelInfo.format === LLMFormat.AWSBedrockClaude ? providerOptions?.apiKey : undefined,
      googleProjectId: providerOptions?.vertex?.projectId,
      vertexRegion: providerOptions?.vertex?.region,
      vertexClientEmail: providerOptions?.vertex?.clientEmail,
      vertexPrivateKey: providerOptions?.vertex?.privateKey,
      ollamaApiKey: providerOptions?.ollama?.apiKey,
      ollamaRequestFormat: providerOptions?.ollama?.requestFormat,
      ollamaURL: providerOptions?.ollama?.url,
    },
  }
}

export function resolveProfileRequestModel(profile: Pick<ResolvedModelProfile, 'requestModel'>): string {
  return profile.requestModel
}

interface EffectiveFirstClassProvider {
  providerId: FirstClassModelProfileProviderId
  source: 'explicit' | 'inferred'
}

function resolveEffectiveFirstClassProvider(selection: ModelProfileSelection): EffectiveFirstClassProvider | null {
  const explicitProviderId = nonBlankString(selection.profileProviderId)
  if (explicitProviderId) {
    return isFirstClassProviderId(explicitProviderId) ? { providerId: explicitProviderId, source: 'explicit' } : null
  }

  const inferredProviderId = inferFirstClassProviderId(selection)
  return inferredProviderId ? { providerId: inferredProviderId, source: 'inferred' } : null
}

function inferFirstClassProviderId(selection: ModelProfileSelection): FirstClassModelProfileProviderId | null {
  const modelId = nonBlankString(selection.modelId)
  const options = selection.profileProviderOptions
  if (!modelId) return null

  if (modelId === 'custom-api' && (nonBlankString(options?.baseUrl) || nonBlankString(options?.requestModel))) {
    return 'custom-api'
  }
  if (modelId === 'debug-echo') return 'debug-echo'
  if (modelId.endsWith('-vertex') || options?.vertex !== undefined) return 'vertex'
  if (!nonBlankString(options?.apiKey)) return null
  if (isOpenAIModelId(modelId)) return 'openai'
  if (isAnthropicModelId(modelId)) return 'anthropic'
  if (isGoogleModelId(modelId)) return 'google'
  return null
}

function resolveFirstClassModelInfo(
  providerId: FirstClassModelProfileProviderId,
  modelId: string,
  providerOptions?: EffectiveModelProfileRecordProviderOptions,
): ResolvedModelProfileModelInfo {
  const id = nonBlankString(modelId) ?? ''
  if (!id) return unknownModel('')

  switch (providerId) {
    case 'openai': {
      const known = SERVER_SAFE_MODELS.find(
        (candidate) => candidate.id === id && candidate.provider === LLMProvider.OpenAI,
      )
      if (known) return cloneModelInfo(known)
      if (id.endsWith('-response-api')) {
        return completeModel({
          id,
          name: id,
          internalID: id.slice(0, -'-response-api'.length),
          provider: LLMProvider.OpenAI,
          format: LLMFormat.OpenAIResponseAPI,
          flags: [...DEFAULT_OPENAI_FLAGS, LLMFlags.hasPrefill],
          parameters: OpenAIParameters,
          tokenizer: LLMTokenizer.tiktokenO200Base,
        })
      }
      return completeModel({
        id,
        name: id,
        internalID: id,
        provider: LLMProvider.OpenAI,
        format: LLMFormat.OpenAICompatible,
        flags: DEFAULT_OPENAI_FLAGS,
        parameters: OpenAIParameters,
        tokenizer: LLMTokenizer.tiktokenO200Base,
      })
    }
    case 'anthropic': {
      const known = AnthropicModels.find((candidate) => candidate.id === id || candidate.internalID === id)
      if (known) return cloneModelInfo(known)
      return completeModel({
        id,
        name: id,
        internalID: id,
        provider: LLMProvider.Anthropic,
        format: LLMFormat.Anthropic,
        flags: FIRST_SYSTEM_FLAGS,
        parameters: ClaudeParameters,
        tokenizer: LLMTokenizer.Claude,
      })
    }
    case 'google': {
      const known = GoogleModels.find((candidate) => candidate.id === id || candidate.internalID === id)
      if (known) return cloneModelInfo(known)
      return completeModel({
        id,
        name: id,
        internalID: id.startsWith('models/') ? id : `models/${id}`,
        provider: LLMProvider.GoogleCloud,
        format: LLMFormat.GoogleCloud,
        flags: ALTERNATING_FLAGS,
        parameters: OpenAIParameters,
        tokenizer: LLMTokenizer.GoogleCloud,
      })
    }
    case 'vertex': {
      const known = SERVER_SAFE_MODELS.find(
        (candidate) => candidate.id === id && candidate.provider === LLMProvider.VertexAI,
      )
      if (known) return cloneModelInfo(known)
      const internalID = id.replace(/-vertex$/, '')
      return completeModel({
        id,
        name: id,
        internalID,
        provider: LLMProvider.VertexAI,
        format: LLMFormat.VertexAIGemini,
        flags: ALTERNATING_FLAGS,
        parameters: OpenAIParameters,
        tokenizer: LLMTokenizer.GoogleCloud,
      })
    }
    case 'ollama': {
      const requestFormat =
        id === 'ollama-cloud'
          ? asFormat(providerOptions?.ollama?.requestFormat, LLMFormat.OpenAICompatible)
          : LLMFormat.Ollama
      return completeModel({
        id,
        name: id === 'ollama-cloud' ? 'Cloud' : id === 'ollama-hosted' ? 'Local' : id,
        fullName: id === 'ollama-cloud' ? 'Ollama Cloud' : id === 'ollama-hosted' ? 'Ollama Local' : id,
        internalID: nonBlankString(providerOptions?.requestModel) ?? id,
        provider: LLMProvider.Ollama,
        format: requestFormat,
        flags: id === 'ollama-cloud' ? DEFAULT_OPENAI_FLAGS : ALTERNATING_FLAGS,
        parameters: OpenAIParameters,
        tokenizer: LLMTokenizer.Unknown,
      })
    }
    case 'custom-api':
      return completeModel({
        id,
        name: 'Custom API',
        internalID: nonBlankString(providerOptions?.requestModel) ?? id,
        provider: LLMProvider.AsIs,
        format: LLMFormat.OpenAICompatible,
        flags: providerOptions?.customApi?.flags ? [...providerOptions.customApi.flags] : DEFAULT_OPENAI_FLAGS,
        parameters: OPENAI_EXTENDED_PARAMETERS,
        tokenizer: providerOptions?.customApi?.tokenizer ?? LLMTokenizer.Unknown,
      })
    case 'debug-echo':
      return completeModel({
        id,
        name: 'Debug Echo',
        internalID: id,
        provider: LLMProvider.Echo,
        format: LLMFormat.Echo,
        flags: [LLMFlags.hasFullSystemPrompt],
        parameters: [],
        tokenizer: LLMTokenizer.Unknown,
      })
  }
}

function resolveFirstClassProviderOptions(
  providerId: FirstClassModelProfileProviderId,
  modelInfo: ResolvedModelProfileModelInfo,
  requestModel: string,
  durableProviderOptions?: EffectiveModelProfileRecordProviderOptions,
): ModelProfileProviderOptions {
  const base: ModelProfileProviderOptions = {
    requestModel,
    endpoint: nonBlankString(modelInfo.endpoint),
    keyIdentifier: nonBlankString(modelInfo.keyIdentifier),
  }
  const apiKey = nonBlankString(durableProviderOptions?.apiKey)
  const baseUrl = nonBlankString(durableProviderOptions?.baseUrl)
  const shared = {
    extraHeaders: cloneStringRecord(durableProviderOptions?.extraHeaders),
    additionalParams: cloneAdditionalParams(durableProviderOptions?.additionalParams),
  }

  switch (providerId) {
    case 'openai':
      return {
        ...base,
        apiKey,
        baseUrl: modelInfo.endpoint ? deriveOpenAIBaseUrl(modelInfo.endpoint) : undefined,
      }
    case 'anthropic':
    case 'google':
      return { ...base, apiKey }
    case 'vertex':
      return {
        ...base,
        vertex: {
          projectId: nonBlankString(durableProviderOptions?.vertex?.projectId),
          region: nonBlankString(durableProviderOptions?.vertex?.region),
          clientEmail: nonBlankString(durableProviderOptions?.vertex?.clientEmail),
          privateKey: nonBlankString(durableProviderOptions?.vertex?.privateKey),
        },
      }
    case 'ollama': {
      const requestFormat =
        modelInfo.id === 'ollama-cloud'
          ? asFormat(durableProviderOptions?.ollama?.requestFormat, LLMFormat.OpenAICompatible)
          : LLMFormat.Ollama
      const isCloud = modelInfo.id === 'ollama-cloud'
      const ollamaUrl = nonBlankString(durableProviderOptions?.ollama?.url) ?? baseUrl
      return {
        ...base,
        apiKey,
        baseUrl: isCloud ? 'https://ollama.com/v1' : ollamaUrl,
        ollama: {
          apiKey,
          url: isCloud ? 'https://ollama.com' : ollamaUrl,
          requestFormat,
          model: requestModel,
          modelSource: nonBlankString(durableProviderOptions?.ollama?.modelSource) ?? (isCloud ? 'cloud' : 'local'),
          thinkingMode: nonBlankString(durableProviderOptions?.ollama?.thinkingMode) ?? 'off',
          cloud: isCloud,
        },
      }
    }
    case 'custom-api':
      return {
        ...base,
        apiKey,
        baseUrl,
        ...shared,
      }
    case 'debug-echo':
      return {
        ...base,
        baseUrl,
      }
  }
}

function buildFirstClassProviderCapabilityInput(
  providerId: FirstClassModelProfileProviderId,
  modelId: string,
  modelInfo: ResolvedModelProfileModelInfo,
  providerOptions: ModelProfileProviderOptions,
): ProviderCapabilityInput {
  return {
    format: providerId === 'ollama' ? LLMFormat.Ollama : modelInfo.format,
    aiModel: modelId,
    endpoint: nonBlankString(modelInfo.endpoint),
    keyIdentifier: nonBlankString(modelInfo.keyIdentifier),
    internalID: nonBlankString(modelInfo.internalID),
    config: {
      oaiCompApiKeys:
        modelInfo.keyIdentifier && providerOptions.apiKey
          ? { [modelInfo.keyIdentifier]: providerOptions.apiKey }
          : undefined,
      googleProjectId: providerOptions.vertex?.projectId,
      vertexRegion: providerOptions.vertex?.region,
      vertexClientEmail: providerOptions.vertex?.clientEmail,
      vertexPrivateKey: providerOptions.vertex?.privateKey,
      ollamaApiKey: providerOptions.ollama?.cloud ? providerOptions.apiKey : undefined,
      ollamaRequestFormat: providerOptions.ollama?.requestFormat,
      ollamaURL: providerOptions.ollama?.cloud ? undefined : providerOptions.ollama?.url,
      claudeAPIKey: modelInfo.format === LLMFormat.AWSBedrockClaude ? providerOptions.apiKey : undefined,
    },
  }
}

function resolveModelProfileStatus({
  selection,
  modelInfo,
  providerOptions,
  providerCapability,
  effectiveProvider,
}: {
  selection: ModelProfileSelection
  modelInfo: ResolvedModelProfileModelInfo
  providerOptions: ModelProfileProviderOptions
  providerCapability: ProviderCapabilityVerdict
  effectiveProvider: EffectiveFirstClassProvider | null
}): ModelProfileStatus {
  if (selection.source.kind === 'staticModel') {
    return { bucket: 'compatibility', reasons: ['static-model'] }
  }
  if (selection.source.kind !== 'durable-profile') {
    return { bucket: 'compatibility', reasons: ['legacy-mode'] }
  }

  const brokenReasons = selection.profileStatusReasons ?? []
  const selectionBlockingReasons = brokenReasons.filter((reason) => reason !== 'credential-missing')
  if (selectionBlockingReasons.length > 0) {
    return { bucket: 'incomplete', reasons: uniqueReasons(selectionBlockingReasons) }
  }

  const rawProviderId = nonBlankString(selection.profileProviderId)
  if (rawProviderId && !isFirstClassProviderId(rawProviderId)) {
    return {
      bucket: 'unsupported',
      reasons: uniqueReasons([...brokenReasons, 'unsupported-provider-id']),
      unsupportedProviderId: rawProviderId,
    }
  }

  if (!effectiveProvider) {
    return brokenReasons.includes('credential-missing')
      ? { bucket: 'incomplete', reasons: ['credential-missing'] }
      : { bucket: 'compatibility', reasons: ['missing-provider-id'] }
  }

  const incompleteReasons = [
    ...brokenReasons,
    ...firstClassIncompleteReasons(effectiveProvider.providerId, selection.modelId, providerOptions),
  ]
  if (effectiveProvider.source === 'inferred') incompleteReasons.push('inferred-provider-id')
  if (incompleteReasons.some((reason) => reason !== 'inferred-provider-id')) {
    return {
      bucket: 'incomplete',
      reasons: uniqueReasons(incompleteReasons),
      providerId: effectiveProvider.providerId,
      providerIdSource: effectiveProvider.source,
    }
  }

  if (modelInfo.unsupportedReason) {
    return {
      bucket: 'unsupported',
      reasons:
        effectiveProvider.source === 'inferred' ? ['inferred-provider-id', 'unsupported-model'] : ['unsupported-model'],
      providerId: effectiveProvider.providerId,
      providerIdSource: effectiveProvider.source,
    }
  }

  if (providerCapability.routable === false) {
    return {
      bucket: providerCapability.reason === 'config-incomplete' ? 'incomplete' : 'unsupported',
      reasons: uniqueReasons([
        ...(effectiveProvider.source === 'inferred' ? (['inferred-provider-id'] as const) : []),
        providerCapability.reason === 'config-incomplete'
          ? 'provider-capability-incomplete'
          : 'provider-capability-unsupported',
      ]),
      providerId: effectiveProvider.providerId,
      providerIdSource: effectiveProvider.source,
      providerCapabilityReason: providerCapability.reason,
    }
  }

  return {
    bucket: 'ready',
    reasons: effectiveProvider.source === 'inferred' ? ['inferred-provider-id'] : [],
    providerId: effectiveProvider.providerId,
    providerIdSource: effectiveProvider.source,
  }
}

function firstClassIncompleteReasons(
  providerId: FirstClassModelProfileProviderId,
  modelId: string,
  providerOptions: ModelProfileProviderOptions,
): ModelProfileStatusReason[] {
  const reasons: ModelProfileStatusReason[] = []
  if (!nonBlankString(modelId)) reasons.push('profile-model-missing')

  switch (providerId) {
    case 'openai':
    case 'anthropic':
    case 'google':
      if (!nonBlankString(providerOptions.apiKey)) reasons.push('api-key-missing')
      break
    case 'vertex':
      if (!nonBlankString(providerOptions.vertex?.projectId)) reasons.push('vertex-project-id-missing')
      if (!nonBlankString(providerOptions.vertex?.region)) reasons.push('vertex-region-missing')
      if (!nonBlankString(providerOptions.vertex?.clientEmail)) reasons.push('vertex-client-email-missing')
      if (!nonBlankString(providerOptions.vertex?.privateKey)) reasons.push('vertex-private-key-missing')
      break
    case 'ollama':
      if (modelId === 'ollama-cloud') {
        if (!nonBlankString(providerOptions.apiKey)) reasons.push('api-key-missing')
      } else if (!nonBlankString(providerOptions.ollama?.url) && !nonBlankString(providerOptions.baseUrl)) {
        reasons.push('base-url-missing')
      }
      if (!nonBlankString(providerOptions.requestModel)) reasons.push('request-model-missing')
      break
    case 'custom-api':
      if (!nonBlankString(providerOptions.baseUrl)) reasons.push('base-url-missing')
      if (!nonBlankString(providerOptions.requestModel)) reasons.push('request-model-missing')
      break
    case 'debug-echo':
      break
  }

  return reasons
}

function resolveProfileBoundRuntimeSource(
  database: Database,
  profileRuntimeOptions?: ModelProfileRecordRuntimeOptions,
): ModelProfileRecordRuntimeOptions {
  return mergeRuntimeOptionRecords(
    HARD_RUNTIME_DEFAULTS,
    normalizeModelRuntimeDefaults(database.modelRuntimeDefaults),
    profileRuntimeOptions,
  )
}

function mergeRuntimeOptionRecords(
  ...records: Array<ModelProfileRecordRuntimeOptions | undefined>
): ModelProfileRecordRuntimeOptions {
  const merged: ModelProfileRecordRuntimeOptions = {}
  for (const record of records) {
    if (!record) continue
    Object.assign(merged, record)
    if (record.modelTools !== undefined) merged.modelTools = [...record.modelTools]
    if (record.customFlags !== undefined) merged.customFlags = [...record.customFlags]
  }
  return merged
}

function isFirstClassProviderId(value: string): value is FirstClassModelProfileProviderId {
  return FIRST_CLASS_MODEL_PROFILE_PROVIDER_ID_SET.has(value)
}

function isOpenAIModelId(modelId: string): boolean {
  return OPENAI_MODEL_IDS.has(modelId) || modelId.startsWith('gpt-') || modelId.endsWith('-response-api')
}

function isAnthropicModelId(modelId: string): boolean {
  return ANTHROPIC_MODEL_IDS.has(modelId) || modelId.startsWith('claude-')
}

function isGoogleModelId(modelId: string): boolean {
  return GOOGLE_MODEL_IDS.has(modelId) || modelId.startsWith('gemini-')
}

function uniqueReasons(reasons: readonly ModelProfileStatusReason[]): ModelProfileStatusReason[] {
  return [...new Set(reasons)]
}

function resolveDurableModelSelection(database: Database, role: ModelRole): ModelProfileSelection | null {
  const bindings = normalizeModelRoleProfiles(database.modelRoleProfiles)
  const binding = bindings[role]

  if (binding.mode === 'inherit') {
    const sourceRole = modelRoleProfileInheritSource(role)
    if (!sourceRole) return null
    const sourceBinding = bindings[sourceRole]
    if (sourceBinding.mode !== 'profile') return null
    return resolveDurableProfileSelection(database, role, sourceBinding.profileId, {
      field: `modelRoleProfiles.${role} -> modelRoleProfiles.${sourceRole}`,
      bypassesRoleResolution: false,
      includeFallbacks: true,
      allowBroken: true,
    })
  }

  if (binding.mode !== 'profile') return null

  return resolveDurableProfileSelection(database, role, binding.profileId, {
    field: `modelRoleProfiles.${role}`,
    bypassesRoleResolution: false,
    includeFallbacks: true,
    allowBroken: true,
  })
}

function resolveDurableProfileSelection(
  database: Database,
  role: ModelRole,
  profileId: string,
  options: {
    field: string
    bypassesRoleResolution: boolean
    includeFallbacks: boolean
    allowBroken: boolean
  },
): ModelProfileSelection | null {
  const requestedProfileId = nonBlankString(profileId) ?? profileId.trim()
  const profile = findDurableModelProfile(database.modelProfiles, profileId)
  const modelId = nonBlankString(profile?.modelId)
  if (!profile || !modelId) {
    if (!options.allowBroken) return null
    return {
      modelId: '',
      profileId: profile?.id ?? requestedProfileId,
      ...(profile?.providerId ? { profileProviderId: profile.providerId } : {}),
      ...(profile?.providerOptions ? { profileProviderOptions: profile.providerOptions } : {}),
      ...(profile?.runtimeOptions ? { profileRuntimeOptions: profile.runtimeOptions } : {}),
      profileFallbacks: [],
      profileStatusReasons: [profile ? 'profile-model-missing' : 'profile-not-found'],
      source: {
        kind: 'durable-profile',
        role,
        legacyMode: modelRoleToLegacyModelMode(role),
        field: options.field,
        profileId: profile?.id ?? requestedProfileId,
        profileName: profile?.name,
        bypassesRoleResolution: options.bypassesRoleResolution,
      },
    }
  }
  const profileRequestModel = nonBlankString(profile.providerOptions?.requestModel)

  return {
    modelId,
    profileId: profile.id,
    ...(profileRequestModel ? { profileRequestModel } : {}),
    ...(profile.providerId ? { profileProviderId: profile.providerId } : {}),
    ...(profile.providerOptions ? { profileProviderOptions: profile.providerOptions } : {}),
    ...(profile.runtimeOptions ? { profileRuntimeOptions: profile.runtimeOptions } : {}),
    profileFallbacks: options.includeFallbacks ? (profile.fallbacks ?? []) : [],
    source: {
      kind: 'durable-profile',
      role,
      legacyMode: modelRoleToLegacyModelMode(role),
      field: options.field,
      profileId: profile.id,
      profileName: profile.name,
      bypassesRoleResolution: options.bypassesRoleResolution,
    },
  }
}

function resolveLegacyModelSelection(database: Database, role: ModelRole): ModelProfileSelection {
  const legacyMode = modelRoleToLegacyModelMode(role)
  const roleOverride = nonBlankString(normalizeModelRoleOverrides(database.modelRoles)[role])
  if (role !== 'chatMain' && role !== 'chatAux' && roleOverride) {
    return {
      modelId: roleOverride,
      source: {
        kind: 'legacy-modelRoles',
        role,
        legacyMode,
        field: `modelRoles.${role}`,
        bypassesRoleResolution: false,
      },
    }
  }

  const modelId = resolveModelForRole(database, role)
  if (role === 'chatMain') {
    return {
      modelId,
      source: { kind: 'legacy-aiModel', role, legacyMode, field: 'aiModel', bypassesRoleResolution: false },
    }
  }
  if (role === 'chatAux') {
    return {
      modelId,
      source: { kind: 'legacy-subModel', role, legacyMode, field: 'subModel', bypassesRoleResolution: false },
    }
  }

  if (database.seperateModelsForAxModels === true) {
    const seperateModels = (isRecord(database.seperateModels) ? database.seperateModels : {}) as Record<string, unknown>
    if (role === 'scriptAux') {
      if (nonBlankString(seperateModels.scriptAux)) {
        return {
          modelId,
          source: {
            kind: 'legacy-seperateModels',
            role,
            legacyMode,
            field: 'seperateModels.scriptAux',
            bypassesRoleResolution: false,
          },
        }
      }
      if (nonBlankString(seperateModels.otherAx)) {
        return {
          modelId,
          source: {
            kind: 'legacy-seperateModels',
            role,
            legacyMode,
            field: 'seperateModels.otherAx',
            bypassesRoleResolution: false,
          },
        }
      }
    } else if (role === 'scriptMain') {
      if (nonBlankString(seperateModels.scriptMain)) {
        return {
          modelId,
          source: {
            kind: 'legacy-seperateModels',
            role,
            legacyMode,
            field: 'seperateModels.scriptMain',
            bypassesRoleResolution: false,
          },
        }
      }
    } else if (nonBlankString(seperateModels[role])) {
      return {
        modelId,
        source: {
          kind: 'legacy-seperateModels',
          role,
          legacyMode,
          field: `seperateModels.${role}`,
          bypassesRoleResolution: false,
        },
      }
    }
  }

  return {
    modelId,
    source: {
      kind: 'legacy-inherit',
      role,
      legacyMode,
      field: role === 'scriptMain' ? 'aiModel' : 'subModel',
      bypassesRoleResolution: false,
    },
  }
}

function findDurableModelProfile(value: unknown, profileId: string): ModelProfileRecord | null {
  const id = nonBlankString(profileId)
  if (!id) return null
  return normalizeModelProfiles(value).find((profile) => profile.id === id) ?? null
}

function fallbackKeyForRole(role: ModelRole): LegacyFallbackModelKey | null {
  const legacyMode = modelRoleToLegacyModelMode(role)
  if (legacyMode === 'submodel') return null
  return LEGACY_FALLBACK_MODEL_KEYS.includes(legacyMode as LegacyFallbackModelKey)
    ? (legacyMode as LegacyFallbackModelKey)
    : null
}

function buildProfileProviderCapabilityInputForDatabase(
  database: Database,
  modelId: string,
  modelInfo: ResolvedModelProfileModelInfo,
  providerOptions?: ModelProfileProviderOptions,
  durableProviderOptions?: EffectiveModelProfileRecordProviderOptions,
): ProviderCapabilityInput {
  const durableReverseProxyUrl =
    modelId === 'reverse_proxy' ? nonBlankString(durableProviderOptions?.baseUrl) : undefined
  const durableOllamaUrl =
    modelId !== 'ollama-cloud'
      ? (nonBlankString(durableProviderOptions?.ollama?.url) ?? nonBlankString(durableProviderOptions?.baseUrl))
      : undefined
  const profileApiKey = nonBlankString(providerOptions?.apiKey)
  const keyIdentifier = nonBlankString(modelInfo.keyIdentifier)
  return {
    format: modelId === 'ollama-cloud' ? LLMFormat.Ollama : modelInfo.format,
    aiModel: modelId,
    endpoint: nonBlankString(modelInfo.endpoint),
    keyIdentifier,
    internalID: nonBlankString(modelInfo.internalID),
    config: {
      forceReplaceUrl: durableReverseProxyUrl ? providerOptions?.baseUrl : nonBlankString(database.forceReplaceUrl),
      proxyKey: modelId === 'reverse_proxy' ? profileApiKey : nonBlankString(database.proxyKey),
      oaiCompApiKeys:
        keyIdentifier && profileApiKey
          ? { ...(database.OaiCompAPIKeys ?? {}), [keyIdentifier]: profileApiKey }
          : database.OaiCompAPIKeys,
      customModels: buildCapabilityCustomModels(database, modelId, profileApiKey),
      googleProjectId: database.google?.projectId,
      vertexRegion: database.vertexRegion,
      vertexClientEmail: database.vertexClientEmail,
      vertexPrivateKey: database.vertexPrivateKey,
      claudeAPIKey:
        modelInfo.format === LLMFormat.AWSBedrockClaude
          ? (profileApiKey ?? nonBlankString(database.claudeAPIKey))
          : nonBlankString(database.claudeAPIKey),
      instructChatTemplate: nonBlankString(database.instructChatTemplate),
      jinjaTemplate: nonBlankString(database.JinjaTemplate),
      ollamaApiKey:
        modelId === 'ollama-cloud' ? providerOptions?.ollama?.apiKey : nonBlankString(database.ollamaApiKey),
      ollamaRequestFormat:
        durableProviderOptions?.ollama?.requestFormat ?? asFormat(database.ollamaRequestFormat, undefined),
      ollamaURL: durableOllamaUrl
        ? (providerOptions?.ollama?.url ?? providerOptions?.baseUrl)
        : nonBlankString(database.ollamaURL),
    },
  }
}

function resolveProviderOptions(
  database: Database,
  modelId: string,
  modelInfo: ResolvedModelProfileModelInfo,
  requestModel: string,
  durableProviderOptions?: EffectiveModelProfileRecordProviderOptions,
): ModelProfileProviderOptions {
  const base: ModelProfileProviderOptions = {
    requestModel,
    endpoint: nonBlankString(modelInfo.endpoint),
    keyIdentifier: nonBlankString(modelInfo.keyIdentifier),
  }
  const durableApiKey = nonBlankString(durableProviderOptions?.apiKey)
  const durableBaseUrl = nonBlankString(durableProviderOptions?.baseUrl)
  if (modelId === 'ollama-cloud') {
    const apiKey = durableApiKey ?? nonBlankString(database.ollamaApiKey)
    return {
      ...base,
      apiKey,
      baseUrl: 'https://ollama.com/v1',
      ollama: {
        apiKey,
        url: 'https://ollama.com',
        requestFormat:
          durableProviderOptions?.ollama?.requestFormat ??
          asFormat(database.ollamaRequestFormat, LLMFormat.OpenAICompatible),
        model: nonBlankString(requestModel),
        modelSource: nonBlankString(durableProviderOptions?.ollama?.modelSource) ?? database.ollamaModelSource,
        thinkingMode: nonBlankString(durableProviderOptions?.ollama?.thinkingMode) ?? database.ollamaThinkingMode,
        cloud: true,
      },
    }
  }
  if (modelInfo.format === LLMFormat.Ollama || modelId.includes('ollama')) {
    const ollamaUrl =
      nonBlankString(durableProviderOptions?.ollama?.url) ?? durableBaseUrl ?? nonBlankString(database.ollamaURL)
    return {
      ...base,
      baseUrl: ollamaUrl,
      ollama: {
        url: ollamaUrl,
        requestFormat: durableProviderOptions?.ollama?.requestFormat ?? LLMFormat.Ollama,
        model: nonBlankString(requestModel),
        modelSource: nonBlankString(durableProviderOptions?.ollama?.modelSource) ?? database.ollamaModelSource,
        thinkingMode: nonBlankString(durableProviderOptions?.ollama?.thinkingMode) ?? database.ollamaThinkingMode,
        cloud: false,
      },
    }
  }
  if (modelId === 'openrouter') {
    return {
      ...base,
      apiKey: durableApiKey ?? nonBlankString(database.openrouterKey),
      baseUrl: OPENROUTER_BASE_URL,
      extraHeaders: { 'X-Title': 'RisuAI', 'HTTP-Referer': 'https://risuai.xyz' },
      openrouter: {
        fallback: durableProviderOptions?.openrouter?.fallback ?? database.openrouterFallback,
        middleOut: durableProviderOptions?.openrouter?.middleOut ?? database.openrouterMiddleOut,
        provider: durableProviderOptions?.openrouter?.provider
          ? cloneOpenrouterProvider(durableProviderOptions.openrouter.provider)
          : cloneOpenrouterProvider(database.openrouterProvider),
      },
    }
  }
  if (modelId === 'nanogpt' || modelInfo.format === LLMFormat.NanoGPT) {
    const providerHint =
      nonBlankString(durableProviderOptions?.nanogpt?.providerHint) ?? nonBlankString(database.nanogptProvider)
    const useSubscriptionEndpoint =
      durableProviderOptions?.nanogpt?.useSubscriptionEndpoint ?? database.nanogptUseSubscriptionEndpoint
    return {
      ...base,
      apiKey: durableApiKey ?? nonBlankString(database.nanogptKey),
      baseUrl: useSubscriptionEndpoint === true ? NANOGPT_SUBSCRIPTION_BASE_URL : NANOGPT_BASE_URL,
      extraHeaders: providerHint ? { 'X-Provider': providerHint } : undefined,
      nanogpt: {
        providerHint,
        useSubscriptionEndpoint,
        subscriptionState:
          nonBlankString(durableProviderOptions?.nanogpt?.subscriptionState) ?? database.nanogptSubscriptionState,
      },
    }
  }
  if (
    modelInfo.format === LLMFormat.NanoGPTLegacy ||
    modelInfo.format === LLMFormat.NanoGPTResponses ||
    modelInfo.format === LLMFormat.NanoGPTMessages
  ) {
    const providerHint =
      nonBlankString(durableProviderOptions?.nanogpt?.providerHint) ?? nonBlankString(database.nanogptProvider)
    const useSubscriptionEndpoint = durableProviderOptions?.nanogpt?.useSubscriptionEndpoint
    return {
      ...base,
      apiKey: durableApiKey ?? nonBlankString(database.nanogptKey),
      baseUrl: useSubscriptionEndpoint === true ? NANOGPT_SUBSCRIPTION_BASE_URL : NANOGPT_BASE_URL,
      extraHeaders: providerHint ? { 'X-Provider': providerHint } : undefined,
      nanogpt: {
        providerHint,
        useSubscriptionEndpoint,
        subscriptionState:
          nonBlankString(durableProviderOptions?.nanogpt?.subscriptionState) ?? database.nanogptSubscriptionState,
      },
    }
  }
  if (modelId === 'reverse_proxy') {
    const rawUrl = durableBaseUrl ?? nonBlankString(database.forceReplaceUrl) ?? ''
    const autofillRequestUrl =
      durableProviderOptions?.reverseProxy?.autofillRequestUrl ?? database.autofillRequestUrl !== false
    const reverseProxyUrl = resolveReverseProxyUrlForFormat(rawUrl, autofillRequestUrl, modelInfo.format)
    return {
      ...base,
      apiKey: durableApiKey ?? nonBlankString(database.proxyKey),
      baseUrl: reverseProxyUrl.baseUrl,
      extraHeaders: reverseProxyUrl.risuIdentify ? { 'X-Proxy-Risu': 'RisuAI' } : undefined,
      additionalParams: additionalParams(database.additionalParams),
      reverseProxy: {
        autofillRequestUrl,
        oobaSystemHoist:
          durableProviderOptions?.reverseProxy?.oobaSystemHoist ?? database.reverseProxyOobaMode === true,
        oobaArgs: Object.prototype.hasOwnProperty.call(durableProviderOptions?.reverseProxy ?? {}, 'oobaArgs')
          ? durableProviderOptions?.reverseProxy?.oobaArgs
          : database.reverseProxyOobaArgs,
        risuIdentify: reverseProxyUrl.risuIdentify,
      },
    }
  }
  if (modelId.startsWith('xcustom:::')) {
    const entry = findXcustomEntry(database, modelId)
    const apiKey = durableApiKey ?? nonBlankString(entry?.key)
    return {
      ...base,
      apiKey,
      baseUrl: xcustomBaseUrl(entry, modelInfo.format),
      additionalParams: parseXcustomParams(entry?.params),
      customModel: entry ? cloneCustomModelDependency(entry, modelId, apiKey) : undefined,
    }
  }
  if (modelInfo.keyIdentifier) {
    return {
      ...base,
      apiKey: durableApiKey ?? nonBlankString(database.OaiCompAPIKeys?.[modelInfo.keyIdentifier]),
      baseUrl: modelInfo.endpoint ? deriveOpenAIBaseUrl(modelInfo.endpoint) : undefined,
    }
  }

  switch (modelInfo.format) {
    case LLMFormat.AWSBedrockClaude:
      return { ...base, apiKey: durableApiKey ?? nonBlankString(database.claudeAPIKey) }
    case LLMFormat.Anthropic:
    case LLMFormat.AnthropicLegacy:
      return { ...base, apiKey: durableApiKey ?? nonBlankString(database.claudeAPIKey) }
    case LLMFormat.Mistral:
      return { ...base, apiKey: durableApiKey ?? nonBlankString(database.mistralKey) }
    case LLMFormat.Cohere:
      return { ...base, apiKey: durableApiKey ?? nonBlankString(database.cohereAPIKey) }
    case LLMFormat.Kobold:
      return { ...base, baseUrl: durableBaseUrl ?? nonBlankString(database.koboldURL) }
    case LLMFormat.OobaLegacy:
      return {
        ...base,
        apiKey: durableApiKey ?? nonBlankString(database.mancerHeader),
        baseUrl: durableBaseUrl ?? nonBlankString(database.textgenWebUIBlockingURL),
      }
    case LLMFormat.Horde:
      return { ...base, apiKey: durableApiKey ?? nonBlankString(database.hordeConfig?.apiKey) }
    case LLMFormat.GoogleCloud:
      return { ...base, apiKey: durableApiKey ?? nonBlankString(database.google?.accessToken) }
    case LLMFormat.VertexAIGemini:
      return {
        ...base,
        vertex: {
          projectId: nonBlankString(database.google?.projectId),
          region: nonBlankString(database.vertexRegion),
          clientEmail: nonBlankString(database.vertexClientEmail),
          privateKey: nonBlankString(database.vertexPrivateKey),
        },
      }
    case LLMFormat.OpenAIResponseAPI:
      return {
        ...base,
        apiKey: durableApiKey ?? nonBlankString(database.openAIKey),
        baseUrl: modelInfo.endpoint ? stripTrailingPath(modelInfo.endpoint, '/responses') : undefined,
      }
    case LLMFormat.OpenAILegacyInstruct:
      return { ...base, apiKey: durableApiKey ?? nonBlankString(database.openAIKey) }
    default:
      return { ...base, apiKey: durableApiKey ?? nonBlankString(database.openAIKey) }
  }
}

function resolveRuntimeOptions(
  database: Database,
  modelInfo: ResolvedModelProfileModelInfo,
  durableRuntimeOptions?: ModelProfileRecordRuntimeOptions,
  options: { useLegacyFallback?: boolean } = {},
): ModelProfileRuntimeOptions {
  const useLegacyFallback = options.useLegacyFallback !== false
  const value = <T>(runtimeValue: T | undefined, legacyValue: T | undefined): T | undefined =>
    runtimeValue ?? (useLegacyFallback ? legacyValue : undefined)
  return {
    maxContext: finiteNumber(value(durableRuntimeOptions?.maxContext, database.maxContext)),
    maxResponse: finiteNumber(value(durableRuntimeOptions?.maxResponse, database.maxResponse)),
    temperature: normalizeSampler(value(durableRuntimeOptions?.temperature, database.temperature), { scale: 100 }),
    rawTemperature: finiteNumber(value(durableRuntimeOptions?.temperature, database.temperature)),
    topP: normalizeSampler(value(durableRuntimeOptions?.topP, database.top_p)),
    topK: normalizeSampler(value(durableRuntimeOptions?.topK, database.top_k)),
    minP: normalizeSampler(value(durableRuntimeOptions?.minP, database.min_p)),
    topA: normalizeSampler(value(durableRuntimeOptions?.topA, database.top_a)),
    repetitionPenalty: normalizeSampler(value(durableRuntimeOptions?.repetitionPenalty, database.repetition_penalty)),
    frequencyPenalty: normalizeSampler(value(durableRuntimeOptions?.frequencyPenalty, database.frequencyPenalty), {
      scale: 100,
    }),
    presencePenalty: normalizeSampler(value(durableRuntimeOptions?.presencePenalty, database.PresensePenalty), {
      scale: 100,
    }),
    reasoningEffort: finiteNumber(value(durableRuntimeOptions?.reasoningEffort, database.reasoningEffort)),
    thinkingTokens: finiteNumber(value(durableRuntimeOptions?.thinkingTokens, database.thinkingTokens)),
    thinkingType: value(durableRuntimeOptions?.thinkingType, database.thinkingType),
    deepseekThinkingType: value(durableRuntimeOptions?.deepseekThinkingType, database.deepseekThinkingType),
    adaptiveThinkingEffort: value(durableRuntimeOptions?.adaptiveThinkingEffort, database.adaptiveThinkingEffort),
    deepseekReasoningEffort: value(durableRuntimeOptions?.deepseekReasoningEffort, database.deepseekReasoningEffort),
    verbosity: finiteNumber(value(durableRuntimeOptions?.verbosity, database.verbosity)),
    useStreaming: value(durableRuntimeOptions?.useStreaming, database.useStreaming),
    genTime: finiteNumber(value(durableRuntimeOptions?.genTime, database.genTime)),
    extractJson: value(durableRuntimeOptions?.extractJson, database.extractJson),
    jsonSchemaEnabled: value(durableRuntimeOptions?.jsonSchemaEnabled, database.jsonSchemaEnabled),
    jsonSchema: value(durableRuntimeOptions?.jsonSchema, database.jsonSchema),
    strictJsonSchema: value(durableRuntimeOptions?.strictJsonSchema, database.strictJsonSchema),
    outputImageModal: value(durableRuntimeOptions?.outputImageModal, database.outputImageModal),
    dynamicOutput: value(durableRuntimeOptions?.dynamicOutput, database.dynamicOutput),
    modelTools:
      durableRuntimeOptions?.modelTools !== undefined
        ? [...durableRuntimeOptions.modelTools]
        : useLegacyFallback && Array.isArray(database.modelTools)
          ? [...database.modelTools]
          : [],
    enableCustomFlags: value(durableRuntimeOptions?.enableCustomFlags, database.enableCustomFlags),
    customFlags:
      durableRuntimeOptions?.customFlags !== undefined
        ? [...durableRuntimeOptions.customFlags]
        : useLegacyFallback && Array.isArray(database.customFlags)
          ? [...database.customFlags]
          : undefined,
    customTokenizer: value(
      durableRuntimeOptions?.customTokenizer,
      database.customTokenizer || tokenizerName(modelInfo.tokenizer),
    ),
  }
}

function resolveProfileRequestModelFromParts(
  database: Database,
  modelId: string,
  modelInfo: ResolvedModelProfileModelInfo,
  profileRequestModel?: string,
  firstClassProviderId?: FirstClassModelProfileProviderId,
): string {
  const durableRequestModel = nonBlankString(profileRequestModel)
  if (durableRequestModel) return durableRequestModel
  if (firstClassProviderId) {
    if (firstClassProviderId === 'custom-api') return ''
    if (firstClassProviderId === 'google' || firstClassProviderId === 'vertex') {
      const raw = modelInfo.internalID ?? modelInfo.id
      return raw.startsWith('models/') ? raw.slice('models/'.length) : raw
    }
    return modelInfo.internalID ?? modelInfo.id
  }

  const providerCapability = resolveProviderCapability(
    buildProfileProviderCapabilityInputForDatabase(database, modelId, modelInfo),
  )
  const provider = providerCapability.routable ? providerCapability.provider : undefined
  if (modelId === 'ollama-cloud') return database.ollamaCloudModel ?? ''
  if (modelInfo.format === LLMFormat.Ollama || modelId.includes('ollama')) return database.ollamaModel ?? ''
  if (provider === 'ollama') return database.ollamaModel ?? ''
  if (modelId.startsWith('xcustom:::')) {
    const entry = findXcustomEntry(database, modelId)
    return nonBlankString(entry?.internalId) ?? nonBlankString(entry?.id) ?? modelId
  }
  if (modelId === 'reverse_proxy') return database.customProxyRequestModel ?? ''
  if (provider === 'bedrock') return resolveBedrockWireModel(modelInfo.internalID ?? modelInfo.id)
  if (provider === 'horde') return modelId.startsWith('horde:::') ? modelId.slice('horde:::'.length) : modelId
  if (provider === 'nanogpt') return database.nanogptRequestModel ?? ''
  if (provider === 'openrouter') return database.openrouterRequestModel ?? ''
  if (provider === 'gemini') {
    const raw = modelInfo.internalID ?? modelInfo.id
    return raw.startsWith('models/') ? raw.slice('models/'.length) : raw
  }
  if (provider === 'openai-legacy-instruct') {
    return modelInfo.format === LLMFormat.NanoGPTLegacy
      ? (database.nanogptRequestModel ?? '')
      : 'gpt-3.5-turbo-instruct'
  }
  if (provider === 'anthropic' && modelInfo.format === LLMFormat.NanoGPTMessages) {
    return database.nanogptRequestModel ?? ''
  }
  if (provider === 'openai-responses') {
    return modelInfo.format === LLMFormat.NanoGPTResponses
      ? (database.nanogptRequestModel ?? '')
      : (modelInfo.internalID ?? modelInfo.id)
  }
  return modelInfo.id
}

function resolveBedrockWireModel(internalId: string): string {
  let useGlobal = false
  const dateMatch = internalId.match(/(\d{8})/)
  const datePart = dateMatch ? Number(dateMatch[1]) : NaN
  const versionMatch = internalId.match(/claude-(?:opus-|sonnet-|haiku-)?(\d+)-(\d+)/)
  if (!Number.isNaN(datePart) && datePart > 0) {
    useGlobal = datePart >= 20250929
  } else if (versionMatch) {
    const major = Number(versionMatch[1])
    const minor = Number(versionMatch[2])
    useGlobal = major > 4 || (major === 4 && minor >= 5)
  }
  return (useGlobal ? 'global.' : 'us.') + internalId
}

function withDurableModelInfoOptions(
  modelId: string,
  providerOptions: EffectiveModelProfileRecordProviderOptions | undefined,
  database: Database,
  modelInfo: ResolvedModelProfileModelInfo,
): ResolvedModelProfileModelInfo {
  if (modelId !== 'ollama-cloud' || providerOptions?.ollama?.requestFormat === undefined) return modelInfo
  return {
    ...modelInfo,
    format: asFormat(
      providerOptions.ollama.requestFormat,
      asFormat(database.ollamaRequestFormat, LLMFormat.OpenAICompatible),
    ),
  }
}

function withCustomFlags(
  database: Database,
  modelInfo: ResolvedModelProfileModelInfo,
  durableRuntimeOptions?: ModelProfileRecordRuntimeOptions,
  options: { useLegacyFallback?: boolean } = {},
): ResolvedModelProfileModelInfo {
  const useLegacyFallback = options.useLegacyFallback ?? durableRuntimeOptions === undefined
  const enableCustomFlags =
    durableRuntimeOptions?.enableCustomFlags ?? (useLegacyFallback ? database.enableCustomFlags : false)
  if (enableCustomFlags) {
    return {
      ...modelInfo,
      flags:
        durableRuntimeOptions?.customFlags !== undefined
          ? [...durableRuntimeOptions.customFlags]
          : useLegacyFallback && Array.isArray(database.customFlags)
            ? [...database.customFlags]
            : [],
    }
  }
  return modelInfo
}

function completeModel(modelInfo: Omit<LLMModel, 'shortName' | 'fullName'> & Partial<LLMModel>): LLMModel {
  return {
    ...modelInfo,
    shortName: modelInfo.shortName ?? modelInfo.name,
    internalID: modelInfo.internalID ?? modelInfo.id,
    fullName:
      modelInfo.fullName ??
      (modelInfo.provider !== LLMProvider.AsIs
        ? `${ProviderNames.get(modelInfo.provider) ?? ''} ${modelInfo.name}`.trim()
        : modelInfo.name),
  }
}

function unknownModel(id: string): ResolvedModelProfileModelInfo {
  return {
    ...completeModel({
      id,
      name: id || 'Unknown',
      shortName: id || 'Unknown',
      fullName: id || 'Unknown',
      internalID: id,
      provider: LLMProvider.AsIs,
      format: LLMFormat.OpenAICompatible,
      flags: [],
      parameters: OpenAIParameters,
      tokenizer: LLMTokenizer.Unknown,
    }),
    unsupportedReason: `unsupported /chat provider: unknown OpenAI-compatible model "${id}" cannot be dispatched by the server`,
  }
}

function cloneModelInfo(modelInfo: LLMModel): ResolvedModelProfileModelInfo {
  return {
    ...modelInfo,
    flags: [...modelInfo.flags],
    parameters: [...modelInfo.parameters],
  }
}

function cloneCustomModelDependency(
  entry: CustomModelEntry,
  fallbackId: string,
  apiKey = nonBlankString(entry.key),
): CustomModelProfileDependency {
  return {
    id: nonBlankString(entry.id) ?? fallbackId,
    internalId: nonBlankString(entry.internalId),
    url: nonBlankString(entry.url),
    key: apiKey,
    format: asFormat(entry.format, undefined),
    tokenizer: asTokenizer(entry.tokenizer, undefined),
    params: typeof entry.params === 'string' ? entry.params : undefined,
    flags: Array.isArray(entry.flags) ? [...entry.flags] : undefined,
  }
}

function cloneProviderCapabilityInput(input: ProviderCapabilityInput): ProviderCapabilityInput {
  return {
    ...input,
    config: {
      ...input.config,
      oaiCompApiKeys: input.config.oaiCompApiKeys ? { ...input.config.oaiCompApiKeys } : undefined,
      customModels: input.config.customModels?.map((entry) => ({ ...entry })),
    },
  }
}

function cloneOpenrouterProvider(value?: {
  order?: string[]
  only?: string[]
  ignore?: string[]
}): NonNullable<ModelProfileProviderOptions['openrouter']>['provider'] {
  if (!value) return undefined
  return {
    order: Array.isArray(value.order) ? [...value.order] : undefined,
    only: Array.isArray(value.only) ? [...value.only] : undefined,
    ignore: Array.isArray(value.ignore) ? [...value.ignore] : undefined,
  }
}

function cloneStringRecord(value: Record<string, string> | undefined): Record<string, string> | undefined {
  return value ? { ...value } : undefined
}

function cloneAdditionalParams(value: Array<[string, string]> | undefined): Array<[string, string]> | undefined {
  return value?.map(([key, val]) => [key, val])
}

function findXcustomEntry(database: Database, modelId: string): CustomModelEntry | null {
  const models = Array.isArray(database.customModels) ? (database.customModels as CustomModelEntry[]) : []
  return models.find((entry) => entry.id === modelId) ?? null
}

function buildCapabilityCustomModels(
  database: Database,
  modelId: string,
  profileApiKey: string | undefined,
): CustomModelEntryLike[] | undefined {
  const models = Array.isArray(database.customModels) ? (database.customModels as CustomModelEntryLike[]) : undefined
  if (!profileApiKey || !modelId.startsWith('xcustom:::') || !models) return models
  return models.map((entry) => (entry.id === modelId ? { ...entry, key: profileApiKey } : entry))
}

interface CustomModelEntry extends CustomModelEntryLike {
  name?: unknown
  internalId?: unknown
  params?: unknown
  tokenizer?: unknown
  flags?: unknown
}

function additionalParams(value: unknown): Array<[string, string]> | undefined {
  if (!Array.isArray(value)) return undefined
  const out: Array<[string, string]> = []
  for (const row of value) {
    if (Array.isArray(row) && typeof row[0] === 'string' && typeof row[1] === 'string') {
      out.push([row[0], row[1]])
    }
  }
  return out.length > 0 ? out : undefined
}

function parseXcustomParams(params: unknown): Array<[string, string]> | undefined {
  if (typeof params !== 'string' || params.length === 0) return undefined
  const out: Array<[string, string]> = []
  for (const line of params.split('\n')) {
    const split = line.split('=')
    if (split.length < 2) continue
    out.push([split[0], split.slice(1).join('=')])
  }
  return out.length > 0 ? out : undefined
}

function xcustomBaseUrl(entry: CustomModelEntry | null, format: LLMFormat): string | undefined {
  const url = nonBlankString(entry?.url)
  if (!url) return undefined
  switch (format) {
    case LLMFormat.Anthropic:
    case LLMFormat.NanoGPTMessages:
      return stripTrailingPath(url, '/messages')
    case LLMFormat.Cohere:
      return stripTrailingPath(url, '/chat')
    case LLMFormat.OpenAILegacyInstruct:
    case LLMFormat.NanoGPTLegacy:
      return stripTrailingPath(url, '/completions')
    case LLMFormat.OpenAIResponseAPI:
    case LLMFormat.NanoGPTResponses:
      return stripTrailingPath(url, '/responses')
    default:
      return deriveOpenAIBaseUrl(url)
  }
}

function resolveReverseProxyUrlForFormat(
  rawUrl: string,
  autofill: boolean,
  format: LLMFormat,
): {
  baseUrl: string
  risuIdentify: boolean
} {
  switch (format) {
    case LLMFormat.Anthropic:
    case LLMFormat.AnthropicLegacy:
    case LLMFormat.NanoGPTMessages:
      return resolveReverseProxyUrl(rawUrl, autofill, 'messages')
    case LLMFormat.Cohere:
      return resolveReverseProxyUrl(rawUrl, autofill, 'chat')
    case LLMFormat.OpenAILegacyInstruct:
    case LLMFormat.NanoGPTLegacy:
      return resolveReverseProxyUrl(rawUrl, autofill, 'completions')
    case LLMFormat.OpenAIResponseAPI:
    case LLMFormat.NanoGPTResponses:
      return resolveReverseProxyUrl(rawUrl, autofill, 'responses')
    default:
      return resolveReverseProxyUrl(rawUrl, autofill, 'chat/completions')
  }
}

function resolveReverseProxyUrl(
  rawUrl: string,
  autofill: boolean,
  suffix: 'chat/completions' | 'messages' | 'chat' | 'completions' | 'responses',
): {
  baseUrl: string
  risuIdentify: boolean
} {
  let url = rawUrl
  let risuIdentify = false
  if (url.startsWith('risu::')) {
    risuIdentify = true
    url = url.slice('risu::'.length)
  }
  if (autofill && url.length > 0) {
    if (url.endsWith('v1')) {
      url += `/${suffix}`
    } else if (url.endsWith('v1/')) {
      url += suffix
    } else if (!(url.endsWith(suffix) || url.endsWith(`${suffix}/`))) {
      url += url.endsWith('/') ? `v1/${suffix}` : `/v1/${suffix}`
    }
  }
  return { baseUrl: stripTrailingPath(url, `/${suffix}`), risuIdentify }
}

function deriveOpenAIBaseUrl(endpoint: string): string {
  return stripTrailingPath(endpoint, '/chat/completions')
}

function stripTrailingPath(rawUrl: string, path: string): string {
  const trimmed = rawUrl.replace(/\/+$/, '')
  return trimmed.endsWith(path) ? trimmed.slice(0, -path.length) : trimmed
}

function normalizeSampler(value: unknown, options: { scale?: number } = {}): number | undefined {
  const numeric = finiteNumber(value)
  if (numeric === undefined || numeric === -1000) return undefined
  return options.scale ? numeric / options.scale : numeric
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function nonBlankString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function asFormat(value: unknown, fallback: LLMFormat): LLMFormat
function asFormat(value: unknown, fallback: undefined): LLMFormat | undefined
function asFormat(value: unknown, fallback: LLMFormat | undefined): LLMFormat | undefined {
  return typeof value === 'number' && Object.values(LLMFormat).includes(value as LLMFormat)
    ? (value as LLMFormat)
    : fallback
}

function asTokenizer(value: unknown, fallback: LLMTokenizerValue): LLMTokenizerValue
function asTokenizer(value: unknown, fallback: undefined): LLMTokenizerValue | undefined
function asTokenizer(value: unknown, fallback: LLMTokenizerValue | undefined): LLMTokenizerValue | undefined {
  return typeof value === 'number' && Object.values(LLMTokenizer).includes(value as LLMTokenizerValue)
    ? (value as LLMTokenizerValue)
    : fallback
}

function tokenizerName(tokenizer: LLMTokenizerValue): string | undefined {
  return Object.entries(LLMTokenizer).find(([, value]) => value === tokenizer)?.[0]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
