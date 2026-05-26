/**
 * Fetch stub for the Phase 7-12a `/chat` adapter and 7-12c preview wiring.
 * Emulates `POST /api/v1/generate/chat` well enough to round-trip the named
 * SSE taxonomy (`stage` / `prompt` / `info` / `error` / `done`). Tokenizer
 * JSON fetches (`/token/*`) pass through the shared shim; any other URL is
 * rejected so an accidental escape surfaces.
 */

import { isTokenizerUrl, serveTokenizerFetch } from './tokenizerFetch'
import type {
  ServerChatMessagePatch,
  ServerChatRestoration,
  ServerChatSideEffect,
} from '../../request/serverChatEvents'

export interface ServerChatCall {
  url: string
  method: string
  authHeader: string | null
  chatId: string
  characterId: string
  mode: string
  userMessage: string
  regenerateMessageId: string
}

interface ChatPayload {
  chatId?: unknown
  characterId?: unknown
  mode?: unknown
  userMessage?: unknown
  regenerateMessageId?: unknown
}

interface State {
  calls: ServerChatCall[]
  /** Messages returned on the `prompt` event (lossy projection). */
  promptMessages: Array<{ role: string; content: unknown }>
  /** Full `OpenAIChat` rows returned on the `prompt` event (7-12b). */
  formated: Array<Record<string, unknown>>
  /** Logit-bias rows returned on the `prompt` event (7-12b). */
  biases: [string, number][]
  /** promptInfo returned on the `prompt` event. */
  promptInfo: Record<string, unknown>
  /** Token counts returned on the `info` event. */
  inputTokens: number
  responseBudget: number
  /** Optional mutation payload returned on the `message_patch` event. */
  messagePatch: ServerChatMessagePatch | null
  /** Optional provider result returned as `/chat` token + enriched done events. */
  dispatchResult: string | null
  dispatchError: string | null
  emitTtsSideEffect: boolean
  sideEffects: ServerChatSideEffect[]
  restoration: ServerChatRestoration | null
  generationId: string
  generationInfo: Record<string, unknown> | null
  /** When set, the stream emits a terminal `error` instead of `prompt`. */
  errorMessage: string | null
}

const DEFAULT_MESSAGES: Array<{ role: string; content: unknown }> = [
  { role: 'system', content: 'fixture system prompt' },
  { role: 'user', content: 'hi' },
]

function defaultState(): Omit<State, 'calls'> {
  return {
    promptMessages: DEFAULT_MESSAGES,
    formated: DEFAULT_MESSAGES.map((m) => ({ ...m })),
    biases: [],
    promptInfo: { promptText: 'fixture prompt text' },
    inputTokens: 7,
    responseBudget: 50,
    messagePatch: null,
    dispatchResult: null,
    dispatchError: null,
    emitTtsSideEffect: false,
    sideEffects: [],
    restoration: null,
    generationId: 'uuid-0',
    generationInfo: null,
    errorMessage: null,
  }
}

const state: State = { calls: [], ...defaultState() }

export function resetServerChatState(): void {
  state.calls = []
  Object.assign(state, defaultState())
}

export function getServerChatCalls(): ServerChatCall[] {
  return state.calls
}

export function setServerChatPrompt(
  messages: Array<{ role: string; content: unknown }>,
  promptInfo: Record<string, unknown> = {},
  opts: { formated?: Array<Record<string, unknown>>; biases?: [string, number][] } = {},
): void {
  state.promptMessages = messages
  state.promptInfo = promptInfo
  state.formated = opts.formated ?? messages.map((m) => ({ ...m }))
  if (opts.biases) state.biases = opts.biases
}

export function setServerChatError(
  message: string,
  opts: { messagePatch?: ServerChatMessagePatch; restoration?: ServerChatRestoration } = {},
): void {
  state.errorMessage = message
  state.messagePatch = opts.messagePatch ?? null
  state.restoration = opts.restoration ?? null
}

export function setServerChatMessagePatch(patch: ServerChatMessagePatch): void {
  state.messagePatch = patch
}

export function setServerChatInfo(inputTokens: number, responseBudget: number): void {
  state.inputTokens = inputTokens
  state.responseBudget = responseBudget
}

export function setServerChatDispatchResult(
  result: string,
  generationInfo: Record<string, unknown>,
  generationId = 'uuid-0',
  opts: { emitTtsSideEffect?: boolean } = {},
): void {
  state.dispatchResult = result
  state.dispatchError = null
  state.generationId = generationId
  state.generationInfo = { ...generationInfo, generationId }
  state.emitTtsSideEffect = !!opts.emitTtsSideEffect
}

export function setServerChatDispatchError(
  message: string,
  generationInfo: Record<string, unknown>,
  restoration: ServerChatRestoration,
  generationId = 'uuid-0',
): void {
  state.dispatchResult = null
  state.dispatchError = message
  state.generationId = generationId
  state.generationInfo = { ...generationInfo, generationId }
  state.restoration = restoration
}

export function setServerChatSideEffects(sideEffects: ServerChatSideEffect[]): void {
  state.sideEffects = sideEffects
}

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

function sseChatResponse(): Response {
  const enc = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const push = (event: string, data: unknown): void =>
        controller.enqueue(enc.encode(frame(event, data)))

      push('stage', { stage: 'validate', status: 'start' })
      push('stage', { stage: 'validate', status: 'end' })
      push('stage', { stage: 'prompt', status: 'start' })
      if (state.errorMessage !== null) {
        if (state.messagePatch) {
          push('message_patch', { patch: state.messagePatch })
        }
        push('error', { error: state.errorMessage, restoration: state.restoration ?? undefined })
        push('done', {})
        controller.close()
        return
      }
      push('prompt', {
        messages: state.promptMessages,
        promptInfo: state.promptInfo,
        lorebookActivation: null,
        formated: state.formated,
        biases: state.biases,
      })
      if (state.messagePatch) {
        push('message_patch', { patch: state.messagePatch })
      }
      push('stage', { stage: 'prompt', status: 'end' })
      push('info', {
        timings: { prompt: 1 },
        tokens: { prompt: state.inputTokens, total: state.inputTokens },
        responseBudget: state.responseBudget,
        generationId:
          state.dispatchResult !== null || state.dispatchError !== null
            ? state.generationId
            : undefined,
        generationInfo:
          state.dispatchResult !== null || state.dispatchError !== null
            ? state.generationInfo
            : undefined,
      })
      if (state.dispatchResult !== null) {
        push('token', { content: state.dispatchResult })
        if (state.emitTtsSideEffect) {
          push('side_effect', {
            kind: 'tts',
            payload: { text: state.dispatchResult, characterId: 'char-1' },
          })
        }
        for (const sideEffect of state.sideEffects) {
          push('side_effect', sideEffect)
        }
        push('done', {
          result: state.dispatchResult,
          generationId: state.generationId,
          generationInfo: state.generationInfo,
        })
      } else if (state.dispatchError !== null) {
        push('token', { content: 'partial' })
        push('error', { error: state.dispatchError, restoration: state.restoration })
        push('done', {
          generationId: state.generationId,
          generationInfo: state.generationInfo,
        })
      } else {
        push('done', {})
      }
      controller.close()
    },
  })
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

export async function serverChatFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const url =
    typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
  if (isTokenizerUrl(url)) return serveTokenizerFetch(url)
  if (url.endsWith('/api/v1/bootstrap')) {
    return new Response(JSON.stringify({ revision: 1, database: {} }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  if (url.endsWith('/generation-result')) {
    return new Response(
      JSON.stringify({
        revision: 2,
        event: {
          type: 'generation.persisted',
          revision: 2,
          resource: 'generation',
        },
        chatId: 'chat-1',
        messageId: state.generationId,
      }),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      },
    )
  }
  if (!url.endsWith('/api/v1/generate/chat')) {
    throw new Error(`unexpected fetch in dual-mode assembly fixture: ${url}`)
  }

  const method = init?.method ?? 'POST'
  const auth = (init?.headers as Record<string, string> | undefined)?.['risu-auth'] ?? null
  const rawBody = typeof init?.body === 'string' ? init.body : ''
  const body = JSON.parse(rawBody) as ChatPayload

  state.calls.push({
    url,
    method,
    authHeader: auth,
    chatId: typeof body.chatId === 'string' ? body.chatId : '',
    characterId: typeof body.characterId === 'string' ? body.characterId : '',
    mode: typeof body.mode === 'string' ? body.mode : '',
    userMessage: typeof body.userMessage === 'string' ? body.userMessage : '',
    regenerateMessageId:
      typeof body.regenerateMessageId === 'string' ? body.regenerateMessageId : '',
  })

  return sseChatResponse()
}
