/**
 * Client-side mirror of the `POST /api/v1/generate/chat` SSE taxonomy.
 *
 * Source of truth: `server/fastify/src/prompt/sseEvents.ts`. That contract
 * is **locked once shipped** — events may gain fields but must not be
 * renamed or removed — so keep these shapes additive-only and in sync with
 * the server. The discriminator (`type`) is carried as the SSE `event:`
 * name; the JSON `data:` line holds the rest of the fields.
 *
 * Phase 7-12d-ii consumes `stage` / `prompt` / `message_patch` / `info` /
 * `error` / `done`. The remaining dispatch-coupled `token` / `side_effect` /
 * `warning` events are declared here for completeness and tolerated until
 * later send-path dispatch slices land.
 */

import type { Message } from '../../storage/database.svelte'
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
  generationId?: string
  generationInfo?: Record<string, unknown>
}

export interface TokenEvent {
  type: 'token'
  content: string
}

export type ServerChatMutationSource =
  | 'user_message'
  | 'regenerate'
  | 'run_var'
  | 'history_normalize'
  | 'start_trigger'

export type ServerChatVarMutationValue = string | number | boolean | null

export interface ServerChatVarMutation {
  key: string
  before: ServerChatVarMutationValue
  after: ServerChatVarMutationValue
}

export type ServerChatMessageMutation =
  | {
      type: 'append'
      source: 'user_message'
      index: number
      message: Message
    }
  | {
      type: 'replace_all'
      source: Exclude<ServerChatMutationSource, 'user_message'>
      beforeLength: number
      afterLength: number
      messages: Message[]
    }

export interface ServerChatAdditionalSystemPromptMutation {
  type: 'insert_prompt_row'
  source: 'additional_sys_prompt'
  origin: 'start' | 'historyend' | 'promptend'
  slot: 'lastChat' | 'postEverything'
  placement: 'push' | 'unshift'
  row: OpenAIChat
}

export interface ServerChatMessagePatch {
  chatId: string
  characterId: string
  selectedCharID: number
  chatPage: number
  varChanged: boolean
  messageMutations: ServerChatMessageMutation[]
  chatVarMutations: ServerChatVarMutation[]
  additionalSystemPrompt: ServerChatAdditionalSystemPromptMutation[]
}

export interface ServerChatRestoration {
  chatId: string
  characterId: string
  selectedCharID: number
  chatPage: number
  messages: Message[]
  scriptstate?: Record<string, string | number | boolean>
}

export interface MessagePatchEvent {
  type: 'message_patch'
  patch: ServerChatMessagePatch
}

export interface SideEffectEvent {
  type: 'side_effect'
  kind: 'tts' | 'image' | 'inlay_screen' | 'hypav3_progress' | 'stable_diff'
  payload: unknown
}

export type ServerChatSideEffect = Omit<SideEffectEvent, 'type'>

export interface WarningEvent {
  type: 'warning'
  message: string
  context?: Record<string, unknown>
}

export interface ErrorEvent {
  type: 'error'
  error: string
  restoration?: ServerChatRestoration
}

export interface DoneEvent {
  type: 'done'
  result?: string
  generationId?: string
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
