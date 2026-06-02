import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const platformState = vi.hoisted(() => ({ isFastifyServer: true }))

vi.mock('./platform', async (importActual) => {
  const actual = await importActual<typeof import('./platform')>()
  return {
    ...actual,
    get isFastifyServer() {
      return platformState.isFastifyServer
    },
  }
})

vi.mock('./storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'proxy-auth-token',
}))

import { DBState } from './stores.svelte'
import { fetchNative, globalFetch } from './globalApi.svelte'

class FakeWebSocket {
  static OPEN = 1
  readonly OPEN = 1
  readyState = FakeWebSocket.OPEN
  onmessage: ((event: MessageEvent<string>) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null

  constructor(readonly url: string) {
    fakeWebSocketUrls.push(url)
    queueMicrotask(() => {
      this.onerror?.()
    })
  }

  send(): void {
    // no-op
  }

  close(): void {
    this.readyState = 3
    this.onclose?.()
  }
}

const fetchCalls: Array<{ url: string; init?: RequestInit }> = []
const fakeWebSocketUrls: string[] = []

beforeEach(() => {
  platformState.isFastifyServer = true
  DBState.db = {
    usePlainFetch: false,
    requestLocation: '',
  } as typeof DBState.db
  fetchCalls.length = 0
  fakeWebSocketUrls.length = 0
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    fetchCalls.push({ url, init })
    if (url === '/api/v1/proxy/stream-jobs') {
      return new Response(JSON.stringify({ jobId: 'job 1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  })
  vi.stubGlobal('WebSocket', FakeWebSocket)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Fastify proxy routing', () => {
  it('routes buffered proxy fetches through the Fastify proxy endpoint', async () => {
    const res = await globalFetch('https://provider.example.test/v1/chat/completions', {
      body: { messages: [] },
      headers: { authorization: 'Bearer test' },
    })

    expect(res.ok).toBe(true)
    expect(fetchCalls).toHaveLength(1)
    expect(fetchCalls[0].url).toBe('/api/v1/proxy/fetch')
    expect(fetchCalls[0].url).not.toContain('/proxy2')
    expect(fetchCalls[0].init?.headers).toMatchObject({
      'risu-url': encodeURIComponent('https://provider.example.test/v1/chat/completions'),
      'risu-auth': 'proxy-auth-token',
    })
  })

  it('routes local streaming proxy jobs through Fastify create and websocket endpoints', async () => {
    const res = await fetchNative('http://127.0.0.1:11434/v1/chat/completions', {
      body: JSON.stringify({ stream: true }),
      headers: { authorization: 'Bearer test' },
      interceptor: 'openai_streaming',
      method: 'POST',
      networkRoute: 'local_network',
    })

    expect(res.status).toBe(502)
    expect(fetchCalls[0].url).toBe('/api/v1/proxy/stream-jobs')
    expect(fetchCalls[0].url).not.toContain('/proxy-stream-jobs')
    expect(fakeWebSocketUrls).toEqual([
      'ws://localhost:3000/api/v1/proxy/stream-jobs/job%201/ws?risu-auth=proxy-auth-token',
    ])
    expect(fakeWebSocketUrls[0]).not.toContain('/proxy-stream-jobs')
  })
})
