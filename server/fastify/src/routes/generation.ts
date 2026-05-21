import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { AuthState } from '../auth.js'
import { requireAuth } from '../http.js'
import {
  resolveEchoRequest,
  runEcho,
  runEchoStream,
  type EchoStreamFrame,
} from '../generation/echo.js'

const SUPPORTED_PROVIDERS = new Set(['echo'])

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

async function writeSseChunk(
  reply: FastifyReply,
  frame: EchoStreamFrame,
): Promise<void> {
  const event = frame.kind === 'done' ? 'done' : 'chunk'
  const data =
    frame.kind === 'done'
      ? JSON.stringify({ finishReason: frame.finishReason ?? 'stop' })
      : JSON.stringify({ type: 'token', content: frame.content ?? '' })
  reply.raw.write(`event: ${event}\ndata: ${data}\n\n`)
}

async function handleEchoStreaming(
  req: FastifyRequest,
  reply: FastifyReply,
  options: EchoOptions,
): Promise<void> {
  const controller = new AbortController()
  const onClose = (): void => controller.abort()
  req.raw.on('close', onClose)

  reply.raw.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    connection: 'keep-alive',
  })

  try {
    const echo = resolveEchoRequest({
      message: options.message,
      delayMs: options.delayMs,
      signal: controller.signal,
    })
    for await (const frame of runEchoStream(echo)) {
      await writeSseChunk(reply, frame)
    }
  } finally {
    req.raw.off('close', onClose)
    reply.raw.end()
  }
}

async function handleEchoBuffered(
  req: FastifyRequest,
  reply: FastifyReply,
  options: EchoOptions,
): Promise<void> {
  const controller = new AbortController()
  const onClose = (): void => controller.abort()
  req.raw.on('close', onClose)
  try {
    const echo = resolveEchoRequest({
      message: options.message,
      delayMs: options.delayMs,
      signal: controller.signal,
    })
    const result = await runEcho(echo)
    if (result.aborted === true) {
      // Client gave up; nothing to do.
      return
    }
    reply.code(200).send({
      type: result.type,
      result: result.result,
    })
  } finally {
    req.raw.off('close', onClose)
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
        reason: `provider not implemented in Phase 6-1: ${provider}`,
      })
      return
    }

    const options = (body.options ?? {}) as { echo?: EchoOptions }
    const echoOpts = (options.echo ?? {}) as EchoOptions

    if (body.stream === true) {
      await handleEchoStreaming(req, reply, echoOpts)
      return
    }
    await handleEchoBuffered(req, reply, echoOpts)
  })
}
