import { describe, expect, it } from 'vitest'
import {
  MEMORY_EMBEDDING_APPROX_CHARS_PER_TOKEN,
  MEMORY_EMBEDDING_FALLBACK_MAX_INPUT_BYTES,
  OPENAI_EMBEDDING_MAX_INPUT_TOKENS,
  OPENAI_EMBEDDING_MAX_REQUEST_TOKENS,
  VOYAGE_CONTEXTUAL_MAX_CONTEXT_CHUNK_TOKENS,
  VOYAGE_CONTEXTUAL_MAX_CONTEXT_TOKENS,
  VOYAGE_CONTEXTUAL_MAX_CHUNKS,
  VOYAGE_CONTEXTUAL_MAX_REQUEST_TOKENS,
  findMemoryEmbeddingLimitViolation,
  formatMemoryEmbeddingLimitViolation,
  resolveMemoryEmbeddingModel,
  type MemoryEmbeddingSettings,
} from '../src/memoryEmbeddingModel.js'

function db(overrides: MemoryEmbeddingSettings & Record<string, unknown>): MemoryEmbeddingSettings {
  return overrides
}

describe('memory embedding model resolver', () => {
  it('resolves OpenAI-backed Hypa V3 embedding aliases', () => {
    const result = resolveMemoryEmbeddingModel(db({ hypaModel: 'openai3small', hypaV3Key: ' sk-test ' }))

    expect(result).toEqual({
      ok: true,
      request: {
        provider: 'openai-compatible',
        model: 'text-embedding-3-small',
        wireModel: 'text-embedding-3-small',
        endpoint: 'https://api.openai.com/v1/embeddings',
        apiKey: 'sk-test',
        limits: {
          source: 'provider',
          maxInputTokens: OPENAI_EMBEDDING_MAX_INPUT_TOKENS,
          maxInputBytes: OPENAI_EMBEDDING_MAX_INPUT_TOKENS * MEMORY_EMBEDDING_APPROX_CHARS_PER_TOKEN,
          maxRequestTokens: OPENAI_EMBEDDING_MAX_REQUEST_TOKENS,
        },
      },
    })
  })

  it('keeps memory embeddings on Hypa fields despite memory role overrides', () => {
    const result = resolveMemoryEmbeddingModel(
      db({
        hypaModel: 'openai3small',
        hypaV3Key: ' embed-key ',
        subModel: 'conflicting-submodel',
        modelRoles: { memory: 'gpt41-mini' },
        seperateModelsForAxModels: true,
        seperateModels: { memory: 'claude-3-5-sonnet-latest' },
      }),
    )

    expect(result).toEqual({
      ok: true,
      request: {
        provider: 'openai-compatible',
        model: 'text-embedding-3-small',
        wireModel: 'text-embedding-3-small',
        endpoint: 'https://api.openai.com/v1/embeddings',
        apiKey: 'embed-key',
        limits: {
          source: 'provider',
          maxInputTokens: OPENAI_EMBEDDING_MAX_INPUT_TOKENS,
          maxInputBytes: OPENAI_EMBEDDING_MAX_INPUT_TOKENS * MEMORY_EMBEDDING_APPROX_CHARS_PER_TOKEN,
          maxRequestTokens: OPENAI_EMBEDDING_MAX_REQUEST_TOKENS,
        },
      },
    })
  })

  it('uses the requested model instead of auto database selection', () => {
    const result = resolveMemoryEmbeddingModel(db({ hypaModel: 'MiniLM', hypaV3Key: 'sk-test' }), 'openai3large')

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
        model: 'custom',
        wireModel: 'custom-model',
        endpoint: 'https://embeddings.example.test/v1/embeddings',
        apiKey: 'custom-key',
        limits: {
          source: 'fallback',
          maxInputBytes: MEMORY_EMBEDDING_FALLBACK_MAX_INPUT_BYTES,
        },
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
        limits: {
          source: 'fallback',
          maxInputBytes: MEMORY_EMBEDDING_FALLBACK_MAX_INPUT_BYTES,
        },
      },
    })
  })

  it('requires a custom embedding URL', () => {
    expect(
      resolveMemoryEmbeddingModel(db({ hypaModel: 'custom', hypaCustomSettings: { url: '', key: '', model: '' } })),
    ).toEqual({ ok: false, error: 'custom embedding model requires a server URL' })
  })

  it('resolves Voyage contextual embeddings with explicit credentials', () => {
    expect(resolveMemoryEmbeddingModel(db({ hypaModel: 'voyageContext3', voyageApiKey: ' voyage-key ' }))).toEqual({
      ok: true,
      request: {
        provider: 'voyage-contextual',
        model: 'voyage-context-3',
        wireModel: 'voyage-context-3',
        endpoint: 'https://api.voyageai.com/v1/contextualizedembeddings',
        apiKey: 'voyage-key',
        limits: {
          source: 'provider',
          maxInputTokens: VOYAGE_CONTEXTUAL_MAX_CONTEXT_CHUNK_TOKENS,
          maxInputBytes: VOYAGE_CONTEXTUAL_MAX_CONTEXT_CHUNK_TOKENS * MEMORY_EMBEDDING_APPROX_CHARS_PER_TOKEN,
          maxRequestTokens: VOYAGE_CONTEXTUAL_MAX_REQUEST_TOKENS,
          maxRequestChunks: VOYAGE_CONTEXTUAL_MAX_CHUNKS,
          contextualWindowTokens: VOYAGE_CONTEXTUAL_MAX_CONTEXT_TOKENS,
        },
      },
    })
  })

  it('resolves Voyage Context 4 through the contextualized embeddings endpoint', () => {
    expect(
      resolveMemoryEmbeddingModel(db({ hypaModel: 'voyageContext4', voyageApiKey: ' voyage-key ' })),
    ).toMatchObject({
      ok: true,
      request: {
        provider: 'voyage-contextual',
        model: 'voyage-context-4',
        wireModel: 'voyage-context-4',
        endpoint: 'https://api.voyageai.com/v1/contextualizedembeddings',
        apiKey: 'voyage-key',
      },
    })
  })

  it('formats per-input size violations with the offending bound', () => {
    const result = resolveMemoryEmbeddingModel(
      db({
        hypaModel: 'custom',
        hypaCustomSettings: {
          url: 'https://embeddings.example.test/v1',
          key: '',
          model: '',
        },
      }),
    )

    expect(result.ok).toBe(true)
    if (result.ok === false) return
    const violation = findMemoryEmbeddingLimitViolation(
      result.request,
      ['x'.repeat(MEMORY_EMBEDDING_FALLBACK_MAX_INPUT_BYTES + 1)],
      () => 'memory embedding chunk chunk-1',
    )
    expect(violation).toMatchObject({
      bound: 'maxInputBytes',
      actual: MEMORY_EMBEDDING_FALLBACK_MAX_INPUT_BYTES + 1,
      limit: MEMORY_EMBEDDING_FALLBACK_MAX_INPUT_BYTES,
    })
    expect(formatMemoryEmbeddingLimitViolation(violation!)).toBe(
      `memory embedding chunk chunk-1 exceeds maxInputBytes: ${
        MEMORY_EMBEDDING_FALLBACK_MAX_INPUT_BYTES + 1
      } bytes > ${MEMORY_EMBEDDING_FALLBACK_MAX_INPUT_BYTES} bytes`,
    )
  })

  it('rejects browser-local models and requires Voyage credentials', () => {
    expect(resolveMemoryEmbeddingModel(db({ hypaModel: 'MiniLM' }))).toEqual({
      ok: false,
      error: 'server-side memory embeddings do not support browser-local model MiniLM',
    })
    expect(resolveMemoryEmbeddingModel(db({ hypaModel: 'voyageContext3' }))).toEqual({
      ok: false,
      error: 'voyage-context-3 requires a Voyage API key',
    })
    expect(resolveMemoryEmbeddingModel(db({ hypaModel: 'voyageContext4' }))).toEqual({
      ok: false,
      error: 'voyage-context-4 requires a Voyage API key',
    })
  })
})
