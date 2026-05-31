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
  getNodeServerProxyAuth: async () => 'events-auth-token',
}))

import { canUseServerEvents, subscribeServerCommandEvents } from './events'
import type { CommandEvent } from './commands'
import type { ServerMemoryEvent } from './events'

interface CapturedFetch {
  url: string
  method: string
  authHeader: string | null
  lastEventIdHeader: string | null
  signal: AbortSignal | null
}

function streamOf(text: string): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(enc.encode(text))
      controller.close()
    },
  })
}

function stubEventsFetch(body: string | null, status = 200): CapturedFetch[] {
  const calls: CapturedFetch[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const headers = init.headers as Record<string, string> | undefined
      calls.push({
        url: String(input),
        method: init.method ?? 'GET',
        authHeader: headers?.['risu-auth'] ?? null,
        lastEventIdHeader: headers?.['Last-Event-ID'] ?? null,
        signal: init.signal ?? null,
      })
      return new Response(body === null ? null : streamOf(body), { status })
    }) as unknown as typeof fetch,
  )
  return calls
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1000
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('timed out waiting for condition')
}

beforeEach(() => {
  platformState.isFastifyServer = true
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('server command event subscription helper', () => {
  it('reports availability from the Fastify platform gate', async () => {
    expect(canUseServerEvents()).toBe(true)
    platformState.isFastifyServer = false
    expect(canUseServerEvents()).toBe(false)

    await expect(subscribeServerCommandEvents({ onCommandEvent: vi.fn() })).resolves.toEqual({
      status: 'unavailable',
    })
  })

  it('fetches the event stream with auth and emits command and memory events', async () => {
    const commandEvent: CommandEvent = {
      type: 'settings.updated',
      revision: 3,
      resource: 'settings',
    }
    const memoryEvent: ServerMemoryEvent = {
      type: 'memory.job',
      chatId: 'chat-1',
      jobId: 'job-1',
      kind: 'summarize',
      status: 'pending',
      attemptCount: 0,
      maxAttempts: 3,
      nextRunAt: '2026-05-27T00:00:00.000Z',
      error: null,
      sideEffect: {
        kind: 'hypav3_progress',
        payload: {
          open: true,
          miniMsg: '1',
          msg: '[Hypa V3] Waiting to summarize...',
          subMsg: '1 queued',
          status: 'pending',
          queuedCount: 1,
        },
      },
    }
    const calls = stubEventsFetch(
      [
        ': connected',
        '',
        'event: command',
        `data: ${JSON.stringify(commandEvent)}`,
        '',
        'event: message',
        'data: ignored',
        '',
        'event: command',
        'data: {"type":"broken"}',
        '',
        'event: memory',
        `data: ${JSON.stringify(memoryEvent)}`,
        '',
        'event: memory',
        'data: {"type":"memory.job","chatId":"chat-1"}',
        '',
      ].join('\n'),
    )
    const seen: CommandEvent[] = []
    const memorySeen: ServerMemoryEvent[] = []

    const subscription = await subscribeServerCommandEvents({
      onCommandEvent: (event) => seen.push(event),
      onMemoryEvent: (event) => memorySeen.push(event),
    })

    expect(subscription.status).toBe('ok')
    await waitFor(() => seen.length === 1)
    await waitFor(() => memorySeen.length === 1)
    expect(seen).toEqual([commandEvent])
    expect(memorySeen).toEqual([memoryEvent])
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      url: '/api/v1/events',
      method: 'GET',
      authHeader: 'events-auth-token',
    })
  })

  it('returns an error for event stream HTTP failures', async () => {
    stubEventsFetch('{"error":"missing_auth"}', 401)

    await expect(subscribeServerCommandEvents({ onCommandEvent: vi.fn() })).resolves.toEqual({
      status: 'error',
      error: 'HTTP 401',
    })
  })

  it('requests command-event replay with the cached revision cursor', async () => {
    const calls = stubEventsFetch(': connected\n\n')

    const subscription = await subscribeServerCommandEvents({
      sinceRevision: 7,
      onCommandEvent: vi.fn(),
    })

    expect(subscription.status).toBe('ok')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      url: '/api/v1/events?sinceRevision=7',
      method: 'GET',
      authHeader: 'events-auth-token',
      lastEventIdHeader: '7',
    })
  })

  it('returns replay-unavailable for exhausted server history', async () => {
    stubEventsFetch(
      JSON.stringify({
        error: 'event_replay_unavailable',
        requestedRevision: 3,
        currentRevision: 12,
        oldestRevision: 8,
        latestRevision: 12,
      }),
      409,
    )

    await expect(
      subscribeServerCommandEvents({ sinceRevision: 3, onCommandEvent: vi.fn() }),
    ).resolves.toEqual({
      status: 'replay-unavailable',
      error: 'event_replay_unavailable',
      currentRevision: 12,
      oldestRevision: 8,
      latestRevision: 12,
    })
  })

  it('notifies callers when the event stream closes cleanly', async () => {
    stubEventsFetch(': connected\n\n')
    const onClose = vi.fn()

    const subscription = await subscribeServerCommandEvents({
      onCommandEvent: vi.fn(),
      onClose,
    })

    expect(subscription.status).toBe('ok')
    await waitFor(() => onClose.mock.calls.length === 1)
  })

  it('aborts the stream when unsubscribed', async () => {
    const calls = stubEventsFetch(': connected\n\n')
    const subscription = await subscribeServerCommandEvents({
      onCommandEvent: vi.fn(),
    })

    expect(subscription.status).toBe('ok')
    if (subscription.status !== 'ok') return

    expect(calls[0].signal?.aborted).toBe(false)
    subscription.unsubscribe()
    expect(calls[0].signal?.aborted).toBe(true)
  })
})
