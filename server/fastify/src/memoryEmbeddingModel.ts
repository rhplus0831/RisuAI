import type { Database } from '../../../src/ts/storage/database.svelte'
import type { HypaModel } from '../../../src/ts/process/memory/hypamemory'

export type MemoryEmbeddingProvider = 'openai-compatible' | 'custom' | 'voyage-contextual'

export interface MemoryEmbeddingModelRequest {
  provider: MemoryEmbeddingProvider
  model: string
  endpoint: string
  apiKey?: string
  wireModel?: string
}

export type ResolveMemoryEmbeddingModelResult =
  | { ok: true; request: MemoryEmbeddingModelRequest }
  | { ok: false; error: string }

const OPENAI_EMBEDDING_MODELS: Partial<Record<HypaModel, string>> = {
  ada: 'text-embedding-ada-002',
  openai3small: 'text-embedding-3-small',
  openai3large: 'text-embedding-3-large',
}

const VOYAGE_CONTEXTUAL_ENDPOINT = 'https://api.voyageai.com/v1/contextualizedembeddings'
const VOYAGE_CONTEXTUAL_MODEL = 'voyage-context-3'

const LOCAL_EMBEDDING_MODELS = new Set<string>([
  'MiniLM',
  'MiniLMGPU',
  'nomic',
  'nomicGPU',
  'bgeSmallEn',
  'bgeSmallEnGPU',
  'bgem3',
  'bgem3GPU',
  'multiMiniLM',
  'multiMiniLMGPU',
  'bgeM3Ko',
  'bgeM3KoGPU',
])

export function resolveMemoryEmbeddingModel(
  db: Database,
  requestedModel: HypaModel | 'auto' = 'auto',
): ResolveMemoryEmbeddingModelResult {
  const model = requestedModel === 'auto' ? db.hypaModel || 'MiniLM' : requestedModel

  if (model === 'custom') {
    const rawUrl = asTrimmedString(db.hypaCustomSettings?.url)
    if (!rawUrl) return { ok: false, error: 'custom embedding model requires a server URL' }

    const wireModel = asTrimmedString(db.hypaCustomSettings?.model)
    const apiKey = asTrimmedString(db.hypaCustomSettings?.key)
    return {
      ok: true,
      request: {
        provider: 'custom',
        model: wireModel ?? 'custom',
        wireModel,
        endpoint: embeddingEndpoint(rawUrl),
        ...(apiKey ? { apiKey } : {}),
      },
    }
  }

  const openAIModel = OPENAI_EMBEDDING_MODELS[model]
  if (openAIModel) {
    const apiKey = asTrimmedString(db.hypaV3Key)
    if (!apiKey) return { ok: false, error: `${openAIModel} requires a Hypa V3 API key` }
    return {
      ok: true,
      request: {
        provider: 'openai-compatible',
        model: openAIModel,
        wireModel: openAIModel,
        endpoint: 'https://api.openai.com/v1/embeddings',
        apiKey,
      },
    }
  }

  if (model === 'voyageContext3') {
    const apiKey = asTrimmedString(db.voyageApiKey)
    if (!apiKey) return { ok: false, error: 'voyage-context-3 requires a Voyage API key' }
    return {
      ok: true,
      request: {
        provider: 'voyage-contextual',
        model: VOYAGE_CONTEXTUAL_MODEL,
        wireModel: VOYAGE_CONTEXTUAL_MODEL,
        endpoint: VOYAGE_CONTEXTUAL_ENDPOINT,
        apiKey,
      },
    }
  }

  if (LOCAL_EMBEDDING_MODELS.has(model)) {
    return {
      ok: false,
      error: `server-side memory embeddings do not support browser-local model ${model}`,
    }
  }

  return { ok: false, error: `unsupported memory embedding model: ${model}` }
}

function embeddingEndpoint(url: string): string {
  const trimmed = url.replace(/\/+$/, '')
  return trimmed.endsWith('/embeddings') ? trimmed : `${trimmed}/embeddings`
}

function asTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}
