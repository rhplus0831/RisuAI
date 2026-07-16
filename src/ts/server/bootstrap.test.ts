import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'bootstrap-auth-token',
}))

import { fetchServerBootstrap, fetchServerBootstrapReadOnly } from './bootstrap'
import { ACTIVE_WRITER_SESSION_HEADER } from './activeWriterSession'
import { clearCachedServerCommandRevision, peekCachedServerCommandRevision } from './commands'

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

function stubBootstrapFetch(body: unknown | (() => unknown)): CapturedFetch[] {
  const calls: CapturedFetch[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const headers = init.headers as Record<string, string> | undefined
      calls.push({
        url: String(input),
        method: init.method ?? 'GET',
        authHeader: headers?.['risu-auth'] ?? null,
        writerSessionHeader: headers?.[ACTIVE_WRITER_SESSION_HEADER] ?? null,
      })
      const value = typeof body === 'function' ? body() : body
      return value instanceof Response ? value : jsonResponse(value)
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

describe('server runtime bootstrap helper', () => {
  it('fetches runtime metadata with auth, registers the writer, and caches revision', async () => {
    const calls = stubBootstrapFetch({
      initialized: true,
      revision: 12,
      schemaVersion: 17,
      assetBaseUrl: '/api/v1/assets',
      requestedWriterWasActive: true,
      databaseLineage: 'database-a',
      writerEpoch: 3,
      activeGenerationJobs: [{ chatId: 'chat-a', jobId: 'job-a', mode: 'continue' }],
      activeMessageTranslations: [{ chatId: 'chat-a', messageId: 'message-a' }],
    })

    await expect(fetchServerBootstrap()).resolves.toEqual({
      status: 'ok',
      bootstrap: {
        initialized: true,
        revision: 12,
        schemaVersion: 17,
        assetBaseUrl: '/api/v1/assets',
        requestedWriterWasActive: true,
        databaseLineage: 'database-a',
        writerEpoch: 3,
        activeGenerationJobs: [{ chatId: 'chat-a', jobId: 'job-a', mode: 'continue' }],
        activeMessageTranslations: [{ chatId: 'chat-a', messageId: 'message-a' }],
      },
    })
    expect(peekCachedServerCommandRevision()).toBe(12)
    expect(calls).toEqual([
      {
        url: '/api/v1/bootstrap',
        method: 'GET',
        authHeader: 'bootstrap-auth-token',
        writerSessionHeader: expect.any(String),
      },
    ])
  })

  it('performs read-only bootstrap without writer ownership or optional revision caching', async () => {
    const calls = stubBootstrapFetch({
      initialized: false,
      revision: 0,
      databaseLineage: 'database-a',
      writerEpoch: 3,
    })

    await expect(fetchServerBootstrapReadOnly(null, { cacheRevision: false })).resolves.toEqual({
      status: 'ok',
      bootstrap: {
        initialized: false,
        revision: 0,
        schemaVersion: undefined,
        assetBaseUrl: undefined,
        requestedWriterWasActive: undefined,
        databaseLineage: 'database-a',
        writerEpoch: 3,
        activeGenerationJobs: [],
        activeMessageTranslations: [],
      },
    })
    expect(peekCachedServerCommandRevision()).toBeNull()
    expect(calls[0].writerSessionHeader).toBeNull()
  })

  it('drops malformed runtime job entries', async () => {
    stubBootstrapFetch({
      initialized: true,
      revision: 3,
      activeGenerationJobs: [
        { chatId: 'chat-a', jobId: 'job-a', mode: 'regenerate', regenerateMessageId: 'message-a' },
        { chatId: 'chat-b' },
        'invalid',
      ],
      activeMessageTranslations: [{ chatId: 'chat-a', messageId: 'message-a' }, { chatId: 'chat-b' }, null],
    })

    const result = await fetchServerBootstrap()
    expect(result).toMatchObject({ status: 'ok' })
    if (result.status !== 'ok') return
    expect(result.bootstrap.activeGenerationJobs).toEqual([
      { chatId: 'chat-a', jobId: 'job-a', mode: 'regenerate', regenerateMessageId: 'message-a' },
    ])
    expect(result.bootstrap.activeMessageTranslations).toEqual([{ chatId: 'chat-a', messageId: 'message-a' }])
  })

  it('maps HTTP failures and network failures to status:error', async () => {
    stubBootstrapFetch(jsonResponse({ error: 'missing_auth' }, 401))
    await expect(fetchServerBootstrap()).resolves.toEqual({ status: 'error', error: 'missing_auth' })

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new Error('offline'))),
    )
    await expect(fetchServerBootstrap()).resolves.toEqual({ status: 'error', error: 'Network error: offline' })
  })

  it('requires initialized and a non-negative integer revision', async () => {
    stubBootstrapFetch({ revision: 1 })
    await expect(fetchServerBootstrap()).resolves.toEqual({
      status: 'error',
      error: 'Invalid bootstrap initialization state',
    })

    vi.unstubAllGlobals()
    stubBootstrapFetch({ initialized: true, revision: 'invalid' })
    await expect(fetchServerBootstrap()).resolves.toEqual({ status: 'error', error: 'Invalid bootstrap revision' })
  })
})
