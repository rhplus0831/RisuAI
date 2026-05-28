import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const platformState = vi.hoisted(() => ({ isFastifyServer: true }))

vi.mock('../platform', async (importActual) => {
  const actual = await importActual<typeof import('../platform')>()
  return {
    ...actual,
    get isFastifyServer() {
      return platformState.isFastifyServer
    },
  }
})

vi.mock('../storage/nodeStorage', () => ({
  getNodeServerProxyAuth: async () => 'bootstrap-auth-token',
}))

import {
  canUseServerBootstrap,
  fetchServerBootstrapProjection,
  fetchServerBootstrapProjectionReadOnly,
} from './bootstrap'
import { ACTIVE_WRITER_SESSION_HEADER } from './activeWriterSession'
import { clearCachedServerCommandRevision, getServerCommandBaseRevision } from './commands'

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
  platformState.isFastifyServer = true
  clearCachedServerCommandRevision()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('server bootstrap projection helper', () => {
  it('reports availability from the Fastify platform gate', async () => {
    expect(canUseServerBootstrap()).toBe(true)
    platformState.isFastifyServer = false
    expect(canUseServerBootstrap()).toBe(false)
    await expect(fetchServerBootstrapProjection()).resolves.toEqual({ status: 'unavailable' })
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
})
