import type { CompletionResult, CompletionStreamFrame } from './frames.js'

export interface OllamaRequest {
  model: string
  messages: OllamaMessage[]
  baseUrl: string
  apiKey?: string
  maxTokens?: number
  temperature?: number
  topP?: number
  topK?: number
  extraHeaders?: Record<string, string>
  signal: AbortSignal
}

export interface OllamaMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

interface OllamaResolveInput {
  model?: unknown
  messages?: unknown
  baseUrl?: unknown
  apiKey?: unknown
  maxTokens?: unknown
  temperature?: unknown
  topP?: unknown
  topK?: unknown
  extraHeaders?: Record<string, string>
  signal: AbortSignal
}

interface RawChatMessage {
  role?: unknown
  content?: unknown
}

/**
 * Filter to the role + content shape Ollama accepts. The local browser path in
 * `src/ts/process/request/request.ts:1227-1234` only forwards user / assistant
 * / system rows; tool / function rows are dropped. Content is coerced to
 * string — multimodal `parts` arrays are not yet supported on this dispatcher.
 */
export function reformatForOllama(messages: RawChatMessage[]): OllamaMessage[] {
  const out: OllamaMessage[] = []
  for (const m of messages) {
    if (m.role !== 'user' && m.role !== 'assistant' && m.role !== 'system') continue
    const content = typeof m.content === 'string' ? m.content : ''
    out.push({ role: m.role, content })
  }
  return out
}

export function resolveOllamaRequest(input: OllamaResolveInput): OllamaRequest | null {
  if (typeof input.model !== 'string' || input.model.length === 0) return null
  if (!Array.isArray(input.messages)) return null
  if (typeof input.baseUrl !== 'string' || input.baseUrl.length === 0) return null

  const messages = reformatForOllama(input.messages as RawChatMessage[])
  if (messages.length === 0) return null

  const apiKey =
    typeof input.apiKey === 'string' && input.apiKey.length > 0 ? input.apiKey : undefined
  const maxTokens =
    typeof input.maxTokens === 'number' && Number.isFinite(input.maxTokens) && input.maxTokens > 0
      ? input.maxTokens
      : undefined
  const temperature =
    typeof input.temperature === 'number' && Number.isFinite(input.temperature)
      ? input.temperature
      : undefined
  const topP =
    typeof input.topP === 'number' && Number.isFinite(input.topP) ? input.topP : undefined
  const topK =
    typeof input.topK === 'number' && Number.isFinite(input.topK) ? input.topK : undefined

  return {
    model: input.model,
    messages,
    baseUrl: input.baseUrl,
    apiKey,
    maxTokens,
    temperature,
    topP,
    topK,
    extraHeaders: input.extraHeaders,
    signal: input.signal,
  }
}

function endpoint(req: OllamaRequest): string {
  const base = req.baseUrl.endsWith('/') ? req.baseUrl.slice(0, -1) : req.baseUrl
  return `${base}/api/chat`
}

function headers(req: OllamaRequest): Record<string, string> {
  const h: Record<string, string> = { 'content-type': 'application/json' }
  if (req.apiKey !== undefined) h.authorization = `Bearer ${req.apiKey}`
  if (req.extraHeaders !== undefined) Object.assign(h, req.extraHeaders)
  return h
}

function buildPayload(req: OllamaRequest, stream: boolean): Record<string, unknown> {
  // Ollama's `options` block carries the sampler knobs. The local code passes
  // these through `db.ollamaThinkingMode` etc.; we forward only the subset the
  // adapter validates today (temperature/top_p/top_k/num_predict).
  const options: Record<string, unknown> = {}
  if (req.maxTokens !== undefined) options.num_predict = req.maxTokens
  if (req.temperature !== undefined) options.temperature = req.temperature
  if (req.topP !== undefined) options.top_p = req.topP
  if (req.topK !== undefined) options.top_k = req.topK
  const body: Record<string, unknown> = {
    model: req.model,
    messages: req.messages,
    stream,
  }
  if (Object.keys(options).length > 0) body.options = options
  return body
}

interface OllamaChunk {
  model?: unknown
  message?: { role?: unknown; content?: unknown; thinking?: unknown }
  done?: unknown
  done_reason?: unknown
  error?: unknown
}

async function readOllamaStreamError(response: Response): Promise<CompletionStreamFrame> {
  let error = `HTTP ${response.status}`
  try {
    const text = await response.text()
    if (text.length > 0) {
      try {
        const parsed = JSON.parse(text) as OllamaChunk
        if (typeof parsed.error === 'string' && parsed.error.length > 0) {
          error = parsed.error
        } else {
          error = text
        }
      } catch {
        error = text
      }
    }
  } catch {
    // Keep the HTTP status fallback.
  }
  return { kind: 'error', error, status: response.status }
}

function mapDoneReason(raw: unknown): CompletionStreamFrame['finishReason'] {
  if (typeof raw !== 'string' || raw.length === 0) return 'stop'
  if (raw === 'stop') return 'stop'
  if (raw === 'length') return 'length'
  return raw
}

export async function runOllama(req: OllamaRequest): Promise<CompletionResult> {
  if (req.signal.aborted) {
    return { type: 'fail', result: 'aborted', aborted: true }
  }

  let response: Response
  try {
    response = await fetch(endpoint(req), {
      method: 'POST',
      headers: headers(req),
      body: JSON.stringify(buildPayload(req, false)),
      signal: req.signal,
    })
  } catch (err) {
    if (req.signal.aborted) {
      return { type: 'fail', result: 'aborted', aborted: true }
    }
    const msg = err instanceof Error ? err.message : String(err)
    return { type: 'fail', result: `upstream fetch failed: ${msg}` }
  }

  let raw: string
  try {
    raw = await response.text()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { type: 'fail', result: `invalid upstream body: ${msg}` }
  }

  if (!response.ok) {
    try {
      const parsed = JSON.parse(raw) as OllamaChunk
      if (typeof parsed.error === 'string') {
        return { type: 'fail', result: parsed.error }
      }
    } catch {
      // fall through to raw
    }
    return { type: 'fail', result: raw }
  }

  let body: OllamaChunk
  try {
    body = JSON.parse(raw) as OllamaChunk
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { type: 'fail', result: `invalid upstream JSON: ${msg}` }
  }

  const content = typeof body.message?.content === 'string' ? body.message.content : ''
  if (content.length === 0) {
    return { type: 'fail', result: 'upstream returned no message content' }
  }
  const result: CompletionResult = { type: 'success', result: content }
  if (typeof body.model === 'string') result.model = body.model
  return result
}

export async function* runOllamaStream(
  req: OllamaRequest,
): AsyncGenerator<CompletionStreamFrame, void, void> {
  if (req.signal.aborted) return

  let response: Response
  try {
    response = await fetch(endpoint(req), {
      method: 'POST',
      headers: headers(req),
      body: JSON.stringify(buildPayload(req, true)),
      signal: req.signal,
    })
  } catch (err) {
    if (req.signal.aborted) return
    const msg = err instanceof Error ? err.message : String(err)
    yield { kind: 'error', error: `upstream fetch failed: ${msg}`, code: 'fetch_failed' }
    return
  }

  if (!response.ok) {
    yield await readOllamaStreamError(response)
    return
  }

  if (!response.body) {
    yield { kind: 'error', error: 'upstream returned no stream body', status: response.status }
    return
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let finishReason: CompletionStreamFrame['finishReason'] = 'stop'
  let sawDone = false

  try {
    while (true) {
      if (req.signal.aborted) return
      let readResult: ReadableStreamReadResult<Uint8Array>
      try {
        readResult = await reader.read()
      } catch (err) {
        if (req.signal.aborted) return
        const msg = err instanceof Error ? err.message : String(err)
        yield { kind: 'error', error: `upstream stream read failed: ${msg}` }
        return
      }
      const { value, done } = readResult
      if (done) break
      buf += decoder.decode(value, { stream: true })
      // Ollama streams NDJSON: one JSON object per `\n`-terminated line. A
      // trailing partial line is held in `buf` until the next read.
      let nlIdx = buf.indexOf('\n')
      while (nlIdx !== -1) {
        const line = buf.slice(0, nlIdx).trim()
        buf = buf.slice(nlIdx + 1)
        nlIdx = buf.indexOf('\n')
        if (line.length === 0) continue
        let chunk: OllamaChunk
        try {
          chunk = JSON.parse(line) as OllamaChunk
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          yield { kind: 'error', error: `invalid upstream stream JSON: ${msg}` }
          return
        }
        if (typeof chunk.error === 'string' && chunk.error.length > 0) {
          yield { kind: 'error', error: chunk.error }
          return
        }
        const text = typeof chunk.message?.content === 'string' ? chunk.message.content : ''
        if (text.length > 0) {
          yield { kind: 'token', content: text }
        }
        if (chunk.done === true) {
          sawDone = true
          finishReason = mapDoneReason(chunk.done_reason)
        }
      }
    }
    // The body may end without a trailing newline; try to parse the tail.
    const tail = buf.trim()
    if (tail.length > 0) {
      try {
        const chunk = JSON.parse(tail) as OllamaChunk
        if (typeof chunk.error === 'string' && chunk.error.length > 0) {
          yield { kind: 'error', error: chunk.error }
          return
        }
        const text = typeof chunk.message?.content === 'string' ? chunk.message.content : ''
        if (text.length > 0) {
          yield { kind: 'token', content: text }
        }
        if (chunk.done === true) {
          sawDone = true
          finishReason = mapDoneReason(chunk.done_reason)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        yield { kind: 'error', error: `invalid upstream stream JSON: ${msg}` }
        return
      }
    }
  } finally {
    reader.cancel().catch(() => {
      // swallow
    })
  }

  if (!req.signal.aborted && sawDone) {
    yield { kind: 'done', finishReason }
  } else if (!req.signal.aborted) {
    yield { kind: 'done', finishReason: 'stop' }
  }
}
