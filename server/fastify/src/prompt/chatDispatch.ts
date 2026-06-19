import type { Database } from '../../../../src/ts/storage/database.svelte'
import type { OpenAIChat } from '../../../../src/ts/process/index.svelte'
import { LLMFlags, LLMFormat, type LLMFormat as LLMFormatValue } from '../../../../src/ts/model/types'
import { OpenAIModels } from '../../../../src/ts/model/providers/openai'
import type { CompletionResult, CompletionStreamFrame } from '../generation/frames.js'
import { resolveEchoRequest, runEcho, runEchoStream } from '../generation/echo.js'
import { resolveOpenAIRequest, runOpenAI, runOpenAIStream } from '../generation/openai.js'
import { resolveAnthropicRequest, runAnthropic, runAnthropicStream } from '../generation/anthropic.js'
import { resolveMistralRequest, runMistral, runMistralStream } from '../generation/mistral.js'
import { resolveCohereRequest, runCohere } from '../generation/cohere.js'
import { resolveGeminiRequest, runGemini, runGeminiStream } from '../generation/gemini.js'
import { resolveOpenAILegacyInstructRequest, runOpenAILegacyInstruct } from '../generation/openaiLegacyInstruct.js'
import { resolveOpenAIResponsesRequest, runOpenAIResponses } from '../generation/openaiResponses.js'
import { resolveKoboldRequest, runKobold } from '../generation/kobold.js'
import { resolveOllamaRequest, runOllama, runOllamaStream } from '../generation/ollama.js'
import { coerceBedrockCredentials, resolveBedrockRequest, runBedrock } from '../generation/bedrock.js'
import { resolveHordeRequest, runHorde } from '../generation/horde.js'
import { resolveOobaLegacyRequest, runOobaLegacy } from '../generation/oobaLegacy.js'
import {
  resolveProviderCapability,
  type CustomModelEntryLike,
  type ProviderCapabilityInput,
  type ProviderUnsupportedReason,
} from '../../../../src/ts/process/request/providerCapability'
import {
  resolveModelProfile,
  resolveProfileRequestModel,
  type ResolvedModelProfile,
} from '../../../../src/ts/model/modelProfileResolver.js'

interface ChatDispatchArgs {
  database: Database
  formated: OpenAIChat[]
  outputTokens?: number
  profile?: ResolvedModelProfile
  signal: AbortSignal
}

interface CustomModelEntry {
  id?: unknown
  name?: unknown
  internalId?: unknown
  url?: unknown
  key?: unknown
  format?: unknown
  params?: unknown
  tokenizer?: unknown
}

interface ModelInfoLite {
  id: string
  format: LLMFormatValue
  internalID?: string
  endpoint?: string
  keyIdentifier?: string
  flags: number[]
  unsupportedReason?: string
}

interface OpenAICompatibleVariant {
  apiKey: string
  baseUrl?: string
  extraHeaders?: Record<string, string>
  additionalParams?: Array<[string, string]>
  oobaSystemHoist?: boolean
}

const NANOGPT_BASE_URL = 'https://nano-gpt.com/api/v1'
const NANOGPT_SUBSCRIPTION_BASE_URL = 'https://nano-gpt.com/api/subscription/v1'
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'
const DISABLED_SAMPLER_SENTINEL = -1000

const DEFAULT_OPENAI_FLAGS = [LLMFlags.hasFullSystemPrompt, LLMFlags.hasStreaming]
const FIRST_SYSTEM_FLAGS = [LLMFlags.hasFirstSystemPrompt]
const ALTERNATING_FLAGS = [
  LLMFlags.hasFirstSystemPrompt,
  LLMFlags.requiresAlternateRole,
  LLMFlags.mustStartWithUserInput,
]
const OPENAI_MODEL_IDS = new Set(
  OpenAIModels.flatMap((model) => [model.id, model.internalID]).filter(
    (id): id is string => typeof id === 'string' && id.length > 0,
  ),
)

export interface ChatDispatchReformatInstrumentation {
  fullPromptClones: number
}

const chatDispatchReformatInstrumentation: ChatDispatchReformatInstrumentation = {
  fullPromptClones: 0,
}

export function resetChatDispatchReformatInstrumentation(): void {
  chatDispatchReformatInstrumentation.fullPromptClones = 0
}

export function getChatDispatchReformatInstrumentation(): ChatDispatchReformatInstrumentation {
  return { ...chatDispatchReformatInstrumentation }
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function normalizeDispatchSampler(value: unknown, options: { scale?: number } = {}): number | undefined {
  const numeric = asNumber(value)
  if (numeric === undefined || numeric === DISABLED_SAMPLER_SENTINEL) return undefined
  return options.scale ? numeric / options.scale : numeric
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

function findXcustomEntry(db: Database, aiModel: string): CustomModelEntry | null {
  const models = Array.isArray(db.customModels) ? (db.customModels as CustomModelEntry[]) : []
  return models.find((m) => m.id === aiModel) ?? null
}

function deriveOpenAIBaseUrl(endpoint: string): string {
  const trimmed = endpoint.replace(/\/+$/, '')
  if (trimmed.endsWith('/chat/completions')) {
    return trimmed.slice(0, -'/chat/completions'.length)
  }
  return trimmed
}

function resolveReverseProxyUrl(
  rawUrl: string,
  autofill: boolean,
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
  if (autofill) {
    if (url.endsWith('v1')) {
      url += '/chat/completions'
    } else if (url.endsWith('v1/')) {
      url += 'chat/completions'
    } else if (!(url.endsWith('completions') || url.endsWith('completions/'))) {
      url += url.endsWith('/') ? 'v1/chat/completions' : '/v1/chat/completions'
    }
  }
  return { baseUrl: deriveOpenAIBaseUrl(url), risuIdentify }
}

function stripTrailingPath(rawUrl: string, path: string): string {
  const trimmed = rawUrl.replace(/\/+$/, '')
  return trimmed.endsWith(path) ? trimmed.slice(0, -path.length) : trimmed
}

function resolveReverseProxyLegacyInstructUrl(rawUrl: string, autofill: boolean): string {
  let url = rawUrl
  if (autofill) {
    if (url.endsWith('v1')) {
      url += '/completions'
    } else if (url.endsWith('v1/')) {
      url += 'completions'
    } else if (!(url.endsWith('completions') || url.endsWith('completions/'))) {
      url += url.endsWith('/') ? 'v1/completions' : '/v1/completions'
    }
  }
  return stripTrailingPath(url, '/completions')
}

function resolveReverseProxyResponsesUrl(rawUrl: string, autofill: boolean): string {
  let url = rawUrl
  if (autofill) {
    if (url.endsWith('v1')) {
      url += '/responses'
    } else if (url.endsWith('v1/')) {
      url += 'responses'
    } else if (!(url.endsWith('responses') || url.endsWith('responses/'))) {
      url += url.endsWith('/') ? 'v1/responses' : '/v1/responses'
    }
  }
  return stripTrailingPath(url, '/responses')
}

function resolveModelInfo(db: Database): ModelInfoLite {
  const aiModel = asString(db.aiModel) ?? ''
  if (aiModel === 'reverse_proxy') {
    return {
      id: aiModel,
      internalID: asString(db.customProxyRequestModel) ?? aiModel,
      format: (asNumber(db.customAPIFormat) ?? LLMFormat.OpenAICompatible) as LLMFormatValue,
      flags: DEFAULT_OPENAI_FLAGS,
    }
  }

  if (aiModel.startsWith('xcustom:::')) {
    const entry = findXcustomEntry(db, aiModel)
    if (entry) {
      return {
        id: asString(entry.id) ?? aiModel,
        internalID: asString(entry.internalId) ?? asString(entry.id) ?? aiModel,
        format: (asNumber(entry.format) ?? LLMFormat.OpenAICompatible) as LLMFormatValue,
        flags: DEFAULT_OPENAI_FLAGS,
      }
    }
  }

  if (aiModel.startsWith('horde:::')) {
    return { id: aiModel, format: LLMFormat.Horde, flags: FIRST_SYSTEM_FLAGS }
  }
  if (aiModel === 'echo_model') {
    return { id: aiModel, format: LLMFormat.Echo, flags: DEFAULT_OPENAI_FLAGS }
  }
  if (aiModel === 'openrouter') {
    return { id: aiModel, format: LLMFormat.OpenAICompatible, flags: DEFAULT_OPENAI_FLAGS }
  }
  if (aiModel === 'nanogpt') {
    return { id: aiModel, format: LLMFormat.NanoGPT, flags: DEFAULT_OPENAI_FLAGS }
  }
  if (aiModel === 'novelai' || aiModel === 'novelai_kayra') {
    return { id: aiModel, format: LLMFormat.NovelAI, flags: DEFAULT_OPENAI_FLAGS }
  }
  if (aiModel === 'novellist' || aiModel === 'novellist_damsel') {
    return { id: aiModel, format: LLMFormat.NovelList, flags: [] }
  }
  if (aiModel === 'ooba') {
    return { id: aiModel, format: LLMFormat.Ooba, flags: FIRST_SYSTEM_FLAGS }
  }
  if (aiModel === 'custom' || aiModel.startsWith('pluginmodel:::')) {
    return { id: aiModel, format: LLMFormat.Plugin, flags: DEFAULT_OPENAI_FLAGS }
  }
  if (aiModel.startsWith('hf:::')) {
    return { id: aiModel, format: LLMFormat.WebLLM, flags: DEFAULT_OPENAI_FLAGS }
  }
  if (aiModel === 'ollama-cloud') {
    return {
      id: aiModel,
      format: (asNumber(db.ollamaRequestFormat) ?? LLMFormat.OpenAICompatible) as LLMFormatValue,
      flags: DEFAULT_OPENAI_FLAGS,
    }
  }
  if (asString(db.ollamaURL) && aiModel.includes('ollama')) {
    return { id: aiModel, format: LLMFormat.Ollama, flags: ALTERNATING_FLAGS }
  }
  if (aiModel.startsWith('deepseek-')) {
    return {
      id: aiModel,
      format: LLMFormat.OpenAICompatible,
      endpoint: 'https://api.deepseek.com/beta/chat/completions',
      keyIdentifier: 'deepseek',
      flags: ALTERNATING_FLAGS,
    }
  }
  if (aiModel.startsWith('deepinfra_')) {
    return {
      id: aiModel.slice('deepinfra_'.length),
      format: LLMFormat.OpenAICompatible,
      endpoint: 'https://api.deepinfra.com/v1/openai/chat/completions',
      keyIdentifier: 'deepinfra',
      flags: ALTERNATING_FLAGS,
    }
  }
  if (aiModel.startsWith('anthropic.')) {
    return {
      id: aiModel,
      internalID: aiModel,
      format: LLMFormat.AWSBedrockClaude,
      flags: FIRST_SYSTEM_FLAGS,
    }
  }
  if (aiModel.startsWith('claude-')) {
    return { id: aiModel, format: LLMFormat.Anthropic, flags: FIRST_SYSTEM_FLAGS }
  }
  if (aiModel.startsWith('mistral') || aiModel.startsWith('magistral')) {
    return { id: aiModel, format: LLMFormat.Mistral, flags: ALTERNATING_FLAGS }
  }
  if (aiModel.startsWith('cohere-')) {
    return { id: aiModel, format: LLMFormat.Cohere, flags: ALTERNATING_FLAGS }
  }
  if (aiModel.startsWith('gemini-')) {
    const isVertex = aiModel.endsWith('-vertex') || asString(db.vertexClientEmail) !== undefined
    return {
      id: aiModel,
      internalID: isVertex ? aiModel.replace(/-vertex$/, '') : aiModel,
      format: isVertex ? LLMFormat.VertexAIGemini : LLMFormat.GoogleCloud,
      flags: ALTERNATING_FLAGS,
    }
  }
  if (aiModel.includes('instruct')) {
    return { id: aiModel, format: LLMFormat.OpenAILegacyInstruct, flags: DEFAULT_OPENAI_FLAGS }
  }
  if (aiModel.endsWith('-response-api')) {
    return {
      id: aiModel,
      internalID: aiModel.slice(0, -'-response-api'.length),
      format: LLMFormat.OpenAIResponseAPI,
      flags: DEFAULT_OPENAI_FLAGS,
    }
  }
  if (asString(db.koboldURL)) {
    return { id: aiModel, format: LLMFormat.Kobold, flags: FIRST_SYSTEM_FLAGS }
  }
  if (asString(db.textgenWebUIBlockingURL)) {
    return { id: aiModel, format: LLMFormat.OobaLegacy, flags: FIRST_SYSTEM_FLAGS }
  }

  if (!OPENAI_MODEL_IDS.has(aiModel)) {
    return {
      id: aiModel,
      format: LLMFormat.OpenAICompatible,
      flags: DEFAULT_OPENAI_FLAGS,
      unsupportedReason: `unsupported /chat provider: unknown OpenAI-compatible model "${aiModel}" cannot be dispatched by the server`,
    }
  }

  return { id: aiModel, format: LLMFormat.OpenAICompatible, flags: DEFAULT_OPENAI_FLAGS }
}

interface ReformatBranchNeeds {
  systemPrompt: boolean
  firstSystemPrompt: boolean
  alternateRole: boolean
  startWithUserInput: boolean
}

function resolveReformatBranchNeeds(flags: readonly number[]): ReformatBranchNeeds {
  const systemPrompt = !flags.includes(LLMFlags.hasFullSystemPrompt)
  return {
    systemPrompt,
    firstSystemPrompt: systemPrompt && flags.includes(LLMFlags.hasFirstSystemPrompt),
    alternateRole: flags.includes(LLMFlags.requiresAlternateRole),
    startWithUserInput: flags.includes(LLMFlags.mustStartWithUserInput),
  }
}

function needsReformatClone(needs: ReformatBranchNeeds): boolean {
  return needs.systemPrompt || needs.alternateRole || needs.startWithUserInput
}

function cloneDispatchRows(rows: OpenAIChat[]): OpenAIChat[] {
  chatDispatchReformatInstrumentation.fullPromptClones++
  return structuredClone(rows)
}

export function reformatMessages(db: Database, rows: OpenAIChat[], flags: readonly number[]): OpenAIChat[] {
  const needs = resolveReformatBranchNeeds(flags)
  if (!needsReformatClone(needs)) return rows

  let formated = cloneDispatchRows(rows)
  let systemPrompt: OpenAIChat | null = null

  if (needs.systemPrompt) {
    if (needs.firstSystemPrompt) {
      while (formated[0]?.role === 'system') {
        if (systemPrompt) {
          systemPrompt.content += '\n\n' + formated[0].content
        } else {
          systemPrompt = formated[0]
        }
        formated = formated.slice(1)
      }
    }

    for (const row of formated) {
      if (row.role === 'system') {
        row.content = db.systemContentReplacement
          ? db.systemContentReplacement.replace('{{slot}}', row.content)
          : `system: ${row.content}`
        const replacement = asString(db.systemRoleReplacement)
        row.role =
          replacement === 'assistant' ||
          replacement === 'user' ||
          replacement === 'function' ||
          replacement === 'system'
            ? replacement
            : 'user'
      }
    }
  }

  if (needs.alternateRole) {
    const merged: OpenAIChat[] = []
    for (const row of formated) {
      const prev = merged[merged.length - 1]
      if (prev && prev.role === row.role) {
        prev.content += '\n' + row.content
        if (row.multimodals) {
          prev.multimodals ??= []
          prev.multimodals.push(...row.multimodals)
        }
        if (row.thoughts) {
          prev.thoughts ??= []
          prev.thoughts.push(...row.thoughts)
        }
        if (row.cachePoint) prev.cachePoint = true
      } else {
        merged.push(row)
      }
    }
    formated = merged
  }

  if (needs.startWithUserInput) {
    if (formated.length === 0 || formated[0].role !== 'user') {
      formated.unshift({ role: 'user', content: ' ' })
    }
  }

  if (systemPrompt) formated.unshift(systemPrompt)
  return formated
}

/**
 * Build the shared capability table's input from the server-resolved
 * `ModelInfoLite` + the route `db`. `ollama-cloud`'s format is pre-remapped to
 * `db.ollamaRequestFormat` by `resolveModelInfo` for dispatch, but the table
 * classifies it the way the browser does — through the Ollama arm, which also
 * gates on `db.ollamaApiKey` — so feed `LLMFormat.Ollama` here; the dispatch
 * arms still read the remapped `info.format`.
 */
function buildChatCapabilityInput(db: Database, info: ModelInfoLite): ProviderCapabilityInput {
  const aiModel = asString(db.aiModel) ?? ''
  return {
    format: aiModel === 'ollama-cloud' ? LLMFormat.Ollama : info.format,
    aiModel,
    endpoint: info.endpoint,
    keyIdentifier: info.keyIdentifier,
    internalID: info.internalID,
    config: {
      forceReplaceUrl: asString(db.forceReplaceUrl),
      proxyKey: asString(db.proxyKey),
      oaiCompApiKeys: db.OaiCompAPIKeys,
      customModels: db.customModels as CustomModelEntryLike[] | undefined,
      googleProjectId: db.google?.projectId,
      vertexRegion: db.vertexRegion,
      vertexClientEmail: db.vertexClientEmail,
      vertexPrivateKey: db.vertexPrivateKey,
      claudeAPIKey: db.claudeAPIKey,
      instructChatTemplate: asString(db.instructChatTemplate),
      jinjaTemplate: asString(db.JinjaTemplate),
      ollamaApiKey: asString(db.ollamaApiKey),
      ollamaRequestFormat: asNumber(db.ollamaRequestFormat) as LLMFormatValue | undefined,
      ollamaURL: asString(db.ollamaURL),
    },
  }
}

/**
 * Map the shared capability table's unsupported category to the specific /chat
 * error message clients/tests rely on. The routing decision is shared with
 * server-intent completion through Fastify; only the prose differs (see
 * `docs/structure/providers-and-models.md`).
 */
function chatProviderUnsupportedReason(reason: ProviderUnsupportedReason, info: ModelInfoLite): string {
  switch (reason) {
    case 'novelai':
      return 'unsupported /chat provider: NovelAI text generation must use local dispatch'
    case 'novellist':
      return 'unsupported /chat provider: NovelList must use local dispatch'
    case 'ooba':
      return 'unsupported /chat provider: Ooba OpenAI-compatible chat must use local dispatch'
    case 'plugin':
      return 'unsupported /chat provider: plugin providers must use local dispatch'
    case 'webllm':
      return 'unsupported /chat provider: local WebLLM models must use local dispatch'
    case 'config-incomplete':
      return `unsupported /chat provider: ${info.id} configuration is incomplete for server dispatch`
    case 'format-not-server-routable':
    default:
      return `unsupported /chat provider: ${info.format}`
  }
}

export type ChatProviderRoute = { routable: true; provider: string } | { routable: false; reason: string }
type ChatProviderRouteTarget = ModelInfoLite | ResolvedModelProfile

function isResolvedModelProfile(target: ChatProviderRouteTarget): target is ResolvedModelProfile {
  return 'providerCapability' in target && 'modelInfo' in target
}

/**
 * The /chat counterpart to `resolveServerCompletionRoute`. Profile-aware callers
 * carry the server-only unknown-id guard through `modelInfo.unsupportedReason`;
 * legacy callers still get the same guard from `resolveModelInfo`. The shared
 * `resolveProviderCapability` table owns the routing decision, so /chat cannot
 * drift from server-intent completion. The stale `reverse_proxy` +
 * `reverseProxyOobaMode` rejection is gone — the openai adapter applies
 * `oobaSystemHoist` itself.
 */
export function resolveChatProviderRoute(
  db: Database,
  target: ChatProviderRouteTarget = resolveModelInfo(db),
): ChatProviderRoute {
  let profile: ResolvedModelProfile | undefined
  let info: ModelInfoLite
  if (isResolvedModelProfile(target)) {
    profile = target
    info = target.modelInfo
  } else {
    info = target
  }
  if (info.unsupportedReason) {
    return { routable: false, reason: info.unsupportedReason }
  }
  const verdict = profile?.providerCapability ?? resolveProviderCapability(buildChatCapabilityInput(db, info))
  if (verdict.routable === true) return { routable: true, provider: verdict.provider }
  return { routable: false, reason: chatProviderUnsupportedReason(verdict.reason, info) }
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

function resolveProviderModel(
  db: Database,
  info: ModelInfoLite,
  provider: string,
  profile?: ResolvedModelProfile,
): string {
  if (profile) return resolveProfileRequestModel(profile)
  const aiModel = asString(db.aiModel) ?? ''
  if (aiModel === 'ollama-cloud') return db.ollamaCloudModel ?? ''
  if (provider === 'ollama') return db.ollamaModel ?? ''
  if (aiModel.startsWith('xcustom:::')) {
    const entry = findXcustomEntry(db, aiModel)
    const internal = asString(entry?.internalId)
    return internal ?? asString(entry?.id) ?? aiModel
  }
  if (aiModel === 'reverse_proxy') return db.customProxyRequestModel ?? ''
  if (provider === 'bedrock') return resolveBedrockWireModel(info.internalID ?? info.id)
  if (provider === 'horde') return aiModel.startsWith('horde:::') ? aiModel.slice('horde:::'.length) : aiModel
  if (provider === 'nanogpt') return db.nanogptRequestModel ?? ''
  if (provider === 'openrouter') return db.openrouterRequestModel ?? ''
  if (provider === 'gemini') {
    const raw = info.internalID ?? info.id
    return raw.startsWith('models/') ? raw.slice('models/'.length) : raw
  }
  if (provider === 'openai-legacy-instruct') {
    return info.format === LLMFormat.NanoGPTLegacy ? (db.nanogptRequestModel ?? '') : 'gpt-3.5-turbo-instruct'
  }
  if (provider === 'anthropic' && info.format === LLMFormat.NanoGPTMessages) {
    return db.nanogptRequestModel ?? ''
  }
  if (provider === 'openai-responses') {
    return info.format === LLMFormat.NanoGPTResponses ? (db.nanogptRequestModel ?? '') : (info.internalID ?? info.id)
  }
  return info.id
}

function resolveProfileOpenAIVariant(profile?: ResolvedModelProfile): OpenAICompatibleVariant | null | undefined {
  if (!profile) return undefined
  const options = profile.providerOptions
  const apiKey = asString(options.apiKey)
  if (!apiKey) return null
  return {
    apiKey,
    baseUrl: asString(options.baseUrl),
    extraHeaders: options.extraHeaders,
    additionalParams: options.additionalParams,
    oobaSystemHoist: options.reverseProxy?.oobaSystemHoist === true,
  }
}

function resolveProfileOllamaBaseUrl(profile: ResolvedModelProfile): string | undefined {
  const options = profile.providerOptions
  return asString(options.ollama?.url) ?? asString(options.baseUrl)
}

function resolveOpenAIVariant(
  db: Database,
  info: ModelInfoLite,
  provider: string,
  profile?: ResolvedModelProfile,
): OpenAICompatibleVariant | null {
  const profileVariant = resolveProfileOpenAIVariant(profile)
  if (profileVariant !== undefined) return profileVariant

  const aiModel = asString(db.aiModel) ?? ''
  if (aiModel === 'ollama-cloud') {
    const apiKey = asString(db.ollamaApiKey)
    return apiKey ? { apiKey, baseUrl: 'https://ollama.com/v1' } : null
  }
  if (provider === 'nanogpt') {
    const apiKey = asString(db.nanogptKey)
    return apiKey
      ? {
          apiKey,
          baseUrl: db.nanogptUseSubscriptionEndpoint === true ? NANOGPT_SUBSCRIPTION_BASE_URL : NANOGPT_BASE_URL,
          extraHeaders: asString(db.nanogptProvider) ? { 'X-Provider': db.nanogptProvider as string } : undefined,
        }
      : null
  }
  if (provider === 'openrouter') {
    const apiKey = asString(db.openrouterKey)
    return apiKey
      ? {
          apiKey,
          baseUrl: OPENROUTER_BASE_URL,
          extraHeaders: { 'X-Title': 'RisuAI', 'HTTP-Referer': 'https://risuai.xyz' },
        }
      : null
  }
  if (aiModel === 'reverse_proxy') {
    const apiKey = asString(db.proxyKey)
    const rawUrl = asString(db.forceReplaceUrl)
    if (!apiKey || !rawUrl) return null
    const { baseUrl, risuIdentify } = resolveReverseProxyUrl(rawUrl, db.autofillRequestUrl !== false)
    return {
      apiKey,
      baseUrl,
      extraHeaders: risuIdentify ? { 'X-Proxy-Risu': 'RisuAI' } : undefined,
      additionalParams: additionalParams(db.additionalParams),
      oobaSystemHoist: db.reverseProxyOobaMode === true,
    }
  }
  if (aiModel.startsWith('xcustom:::')) {
    const entry = findXcustomEntry(db, aiModel)
    const apiKey = asString(entry?.key)
    const url = asString(entry?.url)
    if (!entry || !apiKey || !url) return null
    return {
      apiKey,
      baseUrl: deriveOpenAIBaseUrl(url),
      additionalParams: parseXcustomParams(entry.params),
    }
  }
  if (info.keyIdentifier) {
    const apiKey = asString(db.OaiCompAPIKeys?.[info.keyIdentifier])
    if (!apiKey) return null
    return {
      apiKey,
      baseUrl: info.endpoint ? deriveOpenAIBaseUrl(info.endpoint) : undefined,
    }
  }
  const apiKey = asString(db.openAIKey)
  return apiKey ? { apiKey } : null
}

function extractSystem(messages: OpenAIChat[]): { messages: OpenAIChat[]; system?: string } {
  const systemTexts: string[] = []
  const passthrough: OpenAIChat[] = []
  for (const row of messages) {
    if (row.role === 'system' && typeof row.content === 'string' && row.content.length > 0) {
      systemTexts.push(row.content)
    } else {
      passthrough.push(row)
    }
  }
  return systemTexts.length > 0
    ? { messages: passthrough, system: systemTexts.join('\n\n') }
    : { messages: passthrough }
}

function applyChatTemplate(db: Database, messages: OpenAIChat[]): string {
  const type = asString(db.instructChatTemplate)
  if (type === 'chatml' || type === 'gpt2') {
    const rows = messages
      .filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'system')
      .map((m) => `<|im_start|>${m.role}\n${m.content}<|im_end|>\n`)
    return `${rows.join('')}<|im_start|>assistant\n`
  }
  const rows = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'system')
    .map((m) => `${m.role}: ${m.content}`)
  return `${rows.join('\n\n')}\n\nassistant:`
}

function unstringlizeChat(text: string, formated: OpenAIChat[], char: string, username: string): string {
  const chunks = ['system note:', 'system:', 'system note：', 'system：']
  if (char) chunks.push(`${char}:`, `${char}：`, `${char}: `, `${char}： `)
  if (username) chunks.push(`${username}:`, `${username}：`, `${username}: `, `${username}： `)
  for (const row of formated) {
    if (row.name) chunks.push(`${row.name}:`, `${row.name}：`, `${row.name}: `, `${row.name}： `)
  }
  let minIndex = -1
  for (const chunk of chunks) {
    const index = text.indexOf(chunk)
    if (index !== -1 && (minIndex === -1 || index < minIndex)) minIndex = index
  }
  return minIndex === -1 ? text : text.substring(0, minIndex).trim()
}

async function* resultFrames(resultPromise: Promise<CompletionResult>): AsyncGenerator<CompletionStreamFrame> {
  const result = await resultPromise
  if (result.aborted === true) return
  if (result.type === 'fail') throw new Error(result.result)
  yield { kind: 'token', content: result.result }
  yield { kind: 'done', finishReason: 'stop' }
}

export async function dispatchChatProvider(args: ChatDispatchArgs): Promise<AsyncIterable<CompletionStreamFrame>> {
  const { database: db, outputTokens, signal } = args
  const profile = args.profile ?? resolveModelProfile({ database: db })
  const info = profile.modelInfo
  const route = resolveChatProviderRoute(db, profile)
  if (route.routable === false) {
    if (
      info.format === LLMFormat.Ollama &&
      profile.modelId !== 'ollama-cloud' &&
      !resolveProfileOllamaBaseUrl(profile)
    ) {
      throw new Error('options.ollama.baseUrl is required')
    }
    throw new Error(route.reason)
  }
  const provider = route.provider

  const model = resolveProviderModel(db, info, provider, profile)
  const messages = reformatMessages(db, args.formated, info.flags)
  const maxTokens = outputTokens ?? db.maxResponse
  const temperature = normalizeDispatchSampler(db.temperature, { scale: 100 })
  const stream = db.useStreaming === true

  if (provider === 'echo') {
    const request = resolveEchoRequest({
      message: db.echoMessage,
      delayMs: (db.echoDelay ?? 0) * 1000,
      signal,
    })
    return stream ? runEchoStream(request) : resultFrames(runEcho(request))
  }

  if (provider === 'openai' || provider === 'openrouter') {
    const variant = resolveOpenAIVariant(db, info, provider, profile)
    if (!variant) throw new Error('options.openai.apiKey is required')
    const request = resolveOpenAIRequest({
      model,
      messages,
      apiKey: variant.apiKey,
      baseUrl: variant.baseUrl,
      maxTokens,
      temperature,
      extraHeaders: variant.extraHeaders,
      additionalParams: variant.additionalParams,
      oobaSystemHoist: variant.oobaSystemHoist,
      signal,
    })
    if (!request) throw new Error('apiKey is required')
    return stream ? runOpenAIStream(request) : resultFrames(runOpenAI(request))
  }

  if (provider === 'nanogpt') {
    const variant = resolveOpenAIVariant(db, info, provider, profile)
    if (!variant) throw new Error('options.nanogpt.apiKey is required')
    const request = resolveOpenAIRequest({
      model,
      messages,
      apiKey: variant.apiKey,
      baseUrl: variant.baseUrl,
      maxTokens,
      temperature,
      extraHeaders: variant.extraHeaders,
      additionalParams: variant.additionalParams,
      oobaSystemHoist: variant.oobaSystemHoist,
      signal,
    })
    if (!request) throw new Error('options.nanogpt.apiKey is required')
    return stream ? runOpenAIStream(request) : resultFrames(runOpenAI(request))
  }

  if (provider === 'anthropic') {
    const extracted = extractSystem(messages)
    const providerOptions = profile.providerOptions
    const request = resolveAnthropicRequest({
      model,
      messages: extracted.messages,
      apiKey: asString(providerOptions.apiKey),
      baseUrl: asString(providerOptions.baseUrl),
      system: extracted.system,
      maxTokens,
      temperature,
      additionalParams: providerOptions.additionalParams,
      signal,
    })
    if (!request) throw new Error('options.anthropic.apiKey is required')
    return stream ? runAnthropicStream(request) : resultFrames(runAnthropic(request))
  }

  if (provider === 'mistral') {
    const providerOptions = profile.providerOptions
    const request = resolveMistralRequest({
      model,
      messages,
      apiKey: asString(providerOptions.apiKey),
      baseUrl: asString(providerOptions.baseUrl),
      maxTokens,
      temperature,
      extraHeaders: providerOptions.extraHeaders,
      additionalParams: providerOptions.additionalParams,
      signal,
    })
    if (!request) throw new Error('options.mistral.apiKey is required')
    return stream ? runMistralStream(request) : resultFrames(runMistral(request))
  }

  if (provider === 'cohere') {
    const providerOptions = profile.providerOptions
    const isNewerCommandR =
      profile.modelId === 'cohere-command-r-03-2024' || profile.modelId === 'cohere-command-r-plus-04-2024'
    if (!asString(providerOptions.apiKey)) throw new Error('options.cohere.apiKey is required')
    const request = resolveCohereRequest({
      model,
      messages,
      apiKey: asString(providerOptions.apiKey),
      baseUrl: asString(providerOptions.baseUrl),
      safetyMode: isNewerCommandR ? undefined : 'NONE',
      temperature,
      extraHeaders: providerOptions.extraHeaders,
      additionalParams: providerOptions.additionalParams,
      signal,
    })
    if (!request) throw new Error('cohere requires a user message to generate a response')
    return resultFrames(runCohere(request))
  }

  if (provider === 'gemini') {
    const vertex =
      info.format === LLMFormat.VertexAIGemini
        ? {
            projectId: db.google?.projectId,
            region: db.vertexRegion,
            clientEmail: db.vertexClientEmail,
            privateKey: db.vertexPrivateKey,
          }
        : undefined
    const request = resolveGeminiRequest({
      model,
      messages,
      apiKey: info.format === LLMFormat.VertexAIGemini ? undefined : db.google?.accessToken,
      vertex,
      maxOutputTokens: maxTokens,
      temperature,
      signal,
    })
    if (!request) throw new Error('options.gemini.apiKey or options.gemini.vertex is required')
    return stream ? runGeminiStream(request) : resultFrames(runGemini(request))
  }

  if (provider === 'openai-legacy-instruct') {
    const aiModel = asString(db.aiModel) ?? ''
    let apiKey: string | undefined = info.format === LLMFormat.NanoGPTLegacy ? db.nanogptKey : db.openAIKey
    let baseUrl = info.format === LLMFormat.NanoGPTLegacy ? NANOGPT_BASE_URL : undefined
    let extraHeaders: Record<string, string> | undefined
    let ap: Array<[string, string]> | undefined
    if (info.format === LLMFormat.NanoGPTLegacy && asString(db.nanogptProvider)) {
      extraHeaders = { 'X-Provider': db.nanogptProvider as string }
    } else if (aiModel === 'reverse_proxy') {
      apiKey = db.proxyKey
      baseUrl = resolveReverseProxyLegacyInstructUrl(db.forceReplaceUrl ?? '', db.autofillRequestUrl !== false)
      ap = additionalParams(db.additionalParams)
    } else if (aiModel.startsWith('xcustom:::')) {
      const entry = findXcustomEntry(db, aiModel)
      apiKey = asString(entry?.key)
      const url = asString(entry?.url)
      baseUrl = url ? stripTrailingPath(url, '/completions') : undefined
      ap = parseXcustomParams(entry?.params)
    }
    const request = resolveOpenAILegacyInstructRequest({
      model,
      messages,
      apiKey,
      baseUrl,
      maxTokens,
      temperature,
      extraHeaders,
      additionalParams: ap,
      signal,
    })
    if (!request) throw new Error('options["openai-legacy-instruct"].apiKey is required')
    return resultFrames(runOpenAILegacyInstruct(request))
  }

  if (provider === 'openai-responses') {
    const aiModel = asString(db.aiModel) ?? ''
    let apiKey: string | undefined = info.format === LLMFormat.NanoGPTResponses ? db.nanogptKey : db.openAIKey
    let baseUrl = info.format === LLMFormat.NanoGPTResponses ? NANOGPT_BASE_URL : undefined
    let extraHeaders: Record<string, string> | undefined
    let ap: Array<[string, string]> | undefined
    if (info.format === LLMFormat.NanoGPTResponses && asString(db.nanogptProvider)) {
      extraHeaders = { 'X-Provider': db.nanogptProvider as string }
    } else if (aiModel === 'ollama-cloud') {
      apiKey = db.ollamaApiKey
      baseUrl = 'https://ollama.com/v1'
    } else if (aiModel === 'reverse_proxy') {
      apiKey = db.proxyKey
      baseUrl = resolveReverseProxyResponsesUrl(db.forceReplaceUrl ?? '', db.autofillRequestUrl !== false)
      ap = additionalParams(db.additionalParams)
    } else if (aiModel.startsWith('xcustom:::')) {
      const entry = findXcustomEntry(db, aiModel)
      apiKey = asString(entry?.key)
      const url = asString(entry?.url)
      baseUrl = url ? stripTrailingPath(url, '/responses') : undefined
      ap = parseXcustomParams(entry?.params)
    } else if (info.endpoint) {
      baseUrl = stripTrailingPath(info.endpoint, '/responses')
    }
    const request = resolveOpenAIResponsesRequest({
      model,
      messages,
      apiKey,
      baseUrl,
      maxOutputTokens: maxTokens,
      temperature,
      store: aiModel === 'ollama-cloud' ? false : undefined,
      extraHeaders,
      additionalParams: ap,
      signal,
    })
    if (!request) throw new Error('options["openai-responses"].apiKey is required')
    return resultFrames(runOpenAIResponses(request))
  }

  if (provider === 'kobold') {
    const providerOptions = profile.providerOptions
    const request = resolveKoboldRequest({
      messages,
      baseUrl: asString(providerOptions.baseUrl),
      maxTokens,
      maxContextLength: db.maxContext,
      temperature,
      signal,
    })
    if (!request) throw new Error('options.kobold.baseUrl is required')
    return resultFrames(runKobold(request))
  }

  if (provider === 'ooba-legacy') {
    const request = resolveOobaLegacyRequest({
      messages,
      baseUrl: db.textgenWebUIBlockingURL,
      apiKey: asString(db.mancerHeader),
      maxTokens,
      truncationLength: db.maxContext,
      temperature,
      signal,
    })
    if (!request) throw new Error('options["ooba-legacy"].baseUrl is required')
    return resultFrames(runOobaLegacy(request))
  }

  if (provider === 'ollama') {
    const request = resolveOllamaRequest({
      model,
      messages,
      baseUrl: resolveProfileOllamaBaseUrl(profile),
      maxTokens,
      temperature,
      signal,
    })
    if (!request) throw new Error('options.ollama.baseUrl is required')
    return stream ? runOllamaStream(request) : resultFrames(runOllama(request))
  }

  if (provider === 'bedrock') {
    const creds = coerceBedrockCredentials(db.claudeAPIKey)
    if (creds === null || !creds.ok) throw new Error('options.bedrock.credentials is required')
    const extracted = extractSystem(messages)
    const request = resolveBedrockRequest({
      model,
      messages: extracted.messages,
      credentials: creds.value,
      system: extracted.system,
      maxTokens,
      temperature,
      signal,
    })
    if (!request) throw new Error('bedrock could not resolve request from the given options')
    return resultFrames(runBedrock(request))
  }

  if (provider === 'horde') {
    const request = resolveHordeRequest({
      prompt: applyChatTemplate(db, messages),
      model,
      apiKey: asString(db.hordeConfig?.apiKey),
      maxTokens,
      maxContextLength: typeof db.maxContext === 'number' ? db.maxContext + 100 : undefined,
      temperature,
      topK: normalizeDispatchSampler(db.top_k),
      topP: normalizeDispatchSampler(db.top_p),
      signal,
    })
    if (!request) throw new Error('options.horde.prompt is required')
    const char = db.characters?.[0]
    return resultFrames(
      runHorde(request).then((result) =>
        result.type === 'success'
          ? {
              ...result,
              result: unstringlizeChat(result.result, messages, char?.name ?? '', db.username ?? ''),
            }
          : result,
      ),
    )
  }

  throw new Error(`provider not implemented yet: ${provider}`)
}

export function getServerGenerationModelString(db: Database): string {
  const name = db.aiModel
  switch (name) {
    case 'reverse_proxy':
      return `custom-${db.reverseProxyOobaMode ? 'ooba' : db.customProxyRequestModel}`
    case 'openrouter':
      return `openrouter-${db.openrouterRequestModel}`
    case 'nanogpt': {
      const modelLabel = db.nanogptRequestModelName || db.nanogptRequestModel
      return `NanoGPT ${modelLabel}${db.nanogptUseSubscriptionEndpoint ? ' [SUB]' : ''}`
    }
    case 'ollama-hosted':
    case 'ollama-cloud': {
      const modelLabel =
        name === 'ollama-cloud' ? db.ollamaCloudModelName || db.ollamaCloudModel : db.ollamaModelName || db.ollamaModel
      return `Ollama ${name === 'ollama-cloud' ? 'Cloud' : 'Local'} ${modelLabel}`
    }
    default:
      return name ?? ''
  }
}
