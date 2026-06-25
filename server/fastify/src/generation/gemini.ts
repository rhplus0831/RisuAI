import type { CompletionResult, CompletionStreamFrame } from './frames.js'
import { emitProtocolMetric } from '../protocolMetrics.js'
import { providerBodyMetricFields, summarizeGeminiProviderBody } from './providerBodySummary.js'
import {
  STREAM_BUFFER_OVERFLOW_ERROR,
  hasNonIgnorableSseTail,
  popSseEventBlock,
  streamBufferExceedsCap,
} from './sse.js'
import { resolveVertexBearer } from './vertexAuth.js'
import { readBoundedBodyText } from './body.js'
import { formatUpstreamFetchError, formatUpstreamHttpError, upstreamStatusText } from './upstreamError.js'

export interface VertexAuthInput {
  projectId: string
  region: string
  clientEmail: string
  privateKey: string
}

export interface GeminiRequest {
  model: string
  contents: GeminiContent[]
  systemInstruction?: string
  /**
   * Vanilla Google AI Studio path: query-string `key=<apiKey>` against
   * `generativelanguage.googleapis.com`.
   */
  apiKey?: string
  /**
   * Vertex AI path: Bearer-auth against
   * `<region>-aiplatform.googleapis.com` (or the `global` endpoint when
   * `region === 'global'`). When `vertex` is set, `apiKey` is ignored.
   */
  vertex?: VertexAuthInput
  baseUrl: string
  maxOutputTokens?: number
  temperature?: number
  topP?: number
  topK?: number
  signal: AbortSignal
}

export interface GeminiContent {
  role: 'user' | 'model'
  parts: Array<{ text: string }>
}

interface GeminiResolveInput {
  model?: unknown
  messages?: unknown
  apiKey?: unknown
  vertex?: VertexAuthInput
  baseUrl?: unknown
  maxOutputTokens?: unknown
  temperature?: unknown
  topP?: unknown
  topK?: unknown
  signal: AbortSignal
}

interface RawChatMessage {
  role?: unknown
  content?: unknown
}

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'

/**
 * Gemini takes:
 *   - `systemInstruction` as a top-level field (parts of system rows joined),
 *   - `contents` alternating between `user` and `model` roles with `parts`.
 *
 * Function/tool rows are dropped. Consecutive same-role rows are coalesced
 * since Gemini also rejects two `user` (or two `model`) in a row. Supports the
 * text-only browser request shape; tool, multimodal, thinking-config, and
 * response-schema rows are omitted.
 */
export interface GeminiReformatResult {
  contents: GeminiContent[]
  systemInstruction?: string
}

export function reformatForGemini(messages: RawChatMessage[]): GeminiReformatResult {
  const systemTexts: string[] = []
  const contents: GeminiContent[] = []
  for (const m of messages) {
    const content = typeof m.content === 'string' ? m.content : ''
    if (m.role === 'system') {
      if (content.length > 0) systemTexts.push(content)
      continue
    }
    const role: 'user' | 'model' = m.role === 'assistant' ? 'model' : m.role === 'user' ? 'user' : 'user'
    if (m.role !== 'user' && m.role !== 'assistant') continue
    const prev = contents[contents.length - 1]
    if (prev && prev.role === role) {
      prev.parts[0].text += `\n${content}`
      continue
    }
    contents.push({ role, parts: [{ text: content }] })
  }
  const systemInstruction = systemTexts.length > 0 ? systemTexts.join('\n\n') : undefined
  return systemInstruction === undefined ? { contents } : { contents, systemInstruction }
}

export function resolveGeminiRequest(input: GeminiResolveInput): GeminiRequest | null {
  if (typeof input.model !== 'string' || input.model.length === 0) return null
  if (!Array.isArray(input.messages)) return null
  const hasApiKey = typeof input.apiKey === 'string' && (input.apiKey as string).length > 0
  const hasVertex =
    !!input.vertex &&
    typeof input.vertex.projectId === 'string' &&
    input.vertex.projectId.length > 0 &&
    typeof input.vertex.region === 'string' &&
    input.vertex.region.length > 0 &&
    typeof input.vertex.clientEmail === 'string' &&
    input.vertex.clientEmail.length > 0 &&
    typeof input.vertex.privateKey === 'string' &&
    input.vertex.privateKey.length > 0
  if (!hasApiKey && !hasVertex) return null

  const reformat = reformatForGemini(input.messages as RawChatMessage[])
  if (reformat.contents.length === 0) return null

  // Vertex requests don't take a baseUrl override — the URL is derived from
  // projectId + region. Only Studio respects baseUrl.
  const baseUrl = typeof input.baseUrl === 'string' && input.baseUrl.length > 0 ? input.baseUrl : DEFAULT_BASE_URL
  const maxOutputTokens =
    typeof input.maxOutputTokens === 'number' && Number.isFinite(input.maxOutputTokens) && input.maxOutputTokens > 0
      ? input.maxOutputTokens
      : undefined
  const temperature =
    typeof input.temperature === 'number' && Number.isFinite(input.temperature) ? input.temperature : undefined
  const topP = typeof input.topP === 'number' && Number.isFinite(input.topP) ? input.topP : undefined
  const topK = typeof input.topK === 'number' && Number.isFinite(input.topK) ? input.topK : undefined

  return {
    model: input.model,
    contents: reformat.contents,
    systemInstruction: reformat.systemInstruction,
    apiKey: hasApiKey ? (input.apiKey as string) : undefined,
    vertex: hasVertex ? input.vertex : undefined,
    baseUrl,
    maxOutputTokens,
    temperature,
    topP,
    topK,
    signal: input.signal,
  }
}

function buildPayload(req: GeminiRequest): Record<string, unknown> {
  const generationConfig: Record<string, unknown> = {}
  if (req.maxOutputTokens !== undefined) generationConfig.maxOutputTokens = req.maxOutputTokens
  if (req.temperature !== undefined) generationConfig.temperature = req.temperature
  if (req.topP !== undefined) generationConfig.topP = req.topP
  if (req.topK !== undefined) generationConfig.topK = req.topK
  const body: Record<string, unknown> = {
    contents: req.contents,
    generationConfig,
  }
  if (req.systemInstruction !== undefined) {
    body.systemInstruction = { parts: [{ text: req.systemInstruction }] }
  }
  return body
}

/**
 * Some Gemini 3 preview models (as of 2025-12) are only available on the
 * `global` Vertex endpoint regardless of the user's configured region.
 * Mirror the SPA check at
 * `src/ts/process/request/google.ts:457-460`.
 */
const VERTEX_GLOBAL_ONLY = /^gemini-3-.*-preview$/

function endpointStudio(req: GeminiRequest, stream: boolean): string {
  const base = req.baseUrl.endsWith('/') ? req.baseUrl.slice(0, -1) : req.baseUrl
  const method = stream ? 'streamGenerateContent' : 'generateContent'
  const apiKey = req.apiKey as string
  const tail = stream
    ? `:${method}?alt=sse&key=${encodeURIComponent(apiKey)}`
    : `:${method}?key=${encodeURIComponent(apiKey)}`
  return `${base}/models/${req.model}${tail}`
}

function endpointVertex(req: GeminiRequest, stream: boolean): string {
  const vertex = req.vertex as VertexAuthInput
  const region = VERTEX_GLOBAL_ONLY.test(req.model) ? 'global' : vertex.region
  const method = stream ? 'streamGenerateContent' : 'generateContent'
  const query = stream ? '?alt=sse' : ''
  const host = region === 'global' ? 'https://aiplatform.googleapis.com' : `https://${region}-aiplatform.googleapis.com`
  return `${host}/v1/projects/${vertex.projectId}/locations/${region}/publishers/google/models/${req.model}:${method}${query}`
}

function endpoint(req: GeminiRequest, stream: boolean): string {
  return req.vertex !== undefined ? endpointVertex(req, stream) : endpointStudio(req, stream)
}

function headers(): Record<string, string> {
  return { 'content-type': 'application/json' }
}

function emitGeminiProviderBodyMetric(args: {
  url: string
  body: Record<string, unknown>
  bodyText: string
  model: string
  stream: boolean
}): void {
  emitProtocolMetric('generation_provider_request_body', () => ({
    ...providerBodyMetricFields({
      provider: 'gemini',
      stream: args.stream,
      url: args.url,
      body: args.body,
      bodyText: args.bodyText,
      requestModel: args.model,
    }),
    ...summarizeGeminiProviderBody(args.body),
  }))
}

/**
 * For Vertex requests, fetch a fresh (or cached) Bearer and set
 * `Authorization: Bearer ...`. Returns `null` if the token exchange
 * failed; callers propagate the error to the caller as a `fail` result.
 */
async function vertexHeaders(
  req: GeminiRequest,
): Promise<{ ok: true; headers: Record<string, string> } | { ok: false; error: string }> {
  const base = headers()
  if (req.vertex === undefined) return { ok: true, headers: base }
  const bearer = await resolveVertexBearer(req.vertex.clientEmail, req.vertex.privateKey, req.signal)
  if (bearer.ok === false) return { ok: false, error: bearer.error }
  return { ok: true, headers: { ...base, authorization: `Bearer ${bearer.token}` } }
}

interface GeminiPart {
  text?: unknown
}

interface GeminiCandidate {
  content?: { parts?: GeminiPart[] }
  finishReason?: unknown
}

interface GeminiResponse {
  candidates?: GeminiCandidate[]
  modelVersion?: unknown
  error?: { message?: unknown; status?: unknown }
}

interface GeminiErrorResponse {
  error?: { message?: unknown; status?: unknown }
}

function extractText(body: GeminiResponse): string {
  let text = ''
  const cands = Array.isArray(body.candidates) ? body.candidates : []
  for (const c of cands) {
    const parts = Array.isArray(c?.content?.parts) ? c.content!.parts : []
    for (const p of parts) {
      if (typeof p.text === 'string') text += p.text
    }
  }
  return text
}

function mapFinishReason(raw: unknown): CompletionStreamFrame['finishReason'] {
  if (typeof raw !== 'string' || raw.length === 0) return 'stop'
  if (raw === 'STOP') return 'stop'
  if (raw === 'MAX_TOKENS') return 'length'
  if (raw === 'SAFETY') return 'content_filter'
  return raw.toLowerCase()
}

async function readGeminiStreamError(response: Response, url: string): Promise<CompletionStreamFrame> {
  let message: string | undefined
  let code: string | undefined
  try {
    const text = await readBoundedBodyText(response)
    if (text.length > 0) {
      try {
        const parsed = JSON.parse(text) as GeminiErrorResponse
        if (typeof parsed.error?.message === 'string' && parsed.error.message.length > 0) {
          message = parsed.error.message
        } else {
          message = text
        }
        if (typeof parsed.error?.status === 'string' && parsed.error.status.length > 0) {
          code = parsed.error.status
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

export async function runGemini(req: GeminiRequest): Promise<CompletionResult> {
  if (req.signal.aborted) {
    return { type: 'fail', result: 'aborted', aborted: true }
  }

  const h = await vertexHeaders(req)
  if (h.ok === false) {
    if (req.signal.aborted) {
      return { type: 'fail', result: 'aborted', aborted: true }
    }
    return { type: 'fail', result: h.error }
  }

  const url = endpoint(req, false)
  const requestBody = buildPayload(req)
  const bodyText = JSON.stringify(requestBody)
  let response: Response
  try {
    emitGeminiProviderBodyMetric({ url, body: requestBody, bodyText, model: req.model, stream: false })
    response = await fetch(url, {
      method: 'POST',
      headers: h.headers,
      body: bodyText,
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
    // Gemini's error body shape is `{error: {message, status}}`. Surface the
    // message when present; otherwise pass the raw text through so callers
    // can inspect the upstream payload.
    try {
      const parsed = JSON.parse(raw) as GeminiResponse
      if (typeof parsed.error?.message === 'string') {
        return { type: 'fail', result: parsed.error.message }
      }
    } catch {
      // ignore parse failure, fall through to raw
    }
    return { type: 'fail', result: raw }
  }

  let body: GeminiResponse
  try {
    body = JSON.parse(raw) as GeminiResponse
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { type: 'fail', result: `invalid upstream JSON: ${msg}` }
  }

  const text = extractText(body)
  if (text.length === 0) {
    return { type: 'fail', result: 'upstream returned no text content' }
  }
  const result: CompletionResult = { type: 'success', result: text }
  if (typeof body.modelVersion === 'string') result.model = body.modelVersion
  return result
}

export async function* runGeminiStream(req: GeminiRequest): AsyncGenerator<CompletionStreamFrame, void, void> {
  if (req.signal.aborted) return

  const h = await vertexHeaders(req)
  if (h.ok === false) {
    if (req.signal.aborted) return
    yield { kind: 'error', error: h.error, code: 'vertex_auth_failed' }
    return
  }

  const url = endpoint(req, true)
  const requestBody = buildPayload(req)
  const bodyText = JSON.stringify(requestBody)
  let response: Response
  try {
    emitGeminiProviderBodyMetric({ url, body: requestBody, bodyText, model: req.model, stream: true })
    response = await fetch(url, {
      method: 'POST',
      headers: h.headers,
      body: bodyText,
      signal: req.signal,
    })
  } catch (err) {
    if (req.signal.aborted) return
    const msg = err instanceof Error ? err.message : String(err)
    yield { kind: 'error', error: formatUpstreamFetchError(url, msg), code: 'fetch_failed' }
    return
  }

  if (!response.ok) {
    yield await readGeminiStreamError(response, url)
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
        evt = popSseEventBlock(buf)
        // Gemini SSE emits `data: <json>` lines. Concatenate any data lines
        // in the block then parse.
        let data = ''
        for (const line of block.split('\n')) {
          if (line.startsWith('data: ')) data += line.slice(6)
          else if (line.startsWith('data:')) data += line.slice(5)
        }
        if (data.length === 0) continue
        let frame: GeminiResponse
        try {
          frame = JSON.parse(data) as GeminiResponse
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          yield { kind: 'error', error: `invalid upstream stream JSON: ${msg}` }
          return
        }
        const text = extractText(frame)
        if (text.length > 0) {
          yield { kind: 'token', content: text }
        }
        const fr = Array.isArray(frame.candidates) ? frame.candidates[0]?.finishReason : undefined
        if (fr !== undefined) {
          finishReason = mapFinishReason(fr)
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
