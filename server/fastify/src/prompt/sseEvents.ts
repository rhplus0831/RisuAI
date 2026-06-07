import type { FastifyReply } from 'fastify'
import type { OpenAIChat } from '../../../../src/ts/process/index.svelte'
import type { AssembleMutationPayload } from './assemble.js'

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
  messages: Array<{ role: string; content: unknown }>
  promptInfo?: Record<string, unknown>
  lorebookActivation?: unknown
  /**
   * The budgeted flat prompt as full `OpenAIChat` rows (7-12b). `messages`
   * is a lossy `{ role, content }` projection of this; `formated` preserves
   * the fields a provider dispatch / preview needs (names, cache points,
   * multimodal content). Additive — the SSE contract stays append-only.
   */
  formated?: OpenAIChat[]
}

export interface InfoEvent {
  type: 'info'
  timings?: Record<string, number>
  tokens?: { prompt?: number; completion?: number; total?: number }
  generationId?: string
  generationInfo?: Record<string, unknown>
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

export interface WarningEvent {
  type: 'warning'
  message: string
  context?: Record<string, unknown>
}

export interface ErrorEvent {
  type: 'error'
  error: string
  restoration?: unknown
}

/**
 * Server post-generation derivation surfaced on the terminal `done` frame. Present
 * only when the post-gen pass produced something; trigger-less / script-less sends
 * omit it entirely.
 */
export interface PostGenerationFrame {
  /**
   * The `editoutput`'d + run-var'd assistant text (server-owned final text). The
   * browser writes it onto the just-streamed assistant message in place of its
   * own copy (it no longer runs `editoutput` on the server path). Present only
   * when the pass actually changed the text.
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
   * re-issues `sendChat` — the resend control flow stays browser-side (B2).
   */
  resendChat?: boolean
  /**
   * The chat revision after the route persisted the post-gen scriptstate delta.
   * The browser reconciles its cached command revision to it so the follow-up
   * generation-result command does not revision-conflict. Mirrors C-A1's
   * `info.revision`, but for the post-gen write.
   */
  revision?: number
}

export interface DoneEvent {
  type: 'done'
  result?: string
  generationId?: string
  generationInfo?: Record<string, unknown>
  /** Server post-generation derivation. See {@link PostGenerationFrame}. */
  postGeneration?: PostGenerationFrame
}

export type PromptChatEvent =
  | StageEvent
  | JobAcceptedEvent
  | PromptEvent
  | InfoEvent
  | TokenEvent
  | MessagePatchEvent
  | SideEffectEvent
  | WarningEvent
  | ErrorEvent
  | DoneEvent

export type PromptChatEventType = PromptChatEvent['type']

export const PROMPT_CHAT_EVENT_TYPES = [
  'stage',
  'job_accepted',
  'prompt',
  'info',
  'token',
  'message_patch',
  'side_effect',
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
