import fs from 'node:fs'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { Database, Message } from '../../../../src/ts/storage/database.svelte'
import type { MultiModal } from '../../../../src/ts/process/index.svelte'
import type { CompletionStreamFrame } from '../generation/frames.js'
import type { AuthState } from '../auth.js'
import { getSchemaState } from '../db.js'
import { requireAuth } from '../http.js'
import {
  EntityNotFoundError,
  ValidationError,
  assetById,
  assetPath,
  isValidAssetId,
  loadPersistedWithMessages,
} from '../repository.js'
import {
  assemblePrompt,
  runServerPostGeneration,
  type AssembleDeps,
  type AssembleInput,
  type AssembleMutationPayload,
  type AssembleResult,
  type AssemblyState,
} from '../prompt/assemble.js'
import { normalizeAllCharacterChats, requireChatLocation } from '../commands/chats.js'
import {
  createMessageRecord,
  messageIdExists,
  normalizeAllChatMessages,
  requireChatMessages,
  validateUniqueMessageIds,
} from '../commands/messages.js'
import { COMMAND_EVENT_CATALOG, type CommandEventSink } from '../commands/events.js'
import { applyJsonCommandMutation } from '../commands/mutations.js'
import { addAlternateMessage, clearAlternateMessages } from '../messageStore.js'
import { dispatchChatProvider, getServerGenerationModelString } from '../prompt/chatDispatch.js'
import { emitProviderChunks } from '../prompt/providerTransport.js'
import {
  formatPromptChatFrame,
  type PostGenerationFrame,
  type PromptChatEvent,
  type PromptEvent,
  writePromptChatEvent,
} from '../prompt/sseEvents.js'
import { ACTIVE_WRITER_SESSION_HEADER } from '../activeWriter.js'
import type { GenerationJobRegistry } from '../generationJobs.js'
import type { JobClient, StreamJob } from '../streamJobs.js'

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
  durable?: unknown
}

type SuccessfulAssembleResult = AssembleResult & {
  stopSending: false
  prompt: Omit<PromptEvent, 'type'>
}

export interface ChatProviderDispatchContext {
  input: AssembleInput
  result: SuccessfulAssembleResult
  database: Database
  generationId: string
  generationInfo: Record<string, unknown>
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
  if (body.durable !== undefined && typeof body.durable !== 'boolean') {
    return { ok: false, error: 'durable must be a boolean when provided' }
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
 * storage-global-free. The loaded database reference is kept for provider
 * dispatch and mutation event payloads; durable chat-var persistence is now
 * performed by the route itself (Phase 9 C-A1, `persistAssemblyChatVars`)
 * through the same JSON-command machinery the scriptstate command uses.
 */
interface RouteAssembleDeps extends AssembleDeps {
  getDatabase(): Database | null
}

const LOCAL_ASSET_PATH_RE = /^assets\/([a-f0-9]{64})\.[a-z0-9]+$/i

/**
 * Slice 3a: resolve an asset reference to its sha256 store id. Accepts either a
 * bare id or the `assets/<id>.<ext>` path form, mirroring the browser's
 * `serverAssetIdFromReference` (`src/ts/server/assets.ts`) and the risuSave
 * reference collector (`risuSave/assetReferences.ts`).
 */
function assetIdFromReference(reference: string): string | null {
  if (isValidAssetId(reference)) return reference
  return LOCAL_ASSET_PATH_RE.exec(reference)?.[1] ?? null
}

/**
 * Slice 3a: read an `{{asset_prompt::}}` / char-icon reference from the on-disk
 * assets store and re-wrap it as a `data:image/png;base64,` URI. Hardcoding the
 * png mime keeps byte-parity with the browser's `readImage(asset[1])` path
 * (`formatHistoryMessage.ts:161-176`), which does the same regardless of the
 * stored content-type. Returns `undefined` for an unresolvable reference so the
 * marker is stripped without bytes (the pre-3a behavior for missing assets).
 */
function resolveStoredAssetImage(dataDir: string, reference: string): MultiModal | undefined {
  const id = assetIdFromReference(reference)
  if (!id) return undefined
  const entry = assetById(dataDir, id)
  if (!entry) return undefined
  const file = assetPath(dataDir, entry)
  if (!fs.existsSync(file)) return undefined
  const bytes = fs.readFileSync(file)
  return { type: 'image', base64: `data:image/png;base64,${bytes.toString('base64')}` }
}

function loadDatabaseDeps(dataDir: string, db: DatabaseSync): RouteAssembleDeps {
  let database: Database | null = null
  return {
    loadDatabase: () => {
      database = loadPersistedWithMessages(db, dataDir).database as Database | null
      return database
    },
    loadMemoryDatabase: () => db,
    loadPromptMemoryQueryVectors: () => [],
    getDatabase: () => database,
    resolveStoredAssetImage: (reference) => resolveStoredAssetImage(dataDir, reference),
  }
}

function shouldDispatchProvider(
  input: AssembleInput,
  database: Database | null,
  options: GenerationChatRouteOptions,
): database is Database {
  if (!(input.mode === 'send' || input.mode === 'continue' || input.mode === 'regenerate')) {
    return false
  }
  return (
    database !== null && (database.useServerPromptAssembly === true || !!options.dispatchProvider)
  )
}

function createGenerationInfo(
  db: Database,
  generationId: string,
  result: SuccessfulAssembleResult,
  promptMs: number,
): Record<string, unknown> {
  return {
    model: getServerGenerationModelString(db),
    generationId,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    maxContext: db.maxContext,
    stageTiming: {
      stage1: promptMs,
      stage2: 0,
      stage3: 0,
      stage4: 0,
    },
  }
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message.length > 0) return err.message
  if (typeof err === 'string' && err.length > 0) return err
  return fallback
}

/** Modes that persist their assembly delta; preview / preview_prompt stay read-only. */
function isPersistingMode(mode: AssembleInput['mode']): boolean {
  return mode === 'send' || mode === 'continue' || mode === 'regenerate'
}

/**
 * Phase 9 C-A1 + slice 3b sub-slice 4: persist the assembly-time chat-var delta
 * the assembler computed (`mutations.chatVarMutations`) and — when a submit-time
 * input trigger / `editinput` rewrote the transcript — the post-`editinput`
 * submit transcript (`submitMessages`), through the same JSON command machinery
 * the scriptstate command uses (`applyJsonCommandMutation`): one revision bump,
 * one event, rollback on failure. The route owns these writes and returns the new
 * revision over SSE so the browser can reconcile its cached command revision.
 *
 * The transcript is persisted **only** when `submitTranscriptChanged` is set, so a
 * plain send (no input trigger / editinput) leaves the user-message write to the
 * browser exactly as before — keeping trigger-less sends byte-for-byte unchanged.
 * When both the transcript and chat vars change, they ride one command (one
 * revision); the event is `messages.replaced` (the transcript write dominates).
 * Returns the bumped revision, or `undefined` when there is nothing to write.
 */
function persistAssemblyMutations(args: {
  db: DatabaseSync
  dataDir: string
  eventSink: CommandEventSink
  input: AssembleInput
  mutations: AssembleMutationPayload
  submitMessages?: Message[]
  submitTranscriptChanged?: boolean
}): number | undefined {
  const patch: Record<string, string | number | boolean> = {}
  const deleteKeys: string[] = []
  for (const mutation of args.mutations.chatVarMutations) {
    if (mutation.after === null) {
      deleteKeys.push(mutation.key)
    } else {
      patch[mutation.key] = mutation.after
    }
  }
  const hasVarWrite = Object.keys(patch).length > 0 || deleteKeys.length > 0
  const persistMessages =
    !!args.submitTranscriptChanged && Array.isArray(args.submitMessages)
  if (!hasVarWrite && !persistMessages) return undefined

  const { revision: baseRevision } = getSchemaState(args.db)
  const result = applyJsonCommandMutation<{ chatId: string }>({
    db: args.db,
    dataDir: args.dataDir,
    baseRevision,
    eventSink: args.eventSink,
    mutate(database) {
      const characters = normalizeAllCharacterChats(database)
      const { character, chat } = requireChatLocation(characters, args.input.chatId)
      if (persistMessages) {
        // Route-owned write of the submit transcript (server is authoritative for
        // the input trigger + editinput rewrite; the browser sent the raw text).
        ;(chat as { message: Message[] }).message = structuredClone(args.submitMessages!)
      }
      if (hasVarWrite) {
        chat.scriptstate ??= {}
        for (const key of deleteKeys) {
          delete chat.scriptstate[key]
        }
        Object.assign(chat.scriptstate, patch)
        if (Object.keys(chat.scriptstate).length === 0) {
          delete chat.scriptstate
        }
      }
      const eventTemplate = persistMessages
        ? COMMAND_EVENT_CATALOG.messagesReplaced
        : COMMAND_EVENT_CATALOG.chatScriptstateUpdated
      return {
        event: {
          ...eventTemplate,
          id: args.input.chatId,
          parentId: character.chaId,
        },
        extra: { chatId: args.input.chatId },
      }
    },
  })
  return result.revision
}

/**
 * Resolve the assistant message + replace target for the inline (non-durable)
 * server-dispatch path, which carries `continue` and `regenerate` (a send is
 * always durable). The two modes differ in message identity:
 *   - continue: `runServerPostGeneration` extended the last `char` row IN PLACE
 *     (its original `chatId` preserved), so persist that row — replace by its
 *     own `chatId`, no separate target.
 *   - regenerate: a NEW row keyed by `generationId` was appended after the
 *     transcript was truncated to the target; persist it but REPLACE the old
 *     target (`regenerateMessageId`).
 */
function resolveInlineGenerationMessage(args: {
  state: AssemblyState
  input: AssembleInput
  generationId: string
  finalText: string
  generationInfo: Record<string, unknown>
  promptInfo?: Record<string, unknown>
}): { message: Message; targetMessageId?: string } {
  if (args.input.mode === 'continue') {
    const messages = args.state.currentChat.message ?? []
    const row = [...messages].reverse().find((message) => message.role === 'char')
    if (row) return { message: structuredClone(row) as Message }
    // Defensive: no prior assistant row to extend — append a fresh one.
    return {
      message: buildAssistantMessage({
        data: args.finalText,
        generationId: args.generationId,
        characterId: args.state.currentChar.chaId,
        generationInfo: args.generationInfo,
        promptInfo: args.promptInfo,
      }),
    }
  }
  const message = extractAssistantMessage(
    args.state,
    args.generationId,
    args.finalText,
    args.generationInfo,
    args.promptInfo,
  )
  return {
    message,
    targetMessageId:
      args.input.mode === 'regenerate' ? args.input.regenerateMessageId : undefined,
  }
}

/**
 * The last `char` row in the assembler-state chat — the `continue` target.
 * Captured BEFORE `runServerPostGeneration` rewrites it in place, so the failure
 * / cancel fallback can still reconstruct the extended text + the original id.
 * Mirrors `resolveInlineGenerationMessage`'s continue lookup.
 */
function findContinueRow(state: AssemblyState): Message | undefined {
  return [...(state.currentChat.message ?? [])].reverse().find((m) => m.role === 'char')
}

/**
 * Mode-aware RAW assistant message (no post-gen derivation) + replace target,
 * shared by the post-gen derivation-failure fallback and the streaming-cancel
 * persist. `continue` extends the captured continue row in place (keeping its id);
 * `regenerate` replaces the target (`regenerateMessageId`); `send` appends a fresh
 * row keyed by `generationId`. The mode-aware target is what makes a durable
 * continue/regenerate (Phase 6b) land on the right row even without a post-gen pass.
 */
function buildRawModeMessage(args: {
  input: AssembleInput
  continueRow: Message | undefined
  text: string
  generationId: string
  generationInfo: Record<string, unknown>
  promptInfo?: Record<string, unknown>
}): { message: Message; targetMessageId?: string } {
  if (args.input.mode === 'continue') {
    return {
      message: buildAssistantMessage({
        data: ((args.continueRow?.data ?? '') + args.text).trim(),
        generationId: args.continueRow?.chatId ?? args.generationId,
        characterId: args.input.characterId,
        generationInfo: args.generationInfo,
        promptInfo: args.promptInfo,
      }),
    }
  }
  return {
    message: buildAssistantMessage({
      data: args.text.trim(),
      generationId: args.generationId,
      characterId: args.input.characterId,
      generationInfo: args.generationInfo,
      promptInfo: args.promptInfo,
    }),
    targetMessageId:
      args.input.mode === 'regenerate' ? args.input.regenerateMessageId : undefined,
  }
}

/**
 * Run the A2 post-gen pass and resolve the mode-aware assistant message + replace
 * target, with a mode-correct raw-text fallback when the derivation throws. Shared
 * by the inline (`buildPostGenerationFrame`) and durable (`buildDurablePostGeneration`)
 * finalization paths — they differ only in how they SURFACE a derivation/persist
 * failure, not in WHAT they persist. A `postGen` of `undefined` signals the
 * derivation threw (the raw fallback is in use).
 */
async function resolvePostGenerationResult(args: {
  state: AssemblyState
  input: AssembleInput
  completionText: string
  generationId: string
  generationInfo: Record<string, unknown>
  promptInfo?: Record<string, unknown>
}): Promise<{
  postGen?: Awaited<ReturnType<typeof runServerPostGeneration>>
  message: Message
  targetMessageId?: string
  chatVarMutations: AssembleMutationPayload['chatVarMutations']
}> {
  // Capture the continue target BEFORE post-gen mutates the row in place.
  const continueRow = args.input.mode === 'continue' ? findContinueRow(args.state) : undefined
  try {
    const postGen = await runServerPostGeneration(args.state, {
      completionText: args.completionText,
      generationId: args.generationId,
      generationInfo: args.generationInfo,
      promptInfo: args.promptInfo,
    })
    const resolved = resolveInlineGenerationMessage({
      state: args.state,
      input: args.input,
      generationId: args.generationId,
      finalText: postGen.finalText,
      generationInfo: args.generationInfo,
      promptInfo: args.promptInfo,
    })
    return {
      postGen,
      message: resolved.message,
      targetMessageId: resolved.targetMessageId,
      chatVarMutations: postGen.mutations.chatVarMutations,
    }
  } catch {
    // Derivation threw: persist the raw provider text so the result is not lost.
    const raw = buildRawModeMessage({
      input: args.input,
      continueRow,
      text: args.completionText,
      generationId: args.generationId,
      generationInfo: args.generationInfo,
      promptInfo: args.promptInfo,
    })
    return { message: raw.message, targetMessageId: raw.targetMessageId, chatVarMutations: [] }
  }
}

/** Fold the post-gen derivation outputs onto the terminal `postGeneration` frame. */
function buildPostGenerationFrameBody(
  revision: number,
  postGen: Awaited<ReturnType<typeof runServerPostGeneration>> | undefined,
): PostGenerationFrame {
  const frame: PostGenerationFrame = { revision }
  if (postGen) {
    if (postGen.textChanged) frame.finalText = postGen.finalText
    if (
      postGen.mutations.chatVarMutations.length > 0 ||
      postGen.mutations.messageMutations.length > 0
    ) {
      frame.messagePatch = postGen.mutations
    }
    if (postGen.resendChat) frame.resendChat = true
  }
  return frame
}

/**
 * Slice 4 (A2) + lazy-projection Phase 3: run the server post-generation pass
 * over the provider's completion text, persist the result SERVER-SIDE, and build
 * the `done.postGeneration` frame. Runs the run-var pass, the `'output'` trigger,
 * and `editoutput` (`runServerPostGeneration`), then persists the derived
 * assistant message + post-gen chat-var delta in one mutation
 * (`persistServerGenerationResult` — same shape + `generation.persisted` event as
 * the durable path), and surfaces the final text / delta / resend / bumped
 * revision for the browser.
 *
 * Phase 3 makes the server the sole author of generation results: this inline
 * path (continue / regenerate) now owns the message write the browser used to do
 * via the `/generation-result` command (B2). A derivation failure persists the
 * RAW provider text best-effort (mode-correct target) rather than losing it, then
 * still terminates cleanly; a persist failure (chat changed) is swallowed and the
 * browser keeps its optimistic copy.
 */
async function buildPostGenerationFrame(args: {
  state: NonNullable<Parameters<typeof runServerPostGeneration>[0]>
  db: DatabaseSync
  dataDir: string
  eventSink: CommandEventSink
  input: AssembleInput
  completionText: string
  generationId: string
  generationInfo: Record<string, unknown>
  promptInfo?: Record<string, unknown>
}): Promise<PostGenerationFrame | undefined> {
  const { postGen, message, targetMessageId, chatVarMutations } = await resolvePostGenerationResult({
    state: args.state,
    input: args.input,
    completionText: args.completionText,
    generationId: args.generationId,
    generationInfo: args.generationInfo,
    promptInfo: args.promptInfo,
  })

  let revision: number
  try {
    revision = persistServerGenerationResult({
      db: args.db,
      dataDir: args.dataDir,
      eventSink: args.eventSink,
      chatId: args.input.chatId,
      message,
      chatVarMutations,
      targetMessageId,
    })
  } catch {
    // Chat changed / gone during persist: leave the browser's optimistic copy
    // and terminate cleanly (no frame).
    return undefined
  }

  return buildPostGenerationFrameBody(revision, postGen)
}

/**
 * Phase 7-11g: stream the assembled prompt. The SSE head is written
 * up front, so every assembly failure (bad IDs, missing database, a
 * trigger/overflow `stopSending`) is a terminal `error` event rather
 * than an HTTP status — body validation already returned 400 before we
 * committed to streaming. Provider dispatch lands with later 7-12d
 * slices. Phase 9 C-A1 persists the assembly-time chat-var delta itself
 * (`persistAssemblyChatVars`) and returns the bumped revision on the `info`
 * frame; the browser keeps the `message_patch` for its projection but no
 * longer replays the delta as a command.
 */
async function streamAssembly(
  req: FastifyRequest,
  reply: FastifyReply,
  db: DatabaseSync,
  input: AssembleInput,
  dataDir: string,
  eventSink: CommandEventSink,
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
      const deps = loadDatabaseDeps(dataDir, db)
      const result = await assemblePrompt(input, deps)
      const database = deps.getDatabase()
      const promptMs = Date.now() - startedAt
      // C-A1 + slice 3b sub-slice 4: the route owns the assembly-time chat-var
      // write and the post-`editinput` submit-transcript write for persisting
      // modes (preview / preview_prompt stay read-only). This runs for both the
      // success and the trigger/overflow `stopSending` branches because the
      // browser used to replay the delta in both — dropping the replay without
      // persisting here would lose the write on an aborted send.
      const persistedRevision =
        isPersistingMode(input.mode) && result.mutations
          ? persistAssemblyMutations({
              db,
              dataDir,
              eventSink,
              input,
              mutations: result.mutations,
              submitMessages: result.submitMessages,
              submitTranscriptChanged: result.submitTranscriptChanged,
            })
          : undefined
      if (!result.stopSending && result.prompt) {
        const successfulResult: SuccessfulAssembleResult = {
          ...result,
          stopSending: false,
          prompt: result.prompt,
        }
        const generationId = randomUUID()
        const shouldDispatch = shouldDispatchProvider(input, database, options)
        const generationInfo =
          shouldDispatch && database
            ? createGenerationInfo(database, generationId, successfulResult, promptMs)
            : undefined
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
          generationId: shouldDispatch ? generationId : undefined,
          generationInfo,
          // C-A1: present only when a chat-var write actually persisted, so the
          // browser reconciles its cached command revision; omitted otherwise.
          revision: persistedRevision,
        })
        if (shouldDispatch && database && generationInfo) {
          const dispatchProvider =
            options.dispatchProvider ??
            ((context: ChatProviderDispatchContext) =>
              dispatchChatProvider({
                database: context.database,
                formated: context.result.formated ?? context.result.prompt.formated ?? [],
                outputTokens: context.result.outputTokens,
                signal: context.signal,
              }))
          const providerStartedAt = Date.now()
          let frames: AsyncIterable<CompletionStreamFrame> | null | undefined
          try {
            frames = await dispatchProvider({
              input,
              result: successfulResult,
              database,
              generationId,
              generationInfo,
              signal,
            })
          } catch (err) {
            emit({
              type: 'error',
              error: errorMessage(err, 'provider dispatch failed'),
              restoration: successfulResult.restoration,
            })
            emit({ type: 'done', generationId, generationInfo })
            terminalDoneEmitted = true
          }
          if (frames) {
            const transportResult = await emitProviderChunks(frames, emit, signal, {
              doneMetadata: () => {
                const stageTiming = generationInfo.stageTiming as
                  | Record<string, unknown>
                  | undefined
                if (stageTiming) {
                  stageTiming.stage3 = Date.now() - providerStartedAt
                }
                return { generationId, generationInfo }
              },
              sideEffects: (text) =>
                database.ttsAutoSpeech
                  ? [
                      {
                        type: 'side_effect',
                        kind: 'tts',
                        payload: { text, characterId: input.characterId },
                      },
                    ]
                  : [],
              errorRestoration: () => successfulResult.restoration,
              postGeneration: (completionText) =>
                successfulResult.state
                  ? buildPostGenerationFrame({
                      state: successfulResult.state,
                      db,
                      dataDir,
                      eventSink,
                      input,
                      completionText,
                      generationId,
                      generationInfo,
                      promptInfo: successfulResult.prompt.promptInfo,
                    })
                  : Promise.resolve(undefined),
            })
            terminalDoneEmitted = transportResult.status !== 'aborted'
          }
        }
      } else {
        if (result.mutations) {
          emit({ type: 'message_patch', patch: result.mutations })
        }
        emit({
          type: 'error',
          error:
            result.abortReason === 'overflow'
              ? 'prompt exceeds the context budget'
              : 'prompt assembly was stopped by a trigger',
          restoration: result.restoration,
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

// ── Durable generation (Milestone 1): decoupled lifecycle + server-owned result ──
//
// For a `durable` send (browser `resolveDurableGeneration === 'durable'` →
// `body.durable === true`, mode `send`), the generation runs as a detached
// `JobRegistry` job whose lifecycle is **not** tied to the request connection:
// dropping the connection detaches a viewer, the job keeps generating, buffers,
// and is reattachable; at completion the server runs the A2 post-gen pass and
// persists the derived assistant message + scriptstate delta itself (no browser
// replay). See `docs/durable-generation/steps/step-2-lifecycle-decoupling.md`
// and `step-3-server-owned-result-persistence.md`.

/** The active-writer identity carried on the `/chat` request (captured at job creation). */
function readWriterSessionHeader(req: FastifyRequest): string | null {
  const raw = req.headers[ACTIVE_WRITER_SESSION_HEADER]
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

/** An SSE-backed `JobClient`: writes raw frame strings to the reply's raw socket. */
function makeSseJobClient(reply: FastifyReply): JobClient {
  return {
    send(text) {
      if (!reply.raw.writableEnded) reply.raw.write(text)
    },
    close() {
      try {
        if (!reply.raw.writableEnded) reply.raw.end()
      } catch {
        // ignore
      }
    },
    get open() {
      return !reply.raw.writableEnded
    },
  }
}

/**
 * Attach a request connection as a **viewer** of a generation job over SSE: write
 * the event-stream head, send the `job_accepted` frame (so a drop during assembly
 * is reattachable), flush the job's buffered events, then stream live. A client
 * disconnect **detaches** the viewer (does NOT abort the job — that is the core
 * inversion). Used by both the initial `POST` and the reattach `GET`.
 */
function attachGenerationViewer(
  req: FastifyRequest,
  reply: FastifyReply,
  registry: GenerationJobRegistry,
  job: StreamJob,
): void {
  reply.hijack()
  reply.raw.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  })
  const client = makeSseJobClient(reply)
  client.send(formatPromptChatFrame({ type: 'job_accepted', jobId: job.id }))
  registry.registry.attach(job.id, client)
  req.raw.once('close', () => registry.registry.detach(job.id, client))
  // Reattach to an already-completed (in-grace) job: `attach` just flushed the
  // buffered terminal frame, and the runner's finally already ran (it cannot close
  // this late viewer), so close + detach here. Otherwise the socket and the job
  // would dangle until the client hangs up (the job is `done` with one client, which
  // neither GC branch collects).
  if (job.done) {
    client.close()
    registry.registry.detach(job.id, client)
  }
}

/** Build a `char` assistant message in the shape `dispatchPersistGenerationResult` persists. */
function buildAssistantMessage(args: {
  data: string
  generationId: string
  characterId: string
  generationInfo: Record<string, unknown>
  promptInfo?: Record<string, unknown>
}): Message {
  return {
    role: 'char',
    data: args.data,
    chatId: args.generationId,
    saying: args.characterId,
    time: Date.now(),
    generationInfo: args.generationInfo,
    ...(args.promptInfo ? { promptInfo: args.promptInfo } : {}),
  } as Message
}

/**
 * The assistant row `runServerPostGeneration` appended to the assembler-state chat
 * (carrying the post-gen-derived final text + generation metadata), deep-cloned so
 * it can be written into the freshly-read current chat. Falls back to a constructed
 * row if not found (defensive — a `send` always appends, keyed by `generationId`).
 */
function extractAssistantMessage(
  state: AssemblyState,
  generationId: string,
  finalText: string,
  generationInfo: Record<string, unknown>,
  promptInfo?: Record<string, unknown>,
): Message {
  const row = (state.currentChat.message ?? []).find((message) => message.chatId === generationId)
  if (row) return structuredClone(row) as Message
  return buildAssistantMessage({
    data: finalText,
    generationId,
    characterId: state.currentChar.chaId,
    generationInfo,
    promptInfo,
  })
}

/**
 * Step 3 (A2 / EC-D1 persistence half): write the durable generation result. In a
 * single `applyJsonCommandMutation` (one revision bump, one event, rollback on
 * failure) against the **freshly read current chat** (gotcha C — composes with any
 * intervening edits): apply the post-gen scriptstate delta, then append/replace the
 * assistant message. The message write is **idempotent on `generationId`** (gotcha B):
 * an existing row with the same `chatId` is replaced in place, never appended twice.
 * Matches the shape + `generation.persisted` event the browser command path
 * (`dispatchPersistGenerationResult` → the `/generation-result` route) produces, so
 * the result is byte-identical whether server- or (legacy) browser-written.
 */
function persistServerGenerationResult(args: {
  db: DatabaseSync
  dataDir: string
  eventSink: CommandEventSink
  chatId: string
  message: Message
  chatVarMutations: AssembleMutationPayload['chatVarMutations']
  /**
   * Continue/regenerate target. When set, the result REPLACES the existing
   * message at this id (the regenerate target, or the continue row) rather than
   * appending/replacing by the result's own `chatId` — identical semantics to
   * the legacy browser `/generation-result` command (`lookupMessageId`). `send`
   * leaves it unset and appends by `generationId`.
   */
  targetMessageId?: string
}): number {
  const patch: Record<string, string | number | boolean> = {}
  const deleteKeys: string[] = []
  for (const mutation of args.chatVarMutations) {
    if (mutation.after === null) {
      deleteKeys.push(mutation.key)
    } else {
      patch[mutation.key] = mutation.after
    }
  }
  const { revision: baseRevision } = getSchemaState(args.db)
  const result = applyJsonCommandMutation<{ chatId: string; messageId: string }>({
    db: args.db,
    dataDir: args.dataDir,
    baseRevision,
    eventSink: args.eventSink,
    mutate(database) {
      const characters = normalizeAllChatMessages(database)
      const { character, chat, messages } = requireChatMessages(characters, args.chatId)
      if (Object.keys(patch).length > 0 || deleteKeys.length > 0) {
        chat.scriptstate ??= {}
        for (const key of deleteKeys) {
          delete chat.scriptstate[key]
        }
        Object.assign(chat.scriptstate, patch)
        if (Object.keys(chat.scriptstate).length === 0) {
          delete chat.scriptstate
        }
      }
      const record = createMessageRecord(structuredClone(args.message), 'generationResult.message')
      const messageId = record.chatId
      const lookupMessageId = args.targetMessageId ?? messageId
      const existingIndex = messages.findIndex((message) => message.chatId === lookupMessageId)
      const existing = existingIndex === -1 ? undefined : messages[existingIndex]
      if (messageIdExists(characters, messageId, { excludeMessage: existing })) {
        throw new ValidationError(`Duplicate message id: ${messageId}`)
      }
      if (existingIndex === -1) {
        if (args.targetMessageId) {
          throw new EntityNotFoundError(
            `Message not found for chat ${args.chatId}: ${args.targetMessageId}`,
          )
        }
        messages.push(record)
      } else {
        messages[existingIndex] = record
      }
      validateUniqueMessageIds(messages)
      // Phase 6c — the reroll buffer ("don't lose a rerolled result"):
      //  - regenerate (`targetMessageId` set) REPLACES a candidate; preserve BOTH the
      //    one it displaces AND the new one it produces as alternate rows, so the
      //    full candidate set of the turn survives a reload and swipe-navigation is
      //    durable for free (flipping the active tail never touches the buffer — the
      //    active is just whichever candidate is positioned, matched by `uid` on
      //    hydration). This realizes the design doc's "insert the new candidate as an
      //    alternate row and flip the active tail". Dedup by `uid` keeps it
      //    replay-idempotent and free of duplicates as candidates accumulate.
      //  - send / continue is the confirm boundary — drop the chat's reroll buffer.
      // Both run inside this mutation's transaction (atomic with the message write).
      const displaced =
        args.targetMessageId && existing ? (structuredClone(existing) as Message) : undefined
      const preserved = args.targetMessageId ? (structuredClone(record) as Message) : undefined
      const sqlite = (db: DatabaseSync): void => {
        if (args.targetMessageId) {
          if (displaced) addAlternateMessage(db, args.chatId, displaced)
          if (preserved) addAlternateMessage(db, args.chatId, preserved)
        } else {
          clearAlternateMessages(db, args.chatId)
        }
      }
      return {
        event: {
          ...COMMAND_EVENT_CATALOG.generationPersisted,
          id: messageId,
          parentId: args.chatId,
        },
        extra: { chatId: args.chatId, messageId },
        sqlite,
      }
    },
  })
  return result.revision
}

/**
 * Step 3 + Phase 6b: the durable-job post-generation pass. Runs the A2 server
 * derivation (`runServerPostGeneration`: run-var pass + `'output'` trigger +
 * `editoutput`), then persists the **derived** assistant message + post-gen
 * scriptstate delta server-side (mode-aware via the shared
 * `resolvePostGenerationResult` — `send` appends, `continue` extends the last row
 * in place, `regenerate` replaces the target) and folds the bumped revision /
 * final text / resend onto the `done` frame so the (possibly reattached) browser
 * reconciles without persisting.
 *
 * Failure policy (the only divergence from the inline `buildPostGenerationFrame`):
 *  - **derivation throws** (gotcha F): the client may be gone, so "browser keeps its
 *    copy" is unsafe — persist the **raw** provider text and emit a `warning`.
 *  - **persist throws** (gotcha C — chat deleted / materially changed): record a job
 *    `error` the reattaching client sees; do not force-write.
 */
async function buildDurablePostGeneration(args: {
  emit: (event: PromptChatEvent) => void
  state: AssemblyState
  db: DatabaseSync
  dataDir: string
  eventSink: CommandEventSink
  input: AssembleInput
  completionText: string
  generationId: string
  generationInfo: Record<string, unknown>
  promptInfo?: Record<string, unknown>
}): Promise<PostGenerationFrame | undefined> {
  const { postGen, message, targetMessageId, chatVarMutations } = await resolvePostGenerationResult({
    state: args.state,
    input: args.input,
    completionText: args.completionText,
    generationId: args.generationId,
    generationInfo: args.generationInfo,
    promptInfo: args.promptInfo,
  })

  let revision: number
  try {
    revision = persistServerGenerationResult({
      db: args.db,
      dataDir: args.dataDir,
      eventSink: args.eventSink,
      chatId: args.input.chatId,
      message,
      chatVarMutations,
      targetMessageId,
    })
  } catch (err) {
    args.emit({ type: 'error', error: errorMessage(err, 'failed to persist the generation result') })
    return undefined
  }

  // `postGen === undefined` means the derivation threw: the client may be gone, so
  // warn rather than silently keep an optimistic copy (the inline path's choice).
  if (!postGen) {
    args.emit({
      type: 'warning',
      message: 'server post-generation derivation failed; persisted the raw provider text.',
    })
    return { revision }
  }

  return buildPostGenerationFrameBody(revision, postGen)
}

/**
 * Step 2 gotcha B / E + Phase 6b: on a **streaming** cancel persist the
 * accumulated-so-far provider text **raw** (no post-gen pass over a truncated
 * turn), mode-aware via `buildRawModeMessage` (`continue` extends the captured row
 * in place, `regenerate` replaces the target, `send` appends) and idempotent on
 * `generationId`. A non-streaming cancel (no accumulated text) persists nothing.
 * A chat-changed failure during a cancel is swallowed (the job is aborted and there
 * is no connected client to notify).
 */
function persistRawCancelledResult(args: {
  db: DatabaseSync
  dataDir: string
  eventSink: CommandEventSink
  state: AssemblyState
  input: AssembleInput
  generationId: string
  generationInfo: Record<string, unknown>
  promptInfo?: Record<string, unknown>
  text: string
}): void {
  const continueRow = args.input.mode === 'continue' ? findContinueRow(args.state) : undefined
  const raw = buildRawModeMessage({
    input: args.input,
    continueRow,
    text: args.text,
    generationId: args.generationId,
    generationInfo: args.generationInfo,
    promptInfo: args.promptInfo,
  })
  try {
    persistServerGenerationResult({
      db: args.db,
      dataDir: args.dataDir,
      eventSink: args.eventSink,
      chatId: args.input.chatId,
      message: raw.message,
      chatVarMutations: [],
      targetMessageId: raw.targetMessageId,
    })
  } catch {
    // Chat gone / changed during a cancel: nothing to do (job aborted, no client).
  }
}

/**
 * Step 2: the detached generation runner. Mirrors `streamAssembly`'s assemble →
 * dispatch → done flow but (1) pushes the identical SSE frames into the job's
 * `JobRegistry` buffer (`pushRaw`) instead of a request reply, (2) runs on the
 * job's own `AbortController` (deadline / explicit cancel only — never the request
 * connection), and (3) at completion runs the A2 pass + persists the result
 * server-side (Step 3). Launched fire-and-forget (`void`); the request connection
 * is just a viewer.
 */
async function runGenerationJob(args: {
  registry: GenerationJobRegistry
  job: StreamJob
  db: DatabaseSync
  input: AssembleInput
  dataDir: string
  eventSink: CommandEventSink
  options: GenerationChatRouteOptions
}): Promise<void> {
  const { registry, job, db, input, dataDir, eventSink, options } = args
  const emit = (event: PromptChatEvent): void =>
    registry.registry.pushRaw(job, formatPromptChatFrame(event))
  const signal = job.abortController.signal
  const generationId = job.id
  let terminalDoneEmitted = false
  try {
    emit({ type: 'stage', stage: 'validate', status: 'start' })
    emit({ type: 'stage', stage: 'validate', status: 'end' })
    emit({ type: 'stage', stage: 'prompt', status: 'start' })

    try {
      const startedAt = Date.now()
      const deps = loadDatabaseDeps(dataDir, db)
      const result = await assemblePrompt(input, deps)
      const database = deps.getDatabase()
      const promptMs = Date.now() - startedAt
      const persistedRevision =
        isPersistingMode(input.mode) && result.mutations
          ? persistAssemblyMutations({
              db,
              dataDir,
              eventSink,
              input,
              mutations: result.mutations,
              submitMessages: result.submitMessages,
              submitTranscriptChanged: result.submitTranscriptChanged,
            })
          : undefined
      if (!result.stopSending && result.prompt) {
        const successfulResult: SuccessfulAssembleResult = {
          ...result,
          stopSending: false,
          prompt: result.prompt,
        }
        const shouldDispatch = shouldDispatchProvider(input, database, options)
        const generationInfo =
          shouldDispatch && database
            ? createGenerationInfo(database, generationId, successfulResult, promptMs)
            : undefined
        emit({ type: 'prompt', ...result.prompt })
        if (result.mutations) {
          emit({ type: 'message_patch', patch: result.mutations })
        }
        emit({ type: 'stage', stage: 'prompt', status: 'end' })
        emit({
          type: 'info',
          timings: { prompt: promptMs },
          tokens: { prompt: result.inputTokens, total: result.inputTokens },
          responseBudget: result.outputTokens,
          generationId: shouldDispatch ? generationId : undefined,
          generationInfo,
          revision: persistedRevision,
        })
        if (shouldDispatch && database && generationInfo) {
          const dispatchProvider =
            options.dispatchProvider ??
            ((context: ChatProviderDispatchContext) =>
              dispatchChatProvider({
                database: context.database,
                formated: context.result.formated ?? context.result.prompt.formated ?? [],
                outputTokens: context.result.outputTokens,
                signal: context.signal,
              }))
          const providerStartedAt = Date.now()
          let frames: AsyncIterable<CompletionStreamFrame> | null | undefined
          try {
            frames = await dispatchProvider({
              input,
              result: successfulResult,
              database,
              generationId,
              generationInfo,
              signal,
            })
          } catch (err) {
            emit({
              type: 'error',
              error: errorMessage(err, 'provider dispatch failed'),
              restoration: successfulResult.restoration,
            })
            emit({ type: 'done', generationId, generationInfo })
            terminalDoneEmitted = true
          }
          if (frames) {
            const transportResult = await emitProviderChunks(frames, emit, signal, {
              doneMetadata: () => {
                const stageTiming = generationInfo.stageTiming as
                  | Record<string, unknown>
                  | undefined
                if (stageTiming) {
                  stageTiming.stage3 = Date.now() - providerStartedAt
                }
                return { generationId, generationInfo }
              },
              sideEffects: (text) =>
                database.ttsAutoSpeech
                  ? [
                      {
                        type: 'side_effect',
                        kind: 'tts',
                        payload: { text, characterId: input.characterId },
                      },
                    ]
                  : [],
              errorRestoration: () => successfulResult.restoration,
              postGeneration: (completionText) => {
                if (!successfulResult.state) return Promise.resolve(undefined)
                // Stamp stage3 BEFORE the persist so the server-written message's
                // generationInfo carries it (the persist runs ahead of doneMetadata,
                // which would otherwise set it only on the wire `done` frame).
                const stageTiming = generationInfo.stageTiming as
                  | Record<string, unknown>
                  | undefined
                if (stageTiming) stageTiming.stage3 = Date.now() - providerStartedAt
                return buildDurablePostGeneration({
                  emit,
                  state: successfulResult.state,
                  db,
                  dataDir,
                  eventSink,
                  input,
                  completionText,
                  generationId,
                  generationInfo,
                  promptInfo: successfulResult.prompt.promptInfo,
                })
              },
            })
            terminalDoneEmitted = transportResult.status !== 'aborted'
            if (transportResult.status === 'aborted') {
              // Step 2 gotcha E: a streaming cancel persists the accumulated-so-far text.
              if (transportResult.result.length > 0 && successfulResult.state) {
                persistRawCancelledResult({
                  db,
                  dataDir,
                  eventSink,
                  state: successfulResult.state,
                  input,
                  generationId,
                  generationInfo,
                  promptInfo: successfulResult.prompt.promptInfo,
                  text: transportResult.result,
                })
              }
              // Emit a terminal frame so a *reattached* observer's stream ends cleanly
              // (the canceller already aborted its own reader). `emitProviderChunks`
              // emits nothing on abort, so without this a viewer sees the stream cut
              // with no done/error and reports a spurious "stream ended" error.
              emit({ type: 'done', result: transportResult.result, generationId, generationInfo })
              terminalDoneEmitted = true
            }
          }
        }
      } else {
        if (result.mutations) {
          emit({ type: 'message_patch', patch: result.mutations })
        }
        emit({
          type: 'error',
          error:
            result.abortReason === 'overflow'
              ? 'prompt exceeds the context budget'
              : 'prompt assembly was stopped by a trigger',
          restoration: result.restoration,
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
  } finally {
    // Clear the submission lock + mark done at completion/cancel (not at GC), so the
    // chat accepts a new send immediately while the done job lingers for reattach.
    if (job.chatId) registry.clearRunning(job.chatId, job.id)
    registry.registry.markDone(job)
    // End the live viewer connections now that the terminal frame is delivered — the
    // viewer has everything, so the request lifecycle completes without waiting for the
    // client to hang up. A client that dropped *before* completion left no viewer here,
    // so its tail stays buffered for a reattach within the 30s grace.
    for (const client of [...job.clients]) {
      try {
        client.close()
      } catch {
        // ignore
      }
    }
  }
}

/**
 * Step 2: accept a durable send. Enforce one-running-job-per-chat (the active-writer
 * submission gate is already enforced by the global guard preHandler), create the
 * job + claim the submission lock + capture the writer identity, attach this
 * connection as the first viewer, then launch the detached runner.
 */
function startDurableGeneration(args: {
  req: FastifyRequest
  reply: FastifyReply
  db: DatabaseSync
  input: AssembleInput
  dataDir: string
  eventSink: CommandEventSink
  options: GenerationChatRouteOptions
  generationJobs: GenerationJobRegistry
}): void {
  const { req, reply, input, generationJobs } = args
  if (generationJobs.hasRunningJob(input.chatId)) {
    reply.code(409).send({
      error: 'generation_in_progress',
      reason: 'A generation is already running for this chat.',
    })
    return
  }
  const job = generationJobs.registry.create({ timeoutMs: undefined, heartbeatSec: undefined })
  job.chatId = input.chatId
  job.writerSessionId = readWriterSessionHeader(req)
  // Phase 6b: record the generating mode (+ regenerate target) so the reload-resume
  // `activeGenerationJobs` projection lets a reattaching browser render the right shape.
  job.mode = input.mode === 'continue' || input.mode === 'regenerate' ? input.mode : 'send'
  if (input.mode === 'regenerate') job.regenerateMessageId = input.regenerateMessageId
  generationJobs.register(input.chatId, job.id)
  attachGenerationViewer(req, reply, generationJobs, job)
  void runGenerationJob({
    registry: generationJobs,
    job,
    db: args.db,
    input,
    dataDir: args.dataDir,
    eventSink: args.eventSink,
    options: args.options,
  })
}

export function registerGenerationChatRoutes(
  app: FastifyInstance,
  db: DatabaseSync,
  authState: AuthState,
  dataDir: string,
  eventSink: CommandEventSink,
  generationJobs: GenerationJobRegistry,
  options: GenerationChatRouteOptions = {},
): void {
  app.post('/api/v1/generate/chat', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    const body = (req.body ?? {}) as ChatRequestBody
    const validation = validate(body)
    if (validation.ok === false) {
      return badRequest(reply, validation.error)
    }

    const input = toAssembleInput(body)
    // Durable path: a `send` / `continue` / `regenerate` the browser classified
    // durable (Phase 6b widened it past send-only). The active-writer submission
    // gate ran in the global preHandler; here we only add the one-job-per-chat rule
    // and hand off to the detached runner. `isPersistingMode` is exactly the durable
    // mode set (preview / preview_prompt never generate, so never durable).
    if (body.durable === true && isPersistingMode(input.mode)) {
      startDurableGeneration({ req, reply, db, input, dataDir, eventSink, options, generationJobs })
      return
    }

    await streamAssembly(req, reply, db, input, dataDir, eventSink, options)
  })

  // Step 2: reattach to a running (or done-within-grace) durable generation over
  // SSE — observe is open to any authenticated client (no writer lease). A returning
  // client discovers the id from bootstrap `activeGenerationJobs` (reload-resume) or
  // the `job_accepted` / `info` frame. 404 if the job is unknown / GC'd (a completed
  // job is read from `db.json` via the normal projection refresh, EC-D2).
  app.get<{ Params: { id: string } }>(
    '/api/v1/generate/chat/:id/stream',
    async (req, reply) => {
      if (!(await requireAuth(authState, req, reply))) return
      const job = generationJobs.registry.get(req.params.id)
      if (!job) {
        reply.code(404).send({ error: 'Job not found' })
        return
      }
      attachGenerationViewer(req, reply, generationJobs, job)
    },
  )

  // Step 2 gotcha B: explicit cancel. Authorized by the **current** active writer
  // (the global guard preHandler enforces it — including writer handoff, so a new
  // writer can cancel a prior, now-disconnected writer's job). Aborts the provider
  // dispatch; the runner persists the streaming-so-far text (gotcha E) and clears
  // the submission lock. A bare disconnect does NOT cancel (it only detaches).
  app.delete<{ Params: { id: string } }>('/api/v1/generate/chat/:id', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return
    const job = generationJobs.registry.get(req.params.id)
    if (!job) {
      reply.code(404).send({ error: 'Job not found' })
      return
    }
    // Abort only — the runner's finally persists the streaming-so-far text and THEN
    // clears the submission lock. Clearing it here (synchronously, before the
    // async cancel-persist lands) would let an overlapping send for the same chat
    // start and race the cancel write.
    job.abortController.abort()
    return { success: true }
  })

  // 7-11h: one-shot JSON preview. Unlike `/chat` this never opens an SSE
  // stream, so scope errors surface as real HTTP status codes.
  app.post('/api/v1/generate/preview-prompt', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    const body = (req.body ?? {}) as ChatRequestBody
    const validation = validatePreview(body)
    if (validation.ok === false) {
      return badRequest(reply, validation.error)
    }

    const input = toAssembleInput({ ...body, mode: 'preview_prompt' })
    try {
      const result = await assemblePrompt(input, loadDatabaseDeps(dataDir, db))
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
