import { getNodeServerProxyAuth } from '../../storage/fastifyStorage'
import { parseSseEvent } from './sseParse'
import type { RequestDataArgumentExtended, requestDataResponse } from './request'

export { formatToServerProvider } from './providerCapability'

const COMPLETION_ENDPOINT = '/api/v1/generate/completion'
const SERVER_INTENT_KIND = 'server-intent'

export type ServerCompletionRoute = { type: 'local' } | { type: 'server' } | { type: 'unsupported'; reason: string }

/**
 * Decide whether an already-assembled completion should go through Fastify.
 *
 * Provider policy is intentionally not resolved here. The browser owns only the
 * local-vs-server transport decision; Fastify resolves the selected provider,
 * model, endpoint, keys, and provider options from the unmasked server database.
 */
export function resolveServerCompletionRoute(targ: RequestDataArgumentExtended): ServerCompletionRoute {
  if (targ.previewBody === true) {
    return {
      type: 'unsupported',
      reason:
        'Provider preview bodies are not supported in Fastify server mode because browser-side provider dispatch is disabled.',
    }
  }
  return { type: 'server' }
}

export function getServerCompletionProvider(targ: RequestDataArgumentExtended): string | null {
  return resolveServerCompletionRoute(targ).type === 'server' ? SERVER_INTENT_KIND : null
}

export function extractAnthropicSystem(formated: Array<{ role: string; content: unknown }>): {
  messages: typeof formated
  system?: string
} {
  const systemTexts: string[] = []
  const messages: typeof formated = []
  for (const m of formated) {
    if (m.role === 'system' && typeof m.content === 'string' && m.content.length > 0) {
      systemTexts.push(m.content)
      continue
    }
    messages.push(m)
  }
  const system = systemTexts.length > 0 ? systemTexts.join('\n\n') : undefined
  return system === undefined ? { messages } : { messages, system }
}

interface CompletionJsonResponse {
  type?: unknown
  result?: unknown
  model?: unknown
}

async function readSseStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal | null,
): Promise<requestDataResponse> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let acc = ''
  let buf = ''
  let aborted = false
  let finished = false

  const cancel = (): void => {
    aborted = true
    reader.cancel().catch(() => {
      // swallow
    })
  }
  const onAbort = (): void => cancel()
  if (signal) {
    if (signal.aborted) {
      cancel()
    } else {
      signal.addEventListener('abort', onAbort, { once: true })
    }
  }

  try {
    while (!finished && !aborted) {
      const { value, done } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let sepIdx = buf.indexOf('\n\n')
      while (sepIdx !== -1) {
        const block = buf.slice(0, sepIdx)
        buf = buf.slice(sepIdx + 2)
        const evt = parseSseEvent(block)
        if (evt.event === 'done') {
          finished = true
          break
        }
        if (evt.event === 'error') {
          let reason = 'provider stream failed'
          try {
            const payload = JSON.parse(evt.data) as { error?: unknown; message?: unknown }
            if (typeof payload.error === 'string' && payload.error.length > 0) {
              reason = payload.error
            } else if (typeof payload.message === 'string' && payload.message.length > 0) {
              reason = payload.message
            }
          } catch {
            if (evt.data.length > 0) reason = evt.data
          }
          return { type: 'fail', result: reason }
        }
        if (evt.event === 'chunk') {
          try {
            const payload = JSON.parse(evt.data) as { type?: unknown; content?: unknown }
            if (payload.type === 'token' && typeof payload.content === 'string') {
              acc += payload.content
            }
          } catch {
            // ignore malformed frame
          }
        }
        sepIdx = buf.indexOf('\n\n')
      }
    }
  } finally {
    if (signal) signal.removeEventListener('abort', onAbort)
  }

  if (aborted) {
    return { type: 'fail', result: 'Aborted' }
  }
  return { type: 'success', result: acc }
}

export async function requestServerCompletion(
  targ: RequestDataArgumentExtended,
  signal: AbortSignal | null,
): Promise<requestDataResponse> {
  const useStreaming = targ.useStreaming === true
  const auth = await getNodeServerProxyAuth()
  const payload = {
    kind: SERVER_INTENT_KIND,
    messages: targ.formated,
    stream: useStreaming,
    mode: targ.mode ?? 'model',
    staticModel: targ.staticModel,
    fallbackProfileId: targ.fallbackProfileId,
    maxTokens: targ.maxTokens,
    temperature: targ.temperature,
    currentCharName: targ.currentChar?.name,
  }

  let response: Response
  try {
    response = await fetch(COMPLETION_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'risu-auth': auth,
      },
      body: JSON.stringify(payload),
      signal: signal ?? undefined,
    })
  } catch (err) {
    if (signal?.aborted) {
      return { type: 'fail', result: 'Aborted' }
    }
    const msg = err instanceof Error ? err.message : String(err)
    return { type: 'fail', result: `Network error: ${msg}` }
  }

  if (!response.ok) {
    let reason = `HTTP ${response.status}`
    try {
      const body = (await response.json()) as { reason?: unknown; error?: unknown }
      if (body && typeof body === 'object') {
        if (typeof body.reason === 'string') reason = body.reason
        else if (typeof body.error === 'string') reason = body.error
      }
    } catch {
      // ignore parse failure
    }
    return { type: 'fail', result: reason, noRetry: true }
  }

  if (useStreaming) {
    if (!response.body) {
      return { type: 'fail', result: 'No streaming body returned' }
    }
    return readSseStream(response.body, signal)
  }

  let json: CompletionJsonResponse
  try {
    json = (await response.json()) as CompletionJsonResponse
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { type: 'fail', result: `Invalid response: ${msg}` }
  }
  const type = json.type === 'fail' ? 'fail' : 'success'
  const result = typeof json.result === 'string' ? json.result : ''
  if (typeof json.model === 'string') {
    return { type, result, model: json.model }
  }
  return { type, result }
}
