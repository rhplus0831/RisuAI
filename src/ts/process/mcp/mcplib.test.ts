import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fetchNativeMock = vi.hoisted(() => vi.fn())

vi.mock('../../globalApi.svelte', () => ({
  fetchNative: fetchNativeMock,
  openURL: vi.fn(),
}))

vi.mock('../../alert', () => ({
  alertInput: vi.fn(),
}))

import { MCPClient, type JsonRPC } from './mcplib'

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
  const addSpy = vi.spyOn(document, 'addEventListener').mockImplementation(
    (
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) => {
      if (type === 'mcp-sse') {
        listeners.add(listener)
      }
      return originalAdd(type, listener, options)
    },
  )
  const removeSpy = vi.spyOn(document, 'removeEventListener').mockImplementation(
    (
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | EventListenerOptions,
    ) => {
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

beforeEach(() => {
  fetchNativeMock.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  fetchNativeMock.mockReset()
})

describe('MCPClient deadlines and SSE listener cleanup', () => {
  it('M20: aborts a hung MCP HTTP request at the configured deadline', async () => {
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

  it('L54: times out unmatched MCP SSE responses and removes the document listener', async () => {
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

  it('L54: removes the SSE listener after a matching MCP response', async () => {
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

  it('L54: removes the SSE listener when the initial POST aborts at the deadline', async () => {
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

  it('L54: text/event-stream response waits time out and remove their listener', async () => {
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

  it('M20: times out the fallback SSE handshake endpoint wait and removes its listener', async () => {
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

describe('MCPClient debug logging', () => {
  it('L57: keeps MCP frame and tools-list payload logs silent by default', async () => {
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

    await client.connectSSE(
      frameStream(['data: {"jsonrpc":"2.0","id":"frame","result":{}}\n\n']),
    )
    await client.getToolList()

    expect(logSpy).not.toHaveBeenCalledWith('MCP SSE Data', expect.anything())
    expect(logSpy).not.toHaveBeenCalledWith('MCP Tools List Response', expect.anything())
  })

  it('L57: emits MCP frame and tools-list payload logs when debug is enabled', async () => {
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

    await client.connectSSE(
      frameStream(['data: {"jsonrpc":"2.0","id":"frame","result":{}}\n\n']),
    )
    await client.getToolList()

    expect(logSpy).toHaveBeenCalledWith('MCP SSE Data', {
      eventName: '',
      data: '{"jsonrpc":"2.0","id":"frame","result":{}}',
    })
    expect(logSpy).toHaveBeenCalledWith('MCP Tools List Response', expect.anything())
  })
})
