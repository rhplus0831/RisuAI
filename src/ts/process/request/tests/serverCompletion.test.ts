import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

import { LLMFormat } from '../../../model/types'
import type { character } from '../../../storage/database.svelte'
import type { RequestDataArgumentExtended } from '../request'
import {
  extractAnthropicSystem,
  getServerCompletionProvider,
  requestServerCompletion,
  resolveServerCompletionRoute,
} from '../serverCompletion'

function makeTarg(overrides: Partial<RequestDataArgumentExtended> = {}): RequestDataArgumentExtended {
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
    maxTokens: 64,
    temperature: 0.4,
    mode: 'memory',
    currentChar: { name: 'Mira' } as character,
    ...overrides,
  } as RequestDataArgumentExtended
}

beforeEach(() => {})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('resolveServerCompletionRoute', () => {
  it('routes Fastify completion by server intent without exposing a provider', () => {
    expect(resolveServerCompletionRoute(makeTarg())).toEqual({ type: 'server' })
    expect(getServerCompletionProvider(makeTarg())).toBe('server-intent')
  })

  it('rejects provider preview bodies in Fastify mode', () => {
    const route = resolveServerCompletionRoute(makeTarg({ previewBody: true }))
    expect(route.type).toBe('unsupported')
    expect(route).toEqual({
      type: 'unsupported',
      reason:
        'Provider preview bodies are not supported in Fastify server mode because browser-side provider dispatch is disabled.',
    })
  })
})

describe('requestServerCompletion', () => {
  it('posts server-owned completion intent without provider wire options or secrets', async () => {
    let captured: { url: string; init: RequestInit } | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        captured = { url, init }
        return new Response(JSON.stringify({ type: 'success', result: 'ok' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }),
    )

    const result = await requestServerCompletion(makeTarg(), null)

    expect(result).toEqual({ type: 'success', result: 'ok' })
    expect(captured!.url).toBe('/api/v1/generate/completion')
    expect((captured!.init.headers as Record<string, string>)['risu-auth']).toBe('test-auth-token')
    const payload = JSON.parse(captured!.init.body as string)
    expect(payload).toEqual({
      kind: 'server-intent',
      messages: [{ role: 'user', content: 'hi' }],
      stream: false,
      mode: 'memory',
      maxTokens: 64,
      temperature: 0.4,
      currentCharName: 'Mira',
    })
    expect(JSON.stringify(payload)).not.toMatch(/"provider"|"model"|"options"|"apiKey"|"baseUrl"|"credentials"/)
  })

  it('passes static model intent when the caller provides one', async () => {
    let payload: Record<string, unknown> | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        payload = JSON.parse(init.body as string)
        return new Response(JSON.stringify({ type: 'success', result: 'ok' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }),
    )

    await requestServerCompletion(makeTarg({ staticModel: 'echo_model' }), null)

    expect(payload?.staticModel).toBe('echo_model')
  })

  it('returns a noRetry failure when the server rejects the intent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: 'unsupported provider' }), {
            status: 400,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    )

    await expect(requestServerCompletion(makeTarg(), null)).resolves.toEqual({
      type: 'fail',
      result: 'unsupported provider',
      noRetry: true,
    })
  })

  it('reads server completion SSE streams', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder()
        controller.enqueue(
          encoder.encode(
            `event: chunk\ndata: ${JSON.stringify({ type: 'token', content: 'he' })}\n\n` +
              `event: chunk\ndata: ${JSON.stringify({ type: 'token', content: 'llo' })}\n\n` +
              `event: done\ndata: ${JSON.stringify({ finishReason: 'stop' })}\n\n`,
          ),
        )
        controller.close()
      },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(stream, { status: 200 })),
    )

    await expect(requestServerCompletion(makeTarg({ useStreaming: true }), null)).resolves.toEqual({
      type: 'success',
      result: 'hello',
    })
  })
})

describe('extractAnthropicSystem', () => {
  it('extracts string system messages and preserves other rows', () => {
    const result = extractAnthropicSystem([
      { role: 'system', content: 'a' },
      { role: 'user', content: 'hi' },
      { role: 'system', content: 'b' },
    ])

    expect(result).toEqual({
      messages: [{ role: 'user', content: 'hi' }],
      system: 'a\n\nb',
    })
  })
})
