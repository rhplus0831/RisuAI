import { applyAdditionalParameters } from './additionalParams.js'
import type { CompletionResult, CompletionStreamFrame } from './frames.js'

export interface OpenAIRequest {
  model: string
  messages: unknown[]
  apiKey: string
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
   * `db.reverseProxyOobaMode` behavior (see
   * `src/ts/process/request/openAI/requests.ts:204-222`). Only used by the
   * reverse_proxy route today.
   */
  oobaSystemHoist?: boolean
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
  signal: AbortSignal
}

const DEFAULT_BASE_URL = 'https://api.openai.com/v1'

export function resolveOpenAIRequest(input: OpenAIResolveInput): OpenAIRequest | null {
  if (typeof input.model !== 'string' || input.model.length === 0) return null
  if (!Array.isArray(input.messages)) return null
  if (typeof input.apiKey !== 'string' || input.apiKey.length === 0) return null

  const baseUrl =
    typeof input.baseUrl === 'string' && input.baseUrl.length > 0
      ? input.baseUrl
      : DEFAULT_BASE_URL
  const maxTokens =
    typeof input.maxTokens === 'number' && Number.isFinite(input.maxTokens) && input.maxTokens > 0
      ? input.maxTokens
      : undefined
  const temperature =
    typeof input.temperature === 'number' && Number.isFinite(input.temperature)
      ? input.temperature
      : undefined

  return {
    model: input.model,
    messages: input.messages,
    apiKey: input.apiKey,
    baseUrl,
    maxTokens,
    temperature,
    extraHeaders: input.extraHeaders,
    additionalParams: input.additionalParams,
    oobaSystemHoist: input.oobaSystemHoist === true ? true : undefined,
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
 * `db.reverseProxyOobaMode` in the SPA's
 * `src/ts/process/request/openAI/requests.ts:204-222`, with the empty-stub
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
    authorization: `Bearer ${req.apiKey}`,
    ...(req.extraHeaders ?? {}),
  }
}

/**
 * Build the outgoing body + headers and apply the additionalParams DSL.
 * Centralizes the order: defaults first, extraHeaders second, user DSL last.
 */
function buildRequestInit(req: OpenAIRequest, stream: boolean): {
  body: string
  headers: Record<string, string>
} {
  const body = buildPayload(req, stream)
  const headers = buildHeaders(req)
  if (req.additionalParams !== undefined && req.additionalParams.length > 0) {
    applyAdditionalParameters(body, headers, req.additionalParams)
  }
  return { body: JSON.stringify(body), headers }
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

  let body: OpenAINonStreamResponse
  try {
    body = (await response.json()) as OpenAINonStreamResponse
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

export async function* runOpenAIStream(
  req: OpenAIRequest,
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
        const data = parseOpenAIStyleSseData(block)
        sepIdx = buf.indexOf('\n\n')
        if (data === null) continue
        if (data.trim() === '[DONE]') {
          yield { kind: 'done', finishReason }
          return
        }
        let frame: OpenAIStreamFrame
        try {
          frame = JSON.parse(data) as OpenAIStreamFrame
        } catch {
          continue
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
    }
  } finally {
    reader.cancel().catch(() => {
      // swallow
    })
  }

  if (!req.signal.aborted) {
    yield { kind: 'done', finishReason }
  }
}
