import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Database } from '../../../../src/ts/storage/database.svelte'
import type { OpenAIChat } from '../../../../src/ts/process/index.svelte'
import type { LegacyModelMode } from '../../../../src/ts/model/modelRoles.js'
import {
  assertModelProfileGenerationReady,
  resolveModelProfile,
  resolveModelProfileByProfileId,
  type ResolvedModelProfile,
} from '../../../../src/ts/model/modelProfileResolver.js'
import type { AuthState } from '../auth.js'
import { resolveAnthropicRequest, runAnthropic, runAnthropicStream } from '../generation/anthropic.js'
import { resolveEchoRequest, runEcho, runEchoStream } from '../generation/echo.js'
import type { CompletionResult, CompletionStreamFrame } from '../generation/frames.js'
import { coerceBedrockCredentials, resolveBedrockRequest, runBedrock } from '../generation/bedrock.js'
import { resolveCohereRequest, runCohere } from '../generation/cohere.js'
import { resolveHordeRequest, runHorde } from '../generation/horde.js'
import { resolveGeminiRequest, runGemini, runGeminiStream } from '../generation/gemini.js'
import { resolveMistralRequest, runMistral, runMistralStream } from '../generation/mistral.js'
import { coerceAdditionalParams } from '../generation/additionalParams.js'
import type {
  NanoGPTOptions,
  OpenAICompatibleVariant,
  OpenAICompatibleProvider,
  OpenAIOptions,
  OpenRouterOptions,
} from '../generation/openaiCompatible.js'
import { resolveOpenAICompatibleVariant } from '../generation/openaiCompatible.js'
import { resolveOpenAIRequest, runOpenAI, runOpenAIStream } from '../generation/openai.js'
import { resolveOpenAILegacyInstructRequest, runOpenAILegacyInstruct } from '../generation/openaiLegacyInstruct.js'
import { resolveOpenAIResponsesRequest, runOpenAIResponses } from '../generation/openaiResponses.js'
import { resolveKoboldRequest, runKobold } from '../generation/kobold.js'
import { resolveOllamaRequest, runOllama, runOllamaStream } from '../generation/ollama.js'
import { resolveOobaLegacyRequest, runOobaLegacy } from '../generation/oobaLegacy.js'
import { requireAuth } from '../http.js'
import type { DatabaseSync } from 'node:sqlite'
import { loadServerIntentCompletionSettings } from '../repository.js'
import { dispatchChatProvider } from '../prompt/chatDispatch.js'
import { generationSubmitRateLimit } from '../routeRateLimits.js'
import { attachAbort } from '../requestAbort.js'
import { handleOllamaCloudToolProxy, isOllamaCloudToolOperation } from '../ollamaCloudToolProxy.js'
import {
  validateServerToolDefinitions,
  validateServerToolRounds,
  type ServerToolCall,
  type ServerToolDefinition,
  type ServerToolRound,
} from '../../../../src/ts/process/request/serverToolProtocol.js'
import {
  completeRequestHistory,
  tryBeginRequestHistory,
  type RequestHistoryHandle,
  type RequestHistoryProfileSnapshot,
} from '../requestHistory.js'

const SUPPORTED_PROVIDERS = new Set([
  'echo',
  'openai',
  'nanogpt',
  'openrouter',
  'anthropic',
  'mistral',
  'cohere',
  'gemini',
  'openai-legacy-instruct',
  'openai-responses',
  'kobold',
  'ooba-legacy',
  'ollama',
  'bedrock',
  'horde',
])

interface ChatMessage {
  role: string
  content: unknown
}

interface CompletionRequestBody {
  kind?: unknown
  provider?: unknown
  model?: unknown
  messages?: unknown
  stream?: unknown
  options?: unknown
  mode?: unknown
  staticModel?: unknown
  fallbackProfileId?: unknown
  maxTokens?: unknown
  temperature?: unknown
  currentCharName?: unknown
  tools?: unknown
  toolRounds?: unknown
}

const SERVER_INTENT_KIND = 'server-intent'
const COMPLETION_MODEL_MODES = [
  'model',
  'submodel',
  'memory',
  'emotion',
  'otherAx',
  'translate',
  'scriptMain',
  'scriptAux',
] as const satisfies readonly LegacyModelMode[]
type CompletionModelMode = (typeof COMPLETION_MODEL_MODES)[number]
const COMPLETION_MODEL_MODE_SET = new Set<string>(COMPLETION_MODEL_MODES)
const COMPLETION_MODEL_MODE_LIST = COMPLETION_MODEL_MODES.join(', ')

interface EchoOptions {
  message?: unknown
  delayMs?: unknown
}

interface AnthropicOptions {
  apiKey?: unknown
  baseUrl?: unknown
  version?: unknown
  system?: unknown
  maxTokens?: unknown
  temperature?: unknown
  additionalParams?: unknown
}

interface MistralOptions {
  apiKey?: unknown
  baseUrl?: unknown
  safePrompt?: unknown
  maxTokens?: unknown
  temperature?: unknown
  presencePenalty?: unknown
  frequencyPenalty?: unknown
  topP?: unknown
  additionalParams?: unknown
  /**
   * Headers to merge into the upstream request. Used by reverse_proxy to
   * inject `X-Proxy-Risu: RisuAI` when the user prefixed their URL with
   * `risu::`.
   */
  extraHeaders?: Record<string, string>
}

interface CohereOptions {
  apiKey?: unknown
  baseUrl?: unknown
  safetyMode?: unknown
  temperature?: unknown
  topK?: unknown
  topP?: unknown
  presencePenalty?: unknown
  frequencyPenalty?: unknown
  additionalParams?: unknown
  /**
   * Headers to merge into the upstream request. Used by reverse_proxy to
   * inject `X-Proxy-Risu: RisuAI` when the user prefixed their URL with
   * `risu::`.
   */
  extraHeaders?: Record<string, string>
}

interface GeminiOptions {
  apiKey?: unknown
  baseUrl?: unknown
  maxOutputTokens?: unknown
  temperature?: unknown
  topP?: unknown
  topK?: unknown
  /**
   * When set, the gemini dispatcher routes to Vertex AI instead of the
   * Studio (`generativelanguage.googleapis.com`) endpoint: signs a
   * service-account JWT, exchanges for a Bearer, and posts to
   * `<region>-aiplatform.googleapis.com`. `apiKey` is ignored in this mode.
   */
  vertex?: {
    projectId?: unknown
    region?: unknown
    clientEmail?: unknown
    privateKey?: unknown
  }
}

interface LegacyInstructOptions {
  apiKey?: unknown
  baseUrl?: unknown
  maxTokens?: unknown
  temperature?: unknown
  topP?: unknown
  presencePenalty?: unknown
  frequencyPenalty?: unknown
  stop?: unknown
  // Optional X-Provider style headers used by NanoGPT Legacy.
  extraHeaders?: Record<string, string>
  additionalParams?: unknown
}

interface ResponsesOptions {
  apiKey?: unknown
  baseUrl?: unknown
  maxOutputTokens?: unknown
  temperature?: unknown
  topP?: unknown
  store?: unknown
  extraHeaders?: Record<string, string>
  additionalParams?: unknown
}

interface KoboldOptions {
  baseUrl?: unknown
  maxTokens?: unknown
  maxContextLength?: unknown
  temperature?: unknown
  topP?: unknown
  topK?: unknown
  topA?: unknown
  repetitionPenalty?: unknown
}

interface OobaLegacyOptions {
  baseUrl?: unknown
  apiKey?: unknown
  maxTokens?: unknown
  truncationLength?: unknown
  temperature?: unknown
  topP?: unknown
  topK?: unknown
  typicalP?: unknown
  repetitionPenalty?: unknown
  stoppingStrings?: unknown
}

interface OllamaOptions {
  baseUrl?: unknown
  apiKey?: unknown
  maxTokens?: unknown
  temperature?: unknown
  topP?: unknown
  topK?: unknown
  tools?: unknown
  extraHeaders?: Record<string, string>
}

interface BedrockOptions {
  credentials?: unknown
  system?: unknown
  maxTokens?: unknown
  temperature?: unknown
  topP?: unknown
  topK?: unknown
  additionalParams?: unknown
}

interface HordeOptions {
  prompt?: unknown
  apiKey?: unknown
  maxTokens?: unknown
  maxContextLength?: unknown
  temperature?: unknown
  topK?: unknown
  topP?: unknown
  pollIntervalMs?: unknown
  timeoutMs?: unknown
}

interface VertexAuthCoerced {
  projectId: string
  region: string
  clientEmail: string
  privateKey: string
}

/**
 * Validate the `options.gemini.vertex` block. Returns null when the block
 * is absent/empty (caller falls back to apiKey), `{ok:true, value}` when
 * all four required fields are non-empty strings, or `{ok:false, error}`
 * when partially populated (configuration mistake worth reporting back).
 */
function coerceVertexAuth(raw: unknown): null | { ok: true; value: VertexAuthCoerced } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return null
  if (typeof raw !== 'object') {
    return { ok: false, error: 'options.gemini.vertex must be an object' }
  }
  const v = raw as Record<string, unknown>
  const projectId = v.projectId
  const region = v.region
  const clientEmail = v.clientEmail
  const privateKey = v.privateKey
  const allBlank =
    (projectId === undefined || projectId === '') &&
    (region === undefined || region === '') &&
    (clientEmail === undefined || clientEmail === '') &&
    (privateKey === undefined || privateKey === '')
  if (allBlank) return null
  if (typeof projectId !== 'string' || projectId.length === 0) {
    return { ok: false, error: 'options.gemini.vertex.projectId is required' }
  }
  if (typeof region !== 'string' || region.length === 0) {
    return { ok: false, error: 'options.gemini.vertex.region is required' }
  }
  if (typeof clientEmail !== 'string' || clientEmail.length === 0) {
    return { ok: false, error: 'options.gemini.vertex.clientEmail is required' }
  }
  if (typeof privateKey !== 'string' || privateKey.length === 0) {
    return { ok: false, error: 'options.gemini.vertex.privateKey is required' }
  }
  return { ok: true, value: { projectId, region, clientEmail, privateKey } }
}

function validateMessages(messages: unknown): ChatMessage[] | null {
  if (!Array.isArray(messages)) return null
  for (const m of messages) {
    if (!m || typeof m !== 'object') return null
    const role = (m as { role?: unknown }).role
    if (typeof role !== 'string') return null
    const content = (m as { content?: unknown }).content
    if (typeof content !== 'string' && !Array.isArray(content)) return null
  }
  return messages as ChatMessage[]
}

function isCompletionModelMode(value: unknown): value is CompletionModelMode {
  return typeof value === 'string' && COMPLETION_MODEL_MODE_SET.has(value)
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function selectedCompletionProfile(db: Database, body: CompletionRequestBody): ResolvedModelProfile {
  const mode = isCompletionModelMode(body.mode) ? body.mode : 'model'
  if (typeof body.fallbackProfileId === 'string' && body.fallbackProfileId.length > 0) {
    const profile = resolveModelProfileByProfileId({ database: db, role: mode, profileId: body.fallbackProfileId })
    if (profile) return profile
    throw new Error(`fallbackProfileId profile not found: ${body.fallbackProfileId}`)
  }
  const staticModel = typeof body.staticModel === 'string' && body.staticModel.length > 0 ? body.staticModel : undefined
  const profile = resolveModelProfile({ database: db, role: mode, staticModel })
  assertModelProfileGenerationReady(profile)
  if (profile.modelId.length > 0) return profile
  return resolveModelProfile({ database: db, role: mode, staticModel: 'echo_model' })
}

function buildCompletionDatabase(db: Database, body: CompletionRequestBody, profile: ResolvedModelProfile): Database {
  const next = {
    ...db,
    aiModel: profile.modelId,
    useStreaming: body.stream === true,
  } as Database
  const maxTokens = finiteNumber(body.maxTokens)
  if (maxTokens !== undefined) {
    next.maxResponse = maxTokens
  } else if (profile.runtimeOptions.maxResponse !== undefined) {
    next.maxResponse = profile.runtimeOptions.maxResponse
  }
  const temperature = finiteNumber(body.temperature)
  if (temperature !== undefined) {
    next.temperature = temperature * 100
  } else if (profile.runtimeOptions.rawTemperature !== undefined) {
    next.temperature = profile.runtimeOptions.rawTemperature
  }
  if (typeof body.currentCharName === 'string' && body.currentCharName.length > 0) {
    const first = Array.isArray(db.characters) ? db.characters[0] : undefined
    next.characters = [{ ...(first as object), name: body.currentCharName }] as Database['characters']
  }
  return next
}

function settingsToCompletionDatabase(settings: Record<string, unknown>): Database {
  return settings as unknown as Database
}

function badRequest(reply: FastifyReply, error: string): void {
  finishLegacyRequestHistory(reply, { status: 'error', error })
  reply.code(400).send({ error })
}

interface CompletionResponsePayload {
  type: CompletionResult['type']
  result: string
  model?: string
  status?: number
  statusText?: string
  code?: string
  toolCalls?: ServerToolCall[]
}

function completionPayload(result: CompletionResult): CompletionResponsePayload {
  return {
    type: result.type,
    result: result.result,
    ...(result.model !== undefined ? { model: result.model } : {}),
    ...(typeof result.status === 'number' ? { status: result.status } : {}),
    ...(result.statusText ? { statusText: result.statusText } : {}),
    ...(result.code ? { code: result.code } : {}),
    ...(result.toolCalls?.length ? { toolCalls: result.toolCalls } : {}),
  }
}

interface LegacyRequestHistoryTracker {
  handle: RequestHistoryHandle
  settled: boolean
}

const legacyRequestHistoryByReply = new WeakMap<FastifyReply, LegacyRequestHistoryTracker>()

function beginLegacyRequestHistory(input: {
  db: DatabaseSync
  reply: FastifyReply
  provider: string
  model: string
  prompt: unknown
  stream: boolean
}): void {
  const settings = loadServerIntentCompletionSettings(input.db)
  const profile: RequestHistoryProfileSnapshot = {
    id: `legacy:${input.provider}:${input.model}`,
    role: 'otherAx',
    sourceKind: 'legacy-client-request',
    provider: input.provider,
    modelId: input.model,
    requestModel: input.model,
  }
  const handle = tryBeginRequestHistory({
    db: input.db,
    limit: settings?.requestHistoryLimit,
    source: 'completion',
    profile,
    prompt: input.prompt,
    metadata: {
      mode: 'legacy-client-request',
      streamingRequested: input.stream,
    },
  })
  if (!handle) return
  const tracker: LegacyRequestHistoryTracker = { handle, settled: false }
  legacyRequestHistoryByReply.set(input.reply, tracker)
  input.reply.raw.once('close', () => {
    finishLegacyRequestHistory(input.reply, {
      status: input.reply.statusCode >= 400 ? 'error' : 'cancelled',
      error:
        input.reply.statusCode >= 400
          ? `Completion request ended with HTTP ${input.reply.statusCode}`
          : 'Completion request ended before a terminal provider response',
    })
  })
}

function finishLegacyRequestHistory(
  reply: FastifyReply,
  input: {
    status: 'success' | 'error' | 'cancelled'
    response?: string
    error?: string
    metadata?: Record<string, unknown>
  },
): void {
  const tracker = legacyRequestHistoryByReply.get(reply)
  if (!tracker || tracker.settled) return
  tracker.settled = true
  legacyRequestHistoryByReply.delete(reply)
  completeRequestHistory(tracker.handle, input)
}

function sendCompletionResult(reply: FastifyReply, result: CompletionResult): void {
  const payload = completionPayload(result)
  const success = result.type === 'success'
  finishLegacyRequestHistory(reply, {
    status: success ? 'success' : 'error',
    response: success ? result.result : '',
    ...(success ? {} : { error: result.result }),
    metadata: {
      ...(result.model !== undefined ? { model: result.model } : {}),
      ...(typeof result.status === 'number' ? { providerStatus: result.status } : {}),
      ...(result.statusText ? { providerStatusText: result.statusText } : {}),
      ...(result.code ? { providerCode: result.code } : {}),
      ...(result.toolCalls?.length ? { toolCalls: result.toolCalls } : {}),
    },
  })
  reply.code(200).send(payload)
}

function legacyFinalizedPrompt(
  provider: string,
  messages: ChatMessage[],
  options: { horde?: HordeOptions; anthropic?: AnthropicOptions; bedrock?: BedrockOptions },
): unknown {
  if (provider === 'horde' && typeof options.horde?.prompt === 'string') return options.horde.prompt
  const system =
    provider === 'anthropic' ? options.anthropic?.system : provider === 'bedrock' ? options.bedrock?.system : undefined
  return typeof system === 'string' && system.length > 0 ? { system, messages } : messages
}

function writeSseChunk(reply: FastifyReply, frame: CompletionStreamFrame): void {
  const event = frame.kind === 'done' ? 'done' : frame.kind === 'error' ? 'error' : 'chunk'
  const data =
    frame.kind === 'done'
      ? JSON.stringify({
          finishReason: frame.finishReason ?? 'stop',
          ...(frame.toolCalls?.length ? { toolCalls: frame.toolCalls } : {}),
        })
      : frame.kind === 'error'
        ? JSON.stringify({
            type: 'provider_error',
            error: frame.error ?? 'provider stream failed',
            status: frame.status,
            statusText: frame.statusText,
            code: frame.code,
          })
        : JSON.stringify({ type: 'token', content: frame.content ?? '' })
  reply.raw.write(`event: ${event}\ndata: ${data}\n\n`)
}

function isCompletionDeadlineActivityFrame(frame: CompletionStreamFrame): boolean {
  if (frame.kind !== 'token') return false
  return typeof frame.content === 'string' && frame.content.length > 0
}

// Disconnect + generous-deadline abort plumbing shared with the
// chat route; see `requestAbort.ts`.

export async function pipeStream(
  reply: FastifyReply,
  frames: AsyncIterable<CompletionStreamFrame>,
  refreshDeadline?: () => void,
): Promise<void> {
  reply.raw.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    connection: 'keep-alive',
  })
  let response = ''
  try {
    for await (const frame of frames) {
      if (frame.kind === 'token') response += frame.content ?? ''
      if (frame.kind === 'done') {
        finishLegacyRequestHistory(reply, {
          status: 'success',
          response,
          metadata: {
            ...(frame.finishReason ? { finishReason: frame.finishReason } : {}),
            ...(frame.alternates ? { alternates: frame.alternates } : {}),
            ...(frame.toolCalls ? { toolCalls: frame.toolCalls } : {}),
          },
        })
      }
      if (frame.kind === 'error') {
        finishLegacyRequestHistory(reply, {
          status: 'error',
          response,
          error: frame.error ?? 'Provider request failed',
          metadata: {
            ...(frame.status !== undefined ? { providerStatus: frame.status } : {}),
            ...(frame.statusText ? { providerStatusText: frame.statusText } : {}),
            ...(frame.code ? { providerCode: frame.code } : {}),
            ...(frame.reason ? { providerReason: frame.reason } : {}),
          },
        })
      }
      writeSseChunk(reply, frame)
      if (refreshDeadline && isCompletionDeadlineActivityFrame(frame)) {
        refreshDeadline()
      }
    }
  } catch (error) {
    finishLegacyRequestHistory(reply, {
      status: 'error',
      response,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  } finally {
    finishLegacyRequestHistory(reply, {
      status: 'cancelled',
      response,
      error: 'Completion stream ended before a terminal provider response',
    })
    reply.raw.end()
  }
}

async function collectCompletionFrames(
  frames: AsyncIterable<CompletionStreamFrame>,
): Promise<CompletionResponsePayload> {
  let result = ''
  for await (const frame of frames) {
    if (frame.kind === 'token') {
      result += frame.content ?? ''
      continue
    }
    if (frame.kind === 'error') {
      return completionPayload({
        type: 'fail',
        result: frame.error ?? 'provider dispatch failed',
        ...(typeof frame.status === 'number' ? { status: frame.status } : {}),
        ...(frame.statusText ? { statusText: frame.statusText } : {}),
        ...(frame.code ? { code: frame.code } : {}),
      })
    }
    if (frame.kind === 'done') {
      return {
        type: 'success',
        result,
        ...(frame.toolCalls?.length ? { toolCalls: frame.toolCalls } : {}),
      }
    }
  }
  return { type: 'success', result }
}

async function handleEchoStreaming(req: FastifyRequest, reply: FastifyReply, options: EchoOptions): Promise<void> {
  const { signal, refresh, cleanup } = attachAbort(req, reply)
  try {
    const echo = resolveEchoRequest({
      message: options.message,
      delayMs: options.delayMs,
      signal,
    })
    await pipeStream(reply, runEchoStream(echo), refresh)
  } finally {
    cleanup()
  }
}

async function handleEchoBuffered(req: FastifyRequest, reply: FastifyReply, options: EchoOptions): Promise<void> {
  const { signal, cleanup } = attachAbort(req, reply)
  try {
    const echo = resolveEchoRequest({
      message: options.message,
      delayMs: options.delayMs,
      signal,
    })
    const result = await runEcho(echo)
    if (result.aborted === true) return
    sendCompletionResult(reply, result)
  } finally {
    cleanup()
  }
}

function coerceAnthropicAdditionalParams(
  options: AnthropicOptions,
): { ok: true; value: Array<[string, string]> | undefined } | { ok: false; error: string } {
  if (options.additionalParams === undefined) return { ok: true, value: undefined }
  const coerced = coerceAdditionalParams(options.additionalParams)
  if (coerced === null) {
    return {
      ok: false,
      error: 'options.anthropic.additionalParams must be an array of [string, string] pairs',
    }
  }
  return { ok: true, value: coerced.length > 0 ? coerced : undefined }
}

function coerceMistralAdditionalParams(
  options: MistralOptions,
): { ok: true; value: Array<[string, string]> | undefined } | { ok: false; error: string } {
  if (options.additionalParams === undefined) return { ok: true, value: undefined }
  const coerced = coerceAdditionalParams(options.additionalParams)
  if (coerced === null) {
    return {
      ok: false,
      error: 'options.mistral.additionalParams must be an array of [string, string] pairs',
    }
  }
  return { ok: true, value: coerced.length > 0 ? coerced : undefined }
}

function coerceCohereAdditionalParams(
  options: CohereOptions,
): { ok: true; value: Array<[string, string]> | undefined } | { ok: false; error: string } {
  if (options.additionalParams === undefined) return { ok: true, value: undefined }
  const coerced = coerceAdditionalParams(options.additionalParams)
  if (coerced === null) {
    return {
      ok: false,
      error: 'options.cohere.additionalParams must be an array of [string, string] pairs',
    }
  }
  return { ok: true, value: coerced.length > 0 ? coerced : undefined }
}

function coerceResponsesAdditionalParams(
  options: ResponsesOptions,
): { ok: true; value: Array<[string, string]> | undefined } | { ok: false; error: string } {
  if (options.additionalParams === undefined) return { ok: true, value: undefined }
  const coerced = coerceAdditionalParams(options.additionalParams)
  if (coerced === null) {
    return {
      ok: false,
      error: 'options["openai-responses"].additionalParams must be an array of [string, string] pairs',
    }
  }
  return { ok: true, value: coerced.length > 0 ? coerced : undefined }
}

function coerceLegacyInstructAdditionalParams(
  options: LegacyInstructOptions,
): { ok: true; value: Array<[string, string]> | undefined } | { ok: false; error: string } {
  if (options.additionalParams === undefined) return { ok: true, value: undefined }
  const coerced = coerceAdditionalParams(options.additionalParams)
  if (coerced === null) {
    return {
      ok: false,
      error: 'options["openai-legacy-instruct"].additionalParams must be an array of [string, string] pairs',
    }
  }
  return { ok: true, value: coerced.length > 0 ? coerced : undefined }
}

async function handleAnthropicStreaming(
  req: FastifyRequest,
  reply: FastifyReply,
  model: string,
  messages: unknown[],
  options: AnthropicOptions,
): Promise<void> {
  const { signal, refresh, cleanup } = attachAbort(req, reply)
  try {
    const ap = coerceAnthropicAdditionalParams(options)
    if (ap.ok === false) {
      badRequest(reply, ap.error)
      return
    }
    const resolved = resolveAnthropicRequest({
      model,
      messages,
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      version: options.version,
      system: options.system,
      maxTokens: options.maxTokens,
      temperature: options.temperature,
      additionalParams: ap.value,
      signal,
    })
    if (!resolved) {
      badRequest(reply, 'options.anthropic.apiKey is required')
      return
    }
    await pipeStream(reply, runAnthropicStream(resolved), refresh)
  } finally {
    cleanup()
  }
}

async function handleAnthropicBuffered(
  req: FastifyRequest,
  reply: FastifyReply,
  model: string,
  messages: unknown[],
  options: AnthropicOptions,
): Promise<void> {
  const { signal, cleanup } = attachAbort(req, reply)
  try {
    const ap = coerceAnthropicAdditionalParams(options)
    if (ap.ok === false) {
      badRequest(reply, ap.error)
      return
    }
    const resolved = resolveAnthropicRequest({
      model,
      messages,
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      version: options.version,
      system: options.system,
      maxTokens: options.maxTokens,
      temperature: options.temperature,
      additionalParams: ap.value,
      signal,
    })
    if (!resolved) {
      badRequest(reply, 'options.anthropic.apiKey is required')
      return
    }
    const result = await runAnthropic(resolved)
    if (result.aborted === true) return
    sendCompletionResult(reply, result)
  } finally {
    cleanup()
  }
}

async function handleKoboldBuffered(
  req: FastifyRequest,
  reply: FastifyReply,
  messages: unknown[],
  options: KoboldOptions,
): Promise<void> {
  const { signal, cleanup } = attachAbort(req, reply)
  try {
    const resolved = resolveKoboldRequest({
      messages,
      baseUrl: options.baseUrl,
      maxTokens: options.maxTokens,
      maxContextLength: options.maxContextLength,
      temperature: options.temperature,
      topP: options.topP,
      topK: options.topK,
      topA: options.topA,
      repetitionPenalty: options.repetitionPenalty,
      signal,
    })
    if (!resolved) {
      badRequest(reply, 'options.kobold.baseUrl is required')
      return
    }
    const result = await runKobold(resolved)
    if (result.aborted === true) return
    sendCompletionResult(reply, result)
  } finally {
    cleanup()
  }
}

async function handleOobaLegacyBuffered(
  req: FastifyRequest,
  reply: FastifyReply,
  messages: unknown[],
  options: OobaLegacyOptions,
): Promise<void> {
  const { signal, cleanup } = attachAbort(req, reply)
  try {
    const resolved = resolveOobaLegacyRequest({
      messages,
      baseUrl: options.baseUrl,
      apiKey: options.apiKey,
      maxTokens: options.maxTokens,
      truncationLength: options.truncationLength,
      temperature: options.temperature,
      topP: options.topP,
      topK: options.topK,
      typicalP: options.typicalP,
      repetitionPenalty: options.repetitionPenalty,
      stoppingStrings: options.stoppingStrings,
      signal,
    })
    if (!resolved) {
      badRequest(reply, 'options["ooba-legacy"].baseUrl is required')
      return
    }
    const result = await runOobaLegacy(resolved)
    if (result.aborted === true) return
    sendCompletionResult(reply, result)
  } finally {
    cleanup()
  }
}

async function handleOllamaStreaming(
  req: FastifyRequest,
  reply: FastifyReply,
  model: string,
  messages: unknown[],
  options: OllamaOptions,
): Promise<void> {
  const { signal, refresh, cleanup } = attachAbort(req, reply)
  try {
    const resolved = resolveOllamaRequest({
      model,
      messages,
      baseUrl: options.baseUrl,
      apiKey: options.apiKey,
      maxTokens: options.maxTokens,
      temperature: options.temperature,
      topP: options.topP,
      topK: options.topK,
      tools: options.tools,
      extraHeaders: options.extraHeaders,
      signal,
    })
    if (!resolved) {
      badRequest(reply, 'options.ollama.baseUrl is required (and messages must be non-empty)')
      return
    }
    await pipeStream(reply, runOllamaStream(resolved), refresh)
  } finally {
    cleanup()
  }
}

async function handleOllamaBuffered(
  req: FastifyRequest,
  reply: FastifyReply,
  model: string,
  messages: unknown[],
  options: OllamaOptions,
): Promise<void> {
  const { signal, cleanup } = attachAbort(req, reply)
  try {
    const resolved = resolveOllamaRequest({
      model,
      messages,
      baseUrl: options.baseUrl,
      apiKey: options.apiKey,
      maxTokens: options.maxTokens,
      temperature: options.temperature,
      topP: options.topP,
      topK: options.topK,
      tools: options.tools,
      extraHeaders: options.extraHeaders,
      signal,
    })
    if (!resolved) {
      badRequest(reply, 'options.ollama.baseUrl is required (and messages must be non-empty)')
      return
    }
    const result = await runOllama(resolved)
    if (result.aborted === true) return
    sendCompletionResult(reply, result)
  } finally {
    cleanup()
  }
}

async function handleHordeBuffered(
  req: FastifyRequest,
  reply: FastifyReply,
  model: string,
  options: HordeOptions,
): Promise<void> {
  const { signal, cleanup } = attachAbort(req, reply)
  try {
    const resolved = resolveHordeRequest({
      prompt: options.prompt,
      model,
      apiKey: options.apiKey,
      maxTokens: options.maxTokens,
      maxContextLength: options.maxContextLength,
      temperature: options.temperature,
      topK: options.topK,
      topP: options.topP,
      pollIntervalMs: options.pollIntervalMs,
      timeoutMs: options.timeoutMs,
      signal,
    })
    if (!resolved) {
      badRequest(reply, 'options.horde.prompt is required (and model must be non-empty)')
      return
    }
    const result = await runHorde(resolved)
    if (result.aborted === true) return
    sendCompletionResult(reply, result)
  } finally {
    cleanup()
  }
}

async function handleBedrockBuffered(
  req: FastifyRequest,
  reply: FastifyReply,
  model: string,
  messages: unknown[],
  options: BedrockOptions,
): Promise<void> {
  const { signal, cleanup } = attachAbort(req, reply)
  try {
    const creds = coerceBedrockCredentials(options.credentials)
    if (creds === null) {
      badRequest(reply, 'options.bedrock.credentials is required')
      return
    }
    if (creds.ok === false) {
      badRequest(reply, creds.error)
      return
    }
    let additionalParams: Array<[string, string]> | undefined
    if (options.additionalParams !== undefined) {
      const coerced = coerceAdditionalParams(options.additionalParams)
      if (coerced === null) {
        badRequest(reply, 'options.bedrock.additionalParams must be an array of [string, string] pairs')
        return
      }
      additionalParams = coerced.length > 0 ? coerced : undefined
    }
    const resolved = resolveBedrockRequest({
      model,
      messages,
      credentials: creds.value,
      system: options.system,
      maxTokens: options.maxTokens,
      temperature: options.temperature,
      topP: options.topP,
      topK: options.topK,
      additionalParams,
      signal,
    })
    if (!resolved) {
      badRequest(reply, 'bedrock could not resolve request from the given options')
      return
    }
    const result = await runBedrock(resolved)
    if (result.aborted === true) return
    sendCompletionResult(reply, result)
  } finally {
    cleanup()
  }
}

async function handleResponsesBuffered(
  req: FastifyRequest,
  reply: FastifyReply,
  model: string,
  messages: unknown[],
  options: ResponsesOptions,
): Promise<void> {
  const { signal, cleanup } = attachAbort(req, reply)
  try {
    const ap = coerceResponsesAdditionalParams(options)
    if (ap.ok === false) {
      badRequest(reply, ap.error)
      return
    }
    const resolved = resolveOpenAIResponsesRequest({
      model,
      messages,
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      maxOutputTokens: options.maxOutputTokens,
      temperature: options.temperature,
      topP: options.topP,
      store: options.store,
      extraHeaders: options.extraHeaders,
      additionalParams: ap.value,
      signal,
    })
    if (!resolved) {
      badRequest(reply, 'options["openai-responses"].apiKey is required')
      return
    }
    const result = await runOpenAIResponses(resolved)
    if (result.aborted === true) return
    sendCompletionResult(reply, result)
  } finally {
    cleanup()
  }
}

async function handleLegacyInstructBuffered(
  req: FastifyRequest,
  reply: FastifyReply,
  model: string,
  messages: unknown[],
  options: LegacyInstructOptions,
): Promise<void> {
  const { signal, cleanup } = attachAbort(req, reply)
  try {
    const ap = coerceLegacyInstructAdditionalParams(options)
    if (ap.ok === false) {
      badRequest(reply, ap.error)
      return
    }
    const resolved = resolveOpenAILegacyInstructRequest({
      model,
      messages,
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      maxTokens: options.maxTokens,
      temperature: options.temperature,
      topP: options.topP,
      presencePenalty: options.presencePenalty,
      frequencyPenalty: options.frequencyPenalty,
      stop: options.stop,
      extraHeaders: options.extraHeaders,
      additionalParams: ap.value,
      signal,
    })
    if (!resolved) {
      badRequest(reply, 'options["openai-legacy-instruct"].apiKey is required')
      return
    }
    const result = await runOpenAILegacyInstruct(resolved)
    if (result.aborted === true) return
    sendCompletionResult(reply, result)
  } finally {
    cleanup()
  }
}

async function handleGeminiStreaming(
  req: FastifyRequest,
  reply: FastifyReply,
  model: string,
  messages: unknown[],
  options: GeminiOptions,
): Promise<void> {
  const { signal, refresh, cleanup } = attachAbort(req, reply)
  try {
    const vertex = coerceVertexAuth(options.vertex)
    let vertexAuth: VertexAuthCoerced | undefined
    if (vertex !== null) {
      if (vertex.ok === false) {
        badRequest(reply, vertex.error)
        return
      }
      vertexAuth = vertex.value
    }
    const resolved = resolveGeminiRequest({
      model,
      messages,
      apiKey: options.apiKey,
      vertex: vertexAuth,
      baseUrl: options.baseUrl,
      maxOutputTokens: options.maxOutputTokens,
      temperature: options.temperature,
      topP: options.topP,
      topK: options.topK,
      signal,
    })
    if (!resolved) {
      badRequest(reply, 'options.gemini.apiKey or options.gemini.vertex is required (and contents must be non-empty)')
      return
    }
    await pipeStream(reply, runGeminiStream(resolved), refresh)
  } finally {
    cleanup()
  }
}

async function handleGeminiBuffered(
  req: FastifyRequest,
  reply: FastifyReply,
  model: string,
  messages: unknown[],
  options: GeminiOptions,
): Promise<void> {
  const { signal, cleanup } = attachAbort(req, reply)
  try {
    const vertex = coerceVertexAuth(options.vertex)
    let vertexAuth: VertexAuthCoerced | undefined
    if (vertex !== null) {
      if (vertex.ok === false) {
        badRequest(reply, vertex.error)
        return
      }
      vertexAuth = vertex.value
    }
    const resolved = resolveGeminiRequest({
      model,
      messages,
      apiKey: options.apiKey,
      vertex: vertexAuth,
      baseUrl: options.baseUrl,
      maxOutputTokens: options.maxOutputTokens,
      temperature: options.temperature,
      topP: options.topP,
      topK: options.topK,
      signal,
    })
    if (!resolved) {
      badRequest(reply, 'options.gemini.apiKey or options.gemini.vertex is required (and contents must be non-empty)')
      return
    }
    const result = await runGemini(resolved)
    if (result.aborted === true) return
    sendCompletionResult(reply, result)
  } finally {
    cleanup()
  }
}

async function handleCohereBuffered(
  req: FastifyRequest,
  reply: FastifyReply,
  model: string,
  messages: unknown[],
  options: CohereOptions,
): Promise<void> {
  const { signal, cleanup } = attachAbort(req, reply)
  try {
    if (typeof options.apiKey !== 'string' || options.apiKey.length === 0) {
      badRequest(reply, 'options.cohere.apiKey is required')
      return
    }
    const ap = coerceCohereAdditionalParams(options)
    if (ap.ok === false) {
      badRequest(reply, ap.error)
      return
    }
    const resolved = resolveCohereRequest({
      model,
      messages,
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      safetyMode: options.safetyMode,
      temperature: options.temperature,
      topK: options.topK,
      topP: options.topP,
      presencePenalty: options.presencePenalty,
      frequencyPenalty: options.frequencyPenalty,
      extraHeaders: options.extraHeaders,
      additionalParams: ap.value,
      signal,
    })
    if (!resolved) {
      badRequest(reply, 'cohere requires a user message to generate a response')
      return
    }
    const result = await runCohere(resolved)
    if (result.aborted === true) return
    sendCompletionResult(reply, result)
  } finally {
    cleanup()
  }
}

async function handleMistralStreaming(
  req: FastifyRequest,
  reply: FastifyReply,
  model: string,
  messages: unknown[],
  options: MistralOptions,
): Promise<void> {
  const { signal, refresh, cleanup } = attachAbort(req, reply)
  try {
    const ap = coerceMistralAdditionalParams(options)
    if (ap.ok === false) {
      badRequest(reply, ap.error)
      return
    }
    const resolved = resolveMistralRequest({
      model,
      messages,
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      safePrompt: options.safePrompt,
      maxTokens: options.maxTokens,
      temperature: options.temperature,
      presencePenalty: options.presencePenalty,
      frequencyPenalty: options.frequencyPenalty,
      topP: options.topP,
      extraHeaders: options.extraHeaders,
      additionalParams: ap.value,
      signal,
    })
    if (!resolved) {
      badRequest(reply, 'options.mistral.apiKey is required')
      return
    }
    await pipeStream(reply, runMistralStream(resolved), refresh)
  } finally {
    cleanup()
  }
}

async function handleMistralBuffered(
  req: FastifyRequest,
  reply: FastifyReply,
  model: string,
  messages: unknown[],
  options: MistralOptions,
): Promise<void> {
  const { signal, cleanup } = attachAbort(req, reply)
  try {
    const ap = coerceMistralAdditionalParams(options)
    if (ap.ok === false) {
      badRequest(reply, ap.error)
      return
    }
    const resolved = resolveMistralRequest({
      model,
      messages,
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      safePrompt: options.safePrompt,
      maxTokens: options.maxTokens,
      temperature: options.temperature,
      presencePenalty: options.presencePenalty,
      frequencyPenalty: options.frequencyPenalty,
      topP: options.topP,
      extraHeaders: options.extraHeaders,
      additionalParams: ap.value,
      signal,
    })
    if (!resolved) {
      badRequest(reply, 'options.mistral.apiKey is required')
      return
    }
    const result = await runMistral(resolved)
    if (result.aborted === true) return
    sendCompletionResult(reply, result)
  } finally {
    cleanup()
  }
}

async function handleOpenAICompatibleStreaming(
  req: FastifyRequest,
  reply: FastifyReply,
  model: string,
  messages: unknown[],
  variant: OpenAICompatibleVariant,
): Promise<void> {
  const { signal, refresh, cleanup } = attachAbort(req, reply)
  try {
    const resolved = resolveOpenAIRequest({
      model,
      messages,
      apiKey: variant.apiKey,
      baseUrl: variant.baseUrl,
      maxTokens: variant.maxTokens,
      temperature: variant.temperature,
      extraHeaders: variant.extraHeaders,
      additionalParams: variant.additionalParams,
      oobaSystemHoist: variant.oobaSystemHoist,
      signal,
    })
    if (!resolved) {
      badRequest(reply, 'apiKey is required')
      return
    }
    await pipeStream(reply, runOpenAIStream(resolved), refresh)
  } finally {
    cleanup()
  }
}

async function handleOpenAICompatibleBuffered(
  req: FastifyRequest,
  reply: FastifyReply,
  model: string,
  messages: unknown[],
  variant: OpenAICompatibleVariant,
): Promise<void> {
  const { signal, cleanup } = attachAbort(req, reply)
  try {
    const resolved = resolveOpenAIRequest({
      model,
      messages,
      apiKey: variant.apiKey,
      baseUrl: variant.baseUrl,
      maxTokens: variant.maxTokens,
      temperature: variant.temperature,
      extraHeaders: variant.extraHeaders,
      additionalParams: variant.additionalParams,
      oobaSystemHoist: variant.oobaSystemHoist,
      signal,
    })
    if (!resolved) {
      badRequest(reply, 'apiKey is required')
      return
    }
    const result = await runOpenAI(resolved)
    if (result.aborted === true) return
    sendCompletionResult(reply, result)
  } finally {
    cleanup()
  }
}

async function handleServerIntentCompletion(
  req: FastifyRequest,
  reply: FastifyReply,
  body: CompletionRequestBody,
  db: DatabaseSync,
): Promise<void> {
  if (body.provider !== undefined || body.model !== undefined || body.options !== undefined) {
    return badRequest(reply, 'server-intent completion must not include provider, model, or options')
  }
  const messages = validateMessages(body.messages)
  if (!messages) {
    return badRequest(reply, 'messages must be an array of {role, content}')
  }
  if (typeof body.stream !== 'boolean') {
    return badRequest(reply, 'stream must be a boolean')
  }
  if (body.mode !== undefined && !isCompletionModelMode(body.mode)) {
    return badRequest(reply, `mode must be one of: ${COMPLETION_MODEL_MODE_LIST}`)
  }
  if (body.staticModel !== undefined && typeof body.staticModel !== 'string') {
    return badRequest(reply, 'staticModel must be a string when provided')
  }
  if (body.fallbackProfileId !== undefined && typeof body.fallbackProfileId !== 'string') {
    return badRequest(reply, 'fallbackProfileId must be a string when provided')
  }
  if (body.maxTokens !== undefined && finiteNumber(body.maxTokens) === undefined) {
    return badRequest(reply, 'maxTokens must be a finite number when provided')
  }
  if (body.temperature !== undefined && finiteNumber(body.temperature) === undefined) {
    return badRequest(reply, 'temperature must be a finite number when provided')
  }
  if (body.currentCharName !== undefined && typeof body.currentCharName !== 'string') {
    return badRequest(reply, 'currentCharName must be a string when provided')
  }

  let tools: ServerToolDefinition[] | undefined
  let toolRounds: ServerToolRound[] | undefined
  if (body.tools !== undefined) {
    const validatedTools = validateServerToolDefinitions(body.tools)
    if (validatedTools.ok === false) return badRequest(reply, validatedTools.error)
    tools = validatedTools.value
  }
  if ((tools?.length ?? 0) > 0 && body.stream === true) {
    return badRequest(reply, 'server-intent tool requests must use buffered completion')
  }
  if (body.toolRounds !== undefined) {
    if (!tools || tools.length === 0) return badRequest(reply, 'toolRounds require supplied tools')
    const validatedRounds = validateServerToolRounds(body.toolRounds, new Set(tools.map((tool) => tool.name)))
    if (validatedRounds.ok === false) return badRequest(reply, validatedRounds.error)
    toolRounds = validatedRounds.value
  }

  const settings = loadServerIntentCompletionSettings(db)
  if (settings === null) {
    return badRequest(reply, 'database is not initialized')
  }

  const { signal, refresh, cleanup } = attachAbort(req, reply)
  try {
    const baseDatabase = settingsToCompletionDatabase(settings)
    const profile = selectedCompletionProfile(baseDatabase, body)
    assertModelProfileGenerationReady(profile)
    const database = buildCompletionDatabase(baseDatabase, body, profile)
    const frames = await dispatchChatProvider({
      database,
      formated: messages as OpenAIChat[],
      outputTokens: finiteNumber(body.maxTokens),
      profile,
      signal,
      tools,
      toolRounds,
      history: {
        db,
        source: 'completion',
        metadata: { mode: isCompletionModelMode(body.mode) ? body.mode : 'model' },
      },
    })

    if (body.stream === true) {
      await pipeStream(reply, frames, refresh)
      return
    }

    const result = await collectCompletionFrames(frames)
    reply.code(200).send(result)
  } catch (err) {
    const message = err instanceof Error && err.message.length > 0 ? err.message : String(err)
    reply.code(400).send({ error: message || 'provider dispatch failed' })
  } finally {
    cleanup()
  }
}

export function registerGenerationRoutes(
  app: FastifyInstance,
  db: DatabaseSync,
  authState: AuthState,
  dataDir: string,
): void {
  app.post('/api/v1/generate/completion', { config: { rateLimit: generationSubmitRateLimit } }, async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    if (isOllamaCloudToolOperation(req.query)) {
      await handleOllamaCloudToolProxy(req, reply, db)
      return
    }

    const body = (req.body ?? {}) as CompletionRequestBody
    if (body.kind === SERVER_INTENT_KIND) {
      await handleServerIntentCompletion(req, reply, body, db)
      return
    }

    const provider = body.provider
    if (typeof provider !== 'string' || provider.length === 0) {
      return badRequest(reply, 'provider is required')
    }
    if (typeof body.model !== 'string' || body.model.length === 0) {
      return badRequest(reply, 'model is required')
    }
    const messages = validateMessages(body.messages)
    if (!messages) {
      return badRequest(reply, 'messages must be an array of {role, content}')
    }
    if (typeof body.stream !== 'boolean') {
      return badRequest(reply, 'stream must be a boolean')
    }

    if (!SUPPORTED_PROVIDERS.has(provider)) {
      reply.code(501).send({
        reason: `provider not implemented yet: ${provider}`,
      })
      return
    }

    const options = (body.options ?? {}) as {
      echo?: EchoOptions
      openai?: OpenAIOptions
      nanogpt?: NanoGPTOptions
      openrouter?: OpenRouterOptions
      anthropic?: AnthropicOptions
      mistral?: MistralOptions
      cohere?: CohereOptions
      gemini?: GeminiOptions
      'openai-legacy-instruct'?: LegacyInstructOptions
      'openai-responses'?: ResponsesOptions
      kobold?: KoboldOptions
      'ooba-legacy'?: OobaLegacyOptions
      ollama?: OllamaOptions
      bedrock?: BedrockOptions
      horde?: HordeOptions
    }

    beginLegacyRequestHistory({
      db,
      reply,
      provider,
      model: body.model,
      prompt: legacyFinalizedPrompt(provider, messages, options),
      stream: body.stream,
    })

    if (provider === 'echo') {
      const echoOpts = options.echo ?? {}
      if (body.stream === true) {
        await handleEchoStreaming(req, reply, echoOpts)
        return
      }
      await handleEchoBuffered(req, reply, echoOpts)
      return
    }

    if (provider === 'anthropic') {
      const anthropicOpts = options.anthropic ?? {}
      if (body.stream === true) {
        await handleAnthropicStreaming(req, reply, body.model, messages, anthropicOpts)
        return
      }
      await handleAnthropicBuffered(req, reply, body.model, messages, anthropicOpts)
      return
    }

    if (provider === 'mistral') {
      const mistralOpts = options.mistral ?? {}
      if (body.stream === true) {
        await handleMistralStreaming(req, reply, body.model, messages, mistralOpts)
        return
      }
      await handleMistralBuffered(req, reply, body.model, messages, mistralOpts)
      return
    }

    if (provider === 'cohere') {
      if (body.stream === true) {
        // Server Cohere dispatch currently supports buffered responses only.
        reply.code(400).send({
          error: 'cohere streaming is not yet supported; set stream: false',
        })
        return
      }
      const cohereOpts = options.cohere ?? {}
      await handleCohereBuffered(req, reply, body.model, messages, cohereOpts)
      return
    }

    if (provider === 'gemini') {
      const geminiOpts = options.gemini ?? {}
      if (body.stream === true) {
        await handleGeminiStreaming(req, reply, body.model, messages, geminiOpts)
        return
      }
      await handleGeminiBuffered(req, reply, body.model, messages, geminiOpts)
      return
    }

    if (provider === 'openai-legacy-instruct') {
      if (body.stream === true) {
        // The legacy `/v1/completions` adapter currently supports buffered
        // responses only.
        reply.code(400).send({
          error: 'openai-legacy-instruct streaming is not yet supported; set stream: false',
        })
        return
      }
      const opts = options['openai-legacy-instruct'] ?? {}
      await handleLegacyInstructBuffered(req, reply, body.model, messages, opts)
      return
    }

    if (provider === 'openai-responses') {
      if (body.stream === true) {
        reply.code(400).send({
          error: 'openai-responses streaming is not yet supported; set stream: false',
        })
        return
      }
      const opts = options['openai-responses'] ?? {}
      await handleResponsesBuffered(req, reply, body.model, messages, opts)
      return
    }

    if (provider === 'kobold') {
      if (body.stream === true) {
        reply.code(400).send({
          error: 'kobold streaming is not yet supported; set stream: false',
        })
        return
      }
      await handleKoboldBuffered(req, reply, messages, options.kobold ?? {})
      return
    }

    if (provider === 'ooba-legacy') {
      if (body.stream === true) {
        // The local code uses a WebSocket stream for ooba legacy. The fetch
        // SSE envelope is unsupported.
        reply.code(400).send({
          error: 'ooba-legacy streaming is not yet supported; set stream: false',
        })
        return
      }
      await handleOobaLegacyBuffered(req, reply, messages, options['ooba-legacy'] ?? {})
      return
    }

    if (provider === 'ollama') {
      const ollamaOpts = options.ollama ?? {}
      if (body.stream === true) {
        await handleOllamaStreaming(req, reply, body.model, messages, ollamaOpts)
        return
      }
      await handleOllamaBuffered(req, reply, body.model, messages, ollamaOpts)
      return
    }

    if (provider === 'bedrock') {
      if (body.stream === true) {
        reply.code(400).send({
          error: 'bedrock streaming is not yet supported; set stream: false',
        })
        return
      }
      await handleBedrockBuffered(req, reply, body.model, messages, options.bedrock ?? {})
      return
    }

    if (provider === 'horde') {
      if (body.stream === true) {
        // Horde's poll-loop wire isn't incremental; one final payload
        // either lands or doesn't.
        reply.code(400).send({
          error: 'horde streaming is not yet supported; set stream: false',
        })
        return
      }
      await handleHordeBuffered(req, reply, body.model, options.horde ?? {})
      return
    }

    const variantResult = resolveOpenAICompatibleVariant(provider as OpenAICompatibleProvider, options)
    if (variantResult.ok === false) {
      return badRequest(reply, variantResult.error)
    }

    if (body.stream === true) {
      await handleOpenAICompatibleStreaming(req, reply, body.model, messages, variantResult.variant)
      return
    }
    await handleOpenAICompatibleBuffered(req, reply, body.model, messages, variantResult.variant)
  })
}
