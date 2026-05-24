import { afterEach, describe, expect, it, vi } from 'vitest'
import { embedTexts } from '../src/memoryEmbeddingAdapter.js'
import type { MemoryEmbeddingModelRequest } from '../src/memoryEmbeddingModel.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

function request(
  overrides: Partial<MemoryEmbeddingModelRequest> = {},
): MemoryEmbeddingModelRequest {
  return {
    provider: 'openai-compatible',
    model: 'text-embedding-3-small',
    wireModel: 'text-embedding-3-small',
    endpoint: 'https://api.openai.test/v1/embeddings',
    apiKey: 'sk-test',
    ...overrides,
  }
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
})
