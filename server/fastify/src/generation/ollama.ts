import type { CompletionResult, CompletionStreamFrame } from './frames.js'
import { STREAM_BUFFER_OVERFLOW_ERROR, streamBufferExceedsCap } from './sse.js'
import { readBoundedBodyText } from './body.js'
import { formatUpstreamFetchError, formatUpstreamHttpError, upstreamStatusText } from './upstreamError.js'

export interface OllamaRequest {
  model: string
  messages: OllamaMessage[]
  baseUrl: string
  apiKey?: string
  maxTokens?: number
  temperature?: number
  topP?: number
  topK?: number
  tools?: OllamaTool[]
  extraHeaders?: Record<string, string>
  signal: AbortSignal
}

export interface OllamaMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  thinking?: string
  tool_calls?: OllamaToolCall[]
  tool_name?: string
}

export interface OllamaTool {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters?: unknown
  }
}

export interface OllamaToolCall {
  type?: 'function'
  function: {
    name: string
    arguments: Record<string, unknown>
  }
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
  tools?: unknown
  extraHeaders?: Record<string, string>
  signal: AbortSignal
}

interface RawChatMessage {
  role?: unknown
  content?: unknown
  thinking?: unknown
  tool_calls?: unknown
  tool_name?: unknown
  name?: unknown
}

/**
 * Filter to the role + content shape Ollama accepts. Content is coerced to
 * string; this dispatcher omits multimodal `parts` arrays.
 */
export function reformatForOllama(messages: RawChatMessage[]): OllamaMessage[] {
  const out: OllamaMessage[] = []
  for (const m of messages) {
    if (m.role !== 'user' && m.role !== 'assistant' && m.role !== 'system' && m.role !== 'tool') continue
    const content = typeof m.content === 'string' ? m.content : ''
    const row: OllamaMessage = { role: m.role, content }
    if (typeof m.thinking === 'string' && m.thinking.length > 0) row.thinking = m.thinking
    if (m.role === 'assistant') {
      const toolCalls = normalizeToolCalls(m.tool_calls)
      if (toolCalls.length > 0) row.tool_calls = toolCalls
    }
    if (m.role === 'tool') {
      const toolName =
        typeof m.tool_name === 'string' && m.tool_name.length > 0
          ? m.tool_name
          : typeof m.name === 'string' && m.name.length > 0
            ? m.name
            : undefined
      if (toolName) row.tool_name = toolName
    }
    out.push(row)
  }
  return out
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function parseArguments(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value
  if (typeof value !== 'string' || value.trim().length === 0) return {}
  try {
    const parsed = JSON.parse(value) as unknown
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function normalizeToolCalls(value: unknown): OllamaToolCall[] {
  if (!Array.isArray(value)) return []
  const calls: OllamaToolCall[] = []
  for (const item of value) {
    if (!isRecord(item) || !isRecord(item.function)) continue
    const name = typeof item.function.name === 'string' ? item.function.name : ''
    if (!name) continue
    calls.push({
      ...(item.type === 'function' ? { type: 'function' as const } : {}),
      function: {
        name,
        arguments: parseArguments(item.function.arguments),
      },
    })
  }
  return calls
}

function normalizeTools(value: unknown): OllamaTool[] | undefined {
  if (!Array.isArray(value)) return undefined
  const tools: OllamaTool[] = []
  for (const item of value) {
    if (!isRecord(item) || item.type !== 'function' || !isRecord(item.function)) continue
    const name = typeof item.function.name === 'string' ? item.function.name : ''
    if (!name) continue
    const tool: OllamaTool = {
      type: 'function',
      function: {
        name,
      },
    }
    if (typeof item.function.description === 'string') tool.function.description = item.function.description
    if (Object.prototype.hasOwnProperty.call(item.function, 'parameters')) {
      tool.function.parameters = item.function.parameters
    }
    tools.push(tool)
  }
  return tools.length > 0 ? tools : undefined
}

export function resolveOllamaRequest(input: OllamaResolveInput): OllamaRequest | null {
  if (typeof input.model !== 'string' || input.model.length === 0) return null
  if (!Array.isArray(input.messages)) return null
  if (typeof input.baseUrl !== 'string' || input.baseUrl.length === 0) return null

  const messages = reformatForOllama(input.messages as RawChatMessage[])
  if (messages.length === 0) return null

  const apiKey = typeof input.apiKey === 'string' && input.apiKey.length > 0 ? input.apiKey : undefined
  const maxTokens =
    typeof input.maxTokens === 'number' && Number.isFinite(input.maxTokens) && input.maxTokens > 0
      ? input.maxTokens
      : undefined
  const temperature =
    typeof input.temperature === 'number' && Number.isFinite(input.temperature) ? input.temperature : undefined
  const topP = typeof input.topP === 'number' && Number.isFinite(input.topP) ? input.topP : undefined
  const topK = typeof input.topK === 'number' && Number.isFinite(input.topK) ? input.topK : undefined
  const tools = normalizeTools(input.tools)

  return {
    model: input.model,
    messages,
    baseUrl: input.baseUrl,
    apiKey,
    maxTokens,
    temperature,
    topP,
    topK,
    tools,
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
  // Ollama's `options` block carries sampler knobs; this adapter currently
  // forwards temperature/top_p/top_k/num_predict.
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
  if (req.tools !== undefined && req.tools.length > 0) body.tools = req.tools
  return body
}

export interface OllamaResponseMessage {
  role?: unknown
  content?: unknown
  thinking?: unknown
  tool_calls?: unknown
}

export interface OllamaResponseBody {
  model?: unknown
  message?: OllamaResponseMessage
  done?: unknown
  done_reason?: unknown
  error?: unknown
}

type OllamaRawFailure = Omit<CompletionResult, 'type'> & { type: 'fail' }

export type OllamaRawResult =
  | {
      type: 'success'
      body: OllamaResponseBody
      model?: string
    }
  | OllamaRawFailure

type OllamaChunk = OllamaResponseBody

async function readOllamaStreamError(response: Response, url: string): Promise<CompletionStreamFrame> {
  let message: string | undefined
  try {
    const text = await readBoundedBodyText(response)
    if (text.length > 0) {
      try {
        const parsed = JSON.parse(text) as OllamaChunk
        if (typeof parsed.error === 'string' && parsed.error.length > 0) {
          message = parsed.error
        } else {
          message = text
        }
      } catch {
        message = text
      }
    }
  } catch {
    // Keep the HTTP status fallback.
  }
  const statusText = upstreamStatusText(response)
  return {
    kind: 'error',
    error: formatUpstreamHttpError(response, url, { message }),
    status: response.status,
    ...(statusText ? { statusText } : {}),
  }
}

function mapDoneReason(raw: unknown): CompletionStreamFrame['finishReason'] {
  if (typeof raw !== 'string' || raw.length === 0) return 'stop'
  if (raw === 'stop') return 'stop'
  if (raw === 'length') return 'length'
  return raw
}

export async function runOllamaRaw(req: OllamaRequest): Promise<OllamaRawResult> {
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
    raw = await readBoundedBodyText(response)
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

  const result: OllamaRawResult = { type: 'success', body }
  if (typeof body.model === 'string') result.model = body.model
  return result
}

export async function runOllama(req: OllamaRequest): Promise<CompletionResult> {
  const raw = await runOllamaRaw(req)
  if (raw.type === 'fail') return raw

  const body = raw.body

  const content = typeof body.message?.content === 'string' ? body.message.content : ''
  if (content.length === 0) {
    return { type: 'fail', result: 'upstream returned no message content' }
  }
  const result: CompletionResult = { type: 'success', result: content }
  if (raw.model) result.model = raw.model
  return result
}

export async function* runOllamaStream(req: OllamaRequest): AsyncGenerator<CompletionStreamFrame, void, void> {
  if (req.signal.aborted) return

  const url = endpoint(req)
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: headers(req),
      body: JSON.stringify(buildPayload(req, true)),
      signal: req.signal,
    })
  } catch (err) {
    if (req.signal.aborted) return
    const msg = err instanceof Error ? err.message : String(err)
    yield { kind: 'error', error: formatUpstreamFetchError(url, msg), code: 'fetch_failed' }
    return
  }

  if (!response.ok) {
    yield await readOllamaStreamError(response, url)
    return
  }

  if (!response.body) {
    const statusText = upstreamStatusText(response)
    yield {
      kind: 'error',
      error: formatUpstreamHttpError(response, url, { message: 'upstream returned no stream body' }),
      status: response.status,
      ...(statusText ? { statusText } : {}),
    }
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
      // Post-drain the buffer holds at most one partial line; a newline-less
      // upstream must not grow it unbounded.
      if (streamBufferExceedsCap(buf)) {
        yield { kind: 'error', error: STREAM_BUFFER_OVERFLOW_ERROR }
        return
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
