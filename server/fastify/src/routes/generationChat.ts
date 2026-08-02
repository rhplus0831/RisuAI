import fs from 'node:fs'
import { isDeepStrictEqual } from 'node:util'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { Database, Message } from '../../../../src/ts/storage/database.svelte'
import type { MultiModal, OpenAIChat } from '../../../../src/ts/process/index.svelte'
import { trimUntilPunctuation } from '../../../../src/ts/util/punctuation.js'
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
  loadPersistedForAssembly,
  writeSingleChatRow,
} from '../repository.js'
import {
  assemblePrompt,
  applyRequestTrigger,
  getMessageMutationFirstChangedIndex,
  runServerAlternatePostGeneration,
  runServerPostGeneration,
  type AssembleDeps,
  type AssembleAbortReason,
  type AssembleInput,
  type AssembleMutationPayload,
  type AssembleResult,
  type AssemblyState,
  type PromptAssemblyStage,
} from '../prompt/assemble.js'
import {
  applyProfileBoundGenerationFields,
  buildEffectiveGenerationConfig,
  isChatGenerationSettingsIncompleteAssemblyError,
  isModelProfileGenerationGuardAssemblyError,
} from '../prompt/effectiveGenerationConfig.js'
import type { ResolveStoredAsset, StoredAssetPurpose } from '../prompt/assetLookup.js'
import { normalizeAllCharacterChats, requireChatLocation } from '../commands/chats.js'
import { createMessageRecord, validateUniqueMessageIds } from '../commands/messages.js'
import { COMMAND_EVENT_CATALOG, type CommandEventSink } from '../commands/events.js'
import { applyTargetedCommandMutation } from '../commands/mutations.js'
import {
  addAlternateMessage,
  activeMessageIdExists,
  activeMessageIdExistsInChat,
  activeMessageIdExistsOutsideChat,
  appendActiveChatMessageTail,
  clearAlternateMessages,
  countAlternateMessages,
  countChatMessages,
  getChatMessages,
  replaceActiveChatMessages,
  writeGenerationChatMessage,
} from '../messageStore.js'
import {
  dispatchChatProvider,
  getServerGenerationModelString,
  type ChatDispatchHistoryInput,
} from '../prompt/chatDispatch.js'
import {
  resolveModelProfile,
  type ModelProfileFallbackRef,
  type ResolvedModelProfile,
} from '../../../../src/ts/model/modelProfileResolver.js'
import { risuEscape, risuUnescape } from '../../../../src/ts/parser/risuChatParserHelpers.js'
import { ServerLuaFailureError } from '../prompt/luaRuntime.js'
import { isAgentPresetGenerationError, type AgentPresetProgressReporter } from '../prompt/agentPresetExecution.js'
import { emitProviderChunks, type ProviderPostGenerationResult } from '../prompt/providerTransport.js'
import { promptSummaryMetricFields, summarizePromptRows, type PromptRowsSummary } from '../prompt/promptSummary.js'
import { triggerSourceMetricFields } from '../prompt/triggerSource.js'
import {
  formatPromptChatFrame,
  type PostGenerationFrame,
  type PromptChatEvent,
  type PromptEvent,
} from '../prompt/sseEvents.js'
import { ACTIVE_WRITER_SESSION_HEADER } from '../activeWriter.js'
import { attachAbort } from '../requestAbort.js'
import type { GenerationJobRegistry } from '../generationJobs.js'
import { isStreamDeadlineActivityFrame, type JobClient, type StreamJob } from '../streamJobs.js'
import { getWritableBufferedBytes, writeBoundedRaw } from '../streamBackpressure.js'
import { emitProtocolMetric, protocolDurationMs, protocolMetricsEnabled, protocolNowMs } from '../protocolMetrics.js'
import {
  DEFAULT_GENERATION_TRACE_MAX_GZIP_BYTES,
  generationTraceSidecarMetricField,
  writeGenerationTraceSidecar,
  type GenerationTraceContext,
  type GenerationTraceOptions,
} from '../generation/generationTraceSidecar.js'
import { PostGenerationLuaTraceCollector } from '../prompt/luaPostGenerationTrace.js'
import { PostGenerationLuaProgressTracker } from '../prompt/luaPostGenerationProgress.js'
import {
  deleteGenerationFinalizationRetry,
  enqueueGenerationFinalizationRetry,
  listPendingGenerationFinalizationRetries,
  markGenerationFinalizationRetryFailure,
  type GenerationFinalizationAttempt,
  type GenerationFinalizationMode,
} from '../generationFinalizationRetry.js'
import { generationSubmitRateLimit } from '../routeRateLimits.js'
import { REQUEST_UID_HEADER } from '../requestTrace.js'
import type { ChatCompletionNotificationContext, PushNotificationService } from '../pushNotifications.js'
import type { MessageTranslationJobRegistry } from '../messageTranslationJobs.js'
import {
  emptyPromptMemoryQueryDiagnostics,
  prefetchPromptMemoryQueryVectors,
  type PrefetchPromptMemoryQueryInput,
  type PromptMemoryQueryPrefetchResult,
} from '../promptMemoryQuery.js'
import {
  handleGeneratedChatCompletion,
  type ServerMessageTranslationRunner,
} from '../translation/generationCompletionTranslation.js'

const ALLOWED_MODES = new Set(['send', 'continue', 'preview', 'preview_prompt', 'regenerate'])
const SERVER_INLAY_SIGNATURE_CONTENT_TYPE = 'application/x-risu-inlay-signature+json'
const PROVIDER_DISPATCH_FALLBACK = 'Provider dispatch failed before returning an error message.'

interface ChatRequestBody {
  chatId?: unknown
  characterId?: unknown
  loadoutId?: unknown
  mode?: unknown
  regenerateMessageId?: unknown
  userMessage?: unknown
  syntheticSayNothing?: unknown
  resetMessages?: unknown
  expectedRevision?: unknown
  inlayAssets?: unknown
  inlayAssetRefs?: unknown
  clientCapabilities?: unknown
  durable?: unknown
}

type SuccessfulAssembleResult = AssembleResult & {
  stopSending: false
  prompt: Omit<PromptEvent, 'type'>
}

interface GenerationClientCapabilities {
  compactPromptEvent: boolean
  promptMetadataOnly: boolean
  omitDuplicateDoneResult: boolean
}

type PromptAssemblyRun = Awaited<ReturnType<typeof assemblePromptWithMetrics>>
type MetricPrimitive = string | number | boolean | null | undefined
type PromptAssemblyMetricContext = Record<string, MetricPrimitive>

type AssemblyPreflightResult =
  | { status: 'ready' }
  | { status: 'handled' }
  | { status: 'defer'; failure: AssemblyDeferredFailure }

interface AssemblyDeferredFailure {
  error: unknown
}

export interface ChatProviderDispatchContext {
  input: AssembleInput
  result: SuccessfulAssembleResult
  database: Database
  generationId: string
  generationInfo: Record<string, unknown>
  signal: AbortSignal
  trace?: GenerationTraceContext
  /** Explicit primary/fallback profile selected by the request-policy wrapper. */
  profile?: ResolvedModelProfile
  /** Retry/fallback identity attached by the request-policy wrapper. */
  historyMetadata?: Record<string, unknown>
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
  /** Test/alternate adapter seam; production uses the shared server embedding adapter. */
  embedPromptMemoryQueryTexts?: PrefetchPromptMemoryQueryInput['embed']
  /** Contextual-model counterpart to `embedPromptMemoryQueryTexts`. */
  embedPromptMemoryQueryGroups?: PrefetchPromptMemoryQueryInput['embedGroups']
  /** Bounded query-embedding deadline; defaults to the shared memory-provider deadline. */
  promptMemoryEmbeddingDeadlineMs?: number
  pushNotifications?: false | PushNotificationService
  runMessageTranslation?: ServerMessageTranslationRunner
  finalizationRetry?:
    | false
    | {
        intervalMs?: number
        maxPerSweep?: number
        terminalRetentionMs?: number
        terminalRetentionMaxPerSweep?: number
      }
  /**
   * Cadence of the durable viewer's SSE comment heartbeat.
   * Defaults to the job's `heartbeatSec`; injectable for tests.
   */
  viewerHeartbeatMs?: number
}

export interface GenerationFinalizationRetryLogger {
  warn(obj: Record<string, unknown>, msg: string): void
  error(obj: Record<string, unknown>, msg: string): void
}

function fallbackProfileDatabase(database: Database, profileId: string): Database {
  const cloned = structuredClone(database)
  const bindings = { ...(cloned.modelRoleProfiles ?? {}) } as Record<string, unknown>
  bindings.chatMain = { mode: 'profile', profileId }
  cloned.modelRoleProfiles = bindings as Database['modelRoleProfiles']
  return cloned
}

function resolvePolicyProfiles(database: Database): ResolvedModelProfile[] {
  const primary = resolveModelProfile({ database, role: 'chatMain' })
  const profiles = [primary]
  for (const fallback of primary.fallbacks) {
    try {
      const resolved = resolvePolicyFallback(database, fallback)
      if (
        resolved &&
        !profiles.some((profile) => profile.profileId === resolved.profileId && profile.modelId === resolved.modelId)
      ) {
        profiles.push(resolved)
      }
    } catch {
      // An invalid fallback must not suppress the primary model or later valid fallbacks.
    }
  }
  return profiles
}

function resolvePolicyFallback(database: Database, fallback: ModelProfileFallbackRef): ResolvedModelProfile | null {
  if (fallback.kind === 'legacy-model-id') {
    return resolveModelProfile({ database, role: 'chatMain', staticModel: fallback.modelId })
  }
  return resolveModelProfile({ database: fallbackProfileDatabase(database, fallback.profileId), role: 'chatMain' })
}

function configuredRequestRetries(database: Database): number {
  const value = typeof database.requestRetrys === 'number' ? Math.floor(database.requestRetrys) : 0
  return Math.max(0, Math.min(value, 20))
}

function materializePolicyProfileDatabase(
  database: Database,
  profile: ResolvedModelProfile,
  forceNonStreaming: boolean,
): Database {
  const effective = structuredClone(database)
  applyProfileBoundGenerationFields(effective, profile)
  if (forceNonStreaming) effective.useStreaming = false
  return effective
}

function markPolicyProfileSuccess(
  context: ChatProviderDispatchContext,
  database: Database,
  profile: ResolvedModelProfile,
): void {
  context.generationInfo.model = getServerGenerationModelString(database, profile)
  if (typeof database.maxContext === 'number') context.generationInfo.maxContext = database.maxContext
}

function containsBannedScript(text: string, scripts: unknown): boolean {
  if (!Array.isArray(scripts) || text.length === 0) return false
  for (const script of scripts) {
    if (typeof script !== 'string' || script.length === 0) continue
    try {
      if (new RegExp(`\\p{Script=${script}}`, 'u').test(text)) return true
    } catch {
      // Ignore invalid Unicode script names retained in imported settings.
    }
  }
  return false
}

function escapedRows(rows: OpenAIChat[], escape: boolean): OpenAIChat[] {
  const cloned = structuredClone(rows)
  if (!escape) return cloned
  for (const row of cloned) row.content = risuUnescape(row.content)
  return cloned
}

function transformEscapedFrames(frames: CompletionStreamFrame[], escape: boolean): CompletionStreamFrame[] {
  if (!escape) return frames
  return frames.map((frame) =>
    frame.kind === 'token'
      ? { ...frame, content: risuEscape(frame.content ?? '') }
      : frame.kind === 'done' && frame.alternates
        ? { ...frame, alternates: frame.alternates.map(risuEscape) }
        : frame,
  )
}

/**
 * Retained request wrapper policies around the server-owned provider dispatch.
 * Streaming remains live after the first token; failures before that boundary
 * can be retried safely. Non-stream results are buffered so blank/banned-output
 * policies can decide before anything reaches the client.
 */
function dispatchProviderWithPolicies(
  context: ChatProviderDispatchContext,
  dispatcher: ChatProviderDispatcher,
): AsyncIterable<CompletionStreamFrame> {
  return (async function* () {
    const state = context.result.state
    const escape = state?.currentChar.escapeOutput === true
    // Accepted divergence (OR-3): unlike baseline request.ts:222, each same-model
    // retry starts from these untransformed rows instead of accumulating request
    // trigger rewrites from the preceding attempt.
    const baseRows = escapedRows(context.result.formated ?? context.result.prompt.formated ?? [], escape)
    const policyDatabase = context.database
    const profiles = resolvePolicyProfiles(policyDatabase)
    const retries = configuredRequestRetries(policyDatabase)
    const requiresBufferedInspection =
      escape ||
      (Array.isArray(policyDatabase.banCharacterset) && policyDatabase.banCharacterset.length > 0) ||
      (policyDatabase.fallbackWhenBlankResponse === true && profiles.length > 1)
    let lastFailure: CompletionStreamFrame | undefined

    for (let profileIndex = 0; profileIndex < profiles.length; profileIndex++) {
      const profile = profiles[profileIndex]
      // Assembly already materialized the primary profile and then applied the
      // chat prompt preset's explicit overrides. Reapplying it here would erase
      // those final overrides; only fallback profiles need fresh materialization.
      const database =
        profileIndex === 0
          ? escape
            ? ({ ...policyDatabase, useStreaming: false } as Database)
            : policyDatabase
          : materializePolicyProfileDatabase(policyDatabase, profile, escape)
      for (let attempt = 0; attempt <= retries; attempt++) {
        if (context.signal.aborted) return
        const requestRows = state
          ? await applyRequestTrigger(state, structuredClone(baseRows))
          : structuredClone(baseRows)
        const attemptContext: ChatProviderDispatchContext = {
          ...context,
          database,
          profile,
          historyMetadata: {
            attempt: attempt + 1,
            retryCount: retries,
            fallbackIndex: profileIndex,
            fallbackCount: profiles.length - 1,
          },
          result: {
            ...context.result,
            outputTokens: context.result.outputTokens,
            formated: requestRows,
            prompt: { ...context.result.prompt, formated: requestRows },
          },
        }
        let iterable: AsyncIterable<CompletionStreamFrame> | null | undefined
        try {
          iterable = await dispatcher(attemptContext)
        } catch (error) {
          lastFailure = {
            kind: 'error',
            error: errorMessage(error, PROVIDER_DISPATCH_FALLBACK),
            reason: 'provider_dispatch_exception',
          }
          continue
        }
        if (!iterable) {
          lastFailure = { kind: 'error', error: PROVIDER_DISPATCH_FALLBACK }
          continue
        }

        if (!requiresBufferedInspection) {
          let emittedToken = false
          let retry = false
          try {
            for await (const frame of iterable) {
              if (frame.kind === 'token') {
                emittedToken = true
                markPolicyProfileSuccess(context, database, profile)
                yield frame
                continue
              }
              if (frame.kind === 'error' && !emittedToken) {
                lastFailure = frame
                if (frame.nonRetryable === true) {
                  yield frame
                  return
                }
                retry = true
                break
              }
              if (
                frame.kind === 'done' &&
                !emittedToken &&
                database.fallbackWhenBlankResponse === true &&
                profileIndex < profiles.length - 1
              ) {
                retry = true
                attempt = retries
                break
              }
              if (frame.kind === 'done') markPolicyProfileSuccess(context, database, profile)
              yield frame
              if (frame.kind === 'done' || frame.kind === 'error') return
            }
          } catch (error) {
            const failure: CompletionStreamFrame = {
              kind: 'error',
              error: errorMessage(error, PROVIDER_DISPATCH_FALLBACK),
              reason: 'provider_dispatch_exception',
            }
            if (emittedToken) {
              throw error
            }
            lastFailure = failure
            retry = true
          }
          if (!retry) return
          continue
        }

        const buffered: CompletionStreamFrame[] = []
        let text = ''
        let failed = false
        try {
          for await (const frame of iterable) {
            buffered.push(frame)
            if (frame.kind === 'token') text += frame.content ?? ''
            if (frame.kind === 'error') {
              lastFailure = frame
              failed = true
              break
            }
          }
        } catch (error) {
          lastFailure = { kind: 'error', error: errorMessage(error, PROVIDER_DISPATCH_FALLBACK) }
          failed = true
        }
        if (failed) {
          if (lastFailure?.kind === 'error' && lastFailure.nonRetryable === true) {
            yield lastFailure
            return
          }
          continue
        }

        const transformed = transformEscapedFrames(buffered, escape)
        const transformedText = escape ? risuEscape(text) : text
        if (containsBannedScript(transformedText, database.banCharacterset)) {
          lastFailure = {
            kind: 'error',
            error: 'Provider response contained a banned character set after all configured retries.',
            reason: 'provider_output_banned',
          }
          continue
        }
        if (
          transformedText.trim().length === 0 &&
          database.fallbackWhenBlankResponse === true &&
          profileIndex < profiles.length - 1
        ) {
          attempt = retries
          continue
        }
        markPolicyProfileSuccess(context, database, profile)
        yield* transformed
        return
      }
    }

    yield lastFailure ?? { kind: 'error', error: 'All configured models failed.' }
  })()
}

interface GenerationFinalizationSnapshotRow {
  message: Message
}

export type GenerationFinalizationTargetSnapshot =
  | {
      mode: GenerationFinalizationMode
      kind: 'tail'
      transcriptLength: number
      tail?: GenerationFinalizationSnapshotRow
    }
  | {
      mode: GenerationFinalizationMode
      kind: 'target-tail'
      transcriptLength: number
      target: GenerationFinalizationSnapshotRow
    }

function badRequest(reply: FastifyReply, error: string): void {
  reply.code(400).send({ error })
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readClientCapabilities(body: ChatRequestBody): GenerationClientCapabilities {
  const clientCapabilities = body.clientCapabilities
  return {
    compactPromptEvent: isRecord(clientCapabilities) && clientCapabilities.compactPromptEvent === true,
    promptMetadataOnly: isRecord(clientCapabilities) && clientCapabilities.promptMetadataOnly === true,
    omitDuplicateDoneResult: isRecord(clientCapabilities) && clientCapabilities.omitDuplicateDoneResult === true,
  }
}

function promptEventForClient(
  prompt: Omit<PromptEvent, 'type'>,
  capabilities: GenerationClientCapabilities,
  mode?: AssembleInput['mode'],
): Omit<PromptEvent, 'type'> {
  if (!capabilities.compactPromptEvent) return prompt
  if (mode === 'preview_prompt') {
    const promptText = prompt.promptInfo?.promptText
    const previewRows =
      Array.isArray(promptText) && promptText.length > 0
        ? promptText
        : Array.isArray(prompt.formated)
          ? prompt.formated
          : (prompt.messages ?? [])
    return {
      promptInfo: {
        promptText: typeof promptText === 'string' ? promptText : JSON.stringify(previewRows),
      },
    }
  }
  const { messages: _messages, lorebookActivation: _lorebookActivation, ...compactPrompt } = prompt
  if (capabilities.promptMetadataOnly && mode !== undefined && isPersistingMode(mode)) {
    return compactPrompt.promptInfo === undefined ? {} : { promptInfo: compactPrompt.promptInfo }
  }
  return compactPrompt
}

function emitAssemblyWarnings(result: AssembleResult, emit: (event: PromptChatEvent) => void): void {
  for (const warning of result.warnings ?? []) {
    emit({ type: 'warning', ...warning })
  }
}

function messagePatchForClient(
  mutations: AssembleMutationPayload,
  capabilities: GenerationClientCapabilities,
): AssembleMutationPayload {
  if (!capabilities.compactPromptEvent) return mutations
  let changed = false
  const messageMutations = mutations.messageMutations.map((mutation) => {
    if (mutation.type !== 'replace_all') return mutation
    const firstChangedIndex = getMessageMutationFirstChangedIndex(mutation)
    if (firstChangedIndex === undefined || firstChangedIndex <= 0 || firstChangedIndex > mutation.messages.length) {
      return mutation
    }
    changed = true
    return {
      ...mutation,
      firstChangedIndex,
      messages: mutation.messages.slice(firstChangedIndex),
    }
  })
  return changed ? { ...mutations, messageMutations } : mutations
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
  if (body.syntheticSayNothing !== undefined && typeof body.syntheticSayNothing !== 'boolean') {
    return { ok: false, error: 'syntheticSayNothing must be a boolean when provided' }
  }
  if (body.syntheticSayNothing === true && (body.mode !== 'send' || body.userMessage !== '*says nothing*')) {
    return {
      ok: false,
      error: 'syntheticSayNothing requires mode "send" and the say-nothing sentinel',
    }
  }
  if (body.mode === 'regenerate' && !isNonEmptyString(body.regenerateMessageId)) {
    return {
      ok: false,
      error: 'regenerateMessageId is required when mode is "regenerate"',
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, 'presetId')) {
    return {
      ok: false,
      error: 'presetId is not supported; use chat generationSettings modelPresetId and promptPresetId',
    }
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
  if (body.inlayAssetRefs !== undefined && !Array.isArray(body.inlayAssetRefs)) {
    return { ok: false, error: 'inlayAssetRefs must be an array when provided' }
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
  if (Object.prototype.hasOwnProperty.call(body, 'presetId')) {
    return {
      ok: false,
      error: 'presetId is not supported; use chat generationSettings modelPresetId and promptPresetId',
    }
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
  if (body.inlayAssetRefs !== undefined && !Array.isArray(body.inlayAssetRefs)) {
    return { ok: false, error: 'inlayAssetRefs must be an array when provided' }
  }
  if (body.syntheticSayNothing !== undefined && typeof body.syntheticSayNothing !== 'boolean') {
    return { ok: false, error: 'syntheticSayNothing must be a boolean when provided' }
  }
  return { ok: true }
}

// Disconnect + generous-deadline abort plumbing shared with the
// standalone generation routes; see `requestAbort.ts`.

/** Map a validated request body to the assembler input contract. */
function toAssembleInput(body: ChatRequestBody): AssembleInput {
  return {
    chatId: body.chatId as string,
    characterId: body.characterId as string,
    mode: body.mode as AssembleInput['mode'],
    loadoutId: typeof body.loadoutId === 'string' ? body.loadoutId : undefined,
    regenerateMessageId: typeof body.regenerateMessageId === 'string' ? body.regenerateMessageId : undefined,
    userMessage: typeof body.userMessage === 'string' ? body.userMessage : undefined,
    syntheticSayNothing: body.syntheticSayNothing === true ? true : undefined,
    resetMessages: typeof body.resetMessages === 'boolean' ? body.resetMessages : undefined,
    expectedRevision: typeof body.expectedRevision === 'number' ? body.expectedRevision : undefined,
    inlayAssets: Array.isArray(body.inlayAssets) ? body.inlayAssets : undefined,
    inlayAssetRefs: Array.isArray(body.inlayAssetRefs) ? body.inlayAssetRefs : undefined,
  }
}

/**
 * The assembler dependency surface bound to the persisted store. The
 * route owns the storage import so `assemble.ts` stays
 * storage-global-free. The loaded database reference is kept for provider
 * dispatch and mutation event payloads; durable chat-var persistence is
 * performed by the route itself through `persistAssemblyChatVars`
 * through the same JSON-command machinery the scriptstate command uses.
 */
interface RouteAssembleDeps extends AssembleDeps {
  getDatabase(): Database | null
  setPromptMemoryQueryPrefetch(prefetch: PromptMemoryQueryPrefetchResult): void
}

interface PromptAssemblyMeasurement {
  databaseLoadCount: number
  databaseLoadMs: number
  promptMemoryPrefetchMs: number
  stageTimingsMs: Partial<Record<PromptAssemblyStage, number>>
}

function addMeasurementMs(measurement: PromptAssemblyMeasurement, key: PromptAssemblyStage, durationMs: number): void {
  measurement.stageTimingsMs[key] = Math.round(((measurement.stageTimingsMs[key] ?? 0) + durationMs) * 100) / 100
}

const LOCAL_ASSET_PATH_RE = /^assets\/([a-f0-9]{64})\.[a-z0-9]+$/i

/**
 * Resolve an asset reference to its sha256 store id. Accepts either a bare id or
 * the `assets/<id>.<ext>` path form, mirroring the browser's
 * `serverAssetIdFromReference` (`src/ts/server/assets.ts`) and the risuSave
 * reference collector (`risuSave/assetReferences.ts`).
 */
function assetIdFromReference(reference: string): string | null {
  if (isValidAssetId(reference)) return reference
  return LOCAL_ASSET_PATH_RE.exec(reference)?.[1] ?? null
}

/**
 * Read an `{{asset_prompt::}}` / char-icon reference from the on-disk assets
 * store and re-wrap it as a `data:image/png;base64,` URI. Hardcoding the
 * png mime keeps byte-parity with the browser's `readImage(asset[1])` path
 * (`formatHistoryMessage.ts`), which does the same regardless of the
 * stored content-type. Returns `undefined` for an unresolvable reference so the
 * marker is stripped without bytes when assets are missing.
 */
function multimodalTypeFromContentType(contentType: string): MultiModal['type'] | null {
  if (contentType === SERVER_INLAY_SIGNATURE_CONTENT_TYPE) return 'signature'
  if (contentType.startsWith('image/')) return 'image'
  if (contentType.startsWith('audio/')) return 'audio'
  if (contentType.startsWith('video/')) return 'video'
  return null
}

type StoredAssetReader = (
  db: DatabaseSync,
  dataDir: string,
  id: string,
  purpose: StoredAssetPurpose,
) => MultiModal | undefined | Promise<MultiModal | undefined>

function cloneStoredAssetResult(result: MultiModal | undefined): MultiModal | undefined {
  return result ? { ...result } : undefined
}

async function readAssetBytes(file: string): Promise<Buffer | undefined> {
  try {
    return await fs.promises.readFile(file)
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? (err as { code?: unknown }).code : undefined
    if (code === 'ENOENT' || code === 'ENOTDIR') return undefined
    throw err
  }
}

async function readStoredAsset(
  db: DatabaseSync,
  dataDir: string,
  id: string,
  purpose: StoredAssetPurpose,
): Promise<MultiModal | undefined> {
  const entry = assetById(db, id)
  if (!entry) return undefined
  const file = assetPath(dataDir, entry)
  const bytes = await readAssetBytes(file)
  if (!bytes) return undefined
  if (purpose === 'asset_prompt') {
    return { type: 'image', base64: `data:image/png;base64,${bytes.toString('base64')}` }
  }
  const type = multimodalTypeFromContentType(entry.contentType)
  if (!type) return undefined
  if (type === 'signature') {
    return { type, base64: bytes.toString('utf8') }
  }
  return { type, base64: `data:${entry.contentType};base64,${bytes.toString('base64')}` }
}

export function createRequestScopedStoredAssetResolver(
  db: DatabaseSync,
  dataDir: string,
  read: StoredAssetReader = readStoredAsset,
): ResolveStoredAsset {
  const cache = new Map<string, Promise<MultiModal | undefined>>()
  return async (reference, purpose) => {
    const id = assetIdFromReference(reference)
    if (!id) return undefined
    const cacheKey = `${purpose}:${id}`
    let pending = cache.get(cacheKey)
    if (!pending) {
      pending = Promise.resolve(read(db, dataDir, id, purpose)).catch((err) => {
        cache.delete(cacheKey)
        throw err
      })
      cache.set(cacheKey, pending)
    }
    const resolved = await pending
    return cloneStoredAssetResult(resolved)
  }
}

function loadDatabaseDeps(
  dataDir: string,
  db: DatabaseSync,
  chatId: string,
  measurement?: PromptAssemblyMeasurement,
  signal?: AbortSignal,
  agentPresetProgress?: AgentPresetProgressReporter,
): RouteAssembleDeps {
  let database: Database | null = null
  let databaseLoaded = false
  let promptMemoryQueryPrefetch: PromptMemoryQueryPrefetchResult = {
    vectors: [],
    diagnostics: emptyPromptMemoryQueryDiagnostics(),
  }
  const resolveStoredAsset = createRequestScopedStoredAssetResolver(db, dataDir)
  return {
    signal,
    assetDataDir: dataDir,
    agentPresetProgress,
    loadDatabase: () => {
      if (databaseLoaded) return database
      databaseLoaded = true
      const startedAt = measurement ? protocolNowMs() : 0
      // Assembly reads only the target chat's transcript hydrate
      // that chat alone; every sibling chat stays `message = []`.
      database = loadPersistedForAssembly(db, dataDir, chatId).database as Database | null
      if (measurement) {
        measurement.databaseLoadCount += 1
        measurement.databaseLoadMs += protocolDurationMs(startedAt)
      }
      return database
    },
    loadMemoryDatabase: () => db,
    loadPromptMemoryQueryVectors: () => promptMemoryQueryPrefetch.vectors,
    loadPromptMemoryQueryDiagnostics: () => promptMemoryQueryPrefetch.diagnostics,
    setPromptMemoryQueryPrefetch: (prefetch) => {
      promptMemoryQueryPrefetch = prefetch
    },
    getDatabase: () => database,
    resolveStoredAsset,
    recordAssemblyStageTiming: measurement
      ? (stage, durationMs) => addMeasurementMs(measurement, stage, durationMs)
      : undefined,
  }
}

async function assemblePromptWithMetrics(
  input: AssembleInput,
  dataDir: string,
  db: DatabaseSync,
  signal?: AbortSignal,
  context: PromptAssemblyMetricContext = {},
  agentPresetProgress?: AgentPresetProgressReporter,
  options: GenerationChatRouteOptions = {},
): Promise<{ result: AssembleResult; deps: RouteAssembleDeps; promptMs: number; stage2Ms: number }> {
  const measurement: PromptAssemblyMeasurement = {
    databaseLoadCount: 0,
    databaseLoadMs: 0,
    promptMemoryPrefetchMs: 0,
    stageTimingsMs: {},
  }
  const metricStartedAt = protocolMetricsEnabled() ? protocolNowMs() : 0
  const startedAt = Date.now()
  const deps = loadDatabaseDeps(dataDir, db, input.chatId, measurement, signal, agentPresetProgress)
  try {
    const database = deps.loadDatabase()
    const promptMemoryPrefetchStartedAt = protocolNowMs()
    deps.setPromptMemoryQueryPrefetch(
      database
        ? await prefetchPromptMemoryQueryVectors({
            db,
            database,
            input,
            signal,
            deadlineMs: options.promptMemoryEmbeddingDeadlineMs,
            embed: options.embedPromptMemoryQueryTexts,
            embedGroups: options.embedPromptMemoryQueryGroups,
          })
        : {
            vectors: [],
            diagnostics: emptyPromptMemoryQueryDiagnostics(options.promptMemoryEmbeddingDeadlineMs),
          },
    )
    measurement.promptMemoryPrefetchMs = protocolDurationMs(promptMemoryPrefetchStartedAt)
    const result = await assemblePrompt(input, deps)
    const promptMs = Date.now() - startedAt
    const stage2Ms =
      result.state?.promptMemoryChunkPlanningDiagnostics?.attempted === true
        ? Math.max(0, Math.round(measurement.promptMemoryPrefetchMs + (measurement.stageTimingsMs.memory_bridge ?? 0)))
        : 0
    emitProtocolMetric('generation_prompt_assembly', {
      status: result.stopSending ? 'stopped' : 'ok',
      ...context,
      chatId: input.chatId,
      characterId: input.characterId,
      mode: input.mode,
      durationMs: protocolDurationMs(metricStartedAt),
      promptMs,
      databaseLoadCount: measurement.databaseLoadCount,
      databaseLoadMs: Math.round(measurement.databaseLoadMs * 100) / 100,
      stageTimingsMs: measurement.stageTimingsMs,
      ...assemblyDiagnosticMetricFields(result),
      ...(result.stopSending ? { stopReason: result.abortReason ?? 'unknown' } : {}),
    })
    return { result, deps, promptMs, stage2Ms }
  } catch (err) {
    emitProtocolMetric('generation_prompt_assembly', {
      status: 'error',
      ...context,
      chatId: input.chatId,
      characterId: input.characterId,
      mode: input.mode,
      durationMs: protocolDurationMs(metricStartedAt),
      promptMs: Date.now() - startedAt,
      databaseLoadCount: measurement.databaseLoadCount,
      databaseLoadMs: Math.round(measurement.databaseLoadMs * 100) / 100,
      stageTimingsMs: measurement.stageTimingsMs,
      error: errorMessage(err, 'prompt assembly failed'),
    })
    throw err
  }
}

function preflightChatGenerationSettings(
  reply: FastifyReply,
  input: AssembleInput,
  dataDir: string,
  db: DatabaseSync,
): AssemblyPreflightResult {
  try {
    const database = loadPersistedForAssembly(db, dataDir, input.chatId).database as Database | null
    if (!database) {
      return { status: 'defer', failure: { error: new EntityNotFoundError('database not found') } }
    }

    const selectedCharID = database.characters.findIndex((c) => c.chaId === input.characterId)
    if (selectedCharID === -1) {
      return {
        status: 'defer',
        failure: { error: new EntityNotFoundError(`character not found: ${input.characterId}`) },
      }
    }
    const currentChar = database.characters[selectedCharID]
    if (!currentChar) {
      return {
        status: 'defer',
        failure: { error: new EntityNotFoundError(`character not found: ${input.characterId}`) },
      }
    }

    const chatPage = currentChar.chats.findIndex((ch) => ch.id === input.chatId)
    if (chatPage === -1) {
      return {
        status: 'defer',
        failure: { error: new EntityNotFoundError(`chat not found: ${input.chatId}`) },
      }
    }
    const currentChat = currentChar.chats[chatPage]
    if (!currentChat) {
      return {
        status: 'defer',
        failure: { error: new EntityNotFoundError(`chat not found: ${input.chatId}`) },
      }
    }

    buildEffectiveGenerationConfig({
      database,
      currentChar,
      currentChat: structuredClone(currentChat),
      selectedCharID,
      chatPage,
    })
    return { status: 'ready' }
  } catch (err) {
    if (isChatGenerationSettingsIncompleteAssemblyError(err)) {
      reply.code(err.statusCode).send(err.body)
      return { status: 'handled' }
    }
    if (isModelProfileGenerationGuardAssemblyError(err)) {
      reply.code(err.statusCode).send(err.body)
      return { status: 'handled' }
    }
    return { status: 'defer', failure: { error: err } }
  }
}

function sendAssemblyHttpError(reply: FastifyReply, err: unknown): boolean {
  if (isAgentPresetGenerationError(err)) {
    reply.code(err.statusCode).send(err.body)
    return true
  }
  if (isChatGenerationSettingsIncompleteAssemblyError(err)) {
    reply.code(err.statusCode).send(err.body)
    return true
  }
  if (isModelProfileGenerationGuardAssemblyError(err)) {
    reply.code(err.statusCode).send(err.body)
    return true
  }
  if (err instanceof EntityNotFoundError) {
    reply.code(404).send({ error: err.message })
    return true
  }
  return false
}

function retargetAssemblySignal(assembly: PromptAssemblyRun, signal?: AbortSignal): void {
  const state = assembly.result.state
  if (!state) return
  state.signal = signal
  state.ctx.signal = signal
}

function shouldDispatchProvider(input: AssembleInput, database: Database | null): database is Database {
  if (!(input.mode === 'send' || input.mode === 'continue' || input.mode === 'regenerate')) {
    return false
  }
  return database !== null
}

function createGenerationInfo(
  db: Database,
  generationId: string,
  result: SuccessfulAssembleResult,
  promptMs: number,
  stage2Ms: number,
): Record<string, unknown> {
  return {
    model: getServerGenerationModelString(db, result.state?.resolvedMainProfile),
    generationId,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    maxContext: db.maxContext,
    stageTiming: {
      stage1: Math.max(0, promptMs - stage2Ms),
      stage2: stage2Ms,
      stage3: 0,
      stage4: 0,
    },
  }
}

function chatDispatchHistory(db: DatabaseSync, context: ChatProviderDispatchContext): ChatDispatchHistoryInput {
  const state = context.result.state
  const toggles = state?.currentChat.generationSettings?.sidebarToggles
  return {
    db,
    source: 'chat',
    context: {
      characterId: context.input.characterId,
      ...(state?.currentChar.name ? { characterName: state.currentChar.name } : {}),
      chatId: context.input.chatId,
      ...(state?.currentChat.name ? { chatName: state.currentChat.name } : {}),
      generationId: context.generationId,
    },
    ...(toggles ? { toggles: { ...toggles } } : {}),
    metadata: {
      mode: context.input.mode,
      inputTokens: context.result.inputTokens,
      ...context.historyMetadata,
    },
  }
}

type AssemblyStopReason = AssembleAbortReason | 'unknown_stop'

function formatContextBudgetDetail(inputTokens: number | undefined, maxContext: number | undefined): string {
  const parts: string[] = []
  if (typeof inputTokens === 'number' && Number.isFinite(inputTokens)) {
    parts.push(`estimated ${Math.round(inputTokens).toLocaleString('en-US')} tokens needed`)
  }
  if (typeof maxContext === 'number' && Number.isFinite(maxContext) && maxContext > 0) {
    parts.push(`context limit ${Math.round(maxContext).toLocaleString('en-US')}`)
  }
  return parts.length > 0 ? ` (${parts.join(', ')}).` : '.'
}

function assemblyStopError(
  result: Pick<AssembleResult, 'abortReason' | 'inputTokens'>,
  database: Database | null | undefined,
): { error: string; reason: AssemblyStopReason } {
  const detail = formatContextBudgetDetail(result.inputTokens, database?.maxContext)
  switch (result.abortReason) {
    case 'trigger_stop':
      return {
        reason: 'trigger_stop',
        error: 'Generation was stopped by a start trigger.',
      }
    case 'history_context_overflow':
      return {
        reason: 'history_context_overflow',
        error: `Chat history could not fit within the model context window after trimming older messages${detail}`,
      }
    case 'overflow':
      return {
        reason: 'overflow',
        error: `Prompt is too large for the model context window after trimming removable history${detail}`,
      }
    default:
      return {
        reason: 'unknown_stop',
        error: `Prompt assembly stopped before generation. Check active triggers and context budget settings${detail}`,
      }
  }
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message.length > 0) return err.message
  if (typeof err === 'string' && err.length > 0) return err
  return fallback
}

function readStringHeader(req: FastifyRequest, headerName: string): string | undefined {
  const raw = req.headers[headerName.toLowerCase()]
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function hashStrings(values: readonly string[]): string | undefined {
  if (values.length === 0) return undefined
  return createHash('sha256').update(JSON.stringify(values), 'utf8').digest('hex')
}

function assemblyDiagnosticMetricFields(result: AssembleResult): Record<string, unknown> {
  const mutations = result.mutations
  const loreSources = result.state?.report?.actives?.map((entry) => entry.source) ?? []
  const activeModuleIds = result.state?.activeModuleIds ?? []
  return {
    ...promptSummaryMetricFields(result.promptSummary),
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    modelPresetId: result.state?.modelPresetId,
    promptPresetId: result.state?.promptPresetId,
    loadoutId: result.state?.loadoutId ?? result.state?.input.loadoutId,
    activeModuleCount: activeModuleIds.length,
    activeModuleIds,
    lorebookActivationCount: result.state?.report?.actives?.length ?? 0,
    lorebookActivationSourceCount: loreSources.length,
    lorebookActivationSourceHashes: loreSources.map((source) =>
      createHash('sha256').update(source, 'utf8').digest('hex'),
    ),
    lorebookActivationSourcesSha256: hashStrings(loreSources),
    messageMutationCount: mutations?.messageMutations.length ?? 0,
    chatVarMutationCount: mutations?.chatVarMutations.length ?? 0,
    additionalSystemPromptMutationCount: mutations?.additionalSystemPrompt.length ?? 0,
    varChanged: mutations?.varChanged ?? false,
    submitTranscriptChanged: result.submitTranscriptChanged ?? false,
    promptMemoryQueryStatus: result.state?.promptMemoryQueryDiagnostics?.status,
    promptMemoryQueryProviderCallAttempted: result.state?.promptMemoryQueryDiagnostics?.providerCallAttempted ?? false,
    promptMemoryQueryTextCount: result.state?.promptMemoryQueryDiagnostics?.queryTexts ?? 0,
    promptMemoryQueryVectorCount: result.state?.promptMemoryQueryDiagnostics?.vectors ?? 0,
    promptMemoryQueryError: result.state?.promptMemoryQueryDiagnostics?.error,
  }
}

function promptEventBooleanFields(promptEvent: Omit<PromptEvent, 'type'>): Record<string, boolean> {
  const event = promptEvent as Omit<PromptEvent, 'type'> & Record<string, unknown>
  return {
    promptEventHasFormated: Array.isArray(event.formated),
    promptEventHasMessages: Array.isArray(event.messages),
    promptEventHasLorebookActivation: event.lorebookActivation !== undefined,
    promptEventHasPromptInfo: event.promptInfo !== undefined,
  }
}

async function emitGenerationPromptEmissionMetric(args: {
  metricContext: PromptAssemblyMetricContext
  input: AssembleInput
  promptEvent: Omit<PromptEvent, 'type'>
  formated: OpenAIChat[]
  promptSummary?: PromptRowsSummary
  generationId: string
  durableJobId?: string
  durable: boolean
  compactPromptEvent: boolean
  shouldDispatch: boolean
  revision?: number
  trace?: GenerationTraceContext
}): Promise<void> {
  const eventSummary =
    args.promptSummary ??
    (Array.isArray((args.promptEvent as Record<string, unknown>).formated)
      ? summarizePromptRows((args.promptEvent as { formated: OpenAIChat[] }).formated)
      : undefined)
  const fullPromptSidecar = protocolMetricsEnabled()
    ? await writeGenerationTraceSidecar({
        context: args.trace,
        kind: 'prompt',
        value: {
          kind: 'generation_prompt_emission',
          chatId: args.input.chatId,
          characterId: args.input.characterId,
          mode: args.input.mode,
          generationId: args.generationId,
          durableJobId: args.durableJobId,
          durable: args.durable,
          formated: args.formated,
        },
      })
    : undefined
  emitProtocolMetric('generation_prompt_emission', {
    status: 'ok',
    ...args.metricContext,
    chatId: args.input.chatId,
    characterId: args.input.characterId,
    mode: args.input.mode,
    generationId: args.generationId,
    durableJobId: args.durableJobId,
    durable: args.durable,
    compactPromptEvent: args.compactPromptEvent,
    shouldDispatch: args.shouldDispatch,
    revision: args.revision,
    persistedRevision: args.revision,
    ...promptSummaryMetricFields(eventSummary),
    ...promptEventBooleanFields(args.promptEvent),
    ...generationTraceSidecarMetricField('fullPromptSidecar', fullPromptSidecar),
  })
}

function createGenerationTraceContext(args: {
  dataDir: string
  generationTrace?: GenerationTraceOptions
  metricContext: PromptAssemblyMetricContext
  generationId: string
  durableJobId?: string
  req?: FastifyRequest
}): GenerationTraceContext | undefined {
  if (!protocolMetricsEnabled() || args.generationTrace?.fullPrompt !== true) return undefined
  return {
    dataDir: args.dataDir,
    options: args.generationTrace,
    requestId: typeof args.metricContext.requestId === 'string' ? args.metricContext.requestId : undefined,
    requestUid: typeof args.metricContext.requestUid === 'string' ? args.metricContext.requestUid : undefined,
    generationId: args.generationId,
    durableJobId: args.durableJobId,
    logger: args.req?.log,
  }
}

function createPromptAssemblyMetricContext(args: {
  req: FastifyRequest
  input: AssembleInput
  durable: boolean
  clientCapabilities: GenerationClientCapabilities
  generationId?: string
}): PromptAssemblyMetricContext {
  return {
    requestId: String(args.req.id),
    requestUid: readStringHeader(args.req, REQUEST_UID_HEADER),
    xRisuCaller: readStringHeader(args.req, 'x-risu-caller'),
    chatId: args.input.chatId,
    characterId: args.input.characterId,
    mode: args.input.mode,
    loadoutId: args.input.loadoutId,
    expectedRevision: args.input.expectedRevision,
    inlayAssetsCount: args.input.inlayAssets?.length,
    inlayAssetRefsCount: args.input.inlayAssetRefs?.length,
    durable: args.durable,
    compactPromptEvent: args.clientCapabilities.compactPromptEvent,
    promptMetadataOnly: args.clientCapabilities.promptMetadataOnly,
    generationId: args.generationId,
    durableJobId: args.durable ? args.generationId : undefined,
  }
}

function metricString(value: MetricPrimitive): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

async function emitPostGenerationLuaTraceMetric(args: {
  collector?: PostGenerationLuaTraceCollector
  status: 'ok' | 'error'
  error?: string
  input: AssembleInput
  generationId: string
  durable: boolean
  dataDir: string
  generationTrace?: GenerationTraceOptions
  metricContext?: PromptAssemblyMetricContext
}): Promise<void> {
  if (!args.collector?.hasRuns()) return

  const requestUid = metricString(args.metricContext?.requestUid)
  const requestId = metricString(args.metricContext?.requestId)
  const payload = args.collector.payload({
    status: args.status,
    ...(args.error ? { error: args.error } : {}),
    chatId: args.input.chatId,
    characterId: args.input.characterId,
    mode: args.input.mode,
    generationId: args.generationId,
    durable: args.durable,
    ...(requestUid ? { requestUid } : {}),
    ...(requestId ? { requestId } : {}),
  })
  const bodySidecar = await writeGenerationTraceSidecar({
    context: {
      dataDir: args.dataDir,
      options: {
        fullPrompt: true,
        maxGzipBytes: args.generationTrace?.maxGzipBytes ?? DEFAULT_GENERATION_TRACE_MAX_GZIP_BYTES,
      },
      requestUid,
      requestId,
      generationId: args.generationId,
      durableJobId: args.durable ? args.generationId : undefined,
    },
    kind: 'lua-post-generation',
    value: payload,
  })
  const summary = args.collector.metricSummary()
  emitProtocolMetric('generation_lua_post_generation_trace', {
    status: args.status,
    ...(args.error ? { error: args.error } : {}),
    requestUid,
    requestId,
    chatId: args.input.chatId,
    characterId: args.input.characterId,
    mode: args.input.mode,
    generationId: args.generationId,
    durable: args.durable,
    ...summary,
    ...generationTraceSidecarMetricField('bodySidecar', bodySidecar),
  })
}

/** Modes that persist their assembly delta; preview / preview_prompt stay read-only. */
function isPersistingMode(mode: AssembleInput['mode']): boolean {
  return mode === 'send' || mode === 'continue' || mode === 'regenerate'
}

function createAssemblyTranscriptMessage(input: unknown, index: number) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return createMessageRecord(input, `submitMessages[${index}]`)
  }
  const draft = structuredClone(input) as Record<string, unknown>
  if (typeof draft.chatId !== 'string' || draft.chatId.trim().length === 0) {
    draft.chatId = randomUUID()
  }
  return createMessageRecord(draft, `submitMessages[${index}]`)
}

function canAppendAssemblyReplacement(
  mutations: AssembleMutationPayload,
  replacementLength: number,
  persistedLength: number,
): boolean {
  if (replacementLength <= persistedLength) return false
  if (mutations.messageMutations.length === 0) return false

  for (const mutation of mutations.messageMutations) {
    if (mutation.type === 'append') {
      if (mutation.index < persistedLength) return false
      continue
    }
    const firstChangedIndex = getMessageMutationFirstChangedIndex(mutation)
    if (firstChangedIndex === undefined || firstChangedIndex < persistedLength) {
      return false
    }
  }
  return true
}

/**
 * Persist the assembly-time chat-var and chat-metadata deltas the assembler
 * computed and, when a submit-time input trigger,
 * `editinput`, or before-main Agent Preset rewrote the transcript — the
 * authoritative submit transcript (`submitMessages`), through a targeted command mutation:
 * one revision bump, one event, rollback on failure. The route owns these writes
 * and returns the new revision over SSE so the browser can reconcile its cached
 * command revision.
 *
 * The transcript is persisted only when `submitTranscriptChanged` is set; plain
 * sends without an input transform leave user-message persistence to the browser.
 * When both the transcript and chat vars change, they ride one command (one
 * revision); a composite chat-transcript event reconciles both writes.
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
  const lastMemoryMutation = args.mutations.chatMetadataMutations?.find((mutation) => mutation.key === 'lastMemory')
  const hasMetadataWrite = lastMemoryMutation !== undefined
  const persistMessages = !!args.submitTranscriptChanged && Array.isArray(args.submitMessages)
  if (!hasVarWrite && !hasMetadataWrite && !persistMessages) {
    emitProtocolMetric('generation_assembly_persistence', {
      status: 'skipped',
      chatId: args.input.chatId,
      mode: args.input.mode,
      chatVarMutationCount: args.mutations.chatVarMutations.length,
      persistMessages,
      hasVarWrite,
      hasMetadataWrite,
      durationMs: 0,
    })
    return undefined
  }

  const { revision: baseRevision } = getSchemaState(args.db)
  const persistStartedAt = protocolNowMs()
  let eventType = ''
  try {
    const replacement = persistMessages
      ? args.submitMessages!.map((message, index) => createAssemblyTranscriptMessage(message, index))
      : undefined
    if (replacement) {
      validateUniqueMessageIds(replacement)
    }
    const result = applyTargetedCommandMutation<{ chatId: string }>({
      db: args.db,
      dataDir: args.dataDir,
      baseRevision,
      eventSink: args.eventSink,
      mutationPath: 'targeted-assembly',
      chatScopedRead: { chatId: args.input.chatId },
      mutate(database, targetDb) {
        const characters = normalizeAllCharacterChats(database)
        const { character, chat } = requireChatLocation(characters, args.input.chatId)
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
        if (replacement) {
          for (const message of replacement) {
            if (activeMessageIdExistsOutsideChat(targetDb, message.chatId, args.input.chatId)) {
              throw new ValidationError(`Duplicate message id: ${message.chatId}`)
            }
          }
          const persistedLength = countChatMessages(targetDb, args.input.chatId)
          const appended =
            canAppendAssemblyReplacement(args.mutations, replacement.length, persistedLength) &&
            appendActiveChatMessageTail(targetDb, args.input.chatId, replacement, persistedLength)
          if (!appended) {
            replaceActiveChatMessages(targetDb, args.input.chatId, replacement)
          }
        }
        if (lastMemoryMutation) {
          if (lastMemoryMutation.after === null) {
            delete chat.lastMemory
          } else {
            if (!activeMessageIdExistsInChat(targetDb, lastMemoryMutation.after, args.input.chatId)) {
              throw new ValidationError('lastMemory must reference an active message owned by the target chat')
            }
            chat.lastMemory = lastMemoryMutation.after
          }
        }
        if (hasVarWrite || hasMetadataWrite) {
          writeSingleChatRow(targetDb, args.input.chatId, chat)
        }
        const eventTemplate =
          persistMessages || hasMetadataWrite
            ? COMMAND_EVENT_CATALOG.generationAssemblyPersisted
            : COMMAND_EVENT_CATALOG.chatScriptstateUpdated
        eventType = eventTemplate.type
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
    emitProtocolMetric('generation_assembly_persistence', {
      status: 'ok',
      chatId: args.input.chatId,
      mode: args.input.mode,
      revision: result.revision,
      eventType,
      chatVarMutationCount: args.mutations.chatVarMutations.length,
      persistMessages,
      hasVarWrite,
      hasMetadataWrite,
      durationMs: protocolDurationMs(persistStartedAt),
    })
    return result.revision
  } catch (err) {
    emitProtocolMetric('generation_assembly_persistence', {
      status: 'error',
      chatId: args.input.chatId,
      mode: args.input.mode,
      eventType,
      chatVarMutationCount: args.mutations.chatVarMutations.length,
      persistMessages,
      hasVarWrite,
      hasMetadataWrite,
      durationMs: protocolDurationMs(persistStartedAt),
      error: errorMessage(err, 'failed to persist assembly mutations'),
    })
    throw err
  }
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
 *     target (`regenerateMessageId`) when that target existed at assembly start.
 *     If the client already truncated back to the user row and sent a stale
 *     regenerate id, match `prepareRegenerateTranscript` and append instead.
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
    targetMessageId: regenerateTargetMessageIdFromInitialMessages(args.input, args.state.initialMessages),
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
 * `regenerate` replaces the target (`regenerateMessageId`) only when that target
 * existed at assembly start; `send` appends a fresh row keyed by `generationId`.
 * The mode-aware target is what makes a durable continue/regenerate land on the
 * right row even without a post-gen pass.
 */
function buildRawModeMessage(args: {
  input: AssembleInput
  initialMessages?: readonly Message[]
  continueRow: Message | undefined
  text: string
  generationId: string
  generationInfo: Record<string, unknown>
  promptInfo?: Record<string, unknown>
  removeIncompleteResponse?: boolean
}): { message: Message; targetMessageId?: string } {
  const normalizeRawText = (text: string): string =>
    args.removeIncompleteResponse ? trimUntilPunctuation(text) : text.trim()
  if (args.input.mode === 'continue') {
    return {
      message: buildAssistantMessage({
        data: normalizeRawText((args.continueRow?.data ?? '') + args.text),
        generationId: args.continueRow?.chatId ?? args.generationId,
        characterId: args.input.characterId,
        generationInfo: args.generationInfo,
        promptInfo: args.promptInfo,
      }),
    }
  }
  return {
    message: buildAssistantMessage({
      data: normalizeRawText(args.text),
      generationId: args.generationId,
      characterId: args.input.characterId,
      generationInfo: args.generationInfo,
      promptInfo: args.promptInfo,
    }),
    targetMessageId: regenerateTargetMessageIdFromInitialMessages(args.input, args.initialMessages),
  }
}

function snapshotMessageRow(message: Message | undefined): GenerationFinalizationSnapshotRow | undefined {
  if (!message) return undefined
  return { message: structuredClone(message) }
}

function captureGenerationFinalizationTargetSnapshot(
  input: AssembleInput,
  state: AssemblyState,
): GenerationFinalizationTargetSnapshot | undefined {
  const mode = finalizationModeFromInput(input)
  const sourceRows = state.submitMessages ?? state.initialMessages ?? []
  const transcriptLength = sourceRows.length
  const tail = sourceRows.at(-1)

  if (mode === 'continue' && tail?.role === 'char') {
    return {
      mode,
      kind: 'target-tail',
      transcriptLength,
      target: snapshotMessageRow(tail)!,
    }
  }

  if (mode === 'regenerate') {
    const targetMessageId = input.regenerateMessageId
    if (targetMessageId && tail?.role === 'char' && tail.chatId === targetMessageId) {
      return {
        mode,
        kind: 'target-tail',
        transcriptLength,
        target: snapshotMessageRow(tail)!,
      }
    }
  }

  const tailSnapshot = snapshotMessageRow(tail)
  return {
    mode,
    kind: 'tail',
    transcriptLength,
    ...(tailSnapshot ? { tail: tailSnapshot } : {}),
  }
}

function classifyPostGenerationFallbackSource(err: unknown): string {
  if (err instanceof ServerLuaFailureError) {
    const mode = err.runtimeMetricFields?.mode
    if (mode === 'output') return 'lua_output_trigger'
    if (mode === 'editOutput') return 'lua_edit_output'
  }
  const message = errorMessage(err, '').toLowerCase()
  if (message.includes('lua output trigger failed')) return 'lua_output_trigger'
  if (message.includes('lua editoutput edit trigger failed') || message.includes('editoutput')) {
    return 'lua_edit_output'
  }
  if (message.includes('bounded regex') || message.includes('customscript')) return 'regex_edit_output'
  return 'unknown_post_generation'
}

function luaFailureFallbackMetricFields(err: unknown): Record<string, unknown> {
  if (!(err instanceof ServerLuaFailureError)) return {}
  const runtime = err.runtimeMetricFields
  return {
    ...(runtime
      ? {
          luaMode: runtime.mode,
          luaCodeSha256: runtime.codeSha256,
          luaCodeBytes: runtime.codeBytes,
          luaLowLevelAccess: runtime.lowLevelAccess,
          luaDurationMs: runtime.durationMs,
          luaExecTimeoutMs: runtime.execTimeoutMs,
          luaEffectiveTimeoutMs: runtime.effectiveTimeoutMs,
          luaTimedOut: runtime.timedOut,
          luaInteractiveInvoked: runtime.interactiveInvoked,
          luaAborted: runtime.aborted,
          ...(runtime.errorKind ? { luaErrorKind: runtime.errorKind } : {}),
          ...(runtime.budgetTotalMs !== undefined ? { luaBudgetTotalMs: runtime.budgetTotalMs } : {}),
          ...(runtime.budgetUsedMsBefore !== undefined ? { luaBudgetUsedMsBefore: runtime.budgetUsedMsBefore } : {}),
          ...(runtime.budgetUsedMsAfter !== undefined ? { luaBudgetUsedMsAfter: runtime.budgetUsedMsAfter } : {}),
          ...(runtime.budgetRemainingMsBefore !== undefined
            ? { luaBudgetRemainingMsBefore: runtime.budgetRemainingMsBefore }
            : {}),
          ...(runtime.budgetRemainingMsAfter !== undefined
            ? { luaBudgetRemainingMsAfter: runtime.budgetRemainingMsAfter }
            : {}),
        }
      : {}),
    ...triggerSourceMetricFields(err.source),
  }
}

function safePostGenerationFallbackMetricError(err: unknown, fallback: string): string {
  if (err instanceof ServerLuaFailureError) {
    const mode = err.runtimeMetricFields?.mode
    const kind = err.runtimeMetricFields?.errorKind ?? 'lua_failure'
    if (mode === 'output') return `Lua output trigger failed (${kind})`
    if (mode === 'editOutput') return `Lua editOutput edit trigger failed (${kind})`
    return `Lua runtime failed (${kind})`
  }
  return errorMessage(err, fallback)
}

function completionSha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/**
 * Run server post-generation derivation and resolve the mode-aware assistant
 * message plus replace target, with a raw-text fallback when derivation throws.
 * Shared by inline and durable finalization; they differ only in error surfacing.
 * A `postGen` of `undefined` signals the derivation threw (the raw fallback is in
 * use).
 */
async function resolvePostGenerationResult(args: {
  state: AssemblyState
  input: AssembleInput
  completionText: string
  alternateTexts?: readonly string[]
  generationId: string
  generationInfo: Record<string, unknown>
  promptInfo?: Record<string, unknown>
  dataDir: string
  durable: boolean
  emit?: (event: PromptChatEvent) => void
  generationTrace?: GenerationTraceOptions
  metricContext?: PromptAssemblyMetricContext
}): Promise<{
  postGen?: Awaited<ReturnType<typeof runServerPostGeneration>>
  postGenError?: string
  message: Message
  targetMessageId?: string
  chatVarMutations: AssembleMutationPayload['chatVarMutations']
  alternateTexts: string[]
  targetSnapshot?: GenerationFinalizationTargetSnapshot
  postGenMetricError?: string
}> {
  const targetSnapshot = captureGenerationFinalizationTargetSnapshot(args.input, args.state)
  // Capture the continue target BEFORE post-gen mutates the row in place.
  const continueRow = args.input.mode === 'continue' ? findContinueRow(args.state) : undefined
  const luaTrace = protocolMetricsEnabled() ? new PostGenerationLuaTraceCollector() : undefined
  const luaProgress = args.emit ? new PostGenerationLuaProgressTracker(args.emit) : undefined
  let alternateTexts: string[] = []
  try {
    const postGen = await runServerPostGeneration(args.state, {
      completionText: args.completionText,
      generationId: args.generationId,
      generationInfo: args.generationInfo,
      promptInfo: args.promptInfo,
      luaTrace,
      luaProgress,
      agentPresetProgress: args.emit
        ? (progress) => args.emit?.({ type: 'agent_preset_progress', ...progress })
        : undefined,
      beforeOutputTrigger: async (alternateState) => {
        alternateTexts = await transformProviderAlternateTexts(alternateState, args.input, args.alternateTexts ?? [])
      },
    })
    for (const warning of postGen.warnings ?? []) {
      args.emit?.({ type: 'warning', ...warning })
    }
    await emitPostGenerationLuaTraceMetric({
      collector: luaTrace,
      status: 'ok',
      input: args.input,
      generationId: args.generationId,
      durable: args.durable,
      dataDir: args.dataDir,
      generationTrace: args.generationTrace,
      metricContext: args.metricContext,
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
      alternateTexts,
      targetSnapshot,
    }
  } catch (err) {
    // Derivation threw: persist the raw provider text so the result is not lost.
    const raw = buildRawModeMessage({
      input: args.input,
      initialMessages: args.state.initialMessages,
      continueRow,
      text: args.completionText,
      generationId: args.generationId,
      generationInfo: args.generationInfo,
      promptInfo: args.promptInfo,
      removeIncompleteResponse: args.state.database.removeIncompleteResponse,
    })
    const error = errorMessage(err, 'server post-generation derivation failed')
    const metricError = safePostGenerationFallbackMetricError(err, 'server post-generation derivation failed')
    await emitPostGenerationLuaTraceMetric({
      collector: luaTrace,
      status: 'error',
      error: metricError,
      input: args.input,
      generationId: args.generationId,
      durable: args.durable,
      dataDir: args.dataDir,
      generationTrace: args.generationTrace,
      metricContext: args.metricContext,
    })
    emitProtocolMetric('generation_post_generation_fallback', {
      fallbackType: 'raw_provider_text',
      generationId: args.generationId,
      chatId: args.input.chatId,
      characterId: args.input.characterId,
      mode: args.input.mode,
      targetMessageId: raw.targetMessageId,
      targetSnapshotKind: targetSnapshot?.kind,
      targetSnapshotTranscriptLength: targetSnapshot?.transcriptLength,
      completionLength: args.completionText.length,
      completionBytes: Buffer.byteLength(args.completionText, 'utf8'),
      completionSha256: completionSha256(args.completionText),
      error: metricError,
      source: classifyPostGenerationFallbackSource(err),
      ...luaFailureFallbackMetricFields(err),
    })
    return {
      postGenError: error,
      message: raw.message,
      targetMessageId: raw.targetMessageId,
      chatVarMutations: [],
      alternateTexts: (args.alternateTexts ?? []).map((text) => rawProviderAlternateText(args.state, args.input, text)),
      targetSnapshot,
      postGenMetricError: metricError,
    }
  }
}

/** Fold the post-gen derivation outputs onto the terminal `postGeneration` frame. */
function buildPostGenerationFrameBody(
  revision: number,
  postGen: Awaited<ReturnType<typeof runServerPostGeneration>> | undefined,
  messageId?: string,
  translation?: PostGenerationFrame['translation'],
): PostGenerationFrame {
  const frame: PostGenerationFrame = {
    revision,
    ...(messageId ? { messageId } : {}),
    ...(translation ? { translation } : {}),
  }
  if (postGen) {
    if (postGen.textChanged) frame.finalText = postGen.finalText
    if (postGen.mutations.chatVarMutations.length > 0 || postGen.mutations.messageMutations.length > 0) {
      frame.messagePatch = postGen.mutations
    }
    if (postGen.resendChat) frame.resendChat = true
    if (postGen.agentPresetError) frame.agentPresetError = postGen.agentPresetError
  }
  return frame
}

function notifyChatCompletion(
  pushNotifications: false | PushNotificationService | undefined,
  context?: ChatCompletionNotificationContext,
): void {
  if (!pushNotifications) return
  void pushNotifications.sendChatCompletionNotification(context).catch(() => {
    // Best-effort: failed push delivery must not affect generation completion.
  })
}

export function directGenerationResponseIsWritable(raw: {
  writable?: boolean
  writableEnded: boolean
  destroyed?: boolean
}): boolean {
  return raw.writable !== false && !raw.writableEnded && raw.destroyed !== true
}

function handlePersistedGenerationCompletion(args: {
  db: DatabaseSync
  dataDir: string
  eventSink: CommandEventSink
  messageTranslationJobs: MessageTranslationJobRegistry
  message: Message
  targetMessageId?: string
  chatId: string
  characterId?: string
  completedAt: number
  emit?: (event: PromptChatEvent) => void
  pushNotifications?: false | PushNotificationService
  runMessageTranslation?: ServerMessageTranslationRunner
}): Promise<{ translation?: PostGenerationFrame['translation']; revision?: number }> {
  const messageId = args.targetMessageId ?? args.message.chatId
  if (typeof messageId !== 'string' || messageId.trim().length === 0) {
    notifyChatCompletion(args.pushNotifications, { characterId: args.characterId, chatId: args.chatId })
    return Promise.resolve({})
  }
  return handleGeneratedChatCompletion({
    db: args.db,
    dataDir: args.dataDir,
    eventSink: args.eventSink,
    messageTranslationJobs: args.messageTranslationJobs,
    messageId,
    chatId: args.chatId,
    ...(args.characterId ? { characterId: args.characterId } : {}),
    completedAt: args.completedAt,
    pushNotifications: args.pushNotifications,
    runMessageTranslation: args.runMessageTranslation,
    onTranslationStarted: ({ jobId }) =>
      args.emit?.({
        type: 'post_generation_progress',
        phase: 'translation',
        status: 'translating',
        runSeq: 0,
        messageId,
        jobId,
        llmCallCount: 0,
        pendingLlmCount: 0,
        llmCallCounts: { LLM: 0, axLLM: 0 },
        pendingLlmCounts: { LLM: 0, axLLM: 0 },
      }),
  }).then((followup) => ({
    ...(followup.frame ? { translation: followup.frame } : {}),
    ...(followup.revision !== undefined ? { revision: followup.revision } : {}),
  }))
}

/**
 * Run the server post-generation pass over the provider's completion text,
 * persist the result server-side, and build the `done.postGeneration` frame.
 * This surfaces final text / delta / resend / bumped revision for the browser.
 *
 * The inline path is the sole author of generation results. A derivation failure
 * persists the raw provider text best-effort rather than losing it; a persist
 * failure is swallowed and the browser keeps its optimistic copy.
 */
async function buildPostGenerationFrame(args: {
  state: NonNullable<Parameters<typeof runServerPostGeneration>[0]>
  db: DatabaseSync
  dataDir: string
  eventSink: CommandEventSink
  input: AssembleInput
  completionText: string
  alternateTexts?: readonly string[]
  generationId: string
  generationInfo: Record<string, unknown>
  promptInfo?: Record<string, unknown>
  emit?: (event: PromptChatEvent) => void
  pushNotifications?: false | PushNotificationService
  messageTranslationJobs: MessageTranslationJobRegistry
  runMessageTranslation?: ServerMessageTranslationRunner
  generationTrace?: GenerationTraceOptions
  metricContext?: PromptAssemblyMetricContext
}): Promise<ProviderPostGenerationResult | undefined> {
  const completedAt = Date.now()
  const {
    postGen,
    postGenError,
    postGenMetricError,
    message,
    targetMessageId,
    chatVarMutations,
    alternateTexts,
    targetSnapshot,
  } = await resolvePostGenerationResult({
    state: args.state,
    input: args.input,
    completionText: args.completionText,
    alternateTexts: args.alternateTexts,
    generationId: args.generationId,
    generationInfo: args.generationInfo,
    promptInfo: args.promptInfo,
    dataDir: args.dataDir,
    durable: false,
    emit: args.emit,
    generationTrace: args.generationTrace,
    metricContext: args.metricContext,
  })
  const alternateMessages = buildProviderAlternateMessages({
    primaryMessage: message,
    alternateTexts,
  })

  let revision: number
  const persistStartedAt = protocolNowMs()
  try {
    revision = persistServerGenerationResult({
      db: args.db,
      dataDir: args.dataDir,
      eventSink: args.eventSink,
      chatId: args.input.chatId,
      message,
      chatVarMutations,
      targetMessageId,
      mode: finalizationModeFromInput(args.input),
      targetSnapshot,
      alternateMessages,
    })
  } catch (err) {
    emitProtocolMetric('generation_persistence', {
      status: 'inline_error',
      generationId: args.generationId,
      chatId: args.input.chatId,
      durationMs: protocolDurationMs(persistStartedAt),
      error: errorMessage(err, 'failed to persist the generation result'),
    })
    // Chat changed / gone during persist: leave the browser's optimistic copy
    // and terminate cleanly (no frame).
    return { primary: message.data, alternates: alternateTexts }
  }

  emitProtocolMetric('generation_persistence', {
    status: postGen ? 'inline_ok' : 'inline_raw_fallback',
    generationId: args.generationId,
    chatId: args.input.chatId,
    revision,
    durationMs: protocolDurationMs(persistStartedAt),
    ...(postGenMetricError ? { error: postGenMetricError } : {}),
  })
  if (!postGen) {
    args.emit?.({
      type: 'warning',
      message: 'server post-generation derivation failed; persisted the raw provider text.',
      ...(postGenError ? { context: { error: postGenError } } : {}),
    })
  }
  const messageId = targetMessageId ?? message.chatId
  const translationFollowup = await handlePersistedGenerationCompletion({
    db: args.db,
    dataDir: args.dataDir,
    eventSink: args.eventSink,
    messageTranslationJobs: args.messageTranslationJobs,
    message,
    targetMessageId,
    chatId: args.input.chatId,
    characterId: args.input.characterId,
    completedAt,
    emit: args.emit,
    pushNotifications: args.pushNotifications,
    runMessageTranslation: args.runMessageTranslation,
  })
  return {
    frame: buildPostGenerationFrameBody(
      translationFollowup.revision ?? revision,
      postGen,
      messageId,
      translationFollowup.translation,
    ),
    primary: message.data,
    alternates: alternateTexts,
  }
}

/**
 * Stream the assembled prompt. The SSE head is written up front, so every
 * assembly failure is a terminal `error` event rather than an HTTP status. The
 * route persists the assembly-time chat-var delta and returns the bumped
 * revision on the `info` frame; the browser keeps the `message_patch` for its
 * projection but no
 * longer replays the delta as a command.
 */
async function streamAssembly(
  req: FastifyRequest,
  reply: FastifyReply,
  db: DatabaseSync,
  input: AssembleInput,
  dataDir: string,
  eventSink: CommandEventSink,
  clientCapabilities: GenerationClientCapabilities,
  messageTranslationJobs: MessageTranslationJobRegistry,
  options: GenerationChatRouteOptions = {},
  generationTrace?: GenerationTraceOptions,
  preparedAssembly?: PromptAssemblyRun,
  deferredFailure?: AssemblyDeferredFailure,
  metricContext: PromptAssemblyMetricContext = {},
  requestAbort = attachAbort(req, reply),
): Promise<void> {
  const { signal, refresh, abort, cleanup } = requestAbort
  let terminalDoneEmitted = false
  try {
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    })
    const emit = (event: PromptChatEvent): void => {
      const frame = formatPromptChatFrame(event)
      const written = writeBoundedRaw(reply.raw, frame, { onOverflow: abort })
      if (written && isStreamDeadlineActivityFrame(frame)) refresh()
    }

    emit({ type: 'stage', stage: 'validate', status: 'start' })
    emit({ type: 'stage', stage: 'validate', status: 'end' })
    emit({ type: 'stage', stage: 'prompt', status: 'start' })

    try {
      if (deferredFailure) throw deferredFailure.error
      const { result, deps, promptMs, stage2Ms } =
        preparedAssembly ??
        (await assemblePromptWithMetrics(
          input,
          dataDir,
          db,
          signal,
          metricContext,
          (progress) => emit({ type: 'agent_preset_progress', ...progress }),
          options,
        ))
      const database = result.state?.database ?? deps.getDatabase()
      // The route owns assembly-time chat-var writes and post-`editinput`
      // submit-transcript writes for persisting modes. This runs for both success
      // and `stopSending` so aborted sends do not lose the assembly mutations.
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
      emitAssemblyWarnings(result, emit)
      if (!result.stopSending && result.prompt) {
        const successfulResult: SuccessfulAssembleResult = {
          ...result,
          stopSending: false,
          prompt: result.prompt,
        }
        const generationId = randomUUID()
        const shouldDispatch = shouldDispatchProvider(input, database)
        const generationInfo =
          shouldDispatch && database
            ? createGenerationInfo(database, generationId, successfulResult, promptMs, stage2Ms)
            : undefined
        const promptEvent = promptEventForClient(result.prompt, clientCapabilities, input.mode)
        const trace = createGenerationTraceContext({
          dataDir,
          generationTrace,
          metricContext,
          generationId,
          req,
        })
        await emitGenerationPromptEmissionMetric({
          metricContext,
          input,
          promptEvent,
          formated: successfulResult.formated ?? successfulResult.prompt.formated ?? [],
          promptSummary: result.promptSummary,
          generationId,
          durable: false,
          compactPromptEvent: clientCapabilities.compactPromptEvent,
          shouldDispatch,
          revision: persistedRevision,
          trace,
        })
        emit({ type: 'prompt', ...promptEvent })
        if (result.mutations) {
          emit({ type: 'message_patch', patch: messagePatchForClient(result.mutations, clientCapabilities) })
        }
        emit({ type: 'stage', stage: 'prompt', status: 'end' })
        // `outputTokens` is the response budget, not a completion count, so it
        // rides on `responseBudget` rather than `tokens.completion`.
        emit({
          type: 'info',
          timings: { prompt: promptMs },
          tokens: { prompt: result.inputTokens, total: result.inputTokens },
          responseBudget: result.outputTokens,
          generationId: shouldDispatch ? generationId : undefined,
          generationInfo,
          // Present only when a chat-var write actually persisted, so the browser
          // reconciles its cached command revision; omitted otherwise.
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
                biases: context.result.biases,
                multiGeneration: context.input.mode !== 'continue',
                currentCharacterName: context.result.state?.currentChar.name,
                signal: context.signal,
                trace: context.trace,
                profile: context.profile,
                history: chatDispatchHistory(db, context),
              }))
          const providerStartedAt = Date.now()
          let frames: AsyncIterable<CompletionStreamFrame> | null | undefined
          try {
            frames = dispatchProviderWithPolicies(
              {
                input,
                result: successfulResult,
                database,
                generationId,
                generationInfo,
                signal,
                trace,
              },
              dispatchProvider,
            )
          } catch (err) {
            emit({
              type: 'error',
              error: errorMessage(err, PROVIDER_DISPATCH_FALLBACK),
              reason: 'provider_dispatch_exception',
              restoration: successfulResult.restoration,
            })
            emit({ type: 'done', generationId, generationInfo })
            terminalDoneEmitted = true
          }
          if (frames) {
            const transportResult = await emitProviderChunks(frames, emit, signal, {
              // This inline stream cannot be reattached, so a capable client that
              // received token deltas does not need the full text repeated on done.
              omitResultWhenStreamed: clientCapabilities.omitDuplicateDoneResult,
              doneMetadata: () => {
                const stageTiming = generationInfo.stageTiming as Record<string, unknown> | undefined
                if (stageTiming) {
                  stageTiming.stage3 = Date.now() - providerStartedAt
                }
                return { generationId, generationInfo }
              },
              sideEffects: (texts) =>
                database.ttsAutoSpeech
                  ? texts.map((text) => ({
                      type: 'side_effect',
                      kind: 'tts',
                      payload: { text, characterId: input.characterId },
                    }))
                  : [],
              errorRestoration: () => successfulResult.restoration,
              postGeneration: (completionText, alternateTexts) =>
                successfulResult.state
                  ? buildPostGenerationFrame({
                      state: successfulResult.state,
                      db,
                      dataDir,
                      eventSink,
                      input,
                      completionText,
                      alternateTexts,
                      generationId,
                      generationInfo,
                      promptInfo: successfulResult.prompt.promptInfo,
                      emit,
                      pushNotifications: options.pushNotifications,
                      messageTranslationJobs,
                      runMessageTranslation: options.runMessageTranslation,
                      generationTrace,
                      metricContext,
                    })
                  : Promise.resolve(undefined),
            })
            terminalDoneEmitted = transportResult.status !== 'aborted'
          }
        }
      } else {
        if (result.mutations) {
          emit({ type: 'message_patch', patch: messagePatchForClient(result.mutations, clientCapabilities) })
        }
        const stopError = assemblyStopError(result, database)
        emit({
          type: 'error',
          error: stopError.error,
          reason: stopError.reason,
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

// Durable generation: decoupled lifecycle + server-owned result.
//
// For a durable generating mode (browser `resolveDurableGeneration === 'durable'` →
// `body.durable === true`, mode `send`/`continue`/`regenerate`), the generation
// runs as a detached `JobRegistry` job whose lifecycle is **not** tied to the
// request connection:
// dropping the connection detaches a viewer, the job keeps generating, buffers,
// and is reattachable. At completion the server persists the derived assistant
// message + scriptstate delta itself.

/** The active-writer identity carried on the `/chat` request (captured at job creation). */
function readWriterSessionHeader(req: FastifyRequest): string | null {
  const raw = req.headers[ACTIVE_WRITER_SESSION_HEADER]
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

/** An SSE-backed `JobClient`: writes raw frame strings to the reply's raw socket. */
function makeSseJobClient(reply: FastifyReply): JobClient {
  return {
    send(frame) {
      if (typeof frame === 'string') {
        writeBoundedRaw(reply.raw, frame)
      }
    },
    close() {
      try {
        if (!reply.raw.writableEnded) reply.raw.end()
      } catch {
        // ignore
      }
    },
    get open() {
      return directGenerationResponseIsWritable(reply.raw)
    },
    get bufferedBytes() {
      return getWritableBufferedBytes(reply.raw)
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
  viewerHeartbeatMs?: number,
): void {
  reply.hijack()
  reply.raw.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
    'x-risu-generation-job-id': job.id,
  })
  const client = makeSseJobClient(reply)
  client.send(formatPromptChatFrame({ type: 'job_accepted', jobId: job.id }))
  registry.registry.attach(job.id, client)
  // SSE comment heartbeat a long assembly or provider connect can
  // leave the stream silent past idle-proxy timeouts before the first token.
  // Comments are invisible to the SSE block parser and are written directly to
  // this viewer's socket — they never enter the job's replay buffer.
  const heartbeat = setInterval(
    () => {
      if (!reply.raw.writableEnded) {
        writeBoundedRaw(reply.raw, ': heartbeat\n\n')
      }
    },
    viewerHeartbeatMs ?? job.heartbeatSec * 1000,
  )
  heartbeat.unref()
  req.raw.once('close', () => {
    clearInterval(heartbeat)
    registry.registry.detach(job.id, client)
  })
  // Reattach to an already-completed (in-grace) job: `attach` just flushed the
  // buffered terminal frame, and the runner's finally already ran (it cannot close
  // this late viewer), so close + detach here. Otherwise the socket and the job
  // would dangle until the client hangs up (the job is `done` with one client, which
  // neither GC branch collects).
  if (job.done) {
    clearInterval(heartbeat)
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

/** Build complete message records for the additional provider choices. */
function buildProviderAlternateMessages(args: {
  primaryMessage: Message
  alternateTexts: readonly string[]
}): Message[] {
  if (args.alternateTexts.length === 0) return []

  const primaryId = args.primaryMessage.chatId ?? randomUUID()
  return args.alternateTexts.map((text, index) => {
    const message = structuredClone(args.primaryMessage)
    message.data = text
    // The browser derives the same ids from `done.alternates`, so a live swipe
    // selects the already-durable candidate instead of creating a duplicate.
    message.chatId = `${primaryId}:alternate:${index + 1}`
    delete message.translation
    return message
  })
}

function rawProviderAlternateText(state: AssemblyState, input: AssembleInput, text: string): string {
  let continueBase = ''
  if (input.mode === 'continue') {
    const initialMessages = state.initialMessages ?? []
    for (let index = initialMessages.length - 1; index >= 0; index--) {
      if (initialMessages[index]?.role === 'char') {
        continueBase = initialMessages[index].data ?? ''
        break
      }
    }
  }
  const combined = (continueBase + text).trim()
  return state.database.removeIncompleteResponse ? trimUntilPunctuation(combined) : combined
}

async function transformProviderAlternateTexts(
  state: AssemblyState,
  input: AssembleInput,
  alternateTexts: readonly string[],
): Promise<string[]> {
  const transformed: string[] = []
  for (const text of alternateTexts) {
    try {
      transformed.push(await runServerAlternatePostGeneration(state, text))
    } catch {
      // Keep an alternate usable even if its isolated presentation transform
      // fails; the primary's authoritative post-generation pass is unaffected.
      transformed.push(rawProviderAlternateText(state, input, text))
    }
  }
  return transformed
}

function regenerateTargetMessageIdFromInitialMessages(
  input: AssembleInput,
  initialMessages: readonly Message[] | undefined,
): string | undefined {
  if (input.mode !== 'regenerate') return undefined
  const targetMessageId = input.regenerateMessageId
  if (!targetMessageId) return undefined
  const target = initialMessages?.find((message) => message.chatId === targetMessageId)
  return target?.role === 'char' ? targetMessageId : undefined
}

function rowMatchesSnapshot(row: unknown, snapshot: GenerationFinalizationSnapshotRow): boolean {
  return isDeepStrictEqual(row, snapshot.message)
}

function rowMatchesMessage(row: unknown, message: Message): boolean {
  if (!isRecord(row)) return false
  if (row.role !== message.role || row.data !== message.data) return false
  return message.chatId === undefined || row.chatId === message.chatId
}

function finalizationAlreadyPersisted(args: {
  liveRows: readonly unknown[]
  snapshot: GenerationFinalizationTargetSnapshot
  message: Message
}): boolean {
  if (args.snapshot.kind === 'target-tail') {
    return (
      args.liveRows.length >= args.snapshot.transcriptLength &&
      rowMatchesMessage(args.liveRows[args.snapshot.transcriptLength - 1], args.message)
    )
  }
  return args.liveRows.length > args.snapshot.transcriptLength
    ? rowMatchesMessage(args.liveRows[args.snapshot.transcriptLength], args.message)
    : false
}

function validateGenerationFinalizationTargetFresh(args: {
  chatId: string
  liveRows: readonly unknown[]
  snapshot: GenerationFinalizationTargetSnapshot
  message: Message
}): { alreadyPersisted: boolean } {
  if (finalizationAlreadyPersisted(args)) {
    return { alreadyPersisted: true }
  }

  if (args.liveRows.length !== args.snapshot.transcriptLength) {
    throw new ValidationError(`Generation finalization target is stale for chat ${args.chatId}`)
  }

  const liveTail = args.liveRows.at(-1)
  if (args.snapshot.kind === 'target-tail') {
    if (!rowMatchesSnapshot(liveTail, args.snapshot.target)) {
      throw new ValidationError(`Generation finalization target is stale for chat ${args.chatId}`)
    }
  } else if (args.snapshot.tail) {
    if (!rowMatchesSnapshot(liveTail, args.snapshot.tail)) {
      throw new ValidationError(`Generation finalization target is stale for chat ${args.chatId}`)
    }
  } else if (liveTail !== undefined) {
    throw new ValidationError(`Generation finalization target is stale for chat ${args.chatId}`)
  }

  return { alreadyPersisted: false }
}

class GenerationFinalizationAlreadyPersistedNoop extends Error {
  constructor(readonly revision: number) {
    super('generation finalization already persisted')
    this.name = 'GenerationFinalizationAlreadyPersistedNoop'
  }
}

function readAlreadyPersistedGenerationFinalizationRevision(args: {
  db: DatabaseSync
  chatId: string
  snapshot: GenerationFinalizationTargetSnapshot
  message: Message
}): number | undefined {
  let transactionOpen = false
  args.db.exec('BEGIN IMMEDIATE')
  transactionOpen = true
  try {
    const { revision } = getSchemaState(args.db)
    const alreadyPersisted = finalizationAlreadyPersisted({
      liveRows: getChatMessages(args.db, args.chatId),
      snapshot: args.snapshot,
      message: args.message,
    })
    args.db.exec('COMMIT')
    transactionOpen = false
    return alreadyPersisted ? revision : undefined
  } catch (err) {
    if (transactionOpen) {
      args.db.exec('ROLLBACK')
    }
    throw err
  }
}

function liveChatVarMutationValue(value: unknown): string | number | boolean | null {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  return null
}

function validateGenerationChatVarMutationsFresh(args: {
  chatId: string
  chat: { scriptstate?: Record<string, unknown> }
  chatVarMutations: AssembleMutationPayload['chatVarMutations']
}): void {
  for (const mutation of args.chatVarMutations) {
    const before = liveChatVarMutationValue(args.chat.scriptstate?.[mutation.key])
    if (before !== mutation.before) {
      throw new ValidationError(
        `Generation finalization chat variable is stale for chat ${args.chatId}: ${mutation.key}`,
      )
    }
  }
}

/**
 * Persist a durable generation result in one targeted command mutation against a
 * freshly read chat: apply post-gen scriptstate changes, append/replace the
 * assistant row, and avoid duplicate rows for the same generation.
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
  /** Additional provider choices persisted as reroll candidates atomically. */
  alternateMessages?: readonly Message[]
  chatVarMutations: AssembleMutationPayload['chatVarMutations']
  /**
   * Continue/regenerate target. When set, the result REPLACES the existing
   * message at this id (the regenerate target, or the continue row) rather than
   * appending/replacing by the result's own `chatId` — identical semantics to
   * the legacy browser `/generation-result` command (`lookupMessageId`). `send`
   * leaves it unset and appends by `generationId`.
   */
  targetMessageId?: string
  mode?: GenerationFinalizationMode
  targetSnapshot?: GenerationFinalizationTargetSnapshot
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
  if (args.targetSnapshot) {
    const replayRevision = readAlreadyPersistedGenerationFinalizationRevision({
      db: args.db,
      chatId: args.chatId,
      snapshot: args.targetSnapshot,
      message: args.message,
    })
    if (replayRevision !== undefined) {
      return replayRevision
    }
  }
  const { revision: baseRevision } = getSchemaState(args.db)
  const hasScriptstateWrite = Object.keys(patch).length > 0 || deleteKeys.length > 0
  try {
    const result = applyTargetedCommandMutation<{ chatId: string; messageId: string }>({
      db: args.db,
      dataDir: args.dataDir,
      baseRevision,
      eventSink: args.eventSink,
      mutationPath: 'targeted-generation',
      chatScopedRead: { chatId: args.chatId },
      mutate(database, targetDb) {
        const characters = normalizeAllCharacterChats(database)
        const { character, chat } = requireChatLocation(characters, args.chatId)
        if (args.targetSnapshot) {
          const freshness = validateGenerationFinalizationTargetFresh({
            chatId: args.chatId,
            liveRows: getChatMessages(targetDb, args.chatId),
            snapshot: args.targetSnapshot,
            message: args.message,
          })
          if (freshness.alreadyPersisted) {
            throw new GenerationFinalizationAlreadyPersistedNoop(baseRevision)
          }
          validateGenerationChatVarMutationsFresh({
            chatId: args.chatId,
            chat,
            chatVarMutations: args.chatVarMutations,
          })
        }
        if (hasScriptstateWrite) {
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
        const providerAlternates = (args.alternateMessages ?? []).map((message, index) =>
          createMessageRecord(structuredClone(message), `generationResult.alternateMessages[${index}]`),
        )
        validateUniqueMessageIds([record, ...providerAlternates])
        for (const alternate of providerAlternates) {
          if (activeMessageIdExists(targetDb, alternate.chatId)) {
            throw new ValidationError(`Duplicate message id: ${alternate.chatId}`)
          }
        }
        const write = writeGenerationChatMessage(targetDb, args.chatId, record, args.targetMessageId)
        if (write.ok === false) {
          switch (write.reason) {
            case 'missing-target':
              throw new EntityNotFoundError(`Message not found for chat ${args.chatId}: ${write.targetMessageId}`)
            case 'duplicate':
              throw new ValidationError(`Duplicate message id: ${write.messageId}`)
            case 'ambiguous':
              throw new ValidationError(`Ambiguous message id: ${write.messageId}`)
          }
        }
        // Reroll buffer ("don't lose a rerolled result"):
        //  - regenerate REPLACES a candidate; preserve BOTH the
        //    one it displaces AND the new one it produces as alternate rows, so the
        //    full candidate set of the turn survives a reload and swipe-navigation is
        //    durable for free (flipping the active tail never touches the buffer — the
        //    active is just whichever candidate is positioned, matched by `uid` on
        //    hydration). Dedup by `uid` keeps it
        //    replay-idempotent and free of duplicates as candidates accumulate.
        //  - send / continue is the confirm boundary — drop the chat's reroll buffer.
        //    A targetless same-uid collision is anomalous, however, so preserve
        //    both versions instead of silently discarding the displaced row.
        // Both run inside this mutation's transaction (atomic with the message write).
        const preservesRerollCandidate =
          args.mode !== 'continue' &&
          (!!args.targetMessageId ||
            !!write.displaced ||
            (args.mode === 'regenerate' && countAlternateMessages(targetDb, args.chatId) > 0))
        if (providerAlternates.length > 0) {
          if (!preservesRerollCandidate) clearAlternateMessages(targetDb, args.chatId)
          if (preservesRerollCandidate && write.displaced) addAlternateMessage(targetDb, args.chatId, write.displaced)
          addAlternateMessage(targetDb, args.chatId, record)
          for (const alternate of providerAlternates) {
            addAlternateMessage(targetDb, args.chatId, alternate)
          }
        } else if (preservesRerollCandidate) {
          if (write.displaced) addAlternateMessage(targetDb, args.chatId, write.displaced)
          addAlternateMessage(targetDb, args.chatId, record)
        } else {
          clearAlternateMessages(targetDb, args.chatId)
        }
        if (hasScriptstateWrite) {
          writeSingleChatRow(targetDb, args.chatId, chat)
        }
        const event = hasScriptstateWrite
          ? {
              ...COMMAND_EVENT_CATALOG.generationPersistedWithChatState,
              id: args.chatId,
              parentId: character.chaId as string,
            }
          : {
              ...COMMAND_EVENT_CATALOG.generationPersisted,
              id: write.messageId,
              parentId: args.chatId,
            }
        return {
          event,
          extra: { chatId: args.chatId, messageId: write.messageId },
        }
      },
    })
    return result.revision
  } catch (err) {
    if (err instanceof GenerationFinalizationAlreadyPersistedNoop) {
      return err.revision
    }
    throw err
  }
}

function finalizationModeFromInput(input: AssembleInput): GenerationFinalizationMode {
  return input.mode === 'continue' || input.mode === 'regenerate' ? input.mode : 'send'
}

function isTerminalGenerationFinalizationError(err: unknown): boolean {
  return err instanceof EntityNotFoundError || err instanceof ValidationError
}

function persistGenerationFinalizationAttempt(args: {
  db: DatabaseSync
  dataDir: string
  eventSink: CommandEventSink
  attempt: GenerationFinalizationAttempt
}): number {
  return persistServerGenerationResult({
    db: args.db,
    dataDir: args.dataDir,
    eventSink: args.eventSink,
    chatId: args.attempt.chatId,
    message: args.attempt.message,
    alternateMessages: args.attempt.alternateMessages,
    chatVarMutations: args.attempt.chatVarMutations,
    targetMessageId: args.attempt.targetMessageId,
    mode: args.attempt.mode,
    targetSnapshot: args.attempt.targetSnapshot,
  })
}

function markQueuedGenerationFinalizationFailure(args: {
  db: DatabaseSync
  attempt: GenerationFinalizationAttempt
  err: unknown
}): void {
  markGenerationFinalizationRetryFailure(
    args.db,
    args.attempt.generationId,
    errorMessage(args.err, 'failed to persist the generation result'),
    isTerminalGenerationFinalizationError(args.err),
  )
}

function queueAndPersistGenerationFinalization(args: {
  db: DatabaseSync
  dataDir: string
  eventSink: CommandEventSink
  attempt: GenerationFinalizationAttempt
}): number {
  // Shutdown guard an aborted runner's cancel-persist can land
  // after `onClose` closed the SQLite handle (the runner-settle wait covers
  // tracked runners; this covers any straggler). Fail with a clear error
  // instead of touching a closed database.
  if (!args.db.isOpen) {
    throw new Error('database is closed; generation finalization skipped (server shutting down)')
  }
  enqueueGenerationFinalizationRetry(args.db, args.attempt)
  try {
    const revision = persistGenerationFinalizationAttempt(args)
    deleteGenerationFinalizationRetry(args.db, args.attempt.generationId)
    return revision
  } catch (err) {
    markQueuedGenerationFinalizationFailure({ db: args.db, attempt: args.attempt, err })
    throw err
  }
}

export function retryQueuedGenerationFinalizations(args: {
  db: DatabaseSync
  dataDir: string
  eventSink: CommandEventSink
  logger?: GenerationFinalizationRetryLogger
  maxPerSweep?: number
  pushNotifications?: false | PushNotificationService
  messageTranslationJobs: MessageTranslationJobRegistry
  runMessageTranslation?: ServerMessageTranslationRunner
}): { attempted: number; persisted: number; terminal: number; retryable: number } {
  // Shutdown guard a sweep that fires while `onClose` is tearing
  // down must not touch the closed handle.
  if (!args.db.isOpen) {
    return { attempted: 0, persisted: 0, terminal: 0, retryable: 0 }
  }
  const attempts = listPendingGenerationFinalizationRetries(args.db, args.maxPerSweep ?? 25)
  let persisted = 0
  let terminal = 0
  let retryable = 0
  for (const attempt of attempts) {
    const startedAt = protocolNowMs()
    try {
      const revision = persistGenerationFinalizationAttempt({
        db: args.db,
        dataDir: args.dataDir,
        eventSink: args.eventSink,
        attempt,
      })
      deleteGenerationFinalizationRetry(args.db, attempt.generationId)
      persisted += 1
      void handlePersistedGenerationCompletion({
        db: args.db,
        dataDir: args.dataDir,
        eventSink: args.eventSink,
        messageTranslationJobs: args.messageTranslationJobs,
        message: attempt.message,
        targetMessageId: attempt.targetMessageId,
        chatId: attempt.chatId,
        completedAt: Date.now(),
        pushNotifications: args.pushNotifications,
        runMessageTranslation: args.runMessageTranslation,
      }).catch(() => {
        // Persistence already succeeded; follow-up translation/notification is best-effort.
      })
      emitProtocolMetric('generation_persistence_retry', {
        status: 'ok',
        generationId: attempt.generationId,
        chatId: attempt.chatId,
        revision,
        durationMs: protocolDurationMs(startedAt),
      })
    } catch (err) {
      const isTerminal = isTerminalGenerationFinalizationError(err)
      markGenerationFinalizationRetryFailure(
        args.db,
        attempt.generationId,
        errorMessage(err, 'failed to persist the generation result'),
        isTerminal,
      )
      if (isTerminal) {
        terminal += 1
        args.logger?.warn(
          {
            err,
            generationId: attempt.generationId,
            chatId: attempt.chatId,
          },
          'generation finalization retry reached a terminal failure',
        )
      } else {
        retryable += 1
        args.logger?.warn(
          {
            err,
            generationId: attempt.generationId,
            chatId: attempt.chatId,
          },
          'generation finalization retry failed; it remains queued',
        )
      }
      emitProtocolMetric('generation_persistence_retry', {
        status: isTerminal ? 'terminal_error' : 'retryable_error',
        generationId: attempt.generationId,
        chatId: attempt.chatId,
        durationMs: protocolDurationMs(startedAt),
        error: errorMessage(err, 'failed to persist the generation result'),
      })
    }
  }
  return { attempted: attempts.length, persisted, terminal, retryable }
}

/**
 * Durable-job post-generation pass. Runs server derivation, then persists the
 * **derived** assistant message + post-gen scriptstate delta server-side
 * (mode-aware via the shared
 * `resolvePostGenerationResult` — `send` appends, `continue` extends the last row
 * in place, `regenerate` replaces the target) and folds the bumped revision /
 * final text / resend onto the `done` frame so the (possibly reattached) browser
 * reconciles without persisting.
 *
 * Failure policy (the only divergence from the inline `buildPostGenerationFrame`):
 *  - **derivation throws**: the client may be gone, so persist the raw provider
 *    text and emit a `warning`.
 *  - **persist throws**: record a job `error` the reattaching client sees; do not
 *    force-write.
 */
async function buildDurablePostGeneration(args: {
  emit: (event: PromptChatEvent) => void
  state: AssemblyState
  db: DatabaseSync
  dataDir: string
  eventSink: CommandEventSink
  input: AssembleInput
  completionText: string
  alternateTexts?: readonly string[]
  generationId: string
  generationInfo: Record<string, unknown>
  promptInfo?: Record<string, unknown>
  pushNotifications?: false | PushNotificationService
  messageTranslationJobs: MessageTranslationJobRegistry
  runMessageTranslation?: ServerMessageTranslationRunner
  generationTrace?: GenerationTraceOptions
  metricContext?: PromptAssemblyMetricContext
}): Promise<ProviderPostGenerationResult | undefined> {
  const completedAt = Date.now()
  const {
    postGen,
    postGenError,
    postGenMetricError,
    message,
    targetMessageId,
    chatVarMutations,
    alternateTexts,
    targetSnapshot,
  } = await resolvePostGenerationResult({
    state: args.state,
    input: args.input,
    completionText: args.completionText,
    alternateTexts: args.alternateTexts,
    generationId: args.generationId,
    generationInfo: args.generationInfo,
    promptInfo: args.promptInfo,
    dataDir: args.dataDir,
    durable: true,
    emit: args.emit,
    generationTrace: args.generationTrace,
    metricContext: args.metricContext,
  })
  const alternateMessages = buildProviderAlternateMessages({
    primaryMessage: message,
    alternateTexts,
  })

  let revision: number
  const persistStartedAt = protocolNowMs()
  try {
    revision = queueAndPersistGenerationFinalization({
      db: args.db,
      dataDir: args.dataDir,
      eventSink: args.eventSink,
      attempt: {
        generationId: args.generationId,
        chatId: args.input.chatId,
        mode: finalizationModeFromInput(args.input),
        message,
        alternateMessages,
        chatVarMutations,
        ...(targetMessageId ? { targetMessageId } : {}),
        ...(targetSnapshot ? { targetSnapshot } : {}),
      },
    })
  } catch (err) {
    emitProtocolMetric('generation_persistence', {
      status: isTerminalGenerationFinalizationError(err) ? 'terminal_error' : 'retry_queued',
      generationId: args.generationId,
      chatId: args.input.chatId,
      durationMs: protocolDurationMs(persistStartedAt),
      error: errorMessage(err, 'failed to persist the generation result'),
    })
    args.emit({
      type: 'error',
      error: errorMessage(err, 'failed to persist the generation result'),
      reason: 'generation_persistence_failed',
      persistenceDisposition: isTerminalGenerationFinalizationError(err) ? 'rejected' : 'queued',
      generationProjection: {
        characterId: args.input.characterId,
        chatId: args.input.chatId,
        generationId: args.generationId,
        mode: finalizationModeFromInput(args.input),
        ...(targetMessageId ? { targetMessageId } : {}),
      },
    })
    return { primary: message.data, alternates: alternateTexts }
  }

  // `postGen === undefined` means the derivation threw: the client may be gone, so
  // warn rather than silently keep an optimistic copy (the inline path's choice).
  if (!postGen) {
    emitProtocolMetric('generation_persistence', {
      status: 'raw_fallback',
      generationId: args.generationId,
      chatId: args.input.chatId,
      revision,
      durationMs: protocolDurationMs(persistStartedAt),
      ...(postGenMetricError ? { error: postGenMetricError } : {}),
    })
    args.emit({
      type: 'warning',
      message: 'server post-generation derivation failed; persisted the raw provider text.',
      ...(postGenError ? { context: { error: postGenError } } : {}),
    })
    const messageId = targetMessageId ?? message.chatId
    const translationFollowup = await handlePersistedGenerationCompletion({
      db: args.db,
      dataDir: args.dataDir,
      eventSink: args.eventSink,
      messageTranslationJobs: args.messageTranslationJobs,
      message,
      targetMessageId,
      chatId: args.input.chatId,
      characterId: args.input.characterId,
      completedAt,
      emit: args.emit,
      pushNotifications: args.pushNotifications,
      runMessageTranslation: args.runMessageTranslation,
    })
    return {
      frame: buildPostGenerationFrameBody(
        translationFollowup.revision ?? revision,
        undefined,
        messageId,
        translationFollowup.translation,
      ),
      primary: message.data,
      alternates: alternateTexts,
    }
  }

  emitProtocolMetric('generation_persistence', {
    status: 'ok',
    generationId: args.generationId,
    chatId: args.input.chatId,
    revision,
    durationMs: protocolDurationMs(persistStartedAt),
  })
  const messageId = targetMessageId ?? message.chatId
  const translationFollowup = await handlePersistedGenerationCompletion({
    db: args.db,
    dataDir: args.dataDir,
    eventSink: args.eventSink,
    messageTranslationJobs: args.messageTranslationJobs,
    message,
    targetMessageId,
    chatId: args.input.chatId,
    characterId: args.input.characterId,
    completedAt,
    emit: args.emit,
    pushNotifications: args.pushNotifications,
    runMessageTranslation: args.runMessageTranslation,
  })
  return {
    frame: buildPostGenerationFrameBody(
      translationFollowup.revision ?? revision,
      postGen,
      messageId,
      translationFollowup.translation,
    ),
    primary: message.data,
    alternates: alternateTexts,
  }
}

/**
 * On a **streaming** cancel, persist accumulated-so-far provider text **raw**:
 * no post-gen pass over a truncated turn, mode-aware via `buildRawModeMessage`,
 * and idempotent on `generationId`. A non-streaming cancel persists nothing.
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
  const targetSnapshot = captureGenerationFinalizationTargetSnapshot(args.input, args.state)
  const continueRow = args.input.mode === 'continue' ? findContinueRow(args.state) : undefined
  const raw = buildRawModeMessage({
    input: args.input,
    initialMessages: args.state.initialMessages,
    continueRow,
    text: args.text,
    generationId: args.generationId,
    generationInfo: args.generationInfo,
    promptInfo: args.promptInfo,
    removeIncompleteResponse: args.state.database.removeIncompleteResponse,
  })
  try {
    queueAndPersistGenerationFinalization({
      db: args.db,
      dataDir: args.dataDir,
      eventSink: args.eventSink,
      attempt: {
        generationId: args.generationId,
        chatId: args.input.chatId,
        mode: finalizationModeFromInput(args.input),
        message: raw.message,
        chatVarMutations: [],
        ...(raw.targetMessageId ? { targetMessageId: raw.targetMessageId } : {}),
        ...(targetSnapshot ? { targetSnapshot } : {}),
      },
    })
  } catch {
    // Chat gone / changed during a cancel: nothing to do (job aborted, no client).
  }
}

/**
 * Detached generation runner. Mirrors `streamAssembly`'s assemble -> dispatch ->
 * done flow but (1) pushes the identical SSE frames into the job's `JobRegistry`
 * buffer (`pushRaw`) instead of a request reply, (2) runs on the job's own
 * `AbortController` (deadline / explicit cancel only, never the request
 * connection), and (3) finalizes post-generation output and persists the result
 * server-side. Launched fire-and-forget (`void`); the request connection is just a
 * viewer.
 */
async function runGenerationJob(args: {
  registry: GenerationJobRegistry
  job: StreamJob
  db: DatabaseSync
  input: AssembleInput
  dataDir: string
  eventSink: CommandEventSink
  clientCapabilities: GenerationClientCapabilities
  options: GenerationChatRouteOptions
  messageTranslationJobs: MessageTranslationJobRegistry
  generationTrace?: GenerationTraceOptions
  preparedAssembly?: PromptAssemblyRun
  deferredFailure?: AssemblyDeferredFailure
  metricContext?: PromptAssemblyMetricContext
}): Promise<void> {
  const {
    registry,
    job,
    db,
    input,
    dataDir,
    eventSink,
    clientCapabilities,
    options,
    messageTranslationJobs,
    generationTrace,
    preparedAssembly,
    deferredFailure,
    metricContext = {},
  } = args
  const emit = (event: PromptChatEvent): void => registry.registry.pushRaw(job, formatPromptChatFrame(event))
  const signal = job.abortController.signal
  const generationId = job.id
  let terminalDoneEmitted = false
  try {
    emit({ type: 'stage', stage: 'validate', status: 'start' })
    emit({ type: 'stage', stage: 'validate', status: 'end' })
    emit({ type: 'stage', stage: 'prompt', status: 'start' })

    try {
      if (deferredFailure) throw deferredFailure.error
      if (preparedAssembly) retargetAssemblySignal(preparedAssembly, signal)
      const { result, deps, promptMs, stage2Ms } =
        preparedAssembly ??
        (await assemblePromptWithMetrics(
          input,
          dataDir,
          db,
          signal,
          metricContext,
          (progress) => emit({ type: 'agent_preset_progress', ...progress }),
          options,
        ))
      const database = result.state?.database ?? deps.getDatabase()
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
      emitAssemblyWarnings(result, emit)
      if (!result.stopSending && result.prompt) {
        const successfulResult: SuccessfulAssembleResult = {
          ...result,
          stopSending: false,
          prompt: result.prompt,
        }
        const shouldDispatch = shouldDispatchProvider(input, database)
        const generationInfo =
          shouldDispatch && database
            ? createGenerationInfo(database, generationId, successfulResult, promptMs, stage2Ms)
            : undefined
        const promptEvent = promptEventForClient(result.prompt, clientCapabilities, input.mode)
        const trace = createGenerationTraceContext({
          dataDir,
          generationTrace,
          metricContext,
          generationId,
          durableJobId: job.id,
        })
        await emitGenerationPromptEmissionMetric({
          metricContext,
          input,
          promptEvent,
          formated: successfulResult.formated ?? successfulResult.prompt.formated ?? [],
          promptSummary: result.promptSummary,
          generationId,
          durableJobId: job.id,
          durable: true,
          compactPromptEvent: clientCapabilities.compactPromptEvent,
          shouldDispatch,
          revision: persistedRevision,
          trace,
        })
        emit({ type: 'prompt', ...promptEvent })
        if (result.mutations) {
          emit({ type: 'message_patch', patch: messagePatchForClient(result.mutations, clientCapabilities) })
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
                biases: context.result.biases,
                multiGeneration: context.input.mode !== 'continue',
                currentCharacterName: context.result.state?.currentChar.name,
                signal: context.signal,
                trace: context.trace,
                profile: context.profile,
                history: chatDispatchHistory(db, context),
              }))
          const providerStartedAt = Date.now()
          let frames: AsyncIterable<CompletionStreamFrame> | null | undefined
          try {
            frames = dispatchProviderWithPolicies(
              {
                input,
                result: successfulResult,
                database,
                generationId,
                generationInfo,
                signal,
                trace,
              },
              dispatchProvider,
            )
          } catch (err) {
            emit({
              type: 'error',
              error: errorMessage(err, PROVIDER_DISPATCH_FALLBACK),
              reason: 'provider_dispatch_exception',
              restoration: successfulResult.restoration,
            })
            emit({ type: 'done', generationId, generationInfo })
            terminalDoneEmitted = true
          }
          if (frames) {
            const transportResult = await emitProviderChunks(frames, emit, signal, {
              doneMetadata: () => {
                const stageTiming = generationInfo.stageTiming as Record<string, unknown> | undefined
                if (stageTiming) {
                  stageTiming.stage3 = Date.now() - providerStartedAt
                }
                return { generationId, generationInfo }
              },
              sideEffects: (texts) =>
                database.ttsAutoSpeech
                  ? texts.map((text) => ({
                      type: 'side_effect',
                      kind: 'tts',
                      payload: { text, characterId: input.characterId },
                    }))
                  : [],
              errorRestoration: () => successfulResult.restoration,
              postGeneration: (completionText, alternateTexts) => {
                if (!successfulResult.state) return Promise.resolve(undefined)
                // Stamp stage3 BEFORE the persist so the server-written message's
                // generationInfo carries it (the persist runs ahead of doneMetadata,
                // which would otherwise set it only on the wire `done` frame).
                const stageTiming = generationInfo.stageTiming as Record<string, unknown> | undefined
                if (stageTiming) stageTiming.stage3 = Date.now() - providerStartedAt
                return buildDurablePostGeneration({
                  emit,
                  state: successfulResult.state,
                  db,
                  dataDir,
                  eventSink,
                  input,
                  completionText,
                  alternateTexts,
                  generationId,
                  generationInfo,
                  promptInfo: successfulResult.prompt.promptInfo,
                  pushNotifications: options.pushNotifications,
                  messageTranslationJobs,
                  runMessageTranslation: options.runMessageTranslation,
                  generationTrace,
                  metricContext,
                })
              },
            })
            terminalDoneEmitted = transportResult.status !== 'aborted'
            if (transportResult.status === 'aborted') {
              // A streaming cancel persists the accumulated-so-far text.
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
          emit({ type: 'message_patch', patch: messagePatchForClient(result.mutations, clientCapabilities) })
        }
        const stopError = assemblyStopError(result, database)
        emit({
          type: 'error',
          error: stopError.error,
          reason: stopError.reason,
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
 * Accept a durable generation request. Enforce one-running-job-per-chat (the
 * active-writer submission gate is already enforced by the global guard
 * preHandler), create the job, claim the submission lock, capture the writer
 * identity, attach this connection as the first viewer, then launch the detached
 * runner.
 */
function startDurableGeneration(args: {
  req: FastifyRequest
  reply: FastifyReply
  db: DatabaseSync
  input: AssembleInput
  dataDir: string
  eventSink: CommandEventSink
  clientCapabilities: GenerationClientCapabilities
  options: GenerationChatRouteOptions
  generationTrace?: GenerationTraceOptions
  generationJobs: GenerationJobRegistry
  messageTranslationJobs: MessageTranslationJobRegistry
  preparedAssembly?: PromptAssemblyRun
  deferredFailure?: AssemblyDeferredFailure
  metricContext: PromptAssemblyMetricContext
}): void {
  const { req, reply, input, generationJobs } = args
  if (generationJobs.hasRunningJob(input.chatId)) {
    reply.code(409).send({
      error: 'generation_in_progress',
      reason: 'A generation is already running for this chat.',
    })
    return
  }
  const job = generationJobs.registry.create({
    timeoutMs: undefined,
    heartbeatSec: undefined,
    slidingDeadline: true,
  })
  generationJobs.registry.enableReplay(job)
  job.chatId = input.chatId
  job.writerSessionId = readWriterSessionHeader(req)
  // Record the generating mode and regenerate target so reload-resume can render
  // the right shape.
  job.mode = input.mode === 'continue' || input.mode === 'regenerate' ? input.mode : 'send'
  if (input.mode === 'regenerate') job.regenerateMessageId = input.regenerateMessageId
  generationJobs.register(input.chatId, job.id)
  attachGenerationViewer(req, reply, generationJobs, job, args.options.viewerHeartbeatMs)
  // Fire-and-forget, but tracked: shutdown awaits the runner before closing
  // the database.
  generationJobs.trackRunner(
    runGenerationJob({
      registry: generationJobs,
      job,
      db: args.db,
      input,
      dataDir: args.dataDir,
      eventSink: args.eventSink,
      clientCapabilities: args.clientCapabilities,
      options: args.options,
      generationTrace: args.generationTrace,
      messageTranslationJobs: args.messageTranslationJobs,
      preparedAssembly: args.preparedAssembly,
      deferredFailure: args.deferredFailure,
      metricContext: {
        ...args.metricContext,
        generationId: job.id,
        durableJobId: job.id,
      },
    }),
  )
}

export function registerGenerationChatRoutes(
  app: FastifyInstance,
  db: DatabaseSync,
  authState: AuthState,
  dataDir: string,
  eventSink: CommandEventSink,
  generationJobs: GenerationJobRegistry,
  messageTranslationJobs: MessageTranslationJobRegistry,
  options: GenerationChatRouteOptions = {},
  generationTrace?: GenerationTraceOptions,
): void {
  app.post('/api/v1/generate/chat', { config: { rateLimit: generationSubmitRateLimit } }, async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return

    const body = (req.body ?? {}) as ChatRequestBody
    const validation = validate(body)
    if (validation.ok === false) {
      return badRequest(reply, validation.error)
    }

    const input = toAssembleInput(body)
    const clientCapabilities = readClientCapabilities(body)
    const durable = body.durable === true && isPersistingMode(input.mode)
    const metricContext = createPromptAssemblyMetricContext({
      req,
      input,
      durable,
      clientCapabilities,
    })
    const requestAbort = attachAbort(req, reply)
    const preflight = preflightChatGenerationSettings(reply, input, dataDir, db)
    if (preflight.status === 'handled') {
      requestAbort.cleanup()
      return
    }

    // Durable path for persisting generation modes. The active-writer submission
    // gate ran in the global preHandler; here we add the one-job-per-chat rule
    // and hand off to the detached runner.
    if (durable) {
      startDurableGeneration({
        req,
        reply,
        db,
        input,
        dataDir,
        eventSink,
        clientCapabilities,
        options,
        generationTrace,
        generationJobs,
        messageTranslationJobs,
        deferredFailure: preflight.status === 'defer' ? preflight.failure : undefined,
        metricContext,
      })
      requestAbort.cleanup()
      return
    }

    await streamAssembly(
      req,
      reply,
      db,
      input,
      dataDir,
      eventSink,
      clientCapabilities,
      messageTranslationJobs,
      options,
      generationTrace,
      undefined,
      preflight.status === 'defer' ? preflight.failure : undefined,
      metricContext,
      requestAbort,
    )
  })

  // Reattach to a running, or done-within-grace, durable generation over SSE.
  // Observe is open to any authenticated client; completed jobs are read back via
  // the normal projection refresh.
  app.get<{ Params: { id: string } }>(
    '/api/v1/generate/chat/:id/stream',
    { exposeHeadRoute: false },
    async (req, reply) => {
      if (!(await requireAuth(authState, req, reply))) return
      const job = generationJobs.registry.get(req.params.id)
      if (!job) {
        reply.code(404).send({
          error: 'generation_job_not_found',
          reason: 'Generation job not found or already expired.',
        })
        return
      }
      attachGenerationViewer(req, reply, generationJobs, job, options.viewerHeartbeatMs)
    },
  )

  // Explicit cancel is authorized by the current active writer. It aborts provider
  // dispatch; the runner persists the streaming-so-far text and clears the
  // submission lock. A bare disconnect only detaches.
  app.delete<{ Params: { id: string } }>('/api/v1/generate/chat/:id', async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return
    const job = generationJobs.registry.get(req.params.id)
    if (!job) {
      reply.code(404).send({
        error: 'generation_job_not_found',
        reason: 'Generation job not found or already expired.',
      })
      return
    }
    // Abort only — the runner's finally persists the streaming-so-far text and THEN
    // clears the submission lock. Clearing it here (synchronously, before the
    // async cancel-persist lands) would let an overlapping send for the same chat
    // start and race the cancel write.
    job.abortController.abort()
    return { success: true }
  })

  // One-shot JSON preview. Unlike `/chat`, this never opens an SSE stream, so
  // scope errors surface as real HTTP status codes.
  app.post(
    '/api/v1/generate/preview-prompt',
    { config: { rateLimit: generationSubmitRateLimit } },
    async (req, reply) => {
      if (!(await requireAuth(authState, req, reply))) return

      const body = (req.body ?? {}) as ChatRequestBody
      const validation = validatePreview(body)
      if (validation.ok === false) {
        return badRequest(reply, validation.error)
      }

      const input = toAssembleInput({ ...body, mode: 'preview_prompt' })
      const clientCapabilities = readClientCapabilities(body)
      const metricContext = createPromptAssemblyMetricContext({
        req,
        input,
        durable: false,
        clientCapabilities,
      })
      const { signal, cleanup } = attachAbort(req, reply)
      try {
        const { result, deps } = await assemblePromptWithMetrics(
          input,
          dataDir,
          db,
          signal,
          metricContext,
          undefined,
          options,
        )
        if (result.stopSending) {
          return {
            stopSending: true,
            abortReason: result.abortReason,
            message: assemblyStopError(result, deps.getDatabase()).error,
          }
        }
        return result.prompt ? promptEventForClient(result.prompt, clientCapabilities, input.mode) : result.prompt
      } catch (err) {
        if (sendAssemblyHttpError(reply, err)) return
        throw err
      } finally {
        cleanup()
      }
    },
  )
}
