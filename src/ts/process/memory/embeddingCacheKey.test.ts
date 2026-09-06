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

  it('separates delimiters in content from delimiters in custom model identity', () => {
    const endpoint = 'https://embed.example/v1'
    const delimiterInModel = getEmbeddingCacheKey('a', {
      model: 'custom',
      customEmbeddingModel: 'x|custom-y',
      customEmbeddingUrl: endpoint,
    })
    const delimiterInContent = getEmbeddingCacheKey('a|custom-x', {
      model: 'custom',
      customEmbeddingModel: 'y',
      customEmbeddingUrl: endpoint,
    })

    expect(delimiterInModel).not.toBe(delimiterInContent)
  })

  it('normalizes surrounding endpoint whitespace and preserves model and input identity', () => {
    expect(
      getEmbeddingCacheKey('same text', {
        model: 'custom',
        customEmbeddingUrl: '  https://embed.example/v1  ',
      }),
    ).toBe(getEmbeddingCacheKey('same text', { model: 'custom', customEmbeddingUrl: 'https://embed.example/v1' }))

    const key = getEmbeddingCacheKey('same text', { model: 'MiniLM' })
    expect(key).toBe(getEmbeddingCacheKey('same text', { model: 'MiniLM' }))
    expect(key).not.toBe(getEmbeddingCacheKey('different text', { model: 'MiniLM' }))
    expect(key).not.toBe(getEmbeddingCacheKey('same text', { model: 'custom' }))
  })
})
