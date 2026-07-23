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
  deleteServerMemorySummary,
  listServerMemoryChunks,
  listServerMemoryJobs,
  listServerMemorySummaries,
  patchServerMemorySummary,
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
        url: '/api/v1/memory/chunks/chat%201?limit=200',
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
      url: '/api/v1/memory/summaries/chat%201?model=model+a&limit=200',
      method: 'GET',
      authHeader: 'test-auth-token',
      ifNoneMatch: null,
    })
  })

  it('omits the summary model query when no model filter is provided', async () => {
    const memoryFetch = makeMemoryFetch(() => ({ summaries: [] }))
    vi.stubGlobal('fetch', memoryFetch.fetch)

    await listServerMemorySummaries('chat 1')

    expect(memoryFetch.calls[0].url).toBe('/api/v1/memory/summaries/chat%201?limit=200')
  })

  it('drains memory chunk pages and supports a terminal legacy response', async () => {
    const secondChunk = { ...baseChunk, id: 'chunk-2', rangeStartSeq: 5, rangeEndSeq: 8 }
    const memoryFetch = makeMemoryFetch((url) => {
      if (url.endsWith('?limit=200')) return { chunks: [baseChunk], nextCursor: 'chunk-cursor-1' }
      if (url.endsWith('?limit=200&cursor=chunk-cursor-1')) return { chunks: [secondChunk], nextCursor: null }
      return jsonResponse({ error: 'unexpected page' }, 500)
    })
    vi.stubGlobal('fetch', memoryFetch.fetch)

    await expect(listServerMemoryChunks('chat 1')).resolves.toEqual({
      status: 'ok',
      chunks: [baseChunk, secondChunk],
    })
    expect(memoryFetch.calls.map((call) => call.url)).toEqual([
      '/api/v1/memory/chunks/chat%201?limit=200',
      '/api/v1/memory/chunks/chat%201?limit=200&cursor=chunk-cursor-1',
    ])

    const legacyFetch = makeMemoryFetch(() => ({ chunks: [baseChunk] }))
    vi.stubGlobal('fetch', legacyFetch.fetch)
    await expect(listServerMemoryChunks('chat 1')).resolves.toEqual({ status: 'ok', chunks: [baseChunk] })
    expect(legacyFetch.calls).toHaveLength(1)
  })

  it('propagates summary filters across pages and rejects repeated cursors', async () => {
    const secondSummary = { ...baseSummary, id: 'summary-2' }
    const memoryFetch = makeMemoryFetch((url) => {
      if (url.endsWith('model=model+a&limit=200')) {
        return { summaries: [baseSummary], nextCursor: 'summary-cursor-1' }
      }
      if (url.endsWith('model=model+a&limit=200&cursor=summary-cursor-1')) {
        return { summaries: [secondSummary], nextCursor: null }
      }
      return jsonResponse({ error: 'unexpected page' }, 500)
    })
    vi.stubGlobal('fetch', memoryFetch.fetch)

    await expect(listServerMemorySummaries('chat 1', 'model a')).resolves.toEqual({
      status: 'ok',
      summaries: [baseSummary, secondSummary],
    })
    expect(memoryFetch.calls.every((call) => call.url.includes('model=model+a'))).toBe(true)

    const repeated = makeMemoryFetch(() => ({ summaries: [baseSummary], nextCursor: 'same-cursor' }))
    vi.stubGlobal('fetch', repeated.fetch)
    await expect(listServerMemorySummaries('chat 1', 'model a')).resolves.toEqual({
      status: 'error',
      error: 'Memory summary pagination returned a repeated cursor',
    })
    expect(repeated.calls).toHaveLength(2)
  })

  it('propagates later-page errors and honors abort signals on every memory page', async () => {
    const failed = makeMemoryFetch((url) =>
      url.includes('cursor=next')
        ? jsonResponse({ error: 'later page failed' }, 503)
        : { chunks: [baseChunk], nextCursor: 'next' },
    )
    vi.stubGlobal('fetch', failed.fetch)
    await expect(listServerMemoryChunks('chat 1')).resolves.toEqual({
      status: 'error',
      error: 'later page failed',
    })

    const controller = new AbortController()
    let calls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init: RequestInit = {}) => {
        calls += 1
        if (calls === 1) {
          controller.abort()
          return jsonResponse({ chunks: [baseChunk], nextCursor: 'after-abort' })
        }
        expect(init.signal).toBe(controller.signal)
        throw new DOMException('aborted', 'AbortError')
      }),
    )
    const aborted = await listServerMemoryChunks('chat 1', controller.signal)
    expect(aborted.status).toBe('error')
    expect(aborted).toMatchObject({ error: expect.stringContaining('Network error:') })
    expect(calls).toBe(2)
  })

  it('patches summary text and metadata through the active-writer API', async () => {
    const memoryFetch = makeMemoryFetch((_url, init) => {
      expect((init.headers as Record<string, string>)['risu-writer-session']).toBe('writer-session-1')
      expect((init.headers as Record<string, string>)['content-type']).toBe('application/json')
      expect((init.headers as Record<string, string>).prefer).toBe('return=minimal')
      expect(JSON.parse(String(init.body))).toEqual({
        text: 'edited',
        isImportant: true,
        categoryId: 'story',
        tags: ['plot'],
      })
      return { summaryId: 'summary-1' }
    })
    vi.stubGlobal('fetch', memoryFetch.fetch)

    const result = await patchServerMemorySummary('summary/1', {
      text: 'edited',
      isImportant: true,
      categoryId: 'story',
      tags: ['plot'],
    })

    expect(result).toEqual({ status: 'ok', summaryId: 'summary-1' })
    expect(memoryFetch.calls[0]).toEqual({
      url: '/api/v1/memory/summaries/summary%2F1',
      method: 'PATCH',
      authHeader: 'test-auth-token',
      ifNoneMatch: null,
    })
  })

  it('deletes summaries through the active-writer API', async () => {
    const memoryFetch = makeMemoryFetch((_url, init) => {
      expect((init.headers as Record<string, string>)['risu-writer-session']).toBe('writer-session-1')
      expect((init.headers as Record<string, string>).prefer).toBe('return=minimal')
      return { summaryId: 'summary-1' }
    })
    vi.stubGlobal('fetch', memoryFetch.fetch)

    const result = await deleteServerMemorySummary('summary/1')

    expect(result).toEqual({ status: 'ok', summaryId: 'summary-1' })
    expect(memoryFetch.calls[0]).toEqual({
      url: '/api/v1/memory/summaries/summary%2F1',
      method: 'DELETE',
      authHeader: 'test-auth-token',
      ifNoneMatch: null,
    })
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

  it('rejects malformed successful envelopes before UI consumers receive them', async () => {
    const memoryFetch = makeMemoryFetch((url, init) => {
      if (url.includes('/chunks/')) return {}
      if (url.includes('/summaries/') && init.method === 'PATCH') return { summary: baseSummary }
      if (url.includes('/summaries/') && init.method === 'DELETE') return {}
      if (url.includes('/summaries/')) return { summaries: [null] }
      if (url.endsWith('/jobs')) return { jobs: [{}] }
      if (url.includes('/jobs/')) return { job: null }
      return {}
    })
    vi.stubGlobal('fetch', memoryFetch.fetch)

    await expect(listServerMemoryChunks('chat-1')).resolves.toEqual({
      status: 'error',
      error: 'Invalid server response',
    })
    await expect(listServerMemorySummaries('chat-1')).resolves.toEqual({
      status: 'error',
      error: 'Invalid server response',
    })
    await expect(patchServerMemorySummary('summary-1', { text: 'edited' })).resolves.toEqual({
      status: 'error',
      error: 'Invalid server response',
    })
    await expect(deleteServerMemorySummary('summary-1')).resolves.toEqual({
      status: 'error',
      error: 'Invalid server response',
    })
    await expect(listServerMemoryJobs()).resolves.toEqual({
      status: 'error',
      error: 'Invalid server response',
    })
    await expect(cancelServerMemoryJob('job-1')).resolves.toEqual({
      status: 'error',
      error: 'Invalid server response',
    })
  })

  it('rejects a non-JSON HTTP success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('not json', { status: 200 })),
    )

    await expect(listServerMemoryJobs()).resolves.toEqual({
      status: 'error',
      error: 'Invalid server response',
    })
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
