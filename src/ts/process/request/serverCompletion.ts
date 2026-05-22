import { LLMFormat } from '../../model/types'
import { isFastifyServer } from '../../platform'
import { getDatabase } from '../../storage/database.svelte'
import { getNodeServerProxyAuth } from '../../storage/nodeStorage'
import type { RequestDataArgumentExtended, requestDataResponse } from './request'

const COMPLETION_ENDPOINT = '/api/v1/generate/completion'

export function formatToServerProvider(format: LLMFormat): string | null {
  switch (format) {
    case LLMFormat.Echo:
      return 'echo'
    default:
      return null
  }
}

export function getServerCompletionProvider(
  targ: RequestDataArgumentExtended,
): string | null {
  if (!isFastifyServer) return null
  const db = getDatabase()
  if (db.useServerGeneration !== true) return null
  if (targ.previewBody === true) return null
  if (!targ.modelInfo) return null
  return formatToServerProvider(targ.modelInfo.format)
}

function buildProviderOptions(
  targ: RequestDataArgumentExtended,
  provider: string,
): Record<string, unknown> {
  if (provider !== 'echo') return {}
  const db = getDatabase()
  return {
    echo: {
      message: db.echoMessage ?? 'Echo Message',
      delayMs: (db.echoDelay ?? 0) * 1000,
    },
  }
}

interface CompletionJsonResponse {
  type?: unknown
  result?: unknown
  model?: unknown
}

function parseSseEvent(block: string): { event: string; data: string } {
  let event = 'message'
  let data = ''
  for (const line of block.split('\n')) {
    if (line.startsWith('event: ')) event = line.slice(7).trim()
    else if (line.startsWith('data: ')) data += line.slice(6)
  }
  return { event, data }
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
  provider: string,
  signal: AbortSignal | null,
): Promise<requestDataResponse> {
  const useStreaming = targ.useStreaming === true
  const auth = await getNodeServerProxyAuth()
  const payload = {
    provider,
    model: targ.modelInfo?.id ?? targ.aiModel ?? '',
    messages: targ.formated,
    stream: useStreaming,
    options: buildProviderOptions(targ, provider),
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
    return { type: 'fail', result: reason }
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
