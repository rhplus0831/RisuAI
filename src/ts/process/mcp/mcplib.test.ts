import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fetchNativeMock = vi.hoisted(() => vi.fn())
const oauthUiMocks = vi.hoisted(() => ({
  alertInput: vi.fn(),
  openURL: vi.fn(),
}))

vi.mock('../../globalApi.svelte', () => ({
  fetchNative: fetchNativeMock,
  openURL: oauthUiMocks.openURL,
}))

vi.mock('../../alert', () => ({
  alertInput: oauthUiMocks.alertInput,
}))

import {
  MCPClient,
  MCP_SSE_BUFFER_LIMIT_BYTES,
  MCP_SSE_DEDUP_ID_LIMIT,
  type JsonRPC,
  type MCPCustomTransport,
  type SseEventDetail,
  WindowedSseIdDedup,
} from './mcplib'

function jsonRpcResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status === 404 ? 'Not Found' : 'OK',
    headers: {
      'content-type': 'application/json',
    },
  })
}

function sseResponse(stream: ReadableStream<Uint8Array>): Response {
  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream',
    },
  })
}

function frameStream(frames: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) {
        controller.enqueue(encoder.encode(frame))
      }
      controller.close()
    },
  })
}

function createSseStream(frames: readonly string[]): ReadableStream<Uint8Array> {
  return frameStream([...frames])
}

function dataFrame(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`
}

function collectClientEvents(client: MCPClient) {
  const events: SseEventDetail[] = []
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<SseEventDetail>).detail
    if (detail.mcpClientObjectId === client.mcpClientObjectId) {
      events.push(detail)
    }
  }
  document.addEventListener('mcp-sse', listener)
  return {
    events,
    stop: () => document.removeEventListener('mcp-sse', listener),
  }
}

function hangingStream() {
  let close: () => void = () => {
    /* assigned in start */
  }
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      close = () => controller.close()
    },
  })
  return { stream, close }
}

function trackMcpSseListeners() {
  const listeners = new Set<EventListenerOrEventListenerObject>()
  const originalAdd = document.addEventListener.bind(document)
  const originalRemove = document.removeEventListener.bind(document)
  const addSpy = vi
    .spyOn(document, 'addEventListener')
    .mockImplementation(
      (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
        if (type === 'mcp-sse') {
          listeners.add(listener)
        }
        return originalAdd(type, listener, options)
      },
    )
  const removeSpy = vi
    .spyOn(document, 'removeEventListener')
    .mockImplementation(
      (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) => {
        if (type === 'mcp-sse') {
          listeners.delete(listener)
        }
        return originalRemove(type, listener, options)
      },
    )

  return { listeners, addSpy, removeSpy }
}

function dispatchMcpSse(client: MCPClient, data: JsonRPC) {
  document.dispatchEvent(
    new CustomEvent('mcp-sse', {
      detail: {
        mcpClientObjectId: client.mcpClientObjectId,
        data,
      },
    }),
  )
}

async function flushPromises(times = 4) {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve()
  }
}

class FakeCustomTransport implements MCPCustomTransport {
  readonly messageListeners = new Set<(message: JsonRPC) => void | Promise<void>>()
  readonly closeListeners = new Set<(reason?: unknown) => void>()
  readonly errorListeners = new Set<(error: unknown) => void>()
  readonly send = vi.fn(async (_message: JsonRPC) => {})
  readonly addListener = vi.fn((listener: (message: JsonRPC) => void | Promise<void>) => {
    this.messageListeners.add(listener)
  })
  readonly removeListener = vi.fn((listener: (message: JsonRPC) => void | Promise<void>) => {
    this.messageListeners.delete(listener)
  })
  readonly addCloseListener = vi.fn((listener: (reason?: unknown) => void) => {
    this.closeListeners.add(listener)
  })
  readonly removeCloseListener = vi.fn((listener: (reason?: unknown) => void) => {
    this.closeListeners.delete(listener)
  })
  readonly addErrorListener = vi.fn((listener: (error: unknown) => void) => {
    this.errorListeners.add(listener)
  })
  readonly removeErrorListener = vi.fn((listener: (error: unknown) => void) => {
    this.errorListeners.delete(listener)
  })

  async emitMessage(message: JsonRPC) {
    await Promise.all(Array.from(this.messageListeners, (listener) => listener(message)))
  }

  emitClose(reason?: unknown) {
    for (const listener of Array.from(this.closeListeners)) listener(reason)
  }

  emitError(error: unknown) {
    for (const listener of Array.from(this.errorListeners)) listener(error)
  }
}

beforeEach(() => {
  fetchNativeMock.mockReset()
  oauthUiMocks.alertInput.mockReset()
  oauthUiMocks.openURL.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  fetchNativeMock.mockReset()
})

describe('MCPClient OAuth refresh', () => {
  function clientWithRefreshToken(): MCPClient {
    const client = new MCPClient('https://mcp.example/messages')
    client.getRefreshToken = async () => ({
      source: 'provided',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      refreshToken: 'refresh-token',
      tokenUrl: 'https://auth.example/token',
    })
    return client
  }

  it('accepts a successful refresh and skips OAuth discovery', async () => {
    fetchNativeMock.mockResolvedValueOnce(jsonRpcResponse({ access_token: 'fresh-access-token' }))
    const client = clientWithRefreshToken()

    await client.oauthLogin()

    expect(client.accessToken).toBe('fresh-access-token')
    expect(fetchNativeMock).toHaveBeenCalledOnce()
    expect(fetchNativeMock).toHaveBeenCalledWith(
      'https://auth.example/token',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('grant_type=refresh_token'),
        requestTimeoutMs: 30000,
        sensitive: true,
        signal: expect.any(AbortSignal),
      }),
    )
  })

  it.each([
    ['non-success response', jsonRpcResponse({ access_token: 'must-not-authenticate' }, 401)],
    ['empty access token', jsonRpcResponse({ access_token: '' })],
    ['missing access token', jsonRpcResponse({ token_type: 'Bearer' })],
    ['invalid JSON response', new Response('not-json', { status: 200 })],
  ])('does not authenticate from a %s', async (_label, refreshResponse) => {
    fetchNativeMock
      .mockResolvedValueOnce(refreshResponse)
      .mockRejectedValueOnce(new Error('OAuth discovery reached after failed refresh'))
    const client = clientWithRefreshToken()

    await expect(client.oauthLogin()).rejects.toThrow('OAuth discovery reached after failed refresh')

    expect(client.accessToken).toBeNull()
    expect(fetchNativeMock).toHaveBeenCalledTimes(2)
    expect(fetchNativeMock.mock.calls[1]?.[0]).toBe('https://mcp.example/.well-known/oauth-authorization-server')
  })

  it('uses the stored refresh callback without sending credentials to the upstream token endpoint', async () => {
    const client = new MCPClient('https://mcp.example/messages')
    client.getRefreshToken = async () => ({ source: 'stored' })
    client.refreshStoredAccessToken = vi.fn(async () => 'stored-access-token')

    await client.oauthLogin()

    expect(client.accessToken).toBe('stored-access-token')
    expect(client.refreshStoredAccessToken).toHaveBeenCalledWith(expect.any(AbortSignal))
    expect(fetchNativeMock).not.toHaveBeenCalled()
  })

  it('falls through to discovery after an ordinary stored refresh failure', async () => {
    const client = new MCPClient('https://mcp.example/messages')
    client.getRefreshToken = async () => ({ source: 'stored' })
    client.refreshStoredAccessToken = vi.fn(async () => {
      throw new Error('sanitized stored refresh failure')
    })
    fetchNativeMock.mockRejectedValueOnce(new Error('OAuth discovery reached'))

    await expect(client.oauthLogin()).rejects.toThrow('OAuth discovery reached')

    expect(fetchNativeMock).toHaveBeenCalledOnce()
    expect(fetchNativeMock.mock.calls[0]?.[0]).toBe('https://mcp.example/.well-known/oauth-authorization-server')
  })

  it('deduplicates concurrent refreshes', async () => {
    let resolveRefresh!: (token: string) => void
    const refresh = new Promise<string>((resolve) => {
      resolveRefresh = resolve
    })
    const client = new MCPClient('https://mcp.example/messages')
    client.getRefreshToken = async () => ({ source: 'stored' })
    client.refreshStoredAccessToken = vi.fn(async () => await refresh)

    const first = client.oauthLogin()
    const second = client.oauthLogin()
    expect(second).toBe(first)
    resolveRefresh('deduplicated-access-token')

    await Promise.all([first, second])
    expect(client.refreshStoredAccessToken).toHaveBeenCalledOnce()
    expect(client.accessToken).toBe('deduplicated-access-token')
  })

  it('destroy aborts refresh and fences a callback that resolves late', async () => {
    let resolveRefresh!: (token: string) => void
    const refresh = new Promise<string>((resolve) => {
      resolveRefresh = resolve
    })
    let capturedSignal: AbortSignal | null = null
    const client = new MCPClient('https://mcp.example/messages')
    client.getRefreshToken = async () => ({ source: 'stored' })
    client.refreshStoredAccessToken = vi.fn(async (signal) => {
      capturedSignal = signal
      return await refresh
    })

    const pending = client.oauthLogin()
    await vi.waitFor(() => expect(capturedSignal).not.toBeNull())
    client.destroy()
    expect(capturedSignal?.aborted).toBe(true)
    resolveRefresh('late-access-token')

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(client.accessToken).toBeNull()
    expect(fetchNativeMock).not.toHaveBeenCalled()
  })

  it('does not fall through to discovery when refresh cancellation propagates', async () => {
    const client = new MCPClient('https://mcp.example/messages')
    client.getRefreshToken = async () => ({ source: 'stored' })
    client.refreshStoredAccessToken = vi.fn(
      async (signal) =>
        await new Promise<string>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        }),
    )

    const pending = client.oauthLogin()
    await vi.waitFor(() => expect(client.refreshStoredAccessToken).toHaveBeenCalledOnce())
    client.destroy()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchNativeMock).not.toHaveBeenCalled()
  })
})

describe('MCPClient OAuth handshake retry', () => {
  const unauthorized = {
    rpc: { jsonrpc: '2.0' as const, id: '', error: { code: 401, message: 'Unauthorized' } },
    http: { status: 401, headers: {} },
  }
  const initialized = {
    rpc: {
      jsonrpc: '2.0' as const,
      id: '',
      result: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        serverInfo: { name: 'test-server', version: '1.0.0' },
      },
    },
    http: { status: 200, headers: {} },
  }

  it('retries initialize exactly once after OAuth succeeds', async () => {
    const client = new MCPClient('https://mcp.example/messages')
    const request = vi
      .spyOn(client, 'request')
      .mockResolvedValueOnce(unauthorized)
      .mockResolvedValueOnce(initialized)
      .mockResolvedValueOnce({
        rpc: { jsonrpc: '2.0', id: '', result: null },
        http: { status: 202, headers: {} },
      })
    const oauthLogin = vi.spyOn(client, 'oauthLogin').mockResolvedValueOnce()

    await expect(client.handshake()).resolves.toMatchObject({ serverInfo: { name: 'test-server' } })

    expect(oauthLogin).toHaveBeenCalledOnce()
    expect(request.mock.calls.filter(([method]) => method === 'initialize')).toHaveLength(2)
  })

  it('fails in a bounded way when the refreshed token is also rejected', async () => {
    const client = new MCPClient('https://mcp.example/messages')
    const request = vi.spyOn(client, 'request').mockResolvedValue(unauthorized)
    const oauthLogin = vi.spyOn(client, 'oauthLogin').mockResolvedValueOnce()

    await expect(client.handshake()).rejects.toThrow('MCP authentication failed after OAuth retry')

    expect(oauthLogin).toHaveBeenCalledOnce()
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('returns an authenticated initialize 401 without an anonymous recursive request', async () => {
    fetchNativeMock.mockResolvedValueOnce(jsonRpcResponse({ error: 'unauthorized' }, 401))
    const client = new MCPClient('https://mcp.example/messages', { accessToken: 'rejected-access-token' })

    const result = await client.request('initialize', {}, { initMethod: 'init' })

    expect(result.http.status).toBe(401)
    expect(fetchNativeMock).toHaveBeenCalledOnce()
    expect(client.accessToken).toBe('rejected-access-token')
  })

  it('refreshes an expired token, restores the handshake, and retries an active request once', async () => {
    fetchNativeMock
      .mockResolvedValueOnce(jsonRpcResponse({ error: 'expired' }, 401))
      .mockResolvedValueOnce(jsonRpcResponse({ error: 'authentication required' }, 401))
      .mockResolvedValueOnce(jsonRpcResponse(initialized.rpc))
      .mockResolvedValueOnce(jsonRpcResponse({ result: null }, 202))
      .mockResolvedValueOnce(jsonRpcResponse({ result: { tools: [] } }))

    const client = new MCPClient('https://mcp.example/messages', { accessToken: 'expired-access-token' })
    client.initialized = true
    client.serverInfo = initialized.rpc.result
    client.getRefreshToken = async () => ({ source: 'stored' })
    client.refreshStoredAccessToken = vi.fn(async () => 'refreshed-access-token')

    const result = await client.request('tools/list')

    expect(result.rpc.result).toEqual({ tools: [] })
    expect(client.refreshStoredAccessToken).toHaveBeenCalledOnce()
    expect(fetchNativeMock).toHaveBeenCalledTimes(5)
    expect(fetchNativeMock.mock.calls[0]?.[1]?.headers.Authorization).toBe('Bearer expired-access-token')
    expect(fetchNativeMock.mock.calls[1]?.[1]?.headers.Authorization).toBeUndefined()
    for (const call of fetchNativeMock.mock.calls.slice(2)) {
      expect(call[1]?.headers.Authorization).toBe('Bearer refreshed-access-token')
    }
  })

  it('performs a new handshake before retrying an expired session', async () => {
    const renewedSessionResponse = new Response(JSON.stringify(initialized.rpc), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'Mcp-Session-Id': 'renewed-session',
      },
    })
    fetchNativeMock
      .mockResolvedValueOnce(jsonRpcResponse({ error: 'session expired' }, 404))
      .mockResolvedValueOnce(renewedSessionResponse)
      .mockResolvedValueOnce(jsonRpcResponse({ result: null }, 202))
      .mockResolvedValueOnce(jsonRpcResponse({ result: { prompts: [] } }))

    const client = new MCPClient('https://mcp.example/messages', { accessToken: 'valid-access-token' })
    client.initialized = true
    client.sessionId = 'expired-session'
    client.serverInfo = initialized.rpc.result
    const oauthLogin = vi.spyOn(client, 'oauthLogin')

    const result = await client.request('prompts/list')

    expect(result.rpc.result).toEqual({ prompts: [] })
    expect(oauthLogin).not.toHaveBeenCalled()
    expect(client.sessionId).toBe('renewed-session')
    expect(fetchNativeMock).toHaveBeenCalledTimes(4)
    expect(fetchNativeMock.mock.calls[0]?.[1]?.headers['Mcp-Session-Id']).toBe('expired-session')
    expect(fetchNativeMock.mock.calls[1]?.[1]?.headers['Mcp-Session-Id']).toBeUndefined()
    expect(fetchNativeMock.mock.calls[3]?.[1]?.headers['Mcp-Session-Id']).toBe('renewed-session')
  })
})

describe('MCPClient deadlines and SSE listener cleanup', () => {
  it('aborts a hung MCP HTTP request at the configured deadline', async () => {
    vi.useFakeTimers()
    let capturedOptions: any
    fetchNativeMock.mockImplementation((_url: string, options: any) => {
      capturedOptions = options
      return new Promise<Response>(() => {
        /* hung fetch */
      })
    })

    const client = new MCPClient('https://mcp.example/messages')
    const request = client.request(
      'tools/list',
      {},
      {
        id: 'hung-fetch',
        requestTimeoutMs: 5,
      },
    )

    await flushPromises()
    expect(fetchNativeMock).toHaveBeenCalledWith(
      'https://mcp.example/messages',
      expect.objectContaining({
        method: 'POST',
        requestTimeoutMs: 5,
      }),
    )
    expect(capturedOptions.signal.aborted).toBe(false)

    await vi.advanceTimersByTimeAsync(5)
    const result = await request

    expect(capturedOptions.signal.aborted).toBe(true)
    expect(result.http.status).toBe(408)
    expect(result.rpc.id).toBe('hung-fetch')
    expect(result.rpc.error).toEqual(
      expect.objectContaining({
        code: -32001,
        message: expect.stringContaining('timed out'),
      }),
    )
  })

  it('times out unmatched MCP SSE responses and removes the document listener', async () => {
    vi.useFakeTimers()
    const { listeners, addSpy, removeSpy } = trackMcpSseListeners()
    fetchNativeMock.mockResolvedValue(new Response(null, { status: 202 }))

    const client = new MCPClient('https://mcp.example/messages')
    client.sseEndpoint = 'https://mcp.example/messages'
    const request = client.request(
      'tools/call',
      {
        name: 'lookup',
        arguments: {},
      },
      {
        id: 'expected-response',
        requestTimeoutMs: 5,
      },
    )

    expect(listeners.size).toBe(1)
    dispatchMcpSse(client, {
      jsonrpc: '2.0',
      id: 'other-response',
      result: {
        content: [],
      },
    })
    expect(listeners.size).toBe(1)

    await vi.advanceTimersByTimeAsync(5)
    const result = await request

    expect(result.rpc.id).toBe('expected-response')
    expect(result.rpc.error?.message).toContain('timed out')
    expect(listeners.size).toBe(0)
    expect(addSpy.mock.calls.filter(([type]) => type === 'mcp-sse')).toHaveLength(1)
    expect(removeSpy.mock.calls.filter(([type]) => type === 'mcp-sse')).toHaveLength(1)
  })

  it('removes the SSE listener after a matching MCP response', async () => {
    const { listeners } = trackMcpSseListeners()
    fetchNativeMock.mockResolvedValue(new Response(null, { status: 202 }))

    const client = new MCPClient('https://mcp.example/messages')
    client.sseEndpoint = 'https://mcp.example/messages'
    const request = client.request(
      'tools/call',
      {
        name: 'lookup',
        arguments: {},
      },
      {
        id: 'matching-response',
        requestTimeoutMs: 50,
      },
    )

    expect(listeners.size).toBe(1)
    dispatchMcpSse(client, {
      jsonrpc: '2.0',
      id: 'matching-response',
      result: {
        content: [
          {
            type: 'text',
            text: 'ok',
          },
        ],
      },
    })

    const result = await request

    expect(result.rpc.result?.content?.[0]?.text).toBe('ok')
    expect(listeners.size).toBe(0)
  })

  it('removes the SSE listener when the initial POST aborts at the deadline', async () => {
    vi.useFakeTimers()
    const { listeners } = trackMcpSseListeners()
    let capturedOptions: any
    fetchNativeMock.mockImplementation((_url: string, options: any) => {
      capturedOptions = options
      return new Promise<Response>(() => {
        /* hung POST before the SSE response arrives */
      })
    })

    const client = new MCPClient('https://mcp.example/messages')
    client.sseEndpoint = 'https://mcp.example/messages'
    const request = client.request(
      'tools/call',
      {
        name: 'lookup',
        arguments: {},
      },
      {
        id: 'post-abort',
        requestTimeoutMs: 5,
      },
    )

    expect(listeners.size).toBe(1)

    await vi.advanceTimersByTimeAsync(5)
    const result = await request

    expect(capturedOptions.signal.aborted).toBe(true)
    expect(result.rpc.id).toBe('post-abort')
    expect(result.rpc.error?.message).toContain('timed out')
    expect(listeners.size).toBe(0)
  })

  it('text/event-stream response waits time out and remove their listener', async () => {
    vi.useFakeTimers()
    const { listeners } = trackMcpSseListeners()
    const { stream, close } = hangingStream()
    let capturedOptions: any
    fetchNativeMock.mockImplementation((_url: string, options: any) => {
      capturedOptions = options
      return Promise.resolve(sseResponse(stream))
    })

    const client = new MCPClient('https://mcp.example/messages')
    const request = client.request(
      'tools/list',
      {},
      {
        id: 'stream-response',
        requestTimeoutMs: 5,
      },
    )

    await flushPromises()
    expect(listeners.size).toBe(1)

    await vi.advanceTimersByTimeAsync(5)
    const result = await request
    close()
    await flushPromises()

    expect(capturedOptions.signal.aborted).toBe(true)
    expect(result.rpc.id).toBe('stream-response')
    expect(result.rpc.error?.message).toContain('timed out')
    expect(listeners.size).toBe(0)
  })

  it('aborts and errors when an SSE response buffer exceeds the delimiter cap', async () => {
    const { listeners } = trackMcpSseListeners()
    const encoder = new TextEncoder()
    const cancelSpy = vi.fn()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${'x'.repeat(32)}`))
      },
      cancel: cancelSpy,
    })
    let capturedOptions: any
    fetchNativeMock.mockImplementation((_url: string, options: any) => {
      capturedOptions = options
      return Promise.resolve(sseResponse(stream))
    })

    const client = new MCPClient('https://mcp.example/messages', {
      sseBufferLimitBytes: 16,
    })
    const result = await client.request(
      'tools/list',
      {},
      {
        id: 'oversized-response',
        requestTimeoutMs: 1000,
      },
    )

    await vi.waitFor(() => {
      expect(client.sses).toHaveLength(0)
    })

    expect(MCP_SSE_BUFFER_LIMIT_BYTES).toBeGreaterThanOrEqual(1024 * 1024)
    expect(result.http.status).toBe(502)
    expect(result.rpc.id).toBe('oversized-response')
    expect(result.rpc.error).toEqual(
      expect.objectContaining({
        code: -32002,
        message: expect.stringContaining('exceeded 16 bytes'),
      }),
    )
    expect(result.rpc.error?.data).toEqual({
      limitBytes: 16,
      bufferedBytes: 38,
    })
    expect(capturedOptions.signal.aborted).toBe(true)
    expect(cancelSpy).toHaveBeenCalledTimes(1)
    expect(listeners.size).toBe(0)
  })

  it('times out the fallback SSE handshake endpoint wait and removes its listener', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => {
      /* expected streamed-transport fallback */
    })
    const { listeners } = trackMcpSseListeners()
    const { stream, close } = hangingStream()
    fetchNativeMock
      .mockResolvedValueOnce(
        jsonRpcResponse(
          {
            jsonrpc: '2.0',
            id: 'initialize',
            error: {
              code: 404,
              message: 'not found',
            },
          },
          404,
        ),
      )
      .mockResolvedValueOnce(sseResponse(stream))

    const client = new MCPClient('https://mcp.example/sse', {
      requestTimeoutMs: 5,
    })
    const handshake = client.handshake()
    const handshakeError = handshake.catch((error) => error)

    for (let i = 0; i < 20 && fetchNativeMock.mock.calls.length < 2; i += 1) {
      await Promise.resolve()
    }
    expect(fetchNativeMock).toHaveBeenCalledTimes(2)
    expect(fetchNativeMock.mock.calls[1][1]).toEqual(
      expect.objectContaining({
        method: 'GET',
        requestTimeoutMs: 5,
      }),
    )
    for (let i = 0; i < 20 && listeners.size < 1; i += 1) {
      await Promise.resolve()
    }
    expect(listeners.size).toBe(1)

    await vi.advanceTimersByTimeAsync(5)
    const error = await handshakeError
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toMatch(/timed out/)
    close()
    await flushPromises()

    expect(listeners.size).toBe(0)
  })
})

describe('MCPClient custom transport request lifecycle', () => {
  it('rejects a failed send immediately and removes every transport listener', async () => {
    const transport = new FakeCustomTransport()
    const sendError = new Error('custom send failed')
    transport.send.mockRejectedValueOnce(sendError)
    const client = new MCPClient('custom:test')
    client.customTransport = transport

    const request = client.request('tools/list', {}, { id: 'send-failure', requestTimeoutMs: 1_000 })

    await expect(request).rejects.toBe(sendError)
    expect(transport.messageListeners.size).toBe(0)
    expect(transport.closeListeners.size).toBe(0)
    expect(transport.errorListeners.size).toBe(0)
    expect(transport.removeListener).toHaveBeenCalledTimes(1)
    expect(transport.removeCloseListener).toHaveBeenCalledTimes(1)
    expect(transport.removeErrorListener).toHaveBeenCalledTimes(1)
  })

  it('times out a hung send, cleans up, and ignores a late response callback', async () => {
    vi.useFakeTimers()
    const transport = new FakeCustomTransport()
    transport.send.mockImplementationOnce(
      () =>
        new Promise<void>(() => {
          /* hung custom transport send */
        }),
    )
    const client = new MCPClient('custom:test')
    client.customTransport = transport

    const request = client.request('tools/list', {}, { id: 'custom-timeout', requestTimeoutMs: 5 })
    const lateResponse = Array.from(transport.messageListeners)[0]
    expect(lateResponse).toEqual(expect.any(Function))
    const rejection = expect(request).rejects.toThrow('MCP request timed out after 5ms')

    await vi.advanceTimersByTimeAsync(5)
    await rejection

    expect(transport.messageListeners.size).toBe(0)
    expect(transport.closeListeners.size).toBe(0)
    expect(transport.errorListeners.size).toBe(0)
    await lateResponse({
      jsonrpc: '2.0',
      id: 'custom-timeout',
      result: { tools: [{ name: 'too late' }] },
    })
    expect(transport.removeListener).toHaveBeenCalledTimes(1)
  })

  it('rejects a pending request when the transport closes', async () => {
    const transport = new FakeCustomTransport()
    const client = new MCPClient('custom:test')
    client.customTransport = transport
    const request = client.request('tools/list', {}, { id: 'transport-close', requestTimeoutMs: 1_000 })
    const rejection = expect(request).rejects.toThrow('MCP custom transport closed: process exited')

    transport.emitClose('process exited')

    await rejection
    expect(transport.messageListeners.size).toBe(0)
    expect(transport.closeListeners.size).toBe(0)
    expect(transport.errorListeners.size).toBe(0)
  })

  it('rejects a pending request with the transport error', async () => {
    const transport = new FakeCustomTransport()
    const client = new MCPClient('custom:test')
    client.customTransport = transport
    const transportError = new Error('transport crashed')
    const requestError = client
      .request('tools/list', {}, { id: 'transport-error', requestTimeoutMs: 1_000 })
      .catch((error) => error)

    transport.emitError(transportError)

    await expect(requestError).resolves.toBe(transportError)
    expect(transport.messageListeners.size).toBe(0)
    expect(transport.closeListeners.size).toBe(0)
    expect(transport.errorListeners.size).toBe(0)
  })

  it('rejects pending custom transport requests when the client is destroyed', async () => {
    const transport = new FakeCustomTransport()
    const client = new MCPClient('custom:test')
    client.customTransport = transport
    const request = client.request('tools/list', {}, { id: 'client-destroy', requestTimeoutMs: 1_000 })
    const rejection = expect(request).rejects.toThrow('MCP custom transport closed')

    client.destroy()

    await rejection
    expect(transport.messageListeners.size).toBe(0)
    expect(transport.closeListeners.size).toBe(0)
    expect(transport.errorListeners.size).toBe(0)
  })

  it('resolves notifications after send without leaving a response listener pending', async () => {
    const transport = new FakeCustomTransport()
    const client = new MCPClient('custom:test')
    client.customTransport = transport

    const result = await client.request('notifications/initialized', null, {
      notifications: true,
      requestTimeoutMs: 1_000,
    })

    expect(result.rpc.result).toBeNull()
    expect(transport.messageListeners.size).toBe(0)
    expect(transport.closeListeners.size).toBe(0)
    expect(transport.errorListeners.size).toBe(0)
    expect(transport.send).toHaveBeenCalledWith(
      expect.objectContaining({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      }),
    )
    expect(transport.send.mock.calls[0][0]).not.toHaveProperty('id')
  })

  it('settles a matching response once and removes listeners before later messages', async () => {
    const transport = new FakeCustomTransport()
    const client = new MCPClient('custom:test')
    client.customTransport = transport
    const request = client.request('tools/list', {}, { id: 'custom-success', requestTimeoutMs: 1_000 })
    const responseListener = Array.from(transport.messageListeners)[0]

    await transport.emitMessage({
      jsonrpc: '2.0',
      id: 'different-request',
      result: { tools: [] },
    })
    expect(transport.messageListeners.size).toBe(1)

    await transport.emitMessage({
      jsonrpc: '2.0',
      id: 'custom-success',
      result: { tools: [{ name: 'current' }] },
    })
    const result = await request

    expect(result.rpc.result).toEqual({ tools: [{ name: 'current' }] })
    expect(transport.messageListeners.size).toBe(0)
    await responseListener({
      jsonrpc: '2.0',
      id: 'custom-success',
      result: { tools: [{ name: 'late' }] },
    })
    expect(result.rpc.result).toEqual({ tools: [{ name: 'current' }] })
  })
})

describe('MCPClient debug logging', () => {
  it('keeps MCP frame and tools-list payload logs silent by default', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {
      /* test spy */
    })
    fetchNativeMock.mockResolvedValue(
      jsonRpcResponse({
        jsonrpc: '2.0',
        id: 'tools-list',
        result: {
          tools: [],
        },
      }),
    )

    const client = new MCPClient('https://mcp.example/messages')
    client.initialized = true
    client.serverInfo = {
      protocolVersion: '2025-03-26',
      capabilities: {
        tools: {},
      },
      serverInfo: {
        name: 'test-server',
        version: '1.0.0',
      },
    }

    await client.connectSSE(frameStream(['data: {"jsonrpc":"2.0","id":"frame","result":{}}\n\n']))
    await client.getToolList()

    expect(logSpy).not.toHaveBeenCalledWith('MCP SSE Data', expect.anything())
    expect(logSpy).not.toHaveBeenCalledWith('MCP Tools List Response', expect.anything())
  })

  it('emits MCP frame and tools-list payload logs when debug is enabled', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {
      /* test spy */
    })
    fetchNativeMock.mockResolvedValue(
      jsonRpcResponse({
        jsonrpc: '2.0',
        id: 'tools-list',
        result: {
          tools: [],
        },
      }),
    )

    const client = new MCPClient('https://mcp.example/messages', {
      debug: true,
    })
    client.initialized = true
    client.serverInfo = {
      protocolVersion: '2025-03-26',
      capabilities: {
        tools: {},
      },
      serverInfo: {
        name: 'test-server',
        version: '1.0.0',
      },
    }

    await client.connectSSE(frameStream(['data: {"jsonrpc":"2.0","id":"frame","result":{}}\n\n']))
    await client.getToolList()

    expect(logSpy).toHaveBeenCalledWith('MCP SSE Data', {
      eventName: '',
      data: '{"jsonrpc":"2.0","id":"frame","result":{}}',
    })
    expect(logSpy).toHaveBeenCalledWith('MCP Tools List Response', expect.anything())
  })
})

describe('MCP SSE duplicate id window', () => {
  it('caps duplicate-id memory and evicts the oldest retained id', async () => {
    expect(MCP_SSE_DEDUP_ID_LIMIT).toBeGreaterThanOrEqual(512)
    expect(MCP_SSE_DEDUP_ID_LIMIT).toBeLessThanOrEqual(2048)

    const client = new MCPClient('https://mcp.example/sse')
    client.sseIdDone = new WindowedSseIdDedup(3)
    const collector = collectClientEvents(client)

    try {
      await client.connectSSE(
        createSseStream([
          dataFrame({ jsonrpc: '2.0', id: 'response-0', result: { value: 0 } }),
          dataFrame({ jsonrpc: '2.0', id: 'response-1', result: { value: 1 } }),
          dataFrame({ jsonrpc: '2.0', id: 'response-2', result: { value: 2 } }),
          dataFrame({ jsonrpc: '2.0', id: 'response-3', result: { value: 3 } }),
        ]),
      )

      expect(client.sseIdDone.size).toBe(3)
      expect(client.sseIdDone.has('response-0')).toBe(false)
      expect(client.sseIdDone.has('response-1')).toBe(true)
      expect(client.sseIdDone.has('response-2')).toBe(true)
      expect(client.sseIdDone.has('response-3')).toBe(true)

      await client.connectSSE(
        createSseStream([dataFrame({ jsonrpc: '2.0', id: 'response-0', result: { value: 'evicted' } })]),
      )

      expect(client.sseIdDone.size).toBe(3)
      expect(collector.events.map((event) => event.data.id)).toEqual([
        'response-0',
        'response-1',
        'response-2',
        'response-3',
        'response-0',
      ])
    } finally {
      collector.stop()
      client.destroy()
    }
  })

  it('suppresses duplicate JSON-RPC response ids inside the retained window', async () => {
    const client = new MCPClient('https://mcp.example/sse')
    const collector = collectClientEvents(client)

    try {
      await client.connectSSE(
        createSseStream([
          dataFrame({ jsonrpc: '2.0', id: 'response-1', result: { value: 'first' } }),
          dataFrame({ jsonrpc: '2.0', id: 'response-1', result: { value: 'duplicate' } }),
          dataFrame({ jsonrpc: '2.0', id: 'response-2', result: { value: 'second' } }),
        ]),
      )

      expect(collector.events.map((event) => event.data.id)).toEqual(['response-1', 'response-2'])
      expect(client.sseIdDone.size).toBe(2)
    } finally {
      collector.stop()
      client.destroy()
    }
  })

  it('suppresses duplicate ping ids while preserving ping responses', async () => {
    const client = new MCPClient('https://mcp.example/sse')
    const requestSpy = vi.spyOn(client, 'request').mockResolvedValue({
      rpc: {
        jsonrpc: '2.0',
        id: 'ping-1',
        result: {},
      },
      http: {
        status: 200,
        headers: {},
      },
    })

    await client.connectSSE(
      createSseStream([
        dataFrame({ jsonrpc: '2.0', id: 'ping-1', method: 'ping' }),
        dataFrame({ jsonrpc: '2.0', id: 'ping-1', method: 'ping' }),
      ]),
    )

    expect(requestSpy).toHaveBeenCalledTimes(1)
    expect(requestSpy).toHaveBeenCalledWith(
      'response',
      {},
      {
        notifications: true,
        initMethod: 'none',
        id: 'ping-1',
      },
    )
    expect(client.sseIdDone.size).toBe(1)
    client.destroy()
  })
})
