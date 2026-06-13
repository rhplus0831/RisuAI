import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../platform', () => ({ isFastifyServer: true }))

vi.mock('../storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'bootstrap-auth-token',
}))

import {
  canUseServerBootstrap,
  fetchServerBootstrapProjection,
  fetchServerBootstrapProjectionReadOnly,
} from './bootstrap'
import { ACTIVE_WRITER_SESSION_HEADER } from './activeWriterSession'
import { BODY_CACHE_MANIFEST_HEADER } from './bootstrapBodyCache'
import {
  clearCachedServerCommandRevision,
  getServerCommandBaseRevision,
  peekCachedServerCommandRevision,
} from './commands'

interface CapturedFetch {
  url: string
  method: string
  authHeader: string | null
  writerSessionHeader: string | null
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function stubBootstrapFetch(bodyForUrl: (url: string) => unknown): CapturedFetch[] {
  const calls: CapturedFetch[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const headers = init.headers as Record<string, string> | undefined
      const url = String(input)
      calls.push({
        url,
        method: init.method ?? 'GET',
        authHeader: headers?.['risu-auth'] ?? null,
        writerSessionHeader: headers?.[ACTIVE_WRITER_SESSION_HEADER] ?? null,
      })
      const body = bodyForUrl(url)
      return body instanceof Response ? body : jsonResponse(body)
    }) as unknown as typeof fetch,
  )
  return calls
}

beforeEach(() => {
  clearCachedServerCommandRevision()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('server bootstrap projection helper', () => {
  it('reports availability unconditionally', () => {
    expect(canUseServerBootstrap()).toBe(true)
  })

  it('fetches the projection with auth and caches the command revision', async () => {
    const database = {
      characters: [{ chaId: 'char-a', name: 'Ada', chats: [] }],
      language: 'en',
    }
    const calls = stubBootstrapFetch(() => ({
      revision: 12,
      schemaVersion: 3,
      database,
      assetBaseUrl: '/api/v1/assets',
    }))

    await expect(fetchServerBootstrapProjection()).resolves.toEqual({
      status: 'ok',
      projection: {
        revision: 12,
        schemaVersion: 3,
        database,
        assetBaseUrl: '/api/v1/assets',
        activeGenerationJobs: [],
      },
    })
    await expect(getServerCommandBaseRevision()).resolves.toBe(12)

    expect(calls).toEqual([
      {
        url: '/api/v1/bootstrap',
        method: 'GET',
        authHeader: 'bootstrap-auth-token',
        writerSessionHeader: expect.any(String),
      },
    ])
  })

  it('fetches read-only refresh projections without registering active writer ownership', async () => {
    const calls = stubBootstrapFetch(() => ({
      revision: 13,
      database: { characters: [], language: 'en' },
    }))

    await expect(fetchServerBootstrapProjectionReadOnly()).resolves.toMatchObject({
      status: 'ok',
      projection: { revision: 13 },
    })

    expect(calls).toEqual([
      {
        url: '/api/v1/bootstrap',
        method: 'GET',
        authHeader: 'bootstrap-auth-token',
        writerSessionHeader: null,
      },
    ])
    await expect(getServerCommandBaseRevision()).resolves.toBe(13)
  })

  it('can fetch a read-only projection without caching its revision', async () => {
    stubBootstrapFetch(() => ({
      revision: 14,
      database: { characters: [], language: 'en' },
    }))

    await expect(fetchServerBootstrapProjectionReadOnly(null, { cacheRevision: false })).resolves.toMatchObject({
      status: 'ok',
      projection: { revision: 14 },
    })

    expect(peekCachedServerCommandRevision()).toBeNull()
  })

  it('maps bootstrap HTTP errors to status:error', async () => {
    stubBootstrapFetch(() => jsonResponse({ error: 'missing_auth' }, 401))

    await expect(fetchServerBootstrapProjection()).resolves.toEqual({
      status: 'error',
      error: 'missing_auth',
    })
  })

  it('rejects malformed bootstrap projections', async () => {
    stubBootstrapFetch(() => ({ revision: 'not-a-number', database: {} }))

    await expect(fetchServerBootstrapProjection()).resolves.toEqual({
      status: 'error',
      error: 'Invalid bootstrap revision',
    })
  })

  it('parses activeGenerationJobs and drops malformed entries (Phase 7)', async () => {
    stubBootstrapFetch(() => ({
      revision: 3,
      database: {},
      activeGenerationJobs: [
        { chatId: 'chat-a', jobId: 'job-a' },
        { chatId: 'chat-b' }, // missing jobId → dropped
        { jobId: 'job-c' }, // missing chatId → dropped
        'nonsense', // not an object → dropped
        { chatId: 'chat-d', jobId: 'job-d' },
      ],
    }))

    const result = await fetchServerBootstrapProjection()
    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      expect(result.projection.activeGenerationJobs).toEqual([
        { chatId: 'chat-a', jobId: 'job-a' },
        { chatId: 'chat-d', jobId: 'job-d' },
      ])
    }
  })

  it('reconstructs module and plugin bodies from the local bootstrap body cache', async () => {
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        storage.set(key, value)
      }),
      removeItem: vi.fn((key: string) => {
        storage.delete(key)
      }),
      clear: vi.fn(() => storage.clear()),
      key: vi.fn((index: number) => Array.from(storage.keys())[index] ?? null),
      get length() {
        return storage.size
      },
    })

    const headers: Array<Record<string, string>> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init: RequestInit = {}) => {
        const requestHeaders = (init.headers as Record<string, string> | undefined) ?? {}
        headers.push(requestHeaders)
        const hasManifest = typeof requestHeaders[BODY_CACHE_MANIFEST_HEADER] === 'string'
        return jsonResponse({
          revision: hasManifest ? 2 : 1,
          database: {
            characters: [],
            modules: [{ id: 'module-a', name: 'Module A' }],
            plugins: [{ name: 'plugin-a', arguments: {}, realArg: {}, customLink: [], argMeta: {}, enabled: false }],
          },
          bodyCache: {
            epoch: 7,
            modules: [
              {
                id: 'module-a',
                revision: 11,
                ...(hasManifest ? {} : { body: { id: 'module-a', name: 'Old Name', lorebook: [{ content: 'body' }] } }),
              },
            ],
            plugins: [
              {
                id: 'plugin-a',
                revision: 12,
                ...(hasManifest ? {} : { body: { name: 'plugin-a', script: 'Risuai.log("body")' } }),
              },
            ],
          },
        })
      }) as unknown as typeof fetch,
    )

    const first = await fetchServerBootstrapProjection()
    expect(first.status).toBe('ok')
    if (first.status === 'ok') {
      expect(first.projection.database?.modules[0]).toMatchObject({
        id: 'module-a',
        name: 'Module A',
        lorebook: [{ content: 'body' }],
      })
      expect(first.projection.database?.plugins[0]).toMatchObject({
        name: 'plugin-a',
        script: 'Risuai.log("body")',
        enabled: false,
      })
    }
    expect(headers[0][BODY_CACHE_MANIFEST_HEADER]).toBeUndefined()

    const second = await fetchServerBootstrapProjectionReadOnly()
    expect(second.status).toBe('ok')
    if (second.status === 'ok') {
      expect(second.projection.database?.modules[0]).toMatchObject({
        id: 'module-a',
        name: 'Module A',
        lorebook: [{ content: 'body' }],
      })
      expect(second.projection.database?.plugins[0]).toMatchObject({
        name: 'plugin-a',
        script: 'Risuai.log("body")',
        enabled: false,
      })
    }

    expect(JSON.parse(decodeURIComponent(headers[1][BODY_CACHE_MANIFEST_HEADER]))).toEqual({
      epoch: 7,
      modules: { 'module-a': 11 },
      plugins: { 'plugin-a': 12 },
    })
  })
})
