import { applyAdditionalParameters } from './additionalParams.js'
import type { CompletionResult, CompletionStreamFrame } from './frames.js'
import {
  STREAM_BUFFER_OVERFLOW_ERROR,
  hasNonIgnorableSseTail,
  popSseEventBlock,
  streamBufferExceedsCap,
} from './sse.js'
import { readBoundedBodyJson, readBoundedBodyText } from './body.js'

export interface AnthropicRequest {
  model: string
  messages: unknown[]
  apiKey: string
  baseUrl: string
  version: string
  maxTokens: number
  system?: string
  temperature?: number
  /**
   * Pre-validated `[key, value][]` pairs from the SPA's additionalParams /
   * xcustom `params` DSL. Applied after the dispatcher builds its default
   * body + headers, so the user DSL has the last word. See
   * `./additionalParams.ts` for semantics.
   */
  additionalParams?: Array<[string, string]>
  signal: AbortSignal
}

interface AnthropicResolveInput {
  model?: unknown
  messages?: unknown
  apiKey?: unknown
  baseUrl?: unknown
  version?: unknown
  maxTokens?: unknown
  system?: unknown
  temperature?: unknown
  additionalParams?: Array<[string, string]>
  signal: AbortSignal
}

const DEFAULT_BASE_URL = 'https://api.anthropic.com/v1'
const DEFAULT_VERSION = '2023-06-01'
const DEFAULT_MAX_TOKENS = 1024

export function resolveAnthropicRequest(input: AnthropicResolveInput): AnthropicRequest | null {
  if (typeof input.model !== 'string' || input.model.length === 0) return null
  if (!Array.isArray(input.messages)) return null
  if (typeof input.apiKey !== 'string' || input.apiKey.length === 0) return null

  const baseUrl = typeof input.baseUrl === 'string' && input.baseUrl.length > 0 ? input.baseUrl : DEFAULT_BASE_URL
  const version = typeof input.version === 'string' && input.version.length > 0 ? input.version : DEFAULT_VERSION
  const maxTokens =
    typeof input.maxTokens === 'number' && Number.isFinite(input.maxTokens) && input.maxTokens > 0
      ? input.maxTokens
      : DEFAULT_MAX_TOKENS
  const temperature =
    typeof input.temperature === 'number' && Number.isFinite(input.temperature) ? input.temperature : undefined
  const system = typeof input.system === 'string' && input.system.length > 0 ? input.system : undefined

  return {
    model: input.model,
    messages: input.messages,
    apiKey: input.apiKey,
    baseUrl,
    version,
    maxTokens,
    system,
    temperature,
    additionalParams: input.additionalParams,
    signal: input.signal,
  }
}

function buildPayload(req: AnthropicRequest, stream: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: req.model,
    messages: req.messages,
    max_tokens: req.maxTokens,
    stream,
  }
  if (req.system !== undefined) body.system = req.system
  if (req.temperature !== undefined) body.temperature = req.temperature
  return body
}

function endpoint(req: AnthropicRequest): string {
  const base = req.baseUrl.endsWith('/') ? req.baseUrl.slice(0, -1) : req.baseUrl
  return `${base}/messages`
}

function buildHeaders(req: AnthropicRequest): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-api-key': req.apiKey,
    'anthropic-version': req.version,
  }
}

function buildRequestInit(req: AnthropicRequest, stream: boolean): { body: string; headers: Record<string, string> } {
  const body = buildPayload(req, stream)
  const headers = buildHeaders(req)
  if (req.additionalParams !== undefined && req.additionalParams.length > 0) {
    applyAdditionalParameters(body, headers, req.additionalParams)
  }
  return { body: JSON.stringify(body), headers }
}

interface AnthropicContentBlock {
  type?: unknown
  text?: unknown
}

interface AnthropicResponse {
  content?: AnthropicContentBlock[]
  model?: unknown
  stop_reason?: unknown
  error?: { message?: unknown; type?: unknown }
}

export async function runAnthropic(req: AnthropicRequest): Promise<CompletionResult> {
  if (req.signal.aborted) {
    return { type: 'fail', result: 'aborted', aborted: true }
  }

  const init = buildRequestInit(req, false)
  let response: Response
  try {
    response = await fetch(endpoint(req), {
      method: 'POST',
      headers: init.headers,
      body: init.body,
      signal: req.signal,
    })
  } catch (err) {
    if (req.signal.aborted) {
      return { type: 'fail', result: 'aborted', aborted: true }
    }
    const msg = err instanceof Error ? err.message : String(err)
    return { type: 'fail', result: `upstream fetch failed: ${msg}` }
  }

  let body: AnthropicResponse
  try {
    body = (await readBoundedBodyJson(response)) as AnthropicResponse
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { type: 'fail', result: `invalid upstream JSON: ${msg}` }
  }

  if (!response.ok) {
    const upstreamMsg = typeof body.error?.message === 'string' ? body.error.message : `HTTP ${response.status}`
    return { type: 'fail', result: upstreamMsg }
  }

  // Concatenate every text content block (anthropic may emit multiple).
  let text = ''
  if (Array.isArray(body.content)) {
    for (const block of body.content) {
      if (block.type === 'text' && typeof block.text === 'string') {
        text += block.text
      }
    }
  }
  if (text.length === 0) {
    return { type: 'fail', result: 'upstream returned no text content' }
  }

  const result: CompletionResult = { type: 'success', result: text }
  if (typeof body.model === 'string') result.model = body.model
  return result
}

interface AnthropicStreamEvent {
  event: string
  data: string
}

interface AnthropicDelta {
  type?: unknown
  text?: unknown
  stop_reason?: unknown
}

interface AnthropicStreamFrame {
  delta?: AnthropicDelta
}

interface AnthropicErrorResponse {
  error?: { message?: unknown; type?: unknown }
}

function parseUpstreamEvent(block: string): AnthropicStreamEvent | null {
  let event = ''
  let data = ''
  for (const line of block.split('\n')) {
    if (line.startsWith('event: ')) event = line.slice(7).trim()
    else if (line.startsWith('data: ')) data += line.slice(6)
  }
  if (!event) return null
  return { event, data }
}

function mapFinishReason(raw: unknown): CompletionStreamFrame['finishReason'] {
  if (typeof raw !== 'string' || raw.length === 0) return 'stop'
  if (raw === 'end_turn') return 'stop'
  if (raw === 'max_tokens') return 'length'
  if (raw === 'stop_sequence') return 'stop'
  return raw
}

async function readAnthropicStreamError(response: Response): Promise<CompletionStreamFrame> {
  let error = `HTTP ${response.status}`
  let code: string | undefined
  try {
    const text = await readBoundedBodyText(response)
    if (text.length > 0) {
      try {
        const parsed = JSON.parse(text) as AnthropicErrorResponse
        if (typeof parsed.error?.message === 'string' && parsed.error.message.length > 0) {
          error = parsed.error.message
        }
        if (typeof parsed.error?.type === 'string' && parsed.error.type.length > 0) {
          code = parsed.error.type
        }
      } catch {
        error = text
      }
    }
  } catch {
    // Keep the HTTP status fallback.
  }
  return { kind: 'error', error, status: response.status, code }
}

export async function* runAnthropicStream(req: AnthropicRequest): AsyncGenerator<CompletionStreamFrame, void, void> {
  if (req.signal.aborted) return

  const init = buildRequestInit(req, true)
  let response: Response
  try {
    response = await fetch(endpoint(req), {
      method: 'POST',
      headers: init.headers,
      body: init.body,
      signal: req.signal,
    })
  } catch (err) {
    if (req.signal.aborted) return
    const msg = err instanceof Error ? err.message : String(err)
    yield { kind: 'error', error: `upstream fetch failed: ${msg}`, code: 'fetch_failed' }
    return
  }

  if (!response.ok) {
    yield await readAnthropicStreamError(response)
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
  let sawStop = false

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

      let eventBlock = popSseEventBlock(buf)
      while (eventBlock !== null) {
        const { block } = eventBlock
        buf = eventBlock.rest
        eventBlock = popSseEventBlock(buf)
        const evt = parseUpstreamEvent(block)
        if (!evt) continue

        if (evt.event === 'content_block_delta') {
          try {
            const frame = JSON.parse(evt.data) as AnthropicStreamFrame
            const t = frame.delta?.text
            if (frame.delta?.type === 'text_delta' && typeof t === 'string' && t.length > 0) {
              yield { kind: 'token', content: t }
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            yield { kind: 'error', error: `invalid upstream stream JSON: ${msg}` }
            return
          }
        } else if (evt.event === 'message_delta') {
          try {
            const frame = JSON.parse(evt.data) as AnthropicStreamFrame
            if (frame.delta?.stop_reason !== undefined) {
              finishReason = mapFinishReason(frame.delta.stop_reason)
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            yield { kind: 'error', error: `invalid upstream stream JSON: ${msg}` }
            return
          }
        } else if (evt.event === 'message_stop') {
          sawStop = true
          yield { kind: 'done', finishReason }
          return
        }
        // message_start / content_block_start / content_block_stop / ping: ignore
      }
      // Post-drain the buffer holds at most one partial event; a
      // delimiter-less upstream must not grow it unbounded.
      if (streamBufferExceedsCap(buf)) {
        yield { kind: 'error', error: STREAM_BUFFER_OVERFLOW_ERROR }
        return
      }
    }
  } finally {
    reader.cancel().catch(() => {
      // swallow
    })
  }

  if (!sawStop && !req.signal.aborted) {
    buf += decoder.decode()
    if (hasNonIgnorableSseTail(buf)) {
      yield { kind: 'error', error: 'truncated upstream stream event' }
      return
    }
    yield { kind: 'done', finishReason }
  }
}
