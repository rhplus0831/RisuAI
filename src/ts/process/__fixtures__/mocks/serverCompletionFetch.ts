/**
 * Fetch stub for the Phase 6-3 dual-mode fixture sweep. Emulates the
 * Phase 6-1 `POST /api/v1/generate/completion` route well enough to round-trip
 * the echo provider. Any other URL is rejected so an accidental escape inside
 * a fixture surfaces loudly.
 */

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

const state: { calls: ServerCompletionCall[] } = { calls: [] }

export function getServerCompletionCalls(): ServerCompletionCall[] {
  return state.calls
}

export function resetServerCompletionCalls(): void {
  state.calls = []
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

  if (provider !== 'echo') {
    return jsonResponse({ reason: `provider not handled by fixture stub: ${provider}` }, 501)
  }

  const echoOpts = (body.options as { echo?: { message?: string } } | undefined)?.echo
  const message = typeof echoOpts?.message === 'string' ? echoOpts.message : 'Echo Message'

  if (stream) {
    return sseResponse(message)
  }
  return jsonResponse({ type: 'success', result: message })
}
