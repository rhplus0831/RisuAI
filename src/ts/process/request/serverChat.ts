/**
 * Browser client adapter for `POST /api/v1/generate/chat`.
 *
 * POSTs an intent body, authenticates with the `risu-auth` header, and
 * stream-parses the SSE response. Unlike `/completion` (which dispatches an
 * already-assembled prompt to a provider), `/chat` performs server-side prompt
 * assembly and streams back prompt metadata plus `info` telemetry. Preview
 * requests still receive the assembled rows they render.
 *
 * This adapter consumes `stage` / `prompt` / `message_patch` / `info` /
 * `error` / `done`. Token / side-effect / warning events are tolerated for
 * generation streams. Preview prompt events carry full `formated` rows; normal
 * server-dispatched generations request metadata only because the browser never
 * sends those rows to a provider itself.
 */

import { getNodeServerProxyAuth } from '../../storage/fastifyStorage'
import type { MessageGenerationInfo } from '../../storage/database.svelte'
import { setCachedServerCommandRevision } from '../../server/commands'
import { activeWriterSessionHeader, handleActiveWriterStaleResponse } from '../../server/activeWriterSession'
import {
  beginPostGenerationProgress,
  clearPostGenerationProgress,
  updatePostGenerationProgress,
  type PostGenerationProgressSession,
} from '../postGenerationProgress'
import {
  beginAgentPresetProgress,
  clearAgentPresetProgress,
  updateAgentPresetProgress,
  type AgentPresetProgressSession,
} from '../agentPresetProgress'
import { forgetActiveGenerationJob, rememberActiveGenerationJob } from '../reattach'
import { iterateSseEvents } from './sseParse'
import type {
  AgentPresetProgressEvent,
  DoneEvent,
  InfoEvent,
  PostGenerationProgressEvent,
  PromptEvent,
  ServerChatMessagePatch,
  ServerChatRestoration,
  ServerChatSideEffect,
  ServerChatWarning,
} from './serverChatEvents'
import type { requestDataResponse, StreamResponseChunk } from './request'

const CHAT_ENDPOINT = '/api/v1/generate/chat'
const INCOMPLETE_CHAT_GENERATION_SETTINGS_ERROR = 'chat_generation_settings_incomplete'
const HUMAN_REASON_ERROR_CODES = new Set(['generation_in_progress', 'generation_job_not_found'])
const REQUEST_UID_HEADER = 'X-Request-UID'
const DURABLE_JOB_ID_HEADER = 'X-Risu-Generation-Job-ID'
const DURABLE_STREAM_RECONNECT_DELAYS_MS = [0, 250, 500, 1_000, 2_000, 4_000] as const
const MAX_DURABLE_STREAM_RECONNECT_CYCLES = 8
const SERVER_CHAT_CLIENT_CAPABILITIES = {
  compactPromptEvent: true,
  promptMetadataOnly: true,
  omitDuplicateDoneResult: true,
} as const

function clearLiveGenerationProgress(
  agentPresetSession: AgentPresetProgressSession,
  postGenerationSession: PostGenerationProgressSession,
): void {
  clearAgentPresetProgress(agentPresetSession)
  clearPostGenerationProgress(postGenerationSession)
}

/** The request body the `/chat` route expects (mirrors server `AssembleInput`). */
export interface ServerChatInput {
  chatId: string
  characterId: string
  mode: 'send' | 'continue' | 'preview' | 'preview_prompt' | 'regenerate'
  userMessage?: string
  regenerateMessageId?: string
  loadoutId?: string
  resetMessages?: boolean
  expectedRevision?: number
  /** Legacy compatibility only; Fastify inlay bytes should live in `/assets`. */
  inlayAssets?: unknown[]
  /** Legacy browser-local inlay id -> server asset id aliases. */
  inlayAssetRefs?: unknown[]
  clientCapabilities?: typeof SERVER_CHAT_CLIENT_CAPABILITIES
  /**
   * When set, the server runs this as a detached, reconnectable job and persists
   * the result itself, so the browser suppresses its own generation-result persist.
   * Computed by `resolveDurableGeneration`.
   */
  durable?: boolean
}

/** The assembled prompt payload, parsed from the `prompt` SSE event. */
export type ServerChatPrompt = Omit<PromptEvent, 'type'>

/** Telemetry parsed from the `info` SSE event. */
export type ServerChatInfo = Omit<InfoEvent, 'type'>

export type ServerChatResult =
  | {
      status: 'ok'
      prompt: ServerChatPrompt
      info?: ServerChatInfo
      messagePatches: ServerChatMessagePatch[]
    }
  | { status: 'error'; error: string; messagePatches?: ServerChatMessagePatch[] }
  | { status: 'aborted' }

export interface ServerChatTerminal {
  status: 'done' | 'error'
  error?: string
  restoration?: ServerChatRestoration
  sideEffects?: ServerChatSideEffect[]
  warnings?: ServerChatWarning[]
  done?: Omit<DoneEvent, 'type'>
}

export type ServerChatGenerationResult =
  | {
      status: 'ok'
      prompt: ServerChatPrompt
      info?: ServerChatInfo
      messagePatches: ServerChatMessagePatch[]
      req: Exclude<requestDataResponse, { type: 'fail' }>
      generationId: string
      generationInfo: MessageGenerationInfo
      terminal: Promise<ServerChatTerminal>
    }
  | {
      status: 'error'
      error: string
      messagePatches?: ServerChatMessagePatch[]
      restoration?: ServerChatRestoration
    }
  | { status: 'aborted' }

function parseData(data: string): Record<string, unknown> | null {
  try {
    return JSON.parse(data) as Record<string, unknown>
  } catch {
    return null
  }
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function httpErrorReason(body: { error?: unknown; message?: unknown; reason?: unknown }): string | null {
  if (body.error === INCOMPLETE_CHAT_GENERATION_SETTINGS_ERROR && nonEmptyString(body.message)) {
    return body.message
  }
  if (nonEmptyString(body.message)) return body.message
  if (typeof body.error === 'string' && HUMAN_REASON_ERROR_CODES.has(body.error) && nonEmptyString(body.reason)) {
    return body.reason
  }
  if (nonEmptyString(body.error)) return body.error
  if (nonEmptyString(body.reason)) return body.reason
  return null
}

function serverChatCaller(input: ServerChatInput): 'chat-generate' | 'preview-prompt' {
  return input.mode === 'preview_prompt' ? 'preview-prompt' : 'chat-generate'
}

function protocolDebugEnabled(): boolean {
  try {
    return (
      typeof localStorage !== 'undefined' &&
      (localStorage.getItem('risu:protocol-debug') === '1' || localStorage.getItem('risu:protocol-debug') === 'true')
    )
  } catch {
    return false
  }
}

function debugServerChat(event: string, details: Record<string, unknown>): void {
  if (!protocolDebugEnabled()) return
  console.debug('[risu:protocol]', event, details)
}

function errorMessageFromEvent(data: Record<string, unknown>, fallback: string): string {
  const error = nonEmptyString(data.error) ? data.error : fallback
  const details: string[] = []
  if (typeof data.status === 'number' && Number.isFinite(data.status) && !error.includes(`HTTP ${data.status}`)) {
    const statusText = nonEmptyString(data.statusText) ? ` ${data.statusText}` : ''
    details.push(`HTTP ${data.status}${statusText}`)
  }
  if (nonEmptyString(data.code) && !error.includes(data.code)) {
    details.push(`code ${data.code}`)
  }
  return details.length > 0 ? `${error} (${details.join(', ')})` : error
}

/**
 * When `/generate/chat` persists an assembly-time chat-var delta, it returns the
 * bumped revision on the `info` frame. Sync the command layer's cached revision
 * so the next browser command POSTs the right `baseRevision` instead of a stale
 * one. Absent when the route persisted nothing, in which case this is a no-op.
 */
function reconcileServerCommandRevision(info: ServerChatInfo): void {
  if (typeof info.revision === 'number') {
    setCachedServerCommandRevision(info.revision)
  }
}

/**
 * Explicitly cancel a running durable job. A bare disconnect only detaches the
 * viewer; the job keeps generating, so the stop button must
 * `DELETE /generate/chat/:id` to abort it. Authorized by the current active
 * writer. Best-effort: if the cancel fails the job still finishes and persists.
 */
export async function cancelServerChatGeneration(generationId: string): Promise<void> {
  if (!generationId) return
  const auth = await getNodeServerProxyAuth()
  try {
    const response = await fetch(`${CHAT_ENDPOINT}/${encodeURIComponent(generationId)}`, {
      method: 'DELETE',
      headers: {
        'risu-auth': auth,
        'x-risu-caller': 'chat-cancel',
        ...activeWriterSessionHeader(),
      },
    })
    const requestUid = response.headers.get(REQUEST_UID_HEADER) || undefined
    debugServerChat('server-chat-cancel-response', {
      requestUid,
      status: response.status,
      ok: response.ok,
    })
  } catch {
    // best-effort cancel
  }
}

async function openChatResponse(
  input: ServerChatInput,
  signal: AbortSignal | null,
  reattachJobId?: string,
): Promise<
  | { status: 'ok'; response: Response; requestUid?: string }
  | { status: 'error'; error: string; requestUid?: string; httpStatus?: number; retryable?: boolean }
  | { status: 'aborted' }
> {
  const auth = await getNodeServerProxyAuth()

  let response: Response
  try {
    // Reattach by GETting the live stream of an already-running durable job
    // (buffered frames first, then live). A fresh send POSTs the intent body.
    response = reattachJobId
      ? await fetch(`${CHAT_ENDPOINT}/${encodeURIComponent(reattachJobId)}/stream`, {
          method: 'GET',
          headers: {
            'risu-auth': auth,
            'x-risu-caller': 'chat-reattach',
            ...activeWriterSessionHeader(),
          },
          signal: signal ?? undefined,
        })
      : await fetch(CHAT_ENDPOINT, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'risu-auth': auth,
            'x-risu-caller': serverChatCaller(input),
            ...activeWriterSessionHeader(),
          },
          body: JSON.stringify({
            ...input,
            clientCapabilities: SERVER_CHAT_CLIENT_CAPABILITIES,
          }),
          signal: signal ?? undefined,
        })
  } catch (err) {
    if (signal?.aborted) return { status: 'aborted' }
    const msg = err instanceof Error ? err.message : String(err)
    return { status: 'error', error: `Network error: ${msg}`, retryable: true }
  }
  const requestUid = response.headers.get(REQUEST_UID_HEADER) || undefined
  debugServerChat('server-chat-response-opened', {
    requestUid,
    caller: reattachJobId ? 'chat-reattach' : serverChatCaller(input),
    status: response.status,
    ok: response.ok,
  })

  if (!response.ok) {
    const statusText = response.statusText.trim()
    let reason = `HTTP ${response.status}${statusText ? ` ${statusText}` : ''}`
    try {
      const body = (await response.json()) as {
        error?: unknown
        message?: unknown
        reason?: unknown
      }
      reason = httpErrorReason(body) ?? reason
    } catch {
      // ignore parse failure
    }
    handleActiveWriterStaleResponse(response)
    debugServerChat('server-chat-response-error', { requestUid, status: response.status, error: reason })
    return {
      status: 'error',
      error: reason,
      requestUid,
      httpStatus: response.status,
      retryable: response.status === 408 || response.status === 429 || response.status >= 500,
    }
  }

  if (!response.body) {
    const error = 'Server did not return a streaming response body.'
    debugServerChat('server-chat-response-error', { requestUid, status: response.status, error })
    return { status: 'error', error, requestUid, retryable: true }
  }

  return { status: 'ok', response, requestUid }
}

async function waitForDurableReconnect(delayMs: number, signal: AbortSignal | null): Promise<boolean> {
  if (signal?.aborted) return false
  if (delayMs <= 0) return true

  return new Promise((resolve) => {
    let settled = false
    const finish = (value: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      resolve(value)
    }
    const onAbort = (): void => finish(false)
    const timer = setTimeout(() => finish(true), delayMs)
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) finish(false)
  })
}

/**
 * Call the `/chat` route and resolve the assembled prompt. The terminal
 * `done` event (or stream end) closes a successful run; an `error` event is
 * terminal and surfaces its message; an abort resolves as `aborted`.
 */
export async function requestServerChat(input: ServerChatInput, signal: AbortSignal | null): Promise<ServerChatResult> {
  const opened = await openChatResponse(input, signal)
  if (opened.status !== 'ok') {
    return opened.status === 'error' ? { status: 'error', error: opened.error } : opened
  }
  const response = opened.response

  let prompt: ServerChatPrompt | null = null
  let info: ServerChatInfo | undefined
  const messagePatches: ServerChatMessagePatch[] = []
  let error: string | null = null
  let done = false

  // The SSE event *name* (`frame.event`) is the discriminator; the `data:`
  // payload carries the remaining fields with `type` stripped (see the
  // server's `writePromptChatEvent`).
  for await (const frame of iterateSseEvents(response.body, signal)) {
    const data = parseData(frame.data)
    if (!data) continue
    switch (frame.event) {
      case 'prompt':
        prompt = data as unknown as ServerChatPrompt
        break
      case 'info':
        info = data as unknown as ServerChatInfo
        reconcileServerCommandRevision(info)
        break
      case 'message_patch':
        if (data.patch && typeof data.patch === 'object') {
          messagePatches.push(data.patch as unknown as ServerChatMessagePatch)
        }
        break
      case 'error':
        error = errorMessageFromEvent(data, 'Server returned an error without details during prompt assembly.')
        done = true
        break
      case 'done':
        done = true
        break
      // Prompt-only calls ignore stage and dispatch-coupled events.
      default:
        break
    }
    if (done) break
  }

  if (signal?.aborted) return { status: 'aborted' }
  if (error !== null) {
    return {
      status: 'error',
      error,
      ...(messagePatches.length > 0 ? { messagePatches } : {}),
    }
  }
  if (!prompt) {
    return { status: 'error', error: 'stream ended without a prompt event' }
  }
  return { status: 'ok', prompt, info, messagePatches }
}

function coerceGenerationInfo(
  info: ServerChatInfo | undefined,
  done: Omit<DoneEvent, 'type'> | undefined,
): { generationId: string; generationInfo: MessageGenerationInfo } | null {
  const doneGenerationInfo =
    done?.generationInfo && typeof done.generationInfo === 'object'
      ? (done.generationInfo as MessageGenerationInfo)
      : undefined
  const infoGenerationInfo =
    info?.generationInfo && typeof info.generationInfo === 'object'
      ? (info.generationInfo as MessageGenerationInfo)
      : undefined
  const generationInfo: MessageGenerationInfo = {
    ...(infoGenerationInfo ?? {}),
    ...(doneGenerationInfo ?? {}),
  }
  const generationId =
    typeof done?.generationId === 'string'
      ? done.generationId
      : typeof info?.generationId === 'string'
        ? info.generationId
        : typeof generationInfo.generationId === 'string'
          ? generationInfo.generationId
          : ''
  if (generationId.length === 0) return null
  generationInfo.generationId = generationId
  if (generationInfo.inputTokens === undefined && typeof info?.tokens?.prompt === 'number') {
    generationInfo.inputTokens = info.tokens.prompt
  }
  if (generationInfo.outputTokens === undefined && typeof info?.responseBudget === 'number') {
    generationInfo.outputTokens = info.responseBudget
  }
  if (generationInfo.stageTiming === undefined) {
    generationInfo.stageTiming = {
      stage1: typeof info?.timings?.prompt === 'number' ? info.timings.prompt : 0,
      stage2: 0,
      stage3: 0,
      stage4: 0,
    }
  }
  return { generationId, generationInfo }
}

export async function requestServerChatGeneration(
  input: ServerChatInput,
  signal: AbortSignal | null,
  reattachJobId?: string,
): Promise<ServerChatGenerationResult> {
  const agentPresetSession = beginAgentPresetProgress(input.chatId)
  const postGenerationSession = beginPostGenerationProgress({
    characterId: input.characterId,
    chatId: input.chatId,
  })
  const opened = await openChatResponse(input, signal, reattachJobId)
  if (opened.status !== 'ok') {
    clearAgentPresetProgress(agentPresetSession)
    clearPostGenerationProgress(postGenerationSession)
    return opened.status === 'error' ? { status: 'error', error: opened.error } : opened
  }

  let prompt: ServerChatPrompt | null = null
  let info: ServerChatInfo | undefined
  let donePayload: Omit<DoneEvent, 'type'> | undefined
  const messagePatches: ServerChatMessagePatch[] = []
  const sideEffects: ServerChatSideEffect[] = []
  const warnings: ServerChatWarning[] = []
  const seenMessagePatches = new Set<string>()
  const seenSideEffects = new Set<string>()
  const seenAgentProgress = new Set<string>()
  const seenPostGenerationProgress = new Set<string>()
  const seenWarnings = new Set<string>()
  let readyResolved = false
  let terminalResolved = false
  let tokenStreamInactive = false
  let tokenResult = ''
  let streamKey = 'server-chat'
  // The server also returns the durable job id in the response headers. Unlike
  // the first `job_accepted` body frame, headers are available as soon as fetch
  // accepts the response, so Stop can cancel a job even while its first body
  // bytes are still delayed by the network.
  let durableJobId = reattachJobId ?? opened.response.headers.get(DURABLE_JOB_ID_HEADER)?.trim() ?? ''
  const watchesDurableJob = input.durable === true || reattachJobId !== undefined
  let cancelledDurableJobId = ''
  const rememberDurableJob = (): void => {
    if (!watchesDurableJob || durableJobId.length === 0) return
    rememberActiveGenerationJob({
      chatId: input.chatId,
      jobId: durableJobId,
      ...(input.mode === 'continue' || input.mode === 'regenerate' ? { mode: input.mode } : { mode: 'send' }),
      ...(input.mode === 'regenerate' && input.regenerateMessageId
        ? { regenerateMessageId: input.regenerateMessageId }
        : {}),
    })
  }
  const cancelDurableOnAbort = (): void => {
    // A durable send or a reattached generation: an explicit abort (the stop
    // button) cancels the server job; a bare disconnect only detaches.
    if (!watchesDurableJob || durableJobId.length === 0 || cancelledDurableJobId === durableJobId) return
    cancelledDurableJobId = durableJobId
    void cancelServerChatGeneration(durableJobId)
  }
  const stopWatchingAbort = (): void => signal?.removeEventListener('abort', cancelDurableOnAbort)
  rememberDurableJob()
  if (signal?.aborted) cancelDurableOnAbort()
  else signal?.addEventListener('abort', cancelDurableOnAbort, { once: true })

  let resolveReady: (value: ServerChatGenerationResult) => void = () => {}
  const ready = new Promise<ServerChatGenerationResult>((resolve) => {
    resolveReady = resolve
  })

  let resolveTerminal: (value: ServerChatTerminal) => void = () => {}
  const terminal = new Promise<ServerChatTerminal>((resolve) => {
    resolveTerminal = resolve
  })

  const resolveReadyOnce = (value: ServerChatGenerationResult): void => {
    if (readyResolved) return
    readyResolved = true
    resolveReady(value)
  }

  const resolveTerminalOnce = (value: ServerChatTerminal): void => {
    if (terminalResolved) return
    terminalResolved = true
    resolveTerminal(value)
  }

  const tokenStream = new ReadableStream<StreamResponseChunk>({
    start(controller) {
      const enqueueToken = (chunk: StreamResponseChunk): void => {
        if (tokenStreamInactive) return
        try {
          controller.enqueue(chunk)
        } catch {
          tokenStreamInactive = true
        }
      }
      const closeTokenStream = (): void => {
        if (tokenStreamInactive) return
        tokenStreamInactive = true
        try {
          controller.close()
        } catch {
          // The consumer may have cancelled or errored the readable during abort.
        }
      }
      const maybeResolveReady = (): void => {
        if (readyResolved || !prompt || !info) return
        const generation = coerceGenerationInfo(info, donePayload)
        if (!generation) return
        streamKey = generation.generationId
        resolveReadyOnce({
          status: 'ok',
          prompt,
          info,
          messagePatches,
          req: { type: 'streaming', result: tokenStream },
          generationId: generation.generationId,
          generationInfo: generation.generationInfo,
          terminal,
        })
      }

      const settleAborted = (): void => {
        cancelDurableOnAbort()
        forgetActiveGenerationJob(durableJobId)
        resolveReadyOnce({ status: 'aborted' })
        resolveTerminalOnce({ status: 'error', error: 'Aborted', warnings })
        clearLiveGenerationProgress(agentPresetSession, postGenerationSession)
        closeTokenStream()
        stopWatchingAbort()
      }

      const settleTransportError = (error: string): void => {
        resolveReadyOnce({ status: 'error', error })
        resolveTerminalOnce({ status: 'error', error, warnings })
        clearLiveGenerationProgress(agentPresetSession, postGenerationSession)
        closeTokenStream()
        stopWatchingAbort()
      }

      let reconnectCycles = 0
      const reconnectDurableStream = async (
        transportError: string,
      ): Promise<
        | { status: 'ok'; opened: Extract<Awaited<ReturnType<typeof openChatResponse>>, { status: 'ok' }> }
        | { status: 'error'; error: string }
        | { status: 'aborted' }
      > => {
        if (!watchesDurableJob || durableJobId.length === 0) {
          return { status: 'error', error: transportError }
        }
        if (reconnectCycles >= MAX_DURABLE_STREAM_RECONNECT_CYCLES) {
          return { status: 'error', error: transportError }
        }
        reconnectCycles += 1

        let lastError = transportError
        for (const delayMs of DURABLE_STREAM_RECONNECT_DELAYS_MS) {
          if (!(await waitForDurableReconnect(delayMs, signal))) return { status: 'aborted' }
          const next = await openChatResponse(input, signal, durableJobId)
          if (next.status === 'ok') {
            // Durable reattach replays the complete token delta history. Rebuild
            // the accumulated text from zero so replayed deltas do not duplicate
            // the partial text rendered before mobile suspension.
            tokenResult = ''
            debugServerChat('server-chat-stream-reattached', {
              requestUid: next.requestUid,
              jobId: durableJobId,
              reconnectCycle: reconnectCycles,
            })
            return { status: 'ok', opened: next }
          }
          if (next.status === 'aborted') return next
          lastError = next.error
          if (next.httpStatus === 404) forgetActiveGenerationJob(durableJobId)
          if (next.retryable === false) break
        }
        return { status: 'error', error: lastError }
      }

      void (async () => {
        let activeOpened = opened
        while (true) {
          let transportError = 'stream ended without a done event'
          try {
            for await (const frame of iterateSseEvents(activeOpened.response.body!, signal)) {
              const data = parseData(frame.data)
              if (!data) continue
              switch (frame.event) {
                case 'job_accepted':
                  if (typeof data.jobId === 'string') durableJobId = data.jobId
                  rememberDurableJob()
                  // Backward-compatible with servers that predate the response
                  // header: an abort may have won the race with this first frame.
                  if (signal?.aborted) cancelDurableOnAbort()
                  debugServerChat('server-chat-job-accepted', {
                    requestUid: activeOpened.requestUid,
                    jobId: durableJobId,
                  })
                  break
                case 'prompt':
                  prompt = data as unknown as ServerChatPrompt
                  maybeResolveReady()
                  break
                case 'info':
                  info = data as unknown as ServerChatInfo
                  reconcileServerCommandRevision(info)
                  maybeResolveReady()
                  break
                case 'message_patch':
                  if (data.patch && typeof data.patch === 'object') {
                    const signature = JSON.stringify(data.patch)
                    if (!seenMessagePatches.has(signature)) {
                      seenMessagePatches.add(signature)
                      messagePatches.push(data.patch as unknown as ServerChatMessagePatch)
                    }
                  }
                  break
                case 'side_effect':
                  if (typeof data.kind === 'string') {
                    const signature = JSON.stringify(data)
                    if (!seenSideEffects.has(signature)) {
                      seenSideEffects.add(signature)
                      sideEffects.push(data as unknown as ServerChatSideEffect)
                    }
                  }
                  break
                case 'agent_preset_progress': {
                  const signature = JSON.stringify(data)
                  if (!seenAgentProgress.has(signature)) {
                    seenAgentProgress.add(signature)
                    updateAgentPresetProgress(agentPresetSession, {
                      type: 'agent_preset_progress',
                      ...(data as unknown as Omit<AgentPresetProgressEvent, 'type'>),
                    })
                  }
                  break
                }
                case 'post_generation_progress': {
                  const signature = JSON.stringify(data)
                  if (!seenPostGenerationProgress.has(signature)) {
                    seenPostGenerationProgress.add(signature)
                    updatePostGenerationProgress(postGenerationSession, {
                      type: 'post_generation_progress',
                      ...(data as unknown as Omit<PostGenerationProgressEvent, 'type'>),
                    })
                  }
                  break
                }
                case 'warning':
                  if (typeof data.message === 'string') {
                    const signature = JSON.stringify(data)
                    if (seenWarnings.has(signature)) break
                    seenWarnings.add(signature)
                    const warning = data as unknown as ServerChatWarning
                    warnings.push(warning)
                    debugServerChat('server-chat-warning', {
                      requestUid: activeOpened.requestUid,
                      message: warning.message,
                      context: warning.context,
                    })
                    console.warn(`Server chat warning: ${warning.message}`, warning.context ?? '')
                  }
                  break
                case 'token': {
                  const content = typeof data.content === 'string' ? data.content : ''
                  tokenResult += content
                  enqueueToken({ [streamKey]: tokenResult })
                  break
                }
                case 'error': {
                  const error = errorMessageFromEvent(
                    data,
                    'Server returned an error without details during generation.',
                  )
                  const restoration =
                    data.restoration && typeof data.restoration === 'object'
                      ? (data.restoration as unknown as ServerChatRestoration)
                      : undefined
                  forgetActiveGenerationJob(durableJobId)
                  resolveReadyOnce({
                    status: 'error',
                    error,
                    ...(messagePatches.length > 0 ? { messagePatches } : {}),
                    ...(restoration ? { restoration } : {}),
                  })
                  resolveTerminalOnce({
                    status: 'error',
                    error,
                    restoration,
                    sideEffects,
                    warnings,
                  })
                  clearLiveGenerationProgress(agentPresetSession, postGenerationSession)
                  closeTokenStream()
                  stopWatchingAbort()
                  return
                }
                case 'done':
                  donePayload = data as unknown as Omit<DoneEvent, 'type'>
                  if (typeof donePayload.result === 'string' && tokenResult.length === 0) {
                    tokenResult = donePayload.result
                    enqueueToken({ [streamKey]: tokenResult })
                  }
                  // The post-gen pass may have persisted a scriptstate delta and
                  // bumped the revision; reconcile it so the follow-up command POSTs
                  // the right baseRevision.
                  if (typeof donePayload.postGeneration?.revision === 'number') {
                    setCachedServerCommandRevision(donePayload.postGeneration.revision)
                  }
                  maybeResolveReady()
                  if (!readyResolved) {
                    resolveReadyOnce({
                      status: 'error',
                      error: prompt
                        ? 'server chat dispatch did not return generation metadata'
                        : 'stream ended without a prompt event',
                    })
                  }
                  forgetActiveGenerationJob(durableJobId)
                  resolveTerminalOnce({ status: 'done', done: donePayload, sideEffects, warnings })
                  clearLiveGenerationProgress(agentPresetSession, postGenerationSession)
                  closeTokenStream()
                  stopWatchingAbort()
                  return
                default:
                  break
              }
            }
          } catch (err) {
            transportError = err instanceof Error ? err.message : String(err)
          }

          if (signal?.aborted) {
            settleAborted()
            return
          }

          const reconnected = await reconnectDurableStream(transportError)
          if (reconnected.status === 'ok') {
            activeOpened = reconnected.opened
            continue
          }
          if (reconnected.status === 'aborted') settleAborted()
          else settleTransportError(reconnected.error)
          return
        }
      })()
    },
    cancel() {
      tokenStreamInactive = true
      resolveTerminalOnce({ status: 'error', error: 'Aborted', warnings })
      clearLiveGenerationProgress(agentPresetSession, postGenerationSession)
    },
  })

  return ready
}
