/**
 * Client-side mirror of the `POST /api/v1/generate/chat` SSE taxonomy.
 *
 * Source of truth: `server/fastify/src/prompt/sseEvents.ts`. That contract
 * is **locked once shipped** — events may gain fields but must not be
 * renamed or removed — so keep these shapes additive-only and in sync with
 * the server. The discriminator (`type`) is carried as the SSE `event:`
 * name; the JSON `data:` line holds the rest of the fields.
 *
 * Prompt assembly consumes `stage` / `prompt` / `message_patch` / `info` /
 * `error` / `done`; generation streams also use `token` / `side_effect` /
 * `warning`.
 */

import type { Message } from '../../storage/database.svelte'
import type { OpenAIChat } from '../index.svelte'

export type PromptChatStage = 'validate' | 'prompt' | 'provider' | 'done'

export interface StageEvent {
  type: 'stage'
  stage: PromptChatStage
  status: 'start' | 'end'
}

/**
 * First durable-generation frame, carrying the server-side job id so the
 * browser can cancel or reattach even if the stream drops before dispatch.
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
   * `messages` is a lossy `{ role, content }` projection; `formated` preserves
   * fields a preview / dispatch needs. Optional for older servers.
   */
  formated?: OpenAIChat[]
  /** Logit-bias rows for dispatch. */
  biases?: [string, number][]
}

export interface InfoEvent {
  type: 'info'
  timings?: Record<string, number>
  tokens?: { prompt?: number; completion?: number; total?: number }
  responseBudget?: number
  generationId?: string
  generationInfo?: Record<string, unknown>
  /**
   * The chat revision after the route persisted the assembly-time chat-var
   * delta. Present only when a persisting mode actually wrote `chatVarMutations`;
   * the browser reconciles its cached command revision to avoid the next command
   * conflicting.
   */
  revision?: number
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
  | 'input_trigger'
  | 'editinput'
  | 'output_trigger'

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

export type ServerChatWarning = Omit<WarningEvent, 'type'>

export interface ErrorEvent {
  type: 'error'
  error: string
  restoration?: ServerChatRestoration
}

/**
 * Server post-generation derivation, surfaced on the terminal `done` frame.
 * Mirrors `PostGenerationFrame` in the server `sseEvents.ts`. The browser applies
 * `messagePatch`, writes `finalText` onto the just-streamed assistant message,
 * reconciles `revision`, and re-issues on `resendChat`.
 */
export interface ServerChatPostGeneration {
  finalText?: string
  messagePatch?: ServerChatMessagePatch
  resendChat?: boolean
  revision?: number
}

export interface DoneEvent {
  type: 'done'
  result?: string
  generationId?: string
  generationInfo?: Record<string, unknown>
  /** Server post-generation derivation. See {@link ServerChatPostGeneration}. */
  postGeneration?: ServerChatPostGeneration
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

export const CLIENT_PROMPT_CHAT_EVENT_TYPES = [
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
