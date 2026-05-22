import { LLMFormat } from '../../model/types'
import { isFastifyServer } from '../../platform'
import { getDatabase } from '../../storage/database.svelte'
import { getNodeServerProxyAuth } from '../../storage/nodeStorage'
import type { RequestDataArgumentExtended, requestDataResponse } from './request'

const COMPLETION_ENDPOINT = '/api/v1/generate/completion'

export function formatToServerProvider(format: LLMFormat): string | null {
  switch (format) {
    case LLMFormat.Echo:
      return 'echo'
    case LLMFormat.OpenAICompatible:
      return 'openai'
    case LLMFormat.NanoGPT:
      return 'nanogpt'
    case LLMFormat.Anthropic:
      return 'anthropic'
    default:
      return null
  }
}

/**
 * `LLMFormat.OpenAICompatible` covers vanilla OpenAI plus several derivatives
 * that share the wire shape. The vanilla path goes to `provider: 'openai'`;
 * `aiModel === 'openrouter'` routes to `provider: 'openrouter'`. The
 * derivatives still on local dispatch are reverse_proxy, xcustom:::, and
 * anything carrying `keyIdentifier`/`endpoint` (each gets its own slice).
 */
function selectOpenAIVariant(targ: RequestDataArgumentExtended): string | null {
  const aiModel = targ.aiModel ?? targ.modelInfo?.id ?? ''
  if (aiModel === 'openrouter') return 'openrouter'
  if (aiModel === 'reverse_proxy') return null
  if (aiModel.startsWith('xcustom:::')) return null
  if (targ.modelInfo?.keyIdentifier) return null
  if (targ.modelInfo?.endpoint) return null
  return 'openai'
}

function isVanillaAnthropic(targ: RequestDataArgumentExtended): boolean {
  const aiModel = targ.aiModel ?? targ.modelInfo?.id ?? ''
  if (aiModel === 'reverse_proxy') return false
  if (aiModel.startsWith('xcustom:::')) return false
  if (targ.modelInfo?.endpoint) return false
  return true
}

export function getServerCompletionProvider(
  targ: RequestDataArgumentExtended,
): string | null {
  if (!isFastifyServer) return null
  const db = getDatabase()
  if (db.useServerGeneration !== true) return null
  if (targ.previewBody === true) return null
  if (!targ.modelInfo) return null
  const provider = formatToServerProvider(targ.modelInfo.format)
  if (provider === null) return null
  if (provider === 'openai') return selectOpenAIVariant(targ)
  if (provider === 'anthropic' && !isVanillaAnthropic(targ)) return null
  return provider
}

/**
 * Wire-level `model` for the upstream. Vanilla OpenAI sends `aiModel`
 * verbatim; nanogpt and openrouter override with the user's
 * `db.nanogptRequestModel` / `db.openrouterRequestModel` because the local
 * dispatcher does the same in `request/openAI/requests.ts:255-262`.
 */
export function resolveProviderModel(
  targ: RequestDataArgumentExtended,
  provider: string,
): string {
  const db = getDatabase()
  if (provider === 'nanogpt') return db.nanogptRequestModel ?? ''
  if (provider === 'openrouter') return db.openrouterRequestModel ?? ''
  return targ.modelInfo?.id ?? targ.aiModel ?? ''
}

/**
 * Anthropic doesn't accept role='system' in the messages array — system
 * prompts go to a top-level `system` field. Extract every string-content
 * system message from the formated array, concatenate with `\n\n`, and
 * return both pieces. Multimodal-content system messages are skipped (not
 * yet supported on the server-routed path).
 */
export function extractAnthropicSystem(
  formated: Array<{ role: string; content: unknown }>,
): { messages: typeof formated; system?: string } {
  const systemTexts: string[] = []
  const messages: typeof formated = []
  for (const m of formated) {
    if (m.role === 'system' && typeof m.content === 'string' && m.content.length > 0) {
      systemTexts.push(m.content)
      continue
    }
    messages.push(m)
  }
  const system = systemTexts.length > 0 ? systemTexts.join('\n\n') : undefined
  return system === undefined ? { messages } : { messages, system }
}

function buildProviderOptions(
  targ: RequestDataArgumentExtended,
  provider: string,
): Record<string, unknown> {
  const db = getDatabase()
  if (provider === 'echo') {
    return {
      echo: {
        message: db.echoMessage ?? 'Echo Message',
        delayMs: (db.echoDelay ?? 0) * 1000,
      },
    }
  }
  if (provider === 'openai') {
    const openai: Record<string, unknown> = { apiKey: db.openAIKey ?? '' }
    if (typeof targ.maxTokens === 'number') openai.maxTokens = targ.maxTokens
    if (typeof targ.temperature === 'number') openai.temperature = targ.temperature
    return { openai }
  }
  if (provider === 'nanogpt') {
    const nanogpt: Record<string, unknown> = { apiKey: db.nanogptKey ?? '' }
    if (db.nanogptUseSubscriptionEndpoint === true) nanogpt.useSubscription = true
    if (typeof db.nanogptProvider === 'string' && db.nanogptProvider.length > 0) {
      nanogpt.providerHint = db.nanogptProvider
    }
    if (typeof targ.maxTokens === 'number') nanogpt.maxTokens = targ.maxTokens
    if (typeof targ.temperature === 'number') nanogpt.temperature = targ.temperature
    return { nanogpt }
  }
  if (provider === 'openrouter') {
    const openrouter: Record<string, unknown> = { apiKey: db.openrouterKey ?? '' }
    if (typeof targ.maxTokens === 'number') openrouter.maxTokens = targ.maxTokens
    if (typeof targ.temperature === 'number') openrouter.temperature = targ.temperature
    return { openrouter }
  }
  if (provider === 'anthropic') {
    const anthropic: Record<string, unknown> = { apiKey: db.claudeAPIKey ?? '' }
    if (typeof targ.maxTokens === 'number') anthropic.maxTokens = targ.maxTokens
    if (typeof targ.temperature === 'number') anthropic.temperature = targ.temperature
    return { anthropic }
  }
  return {}
}

interface CompletionJsonResponse {
  type?: unknown
  result?: unknown
  model?: unknown
}

function parseSseEvent(block: string): { event: string; data: string } {
  let event = 'message'
  let data = ''
  for (const line of block.split('\n')) {
    if (line.startsWith('event: ')) event = line.slice(7).trim()
    else if (line.startsWith('data: ')) data += line.slice(6)
  }
  return { event, data }
}

async function readSseStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal | null,
): Promise<requestDataResponse> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let acc = ''
  let buf = ''
  let aborted = false
  let finished = false

  const cancel = (): void => {
    aborted = true
    reader.cancel().catch(() => {
      // swallow
    })
  }
  const onAbort = (): void => cancel()
  if (signal) {
    if (signal.aborted) {
      cancel()
    } else {
      signal.addEventListener('abort', onAbort, { once: true })
    }
  }

  try {
    while (!finished && !aborted) {
      const { value, done } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let sepIdx = buf.indexOf('\n\n')
      while (sepIdx !== -1) {
        const block = buf.slice(0, sepIdx)
        buf = buf.slice(sepIdx + 2)
        const evt = parseSseEvent(block)
        if (evt.event === 'done') {
          finished = true
          break
        }
        if (evt.event === 'chunk') {
          try {
            const payload = JSON.parse(evt.data) as { type?: unknown; content?: unknown }
            if (payload.type === 'token' && typeof payload.content === 'string') {
              acc += payload.content
            }
          } catch {
            // ignore malformed frame
          }
        }
        sepIdx = buf.indexOf('\n\n')
      }
    }
  } finally {
    if (signal) signal.removeEventListener('abort', onAbort)
  }

  if (aborted) {
    return { type: 'fail', result: 'Aborted' }
  }
  return { type: 'success', result: acc }
}

export async function requestServerCompletion(
  targ: RequestDataArgumentExtended,
  provider: string,
  signal: AbortSignal | null,
): Promise<requestDataResponse> {
  const useStreaming = targ.useStreaming === true
  const auth = await getNodeServerProxyAuth()
  let messages: unknown = targ.formated
  const options = buildProviderOptions(targ, provider)
  if (provider === 'anthropic' && Array.isArray(targ.formated)) {
    const extracted = extractAnthropicSystem(
      targ.formated as Array<{ role: string; content: unknown }>,
    )
    messages = extracted.messages
    if (extracted.system !== undefined) {
      const anthropic = (options.anthropic ?? {}) as Record<string, unknown>
      anthropic.system = extracted.system
      options.anthropic = anthropic
    }
  }
  const payload = {
    provider,
    model: resolveProviderModel(targ, provider),
    messages,
    stream: useStreaming,
    options,
  }

  let response: Response
  try {
    response = await fetch(COMPLETION_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'risu-auth': auth,
      },
      body: JSON.stringify(payload),
      signal: signal ?? undefined,
    })
  } catch (err) {
    if (signal?.aborted) {
      return { type: 'fail', result: 'Aborted' }
    }
    const msg = err instanceof Error ? err.message : String(err)
    return { type: 'fail', result: `Network error: ${msg}` }
  }

  if (!response.ok) {
    let reason = `HTTP ${response.status}`
    try {
      const body = (await response.json()) as { reason?: unknown; error?: unknown }
      if (body && typeof body === 'object') {
        if (typeof body.reason === 'string') reason = body.reason
        else if (typeof body.error === 'string') reason = body.error
      }
    } catch {
      // ignore parse failure
    }
    return { type: 'fail', result: reason }
  }

  if (useStreaming) {
    if (!response.body) {
      return { type: 'fail', result: 'No streaming body returned' }
    }
    return readSseStream(response.body, signal)
  }

  let json: CompletionJsonResponse
  try {
    json = (await response.json()) as CompletionJsonResponse
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { type: 'fail', result: `Invalid response: ${msg}` }
  }
  const type = json.type === 'fail' ? 'fail' : 'success'
  const result = typeof json.result === 'string' ? json.result : ''
  if (typeof json.model === 'string') {
    return { type, result, model: json.model }
  }
  return { type, result }
}
