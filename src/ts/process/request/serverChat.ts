/**
 * Phase 7-12a: browser client adapter for `POST /api/v1/generate/chat`.
 *
 * Mirrors the Phase 6 `serverCompletion.ts` precedent: POST an intent body,
 * authenticate with the `risu-auth` header, and stream-parse the SSE
 * response. Unlike `/completion` (which dispatches an already-assembled
 * prompt to a provider), `/chat` performs server-side prompt *assembly* and
 * streams back the assembled `prompt` payload plus `info` telemetry.
 *
 * This adapter consumes `stage` / `prompt` / `message_patch` / `info` /
 * `error` / `done`. Token / side-effect / warning events remain tolerated
 * until later 7-12d slices move provider dispatch to `/chat`. The `prompt`
 * event carries the full `formated` rows and `biases` additively (7-12b), so
 * previews and the send path can use the server payload directly.
 */

import { getNodeServerProxyAuth } from '../../storage/nodeStorage'
import type { MessageGenerationInfo } from '../../storage/database.svelte'
import { iterateSseEvents } from './sseParse'
import type { DoneEvent, InfoEvent, PromptEvent, ServerChatMessagePatch } from './serverChatEvents'
import type { requestDataResponse, StreamResponseChunk } from './request'

const CHAT_ENDPOINT = '/api/v1/generate/chat'

/** The request body the `/chat` route expects (mirrors server `AssembleInput`). */
export interface ServerChatInput {
  chatId: string
  characterId: string
  mode: 'send' | 'continue' | 'preview' | 'preview_prompt' | 'regenerate'
  userMessage?: string
  regenerateMessageId?: string
  presetId?: string
  loadoutId?: string
  resetMessages?: boolean
  expectedRevision?: number
  inlayAssets?: unknown[]
}

/** The assembled prompt payload, parsed from the `prompt` SSE event. */
export type ServerChatPrompt = Omit<PromptEvent, 'type'>

/** Telemetry parsed from the `info` SSE event (7-11i). */
export type ServerChatInfo = Omit<InfoEvent, 'type'>

export type ServerChatResult =
  | {
      status: 'ok'
      prompt: ServerChatPrompt
      info?: ServerChatInfo
      messagePatches: ServerChatMessagePatch[]
    }
  | { status: 'error'; error: string }
  | { status: 'aborted' }

export interface ServerChatTerminal {
  status: 'done' | 'error'
  error?: string
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
  | { status: 'error'; error: string }
  | { status: 'aborted' }

function parseData(data: string): Record<string, unknown> | null {
  try {
    return JSON.parse(data) as Record<string, unknown>
  } catch {
    return null
  }
}

async function openChatResponse(
  input: ServerChatInput,
  signal: AbortSignal | null,
): Promise<
  { status: 'ok'; response: Response } | { status: 'error'; error: string } | { status: 'aborted' }
> {
  const auth = await getNodeServerProxyAuth()

  let response: Response
  try {
    response = await fetch(CHAT_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'risu-auth': auth,
      },
      body: JSON.stringify(input),
      signal: signal ?? undefined,
    })
  } catch (err) {
    if (signal?.aborted) return { status: 'aborted' }
    const msg = err instanceof Error ? err.message : String(err)
    return { status: 'error', error: `Network error: ${msg}` }
  }

  if (!response.ok) {
    let reason = `HTTP ${response.status}`
    try {
      const body = (await response.json()) as { error?: unknown; reason?: unknown }
      if (typeof body?.error === 'string') reason = body.error
      else if (typeof body?.reason === 'string') reason = body.reason
    } catch {
      // ignore parse failure
    }
    return { status: 'error', error: reason }
  }

  if (!response.body) {
    return { status: 'error', error: 'No streaming body returned' }
  }

  return { status: 'ok', response }
}

/**
 * Call the `/chat` route and resolve the assembled prompt. The terminal
 * `done` event (or stream end) closes a successful run; an `error` event is
 * terminal and surfaces its message; an abort resolves as `aborted`.
 */
export async function requestServerChat(
  input: ServerChatInput,
  signal: AbortSignal | null,
): Promise<ServerChatResult> {
  const opened = await openChatResponse(input, signal)
  if (opened.status !== 'ok') return opened
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
        break
      case 'message_patch':
        if (data.patch && typeof data.patch === 'object') {
          messagePatches.push(data.patch as unknown as ServerChatMessagePatch)
        }
        break
      case 'error':
        error = typeof data.error === 'string' ? data.error : 'prompt assembly failed'
        done = true
        break
      case 'done':
        done = true
        break
      // stage + dispatch-coupled events (token / side_effect / warning) are
      // ignored until later 7-12d slices.
      default:
        break
    }
    if (done) break
  }

  if (signal?.aborted) return { status: 'aborted' }
  if (error !== null) return { status: 'error', error }
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
): Promise<ServerChatGenerationResult> {
  const opened = await openChatResponse(input, signal)
  if (opened.status !== 'ok') return opened

  let prompt: ServerChatPrompt | null = null
  let info: ServerChatInfo | undefined
  let donePayload: Omit<DoneEvent, 'type'> | undefined
  const messagePatches: ServerChatMessagePatch[] = []
  let readyResolved = false
  let terminalResolved = false
  let tokenResult = ''
  let streamKey = 'server-chat'

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

      void (async () => {
        try {
          for await (const frame of iterateSseEvents(opened.response.body!, signal)) {
            const data = parseData(frame.data)
            if (!data) continue
            switch (frame.event) {
              case 'prompt':
                prompt = data as unknown as ServerChatPrompt
                maybeResolveReady()
                break
              case 'info':
                info = data as unknown as ServerChatInfo
                maybeResolveReady()
                break
              case 'message_patch':
                if (data.patch && typeof data.patch === 'object') {
                  messagePatches.push(data.patch as unknown as ServerChatMessagePatch)
                }
                break
              case 'token': {
                const content = typeof data.content === 'string' ? data.content : ''
                tokenResult += content
                controller.enqueue({ [streamKey]: tokenResult })
                break
              }
              case 'error': {
                const error =
                  typeof data.error === 'string' ? data.error : 'provider dispatch failed'
                resolveReadyOnce({ status: 'error', error })
                resolveTerminalOnce({ status: 'error', error })
                controller.close()
                return
              }
              case 'done':
                donePayload = data as unknown as Omit<DoneEvent, 'type'>
                if (typeof donePayload.result === 'string' && tokenResult.length === 0) {
                  tokenResult = donePayload.result
                  controller.enqueue({ [streamKey]: tokenResult })
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
                resolveTerminalOnce({ status: 'done', done: donePayload })
                controller.close()
                return
              default:
                break
            }
          }
          if (signal?.aborted) {
            resolveReadyOnce({ status: 'aborted' })
            resolveTerminalOnce({ status: 'error', error: 'Aborted' })
          } else {
            resolveReadyOnce({ status: 'error', error: 'stream ended without a done event' })
            resolveTerminalOnce({ status: 'error', error: 'stream ended without a done event' })
          }
          controller.close()
        } catch (err) {
          if (signal?.aborted) {
            resolveReadyOnce({ status: 'aborted' })
            resolveTerminalOnce({ status: 'error', error: 'Aborted' })
          } else {
            const error = err instanceof Error ? err.message : String(err)
            resolveReadyOnce({ status: 'error', error })
            resolveTerminalOnce({ status: 'error', error })
          }
          controller.close()
        }
      })()
    },
    cancel() {
      resolveTerminalOnce({ status: 'error', error: 'Aborted' })
    },
  })

  return ready
}
