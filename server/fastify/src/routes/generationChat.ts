import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { AuthState } from '../auth.js'
import { requireAuth } from '../http.js'
import {
  type PromptChatEvent,
  writePromptChatEvent,
} from '../prompt/sseEvents.js'

const ALLOWED_MODES = new Set([
  'send',
  'continue',
  'preview',
  'preview_prompt',
  'regenerate',
])

interface ChatRequestBody {
  chatId?: unknown
  characterId?: unknown
  presetId?: unknown
  loadoutId?: unknown
  mode?: unknown
  regenerateMessageId?: unknown
  userMessage?: unknown
  resetMessages?: unknown
  expectedRevision?: unknown
  inlayAssets?: unknown
  clientCapabilities?: unknown
}

function badRequest(reply: FastifyReply, error: string): void {
  reply.code(400).send({ error })
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function validate(body: ChatRequestBody): { ok: true } | { ok: false; error: string } {
  if (!isNonEmptyString(body.chatId)) return { ok: false, error: 'chatId is required' }
  if (!isNonEmptyString(body.characterId)) {
    return { ok: false, error: 'characterId is required' }
  }
  if (!isNonEmptyString(body.mode) || !ALLOWED_MODES.has(body.mode)) {
    return {
      ok: false,
      error: 'mode must be one of: send, continue, preview, preview_prompt, regenerate',
    }
  }
  if (body.mode === 'send' && !isNonEmptyString(body.userMessage)) {
    return { ok: false, error: 'userMessage is required when mode is "send"' }
  }
  if (body.mode === 'regenerate' && !isNonEmptyString(body.regenerateMessageId)) {
    return {
      ok: false,
      error: 'regenerateMessageId is required when mode is "regenerate"',
    }
  }
  if (body.presetId !== undefined && typeof body.presetId !== 'string') {
    return { ok: false, error: 'presetId must be a string when provided' }
  }
  if (body.loadoutId !== undefined && typeof body.loadoutId !== 'string') {
    return { ok: false, error: 'loadoutId must be a string when provided' }
  }
  if (body.resetMessages !== undefined && typeof body.resetMessages !== 'boolean') {
    return { ok: false, error: 'resetMessages must be a boolean when provided' }
  }
  if (body.expectedRevision !== undefined && typeof body.expectedRevision !== 'number') {
    return { ok: false, error: 'expectedRevision must be a number when provided' }
  }
  if (body.inlayAssets !== undefined && !Array.isArray(body.inlayAssets)) {
    return { ok: false, error: 'inlayAssets must be an array when provided' }
  }
  return { ok: true }
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

async function streamScaffold(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { cleanup } = attachAbort(req)
  try {
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    })
    const events: PromptChatEvent[] = [
      { type: 'stage', stage: 'validate', status: 'start' },
      { type: 'stage', stage: 'validate', status: 'end' },
      { type: 'error', error: 'phase-7 prompt assembly not yet implemented' },
      { type: 'done' },
    ]
    for (const event of events) {
      writePromptChatEvent(reply, event)
    }
    reply.raw.end()
  } finally {
    cleanup()
  }
}

export function registerGenerationChatRoutes(
  app: FastifyInstance,
  authState: AuthState,
): void {
  app.post('/api/v1/generate/chat', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    const body = (req.body ?? {}) as ChatRequestBody
    const validation = validate(body)
    if (!validation.ok) {
      return badRequest(reply, validation.error)
    }

    await streamScaffold(req, reply)
  })
}
