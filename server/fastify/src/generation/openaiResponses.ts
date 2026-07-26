import { applyAdditionalParameters } from './additionalParams.js'
import type { CompletionResult } from './frames.js'
import { extractApiResponseMetadata } from './apiMetadata.js'
import { readBoundedBodyText } from './body.js'

export interface OpenAIResponsesRequest {
  model: string
  input: ResponseItem[]
  apiKey: string
  baseUrl: string
  maxOutputTokens?: number
  temperature?: number
  topP?: number
  reasoningEffort?: string
  verbosity?: string
  responseFormat?: Record<string, unknown>
  tools?: unknown[]
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
  reasoningEffort?: unknown
  verbosity?: unknown
  responseFormat?: unknown
  tools?: unknown
  store?: unknown
  developerRole?: unknown
  visionQuality?: unknown
  newOAIHandle?: unknown
  extraHeaders?: Record<string, string>
  additionalParams?: Array<[string, string]>
  signal: AbortSignal
}

interface RawChatMessage {
  role?: unknown
  content?: unknown
  memo?: unknown
  multimodals?: unknown
}

type ResponseInputContent =
  | { type: 'input_text'; text: string }
  | { type: 'input_image'; image_url: string; detail: 'auto' | 'low' | 'high' }
  | { type: 'input_file'; file_data: string }
type ResponseOutputContent = {
  type: 'output_text'
  text: string
  annotations: never[]
}

interface ResponseInputItem {
  role: 'user' | 'system' | 'developer'
  content: ResponseInputContent[]
}

interface ResponseOutputItem {
  type: 'message'
  role: 'assistant'
  status: 'completed' | 'incomplete'
  content: ResponseOutputContent[]
}

type ResponseItem = ResponseInputItem | ResponseOutputItem

interface RawMultimodal {
  type?: unknown
  base64?: unknown
}

const DEFAULT_BASE_URL = 'https://api.openai.com/v1'

/**
 * The Responses API takes `input: ResponseItem[]` rather than `messages[]`.
 * user/system rows become input_text wrappers; assistant rows become
 * output_text wrappers (with `status: complete` except for a trailing
 * assistant which is marked `incomplete` so the model continues from there).
 * Derived from `requestOpenAIResponseAPI`; this server adapter currently keeps
 * text user/system/assistant rows and omits multimodal/function/tool rows.
 */
export function buildResponseInput(
  messages: RawChatMessage[],
  options: { developerRole?: boolean; visionQuality?: unknown; newOAIHandle?: boolean } = {},
): ResponseItem[] {
  const detail =
    options.visionQuality === 'low' || options.visionQuality === 'high' ? options.visionQuality : ('auto' as const)
  const items: ResponseItem[] = []
  for (const m of messages) {
    const text =
      options.newOAIHandle !== false && typeof m.memo === 'string' && m.memo.startsWith('NewChat')
        ? ''
        : typeof m.content === 'string'
          ? m.content
          : ''
    if (m.role === 'assistant') {
      if (text.length === 0) continue
      items.push({
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text, annotations: [] }],
      })
    } else if (m.role === 'user' || m.role === 'system' || m.role === 'developer') {
      const content: ResponseInputContent[] = []
      if (text.length > 0) content.push({ type: 'input_text', text })
      if (Array.isArray(m.multimodals)) {
        for (const raw of m.multimodals as RawMultimodal[]) {
          if (typeof raw.base64 !== 'string') continue
          if (raw.type === 'image') {
            content.push({ type: 'input_image', detail, image_url: raw.base64 })
          } else if (raw.type === 'audio' || raw.type === 'video') {
            content.push({ type: 'input_file', file_data: raw.base64 })
          }
        }
      }
      if (content.length === 0) continue
      items.push({
        role: options.developerRole && m.role === 'system' ? 'developer' : m.role,
        content,
      })
    }
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
  const reasoningEffort = typeof input.reasoningEffort === 'string' ? input.reasoningEffort : undefined
  const verbosity = typeof input.verbosity === 'string' ? input.verbosity : undefined
  const responseFormat =
    input.responseFormat && typeof input.responseFormat === 'object' && !Array.isArray(input.responseFormat)
      ? (input.responseFormat as Record<string, unknown>)
      : undefined
  const tools = Array.isArray(input.tools) ? input.tools : undefined
  const store = typeof input.store === 'boolean' ? input.store : undefined

  return {
    model: input.model,
    input: buildResponseInput(input.messages as RawChatMessage[], {
      developerRole: input.developerRole === true,
      visionQuality: input.visionQuality,
      newOAIHandle: input.newOAIHandle !== false,
    }),
    apiKey: input.apiKey,
    baseUrl,
    maxOutputTokens,
    temperature,
    topP,
    reasoningEffort,
    verbosity,
    responseFormat,
    tools,
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
  }
  if (req.store !== undefined) body.store = req.store
  if (req.maxOutputTokens !== undefined) body.max_output_tokens = req.maxOutputTokens
  if (req.temperature !== undefined) body.temperature = req.temperature
  if (req.topP !== undefined) body.top_p = req.topP
  if (req.reasoningEffort !== undefined) {
    body.reasoning = { effort: req.reasoningEffort, summary: 'auto' }
  }
  if (req.verbosity !== undefined) body.text = { verbosity: req.verbosity }
  if (req.responseFormat !== undefined) {
    body.text = { ...((body.text as Record<string, unknown> | undefined) ?? {}), format: req.responseFormat }
  }
  if (req.tools !== undefined && req.tools.length > 0) body.tools = req.tools
  return body
}

interface ResponsesAPIBody {
  output_text?: unknown
  output?: Array<{
    type?: unknown
    content?: Array<{ type?: unknown; text?: unknown; refusal?: unknown }>
    summary?: unknown
    text?: unknown
    reasoning_text?: unknown
    reasoning?: unknown
  }>
  model?: unknown
  error?: { message?: unknown }
}

function collectReasoningText(value: unknown): string[] {
  if (typeof value === 'string') return value.length > 0 ? [value] : []
  if (Array.isArray(value)) return value.flatMap(collectReasoningText)
  if (!value || typeof value !== 'object') return []
  const record = value as Record<string, unknown>
  return ['text', 'summary_text', 'reasoning_text', 'reasoning', 'summary'].flatMap((key) =>
    collectReasoningText(record[key]),
  )
}

function extractResponsesResult(body: ResponsesAPIBody): string | null {
  const texts: string[] = typeof body.output_text === 'string' ? [body.output_text] : []
  const refusals: string[] = []
  const thoughts: string[] = []
  for (const item of body.output ?? []) {
    if (item.type === 'reasoning') {
      thoughts.push(
        ...collectReasoningText(item.summary),
        ...collectReasoningText(item.text),
        ...collectReasoningText(item.reasoning_text),
        ...collectReasoningText(item.reasoning),
      )
    }
    if (item.type !== 'message') continue
    for (const content of item.content ?? []) {
      if (content.type === 'output_text' && typeof content.text === 'string' && body.output_text === undefined) {
        texts.push(content.text)
      }
      if (content.type === 'refusal' && typeof content.refusal === 'string') refusals.push(content.refusal)
    }
  }
  let result = texts.length > 0 ? texts.join('\n') : refusals.join('\n')
  if (thoughts.length > 0 && !result.startsWith('<Thoughts>')) {
    result = `<Thoughts>\n\n${thoughts.join('\n\n')}\n\n</Thoughts>\n${result}`
  }
  return result.length > 0 ? result : null
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

  const text = extractResponsesResult(body)
  if (text === null) {
    return { type: 'fail', result: 'upstream returned no output text' }
  }
  const result: CompletionResult = { type: 'success', result: text }
  if (typeof body.model === 'string') result.model = body.model
  const apiMetadata = extractApiResponseMetadata(body, ['output_text', 'output', 'error', 'model'])
  if (apiMetadata) result.apiMetadata = apiMetadata
  return result
}
