import { applyAdditionalParameters } from './additionalParams.js'
import type { CompletionResult } from './frames.js'
import { readBoundedBodyText } from './body.js'

export interface OpenAIResponsesRequest {
  model: string
  input: ResponseItem[]
  apiKey: string
  baseUrl: string
  maxOutputTokens?: number
  temperature?: number
  topP?: number
  store?: boolean
  extraHeaders?: Record<string, string>
  /**
   * Pre-validated `[key, value][]` pairs from the SPA's additionalParams /
   * xcustom `params` DSL. Applied after the dispatcher builds its default
   * body + headers, so the user DSL has the last word. See
   * `./additionalParams.ts` for semantics.
   */
  additionalParams?: Array<[string, string]>
  signal: AbortSignal
}

interface ResolveInput {
  model?: unknown
  messages?: unknown
  apiKey?: unknown
  baseUrl?: unknown
  maxOutputTokens?: unknown
  temperature?: unknown
  topP?: unknown
  store?: unknown
  extraHeaders?: Record<string, string>
  additionalParams?: Array<[string, string]>
  signal: AbortSignal
}

interface RawChatMessage {
  role?: unknown
  content?: unknown
}

type ResponseInputContent = { type: 'input_text'; text: string }
type ResponseOutputContent = {
  type: 'output_text'
  text: string
  annotations: never[]
}

interface ResponseInputItem {
  role: 'user' | 'system'
  content: ResponseInputContent[]
}

interface ResponseOutputItem {
  type: 'message'
  role: 'assistant'
  status: 'complete' | 'incomplete'
  content: ResponseOutputContent[]
}

type ResponseItem = ResponseInputItem | ResponseOutputItem

const DEFAULT_BASE_URL = 'https://api.openai.com/v1'

/**
 * The Responses API takes `input: ResponseItem[]` rather than `messages[]`.
 * user/system rows become input_text wrappers; assistant rows become
 * output_text wrappers (with `status: complete` except for a trailing
 * assistant which is marked `incomplete` so the model continues from there).
 * Mirrors the local browser path in
 * `src/ts/process/request/openAI/requests.ts:1075-1143`. Multimodal and
 * function rows are omitted.
 */
export function buildResponseInput(messages: RawChatMessage[]): ResponseItem[] {
  const items: ResponseItem[] = []
  for (const m of messages) {
    const text = typeof m.content === 'string' ? m.content : ''
    if (m.role === 'assistant') {
      items.push({
        type: 'message',
        role: 'assistant',
        status: 'complete',
        content: [{ type: 'output_text', text, annotations: [] }],
      })
    } else if (m.role === 'user' || m.role === 'system') {
      items.push({
        role: m.role,
        content: [{ type: 'input_text', text }],
      })
    }
    // function / tool rows are dropped — out of scope.
  }
  // If the trailing row is an assistant message, mark it incomplete so the
  // model continues that turn.
  const last = items[items.length - 1]
  if (last && 'role' in last && last.role === 'assistant') {
    last.status = 'incomplete'
  }
  return items
}

export function resolveOpenAIResponsesRequest(input: ResolveInput): OpenAIResponsesRequest | null {
  if (typeof input.model !== 'string' || input.model.length === 0) return null
  if (!Array.isArray(input.messages)) return null
  if (typeof input.apiKey !== 'string' || input.apiKey.length === 0) return null

  const baseUrl = typeof input.baseUrl === 'string' && input.baseUrl.length > 0 ? input.baseUrl : DEFAULT_BASE_URL
  const maxOutputTokens =
    typeof input.maxOutputTokens === 'number' && Number.isFinite(input.maxOutputTokens) && input.maxOutputTokens > 0
      ? input.maxOutputTokens
      : undefined
  const temperature =
    typeof input.temperature === 'number' && Number.isFinite(input.temperature) ? input.temperature : undefined
  const topP = typeof input.topP === 'number' && Number.isFinite(input.topP) ? input.topP : undefined
  const store = typeof input.store === 'boolean' ? input.store : undefined

  return {
    model: input.model,
    input: buildResponseInput(input.messages as RawChatMessage[]),
    apiKey: input.apiKey,
    baseUrl,
    maxOutputTokens,
    temperature,
    topP,
    store,
    extraHeaders: input.extraHeaders,
    additionalParams: input.additionalParams,
    signal: input.signal,
  }
}

function endpoint(req: OpenAIResponsesRequest): string {
  const base = req.baseUrl.endsWith('/') ? req.baseUrl.slice(0, -1) : req.baseUrl
  return `${base}/responses`
}

function buildHeaders(req: OpenAIResponsesRequest): Record<string, string> {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${req.apiKey}`,
    ...(req.extraHeaders ?? {}),
  }
}

function buildRequestInit(req: OpenAIResponsesRequest): { body: string; headers: Record<string, string> } {
  const body = buildPayload(req)
  const headers = buildHeaders(req)
  if (req.additionalParams !== undefined && req.additionalParams.length > 0) {
    applyAdditionalParameters(body, headers, req.additionalParams)
  }
  return { body: JSON.stringify(body), headers }
}

function buildPayload(req: OpenAIResponsesRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: req.model,
    input: req.input,
    tools: [],
  }
  if (req.store !== undefined) body.store = req.store
  if (req.maxOutputTokens !== undefined) body.max_output_tokens = req.maxOutputTokens
  if (req.temperature !== undefined) body.temperature = req.temperature
  if (req.topP !== undefined) body.top_p = req.topP
  return body
}

interface ResponsesAPIBody {
  output?: Array<{
    type?: unknown
    content?: Array<{ type?: unknown; text?: unknown }>
  }>
  model?: unknown
  error?: { message?: unknown }
}

export async function runOpenAIResponses(req: OpenAIResponsesRequest): Promise<CompletionResult> {
  if (req.signal.aborted) {
    return { type: 'fail', result: 'aborted', aborted: true }
  }

  const init = buildRequestInit(req)
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

  let raw: string
  try {
    raw = await readBoundedBodyText(response)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { type: 'fail', result: `invalid upstream body: ${msg}` }
  }

  if (!response.ok) {
    try {
      const parsed = JSON.parse(raw) as ResponsesAPIBody
      if (typeof parsed.error?.message === 'string') {
        return { type: 'fail', result: parsed.error.message }
      }
    } catch {
      // ignore parse failure, surface raw
    }
    return { type: 'fail', result: raw }
  }

  let body: ResponsesAPIBody
  try {
    body = JSON.parse(raw) as ResponsesAPIBody
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { type: 'fail', result: `invalid upstream JSON: ${msg}` }
  }

  const msg = Array.isArray(body.output) ? body.output.find((m) => m.type === 'message') : undefined
  const text = Array.isArray(msg?.content) ? msg.content.find((c) => c.type === 'output_text')?.text : undefined
  if (typeof text !== 'string' || text.length === 0) {
    return { type: 'fail', result: 'upstream returned no output text' }
  }
  const result: CompletionResult = { type: 'success', result: text }
  if (typeof body.model === 'string') result.model = body.model
  return result
}
