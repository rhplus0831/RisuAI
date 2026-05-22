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

vi.mock('../../modules', async (importActual) => {
  const actual = await importActual<typeof import('../../modules')>()
  return { ...actual, moduleUpdate: () => {}, getModuleToggles: () => '' }
})

import { LLMFormat } from '../../../model/types'
import { setDatabase, type Database } from '../../../storage/database.svelte'
import { DBState } from '../../../stores.svelte'
import type { RequestDataArgumentExtended } from '../request'
import {
  formatToServerProvider,
  getServerCompletionProvider,
  requestServerCompletion,
} from '../serverCompletion'

function seedDb(overrides: Partial<Database> = {}): void {
  const seed = {
    aiModel: 'echo_model',
    subModel: 'echo_model',
    characters: [],
    maxContext: 4000,
    botPresetsId: 0,
    statics: { messages: 0 } as unknown as Database['statics'],
    promptInfoInsideChat: false,
    useServerGeneration: true,
    echoMessage: 'Echo Message',
    echoDelay: 0,
    ...overrides,
  } as unknown as Database
  setDatabase(seed)
  if (overrides.useServerGeneration !== undefined) {
    DBState.db.useServerGeneration = overrides.useServerGeneration
  }
  if (overrides.echoMessage !== undefined) {
    DBState.db.echoMessage = overrides.echoMessage
  }
  if (overrides.echoDelay !== undefined) {
    DBState.db.echoDelay = overrides.echoDelay
  }
}

function makeTarg(
  overrides: Partial<RequestDataArgumentExtended> = {},
): RequestDataArgumentExtended {
  return {
    bias: {},
    formated: [{ role: 'user', content: 'hi' }],
    aiModel: 'echo_model',
    modelInfo: {
      id: 'echo_model',
      name: 'Echo',
      internalID: 'echo_model',
      provider: 0 as never,
      format: LLMFormat.Echo,
      flags: [],
      parameters: [],
      tokenizer: 0 as never,
      recommended: false,
    } as unknown as RequestDataArgumentExtended['modelInfo'],
    useStreaming: false,
    ...overrides,
  } as RequestDataArgumentExtended
}

beforeEach(() => {
  platformState.isFastifyServer = true
  seedDb()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('formatToServerProvider', () => {
  it('maps Echo to "echo"', () => {
    expect(formatToServerProvider(LLMFormat.Echo)).toBe('echo')
  })

  it('returns null for OpenAICompatible (not yet server-routable)', () => {
    expect(formatToServerProvider(LLMFormat.OpenAICompatible)).toBeNull()
  })

  it('returns null for AWSBedrockClaude (not yet server-routable)', () => {
    expect(formatToServerProvider(LLMFormat.AWSBedrockClaude)).toBeNull()
  })
})

describe('getServerCompletionProvider', () => {
  it('returns the provider when every gate passes', () => {
    const r = getServerCompletionProvider(makeTarg())
    expect(r).toBe('echo')
  })

  it('returns null when isFastifyServer is false', () => {
    platformState.isFastifyServer = false
    const r = getServerCompletionProvider(makeTarg())
    expect(r).toBeNull()
  })

  it('returns null when db.useServerGeneration is false', () => {
    seedDb({ useServerGeneration: false })
    const r = getServerCompletionProvider(makeTarg())
    expect(r).toBeNull()
  })

  it('returns null when previewBody is true (preview-prompt stays local)', () => {
    const r = getServerCompletionProvider(makeTarg({ previewBody: true }))
    expect(r).toBeNull()
  })

  it('returns null for a format with no server implementation yet', () => {
    const r = getServerCompletionProvider(
      makeTarg({
        modelInfo: {
          id: 'gpt-4o',
          format: LLMFormat.OpenAICompatible,
        } as unknown as RequestDataArgumentExtended['modelInfo'],
      }),
    )
    expect(r).toBeNull()
  })
})

describe('requestServerCompletion - non-streaming', () => {
  it('posts the right body + headers and returns success result', async () => {
    let captured: { url: string; init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      captured = { url, init }
      return new Response(
        JSON.stringify({ type: 'success', result: 'pong' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    })

    const r = await requestServerCompletion(makeTarg(), 'echo', null)
    expect(r).toEqual({ type: 'success', result: 'pong' })

    expect(captured!.url).toBe('/api/v1/generate/completion')
    expect((captured!.init.headers as Record<string, string>)['risu-auth']).toBe(
      'test-auth-token',
    )
    expect((captured!.init.headers as Record<string, string>)['content-type']).toBe(
      'application/json',
    )
    const sent = JSON.parse(captured!.init.body as string) as {
      provider: string
      model: string
      stream: boolean
      messages: unknown[]
      options: { echo: { message: string; delayMs: number } }
    }
    expect(sent.provider).toBe('echo')
    expect(sent.model).toBe('echo_model')
    expect(sent.stream).toBe(false)
    expect(sent.messages).toEqual([{ role: 'user', content: 'hi' }])
    expect(sent.options.echo).toEqual({ message: 'Echo Message', delayMs: 0 })
  })

  it('multiplies db.echoDelay (seconds) into delayMs (milliseconds)', async () => {
    seedDb({ echoDelay: 2, echoMessage: 'pong' })
    let captured: { init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = { init }
      return new Response(JSON.stringify({ type: 'success', result: 'pong' }), {
        status: 200,
      })
    })

    await requestServerCompletion(makeTarg(), 'echo', null)
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.options.echo).toEqual({ message: 'pong', delayMs: 2000 })
  })

  it('returns fail when the server returns {type: "fail"}', async () => {
    vi.stubGlobal('fetch', async () => {
      return new Response(
        JSON.stringify({ type: 'fail', result: 'upstream broke' }),
        { status: 200 },
      )
    })
    const r = await requestServerCompletion(makeTarg(), 'echo', null)
    expect(r).toEqual({ type: 'fail', result: 'upstream broke' })
  })

  it('extracts `reason` from a non-2xx JSON body', async () => {
    vi.stubGlobal('fetch', async () => {
      return new Response(
        JSON.stringify({
          reason: 'provider not implemented in Phase 6-1: openai',
        }),
        { status: 501 },
      )
    })
    const r = await requestServerCompletion(makeTarg(), 'openai', null)
    expect(r).toEqual({
      type: 'fail',
      result: 'provider not implemented in Phase 6-1: openai',
    })
  })

  it('extracts `error` from a non-2xx JSON body', async () => {
    vi.stubGlobal('fetch', async () => {
      return new Response(JSON.stringify({ error: 'Auth required' }), {
        status: 401,
      })
    })
    const r = await requestServerCompletion(makeTarg(), 'echo', null)
    expect(r).toEqual({ type: 'fail', result: 'Auth required' })
  })

  it('returns "Network error: ..." when fetch throws', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('connection refused')
    })
    const r = await requestServerCompletion(makeTarg(), 'echo', null)
    expect(r.type).toBe('fail')
    expect((r as { result: string }).result).toContain('Network error')
    expect((r as { result: string }).result).toContain('connection refused')
  })

  it('returns "Aborted" when the signal is aborted before fetch resolves', async () => {
    const c = new AbortController()
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      const sig = init.signal
      throw Object.assign(new Error('aborted'), {
        name: sig?.aborted ? 'AbortError' : 'Error',
      })
    })
    c.abort()
    const r = await requestServerCompletion(makeTarg(), 'echo', c.signal)
    expect(r).toEqual({ type: 'fail', result: 'Aborted' })
  })
})

function makeSseResponse(chunks: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder()
      for (const c of chunks) controller.enqueue(enc.encode(c))
      controller.close()
    },
  })
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

describe('requestServerCompletion - streaming', () => {
  it('parses a single token frame + done into a success result', async () => {
    vi.stubGlobal('fetch', async () => {
      return makeSseResponse([
        `event: chunk\ndata: ${JSON.stringify({ type: 'token', content: 'hello' })}\n\n`,
        `event: done\ndata: ${JSON.stringify({ finishReason: 'stop' })}\n\n`,
      ])
    })
    const r = await requestServerCompletion(
      makeTarg({ useStreaming: true }),
      'echo',
      null,
    )
    expect(r).toEqual({ type: 'success', result: 'hello' })
  })

  it('concatenates content across multiple chunk frames', async () => {
    vi.stubGlobal('fetch', async () => {
      return makeSseResponse([
        `event: chunk\ndata: ${JSON.stringify({ type: 'token', content: 'foo ' })}\n\n`,
        `event: chunk\ndata: ${JSON.stringify({ type: 'token', content: 'bar' })}\n\n`,
        `event: done\ndata: ${JSON.stringify({ finishReason: 'stop' })}\n\n`,
      ])
    })
    const r = await requestServerCompletion(
      makeTarg({ useStreaming: true }),
      'echo',
      null,
    )
    expect(r).toEqual({ type: 'success', result: 'foo bar' })
  })

  it('parses events even when a single chunk contains a partial frame', async () => {
    vi.stubGlobal('fetch', async () => {
      return makeSseResponse([
        `event: chunk\ndata: ${JSON.stringify({ type: 'token', content: 'foo' })}`,
        `\n\nevent: chunk\ndata: ${JSON.stringify({ type: 'token', content: 'bar' })}\n\n`,
        `event: done\ndata: ${JSON.stringify({ finishReason: 'stop' })}\n\n`,
      ])
    })
    const r = await requestServerCompletion(
      makeTarg({ useStreaming: true }),
      'echo',
      null,
    )
    expect(r).toEqual({ type: 'success', result: 'foobar' })
  })

  it('returns Aborted when the signal aborts mid-stream', async () => {
    const c = new AbortController()
    vi.stubGlobal('fetch', async () => {
      // Stream that never finishes — only aborts can close it.
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const enc = new TextEncoder()
          controller.enqueue(
            enc.encode(
              `event: chunk\ndata: ${JSON.stringify({ type: 'token', content: 'partial' })}\n\n`,
            ),
          )
          // Trigger the abort after the consumer reads the first chunk.
          setTimeout(() => {
            c.abort()
            try {
              controller.close()
            } catch {
              // ignore
            }
          }, 5)
        },
      })
      return new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
    })

    const r = await requestServerCompletion(
      makeTarg({ useStreaming: true }),
      'echo',
      c.signal,
    )
    expect(r).toEqual({ type: 'fail', result: 'Aborted' })
  })

  it('returns fail when streaming response has no body', async () => {
    vi.stubGlobal('fetch', async () => {
      return new Response(null, { status: 200 })
    })
    const r = await requestServerCompletion(
      makeTarg({ useStreaming: true }),
      'echo',
      null,
    )
    expect(r).toEqual({ type: 'fail', result: 'No streaming body returned' })
  })
})
