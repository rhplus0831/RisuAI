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
 * `agent_preset_progress` / `post_generation_progress` / `warning`.
 */

import type { Message, MessageTranslation } from '../../storage/database.svelte'
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
  /** The provider stream is buffered for display while throughput remains live. */
  halfStreaming?: boolean
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
  /** Cumulative server-tokenized completion count for half-streaming telemetry. */
  generatedTokens?: number
  /** Milliseconds since provider dispatch began. */
  elapsedMs?: number
}

export type ServerChatMutationSource =
  | 'user_message'
  | 'regenerate'
  | 'run_var'
  | 'history_normalize'
  | 'history_inject'
  | 'start_trigger'
  | 'input_trigger'
  | 'editinput'
  | 'agent_preset'
  | 'output_trigger'

export type ServerChatVarMutationValue = string | number | boolean | null

export interface ServerChatVarMutation {
  key: string
  before: ServerChatVarMutationValue
  after: ServerChatVarMutationValue
}

export interface ServerChatMetadataMutation {
  key: 'lastMemory'
  before: string | null
  after: string | null
}

export interface ServerChatCharacterFieldMutation {
  key: 'name' | 'firstMessage' | 'backgroundHTML'
  before: string | null
  after: string
}

export interface ServerChatLocalLoreMutation {
  before: unknown[]
  after: unknown[]
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
      firstChangedIndex?: number
      messages: Message[]
    }
  | {
      type: 'replace_by_id'
      source: 'history_inject'
      messageId: string
      before: Message
      message: Message
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
  chatMetadataMutations?: ServerChatMetadataMutation[]
  characterFieldMutations?: ServerChatCharacterFieldMutation[]
  localLoreMutation?: ServerChatLocalLoreMutation
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

export type AgentPresetProgressPhase = 'beforeMain' | 'afterMain'
export type AgentPresetProgressStatus = 'started' | 'running' | 'finished' | 'error'

export interface AgentPresetProgressStep {
  stepId: string
  stepName: string
  outputKey: string
}

export interface AgentPresetProgressEvent {
  type: 'agent_preset_progress'
  chatId: string
  presetId: string
  presetName: string
  phase: AgentPresetProgressPhase
  status: AgentPresetProgressStatus
  totalSteps: number
  completedSteps: number
  activeSteps: AgentPresetProgressStep[]
}

export type ServerChatSideEffect = Omit<SideEffectEvent, 'type'>

export type PostGenerationProgressPhase = 'editOutput' | 'onOutput' | 'translation'
export type PostGenerationProgressStatus = 'started' | 'running' | 'finished' | 'error' | 'translating'
export type PostGenerationProgressOwnerType = 'character' | 'module'
export type PostGenerationProgressLlmFunction = 'LLM' | 'axLLM'

export interface PostGenerationProgressEvent {
  type: 'post_generation_progress'
  phase: PostGenerationProgressPhase
  status: PostGenerationProgressStatus
  runSeq: number
  ownerType?: PostGenerationProgressOwnerType
  ownerId?: string
  ownerName?: string
  triggerId?: string
  triggerIndex?: number
  triggerComment?: string
  triggerType?: string
  effectIndex?: number
  effectType?: string
  llmCallCount: number
  pendingLlmCount: number
  llmCallCounts: Record<PostGenerationProgressLlmFunction, number>
  pendingLlmCounts: Record<PostGenerationProgressLlmFunction, number>
  messageId?: string
  jobId?: string
}

export interface WarningEvent {
  type: 'warning'
  message: string
  context?: Record<string, unknown>
}

export type ServerChatWarning = Omit<WarningEvent, 'type'>

export interface ErrorEvent {
  type: 'error'
  error: string
  reason?: string
  status?: number
  statusText?: string
  code?: string
  restoration?: ServerChatRestoration
  persistenceDisposition?: 'queued' | 'rejected'
  generationProjection?: ServerChatGenerationProjection
}

export interface ServerChatGenerationProjection {
  characterId: string
  chatId: string
  generationId: string
  mode: 'send' | 'continue' | 'regenerate'
  targetMessageId?: string
}

export interface ServerChatAgentPresetError {
  error: 'agent_preset_generation_failed'
  message: string
  statusCode: number
  phase?: 'beforeMain' | 'afterMain'
  presetId?: string
  presetName?: string
  stepId?: string
  stepName?: string
  outputKey?: string
  failureKind?: string
  failurePolicyOutcome?: string
  diagnostics?: unknown
}

/**
 * Server terminal message reconciliation, mirroring `PostGenerationFrame` in
 * the server `sseEvents.ts`. Completed generations can carry the derivation
 * fields; cancelled generations can carry only persisted partial-row identity
 * and revision. The browser applies success-only fields only on completion.
 */
export interface ServerChatPostGeneration {
  messageId?: string
  finalText?: string
  messagePatch?: ServerChatMessagePatch
  resendChat?: boolean
  agentPresetError?: ServerChatAgentPresetError
  revision?: number
  translation?: ServerChatPostGenerationTranslation
}

export type ServerChatPostGenerationTranslation =
  | { status: 'succeeded'; jobId: string; translation: MessageTranslation }
  | { status: 'failed'; jobId: string; error: string }
  | { status: 'running'; jobId: string }

export interface DoneEvent {
  type: 'done'
  /**
   * Additive terminal disposition. Absence is backward-compatible completed
   * behavior; durable cancellation explicitly reports `cancelled`.
   */
  outcome?: 'completed' | 'cancelled'
  /**
   * Full completion fallback. A negotiated inline stream may omit it after
   * preceding token events delivered the same non-empty text. Durable streams
   * retain it for replay and reattach.
   */
  result?: string
  /** Additional provider choices returned by multi-generation (`genTime`). */
  alternates?: string[]
  generationId?: string
  generationInfo?: Record<string, unknown>
  /** Server terminal message reconciliation. See {@link ServerChatPostGeneration}. */
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
  | AgentPresetProgressEvent
  | PostGenerationProgressEvent
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
  'agent_preset_progress',
  'post_generation_progress',
  'warning',
  'error',
  'done',
] as const satisfies readonly PromptChatEventType[]
