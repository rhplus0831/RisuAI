import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'

vi.mock('../../../platform', async (importActual) => {
  const actual = await importActual<typeof import('../../../platform')>()
  return {
    ...actual,
    isFastifyServer: true,
  }
})

vi.mock('../../../storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'test-auth-token',
}))

vi.mock('../../../server/activeWriterSession', () => ({
  activeWriterSessionHeader: () => ({ 'risu-writer-session': 'writer-session-1' }),
  handleActiveWriterStaleResponse: vi.fn((response: Response) => response.status === 423),
}))

import {
  applyServerHypaV3Progress,
  cancelServerMemoryJob,
  listServerMemoryChunks,
  listServerMemoryJobs,
  listServerMemorySummaries,
  type ServerMemoryChunk,
  type ServerMemoryJob,
  type ServerMemorySummary,
} from '../serverMemory'
import { handleActiveWriterStaleResponse } from '../../../server/activeWriterSession'
import { hypaV3ProgressStore } from '../../../stores.svelte'

interface CapturedFetch {
  url: string
  method: string
  authHeader: string | null
  ifNoneMatch: string | null
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
  attemptCount: 0,
  maxAttempts: 3,
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
        ifNoneMatch: headers?.['If-None-Match'] ?? null,
      })
      const body = bodyForUrl(url, init)
      return body instanceof Response ? body : jsonResponse(body)
    }) as unknown as typeof fetch,
  }
}

beforeEach(() => {
  vi.mocked(handleActiveWriterStaleResponse).mockClear()
  hypaV3ProgressStore.set({
    open: false,
    miniMsg: '',
    msg: '',
    subMsg: '',
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('server memory API adapter', () => {
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
        ifNoneMatch: null,
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
      ifNoneMatch: null,
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
      ifNoneMatch: null,
    })
  })

  it('lists jobs with an If-None-Match validator when provided', async () => {
    const memoryFetch = makeMemoryFetch(() => jsonResponse(null, 304))
    vi.stubGlobal('fetch', memoryFetch.fetch)

    const result = await listServerMemoryJobs({
      chatId: 'chat 1',
      etag: '"jobs-etag"',
    })

    expect(result).toEqual({ status: 'not-modified' })
    expect(memoryFetch.calls[0]).toEqual({
      url: '/api/v1/memory/jobs?chatId=chat+1',
      method: 'GET',
      authHeader: 'test-auth-token',
      ifNoneMatch: '"jobs-etag"',
    })
  })

  it('cancels jobs with DELETE and encoded job id', async () => {
    const memoryFetch = makeMemoryFetch((_url, init) => {
      expect((init.headers as Record<string, string>)['risu-writer-session']).toBe('writer-session-1')
      return { job: { ...baseJob, status: 'cancelled' } }
    })
    vi.stubGlobal('fetch', memoryFetch.fetch)

    const result = await cancelServerMemoryJob('job/1')

    expect(result).toEqual({ status: 'ok', job: { ...baseJob, status: 'cancelled' } })
    expect(memoryFetch.calls[0]).toEqual({
      url: '/api/v1/memory/jobs/job%2F1',
      method: 'DELETE',
      authHeader: 'test-auth-token',
      ifNoneMatch: null,
    })
  })

  it('preserves browser-visible list/cancel job state envelopes', async () => {
    const memoryFetch = makeMemoryFetch((url, init) => {
      if (url === '/api/v1/memory/jobs?chatId=chat+1&status=running') {
        return {
          jobs: [
            {
              ...baseJob,
              status: 'running',
            },
          ],
        }
      }
      if (url === '/api/v1/memory/jobs/job%2F1' && init.method === 'DELETE') {
        return {
          job: {
            ...baseJob,
            status: 'cancelled',
          },
        }
      }
      return jsonResponse({ error: 'unexpected memory fixture call' }, 500)
    })
    vi.stubGlobal('fetch', memoryFetch.fetch)

    const listed = await listServerMemoryJobs({ chatId: 'chat 1', status: 'running' })
    const cancelled = await cancelServerMemoryJob('job/1')

    expect(listed).toEqual({
      status: 'ok',
      jobs: [
        {
          ...baseJob,
          status: 'running',
        },
      ],
    })
    expect(cancelled).toEqual({
      status: 'ok',
      job: {
        ...baseJob,
        status: 'cancelled',
      },
    })
    expect(memoryFetch.calls).toEqual([
      {
        url: '/api/v1/memory/jobs?chatId=chat+1&status=running',
        method: 'GET',
        authHeader: 'test-auth-token',
        ifNoneMatch: null,
      },
      {
        url: '/api/v1/memory/jobs/job%2F1',
        method: 'DELETE',
        authHeader: 'test-auth-token',
        ifNoneMatch: null,
      },
    ])
  })

  it('handles stale writer responses from memory mutations', async () => {
    const memoryFetch = makeMemoryFetch((_url, init) => {
      expect((init.headers as Record<string, string>)['risu-writer-session']).toBe('writer-session-1')
      return jsonResponse({ error: 'active_writer_stale' }, 423)
    })
    vi.stubGlobal('fetch', memoryFetch.fetch)

    const result = await cancelServerMemoryJob('job/1')

    expect(result).toEqual({ status: 'error', error: 'active_writer_stale' })
    expect(handleActiveWriterStaleResponse).toHaveBeenCalledTimes(1)
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

  it('applies Fastify Hypa V3 progress payloads to the browser store', () => {
    const applied = applyServerHypaV3Progress({
      open: true,
      miniMsg: '2',
      msg: '[Hypa V3] Summarizing...',
      subMsg: '2 queued',
      status: 'running',
      queuedCount: 2,
    })

    expect(applied).toBe(true)
    expect(get(hypaV3ProgressStore)).toEqual({
      open: true,
      miniMsg: '2',
      msg: '[Hypa V3] Summarizing...',
      subMsg: '2 queued',
    })
  })

  it('ignores malformed or unavailable Hypa V3 progress payloads', () => {
    hypaV3ProgressStore.set({
      open: true,
      miniMsg: '1',
      msg: 'existing',
      subMsg: 'existing sub',
    })

    expect(applyServerHypaV3Progress({ open: true, miniMsg: 1, msg: '', subMsg: '' })).toBe(false)
    expect(get(hypaV3ProgressStore)).toEqual({
      open: true,
      miniMsg: '1',
      msg: 'existing',
      subMsg: 'existing sub',
    })
  })
})
