/**
 * Client-side mirror of the `POST /api/v1/generate/chat` SSE taxonomy.
 *
 * Source of truth: `server/fastify/src/prompt/sseEvents.ts`. That contract
 * is **locked once shipped** — events may gain fields but must not be
 * renamed or removed — so keep these shapes additive-only and in sync with
 * the server. The discriminator (`type`) is carried as the SSE `event:`
 * name; the JSON `data:` line holds the rest of the fields.
 *
 * Phase 7-12a (read-only) consumes `stage` / `prompt` / `info` / `error` /
 * `done`. The dispatch-coupled `token` / `message_patch` / `side_effect` /
 * `warning` events are declared here for completeness but are tolerated
 * (ignored) until provider dispatch lands in Phase 7-12c/d.
 */

import type { OpenAIChat } from '../index.svelte'

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
   * is a lossy `{ role, content }` projection; `formated` preserves the
   * fields a preview / dispatch needs. Optional — older servers omit it.
   */
  formated?: OpenAIChat[]
  /** Logit-bias rows for dispatch (7-12b). */
  biases?: [string, number][]
}

export interface InfoEvent {
  type: 'info'
  timings?: Record<string, number>
  tokens?: { prompt?: number; completion?: number; total?: number }
  responseBudget?: number
}

export interface TokenEvent {
  type: 'token'
  content: string
}

export interface MessagePatchEvent {
  type: 'message_patch'
  patch: unknown
}

export interface SideEffectEvent {
  type: 'side_effect'
  kind: 'tts' | 'image' | 'inlay_screen' | 'hypav3_progress' | 'stable_diff'
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
