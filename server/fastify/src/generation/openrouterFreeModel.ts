import { createHash } from 'node:crypto'
import { executeProviderOperation } from '../providerOperations.js'

export const OPENROUTER_FREE_MODEL_SENTINEL = 'risu/free'
export const OPENROUTER_FREE_MODEL_CACHE_TTL_MS = 45 * 60 * 1000
export const OPENROUTER_FREE_MODEL_CATALOG_TIMEOUT_MS = 15_000

interface OpenRouterCatalogModel {
  id?: unknown
  name?: unknown
  context_length?: unknown
  pricing?: {
    prompt?: unknown
    completion?: unknown
  }
}

interface CachedFreeModel {
  modelId: string
  expiresAt: number
}

export interface ResolveOpenRouterFreeModelOptions {
  apiKey?: string
  signal?: AbortSignal
  fetchImpl?: typeof fetch
  now?: () => number
}

const freeModelCache = new Map<string, CachedFreeModel>()

function credentialCacheKey(apiKey: string | undefined): string {
  if (!apiKey) return 'public'
  return createHash('sha256').update(apiKey).digest('hex')
}

function catalogModels(catalog: unknown): OpenRouterCatalogModel[] | null {
  if (!catalog || typeof catalog !== 'object' || !Array.isArray((catalog as { data?: unknown }).data)) return null
  return (catalog as { data: OpenRouterCatalogModel[] }).data
}

/**
 * Baseline parity for `getFreeOpenRouterModels`: normalize the weighted price,
 * discard negative/invalid prices, keep rows whose generated legacy label ends
 * in `Free`, then choose the largest context. Stable sort preserves catalog
 * order when contexts tie.
 */
export function selectFreeOpenRouterModel(catalog: unknown): string | undefined {
  const models = catalogModels(catalog)
  if (!models) return undefined

  return models
    .map((model) => {
      const price = (Number(model.pricing?.prompt) * 3 + Number(model.pricing?.completion)) / 4
      const legacyName =
        price > 0 ? `${String(model.name)} - $${(price * 1000).toFixed(5)}/1k` : `${String(model.name)} - Free`
      return {
        id: typeof model.id === 'string' ? model.id : '',
        contextLength: Number(model.context_length),
        legacyName,
        price,
      }
    })
    .filter((model) => model.id.length > 0 && model.price >= 0)
    .sort((a, b) => a.price - b.price)
    .filter((model) => model.legacyName.endsWith('Free'))
    .sort((a, b) => b.contextLength - a.contextLength)[0]?.id
}

export async function resolveOpenRouterFreeModel(
  model: string,
  options: ResolveOpenRouterFreeModelOptions = {},
): Promise<string> {
  if (model !== OPENROUTER_FREE_MODEL_SENTINEL) return model

  const now = options.now?.() ?? Date.now()
  const cacheKey = credentialCacheKey(options.apiKey)
  const cached = freeModelCache.get(cacheKey)
  if (cached && cached.expiresAt > now) return cached.modelId

  let catalog: unknown
  try {
    catalog = await executeProviderOperation(
      {
        operation: 'openrouter.models',
        credential: options.apiKey ? { source: 'provided', apiKey: options.apiKey } : { source: 'none' },
      },
      {},
      {
        fetchImpl: options.fetchImpl,
        timeoutMs: OPENROUTER_FREE_MODEL_CATALOG_TIMEOUT_MS,
        signal: options.signal,
      },
    )
  } catch {
    if (cached) return cached.modelId
    throw new Error(
      'Unable to resolve OpenRouter model "risu/free": the model catalog request failed and no cached free model is available.',
    )
  }

  const modelId = selectFreeOpenRouterModel(catalog)
  if (!modelId) {
    freeModelCache.delete(cacheKey)
    throw new Error(
      'Unable to resolve OpenRouter model "risu/free": the model catalog contains no eligible free model.',
    )
  }

  freeModelCache.set(cacheKey, { modelId, expiresAt: now + OPENROUTER_FREE_MODEL_CACHE_TTL_MS })
  return modelId
}

export function clearOpenRouterFreeModelCacheForTests(): void {
  freeModelCache.clear()
}
