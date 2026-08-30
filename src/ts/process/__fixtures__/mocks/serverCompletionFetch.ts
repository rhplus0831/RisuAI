/**
 * Fetch stub for the dual-mode fixture sweep. Emulates the
 * `POST /api/v1/generate/completion` route well enough to round-trip the
 * echo / openai / anthropic providers. Tokenizer JSON fetches
 * (`/token/*`) are served from disk via the shared shim. Any other URL is
 * rejected so an accidental escape inside a fixture surfaces loudly.
 */

import { isTokenizerUrl, serveTokenizerFetch } from './tokenizerFetch'
import { resolveModelForRole, type LegacyModelMode } from '@risuai/shared-core/model-roles'
import { getDatabase } from '../../../storage/database.svelte'

interface ServerCompletionCallBase {
  url: string
  method: string
  stream: boolean
  messagesLength: number
  authHeader: string | null
}

export interface ServerCompletionIntentCall extends ServerCompletionCallBase {
  kind: 'server-intent'
  mode?: unknown
  staticModel?: unknown
  maxTokens?: unknown
  temperature?: unknown
  currentCharName?: unknown
}

export interface ServerCompletionProviderCall extends ServerCompletionCallBase {
  provider: string
  model: string
  options: unknown
}

export type ServerCompletionCall = ServerCompletionIntentCall | ServerCompletionProviderCall

interface CompletionPayload {
  kind?: unknown
  provider?: unknown
  model?: unknown
  messages?: unknown
  stream?: unknown
  options?: unknown
  mode?: unknown
  staticModel?: unknown
  maxTokens?: unknown
  temperature?: unknown
  currentCharName?: unknown
}

const DEFAULT_ECHO_RESULT = 'fixture echo reply'
const DEFAULT_OPENAI_RESULT = 'fixture openai reply'
const DEFAULT_ANTHROPIC_RESULT = 'fixture claude reply'
const DEFAULT_MISTRAL_RESULT = 'fixture mistral reply'
const DEFAULT_COHERE_RESULT = 'fixture cohere reply'
const DEFAULT_DEEPSEEK_RESULT = 'fixture deepseek reply'
const DEFAULT_GEMINI_RESULT = 'fixture gemini reply'
const DEFAULT_BEDROCK_RESULT = 'fixture bedrock claude reply'
const DEFAULT_HORDE_RESULT = 'fixture horde reply'

interface State {
  calls: ServerCompletionCall[]
  echoResult: string
  openaiResult: string
  anthropicResult: string
  mistralResult: string
  cohereResult: string
  deepseekResult: string
  geminiResult: string
  bedrockResult: string
  hordeResult: string
}

const state: State = {
  calls: [],
  echoResult: DEFAULT_ECHO_RESULT,
  openaiResult: DEFAULT_OPENAI_RESULT,
  anthropicResult: DEFAULT_ANTHROPIC_RESULT,
  mistralResult: DEFAULT_MISTRAL_RESULT,
  cohereResult: DEFAULT_COHERE_RESULT,
  deepseekResult: DEFAULT_DEEPSEEK_RESULT,
  geminiResult: DEFAULT_GEMINI_RESULT,
  bedrockResult: DEFAULT_BEDROCK_RESULT,
  hordeResult: DEFAULT_HORDE_RESULT,
}

export function getServerCompletionCalls(): ServerCompletionCall[] {
  return state.calls
}

export function resetServerCompletionCalls(): void {
  state.calls = []
  state.echoResult = DEFAULT_ECHO_RESULT
  state.openaiResult = DEFAULT_OPENAI_RESULT
  state.anthropicResult = DEFAULT_ANTHROPIC_RESULT
  state.mistralResult = DEFAULT_MISTRAL_RESULT
  state.cohereResult = DEFAULT_COHERE_RESULT
  state.deepseekResult = DEFAULT_DEEPSEEK_RESULT
  state.geminiResult = DEFAULT_GEMINI_RESULT
  state.bedrockResult = DEFAULT_BEDROCK_RESULT
  state.hordeResult = DEFAULT_HORDE_RESULT
}

export function setEchoResult(text: string): void {
  state.echoResult = text
}

export function setOpenAIResult(text: string): void {
  state.openaiResult = text
}

export function setAnthropicResult(text: string): void {
  state.anthropicResult = text
}

export function setMistralResult(text: string): void {
  state.mistralResult = text
}

export function setCohereResult(text: string): void {
  state.cohereResult = text
}

export function setDeepSeekResult(text: string): void {
  state.deepseekResult = text
}

export function setGeminiResult(text: string): void {
  state.geminiResult = text
}

export function setBedrockResult(text: string): void {
  state.bedrockResult = text
}

export function setHordeResult(text: string): void {
  state.hordeResult = text
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function sseResponse(message: string): Response {
  const enc = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(enc.encode(`event: chunk\ndata: ${JSON.stringify({ type: 'token', content: message })}\n\n`))
      controller.enqueue(enc.encode(`event: done\ndata: ${JSON.stringify({ finishReason: 'stop' })}\n\n`))
      controller.close()
    },
  })
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function selectedServerIntentModel(body: CompletionPayload): string {
  const db = getDatabase({ snapshot: true }) as unknown as Record<string, unknown>
  const staticModel = stringField(body.staticModel)
  if (staticModel) return staticModel

  const mode = stringField(body.mode) ?? 'model'
  const aiModel = resolveModelForRole(db, mode as LegacyModelMode)
  return stringField(aiModel) ?? 'echo_model'
}

function serverIntentResult(body: CompletionPayload): { result: string; model?: string } {
  const db = getDatabase({ snapshot: true }) as unknown as Record<string, unknown>
  const aiModel = selectedServerIntentModel(body)

  if (aiModel === 'echo_model') {
    const dbEcho = stringField(db.echoMessage)
    return { result: dbEcho ?? state.echoResult, model: aiModel }
  }

  if (aiModel === 'reverse_proxy') {
    const proxyModel = stringField(db.customProxyRequestModel)
    if (db.customAPIFormat === 2) {
      return { result: state.anthropicResult, model: proxyModel }
    }
    if (db.customAPIFormat === 4) {
      return { result: state.mistralResult, model: proxyModel }
    }
    return { result: state.openaiResult, model: proxyModel }
  }

  if (aiModel.startsWith('horde:::')) {
    return { result: state.hordeResult, model: aiModel.slice('horde:::'.length) }
  }

  if (aiModel.startsWith('anthropic.')) {
    return { result: state.bedrockResult, model: `global.${aiModel}` }
  }

  if (aiModel.startsWith('deepseek-')) {
    return { result: state.deepseekResult, model: aiModel }
  }

  if (aiModel.startsWith('claude-')) {
    return { result: state.anthropicResult, model: aiModel }
  }

  if (aiModel.startsWith('mistral-')) {
    return { result: state.mistralResult, model: aiModel }
  }

  if (aiModel.startsWith('cohere-')) {
    return { result: state.cohereResult, model: aiModel }
  }

  if (aiModel.startsWith('gemini-')) {
    return { result: state.geminiResult, model: 'gemini-2.5-flash' }
  }

  return { result: state.openaiResult, model: aiModel }
}

function respondToProviderPayload(provider: string, model: string, stream: boolean, options: unknown): Response {
  if (provider === 'echo') {
    const echoOpts = (options as { echo?: { message?: string } } | undefined)?.echo
    const message = typeof echoOpts?.message === 'string' ? echoOpts.message : 'Echo Message'
    if (stream) return sseResponse(message)
    return jsonResponse({ type: 'success', result: message })
  }

  if (provider === 'openai' || provider === 'nanogpt' || provider === 'openrouter') {
    // DeepSeek / DeepInfra ride provider='openai' but the fixture wants its
    // own canned reply so the snapshot is self-documenting.
    const text = model.startsWith('deepseek-') ? state.deepseekResult : state.openaiResult
    if (stream) return sseResponse(text)
    return jsonResponse({ type: 'success', result: text, model })
  }

  if (provider === 'anthropic') {
    if (stream) return sseResponse(state.anthropicResult)
    return jsonResponse({ type: 'success', result: state.anthropicResult, model })
  }

  if (provider === 'mistral') {
    if (stream) return sseResponse(state.mistralResult)
    return jsonResponse({ type: 'success', result: state.mistralResult, model })
  }

  if (provider === 'cohere') {
    // Cohere is non-streaming-only; the route 400s on stream=true.
    return jsonResponse({ type: 'success', result: state.cohereResult, model })
  }

  if (provider === 'gemini') {
    if (stream) return sseResponse(state.geminiResult)
    return jsonResponse({ type: 'success', result: state.geminiResult, model })
  }

  if (provider === 'bedrock') {
    // Bedrock streaming is buffered-only server-side; the route 400s on stream=true.
    return jsonResponse({ type: 'success', result: state.bedrockResult, model })
  }

  if (provider === 'horde') {
    // Horde is buffered-only; the route 400s on stream=true.
    return jsonResponse({ type: 'success', result: state.hordeResult, model })
  }

  return jsonResponse({ reason: `provider not handled by fixture stub: ${provider}` }, 501)
}

export async function serverCompletionFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
  if (isTokenizerUrl(url)) return serveTokenizerFetch(url)
  if (!url.endsWith('/api/v1/generate/completion')) {
    throw new Error(`unexpected fetch in dual-mode fixture: ${url}`)
  }

  const method = init?.method ?? 'POST'
  const auth = (init?.headers as Record<string, string> | undefined)?.['risu-auth'] ?? null
  const rawBody = typeof init?.body === 'string' ? init.body : ''
  const body = JSON.parse(rawBody) as CompletionPayload

  const provider = typeof body.provider === 'string' ? body.provider : ''
  const model = typeof body.model === 'string' ? body.model : ''
  const stream = body.stream === true
  const messages = Array.isArray(body.messages) ? body.messages : []

  if (body.kind === 'server-intent') {
    state.calls.push({
      url,
      method,
      kind: 'server-intent',
      stream,
      messagesLength: messages.length,
      authHeader: auth,
      mode: body.mode,
      staticModel: body.staticModel,
      maxTokens: body.maxTokens,
      temperature: body.temperature,
      currentCharName: body.currentCharName,
    })

    if (body.provider !== undefined || body.model !== undefined || body.options !== undefined) {
      return jsonResponse({ error: 'server-intent completion must not include provider, model, or options' }, 400)
    }

    const resolved = serverIntentResult(body)
    if (stream) return sseResponse(resolved.result)
    return jsonResponse({ type: 'success', result: resolved.result, model: resolved.model })
  }

  state.calls.push({
    url,
    method,
    provider,
    model,
    stream,
    messagesLength: messages.length,
    options: body.options ?? {},
    authHeader: auth,
  })

  return respondToProviderPayload(provider, model, stream, body.options)
}
