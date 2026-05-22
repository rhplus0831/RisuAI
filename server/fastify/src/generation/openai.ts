import type { CompletionResult, CompletionStreamFrame } from './frames.js'

export interface OpenAIRequest {
  model: string
  messages: unknown[]
  apiKey: string
  baseUrl: string
  maxTokens?: number
  temperature?: number
  signal: AbortSignal
}

interface OpenAIResolveInput {
  model?: unknown
  messages?: unknown
  apiKey?: unknown
  baseUrl?: unknown
  maxTokens?: unknown
  temperature?: unknown
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
    signal: input.signal,
  }
}

function buildPayload(req: OpenAIRequest, stream: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: req.model,
    messages: req.messages,
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

function headers(req: OpenAIRequest): Record<string, string> {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${req.apiKey}`,
  }
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
 * Parse one SSE event block from OpenAI. They send `data: <json>` lines plus a
 * trailing `data: [DONE]` sentinel. We only care about the data payload here.
 */
function parseUpstreamData(block: string): string | null {
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

  let response: Response
  try {
    response = await fetch(endpoint(req), {
      method: 'POST',
      headers: headers(req),
      body: JSON.stringify(buildPayload(req, true)),
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
        const data = parseUpstreamData(block)
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
