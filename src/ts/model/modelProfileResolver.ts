import type { Database } from '../storage/database.svelte'
import {
  LEGACY_FALLBACK_MODEL_KEYS,
  type LegacyFallbackModelKey,
  type LegacyModelMode,
  type ModelRole,
  type ModelRoleLike,
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
} from '../process/request/providerCapability'
import { normalizeModelProfiles, normalizeModelRoleProfiles, type ModelProfileRecord } from './modelProfileRecords'

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
  source: ModelProfileResolutionSource
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
  const lookedUp = lookupModelInfo?.(database, selection.modelId)
  const modelInfo = withCustomFlags(
    database,
    cloneModelInfo(lookedUp ?? resolveServerSafeModelInfo(database, selection.modelId)),
  )
  const requestModel = resolveProfileRequestModelFromParts(
    database,
    selection.modelId,
    modelInfo,
    selection.profileRequestModel,
  )
  const providerOptions = resolveProviderOptions(database, selection.modelId, modelInfo, requestModel)
  const runtimeOptions = resolveRuntimeOptions(database, modelInfo)
  const profile: Omit<
    ResolvedModelProfile,
    'providerCapabilityInput' | 'providerCapability' | 'requestModel' | 'providerOptions'
  > & {
    requestModel: string
    providerOptions: ModelProfileProviderOptions
  } = {
    role: normalizedRole,
    legacyMode: selection.source.legacyMode,
    profileId:
      'profileId' in selection && selection.profileId
        ? selection.profileId
        : `legacy:${selection.source.field ?? selection.source.kind}:${selection.modelId}`,
    legacy: true,
    source: selection.source,
    modelId: selection.modelId,
    requestModel,
    modelInfo,
    providerOptions,
    runtimeOptions,
    fallbacks: staticModelId ? [] : resolveLegacyFallbackRefs(database, normalizedRole),
  }
  const providerCapabilityInput = buildProfileProviderCapabilityInputForDatabase(database, selection.modelId, modelInfo)
  const providerCapability = resolveProviderCapability(providerCapabilityInput)

  return {
    ...profile,
    providerOptions: {
      ...providerOptions,
      provider: providerCapability.routable ? providerCapability.provider : providerOptions.provider,
    },
    providerCapabilityInput,
    providerCapability,
  }
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

export function resolveServerSafeModelInfo(database: Database, modelId: string): ResolvedModelProfileModelInfo {
  const id = nonBlankString(modelId) ?? ''
  if (!id) return unknownModel('')

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
    )
  }

  const staticModel = SERVER_SAFE_MODELS.find((candidate) => candidate.id === id)
  if (staticModel) return withCustomFlags(database, cloneModelInfo(staticModel))

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
    )
  }
  if (id.startsWith('gemini-')) {
    const isVertex = id.endsWith('-vertex') || nonBlankString(database.vertexClientEmail) !== undefined
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

  return withCustomFlags(database, unknownModel(id))
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

function resolveDurableModelSelection(database: Database, role: ModelRole): ModelProfileSelection | null {
  const binding = normalizeModelRoleProfiles(database.modelRoleProfiles)[role]
  if (binding.mode !== 'profile') return null

  const profile = findDurableModelProfile(database.modelProfiles, binding.profileId)
  const modelId = nonBlankString(profile?.modelId)
  if (!profile || !modelId) return null
  const profileRequestModel = nonBlankString(profile.providerOptions?.requestModel)

  return {
    modelId,
    profileId: profile.id,
    ...(profileRequestModel ? { profileRequestModel } : {}),
    source: {
      kind: 'durable-profile',
      role,
      legacyMode: modelRoleToLegacyModelMode(role),
      field: `modelRoleProfiles.${role}`,
      profileId: profile.id,
      profileName: profile.name,
      bypassesRoleResolution: false,
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
): ProviderCapabilityInput {
  return {
    format: modelId === 'ollama-cloud' ? LLMFormat.Ollama : modelInfo.format,
    aiModel: modelId,
    endpoint: nonBlankString(modelInfo.endpoint),
    keyIdentifier: nonBlankString(modelInfo.keyIdentifier),
    internalID: nonBlankString(modelInfo.internalID),
    config: {
      forceReplaceUrl: nonBlankString(database.forceReplaceUrl),
      proxyKey: nonBlankString(database.proxyKey),
      oaiCompApiKeys: database.OaiCompAPIKeys,
      customModels: database.customModels as CustomModelEntryLike[] | undefined,
      googleProjectId: database.google?.projectId,
      vertexRegion: database.vertexRegion,
      vertexClientEmail: database.vertexClientEmail,
      vertexPrivateKey: database.vertexPrivateKey,
      claudeAPIKey: database.claudeAPIKey,
      instructChatTemplate: nonBlankString(database.instructChatTemplate),
      jinjaTemplate: nonBlankString(database.JinjaTemplate),
      ollamaApiKey: nonBlankString(database.ollamaApiKey),
      ollamaRequestFormat: asFormat(database.ollamaRequestFormat, undefined),
      ollamaURL: nonBlankString(database.ollamaURL),
    },
  }
}

function resolveProviderOptions(
  database: Database,
  modelId: string,
  modelInfo: ResolvedModelProfileModelInfo,
  requestModel: string,
): ModelProfileProviderOptions {
  const base: ModelProfileProviderOptions = {
    requestModel,
    endpoint: nonBlankString(modelInfo.endpoint),
    keyIdentifier: nonBlankString(modelInfo.keyIdentifier),
  }
  if (modelId === 'ollama-cloud') {
    return {
      ...base,
      apiKey: nonBlankString(database.ollamaApiKey),
      baseUrl: 'https://ollama.com/v1',
      ollama: {
        apiKey: nonBlankString(database.ollamaApiKey),
        requestFormat: asFormat(database.ollamaRequestFormat, LLMFormat.OpenAICompatible),
        model: nonBlankString(requestModel),
        modelSource: database.ollamaModelSource,
        thinkingMode: database.ollamaThinkingMode,
        cloud: true,
      },
    }
  }
  if (modelInfo.format === LLMFormat.Ollama || modelId.includes('ollama')) {
    return {
      ...base,
      baseUrl: nonBlankString(database.ollamaURL),
      ollama: {
        url: nonBlankString(database.ollamaURL),
        requestFormat: LLMFormat.Ollama,
        model: nonBlankString(requestModel),
        modelSource: database.ollamaModelSource,
        thinkingMode: database.ollamaThinkingMode,
        cloud: false,
      },
    }
  }
  if (modelId === 'openrouter') {
    return {
      ...base,
      apiKey: nonBlankString(database.openrouterKey),
      baseUrl: OPENROUTER_BASE_URL,
      extraHeaders: { 'X-Title': 'RisuAI', 'HTTP-Referer': 'https://risuai.xyz' },
      openrouter: {
        fallback: database.openrouterFallback,
        middleOut: database.openrouterMiddleOut,
        provider: cloneOpenrouterProvider(database.openrouterProvider),
      },
    }
  }
  if (modelId === 'nanogpt' || modelInfo.format === LLMFormat.NanoGPT) {
    return {
      ...base,
      apiKey: nonBlankString(database.nanogptKey),
      baseUrl: database.nanogptUseSubscriptionEndpoint === true ? NANOGPT_SUBSCRIPTION_BASE_URL : NANOGPT_BASE_URL,
      extraHeaders: nonBlankString(database.nanogptProvider)
        ? { 'X-Provider': database.nanogptProvider as string }
        : undefined,
      nanogpt: {
        providerHint: nonBlankString(database.nanogptProvider),
        useSubscriptionEndpoint: database.nanogptUseSubscriptionEndpoint,
        subscriptionState: database.nanogptSubscriptionState,
      },
    }
  }
  if (
    modelInfo.format === LLMFormat.NanoGPTLegacy ||
    modelInfo.format === LLMFormat.NanoGPTResponses ||
    modelInfo.format === LLMFormat.NanoGPTMessages
  ) {
    return {
      ...base,
      apiKey: nonBlankString(database.nanogptKey),
      baseUrl: NANOGPT_BASE_URL,
      extraHeaders: nonBlankString(database.nanogptProvider)
        ? { 'X-Provider': database.nanogptProvider as string }
        : undefined,
      nanogpt: {
        providerHint: nonBlankString(database.nanogptProvider),
        useSubscriptionEndpoint: database.nanogptUseSubscriptionEndpoint,
        subscriptionState: database.nanogptSubscriptionState,
      },
    }
  }
  if (modelId === 'reverse_proxy') {
    const rawUrl = nonBlankString(database.forceReplaceUrl) ?? ''
    const reverseProxyUrl = resolveReverseProxyUrlForFormat(
      rawUrl,
      database.autofillRequestUrl !== false,
      modelInfo.format,
    )
    return {
      ...base,
      apiKey: nonBlankString(database.proxyKey),
      baseUrl: reverseProxyUrl.baseUrl,
      extraHeaders: reverseProxyUrl.risuIdentify ? { 'X-Proxy-Risu': 'RisuAI' } : undefined,
      additionalParams: additionalParams(database.additionalParams),
      reverseProxy: {
        autofillRequestUrl: database.autofillRequestUrl !== false,
        oobaSystemHoist: database.reverseProxyOobaMode === true,
        oobaArgs: database.reverseProxyOobaArgs,
        risuIdentify: reverseProxyUrl.risuIdentify,
      },
    }
  }
  if (modelId.startsWith('xcustom:::')) {
    const entry = findXcustomEntry(database, modelId)
    return {
      ...base,
      apiKey: nonBlankString(entry?.key),
      baseUrl: xcustomBaseUrl(entry, modelInfo.format),
      additionalParams: parseXcustomParams(entry?.params),
      customModel: entry ? cloneCustomModelDependency(entry, modelId) : undefined,
    }
  }
  if (modelInfo.keyIdentifier) {
    return {
      ...base,
      apiKey: nonBlankString(database.OaiCompAPIKeys?.[modelInfo.keyIdentifier]),
      baseUrl: modelInfo.endpoint ? deriveOpenAIBaseUrl(modelInfo.endpoint) : undefined,
    }
  }

  switch (modelInfo.format) {
    case LLMFormat.AWSBedrockClaude:
      return { ...base, apiKey: nonBlankString(database.claudeAPIKey) }
    case LLMFormat.Anthropic:
    case LLMFormat.AnthropicLegacy:
      return { ...base, apiKey: nonBlankString(database.claudeAPIKey) }
    case LLMFormat.Mistral:
      return { ...base, apiKey: nonBlankString(database.mistralKey) }
    case LLMFormat.Cohere:
      return { ...base, apiKey: nonBlankString(database.cohereAPIKey) }
    case LLMFormat.Kobold:
      return { ...base, baseUrl: nonBlankString(database.koboldURL) }
    case LLMFormat.OobaLegacy:
      return {
        ...base,
        apiKey: nonBlankString(database.mancerHeader),
        baseUrl: nonBlankString(database.textgenWebUIBlockingURL),
      }
    case LLMFormat.Horde:
      return { ...base, apiKey: nonBlankString(database.hordeConfig?.apiKey) }
    case LLMFormat.GoogleCloud:
      return { ...base, apiKey: nonBlankString(database.google?.accessToken) }
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
        apiKey: nonBlankString(database.openAIKey),
        baseUrl: modelInfo.endpoint ? stripTrailingPath(modelInfo.endpoint, '/responses') : undefined,
      }
    case LLMFormat.OpenAILegacyInstruct:
      return { ...base, apiKey: nonBlankString(database.openAIKey) }
    default:
      return { ...base, apiKey: nonBlankString(database.openAIKey) }
  }
}

function resolveRuntimeOptions(
  database: Database,
  modelInfo: ResolvedModelProfileModelInfo,
): ModelProfileRuntimeOptions {
  return {
    maxContext: finiteNumber(database.maxContext),
    maxResponse: finiteNumber(database.maxResponse),
    temperature: normalizeSampler(database.temperature, { scale: 100 }),
    rawTemperature: finiteNumber(database.temperature),
    topP: normalizeSampler(database.top_p),
    topK: normalizeSampler(database.top_k),
    minP: normalizeSampler(database.min_p),
    topA: normalizeSampler(database.top_a),
    repetitionPenalty: normalizeSampler(database.repetition_penalty),
    frequencyPenalty: normalizeSampler(database.frequencyPenalty, { scale: 100 }),
    presencePenalty: normalizeSampler(database.PresensePenalty, { scale: 100 }),
    reasoningEffort: finiteNumber(database.reasoningEffort),
    thinkingTokens: finiteNumber(database.thinkingTokens),
    thinkingType: database.thinkingType,
    deepseekThinkingType: database.deepseekThinkingType,
    adaptiveThinkingEffort: database.adaptiveThinkingEffort,
    deepseekReasoningEffort: database.deepseekReasoningEffort,
    verbosity: finiteNumber(database.verbosity),
    useStreaming: database.useStreaming,
    genTime: finiteNumber(database.genTime),
    extractJson: database.extractJson,
    jsonSchemaEnabled: database.jsonSchemaEnabled,
    jsonSchema: database.jsonSchema,
    strictJsonSchema: database.strictJsonSchema,
    outputImageModal: database.outputImageModal,
    dynamicOutput: database.dynamicOutput,
    modelTools: Array.isArray(database.modelTools) ? [...database.modelTools] : [],
    enableCustomFlags: database.enableCustomFlags,
    customFlags: Array.isArray(database.customFlags) ? [...database.customFlags] : undefined,
    customTokenizer: database.customTokenizer || tokenizerName(modelInfo.tokenizer),
  }
}

function resolveProfileRequestModelFromParts(
  database: Database,
  modelId: string,
  modelInfo: ResolvedModelProfileModelInfo,
  profileRequestModel?: string,
): string {
  const durableRequestModel = nonBlankString(profileRequestModel)
  if (durableRequestModel) return durableRequestModel

  const providerCapability = resolveProviderCapability(
    buildProfileProviderCapabilityInputForDatabase(database, modelId, modelInfo),
  )
  const provider = providerCapability.routable ? providerCapability.provider : undefined
  if (modelId === 'ollama-cloud') return database.ollamaCloudModel ?? ''
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

function withCustomFlags(database: Database, modelInfo: ResolvedModelProfileModelInfo): ResolvedModelProfileModelInfo {
  if (database.enableCustomFlags) {
    return {
      ...modelInfo,
      flags: Array.isArray(database.customFlags) ? [...database.customFlags] : [],
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

function cloneCustomModelDependency(entry: CustomModelEntry, fallbackId: string): CustomModelProfileDependency {
  return {
    id: nonBlankString(entry.id) ?? fallbackId,
    internalId: nonBlankString(entry.internalId),
    url: nonBlankString(entry.url),
    key: nonBlankString(entry.key),
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

function cloneOpenrouterProvider(
  value: Database['openrouterProvider'],
): NonNullable<ModelProfileProviderOptions['openrouter']>['provider'] {
  if (!value) return undefined
  return {
    order: Array.isArray(value.order) ? [...value.order] : undefined,
    only: Array.isArray(value.only) ? [...value.only] : undefined,
    ignore: Array.isArray(value.ignore) ? [...value.ignore] : undefined,
  }
}

function findXcustomEntry(database: Database, modelId: string): CustomModelEntry | null {
  const models = Array.isArray(database.customModels) ? (database.customModels as CustomModelEntry[]) : []
  return models.find((entry) => entry.id === modelId) ?? null
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
