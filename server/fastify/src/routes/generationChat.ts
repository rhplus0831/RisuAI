import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import type { Database } from '../../../../src/ts/storage/database.svelte'
import type { CompletionStreamFrame } from '../generation/frames.js'
import type { AuthState } from '../auth.js'
import { requireAuth } from '../http.js'
import { EntityNotFoundError, applyImport, loadPersisted } from '../repository.js'
import {
  assemblePrompt,
  type AssembleDeps,
  type AssembleInput,
  type AssembleResult,
} from '../prompt/assemble.js'
import { emitProviderChunks } from '../prompt/providerTransport.js'
import {
  type PromptChatEvent,
  type PromptEvent,
  writePromptChatEvent,
} from '../prompt/sseEvents.js'

const ALLOWED_MODES = new Set(['send', 'continue', 'preview', 'preview_prompt', 'regenerate'])

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

type SuccessfulAssembleResult = AssembleResult & {
  stopSending: false
  prompt: Omit<PromptEvent, 'type'>
}

export interface ChatProviderDispatchContext {
  input: AssembleInput
  result: SuccessfulAssembleResult
  signal: AbortSignal
}

export type ChatProviderDispatcher = (
  context: ChatProviderDispatchContext,
) =>
  | AsyncIterable<CompletionStreamFrame>
  | Promise<AsyncIterable<CompletionStreamFrame> | null | undefined>
  | null
  | undefined

export interface GenerationChatRouteOptions {
  dispatchProvider?: ChatProviderDispatcher
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
    expectedRevision: typeof body.expectedRevision === 'number' ? body.expectedRevision : undefined,
    inlayAssets: Array.isArray(body.inlayAssets) ? body.inlayAssets : undefined,
  }
}

/**
 * The assembler dependency surface bound to the persisted store. The
 * route owns the storage import so `assemble.ts` stays
 * storage-global-free. The loaded database reference is kept so
 * 7-12d-i can persist chat-var writes after assembly.
 */
interface RouteAssembleDeps extends AssembleDeps {
  getDatabase(): Database | null
}

function loadDatabaseDeps(dataDir: string): RouteAssembleDeps {
  let database: Database | null = null
  return {
    loadDatabase: () => {
      database = loadPersisted(dataDir).database as Database | null
      return database
    },
    getDatabase: () => database,
  }
}

function shouldPersistVarChanges(input: AssembleInput): boolean {
  return input.mode === 'send' || input.mode === 'continue' || input.mode === 'regenerate'
}

function persistVarChanges(
  db: DatabaseSync,
  dataDir: string,
  deps: RouteAssembleDeps,
  input: AssembleInput,
  result: Awaited<ReturnType<typeof assemblePrompt>>,
): void {
  if (!shouldPersistVarChanges(input) || !result.mutations?.varChanged) return
  const database = deps.getDatabase()
  if (!database) return
  applyImport(db, dataDir, database)
}

/**
 * Phase 7-11g: stream the assembled prompt. The SSE head is written
 * up front, so every assembly failure (bad IDs, missing database, a
 * trigger/overflow `stopSending`) is a terminal `error` event rather
 * than an HTTP status — body validation already returned 400 before we
 * committed to streaming. Provider dispatch lands with later 7-12d
 * slices; 7-12d-i persists chat-var writes for send-like modes.
 */
async function streamAssembly(
  req: FastifyRequest,
  reply: FastifyReply,
  db: DatabaseSync,
  input: AssembleInput,
  dataDir: string,
  options: GenerationChatRouteOptions = {},
): Promise<void> {
  const { signal, cleanup } = attachAbort(req)
  let terminalDoneEmitted = false
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
      const startedAt = Date.now()
      const deps = loadDatabaseDeps(dataDir)
      const result = await assemblePrompt(input, deps)
      persistVarChanges(db, dataDir, deps, input, result)
      const promptMs = Date.now() - startedAt
      if (!result.stopSending && result.prompt) {
        emit({ type: 'prompt', ...result.prompt })
        if (result.mutations) {
          emit({ type: 'message_patch', patch: result.mutations })
        }
        emit({ type: 'stage', stage: 'prompt', status: 'end' })
        // 7-11i: assembly telemetry. `outputTokens` is the response *budget*,
        // not a completion count, so it rides on `responseBudget` rather than
        // `tokens.completion` (which stays unset until dispatch in 7-12).
        emit({
          type: 'info',
          timings: { prompt: promptMs },
          tokens: { prompt: result.inputTokens, total: result.inputTokens },
          responseBudget: result.outputTokens,
        })
        if (options.dispatchProvider) {
          const frames = await options.dispatchProvider({
            input,
            result: {
              ...result,
              stopSending: false,
              prompt: result.prompt,
            },
            signal,
          })
          if (frames) {
            const transportResult = await emitProviderChunks(frames, emit, signal)
            terminalDoneEmitted = transportResult.status !== 'aborted'
          }
        }
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

    if (!terminalDoneEmitted && !signal.aborted) {
      emit({ type: 'done' })
    }
    reply.raw.end()
  } finally {
    cleanup()
  }
}

export function registerGenerationChatRoutes(
  app: FastifyInstance,
  db: DatabaseSync,
  authState: AuthState,
  dataDir: string,
  options: GenerationChatRouteOptions = {},
): void {
  app.post('/api/v1/generate/chat', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    const body = (req.body ?? {}) as ChatRequestBody
    const validation = validate(body)
    if (!validation.ok) {
      return badRequest(reply, validation.error)
    }

    await streamAssembly(req, reply, db, toAssembleInput(body), dataDir, options)
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
