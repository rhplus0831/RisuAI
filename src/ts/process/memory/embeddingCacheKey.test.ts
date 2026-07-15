import { describe, expect, it } from 'vitest'

import { getEmbeddingCacheKey } from './embeddingCacheKey'

describe('embedding cache identity', () => {
  it('separates custom embeddings produced by different server URLs', () => {
    const first = getEmbeddingCacheKey('same text', {
      model: 'custom',
      customEmbeddingModel: 'embed-v1',
      customEmbeddingUrl: 'https://first.example/v1',
    })
    const second = getEmbeddingCacheKey('same text', {
      model: 'custom',
      customEmbeddingModel: 'embed-v1',
      customEmbeddingUrl: 'https://second.example/v1',
    })

    expect(first).not.toBe(second)
  })

  it('normalizes surrounding endpoint whitespace while preserving existing non-custom keys', () => {
    expect(
      getEmbeddingCacheKey('same text', {
        model: 'custom',
        customEmbeddingUrl: '  https://embed.example/v1  ',
      }),
    ).toBe(getEmbeddingCacheKey('same text', { model: 'custom', customEmbeddingUrl: 'https://embed.example/v1' }))
    expect(getEmbeddingCacheKey('same text', { model: 'MiniLM' })).toBe('same text|MiniLM')
  })
})
