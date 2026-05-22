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

const SUPPORTED_PROVIDERS = new Set(['echo', 'openai'])

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

async function handleOpenAIStreaming(
  req: FastifyRequest,
  reply: FastifyReply,
  model: string,
  messages: unknown[],
  options: OpenAIOptions,
): Promise<void> {
  const { signal, cleanup } = attachAbort(req)
  try {
    const resolved = resolveOpenAIRequest({
      model,
      messages,
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      maxTokens: options.maxTokens,
      temperature: options.temperature,
      signal,
    })
    if (!resolved) {
      badRequest(reply, 'options.openai.apiKey is required')
      return
    }
    await pipeStream(reply, runOpenAIStream(resolved))
  } finally {
    cleanup()
  }
}

async function handleOpenAIBuffered(
  req: FastifyRequest,
  reply: FastifyReply,
  model: string,
  messages: unknown[],
  options: OpenAIOptions,
): Promise<void> {
  const { signal, cleanup } = attachAbort(req)
  try {
    const resolved = resolveOpenAIRequest({
      model,
      messages,
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      maxTokens: options.maxTokens,
      temperature: options.temperature,
      signal,
    })
    if (!resolved) {
      badRequest(reply, 'options.openai.apiKey is required')
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

    if (provider === 'openai') {
      const openaiOpts = options.openai ?? {}
      if (body.stream === true) {
        await handleOpenAIStreaming(req, reply, body.model, messages, openaiOpts)
        return
      }
      await handleOpenAIBuffered(req, reply, body.model, messages, openaiOpts)
      return
    }
  })
}
