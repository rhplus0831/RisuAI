import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { AuthState } from '../auth.js'
import {
  resolveAnthropicRequest,
  runAnthropic,
  runAnthropicStream,
} from '../generation/anthropic.js'
import {
  resolveEchoRequest,
  runEcho,
  runEchoStream,
} from '../generation/echo.js'
import type { CompletionStreamFrame } from '../generation/frames.js'
import { resolveCohereRequest, runCohere } from '../generation/cohere.js'
import {
  resolveGeminiRequest,
  runGemini,
  runGeminiStream,
} from '../generation/gemini.js'
import {
  resolveMistralRequest,
  runMistral,
  runMistralStream,
} from '../generation/mistral.js'
import {
  resolveOpenAIRequest,
  runOpenAI,
  runOpenAIStream,
} from '../generation/openai.js'
import {
  resolveOpenAILegacyInstructRequest,
  runOpenAILegacyInstruct,
} from '../generation/openaiLegacyInstruct.js'
import {
  resolveOpenAIResponsesRequest,
  runOpenAIResponses,
} from '../generation/openaiResponses.js'
import { resolveKoboldRequest, runKobold } from '../generation/kobold.js'
import { resolveOobaLegacyRequest, runOobaLegacy } from '../generation/oobaLegacy.js'
import { requireAuth } from '../http.js'

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
])

const NANOGPT_BASE_URL = 'https://nano-gpt.com/api/v1'
const NANOGPT_SUBSCRIPTION_BASE_URL = 'https://nano-gpt.com/api/subscription/v1'
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

interface ChatMessage {
  role: string
  content: unknown
}

interface CompletionRequestBody {
  provider?: unknown
  model?: unknown
  messages?: unknown
  stream?: unknown
  options?: unknown
}

interface EchoOptions {
  message?: unknown
  delayMs?: unknown
}

interface OpenAIOptions {
  apiKey?: unknown
  baseUrl?: unknown
  maxTokens?: unknown
  temperature?: unknown
}

interface NanoGPTOptions {
  apiKey?: unknown
  providerHint?: unknown
  useSubscription?: unknown
  maxTokens?: unknown
  temperature?: unknown
}

interface OpenRouterOptions {
  apiKey?: unknown
  maxTokens?: unknown
  temperature?: unknown
}

interface AnthropicOptions {
  apiKey?: unknown
  baseUrl?: unknown
  version?: unknown
  system?: unknown
  maxTokens?: unknown
  temperature?: unknown
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
}

interface GeminiOptions {
  apiKey?: unknown
  baseUrl?: unknown
  maxOutputTokens?: unknown
  temperature?: unknown
  topP?: unknown
  topK?: unknown
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
}

interface ResponsesOptions {
  apiKey?: unknown
  baseUrl?: unknown
  maxOutputTokens?: unknown
  temperature?: unknown
  topP?: unknown
  store?: unknown
  extraHeaders?: Record<string, string>
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

interface OpenAICompatibleVariant {
  apiKey: string
  baseUrl: string
  maxTokens?: unknown
  temperature?: unknown
  extraHeaders?: Record<string, string>
}

function resolveOpenAIVariant(o: OpenAIOptions): OpenAICompatibleVariant | null {
  if (typeof o.apiKey !== 'string' || o.apiKey.length === 0) return null
  const baseUrl =
    typeof o.baseUrl === 'string' && o.baseUrl.length > 0
      ? o.baseUrl
      : 'https://api.openai.com/v1'
  return { apiKey: o.apiKey, baseUrl, maxTokens: o.maxTokens, temperature: o.temperature }
}

function resolveNanoGPTVariant(o: NanoGPTOptions): OpenAICompatibleVariant | null {
  if (typeof o.apiKey !== 'string' || o.apiKey.length === 0) return null
  const baseUrl = o.useSubscription === true ? NANOGPT_SUBSCRIPTION_BASE_URL : NANOGPT_BASE_URL
  const extraHeaders: Record<string, string> = {}
  if (typeof o.providerHint === 'string' && o.providerHint.length > 0) {
    extraHeaders['X-Provider'] = o.providerHint
  }
  return {
    apiKey: o.apiKey,
    baseUrl,
    maxTokens: o.maxTokens,
    temperature: o.temperature,
    extraHeaders,
  }
}

function resolveOpenRouterVariant(o: OpenRouterOptions): OpenAICompatibleVariant | null {
  if (typeof o.apiKey !== 'string' || o.apiKey.length === 0) return null
  return {
    apiKey: o.apiKey,
    baseUrl: OPENROUTER_BASE_URL,
    maxTokens: o.maxTokens,
    temperature: o.temperature,
    extraHeaders: {
      'X-Title': 'RisuAI',
      'HTTP-Referer': 'https://risuai.xyz',
    },
  }
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

function badRequest(reply: FastifyReply, error: string): void {
  reply.code(400).send({ error })
}

function writeSseChunk(reply: FastifyReply, frame: CompletionStreamFrame): void {
  const event = frame.kind === 'done' ? 'done' : 'chunk'
  const data =
    frame.kind === 'done'
      ? JSON.stringify({ finishReason: frame.finishReason ?? 'stop' })
      : JSON.stringify({ type: 'token', content: frame.content ?? '' })
  reply.raw.write(`event: ${event}\ndata: ${data}\n\n`)
}

function attachAbort(req: FastifyRequest): {
  signal: AbortSignal
  cleanup: () => void
} {
  const controller = new AbortController()
  const onClose = (): void => controller.abort()
  req.raw.on('close', onClose)
  return {
    signal: controller.signal,
    cleanup: () => req.raw.off('close', onClose),
  }
}

async function pipeStream(
  reply: FastifyReply,
  frames: AsyncGenerator<CompletionStreamFrame, void, void>,
): Promise<void> {
  reply.raw.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    connection: 'keep-alive',
  })
  try {
    for await (const frame of frames) {
      writeSseChunk(reply, frame)
    }
  } finally {
    reply.raw.end()
  }
}

async function handleEchoStreaming(
  req: FastifyRequest,
  reply: FastifyReply,
  options: EchoOptions,
): Promise<void> {
  const { signal, cleanup } = attachAbort(req)
  try {
    const echo = resolveEchoRequest({
      message: options.message,
      delayMs: options.delayMs,
      signal,
    })
    await pipeStream(reply, runEchoStream(echo))
  } finally {
    cleanup()
  }
}

async function handleEchoBuffered(
  req: FastifyRequest,
  reply: FastifyReply,
  options: EchoOptions,
): Promise<void> {
  const { signal, cleanup } = attachAbort(req)
  try {
    const echo = resolveEchoRequest({
      message: options.message,
      delayMs: options.delayMs,
      signal,
    })
    const result = await runEcho(echo)
    if (result.aborted === true) return
    reply.code(200).send({ type: result.type, result: result.result })
  } finally {
    cleanup()
  }
}

async function handleAnthropicStreaming(
  req: FastifyRequest,
  reply: FastifyReply,
  model: string,
  messages: unknown[],
  options: AnthropicOptions,
): Promise<void> {
  const { signal, cleanup } = attachAbort(req)
  try {
    const resolved = resolveAnthropicRequest({
      model,
      messages,
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      version: options.version,
      system: options.system,
      maxTokens: options.maxTokens,
      temperature: options.temperature,
      signal,
    })
    if (!resolved) {
      badRequest(reply, 'options.anthropic.apiKey is required')
      return
    }
    await pipeStream(reply, runAnthropicStream(resolved))
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
  const { signal, cleanup } = attachAbort(req)
  try {
    const resolved = resolveAnthropicRequest({
      model,
      messages,
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      version: options.version,
      system: options.system,
      maxTokens: options.maxTokens,
      temperature: options.temperature,
      signal,
    })
    if (!resolved) {
      badRequest(reply, 'options.anthropic.apiKey is required')
      return
    }
    const result = await runAnthropic(resolved)
    if (result.aborted === true) return
    const payload: { type: string; result: string; model?: string } = {
      type: result.type,
      result: result.result,
    }
    if (result.model !== undefined) payload.model = result.model
    reply.code(200).send(payload)
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
  const { signal, cleanup } = attachAbort(req)
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
    reply.code(200).send({ type: result.type, result: result.result })
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
  const { signal, cleanup } = attachAbort(req)
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
    reply.code(200).send({ type: result.type, result: result.result })
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
  const { signal, cleanup } = attachAbort(req)
  try {
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
      signal,
    })
    if (!resolved) {
      badRequest(reply, 'options["openai-responses"].apiKey is required')
      return
    }
    const result = await runOpenAIResponses(resolved)
    if (result.aborted === true) return
    const payload: { type: string; result: string; model?: string } = {
      type: result.type,
      result: result.result,
    }
    if (result.model !== undefined) payload.model = result.model
    reply.code(200).send(payload)
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
  const { signal, cleanup } = attachAbort(req)
  try {
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
      signal,
    })
    if (!resolved) {
      badRequest(reply, 'options["openai-legacy-instruct"].apiKey is required')
      return
    }
    const result = await runOpenAILegacyInstruct(resolved)
    if (result.aborted === true) return
    const payload: { type: string; result: string; model?: string } = {
      type: result.type,
      result: result.result,
    }
    if (result.model !== undefined) payload.model = result.model
    reply.code(200).send(payload)
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
  const { signal, cleanup } = attachAbort(req)
  try {
    const resolved = resolveGeminiRequest({
      model,
      messages,
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      maxOutputTokens: options.maxOutputTokens,
      temperature: options.temperature,
      topP: options.topP,
      topK: options.topK,
      signal,
    })
    if (!resolved) {
      badRequest(reply, 'options.gemini.apiKey is required (and contents must be non-empty)')
      return
    }
    await pipeStream(reply, runGeminiStream(resolved))
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
  const { signal, cleanup } = attachAbort(req)
  try {
    const resolved = resolveGeminiRequest({
      model,
      messages,
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      maxOutputTokens: options.maxOutputTokens,
      temperature: options.temperature,
      topP: options.topP,
      topK: options.topK,
      signal,
    })
    if (!resolved) {
      badRequest(reply, 'options.gemini.apiKey is required (and contents must be non-empty)')
      return
    }
    const result = await runGemini(resolved)
    if (result.aborted === true) return
    const payload: { type: string; result: string; model?: string } = {
      type: result.type,
      result: result.result,
    }
    if (result.model !== undefined) payload.model = result.model
    reply.code(200).send(payload)
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
  const { signal, cleanup } = attachAbort(req)
  try {
    if (typeof options.apiKey !== 'string' || options.apiKey.length === 0) {
      badRequest(reply, 'options.cohere.apiKey is required')
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
      signal,
    })
    if (!resolved) {
      badRequest(reply, 'cohere requires a user message to generate a response')
      return
    }
    const result = await runCohere(resolved)
    if (result.aborted === true) return
    const payload: { type: string; result: string; model?: string } = {
      type: result.type,
      result: result.result,
    }
    if (result.model !== undefined) payload.model = result.model
    reply.code(200).send(payload)
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
  const { signal, cleanup } = attachAbort(req)
  try {
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
      signal,
    })
    if (!resolved) {
      badRequest(reply, 'options.mistral.apiKey is required')
      return
    }
    await pipeStream(reply, runMistralStream(resolved))
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
  const { signal, cleanup } = attachAbort(req)
  try {
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
      signal,
    })
    if (!resolved) {
      badRequest(reply, 'options.mistral.apiKey is required')
      return
    }
    const result = await runMistral(resolved)
    if (result.aborted === true) return
    const payload: { type: string; result: string; model?: string } = {
      type: result.type,
      result: result.result,
    }
    if (result.model !== undefined) payload.model = result.model
    reply.code(200).send(payload)
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
  const { signal, cleanup } = attachAbort(req)
  try {
    const resolved = resolveOpenAIRequest({
      model,
      messages,
      apiKey: variant.apiKey,
      baseUrl: variant.baseUrl,
      maxTokens: variant.maxTokens,
      temperature: variant.temperature,
      extraHeaders: variant.extraHeaders,
      signal,
    })
    if (!resolved) {
      badRequest(reply, 'apiKey is required')
      return
    }
    await pipeStream(reply, runOpenAIStream(resolved))
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
  const { signal, cleanup } = attachAbort(req)
  try {
    const resolved = resolveOpenAIRequest({
      model,
      messages,
      apiKey: variant.apiKey,
      baseUrl: variant.baseUrl,
      maxTokens: variant.maxTokens,
      temperature: variant.temperature,
      extraHeaders: variant.extraHeaders,
      signal,
    })
    if (!resolved) {
      badRequest(reply, 'apiKey is required')
      return
    }
    const result = await runOpenAI(resolved)
    if (result.aborted === true) return
    const payload: { type: string; result: string; model?: string } = {
      type: result.type,
      result: result.result,
    }
    if (result.model !== undefined) payload.model = result.model
    reply.code(200).send(payload)
  } finally {
    cleanup()
  }
}

export function registerGenerationRoutes(
  app: FastifyInstance,
  authState: AuthState,
): void {
  app.post('/api/v1/generate/completion', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    const body = (req.body ?? {}) as CompletionRequestBody

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
    }

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
        // Cohere's local browser path is non-streaming-only. The server
        // mirrors that until streaming is justified by a fixture.
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
        // The local browser path doesn't stream the legacy /v1/completions
        // endpoint either. Defer until justified by a fixture.
        reply.code(400).send({
          error:
            'openai-legacy-instruct streaming is not yet supported; set stream: false',
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
        // SSE envelope doesn't apply; deferred.
        reply.code(400).send({
          error: 'ooba-legacy streaming is not yet supported; set stream: false',
        })
        return
      }
      await handleOobaLegacyBuffered(req, reply, messages, options['ooba-legacy'] ?? {})
      return
    }

    let variant: OpenAICompatibleVariant | null = null
    let variantLabel = ''
    if (provider === 'openai') {
      variant = resolveOpenAIVariant(options.openai ?? {})
      variantLabel = 'options.openai.apiKey'
    } else if (provider === 'nanogpt') {
      variant = resolveNanoGPTVariant(options.nanogpt ?? {})
      variantLabel = 'options.nanogpt.apiKey'
    } else if (provider === 'openrouter') {
      variant = resolveOpenRouterVariant(options.openrouter ?? {})
      variantLabel = 'options.openrouter.apiKey'
    }

    if (variant === null) {
      return badRequest(reply, `${variantLabel} is required`)
    }

    if (body.stream === true) {
      await handleOpenAICompatibleStreaming(req, reply, body.model, messages, variant)
      return
    }
    await handleOpenAICompatibleBuffered(req, reply, body.model, messages, variant)
  })
}
