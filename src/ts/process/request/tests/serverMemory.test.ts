import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const platformState = vi.hoisted(() => ({ isFastifyServer: true }))

vi.mock('../../../platform', async (importActual) => {
  const actual = await importActual<typeof import('../../../platform')>()
  return {
    ...actual,
    get isFastifyServer() {
      return platformState.isFastifyServer
    },
  }
})

vi.mock('../../../storage/nodeStorage', () => ({
  getNodeServerProxyAuth: async () => 'test-auth-token',
}))

import {
  cancelServerMemoryJob,
  canUseServerMemoryApi,
  listServerMemoryChunks,
  listServerMemoryJobs,
  listServerMemorySummaries,
  type ServerMemoryChunk,
  type ServerMemoryJob,
  type ServerMemorySummary,
} from '../serverMemory'

interface CapturedFetch {
  url: string
  method: string
  authHeader: string | null
}

const baseChunk: ServerMemoryChunk = {
  id: 'chunk-1',
  chatId: 'chat 1',
  messageId: 'message-1',
  rangeStartSeq: 1,
  rangeEndSeq: 4,
  text: 'chunk text',
  status: 'summarized',
  createdAt: '2026-05-25T00:00:00.000Z',
  updatedAt: '2026-05-25T00:00:00.000Z',
}

const baseSummary: ServerMemorySummary = {
  id: 'summary-1',
  chatId: 'chat 1',
  chunkId: 'chunk-1',
  model: 'model a',
  text: 'summary text',
  metadata: null,
  tokens: 7,
  createdAt: '2026-05-25T00:00:00.000Z',
}

const baseJob: ServerMemoryJob = {
  id: 'job/1',
  chatId: 'chat 1',
  kind: 'summarize',
  status: 'pending',
  payload: { chunkId: 'chunk-1' },
  error: null,
  attemptCount: 0,
  maxAttempts: 3,
  nextRunAt: '2026-05-25T00:00:00.000Z',
  createdAt: '2026-05-25T00:00:00.000Z',
  updatedAt: '2026-05-25T00:00:00.000Z',
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function makeMemoryFetch(bodyForUrl: (url: string, init: RequestInit) => unknown): {
  calls: CapturedFetch[]
  fetch: typeof fetch
} {
  const calls: CapturedFetch[] = []
  return {
    calls,
    fetch: vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const headers = init.headers as Record<string, string> | undefined
      const url = String(input)
      calls.push({
        url,
        method: init.method ?? 'GET',
        authHeader: headers?.['risu-auth'] ?? null,
      })
      const body = bodyForUrl(url, init)
      return body instanceof Response ? body : jsonResponse(body)
    }) as unknown as typeof fetch,
  }
}

beforeEach(() => {
  platformState.isFastifyServer = true
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('server memory API adapter', () => {
  it('reports availability from the Fastify platform gate', () => {
    expect(canUseServerMemoryApi()).toBe(true)
    platformState.isFastifyServer = false
    expect(canUseServerMemoryApi()).toBe(false)
  })

  it('lists chunks with the auth header and encoded chat id', async () => {
    const memoryFetch = makeMemoryFetch(() => ({ chunks: [baseChunk] }))
    vi.stubGlobal('fetch', memoryFetch.fetch)

    const result = await listServerMemoryChunks('chat 1')

    expect(result).toEqual({ status: 'ok', chunks: [baseChunk] })
    expect(memoryFetch.calls).toEqual([
      {
        url: '/api/v1/memory/chunks/chat%201',
        method: 'GET',
        authHeader: 'test-auth-token',
      },
    ])
  })

  it('lists summaries and preserves the Fastify envelope', async () => {
    const memoryFetch = makeMemoryFetch(() => ({ summaries: [baseSummary] }))
    vi.stubGlobal('fetch', memoryFetch.fetch)

    const result = await listServerMemorySummaries('chat 1', 'model a')

    expect(result).toEqual({ status: 'ok', summaries: [baseSummary] })
    expect(memoryFetch.calls[0]).toEqual({
      url: '/api/v1/memory/summaries/chat%201?model=model+a',
      method: 'GET',
      authHeader: 'test-auth-token',
    })
  })

  it('omits the summary model query when no model filter is provided', async () => {
    const memoryFetch = makeMemoryFetch(() => ({ summaries: [] }))
    vi.stubGlobal('fetch', memoryFetch.fetch)

    await listServerMemorySummaries('chat 1')

    expect(memoryFetch.calls[0].url).toBe('/api/v1/memory/summaries/chat%201')
  })

  it('lists jobs with optional route filters', async () => {
    const memoryFetch = makeMemoryFetch(() => ({ jobs: [baseJob] }))
    vi.stubGlobal('fetch', memoryFetch.fetch)

    const result = await listServerMemoryJobs({
      chatId: 'chat 1',
      kind: 'summarize',
      status: 'pending',
    })

    expect(result).toEqual({ status: 'ok', jobs: [baseJob] })
    expect(memoryFetch.calls[0]).toEqual({
      url: '/api/v1/memory/jobs?chatId=chat+1&kind=summarize&status=pending',
      method: 'GET',
      authHeader: 'test-auth-token',
    })
  })

  it('cancels jobs with DELETE and encoded job id', async () => {
    const memoryFetch = makeMemoryFetch(() => ({ job: { ...baseJob, status: 'cancelled' } }))
    vi.stubGlobal('fetch', memoryFetch.fetch)

    const result = await cancelServerMemoryJob('job/1')

    expect(result).toEqual({ status: 'ok', job: { ...baseJob, status: 'cancelled' } })
    expect(memoryFetch.calls[0]).toEqual({
      url: '/api/v1/memory/jobs/job%2F1',
      method: 'DELETE',
      authHeader: 'test-auth-token',
    })
  })

  it('returns unavailable without fetching when the Fastify gate is closed', async () => {
    platformState.isFastifyServer = false
    const memoryFetch = makeMemoryFetch(() => ({ chunks: [baseChunk] }))
    vi.stubGlobal('fetch', memoryFetch.fetch)

    const result = await listServerMemoryChunks('chat-1')

    expect(result).toEqual({ status: 'unavailable' })
    expect(memoryFetch.calls).toEqual([])
  })

  it('surfaces JSON route errors without exposing route details to callers', async () => {
    const memoryFetch = makeMemoryFetch(() => jsonResponse({ error: 'chatId is required' }, 400))
    vi.stubGlobal('fetch', memoryFetch.fetch)

    const result = await listServerMemoryJobs({ chatId: '' })

    expect(result).toEqual({ status: 'error', error: 'chatId is required' })
  })

  it('maps network failures to status:error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('socket closed')
      }),
    )

    const result = await cancelServerMemoryJob('job-1')

    expect(result).toEqual({ status: 'error', error: 'Network error: socket closed' })
  })
})
