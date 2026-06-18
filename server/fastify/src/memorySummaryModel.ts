import type { Database } from '../../../src/ts/storage/database.svelte'
import { LLMFormat, type LLMFormat as LLMFormatValue } from '../../../src/ts/model/types'
import { resolveModelForRole } from '../../../src/ts/model/modelRoles.js'
import { type OpenAICompatibleOptions, type OpenAICompatibleProvider } from './generation/openaiCompatible.js'

interface CustomModelEntry {
  id?: unknown
  internalId?: unknown
  url?: unknown
  key?: unknown
  format?: unknown
  params?: unknown
}

interface ModelInfoLite {
  id: string
  format: LLMFormatValue
  internalID?: string
  endpoint?: string
  keyIdentifier?: string
}

export interface MemorySummaryModelRequest {
  provider: OpenAICompatibleProvider
  model: string
  options: OpenAICompatibleOptions
}

export type ResolveMemorySummaryModelResult =
  | { ok: true; request: MemorySummaryModelRequest }
  | { ok: false; error: string }

export function resolveMemorySummaryModel(db: Database, requestedModel: string): ResolveMemorySummaryModelResult {
  if (requestedModel !== 'subModel' && requestedModel !== 'memory') {
    return {
      ok: false,
      error: 'server-side memory summarization currently supports only the memory/subModel API path',
    }
  }

  const aiModel = resolveModelForRole(db, 'memory')
  const info = resolveModelInfo(db, aiModel)
  const provider = resolveProvider(aiModel, info)
  if (provider !== 'openai' && provider !== 'nanogpt' && provider !== 'openrouter') {
    return {
      ok: false,
      error: `summarization memory provider is not API-backed OpenAI-compatible: ${provider ?? info.format}`,
    }
  }

  const model = resolveProviderModel(db, aiModel, info, provider)
  if (!model) {
    return { ok: false, error: 'summarization model must be a non-empty string' }
  }

  const options = resolveProviderOptions(db, aiModel, info, provider)
  return { ok: true, request: { provider, model, options } }
}

function resolveModelInfo(db: Database, aiModel: string): ModelInfoLite {
  if (aiModel === 'reverse_proxy') {
    return {
      id: aiModel,
      internalID: asString(db.customProxyRequestModel) ?? aiModel,
      format: (asNumber(db.customAPIFormat) ?? LLMFormat.OpenAICompatible) as LLMFormatValue,
    }
  }

  if (aiModel.startsWith('xcustom:::')) {
    const entry = findXcustomEntry(db, aiModel)
    if (entry) {
      return {
        id: asString(entry.id) ?? aiModel,
        internalID: asString(entry.internalId) ?? asString(entry.id) ?? aiModel,
        format: (asNumber(entry.format) ?? LLMFormat.OpenAICompatible) as LLMFormatValue,
      }
    }
  }

  if (aiModel === 'openrouter') {
    return { id: aiModel, format: LLMFormat.OpenAICompatible }
  }
  if (aiModel === 'nanogpt') {
    return { id: aiModel, format: LLMFormat.NanoGPT }
  }
  if (aiModel === 'ollama-cloud') {
    return {
      id: aiModel,
      format: (asNumber(db.ollamaRequestFormat) ?? LLMFormat.OpenAICompatible) as LLMFormatValue,
    }
  }
  if (aiModel.startsWith('deepseek-')) {
    return {
      id: aiModel,
      format: LLMFormat.OpenAICompatible,
      endpoint: 'https://api.deepseek.com/beta/chat/completions',
      keyIdentifier: 'deepseek',
    }
  }
  if (aiModel.startsWith('deepinfra_')) {
    return {
      id: aiModel.slice('deepinfra_'.length),
      format: LLMFormat.OpenAICompatible,
      endpoint: 'https://api.deepinfra.com/v1/openai/chat/completions',
      keyIdentifier: 'deepinfra',
    }
  }
  if (aiModel.startsWith('claude-')) return { id: aiModel, format: LLMFormat.Anthropic }
  if (aiModel.startsWith('mistral') || aiModel.startsWith('magistral')) {
    return { id: aiModel, format: LLMFormat.Mistral }
  }
  if (aiModel.startsWith('cohere-')) return { id: aiModel, format: LLMFormat.Cohere }
  if (aiModel.startsWith('gemini-')) return { id: aiModel, format: LLMFormat.GoogleCloud }
  if (aiModel.includes('instruct')) return { id: aiModel, format: LLMFormat.OpenAILegacyInstruct }
  if (aiModel.endsWith('-response-api')) {
    return {
      id: aiModel,
      internalID: aiModel.slice(0, -'-response-api'.length),
      format: LLMFormat.OpenAIResponseAPI,
    }
  }

  return { id: aiModel, format: LLMFormat.OpenAICompatible }
}

function resolveProvider(aiModel: string, info: ModelInfoLite): OpenAICompatibleProvider | string | null {
  if (info.format === LLMFormat.NanoGPT) return 'nanogpt'
  if (info.format !== LLMFormat.OpenAICompatible) return null
  if (aiModel === 'openrouter') return 'openrouter'
  return 'openai'
}

function resolveProviderModel(
  db: Database,
  aiModel: string,
  info: ModelInfoLite,
  provider: OpenAICompatibleProvider,
): string {
  if (aiModel === 'ollama-cloud') return db.ollamaCloudModel ?? ''
  if (aiModel.startsWith('xcustom:::')) {
    const entry = findXcustomEntry(db, aiModel)
    return asString(entry?.internalId) ?? asString(entry?.id) ?? aiModel
  }
  if (aiModel === 'reverse_proxy') return db.customProxyRequestModel ?? ''
  if (provider === 'nanogpt') return db.nanogptRequestModel ?? ''
  if (provider === 'openrouter') return db.openrouterRequestModel ?? ''
  return info.id
}

function resolveProviderOptions(
  db: Database,
  aiModel: string,
  info: ModelInfoLite,
  provider: OpenAICompatibleProvider,
): OpenAICompatibleOptions {
  if (provider === 'nanogpt') {
    return {
      nanogpt: {
        apiKey: db.nanogptKey,
        providerHint: db.nanogptProvider,
        useSubscription: db.nanogptUseSubscriptionEndpoint,
      },
    }
  }

  if (provider === 'openrouter') {
    return { openrouter: { apiKey: db.openrouterKey } }
  }

  if (aiModel === 'ollama-cloud') {
    return { openai: { apiKey: db.ollamaApiKey, baseUrl: 'https://ollama.com/v1' } }
  }
  if (aiModel === 'reverse_proxy') {
    const rawUrl = asString(db.forceReplaceUrl) ?? ''
    const { baseUrl, risuIdentify } = resolveReverseProxyUrl(rawUrl, db.autofillRequestUrl !== false)
    return {
      openai: {
        apiKey: db.proxyKey,
        baseUrl,
        extraHeaders: risuIdentify ? { 'X-Proxy-Risu': 'RisuAI' } : undefined,
        additionalParams: additionalParams(db.additionalParams),
        oobaSystemHoist: db.reverseProxyOobaMode === true,
      },
    }
  }
  if (aiModel.startsWith('xcustom:::')) {
    const entry = findXcustomEntry(db, aiModel)
    return {
      openai: {
        apiKey: entry?.key,
        baseUrl: deriveOpenAIBaseUrl(asString(entry?.url) ?? ''),
        additionalParams: parseXcustomParams(entry?.params),
      },
    }
  }
  if (info.keyIdentifier) {
    return {
      openai: {
        apiKey: db.OaiCompAPIKeys?.[info.keyIdentifier],
        baseUrl: info.endpoint ? deriveOpenAIBaseUrl(info.endpoint) : undefined,
      },
    }
  }
  return { openai: { apiKey: db.openAIKey } }
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function additionalParams(value: unknown): Array<[string, string]> | undefined {
  if (!Array.isArray(value)) return undefined
  const out: Array<[string, string]> = []
  for (const row of value) {
    if (Array.isArray(row) && typeof row[0] === 'string' && typeof row[1] === 'string') {
      out.push([row[0], row[1]])
    }
  }
  return out.length > 0 ? out : undefined
}

function parseXcustomParams(params: unknown): Array<[string, string]> | undefined {
  if (typeof params !== 'string' || params.length === 0) return undefined
  const out: Array<[string, string]> = []
  for (const line of params.split('\n')) {
    const split = line.split('=')
    if (split.length < 2) continue
    out.push([split[0], split.slice(1).join('=')])
  }
  return out.length > 0 ? out : undefined
}

function findXcustomEntry(db: Database, aiModel: string): CustomModelEntry | null {
  const models = Array.isArray(db.customModels) ? (db.customModels as CustomModelEntry[]) : []
  return models.find((m) => m.id === aiModel) ?? null
}

function deriveOpenAIBaseUrl(endpoint: string): string {
  const trimmed = endpoint.replace(/\/+$/, '')
  if (trimmed.endsWith('/chat/completions')) {
    return trimmed.slice(0, -'/chat/completions'.length)
  }
  return trimmed
}

function resolveReverseProxyUrl(
  rawUrl: string,
  autofill: boolean,
): {
  baseUrl: string
  risuIdentify: boolean
} {
  let url = rawUrl
  let risuIdentify = false
  if (url.startsWith('risu::')) {
    risuIdentify = true
    url = url.slice('risu::'.length)
  }
  if (autofill && url.length > 0) {
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
