import type { CompletionResult } from './frames.js'
import { flattenForLegacyInstruct } from './openaiLegacyInstruct.js'
import { readBoundedBodyText } from './body.js'

export interface OobaLegacyRequest {
  prompt: string
  baseUrl: string
  maxTokens?: number
  truncationLength?: number
  temperature?: number
  topP?: number
  topK?: number
  typicalP?: number
  repetitionPenalty?: number
  stoppingStrings?: string[]
  apiKey?: string
  signal: AbortSignal
}

interface ResolveInput {
  messages?: unknown
  baseUrl?: unknown
  maxTokens?: unknown
  truncationLength?: unknown
  temperature?: unknown
  topP?: unknown
  topK?: unknown
  typicalP?: unknown
  repetitionPenalty?: unknown
  stoppingStrings?: unknown
  apiKey?: unknown
  signal: AbortSignal
}

interface RawChatMessage {
  role?: unknown
  content?: unknown
}

export function resolveOobaLegacyRequest(input: ResolveInput): OobaLegacyRequest | null {
  if (!Array.isArray(input.messages)) return null
  if (typeof input.baseUrl !== 'string' || input.baseUrl.length === 0) return null

  const prompt = flattenForLegacyInstruct(input.messages as RawChatMessage[])
  const maxTokens =
    typeof input.maxTokens === 'number' && Number.isFinite(input.maxTokens) && input.maxTokens > 0
      ? input.maxTokens
      : undefined
  const truncationLength =
    typeof input.truncationLength === 'number' &&
    Number.isFinite(input.truncationLength) &&
    input.truncationLength > 0
      ? input.truncationLength
      : undefined
  const temperature =
    typeof input.temperature === 'number' && Number.isFinite(input.temperature)
      ? input.temperature
      : undefined
  const topP =
    typeof input.topP === 'number' && Number.isFinite(input.topP) ? input.topP : undefined
  const topK =
    typeof input.topK === 'number' && Number.isFinite(input.topK) ? input.topK : undefined
  const typicalP =
    typeof input.typicalP === 'number' && Number.isFinite(input.typicalP)
      ? input.typicalP
      : undefined
  const repetitionPenalty =
    typeof input.repetitionPenalty === 'number' && Number.isFinite(input.repetitionPenalty)
      ? input.repetitionPenalty
      : undefined
  const stoppingStrings =
    Array.isArray(input.stoppingStrings) &&
    input.stoppingStrings.every((s) => typeof s === 'string')
      ? (input.stoppingStrings as string[])
      : undefined
  const apiKey =
    typeof input.apiKey === 'string' && input.apiKey.length > 0 ? input.apiKey : undefined

  return {
    prompt,
    baseUrl: input.baseUrl,
    maxTokens,
    truncationLength,
    temperature,
    topP,
    topK,
    typicalP,
    repetitionPenalty,
    stoppingStrings,
    apiKey,
    signal: input.signal,
  }
}

function endpoint(req: OobaLegacyRequest): string {
  // Local code normalizes a user-supplied base by replacing `/api...` with
  // `/api/v1/generate`. Replicate that.
  return req.baseUrl.replace(/\/api.*/, '') + '/api/v1/generate'
}

function buildPayload(req: OobaLegacyRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    prompt: req.prompt,
    do_sample: true,
    seed: -1,
  }
  if (req.maxTokens !== undefined) body.max_new_tokens = req.maxTokens
  if (req.truncationLength !== undefined) body.truncation_length = req.truncationLength
  if (req.temperature !== undefined) body.temperature = req.temperature
  if (req.topP !== undefined) body.top_p = req.topP
  if (req.topK !== undefined) body.top_k = req.topK
  if (req.typicalP !== undefined) body.typical_p = req.typicalP
  if (req.repetitionPenalty !== undefined) body.repetition_penalty = req.repetitionPenalty
  if (req.stoppingStrings !== undefined) body.stopping_strings = req.stoppingStrings
  return body
}

function headers(req: OobaLegacyRequest): Record<string, string> {
  const h: Record<string, string> = { 'content-type': 'application/json' }
  if (req.apiKey !== undefined) h['X-API-KEY'] = req.apiKey
  return h
}

interface OobaResponse {
  results?: Array<{ text?: unknown }>
}

export async function runOobaLegacy(req: OobaLegacyRequest): Promise<CompletionResult> {
  if (req.signal.aborted) {
    return { type: 'fail', result: 'aborted', aborted: true }
  }

  let response: Response
  try {
    response = await fetch(endpoint(req), {
      method: 'POST',
      headers: headers(req),
      body: JSON.stringify(buildPayload(req)),
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

  if (!response.ok) return { type: 'fail', result: raw }

  let body: OobaResponse
  try {
    body = JSON.parse(raw) as OobaResponse
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { type: 'fail', result: `invalid upstream JSON: ${msg}` }
  }

  const text = body.results?.[0]?.text
  if (typeof text !== 'string') {
    return { type: 'fail', result: 'upstream returned no text' }
  }
  return { type: 'success', result: text }
}
