import { applyAdditionalParameters } from './additionalParams.js'
import { emitProtocolMetric } from '../protocolMetrics.js'
import type { CompletionResult, CompletionStreamFrame } from './frames.js'
import { providerBodyMetricFields, summarizeOpenAIProviderBody } from './providerBodySummary.js'
import {
  STREAM_BUFFER_OVERFLOW_ERROR,
  hasNonIgnorableSseTail,
  popSseEventBlock,
  streamBufferExceedsCap,
} from './sse.js'
import { readBoundedBodyText } from './body.js'
import { formatUpstreamFetchError, formatUpstreamHttpError, upstreamStatusText } from './upstreamError.js'
import {
  generationTraceSidecarMetricField,
  writeGenerationTraceSidecar,
  type GenerationTraceContext,
} from './generationTraceSidecar.js'

export interface OpenAIRequest {
  model: string
  messages: unknown[]
  apiKey?: string
  baseUrl: string
  maxTokens?: number
  temperature?: number
  extraHeaders?: Record<string, string>
  /**
   * Pre-validated `[key, value][]` pairs from the SPA's additionalParams /
   * xcustom `params` DSL. Applied to the body + headers after they're
   * constructed, so the user DSL has the last word. See
   * `./additionalParams.ts` for semantics.
   */
  additionalParams?: Array<[string, string]>
  /**
   * When true, every `role: 'system'` message is removed from the wire
   * payload and their contents are joined with `\n` into a single trailing
   * `role: 'system'` message. Mirrors the local SPA's
   * `db.reverseProxyOobaMode` handling in `requestOpenAI`. Only used by the
   * reverse_proxy route today.
   */
  oobaSystemHoist?: boolean
  trace?: GenerationTraceContext
  signal: AbortSignal
}

interface OpenAIResolveInput {
  model?: unknown
  messages?: unknown
  apiKey?: unknown
  baseUrl?: unknown
  maxTokens?: unknown
  temperature?: unknown
  extraHeaders?: Record<string, string>
  additionalParams?: Array<[string, string]>
  oobaSystemHoist?: boolean
  trace?: GenerationTraceContext
  signal: AbortSignal
}

const DEFAULT_BASE_URL = 'https://api.openai.com/v1'

export function resolveOpenAIRequest(input: OpenAIResolveInput): OpenAIRequest | null {
  if (typeof input.model !== 'string' || input.model.length === 0) return null
  if (!Array.isArray(input.messages)) return null

  const baseUrl = typeof input.baseUrl === 'string' && input.baseUrl.length > 0 ? input.baseUrl : DEFAULT_BASE_URL
  const apiKey = typeof input.apiKey === 'string' && input.apiKey.length > 0 ? input.apiKey : undefined
  const maxTokens =
    typeof input.maxTokens === 'number' && Number.isFinite(input.maxTokens) && input.maxTokens > 0
      ? input.maxTokens
      : undefined
  const temperature =
    typeof input.temperature === 'number' && Number.isFinite(input.temperature) ? input.temperature : undefined

  return {
    model: input.model,
    messages: input.messages,
    apiKey,
    baseUrl,
    maxTokens,
    temperature,
    extraHeaders: input.extraHeaders,
    additionalParams: input.additionalParams,
    oobaSystemHoist: input.oobaSystemHoist === true ? true : undefined,
    trace: input.trace,
    signal: input.signal,
  }
}

interface ChatMessage {
  role?: unknown
  content?: unknown
}

/**
 * Remove every `role: 'system'` row and append a single trailing system
 * row whose content is the joined original system contents. Mirrors
 * `db.reverseProxyOobaMode` in the SPA's `requestOpenAI`, with the empty-stub
 * cleanup (`db.newOAIHandle === true` default) folded in.
 */
export function applyOobaSystemHoist(messages: unknown[]): unknown[] {
  const systemTexts: string[] = []
  const passthrough: unknown[] = []
  for (const m of messages) {
    const row = m as ChatMessage
    if (row && row.role === 'system' && typeof row.content === 'string') {
      systemTexts.push(row.content)
      continue
    }
    passthrough.push(m)
  }
  if (systemTexts.length === 0) return messages
  return [...passthrough, { role: 'system', content: systemTexts.join('\n') }]
}

function buildPayload(req: OpenAIRequest, stream: boolean): Record<string, unknown> {
  const messages = req.oobaSystemHoist === true ? applyOobaSystemHoist(req.messages) : req.messages
  const body: Record<string, unknown> = {
    model: req.model,
    messages,
    stream,
  }
  if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens
  if (req.temperature !== undefined) body.temperature = req.temperature
  return body
}

function endpoint(req: OpenAIRequest): string {
  const base = req.baseUrl.endsWith('/') ? req.baseUrl.slice(0, -1) : req.baseUrl
  return `${base}/chat/completions`
}

function buildHeaders(req: OpenAIRequest): Record<string, string> {
  return {
    'content-type': 'application/json',
    ...(req.apiKey ? { authorization: `Bearer ${req.apiKey}` } : {}),
    ...(req.extraHeaders ?? {}),
  }
}

/**
 * Build the outgoing body + headers and apply the additionalParams DSL.
 * Centralizes the order: defaults first, extraHeaders second, user DSL last.
 */
function buildRequestInit(
  req: OpenAIRequest,
  stream: boolean,
): {
  payload: Record<string, unknown>
  body: string
  headers: Record<string, string>
} {
  const body = buildPayload(req, stream)
  const headers = buildHeaders(req)
  if (req.additionalParams !== undefined && req.additionalParams.length > 0) {
    applyAdditionalParameters(body, headers, req.additionalParams)
  }
  return { payload: body, body: JSON.stringify(body), headers }
}

async function emitOpenAIProviderBodyMetric(
  url: string,
  init: { payload: Record<string, unknown>; body: string; headers: Record<string, string> },
  stream: boolean,
  trace?: GenerationTraceContext,
): Promise<void> {
  const providerBodySidecar = await writeGenerationTraceSidecar({
    context: trace,
    kind: stream ? 'openai-stream-body' : 'openai-body',
    value: {
      provider: 'openai',
      stream,
      url,
      headers: init.headers,
      body: init.payload,
    },
  })
  emitProtocolMetric('generation_provider_request_body', () => ({
    ...providerBodyMetricFields({
      provider: 'openai',
      stream,
      url,
      body: init.payload,
      bodyText: init.body,
    }),
    ...summarizeOpenAIProviderBody(init.payload),
    ...generationTraceSidecarMetricField('providerBodySidecar', providerBodySidecar),
  }))
}

interface OpenAINonStreamChoice {
  message?: { content?: unknown }
  finish_reason?: unknown
}

interface OpenAINonStreamResponse {
  choices?: OpenAINonStreamChoice[]
  model?: unknown
  error?: { message?: unknown }
}

export async function runOpenAI(req: OpenAIRequest): Promise<CompletionResult> {
  if (req.signal.aborted) {
    return { type: 'fail', result: 'aborted', aborted: true }
  }

  const init = buildRequestInit(req, false)
  const url = endpoint(req)
  let response: Response
  try {
    await emitOpenAIProviderBodyMetric(url, init, false, req.trace)
    response = await fetch(url, {
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
    return { type: 'fail', result: formatUpstreamFetchError(url, msg), code: 'fetch_failed' }
  }

  let raw: string
  try {
    raw = await readBoundedBodyText(response)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { type: 'fail', result: `invalid upstream body: ${msg}` }
  }

  if (!response.ok) {
    let message: string | undefined
    let code: string | undefined
    try {
      const body = JSON.parse(raw) as OpenAINonStreamResponse & { error?: { code?: unknown } }
      if (typeof body.error?.message === 'string' && body.error.message.length > 0) {
        message = body.error.message
      }
      if (typeof body.error?.code === 'string' && body.error.code.length > 0) {
        code = body.error.code
      }
    } catch {
      if (raw.trim().length > 0) message = raw
    }
    const statusText = upstreamStatusText(response)
    return {
      type: 'fail',
      result: formatUpstreamHttpError(response, url, { message, code }),
      status: response.status,
      ...(statusText ? { statusText } : {}),
      ...(code ? { code } : {}),
    }
  }

  let body: OpenAINonStreamResponse
  try {
    body = JSON.parse(raw) as OpenAINonStreamResponse
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { type: 'fail', result: `invalid upstream JSON: ${msg}` }
  }

  const choice = Array.isArray(body.choices) ? body.choices[0] : undefined
  const content = choice?.message?.content
  if (typeof content !== 'string') {
    return { type: 'fail', result: 'upstream returned no content' }
  }

  const result: CompletionResult = { type: 'success', result: content }
  if (typeof body.model === 'string') result.model = body.model
  return result
}

interface OpenAIDelta {
  content?: unknown
}

interface OpenAIStreamChoice {
  delta?: OpenAIDelta
  finish_reason?: unknown
}

interface OpenAIStreamFrame {
  choices?: OpenAIStreamChoice[]
}

interface OpenAIErrorResponse {
  error?: { message?: unknown; code?: unknown }
}

function mapFinishReason(raw: unknown): CompletionStreamFrame['finishReason'] {
  if (typeof raw !== 'string' || raw.length === 0) return 'stop'
  return raw
}

/**
 * Parse one SSE event block from an OpenAI-shape stream. Upstream sends
 * `data: <json>` lines plus a trailing `data: [DONE]` sentinel. Exported so
 * other OpenAI-wire-shape providers (Mistral, etc.) can share the framing.
 */
export function parseOpenAIStyleSseData(block: string): string | null {
  let data = ''
  for (const line of block.split('\n')) {
    if (line.startsWith('data: ')) data += line.slice(6)
    else if (line.startsWith('data:')) data += line.slice(5)
  }
  return data.length > 0 ? data : null
}

async function readOpenAIStreamError(response: Response, url: string): Promise<CompletionStreamFrame> {
  let message: string | undefined
  let code: string | undefined
  try {
    const text = await readBoundedBodyText(response)
    if (text.length > 0) {
      try {
        const parsed = JSON.parse(text) as OpenAIErrorResponse
        if (typeof parsed.error?.message === 'string' && parsed.error.message.length > 0) {
          message = parsed.error.message
        }
        if (typeof parsed.error?.code === 'string' && parsed.error.code.length > 0) {
          code = parsed.error.code
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
    error: formatUpstreamHttpError(response, url, { message, code }),
    status: response.status,
    ...(statusText ? { statusText } : {}),
    ...(code ? { code } : {}),
  }
}

export async function* runOpenAIStream(req: OpenAIRequest): AsyncGenerator<CompletionStreamFrame, void, void> {
  if (req.signal.aborted) return

  const init = buildRequestInit(req, true)
  const url = endpoint(req)
  let response: Response
  try {
    await emitOpenAIProviderBodyMetric(url, init, true, req.trace)
    response = await fetch(url, {
      method: 'POST',
      headers: init.headers,
      body: init.body,
      signal: req.signal,
    })
  } catch (err) {
    if (req.signal.aborted) return
    const msg = err instanceof Error ? err.message : String(err)
    yield { kind: 'error', error: formatUpstreamFetchError(url, msg), code: 'fetch_failed' }
    return
  }

  if (!response.ok) {
    yield await readOpenAIStreamError(response, url)
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

      let evt = popSseEventBlock(buf)
      while (evt !== null) {
        const { block } = evt
        buf = evt.rest
        const data = parseOpenAIStyleSseData(block)
        evt = popSseEventBlock(buf)
        if (data === null) continue
        if (data.trim() === '[DONE]') {
          yield { kind: 'done', finishReason }
          return
        }
        let frame: OpenAIStreamFrame
        try {
          frame = JSON.parse(data) as OpenAIStreamFrame
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          yield { kind: 'error', error: `invalid upstream stream JSON: ${msg}` }
          return
        }
        const choice = Array.isArray(frame.choices) ? frame.choices[0] : undefined
        const delta = choice?.delta?.content
        if (typeof delta === 'string' && delta.length > 0) {
          yield { kind: 'token', content: delta }
        }
        if (choice?.finish_reason) {
          finishReason = mapFinishReason(choice.finish_reason)
        }
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

  if (!req.signal.aborted) {
    buf += decoder.decode()
    if (hasNonIgnorableSseTail(buf)) {
      yield { kind: 'error', error: 'truncated upstream stream event' }
      return
    }
    yield { kind: 'done', finishReason }
  }
}
