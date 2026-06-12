import { afterEach, describe, expect, it, vi } from 'vitest'
import { embedTextGroups, embedTexts } from '../src/memoryEmbeddingAdapter.js'
import {
  MEMORY_EMBEDDING_APPROX_CHARS_PER_TOKEN,
  VOYAGE_CONTEXT3_MAX_CONTEXT_CHUNK_TOKENS,
  VOYAGE_CONTEXTUAL_MAX_CONTEXT_TOKENS,
  VOYAGE_CONTEXTUAL_MAX_CHUNKS,
  VOYAGE_CONTEXTUAL_MAX_REQUEST_TOKENS,
  type MemoryEmbeddingModelRequest,
} from '../src/memoryEmbeddingModel.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

function request(overrides: Partial<MemoryEmbeddingModelRequest> = {}): MemoryEmbeddingModelRequest {
  return {
    provider: 'openai-compatible',
    model: 'text-embedding-3-small',
    wireModel: 'text-embedding-3-small',
    endpoint: 'https://api.openai.test/v1/embeddings',
    apiKey: 'sk-test',
    ...overrides,
  }
}

function voyageRequest(overrides: Partial<MemoryEmbeddingModelRequest> = {}): MemoryEmbeddingModelRequest {
  return request({
    provider: 'voyage-contextual',
    model: 'voyage-context-3',
    wireModel: 'voyage-context-3',
    endpoint: 'https://api.voyageai.com/v1/contextualizedembeddings',
    limits: {
      source: 'provider',
      maxInputTokens: VOYAGE_CONTEXT3_MAX_CONTEXT_CHUNK_TOKENS,
      maxInputBytes: VOYAGE_CONTEXT3_MAX_CONTEXT_CHUNK_TOKENS * MEMORY_EMBEDDING_APPROX_CHARS_PER_TOKEN,
      maxRequestTokens: VOYAGE_CONTEXTUAL_MAX_REQUEST_TOKENS,
      maxRequestChunks: VOYAGE_CONTEXTUAL_MAX_CHUNKS,
      contextualWindowTokens: VOYAGE_CONTEXTUAL_MAX_CONTEXT_TOKENS,
    },
    ...overrides,
  })
}

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function bad(body: unknown, status = 400): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('memory embedding provider adapter', () => {
  it('calls an OpenAI-compatible embeddings endpoint and normalizes vectors', async () => {
    let captured: { url: string; init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      captured = { url, init }
      return ok({
        data: [
          { index: 1, embedding: [3, 4] },
          { index: 0, embedding: [1, 2] },
        ],
      })
    })

    const result = await embedTexts({
      request: request(),
      input: ['first', 'second'],
      signal: new AbortController().signal,
    })

    expect(result).toMatchObject({ model: 'text-embedding-3-small', dim: 2 })
    expect('vectors' in result ? result.vectors.map((v) => Array.from(v)) : []).toEqual([
      [1, 2],
      [3, 4],
    ])
    expect(captured!.url).toBe('https://api.openai.test/v1/embeddings')
    expect((captured!.init.headers as Record<string, string>).authorization).toBe('Bearer sk-test')
    expect(JSON.parse(captured!.init.body as string)).toEqual({
      input: ['first', 'second'],
      model: 'text-embedding-3-small',
    })
  })

  it('omits authorization and model for custom endpoints without credentials or model ids', async () => {
    let captured: { headers: Record<string, string>; body: unknown } | null = null
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = {
        headers: init.headers as Record<string, string>,
        body: JSON.parse(init.body as string),
      }
      return ok({ data: [{ embedding: [1] }] })
    })

    const result = await embedTexts({
      request: request({
        provider: 'custom',
        model: 'custom',
        wireModel: undefined,
        apiKey: undefined,
      }),
      input: ['first'],
      signal: new AbortController().signal,
    })

    expect(result).toMatchObject({ model: 'custom', dim: 1 })
    expect(captured!.headers.authorization).toBeUndefined()
    expect(captured!.body).toEqual({ input: ['first'] })
  })

  it('normalizes upstream failures into typed adapter errors', async () => {
    vi.stubGlobal('fetch', async () => bad({ error: { message: 'nope' } }))

    await expect(
      embedTexts({
        request: request(),
        input: ['first'],
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ error: 'nope', code: 'upstream' })
  })

  it('treats aborted calls as adapter errors before fetching', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const controller = new AbortController()
    controller.abort()

    await expect(
      embedTexts({
        request: request(),
        input: ['first'],
        signal: controller.signal,
      }),
    ).resolves.toEqual({ error: 'aborted', code: 'aborted' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('L21: rejects oversized inputs before constructing an embedding request body', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)

    await expect(
      embedTexts({
        request: request({
          limits: {
            source: 'fallback',
            maxInputBytes: 4,
          },
        }),
        input: ['abcde'],
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({
      error: 'embedding input 0 exceeds maxInputBytes: 5 bytes > 4 bytes',
      code: 'configuration',
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('validates response count and vector dimensions', async () => {
    vi.stubGlobal('fetch', async () =>
      ok({
        data: [{ embedding: [1, 2] }, { embedding: [3] }],
      }),
    )

    await expect(
      embedTexts({
        request: request(),
        input: ['first', 'second'],
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({
      error: 'embedding dimension mismatch: expected 2, got 1',
      code: 'dimension-mismatch',
    })
  })

  it('validates expected dimensions supplied by callers', async () => {
    vi.stubGlobal('fetch', async () => ok({ data: [{ embedding: [1, 2] }] }))

    await expect(
      embedTexts({
        request: request(),
        input: ['first'],
        expectedDim: 3,
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({
      error: 'embedding dimension mismatch: expected 3, got 2',
      code: 'dimension-mismatch',
    })
  })

  it('rejects malformed vectors with non-finite values', async () => {
    vi.stubGlobal('fetch', async () => ok({ data: [{ embedding: [1, Number.NaN] }] }))

    await expect(
      embedTexts({
        request: request(),
        input: ['first'],
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({
      error: 'embedding vector values must be finite numbers',
      code: 'invalid-response',
    })
  })

  it('calls Voyage contextual embeddings with grouped document inputs', async () => {
    let captured: { url: string; headers: Record<string, string>; body: unknown } | null = null
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      captured = {
        url,
        headers: init.headers as Record<string, string>,
        body: JSON.parse(init.body as string),
      }
      return ok({
        data: [
          {
            data: [{ embedding: [1, 2] }, { embedding: [3, 4] }],
          },
        ],
      })
    })

    const result = await embedTextGroups({
      request: voyageRequest(),
      groups: [['first', 'second']],
      signal: new AbortController().signal,
    })

    expect(result).toMatchObject({ model: 'voyage-context-3', dim: 2 })
    expect('groups' in result ? result.groups[0].map((v) => Array.from(v)) : []).toEqual([
      [1, 2],
      [3, 4],
    ])
    expect(captured).toEqual({
      url: 'https://api.voyageai.com/v1/contextualizedembeddings',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer sk-test',
      },
      body: {
        inputs: [['first', 'second']],
        model: 'voyage-context-3',
        input_type: 'document',
      },
    })
  })

  it('validates Voyage contextual response shape', async () => {
    vi.stubGlobal('fetch', async () =>
      ok({
        data: [
          {
            data: [{ embedding: [1, 2] }],
          },
        ],
      }),
    )

    await expect(
      embedTextGroups({
        request: voyageRequest(),
        groups: [['first', 'second']],
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({
      error: 'embedding response count mismatch: expected 2, got 1',
      code: 'invalid-response',
    })
  })

  it('L22: rejects grouped contextual inputs when the request has no context limit', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)

    await expect(
      embedTextGroups({
        request: request({
          provider: 'voyage-contextual',
          model: 'voyage-context-3',
          wireModel: 'voyage-context-3',
          limits: undefined,
        }),
        groups: [['first', 'second']],
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({
      error:
        'contextual embedding model voyage-context-3 is missing contextualWindowTokens; refusing to send grouped contextual inputs',
      code: 'configuration',
    })
    expect(fetch).not.toHaveBeenCalled()
  })
})
