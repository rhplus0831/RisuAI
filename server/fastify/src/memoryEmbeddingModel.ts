import type { Database } from '../../../src/ts/storage/database.svelte'
import type { HypaModel } from '../../../src/ts/process/memory/hypamemory'

export type MemoryEmbeddingProvider = 'openai-compatible' | 'custom' | 'voyage-contextual'

export const MEMORY_EMBEDDING_APPROX_CHARS_PER_TOKEN = 4
export const MEMORY_EMBEDDING_FALLBACK_MAX_INPUT_BYTES = 64 * 1024

export const OPENAI_EMBEDDING_MAX_INPUT_TOKENS = 8_192
export const OPENAI_EMBEDDING_MAX_REQUEST_TOKENS = 300_000

export const VOYAGE_CONTEXT3_MAX_CONTEXT_CHUNK_TOKENS = 32_000
export const VOYAGE_CONTEXTUAL_MAX_CONTEXT_TOKENS = 120_000
export const VOYAGE_CONTEXTUAL_MAX_REQUEST_TOKENS = VOYAGE_CONTEXTUAL_MAX_CONTEXT_TOKENS
export const VOYAGE_CONTEXTUAL_MAX_CHUNKS = 16_000

export interface MemoryEmbeddingModelLimits {
  source: 'provider' | 'fallback'
  maxInputTokens?: number
  maxInputBytes?: number
  maxRequestTokens?: number
  maxRequestChunks?: number
  contextualWindowTokens?: number
}

export interface MemoryEmbeddingModelRequest {
  provider: MemoryEmbeddingProvider
  model: string
  endpoint: string
  apiKey?: string
  wireModel?: string
  limits?: MemoryEmbeddingModelLimits
}

export type ResolveMemoryEmbeddingModelResult =
  | { ok: true; request: MemoryEmbeddingModelRequest }
  | { ok: false; error: string }

export interface MemoryEmbeddingLimitViolation {
  label: string
  bound: 'maxInputTokens' | 'maxInputBytes' | 'maxRequestTokens' | 'maxRequestChunks' | 'contextualWindowTokens'
  actual: number
  limit: number
  unit: 'estimated tokens' | 'bytes' | 'chunks'
}

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
        model: 'custom',
        wireModel,
        endpoint: embeddingEndpoint(rawUrl),
        limits: fallbackEmbeddingLimits(),
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
        limits: openAIEmbeddingLimits(),
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
        limits: voyageContextualEmbeddingLimits(),
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

export function estimateMemoryEmbeddingTokens(text: string): number {
  return Math.ceil(text.length / MEMORY_EMBEDDING_APPROX_CHARS_PER_TOKEN)
}

export function memoryEmbeddingInputBytes(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}

export function effectiveMemoryEmbeddingLimits(request: MemoryEmbeddingModelRequest): MemoryEmbeddingModelLimits {
  return request.limits ?? fallbackEmbeddingLimits()
}

export function findMemoryEmbeddingLimitViolation(
  request: MemoryEmbeddingModelRequest,
  inputs: readonly string[],
  labelForIndex: (index: number) => string,
): MemoryEmbeddingLimitViolation | null {
  const limits = effectiveMemoryEmbeddingLimits(request)
  let totalTokens = 0

  for (let index = 0; index < inputs.length; index += 1) {
    const input = inputs[index]
    const label = labelForIndex(index)
    const estimatedTokens = estimateMemoryEmbeddingTokens(input)
    totalTokens += estimatedTokens

    if (typeof limits.maxInputTokens === 'number' && estimatedTokens > limits.maxInputTokens) {
      return {
        label,
        bound: 'maxInputTokens',
        actual: estimatedTokens,
        limit: limits.maxInputTokens,
        unit: 'estimated tokens',
      }
    }

    const bytes = memoryEmbeddingInputBytes(input)
    if (typeof limits.maxInputBytes === 'number' && bytes > limits.maxInputBytes) {
      return {
        label,
        bound: 'maxInputBytes',
        actual: bytes,
        limit: limits.maxInputBytes,
        unit: 'bytes',
      }
    }
  }

  if (typeof limits.maxRequestChunks === 'number' && inputs.length > limits.maxRequestChunks) {
    return {
      label: 'memory embedding request',
      bound: 'maxRequestChunks',
      actual: inputs.length,
      limit: limits.maxRequestChunks,
      unit: 'chunks',
    }
  }

  if (typeof limits.maxRequestTokens === 'number' && totalTokens > limits.maxRequestTokens) {
    return {
      label: 'memory embedding request',
      bound: 'maxRequestTokens',
      actual: totalTokens,
      limit: limits.maxRequestTokens,
      unit: 'estimated tokens',
    }
  }

  return null
}

export function findMemoryEmbeddingContextualGroupLimitViolation(
  request: MemoryEmbeddingModelRequest,
  groups: readonly (readonly string[])[],
  labelForIndex: (index: number) => string,
): MemoryEmbeddingLimitViolation | null {
  const contextualWindowTokens = effectiveMemoryEmbeddingLimits(request).contextualWindowTokens
  if (typeof contextualWindowTokens !== 'number') return null

  for (let index = 0; index < groups.length; index += 1) {
    const groupTokens = groups[index].reduce((total, text) => total + estimateMemoryEmbeddingTokens(text), 0)
    if (groupTokens > contextualWindowTokens) {
      return {
        label: labelForIndex(index),
        bound: 'contextualWindowTokens',
        actual: groupTokens,
        limit: contextualWindowTokens,
        unit: 'estimated tokens',
      }
    }
  }

  return null
}

export function formatMemoryEmbeddingLimitViolation(violation: MemoryEmbeddingLimitViolation): string {
  return `${violation.label} exceeds ${violation.bound}: ${violation.actual} ${violation.unit} > ${violation.limit} ${violation.unit}`
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

function openAIEmbeddingLimits(): MemoryEmbeddingModelLimits {
  return {
    source: 'provider',
    maxInputTokens: OPENAI_EMBEDDING_MAX_INPUT_TOKENS,
    maxInputBytes: OPENAI_EMBEDDING_MAX_INPUT_TOKENS * MEMORY_EMBEDDING_APPROX_CHARS_PER_TOKEN,
    maxRequestTokens: OPENAI_EMBEDDING_MAX_REQUEST_TOKENS,
  }
}

function voyageContextualEmbeddingLimits(): MemoryEmbeddingModelLimits {
  return {
    source: 'provider',
    maxInputTokens: VOYAGE_CONTEXT3_MAX_CONTEXT_CHUNK_TOKENS,
    maxInputBytes: VOYAGE_CONTEXT3_MAX_CONTEXT_CHUNK_TOKENS * MEMORY_EMBEDDING_APPROX_CHARS_PER_TOKEN,
    maxRequestTokens: VOYAGE_CONTEXTUAL_MAX_REQUEST_TOKENS,
    maxRequestChunks: VOYAGE_CONTEXTUAL_MAX_CHUNKS,
    contextualWindowTokens: VOYAGE_CONTEXTUAL_MAX_CONTEXT_TOKENS,
  }
}

function fallbackEmbeddingLimits(): MemoryEmbeddingModelLimits {
  return {
    source: 'fallback',
    maxInputBytes: MEMORY_EMBEDDING_FALLBACK_MAX_INPUT_BYTES,
  }
}
