/**
 * Fetch stub for the Phase 6-3 dual-mode fixture sweep. Emulates the
 * Phase 6-1 `POST /api/v1/generate/completion` route well enough to round-trip
 * the echo / openai / anthropic providers. Tokenizer JSON fetches
 * (`/token/*`) are served from disk via the shared shim. Any other URL is
 * rejected so an accidental escape inside a fixture surfaces loudly.
 */

import { isTokenizerUrl, serveTokenizerFetch } from './tokenizerFetch'

export interface ServerCompletionCall {
  url: string
  method: string
  provider: string
  model: string
  stream: boolean
  messagesLength: number
  options: unknown
  authHeader: string | null
}

interface CompletionPayload {
  provider?: unknown
  model?: unknown
  messages?: unknown
  stream?: unknown
  options?: unknown
}

const DEFAULT_OPENAI_RESULT = 'fixture openai reply'
const DEFAULT_ANTHROPIC_RESULT = 'fixture claude reply'
const DEFAULT_MISTRAL_RESULT = 'fixture mistral reply'
const DEFAULT_COHERE_RESULT = 'fixture cohere reply'

interface State {
  calls: ServerCompletionCall[]
  openaiResult: string
  anthropicResult: string
  mistralResult: string
  cohereResult: string
}

const state: State = {
  calls: [],
  openaiResult: DEFAULT_OPENAI_RESULT,
  anthropicResult: DEFAULT_ANTHROPIC_RESULT,
  mistralResult: DEFAULT_MISTRAL_RESULT,
  cohereResult: DEFAULT_COHERE_RESULT,
}

export function getServerCompletionCalls(): ServerCompletionCall[] {
  return state.calls
}

export function resetServerCompletionCalls(): void {
  state.calls = []
  state.openaiResult = DEFAULT_OPENAI_RESULT
  state.anthropicResult = DEFAULT_ANTHROPIC_RESULT
  state.mistralResult = DEFAULT_MISTRAL_RESULT
  state.cohereResult = DEFAULT_COHERE_RESULT
}

export function setOpenAIResult(text: string): void {
  state.openaiResult = text
}

export function setAnthropicResult(text: string): void {
  state.anthropicResult = text
}

export function setMistralResult(text: string): void {
  state.mistralResult = text
}

export function setCohereResult(text: string): void {
  state.cohereResult = text
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function sseResponse(message: string): Response {
  const enc = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        enc.encode(
          `event: chunk\ndata: ${JSON.stringify({ type: 'token', content: message })}\n\n`,
        ),
      )
      controller.enqueue(
        enc.encode(`event: done\ndata: ${JSON.stringify({ finishReason: 'stop' })}\n\n`),
      )
      controller.close()
    },
  })
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

export async function serverCompletionFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
  if (isTokenizerUrl(url)) return serveTokenizerFetch(url)
  if (!url.endsWith('/api/v1/generate/completion')) {
    throw new Error(`unexpected fetch in dual-mode fixture: ${url}`)
  }

  const method = init?.method ?? 'POST'
  const auth = (init?.headers as Record<string, string> | undefined)?.['risu-auth'] ?? null
  const rawBody = typeof init?.body === 'string' ? init.body : ''
  const body = JSON.parse(rawBody) as CompletionPayload

  const provider = typeof body.provider === 'string' ? body.provider : ''
  const model = typeof body.model === 'string' ? body.model : ''
  const stream = body.stream === true
  const messages = Array.isArray(body.messages) ? body.messages : []

  state.calls.push({
    url,
    method,
    provider,
    model,
    stream,
    messagesLength: messages.length,
    options: body.options ?? {},
    authHeader: auth,
  })

  if (provider === 'echo') {
    const echoOpts = (body.options as { echo?: { message?: string } } | undefined)?.echo
    const message = typeof echoOpts?.message === 'string' ? echoOpts.message : 'Echo Message'
    if (stream) return sseResponse(message)
    return jsonResponse({ type: 'success', result: message })
  }

  if (provider === 'openai' || provider === 'nanogpt' || provider === 'openrouter') {
    if (stream) return sseResponse(state.openaiResult)
    return jsonResponse({ type: 'success', result: state.openaiResult, model })
  }

  if (provider === 'anthropic') {
    if (stream) return sseResponse(state.anthropicResult)
    return jsonResponse({ type: 'success', result: state.anthropicResult, model })
  }

  if (provider === 'mistral') {
    if (stream) return sseResponse(state.mistralResult)
    return jsonResponse({ type: 'success', result: state.mistralResult, model })
  }

  if (provider === 'cohere') {
    // Cohere is non-streaming-only; the route 400s on stream=true.
    return jsonResponse({ type: 'success', result: state.cohereResult, model })
  }

  return jsonResponse({ reason: `provider not handled by fixture stub: ${provider}` }, 501)
}
