import type { CompletionResult, CompletionStreamFrame } from './frames.js'
import { parseOpenAIStyleSseData } from './openai.js'

export interface MistralRequest {
  model: string
  messages: MistralChatMessage[]
  apiKey: string
  baseUrl: string
  safePrompt: boolean
  maxTokens?: number
  temperature?: number
  presencePenalty?: number
  frequencyPenalty?: number
  topP?: number
  signal: AbortSignal
}

interface MistralResolveInput {
  model?: unknown
  messages?: unknown
  apiKey?: unknown
  baseUrl?: unknown
  safePrompt?: unknown
  maxTokens?: unknown
  temperature?: unknown
  presencePenalty?: unknown
  frequencyPenalty?: unknown
  topP?: unknown
  signal: AbortSignal
}

interface RawChatMessage {
  role?: unknown
  content?: unknown
}

export interface MistralChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

const DEFAULT_BASE_URL = 'https://api.mistral.ai/v1'

/**
 * Mistral enforces a stricter conversation shape than OpenAI: roles must
 * alternate, the first message cannot be assistant, and the only valid roles
 * are system / user / assistant. Coalesce consecutive same-role messages,
 * inline `system` content into the surrounding user turn, and demote
 * `function` rows to user. Mirrors the local browser path in
 * src/ts/process/request/openAI/requests.ts:281-323.
 */
export function reformatForMistral(messages: RawChatMessage[]): MistralChatMessage[] {
  const out: MistralChatMessage[] = []
  for (let i = 0; i < messages.length; i++) {
    const chat = messages[i]
    const role = typeof chat.role === 'string' ? chat.role : ''
    const content = typeof chat.content === 'string' ? chat.content : ''
    if (i === 0) {
      if (role === 'user' || role === 'system') {
        out.push({ role, content })
      } else {
        out.push({ role: 'system', content: `${role}:${content}` })
      }
      continue
    }
    const prev = out[out.length - 1]
    if (prev !== undefined && prev.role === role && (role === 'user' || role === 'assistant' || role === 'system')) {
      prev.content += `\n${content}`
      continue
    }
    if (role === 'system') {
      if (prev !== undefined && prev.role === 'user') {
        prev.content += `\nSystem:${content}`
      } else {
        out.push({ role: 'user', content: `System:${content}` })
      }
      continue
    }
    if (role === 'function') {
      out.push({ role: 'user', content })
      continue
    }
    if (role === 'user' || role === 'assistant') {
      out.push({ role, content })
    } else {
      // Unknown role: drop into user turn rather than discard the text.
      out.push({ role: 'user', content })
    }
  }
  return out
}

export function resolveMistralRequest(input: MistralResolveInput): MistralRequest | null {
  if (typeof input.model !== 'string' || input.model.length === 0) return null
  if (!Array.isArray(input.messages)) return null
  if (typeof input.apiKey !== 'string' || input.apiKey.length === 0) return null

  const baseUrl =
    typeof input.baseUrl === 'string' && input.baseUrl.length > 0
      ? input.baseUrl
      : DEFAULT_BASE_URL
  const safePrompt = input.safePrompt === true
  const maxTokens =
    typeof input.maxTokens === 'number' && Number.isFinite(input.maxTokens) && input.maxTokens > 0
      ? input.maxTokens
      : undefined
  const temperature =
    typeof input.temperature === 'number' && Number.isFinite(input.temperature)
      ? input.temperature
      : undefined
  const presencePenalty =
    typeof input.presencePenalty === 'number' && Number.isFinite(input.presencePenalty)
      ? input.presencePenalty
      : undefined
  const frequencyPenalty =
    typeof input.frequencyPenalty === 'number' && Number.isFinite(input.frequencyPenalty)
      ? input.frequencyPenalty
      : undefined
  const topP =
    typeof input.topP === 'number' && Number.isFinite(input.topP) ? input.topP : undefined

  return {
    model: input.model,
    messages: reformatForMistral(input.messages as RawChatMessage[]),
    apiKey: input.apiKey,
    baseUrl,
    safePrompt,
    maxTokens,
    temperature,
    presencePenalty,
    frequencyPenalty,
    topP,
    signal: input.signal,
  }
}

function buildPayload(req: MistralRequest, stream: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: req.model,
    messages: req.messages,
    safe_prompt: req.safePrompt,
    stream,
  }
  if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens
  if (req.temperature !== undefined) body.temperature = req.temperature
  if (req.presencePenalty !== undefined) body.presence_penalty = req.presencePenalty
  if (req.frequencyPenalty !== undefined) body.frequency_penalty = req.frequencyPenalty
  if (req.topP !== undefined) body.top_p = req.topP
  return body
}

function endpoint(req: MistralRequest): string {
  const base = req.baseUrl.endsWith('/') ? req.baseUrl.slice(0, -1) : req.baseUrl
  return `${base}/chat/completions`
}

function headers(req: MistralRequest): Record<string, string> {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${req.apiKey}`,
  }
}

interface MistralNonStreamChoice {
  message?: { content?: unknown }
  finish_reason?: unknown
}

interface MistralNonStreamResponse {
  choices?: MistralNonStreamChoice[]
  model?: unknown
  error?: { message?: unknown }
}

export async function runMistral(req: MistralRequest): Promise<CompletionResult> {
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

  let body: MistralNonStreamResponse
  try {
    body = (await response.json()) as MistralNonStreamResponse
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { type: 'fail', result: `invalid upstream JSON: ${msg}` }
  }

  if (!response.ok) {
    const upstreamMsg =
      typeof body.error?.message === 'string' ? body.error.message : `HTTP ${response.status}`
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

interface MistralDelta {
  content?: unknown
}

interface MistralStreamChoice {
  delta?: MistralDelta
  finish_reason?: unknown
}

interface MistralStreamFrame {
  choices?: MistralStreamChoice[]
}

function mapFinishReason(raw: unknown): CompletionStreamFrame['finishReason'] {
  if (typeof raw !== 'string' || raw.length === 0) return 'stop'
  return raw
}

export async function* runMistralStream(
  req: MistralRequest,
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
        const data = parseOpenAIStyleSseData(block)
        sepIdx = buf.indexOf('\n\n')
        if (data === null) continue
        if (data.trim() === '[DONE]') {
          yield { kind: 'done', finishReason }
          return
        }
        let frame: MistralStreamFrame
        try {
          frame = JSON.parse(data) as MistralStreamFrame
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
