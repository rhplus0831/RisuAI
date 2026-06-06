import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../globalApi.svelte', () => ({
  fetchNative: vi.fn(),
  openURL: vi.fn(),
}))

vi.mock('../../alert', () => ({
  alertInput: vi.fn(),
}))

import {
  MCPClient,
  MCP_SSE_DEDUP_ID_LIMIT,
  type SseEventDetail,
  WindowedSseIdDedup,
} from './mcplib'

function createSseStream(frames: readonly string[]): ReadableStream<Uint8Array> {
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

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('MCP SSE duplicate id window', () => {
  it('L46: caps duplicate-id memory and evicts the oldest retained id', async () => {
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
        createSseStream([
          dataFrame({ jsonrpc: '2.0', id: 'response-0', result: { value: 'evicted' } }),
        ]),
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

  it('L46: suppresses duplicate JSON-RPC response ids inside the retained window', async () => {
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

      expect(collector.events.map((event) => event.data.id)).toEqual([
        'response-1',
        'response-2',
      ])
      expect(client.sseIdDone.size).toBe(2)
    } finally {
      collector.stop()
      client.destroy()
    }
  })

  it('L46: suppresses duplicate ping ids while preserving ping responses', async () => {
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
    expect(requestSpy).toHaveBeenCalledWith('response', {}, {
      notifications: true,
      initMethod: 'none',
      id: 'ping-1',
    })
    expect(client.sseIdDone.size).toBe(1)
    client.destroy()
  })
})
