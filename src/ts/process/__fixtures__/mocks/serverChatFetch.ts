/**
 * Fetch stub for the Phase 7-12a `/chat` adapter and the upcoming 7-12b
 * dual-mode assembly sweep. Emulates `POST /api/v1/generate/chat` well
 * enough to round-trip the named SSE taxonomy (`stage` / `prompt` / `info`
 * / `error` / `done`). Tokenizer JSON fetches (`/token/*`) pass through the
 * shared shim; any other URL is rejected so an accidental escape surfaces.
 */

import { isTokenizerUrl, serveTokenizerFetch } from './tokenizerFetch'

export interface ServerChatCall {
  url: string
  method: string
  authHeader: string | null
  chatId: string
  characterId: string
  mode: string
}

interface ChatPayload {
  chatId?: unknown
  characterId?: unknown
  mode?: unknown
}

interface State {
  calls: ServerChatCall[]
  /** Messages returned on the `prompt` event. */
  promptMessages: Array<{ role: string; content: unknown }>
  /** promptInfo returned on the `prompt` event. */
  promptInfo: Record<string, unknown>
  /** Token counts returned on the `info` event. */
  inputTokens: number
  responseBudget: number
  /** When set, the stream emits a terminal `error` instead of `prompt`. */
  errorMessage: string | null
}

const DEFAULT_MESSAGES: Array<{ role: string; content: unknown }> = [
  { role: 'system', content: 'fixture system prompt' },
  { role: 'user', content: 'hi' },
]

const state: State = {
  calls: [],
  promptMessages: DEFAULT_MESSAGES,
  promptInfo: { promptText: 'fixture prompt text' },
  inputTokens: 7,
  responseBudget: 50,
  errorMessage: null,
}

export function resetServerChatState(): void {
  state.calls = []
  state.promptMessages = DEFAULT_MESSAGES
  state.promptInfo = { promptText: 'fixture prompt text' }
  state.inputTokens = 7
  state.responseBudget = 50
  state.errorMessage = null
}

export function getServerChatCalls(): ServerChatCall[] {
  return state.calls
}

export function setServerChatPrompt(
  messages: Array<{ role: string; content: unknown }>,
  promptInfo: Record<string, unknown> = {},
): void {
  state.promptMessages = messages
  state.promptInfo = promptInfo
}

export function setServerChatError(message: string): void {
  state.errorMessage = message
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
        push('error', { error: state.errorMessage })
        push('done', {})
        controller.close()
        return
      }
      push('prompt', {
        messages: state.promptMessages,
        promptInfo: state.promptInfo,
        lorebookActivation: null,
      })
      push('stage', { stage: 'prompt', status: 'end' })
      push('info', {
        timings: { prompt: 1 },
        tokens: { prompt: state.inputTokens, total: state.inputTokens },
        responseBudget: state.responseBudget,
      })
      push('done', {})
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
  })

  return sseChatResponse()
}
