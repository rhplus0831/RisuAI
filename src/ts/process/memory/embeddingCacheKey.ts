export interface EmbeddingCacheIdentity {
  model: string
  customEmbeddingUrl?: string
  customEmbeddingModel?: string
  contextSuffix?: string
}

export function getEmbeddingCacheKey(content: string, identity: EmbeddingCacheIdentity): string {
  const customModelSuffix =
    identity.model === 'custom' && identity.customEmbeddingModel?.trim()
      ? `-${identity.customEmbeddingModel.trim()}`
      : ''
  const customEndpointSuffix =
    identity.model === 'custom' ? `@${encodeURIComponent(identity.customEmbeddingUrl?.trim() ?? '')}` : ''

  return `${content}|${identity.model}${customModelSuffix}${customEndpointSuffix}${identity.contextSuffix ?? ''}`
}
