import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Database } from '../../../../src/ts/storage/database.svelte'
import type { AuthState } from '../auth.js'
import { requireAuth } from '../http.js'
import { EntityNotFoundError, loadPersisted } from '../repository.js'
import {
  assemblePrompt,
  type AssembleDeps,
  type AssembleInput,
} from '../prompt/assemble.js'
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

/**
 * Validation for the preview-prompt shortcut. The mode is forced to
 * `preview_prompt`, so the `send` / `regenerate` / mode-enum rules in
 * `validate` do not apply — only the scope IDs are required, plus the
 * shared optional-field type checks.
 */
function validatePreview(body: ChatRequestBody): { ok: true } | { ok: false; error: string } {
  if (!isNonEmptyString(body.chatId)) return { ok: false, error: 'chatId is required' }
  if (!isNonEmptyString(body.characterId)) {
    return { ok: false, error: 'characterId is required' }
  }
  if (body.presetId !== undefined && typeof body.presetId !== 'string') {
    return { ok: false, error: 'presetId must be a string when provided' }
  }
  if (body.loadoutId !== undefined && typeof body.loadoutId !== 'string') {
    return { ok: false, error: 'loadoutId must be a string when provided' }
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

/** Map a validated request body to the assembler input contract. */
function toAssembleInput(body: ChatRequestBody): AssembleInput {
  return {
    chatId: body.chatId as string,
    characterId: body.characterId as string,
    mode: body.mode as AssembleInput['mode'],
    presetId: typeof body.presetId === 'string' ? body.presetId : undefined,
    loadoutId: typeof body.loadoutId === 'string' ? body.loadoutId : undefined,
    regenerateMessageId:
      typeof body.regenerateMessageId === 'string' ? body.regenerateMessageId : undefined,
    userMessage: typeof body.userMessage === 'string' ? body.userMessage : undefined,
    resetMessages: typeof body.resetMessages === 'boolean' ? body.resetMessages : undefined,
    expectedRevision:
      typeof body.expectedRevision === 'number' ? body.expectedRevision : undefined,
    inlayAssets: Array.isArray(body.inlayAssets) ? body.inlayAssets : undefined,
  }
}

/**
 * The assembler dependency surface bound to the persisted store. The
 * route owns the storage import so `assemble.ts` stays
 * storage-global-free. Read-only — `varChanged` persistence lands with
 * Phase 7-12.
 */
function loadDatabaseDeps(dataDir: string): AssembleDeps {
  return {
    loadDatabase: () => loadPersisted(dataDir).database as Database | null,
  }
}

/**
 * Phase 7-11g: stream the assembled prompt. The SSE head is written
 * up front, so every assembly failure (bad IDs, missing database, a
 * trigger/overflow `stopSending`) is a terminal `error` event rather
 * than an HTTP status — body validation already returned 400 before we
 * committed to streaming. Provider dispatch + `varChanged` persistence
 * land with Phase 7-12.
 */
async function streamAssembly(
  req: FastifyRequest,
  reply: FastifyReply,
  input: AssembleInput,
  dataDir: string,
): Promise<void> {
  const { cleanup } = attachAbort(req)
  try {
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    })
    const emit = (event: PromptChatEvent): void => writePromptChatEvent(reply, event)

    emit({ type: 'stage', stage: 'validate', status: 'start' })
    emit({ type: 'stage', stage: 'validate', status: 'end' })
    emit({ type: 'stage', stage: 'prompt', status: 'start' })

    try {
      const result = await assemblePrompt(input, loadDatabaseDeps(dataDir))
      if (!result.stopSending && result.prompt) {
        emit({ type: 'prompt', ...result.prompt })
        emit({ type: 'stage', stage: 'prompt', status: 'end' })
      } else {
        emit({
          type: 'error',
          error:
            result.abortReason === 'overflow'
              ? 'prompt exceeds the context budget'
              : 'prompt assembly was stopped by a trigger',
        })
      }
    } catch (err) {
      emit({
        type: 'error',
        error: err instanceof Error ? err.message : 'prompt assembly failed',
      })
    }

    emit({ type: 'done' })
    reply.raw.end()
  } finally {
    cleanup()
  }
}

export function registerGenerationChatRoutes(
  app: FastifyInstance,
  authState: AuthState,
  dataDir: string,
): void {
  app.post('/api/v1/generate/chat', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    const body = (req.body ?? {}) as ChatRequestBody
    const validation = validate(body)
    if (!validation.ok) {
      return badRequest(reply, validation.error)
    }

    await streamAssembly(req, reply, toAssembleInput(body), dataDir)
  })

  // 7-11h: one-shot JSON preview. Unlike `/chat` this never opens an SSE
  // stream, so scope errors surface as real HTTP status codes.
  app.post('/api/v1/generate/preview-prompt', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    const body = (req.body ?? {}) as ChatRequestBody
    const validation = validatePreview(body)
    if (!validation.ok) {
      return badRequest(reply, validation.error)
    }

    const input = toAssembleInput({ ...body, mode: 'preview_prompt' })
    try {
      const result = await assemblePrompt(input, loadDatabaseDeps(dataDir))
      if (result.stopSending) {
        return { stopSending: true, abortReason: result.abortReason }
      }
      return result.prompt
    } catch (err) {
      if (err instanceof EntityNotFoundError) {
        reply.code(404)
        return { error: err.message }
      }
      throw err
    }
  })
}
