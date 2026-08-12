import type { FastifyReply } from 'fastify'
import type { OpenAIChat } from '../../../../src/ts/process/index.svelte'
import type { AssembleMutationPayload } from './assemble.js'
import type { AgentPresetGenerationErrorBody } from './agentPresetExecution.js'
import type { AgentPresetProgress } from './agentPresetExecution.js'
import type { PostGenerationLuaProgressEvent } from './luaPostGenerationProgress.js'
import type { RawMessageTranslation } from '../translation/rawMessageTranslation.js'
import type { GenerationEffectLedgerRef } from '../generationEffects.js'

/**
 * SSE event taxonomy for `POST /api/v1/generate/chat`.
 *
 * Each event maps 1:1 to a named SSE `event:` line. The discriminator
 * (`type`) is encoded as the SSE event name; the JSON `data:` line carries
 * the remaining fields.
 *
 * IMPORTANT: this shape is locked once shipped. Adding new fields is fine;
 * renaming or removing is not.
 */

export type PromptChatStage = 'validate' | 'prompt' | 'provider' | 'done'

export interface LineageEnvelope {
  databaseLineage: string
  operationId: string
  writerSessionId: string
  writerEpoch: number
  operationStateVersion: number
  projectionEpoch: number
  attemptNo: number
  jobId: string
  acceptedMessageId?: string
  targetMessageId?: string
}

export interface StageEvent {
  type: 'stage'
  stage: PromptChatStage
  status: 'start' | 'end'
}

/**
 * First frame on a durable send / reattach, carrying the `jobId` so a client that
 * drops during assembly still knows the id to reattach with. The non-durable path
 * never emits it.
 */
export interface JobAcceptedEvent {
  type: 'job_accepted'
  jobId: string
}

export interface PromptEvent {
  type: 'prompt'
  messages?: Array<{ role: string; content: unknown }>
  promptInfo?: Record<string, unknown>
  lorebookActivation?: unknown
  /**
   * The budgeted flat prompt as full `OpenAIChat` rows. When present,
   * `messages` is a lossy `{ role, content }` projection of this; `formated`
   * preserves the fields a provider dispatch / preview needs (names, cache
   * points, multimodal content).
   */
  formated?: OpenAIChat[]
  biases?: [string, number][]
}

export interface InfoEvent {
  type: 'info'
  timings?: Record<string, number>
  tokens?: { prompt?: number; completion?: number; total?: number }
  /** The provider stream is buffered for display while throughput remains live. */
  halfStreaming?: boolean
  generationId?: string
  generationInfo?: Record<string, unknown>
  /** Server-selected Continue row behavior. Absent for non-Continue/older servers. */
  continueDisposition?: 'append' | 'extend'
  /**
   * The clamped response token budget (`finalizeRequestBudget`). This is a
   * budget, not a completion count, so it is surfaced separately rather than
   * folded into `tokens.completion`.
   */
  responseBudget?: number
  /**
   * The chat revision after the route persisted the assembly-time chat-var delta.
   * Present only when a persisting mode actually wrote `chatVarMutations`; omitted
   * when nothing was persisted.
   */
  revision?: number
}

export interface TokenEvent {
  type: 'token'
  content: string
  /** Cumulative server-tokenized completion count for half-streaming telemetry. */
  generatedTokens?: number
  /** Milliseconds since provider dispatch began. */
  elapsedMs?: number
}

/**
 * Additive durable-replay signal. The retained frames after this marker are a
 * truncated window; consumers must wait for the canonical terminal snapshot
 * before treating generated text as complete.
 */
export interface ReplayGapEvent {
  type: 'replay_gap'
  reason: 'replay_budget_exceeded'
  jobId: string
  evictedEvents: number
  evictedBytes: number
}

export interface MessagePatchEvent {
  type: 'message_patch'
  patch: AssembleMutationPayload
}

export type SideEffectKind = 'tts' | 'image' | 'inlay_screen' | 'hypav3_progress' | 'stable_diff'

export interface SideEffectEvent {
  type: 'side_effect'
  kind: SideEffectKind
  payload: unknown
}

export interface AgentPresetProgressEvent extends AgentPresetProgress {
  type: 'agent_preset_progress'
}

export interface WarningEvent {
  type: 'warning'
  message: string
  context?: Record<string, unknown>
}

export type GenerationPersistenceDisposition = 'queued' | 'rejected' | 'unconfirmed' | 'committed_cleanup_pending'

export interface ErrorEvent {
  type: 'error'
  error: string
  reason?: string
  status?: number
  statusText?: string
  code?: string
  restoration?: unknown
  persistenceDisposition?: Exclude<GenerationPersistenceDisposition, 'committed_cleanup_pending'>
  generationProjection?: {
    characterId: string
    chatId: string
    generationId: string
    mode: 'send' | 'continue' | 'regenerate'
    targetMessageId?: string
  }
}

export interface PostGenerationTranslationProgressEvent {
  type: 'post_generation_progress'
  phase: 'translation'
  status: 'translating'
  runSeq: 0
  messageId: string
  jobId: string
  llmCallCount: 0
  pendingLlmCount: 0
  llmCallCounts: { LLM: 0; axLLM: 0 }
  pendingLlmCounts: { LLM: 0; axLLM: 0 }
}

export type PostGenerationTranslationFrame =
  | { status: 'succeeded'; jobId: string; translation: RawMessageTranslation }
  | { status: 'failed'; jobId: string; error: string }
  | { status: 'running'; jobId: string }

/**
 * Server terminal message reconciliation. Completed generations may carry the
 * post-generation derivation; cancelled generations may carry the exact
 * persisted partial-row text along with its identity and revision.
 */
export interface PostGenerationFrame {
  /** Stable id of the persisted generated row (including continue/regenerate targets). */
  messageId?: string
  /**
   * The `editoutput`'d + run-var'd assistant text (server-owned final text). The
   * browser writes it onto the just-streamed assistant message in place of its
   * own copy (it no longer runs `editoutput` on the server path). On completion
   * it is present only when the pass changed the text; on cancellation it is the
   * exact persisted raw snapshot.
   */
  finalText?: string
  /**
   * The post-generation scriptstate (+ any output-trigger message) delta — the
   * same shape as the assembly `message_patch`. The browser applies it to its
   * projection at terminal time (after the stream, not at assembly time).
   */
  messagePatch?: AssembleMutationPayload
  /**
   * The `'output'` trigger requested a resend (`sendAIprompt`). The browser
   * re-issues `sendChat`; the resend control flow stays browser-side.
   */
  resendChat?: boolean
  /** Structured Agent Preset after-main failure, when present. */
  agentPresetError?: AgentPresetGenerationErrorBody
  /**
   * The chat revision after the route persisted the post-gen scriptstate delta.
   * The browser reconciles its cached command revision to it so the follow-up
   * generation-result command does not revision-conflict.
   */
  revision?: number
  /** Server-owned automatic raw-message translation outcome at frame release. */
  translation?: PostGenerationTranslationFrame
  /** Exact durable effect identity; additive for clients that support effect receipts. */
  effectLedger?: GenerationEffectLedgerRef
}

export interface DoneEvent {
  type: 'done'
  /**
   * Additive terminal disposition. Omitted by older servers and ordinary
   * successful completions, where clients must continue to assume `completed`.
   */
  outcome?: 'completed' | 'cancelled'
  /**
   * Full completion fallback. A negotiated inline stream may omit it when its
   * preceding token events already delivered the same non-empty text. Durable
   * streams retain it so replay and reattach remain self-contained.
   */
  result?: string
  /**
   * Durable side-channel reference used when the full terminal payload is not
   * resident in the replay buffer. The authenticated endpoint returns the
   * complete `done` data object, including `result` when present.
   */
  terminalSnapshot?: {
    version: 1
    href: string
    bytes: number
  }
  /** Additional provider choices returned by multi-generation (`genTime`). */
  alternates?: string[]
  generationId?: string
  generationInfo?: Record<string, unknown>
  /** Server terminal message reconciliation. See {@link PostGenerationFrame}. */
  postGeneration?: PostGenerationFrame
  /** The message committed, but finalization-journal cleanup still needs a retry sweep. */
  persistenceDisposition?: 'committed_cleanup_pending'
  /** Authoritative durable operation state at terminal-frame emission. */
  operationState?:
    | 'cancel_requested'
    | 'accepted'
    | 'launching'
    | 'owned_by_job'
    | 'stopping'
    | 'retryable'
    | 'abandoned'
    | 'completed'
    | 'cancelled'
    | 'terminal_failed'
    | 'invalidated'
    | 'finalizing'
}

type PromptChatEventPayload =
  | StageEvent
  | JobAcceptedEvent
  | PromptEvent
  | InfoEvent
  | TokenEvent
  | ReplayGapEvent
  | MessagePatchEvent
  | SideEffectEvent
  | AgentPresetProgressEvent
  | PostGenerationLuaProgressEvent
  | PostGenerationTranslationProgressEvent
  | WarningEvent
  | ErrorEvent
  | DoneEvent

/** Lineage is additive for old streams and complete on operation-owned jobs. */
export type PromptChatEvent = PromptChatEventPayload & Partial<LineageEnvelope>

export type PromptChatEventType = PromptChatEvent['type']

export const PROMPT_CHAT_EVENT_TYPES = [
  'stage',
  'job_accepted',
  'prompt',
  'info',
  'token',
  'replay_gap',
  'message_patch',
  'side_effect',
  'agent_preset_progress',
  'post_generation_progress',
  'warning',
  'error',
  'done',
] as const satisfies readonly PromptChatEventType[]

/**
 * Serialize a chat event to its named-event SSE frame. Extracted from
 * {@link writePromptChatEvent} so the durable-generation runner can buffer the
 * identical frame string into the `JobRegistry` (`pushRaw`) for replay on
 * reattach — the connected and durable paths emit byte-identical frames.
 */
export function formatPromptChatFrame(event: PromptChatEvent): string {
  const { type, ...rest } = event
  return `event: ${type}\ndata: ${JSON.stringify(rest)}\n\n`
}

export function writePromptChatEvent(reply: FastifyReply, event: PromptChatEvent): void {
  reply.raw.write(formatPromptChatFrame(event))
}
