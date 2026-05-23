import type { FastifyReply } from 'fastify'
import type { OpenAIChat } from '../../../../src/ts/process/index.svelte'
import type { AssembleMutationPayload } from './assemble.js'

/**
 * Phase 7 SSE event taxonomy for `POST /api/v1/generate/chat`.
 *
 * Each event maps 1:1 to a named SSE `event:` line. The discriminator
 * (`type`) is encoded as the SSE event name; the JSON `data:` line carries
 * the remaining fields.
 *
 * IMPORTANT: per `docs/fastify/phases/phase-7-prompt-assembly.md`, this
 * shape is locked once shipped. Phase 9 must not rename events. Adding new
 * fields is fine; renaming or removing is not.
 */

export type PromptChatStage = 'validate' | 'prompt' | 'provider' | 'done'

export interface StageEvent {
  type: 'stage'
  stage: PromptChatStage
  status: 'start' | 'end'
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
  /** Logit-bias rows for dispatch (7-12b). */
  biases?: [string, number][]
}

export interface InfoEvent {
  type: 'info'
  timings?: Record<string, number>
  tokens?: { prompt?: number; completion?: number; total?: number }
  /**
   * The clamped response token budget (`finalizeRequestBudget`). This is a
   * budget, not a completion count, so it is surfaced separately rather than
   * folded into `tokens.completion`.
   */
  responseBudget?: number
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

export interface DoneEvent {
  type: 'done'
  result?: string
  generationInfo?: Record<string, unknown>
}

export type PromptChatEvent =
  | StageEvent
  | PromptEvent
  | InfoEvent
  | TokenEvent
  | MessagePatchEvent
  | SideEffectEvent
  | WarningEvent
  | ErrorEvent
  | DoneEvent

export function writePromptChatEvent(reply: FastifyReply, event: PromptChatEvent): void {
  const { type, ...rest } = event
  reply.raw.write(`event: ${type}\ndata: ${JSON.stringify(rest)}\n\n`)
}
