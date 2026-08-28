export interface EmbeddingCacheIdentity {
  model: string
  customEmbeddingUrl?: string
  customEmbeddingModel?: string
  contextSuffix?: string
}

const EMBEDDING_CACHE_KEY_VERSION = 'risu-embedding-cache-v2'

export function getEmbeddingCacheKey(content: string, identity: EmbeddingCacheIdentity): string {
  const customModel = identity.model === 'custom' ? (identity.customEmbeddingModel?.trim() ?? '') : ''
  const customEndpoint = identity.model === 'custom' ? (identity.customEmbeddingUrl?.trim() ?? '') : ''

  return JSON.stringify([
    EMBEDDING_CACHE_KEY_VERSION,
    content,
    identity.model,
    customModel,
    customEndpoint,
    identity.contextSuffix ?? '',
  ])
}
