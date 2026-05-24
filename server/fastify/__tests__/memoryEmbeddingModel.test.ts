import { describe, expect, it } from 'vitest'
import type { Database } from '../../../src/ts/storage/database.svelte'
import { resolveMemoryEmbeddingModel } from '../src/memoryEmbeddingModel.js'

function db(overrides: Partial<Database>): Database {
  return overrides as Database
}

describe('memory embedding model resolver', () => {
  it('resolves OpenAI-backed Hypa V3 embedding aliases', () => {
    const result = resolveMemoryEmbeddingModel(
      db({ hypaModel: 'openai3small', hypaV3Key: ' sk-test ' }),
    )

    expect(result).toEqual({
      ok: true,
      request: {
        provider: 'openai-compatible',
        model: 'text-embedding-3-small',
        wireModel: 'text-embedding-3-small',
        endpoint: 'https://api.openai.com/v1/embeddings',
        apiKey: 'sk-test',
      },
    })
  })

  it('uses the requested model instead of auto database selection', () => {
    const result = resolveMemoryEmbeddingModel(
      db({ hypaModel: 'MiniLM', hypaV3Key: 'sk-test' }),
      'openai3large',
    )

    expect(result).toMatchObject({
      ok: true,
      request: {
        model: 'text-embedding-3-large',
        wireModel: 'text-embedding-3-large',
      },
    })
  })

  it('requires a Hypa V3 key for OpenAI-backed embedding models', () => {
    expect(resolveMemoryEmbeddingModel(db({ hypaModel: 'ada', hypaV3Key: ' ' }))).toEqual({
      ok: false,
      error: 'text-embedding-ada-002 requires a Hypa V3 API key',
    })
  })

  it('resolves custom embedding endpoints and optional credentials', () => {
    const result = resolveMemoryEmbeddingModel(
      db({
        hypaModel: 'custom',
        hypaCustomSettings: {
          url: ' https://embeddings.example.test/v1 ',
          key: ' custom-key ',
          model: ' custom-model ',
        },
      }),
    )

    expect(result).toEqual({
      ok: true,
      request: {
        provider: 'custom',
        model: 'custom-model',
        wireModel: 'custom-model',
        endpoint: 'https://embeddings.example.test/v1/embeddings',
        apiKey: 'custom-key',
      },
    })
  })

  it('does not append embeddings twice for custom endpoint URLs', () => {
    const result = resolveMemoryEmbeddingModel(
      db({
        hypaModel: 'custom',
        hypaCustomSettings: {
          url: 'https://embeddings.example.test/v1/embeddings/',
          key: '',
          model: '',
        },
      }),
    )

    expect(result).toEqual({
      ok: true,
      request: {
        provider: 'custom',
        model: 'custom',
        endpoint: 'https://embeddings.example.test/v1/embeddings',
      },
    })
  })

  it('requires a custom embedding URL', () => {
    expect(
      resolveMemoryEmbeddingModel(
        db({ hypaModel: 'custom', hypaCustomSettings: { url: '', key: '', model: '' } }),
      ),
    ).toEqual({ ok: false, error: 'custom embedding model requires a server URL' })
  })

  it('rejects browser-local and deferred contextual embedding models', () => {
    expect(resolveMemoryEmbeddingModel(db({ hypaModel: 'MiniLM' }))).toEqual({
      ok: false,
      error: 'server-side memory embeddings do not support browser-local model MiniLM',
    })
    expect(resolveMemoryEmbeddingModel(db({ hypaModel: 'voyageContext3' }))).toEqual({
      ok: false,
      error: 'voyage-context-3 contextual embeddings are deferred to slice 8-5c',
    })
  })
})
