import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { AuthState } from '../auth.js'
import {
  resolveEchoRequest,
  runEcho,
  runEchoStream,
} from '../generation/echo.js'
import type { CompletionStreamFrame } from '../generation/frames.js'
import {
  resolveOpenAIRequest,
  runOpenAI,
  runOpenAIStream,
} from '../generation/openai.js'
import { requireAuth } from '../http.js'

const SUPPORTED_PROVIDERS = new Set(['echo', 'openai', 'nanogpt', 'openrouter'])

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
