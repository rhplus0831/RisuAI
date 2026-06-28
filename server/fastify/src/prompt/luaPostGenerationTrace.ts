import { createHash } from 'node:crypto'
import type { Chat, Message } from '../../../../src/ts/storage/database.svelte'
import type { TriggerSourceAttribution } from './triggerSource.js'

export type PostGenerationLuaTracePhase = 'editOutput' | 'onOutput'
export type PostGenerationLuaTraceStatus = 'ok' | 'error'
export type LuaTraceLlmFunction = 'LLM' | 'axLLM'
export type LuaTraceChatFunction = 'setChat' | 'setChatRole' | 'cutChat' | 'removeChat' | 'addChat'
export type LuaTraceHostFunction = LuaTraceLlmFunction | LuaTraceChatFunction | 'log'

interface TraceMessageBody {
  index: number
  role: Message['role']
  body: string
  chatId?: string
  name?: string
}

interface TraceValueSummary {
  sha256: string
  bytes: number
}

interface TraceMessageSummary extends TraceValueSummary {
  role?: Message['role']
  dataSha256?: string
  dataBytes?: number
}

export type ServerLuaRuntimeTraceHostEvent =
  | {
      type: 'log'
      fn: 'log'
      value: unknown
      valueSummary: TraceValueSummary
    }
  | {
      type: 'llm'
      fn: LuaTraceLlmFunction
      status: 'blocked' | 'completed' | 'failed'
      promptSummary?: TraceValueSummary
      success?: boolean
      error?: string
    }
  | {
      type: 'chat'
      fn: LuaTraceChatFunction
      status: 'blocked' | 'missing' | 'changed' | 'unchanged'
      index?: number
      start?: number
      end?: number
      role?: string
      before?: TraceMessageSummary
      after?: TraceMessageSummary
      messageCountBefore?: number
      messageCountAfter?: number
      valueSummary?: TraceValueSummary
    }

export interface ServerLuaRuntimeTraceSink {
  recordHostEvent(event: ServerLuaRuntimeTraceHostEvent): void
}

export interface PostGenerationLuaTraceRunSummary {
  seq: number
  phase: PostGenerationLuaTracePhase
  mode: string
  status: PostGenerationLuaTraceStatus
  codeSha256: string
  codeBytes: number
  handlerRegistered?: boolean
  transcriptChanged: boolean
  editOutputTextChanged?: boolean
  hostEventCount: number
  logCount: number
  llmAttemptCount: number
  llmBlockedCount: number
  llmCompletedCount: number
  llmFailedCount: number
  axLlmAttemptCount: number
  axLlmBlockedCount: number
  axLlmCompletedCount: number
  axLlmFailedCount: number
  setChatCount: number
  setChatChangedCount: number
  ownerType?: string
  ownerName?: string
  ownerId?: string
  triggerIndex?: number
  triggerId?: string
  triggerComment?: string
  effectIndex?: number
  effectType?: string
  errorKind?: string
}

export interface PostGenerationLuaTraceMetricSummary {
  runCount: number
  hostEventCount: number
  logCount: number
  llmAttemptCount: number
  llmBlockedCount: number
  llmCompletedCount: number
  llmFailedCount: number
  axLlmAttemptCount: number
  axLlmBlockedCount: number
  axLlmCompletedCount: number
  axLlmFailedCount: number
  setChatCount: number
  setChatChangedCount: number
  transcriptChanged: boolean
  editOutputTextChanged: boolean
  runs: PostGenerationLuaTraceRunSummary[]
}

export interface PostGenerationLuaTracePayload {
  kind: 'generation_lua_post_generation_trace'
  status: PostGenerationLuaTraceStatus
  error?: string
  chatId: string
  characterId: string
  mode: string
  generationId: string
  durable: boolean
  requestUid?: string
  requestId?: string
  runs: PostGenerationLuaTraceRunPayload[]
}

interface PostGenerationLuaTraceRunPayload extends PostGenerationLuaTraceRunSummary {
  source?: TriggerSourceAttribution
  chatBefore: TraceMessageBody[]
  chatAfter: TraceMessageBody[]
  editOutputTextBefore?: string
  editOutputTextAfter?: string
  runtimeMetricFields?: Record<string, unknown>
  error?: string
  hostEvents: Array<ServerLuaRuntimeTraceHostEvent & { seq: number }>
}

interface PostGenerationLuaTraceRun extends Omit<PostGenerationLuaTraceRunPayload, 'status' | 'chatAfter'> {
  status?: PostGenerationLuaTraceStatus
  chatAfter?: TraceMessageBody[]
}

export interface BeginPostGenerationLuaTraceRunInput {
  phase: PostGenerationLuaTracePhase
  mode: string
  code: string
  source?: TriggerSourceAttribution
  chat: Chat
  editOutputTextBefore?: string
}

export interface FinishPostGenerationLuaTraceRunInput {
  status: PostGenerationLuaTraceStatus
  chat: Chat
  editOutputTextAfter?: string
  runtimeMetricFields?: Record<string, unknown>
  error?: string
}

export interface PostGenerationLuaTraceRunHandle {
  sink: ServerLuaRuntimeTraceSink
  finish(input: FinishPostGenerationLuaTraceRunInput): void
}

export interface PostGenerationLuaTracePayloadContext {
  status: PostGenerationLuaTraceStatus
  error?: string
  chatId: string
  characterId: string
  mode: string
  generationId: string
  durable: boolean
  requestUid?: string
  requestId?: string
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function textSummary(value: unknown): TraceValueSummary {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  const normalized = text === undefined ? String(value) : text
  return {
    sha256: sha256Hex(normalized),
    bytes: Buffer.byteLength(normalized, 'utf8'),
  }
}

export function summarizeLuaTraceValue(value: unknown): TraceValueSummary {
  return textSummary(value)
}

export function summarizeLuaTraceMessage(message: Message | undefined): TraceMessageSummary | undefined {
  if (!message) return undefined
  const data = message.data ?? ''
  return {
    ...textSummary({ role: message.role, data, chatId: message.chatId, name: message.name }),
    role: message.role,
    dataSha256: sha256Hex(data),
    dataBytes: Buffer.byteLength(data, 'utf8'),
  }
}

function cloneChatBody(chat: Chat): TraceMessageBody[] {
  return (chat.message ?? []).map((message, index) => ({
    index,
    role: message.role,
    body: message.data ?? '',
    ...(message.chatId ? { chatId: message.chatId } : {}),
    ...(message.name ? { name: message.name } : {}),
  }))
}

function chatBodyHash(body: TraceMessageBody[]): string {
  return sha256Hex(JSON.stringify(body))
}

function sourceSummaryFields(source: TriggerSourceAttribution | undefined): Record<string, string | number | boolean> {
  if (!source) return {}
  const fields: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      fields[key] = value
    }
  }
  return fields
}

function buildRunSummary(run: PostGenerationLuaTraceRunPayload): PostGenerationLuaTraceRunSummary {
  let logCount = 0
  let llmAttemptCount = 0
  let llmBlockedCount = 0
  let llmCompletedCount = 0
  let llmFailedCount = 0
  let axLlmAttemptCount = 0
  let axLlmBlockedCount = 0
  let axLlmCompletedCount = 0
  let axLlmFailedCount = 0
  let setChatCount = 0
  let setChatChangedCount = 0

  for (const event of run.hostEvents) {
    if (event.type === 'log') {
      logCount++
      continue
    }
    if (event.type === 'llm') {
      if (event.fn === 'LLM') {
        llmAttemptCount++
        if (event.status === 'blocked') llmBlockedCount++
        if (event.status === 'completed') llmCompletedCount++
        if (event.status === 'failed') llmFailedCount++
      } else {
        axLlmAttemptCount++
        if (event.status === 'blocked') axLlmBlockedCount++
        if (event.status === 'completed') axLlmCompletedCount++
        if (event.status === 'failed') axLlmFailedCount++
      }
      continue
    }
    if (event.type === 'chat' && event.fn === 'setChat') {
      setChatCount++
      if (event.status === 'changed') setChatChangedCount++
    }
  }

  const editOutputTextChanged =
    run.editOutputTextBefore !== undefined || run.editOutputTextAfter !== undefined
      ? run.editOutputTextBefore !== run.editOutputTextAfter
      : undefined
  const errorKind =
    typeof run.runtimeMetricFields?.errorKind === 'string' ? run.runtimeMetricFields.errorKind : undefined

  return {
    seq: run.seq,
    phase: run.phase,
    mode: run.mode,
    status: run.status,
    codeSha256: run.codeSha256,
    codeBytes: run.codeBytes,
    handlerRegistered: run.handlerRegistered,
    transcriptChanged: chatBodyHash(run.chatBefore) !== chatBodyHash(run.chatAfter),
    ...(editOutputTextChanged !== undefined ? { editOutputTextChanged } : {}),
    hostEventCount: run.hostEvents.length,
    logCount,
    llmAttemptCount,
    llmBlockedCount,
    llmCompletedCount,
    llmFailedCount,
    axLlmAttemptCount,
    axLlmBlockedCount,
    axLlmCompletedCount,
    axLlmFailedCount,
    setChatCount,
    setChatChangedCount,
    ...sourceSummaryFields(run.source),
    ...(errorKind ? { errorKind } : {}),
  }
}

function completedRun(run: PostGenerationLuaTraceRun): PostGenerationLuaTraceRunPayload {
  return {
    ...run,
    status: run.status ?? 'error',
    chatAfter: run.chatAfter ?? run.chatBefore,
  }
}

export class PostGenerationLuaTraceCollector {
  private readonly runs: PostGenerationLuaTraceRun[] = []
  private nextRunSeq = 1

  beginRun(input: BeginPostGenerationLuaTraceRunInput): PostGenerationLuaTraceRunHandle {
    const run: PostGenerationLuaTraceRun = {
      seq: this.nextRunSeq++,
      phase: input.phase,
      mode: input.mode,
      codeSha256: sha256Hex(input.code),
      codeBytes: Buffer.byteLength(input.code, 'utf8'),
      source: input.source,
      chatBefore: cloneChatBody(input.chat),
      ...(input.editOutputTextBefore !== undefined ? { editOutputTextBefore: input.editOutputTextBefore } : {}),
      hostEvents: [],
      transcriptChanged: false,
      hostEventCount: 0,
      logCount: 0,
      llmAttemptCount: 0,
      llmBlockedCount: 0,
      llmCompletedCount: 0,
      llmFailedCount: 0,
      axLlmAttemptCount: 0,
      axLlmBlockedCount: 0,
      axLlmCompletedCount: 0,
      axLlmFailedCount: 0,
      setChatCount: 0,
      setChatChangedCount: 0,
    }
    this.runs.push(run)
    return {
      sink: {
        recordHostEvent: (event) => {
          run.hostEvents.push({ ...event, seq: run.hostEvents.length + 1 })
        },
      },
      finish: (finishInput) => {
        run.status = finishInput.status
        run.chatAfter = cloneChatBody(finishInput.chat)
        run.handlerRegistered =
          typeof finishInput.runtimeMetricFields?.handlerRegistered === 'boolean'
            ? finishInput.runtimeMetricFields.handlerRegistered
            : run.handlerRegistered
        run.runtimeMetricFields = finishInput.runtimeMetricFields
        if (finishInput.editOutputTextAfter !== undefined) {
          run.editOutputTextAfter = finishInput.editOutputTextAfter
        }
        if (finishInput.error) {
          run.error = finishInput.error
        }
      },
    }
  }

  hasRuns(): boolean {
    return this.runs.length > 0
  }

  payload(context: PostGenerationLuaTracePayloadContext): PostGenerationLuaTracePayload {
    return {
      kind: 'generation_lua_post_generation_trace',
      status: context.status,
      ...(context.error ? { error: context.error } : {}),
      chatId: context.chatId,
      characterId: context.characterId,
      mode: context.mode,
      generationId: context.generationId,
      durable: context.durable,
      ...(context.requestUid ? { requestUid: context.requestUid } : {}),
      ...(context.requestId ? { requestId: context.requestId } : {}),
      runs: this.runs.map(completedRun).map((run) => ({
        ...run,
        ...buildRunSummary(run),
      })),
    }
  }

  metricSummary(): PostGenerationLuaTraceMetricSummary {
    const runs = this.runs.map(completedRun).map(buildRunSummary)
    return {
      runCount: runs.length,
      hostEventCount: runs.reduce((sum, run) => sum + run.hostEventCount, 0),
      logCount: runs.reduce((sum, run) => sum + run.logCount, 0),
      llmAttemptCount: runs.reduce((sum, run) => sum + run.llmAttemptCount, 0),
      llmBlockedCount: runs.reduce((sum, run) => sum + run.llmBlockedCount, 0),
      llmCompletedCount: runs.reduce((sum, run) => sum + run.llmCompletedCount, 0),
      llmFailedCount: runs.reduce((sum, run) => sum + run.llmFailedCount, 0),
      axLlmAttemptCount: runs.reduce((sum, run) => sum + run.axLlmAttemptCount, 0),
      axLlmBlockedCount: runs.reduce((sum, run) => sum + run.axLlmBlockedCount, 0),
      axLlmCompletedCount: runs.reduce((sum, run) => sum + run.axLlmCompletedCount, 0),
      axLlmFailedCount: runs.reduce((sum, run) => sum + run.axLlmFailedCount, 0),
      setChatCount: runs.reduce((sum, run) => sum + run.setChatCount, 0),
      setChatChangedCount: runs.reduce((sum, run) => sum + run.setChatChangedCount, 0),
      transcriptChanged: runs.some((run) => run.transcriptChanged),
      editOutputTextChanged: runs.some((run) => run.editOutputTextChanged === true),
      runs,
    }
  }
}
