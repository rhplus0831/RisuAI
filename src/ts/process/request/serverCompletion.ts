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
    case LLMFormat.AnthropicLegacy:
    case LLMFormat.NanoGPTMessages:
      return 'anthropic'
    case LLMFormat.Mistral:
      return 'mistral'
    case LLMFormat.Cohere:
      return 'cohere'
    case LLMFormat.GoogleCloud:
      return 'gemini'
    case LLMFormat.OpenAILegacyInstruct:
    case LLMFormat.NanoGPTLegacy:
      return 'openai-legacy-instruct'
    case LLMFormat.OpenAIResponseAPI:
    case LLMFormat.NanoGPTResponses:
      return 'openai-responses'
    case LLMFormat.Ollama:
      // Both the native /api/chat path (LLMFormat.Ollama on a self-hosted
      // box) and the ollama.com cloud variants land here. The gate inside
      // resolveOllamaProvider() picks the upstream dispatcher: native gets
      // its own 'ollama' provider, cloud routes to openai / openai-responses
      // / anthropic per db.ollamaRequestFormat.
      return 'ollama'
    case LLMFormat.Kobold:
      return 'kobold'
    case LLMFormat.OobaLegacy:
      return 'ooba-legacy'
    default:
      return null
  }
}

/**
 * `LLMFormat.OpenAICompatible` covers vanilla OpenAI plus several derivatives
 * that share the wire shape. Vanilla goes to `provider: 'openai'`;
 * `aiModel === 'openrouter'` routes to `'openrouter'`; models that look up
 * their key under `db.OaiCompAPIKeys[modelInfo.keyIdentifier]` (DeepSeek,
 * DeepInfra) ride the openai dispatcher with the lookup key + a baseUrl
 * derived from `modelInfo.endpoint`. `xcustom:::<id>` rides the openai
 * dispatcher with per-entry URL + key from `db.customModels` plus an
 * `additionalParams` overlay parsed from the entry's `params` field.
 * reverse_proxy stays on local dispatch until its slice lands.
 */
function selectOpenAIVariant(targ: RequestDataArgumentExtended): string | null {
  const aiModel = targ.aiModel ?? targ.modelInfo?.id ?? ''
  if (aiModel === 'openrouter') return 'openrouter'
  if (aiModel === 'reverse_proxy') {
    const db = getDatabase()
    // `db.customAPIFormat` mutates `modelInfo.format` upstream in request.ts.
    // Only OAI-compat reverse_proxy routes through this slice; Anthropic /
    // Mistral / etc. variants get their own slices.
    if (targ.modelInfo?.format !== LLMFormat.OpenAICompatible) return null
    if (typeof db.forceReplaceUrl !== 'string' || db.forceReplaceUrl.length === 0) return null
    if (typeof db.proxyKey !== 'string' || db.proxyKey.length === 0) return null
    return 'openai'
  }
  if (aiModel.startsWith('xcustom:::')) {
    const entry = findXcustomEntry(aiModel)
    if (entry === null) return null
    if (entry.format !== LLMFormat.OpenAICompatible) return null
    return 'openai'
  }
  if (targ.modelInfo?.keyIdentifier) {
    const db = getDatabase()
    const key = db.OaiCompAPIKeys?.[targ.modelInfo.keyIdentifier]
    if (typeof key !== 'string' || key.length === 0) return null
    if (typeof targ.modelInfo.endpoint !== 'string' || targ.modelInfo.endpoint.length === 0) {
      return null
    }
    return 'openai'
  }
  // A hardcoded endpoint without a keyIdentifier means a self-hosted /
  // reverse-proxy deployment whose auth path is not yet defined; stay local.
  if (targ.modelInfo?.endpoint) return null
  return 'openai'
}

/**
 * Anthropic counterpart to `resolveReverseProxyUrl`: mirror the local
 * autofill at `src/ts/process/request/anthropic.ts:90-101` (which appends
 * `/v1/messages` onto bare URLs), then strip the trailing `/messages` so
 * the server-side dispatcher can re-append it itself. Anthropic has no
 * `risu::` prefix handling.
 */
function resolveReverseProxyAnthropicUrl(rawUrl: string, autofill: boolean): string {
  let url = rawUrl
  if (autofill) {
    if (url.endsWith('v1')) {
      url += '/messages'
    } else if (url.endsWith('v1/')) {
      url += 'messages'
    } else if (!(url.endsWith('messages') || url.endsWith('messages/'))) {
      url += url.endsWith('/') ? 'v1/messages' : '/v1/messages'
    }
  }
  // Strip trailing /messages (or /messages/) since the server appends it.
  const trimmed = url.replace(/\/+$/, '')
  if (trimmed.endsWith('/messages')) return trimmed.slice(0, -'/messages'.length)
  return trimmed
}

/**
 * Normalize `db.forceReplaceUrl` into a clean base URL the server-side
 * dispatcher can append `/chat/completions` to. Mirrors the local autofill
 * in `src/ts/process/request/openAI/requests.ts:596-614` plus the `risu::`
 * prefix → `X-Proxy-Risu` header handoff.
 */
function resolveReverseProxyUrl(rawUrl: string, autofill: boolean): {
  baseUrl: string
  risuIdentify: boolean
} {
  let url = rawUrl
  let risuIdentify = false
  if (url.startsWith('risu::')) {
    risuIdentify = true
    url = url.slice('risu::'.length)
  }
  if (autofill) {
    if (url.endsWith('v1')) {
      url += '/chat/completions'
    } else if (url.endsWith('v1/')) {
      url += 'chat/completions'
    } else if (!(url.endsWith('completions') || url.endsWith('completions/'))) {
      url += url.endsWith('/') ? 'v1/chat/completions' : '/v1/chat/completions'
    }
  }
  return { baseUrl: deriveOpenAIBaseUrl(url), risuIdentify }
}

interface XcustomEntry {
  id: string
  internalId: string
  url: string
  key: string
  format: LLMFormat
  params: string
}

function findXcustomEntry(aiModel: string): XcustomEntry | null {
  const db = getDatabase()
  const models = (db.customModels ?? []) as XcustomEntry[]
  const entry = models.find((m) => m.id === aiModel)
  if (!entry) return null
  if (typeof entry.url !== 'string' || entry.url.length === 0) return null
  if (typeof entry.key !== 'string' || entry.key.length === 0) return null
  return entry
}

/**
 * Parse the xcustom `params` block (and reverse_proxy's `additionalParams`
 * table, once that slice lands) into `[key, value][]` pairs. Mirrors the
 * local code in `src/ts/process/request/shared.ts:getAdditionalParameters`.
 * Each non-empty line is split on the first `=`; the value can contain `=`.
 */
function parseXcustomParams(params: string): Array<[string, string]> {
  if (typeof params !== 'string' || params.length === 0) return []
  const out: Array<[string, string]> = []
  for (const line of params.split('\n')) {
    const split = line.split('=')
    if (split.length < 2) continue
    out.push([split[0], split.slice(1).join('=')])
  }
  return out
}

/**
 * Local model endpoints come as a fully-qualified
 * `<baseUrl>/chat/completions` URL. The server-side openai dispatcher
 * appends `/chat/completions` itself, so strip the trailing path component
 * before forwarding.
 */
function deriveOpenAIBaseUrl(endpoint: string): string {
  const trimmed = endpoint.replace(/\/+$/, '')
  if (trimmed.endsWith('/chat/completions')) {
    return trimmed.slice(0, -'/chat/completions'.length)
  }
  return trimmed
}

function isVanillaAnthropic(targ: RequestDataArgumentExtended): boolean {
  const aiModel = targ.aiModel ?? targ.modelInfo?.id ?? ''
  if (aiModel === 'reverse_proxy') {
    // reverse_proxy with db.customAPIFormat === Anthropic rides the anthropic
    // dispatcher with proxyKey + forceReplaceUrl + db.additionalParams.
    // request.ts mutates modelInfo.format to db.customAPIFormat before the
    // adapter runs, so by the time isVanillaAnthropic is called, format is
    // already Anthropic. Validate the supporting db fields here.
    const db = getDatabase()
    if (typeof db.forceReplaceUrl !== 'string' || db.forceReplaceUrl.length === 0) return false
    if (typeof db.proxyKey !== 'string' || db.proxyKey.length === 0) return false
    return true
  }
  if (aiModel.startsWith('xcustom:::')) {
    // xcustom with format === Anthropic also rides the anthropic dispatcher.
    const entry = findXcustomEntry(aiModel)
    if (entry === null) return false
    if (entry.format !== LLMFormat.Anthropic) return false
    return true
  }
  if (targ.modelInfo?.endpoint) return false
  return true
}

/**
 * Mistral derivatives (reverse_proxy targeting Mistral, xcustom::: with a
 * Mistral-format model id, or any model carrying a hardcoded `endpoint` for a
 * self-hosted Mistral deployment) stay on the local dispatch path. Each gets
 * its own slice when the variant routing is wired.
 */
function isVanillaMistral(targ: RequestDataArgumentExtended): boolean {
  const aiModel = targ.aiModel ?? targ.modelInfo?.id ?? ''
  if (aiModel === 'reverse_proxy') return false
  if (aiModel.startsWith('xcustom:::')) return false
  if (targ.modelInfo?.endpoint) return false
  return true
}

function isVanillaCohere(targ: RequestDataArgumentExtended): boolean {
  const aiModel = targ.aiModel ?? targ.modelInfo?.id ?? ''
  if (aiModel === 'reverse_proxy') return false
  if (aiModel.startsWith('xcustom:::')) return false
  if (targ.modelInfo?.endpoint) return false
  return true
}

/**
 * Vanilla Google AI (LLMFormat.GoogleCloud) only. VertexAIGemini stays local
 * for now — it needs the project ID, region, and a JWT-derived bearer token
 * which we don't yet own server-side.
 */
function isVanillaGemini(targ: RequestDataArgumentExtended): boolean {
  const aiModel = targ.aiModel ?? targ.modelInfo?.id ?? ''
  if (aiModel === 'reverse_proxy') return false
  if (aiModel.startsWith('xcustom:::')) return false
  if (targ.modelInfo?.endpoint) return false
  return true
}

function isVanillaResponses(targ: RequestDataArgumentExtended): boolean {
  const aiModel = targ.aiModel ?? targ.modelInfo?.id ?? ''
  if (aiModel === 'reverse_proxy') return false
  if (aiModel.startsWith('xcustom:::')) return false
  // OpenAI Responses keeps `modelInfo.endpoint` for Azure-style hosts. We
  // accept the endpoint as a baseUrl override when present; the dispatcher
  // re-derives `/responses` from it. Refuse only when the endpoint is
  // explicitly the chat-completions URL (handled by the openai variant path).
  return true
}

function isVanillaLegacyInstruct(targ: RequestDataArgumentExtended): boolean {
  const aiModel = targ.aiModel ?? targ.modelInfo?.id ?? ''
  if (aiModel === 'reverse_proxy') return false
  if (aiModel.startsWith('xcustom:::')) return false
  // NanoGPTLegacy carries a fixed-format model id; it's still server-routable.
  // OpenAILegacyInstruct with a modelInfo.endpoint override is deferred.
  if (
    targ.modelInfo?.endpoint &&
    targ.modelInfo?.format !== LLMFormat.NanoGPTLegacy
  ) {
    return false
  }
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
  if (provider === 'mistral' && !isVanillaMistral(targ)) return null
  if (provider === 'cohere' && !isVanillaCohere(targ)) return null
  if (provider === 'gemini' && !isVanillaGemini(targ)) return null
  if (provider === 'openai-legacy-instruct' && !isVanillaLegacyInstruct(targ)) return null
  if (provider === 'openai-responses' && !isVanillaResponses(targ)) return null
  if (provider === 'ollama') {
    // Translate the routing decision the local code makes for ollama-cloud.
    return resolveOllamaProvider(targ)
  }
  return provider
}

/**
 * Local code routes `aiModel === 'ollama-cloud'` to different upstream
 * dispatchers based on `db.ollamaRequestFormat`. Mirror that. The native
 * `/api/chat` shape (non-cloud) goes to the dedicated `'ollama'` provider
 * when `db.ollamaURL` is set; otherwise we have no host to talk to and fall
 * through to local dispatch.
 */
function resolveOllamaProvider(targ: RequestDataArgumentExtended): string | null {
  const db = getDatabase()
  if (targ.aiModel === 'ollama-cloud') {
    if (typeof db.ollamaApiKey !== 'string' || db.ollamaApiKey.length === 0) return null
    const fmt = db.ollamaRequestFormat
    if (fmt === LLMFormat.OpenAICompatible) return 'openai'
    if (fmt === LLMFormat.OpenAIResponseAPI) return 'openai-responses'
    if (fmt === LLMFormat.Anthropic) return 'anthropic'
    return null
  }
  if (typeof db.ollamaURL !== 'string' || db.ollamaURL.length === 0) return null
  return 'ollama'
}

/**
 * Wire-level `model` for the upstream. Vanilla OpenAI sends `aiModel`
 * verbatim; nanogpt and openrouter override with the user's
 * `db.nanogptRequestModel` / `db.openrouterRequestModel` because the local
 * dispatcher does the same in `request/openAI/requests.ts:255-262`.
 */
function isOllamaCloud(targ: RequestDataArgumentExtended): boolean {
  return targ.aiModel === 'ollama-cloud'
}

export function resolveProviderModel(
  targ: RequestDataArgumentExtended,
  provider: string,
): string {
  const db = getDatabase()
  if (isOllamaCloud(targ)) {
    return db.ollamaCloudModel ?? ''
  }
  if (provider === 'ollama') return db.ollamaModel ?? ''
  const aiModel = targ.aiModel ?? ''
  if (aiModel.startsWith('xcustom:::')) {
    const entry = findXcustomEntry(aiModel)
    if (entry !== null) {
      return entry.internalId.length > 0 ? entry.internalId : entry.id
    }
  }
  // reverse_proxy uses db.customProxyRequestModel as the wire model regardless
  // of which dispatcher it ends up on (OAI-compat or Anthropic).
  if (aiModel === 'reverse_proxy') return db.customProxyRequestModel ?? ''
  if (provider === 'nanogpt') return db.nanogptRequestModel ?? ''
  if (provider === 'openrouter') return db.openrouterRequestModel ?? ''
  if (provider === 'gemini') {
    // Gemini's URL is /models/<id>:generateContent. Local code uses
    // modelInfo.internalID for that path; mirror it.
    const raw = targ.modelInfo?.internalID ?? targ.modelInfo?.id ?? targ.aiModel ?? ''
    // Dynamic-registered entries store internalID as `'models/<name>'`. Strip
    // the `models/` prefix so the dispatcher's `/models/<model>` URL doesn't
    // end up with a double prefix.
    return raw.startsWith('models/') ? raw.slice('models/'.length) : raw
  }
  if (provider === 'openai-legacy-instruct') {
    if (targ.modelInfo?.format === LLMFormat.NanoGPTLegacy) {
      return db.nanogptRequestModel ?? ''
    }
    // The local OpenAI legacy instruct path hardcodes 'gpt-3.5-turbo-instruct'
    // regardless of the local model id; mirror that.
    return 'gpt-3.5-turbo-instruct'
  }
  if (provider === 'anthropic' && targ.modelInfo?.format === LLMFormat.NanoGPTMessages) {
    return db.nanogptRequestModel ?? ''
  }
  if (provider === 'openai-responses') {
    if (targ.modelInfo?.format === LLMFormat.NanoGPTResponses) {
      return db.nanogptRequestModel ?? ''
    }
    return targ.modelInfo?.internalID ?? targ.modelInfo?.id ?? targ.aiModel ?? ''
  }
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
    const openai: Record<string, unknown> = {}
    const aiModel = targ.aiModel ?? ''
    if (isOllamaCloud(targ)) {
      openai.apiKey = db.ollamaApiKey ?? ''
      openai.baseUrl = 'https://ollama.com/v1'
    } else if (aiModel === 'reverse_proxy') {
      openai.apiKey = db.proxyKey ?? ''
      const autofill = db.autofillRequestUrl !== false
      const { baseUrl, risuIdentify } = resolveReverseProxyUrl(db.forceReplaceUrl ?? '', autofill)
      openai.baseUrl = baseUrl
      if (risuIdentify) {
        openai.extraHeaders = { 'X-Proxy-Risu': 'RisuAI' }
      }
      if (Array.isArray(db.additionalParams) && db.additionalParams.length > 0) {
        openai.additionalParams = db.additionalParams
      }
      if (db.reverseProxyOobaMode === true) openai.oobaSystemHoist = true
    } else if (aiModel.startsWith('xcustom:::')) {
      const entry = findXcustomEntry(aiModel)
      if (entry !== null) {
        openai.apiKey = entry.key
        openai.baseUrl = deriveOpenAIBaseUrl(entry.url)
        const params = parseXcustomParams(entry.params)
        if (params.length > 0) openai.additionalParams = params
      }
    } else {
      const keyId = targ.modelInfo?.keyIdentifier
      if (typeof keyId === 'string' && keyId.length > 0) {
        openai.apiKey = db.OaiCompAPIKeys?.[keyId] ?? ''
        if (typeof targ.modelInfo?.endpoint === 'string') {
          openai.baseUrl = deriveOpenAIBaseUrl(targ.modelInfo.endpoint)
        }
      } else {
        openai.apiKey = db.openAIKey ?? ''
      }
    }
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
    const anthropic: Record<string, unknown> = {}
    const aiModel = targ.aiModel ?? ''
    const isNanoGPT = targ.modelInfo?.format === LLMFormat.NanoGPTMessages
    if (isOllamaCloud(targ)) {
      anthropic.apiKey = db.ollamaApiKey ?? ''
      anthropic.baseUrl = 'https://ollama.com/v1'
    } else if (isNanoGPT) {
      anthropic.apiKey = db.nanogptKey ?? ''
      anthropic.baseUrl = 'https://nano-gpt.com/api/v1'
    } else if (aiModel === 'reverse_proxy') {
      anthropic.apiKey = db.proxyKey ?? ''
      const autofill = db.autofillRequestUrl !== false
      anthropic.baseUrl = resolveReverseProxyAnthropicUrl(db.forceReplaceUrl ?? '', autofill)
      if (Array.isArray(db.additionalParams) && db.additionalParams.length > 0) {
        anthropic.additionalParams = db.additionalParams
      }
    } else if (aiModel.startsWith('xcustom:::')) {
      const entry = findXcustomEntry(aiModel)
      if (entry !== null) {
        anthropic.apiKey = entry.key
        // xcustom URL is stored as the full /v1/messages URL; strip the
        // trailing /messages so the server can re-append it.
        const trimmed = entry.url.replace(/\/+$/, '')
        anthropic.baseUrl = trimmed.endsWith('/messages')
          ? trimmed.slice(0, -'/messages'.length)
          : trimmed
        const params = parseXcustomParams(entry.params)
        if (params.length > 0) anthropic.additionalParams = params
      }
    } else {
      anthropic.apiKey = db.claudeAPIKey ?? ''
    }
    if (typeof targ.maxTokens === 'number') anthropic.maxTokens = targ.maxTokens
    if (typeof targ.temperature === 'number') anthropic.temperature = targ.temperature
    return { anthropic }
  }
  if (provider === 'mistral') {
    const mistral: Record<string, unknown> = { apiKey: db.mistralKey ?? '' }
    if (typeof targ.maxTokens === 'number') mistral.maxTokens = targ.maxTokens
    if (typeof targ.temperature === 'number') mistral.temperature = targ.temperature
    // presence/frequency/top_p parity with the local Mistral path is deferred
    // until the wider db→options parameter pipeline is sorted (the local code
    // pulls them from db.* via applyParameters, not from targ).
    return { mistral }
  }
  if (provider === 'cohere') {
    const cohere: Record<string, unknown> = { apiKey: db.cohereAPIKey ?? '' }
    if (typeof targ.temperature === 'number') cohere.temperature = targ.temperature
    // Older Cohere command-r variants accept safety_mode='NONE'; the two newer
    // command-r releases reject it. Mirror the local switch.
    const aiModel = targ.aiModel ?? targ.modelInfo?.id ?? ''
    const isNewerCommandR =
      aiModel === 'cohere-command-r-03-2024' || aiModel === 'cohere-command-r-plus-04-2024'
    if (!isNewerCommandR) cohere.safetyMode = 'NONE'
    return { cohere }
  }
  if (provider === 'gemini') {
    const gemini: Record<string, unknown> = { apiKey: db.google?.accessToken ?? '' }
    if (typeof targ.maxTokens === 'number') gemini.maxOutputTokens = targ.maxTokens
    if (typeof targ.temperature === 'number') gemini.temperature = targ.temperature
    return { gemini }
  }
  if (provider === 'openai-legacy-instruct') {
    const legacy: Record<string, unknown> = {}
    const isNanoGPT = targ.modelInfo?.format === LLMFormat.NanoGPTLegacy
    if (isNanoGPT) {
      legacy.apiKey = db.nanogptKey ?? ''
      legacy.baseUrl = 'https://nano-gpt.com/api/v1'
      if (typeof db.nanogptProvider === 'string' && db.nanogptProvider.length > 0) {
        legacy.extraHeaders = { 'X-Provider': db.nanogptProvider }
      }
    } else {
      legacy.apiKey = db.openAIKey ?? ''
    }
    if (typeof targ.maxTokens === 'number') legacy.maxTokens = targ.maxTokens
    if (typeof targ.temperature === 'number') legacy.temperature = targ.temperature
    return { 'openai-legacy-instruct': legacy }
  }
  if (provider === 'kobold') {
    const kobold: Record<string, unknown> = {}
    if (typeof db.koboldURL === 'string' && db.koboldURL.length > 0) {
      kobold.baseUrl = db.koboldURL
    }
    if (typeof targ.maxTokens === 'number') kobold.maxTokens = targ.maxTokens
    if (typeof db.maxContext === 'number') kobold.maxContextLength = db.maxContext
    if (typeof targ.temperature === 'number') kobold.temperature = targ.temperature
    return { kobold }
  }
  if (provider === 'ollama') {
    const ollama: Record<string, unknown> = { baseUrl: db.ollamaURL ?? '' }
    if (typeof targ.maxTokens === 'number') ollama.maxTokens = targ.maxTokens
    if (typeof targ.temperature === 'number') ollama.temperature = targ.temperature
    return { ollama }
  }
  if (provider === 'ooba-legacy') {
    const ooba: Record<string, unknown> = {}
    if (typeof db.textgenWebUIBlockingURL === 'string' && db.textgenWebUIBlockingURL.length > 0) {
      ooba.baseUrl = db.textgenWebUIBlockingURL
    }
    if (targ.aiModel !== 'textgen_webui' && typeof db.mancerHeader === 'string') {
      ooba.apiKey = db.mancerHeader
    }
    if (typeof targ.maxTokens === 'number') ooba.maxTokens = targ.maxTokens
    if (typeof targ.temperature === 'number') ooba.temperature = targ.temperature
    return { 'ooba-legacy': ooba }
  }
  if (provider === 'openai-responses') {
    const resp: Record<string, unknown> = {}
    const isNanoGPT = targ.modelInfo?.format === LLMFormat.NanoGPTResponses
    if (isOllamaCloud(targ)) {
      resp.apiKey = db.ollamaApiKey ?? ''
      resp.baseUrl = 'https://ollama.com/v1'
      resp.store = false
    } else if (isNanoGPT) {
      resp.apiKey = db.nanogptKey ?? ''
      resp.baseUrl = 'https://nano-gpt.com/api/v1'
      if (typeof db.nanogptProvider === 'string' && db.nanogptProvider.length > 0) {
        resp.extraHeaders = { 'X-Provider': db.nanogptProvider }
      }
    } else {
      resp.apiKey = db.openAIKey ?? ''
      if (typeof targ.modelInfo?.endpoint === 'string' && targ.modelInfo.endpoint.length > 0) {
        resp.baseUrl = targ.modelInfo.endpoint.replace(/\/responses\/?$/, '')
      }
    }
    if (typeof targ.maxTokens === 'number') resp.maxOutputTokens = targ.maxTokens
    if (typeof targ.temperature === 'number') resp.temperature = targ.temperature
    return { 'openai-responses': resp }
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
