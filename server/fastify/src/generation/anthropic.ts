import { applyAdditionalParameters } from './additionalParams.js'
import type { CompletionResult, CompletionStreamFrame } from './frames.js'

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

  const baseUrl =
    typeof input.baseUrl === 'string' && input.baseUrl.length > 0
      ? input.baseUrl
      : DEFAULT_BASE_URL
  const version =
    typeof input.version === 'string' && input.version.length > 0
      ? input.version
      : DEFAULT_VERSION
  const maxTokens =
    typeof input.maxTokens === 'number' && Number.isFinite(input.maxTokens) && input.maxTokens > 0
      ? input.maxTokens
      : DEFAULT_MAX_TOKENS
  const temperature =
    typeof input.temperature === 'number' && Number.isFinite(input.temperature)
      ? input.temperature
      : undefined
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

function buildRequestInit(
  req: AnthropicRequest,
  stream: boolean,
): { body: string; headers: Record<string, string> } {
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
  error?: { message?: unknown }
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
    body = (await response.json()) as AnthropicResponse
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { type: 'fail', result: `invalid upstream JSON: ${msg}` }
  }

  if (!response.ok) {
    const upstreamMsg =
      typeof body.error?.message === 'string'
        ? body.error.message
        : `HTTP ${response.status}`
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

export async function* runAnthropicStream(
  req: AnthropicRequest,
): AsyncGenerator<CompletionStreamFrame, void, void> {
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
  } catch {
    return
  }

  if (!response.ok || !response.body) {
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
      const { value, done } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })

      let sepIdx = buf.indexOf('\n\n')
      while (sepIdx !== -1) {
        const block = buf.slice(0, sepIdx)
        buf = buf.slice(sepIdx + 2)
        sepIdx = buf.indexOf('\n\n')
        const evt = parseUpstreamEvent(block)
        if (!evt) continue

        if (evt.event === 'content_block_delta') {
          try {
            const frame = JSON.parse(evt.data) as AnthropicStreamFrame
            const t = frame.delta?.text
            if (frame.delta?.type === 'text_delta' && typeof t === 'string' && t.length > 0) {
              yield { kind: 'token', content: t }
            }
          } catch {
            // ignore malformed frame
          }
        } else if (evt.event === 'message_delta') {
          try {
            const frame = JSON.parse(evt.data) as AnthropicStreamFrame
            if (frame.delta?.stop_reason !== undefined) {
              finishReason = mapFinishReason(frame.delta.stop_reason)
            }
          } catch {
            // ignore malformed frame
          }
        } else if (evt.event === 'message_stop') {
          sawStop = true
          yield { kind: 'done', finishReason }
          return
        }
        // message_start / content_block_start / content_block_stop / ping: ignore
      }
    }
  } finally {
    reader.cancel().catch(() => {
      // swallow
    })
  }

  if (!sawStop && !req.signal.aborted) {
    yield { kind: 'done', finishReason }
  }
}
