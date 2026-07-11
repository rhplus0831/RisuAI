import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveAnthropicRequest, runAnthropic, runAnthropicStream } from '../src/generation/anthropic.js'
import { MAX_STREAM_BUFFER_CHARS, STREAM_BUFFER_OVERFLOW_ERROR } from '../src/generation/sse.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('resolveAnthropicRequest', () => {
  it('returns null when apiKey is missing', () => {
    const r = resolveAnthropicRequest({
      model: 'claude-3-5-sonnet',
      messages: [],
      apiKey: '',
      signal: new AbortController().signal,
    })
    expect(r).toBeNull()
  })

  it('defaults baseUrl + version + maxTokens', () => {
    const r = resolveAnthropicRequest({
      model: 'claude-3-5-sonnet',
      messages: [],
      apiKey: 'k',
      signal: new AbortController().signal,
    })
    expect(r?.baseUrl).toBe('https://api.anthropic.com/v1')
    expect(r?.version).toBe('2023-06-01')
    expect(r?.maxTokens).toBe(1024)
  })

  it('drops a non-positive maxTokens to the default', () => {
    const r = resolveAnthropicRequest({
      model: 'claude-3-5-sonnet',
      messages: [],
      apiKey: 'k',
      maxTokens: 0,
      signal: new AbortController().signal,
    })
    expect(r?.maxTokens).toBe(1024)
  })

  it('keeps caller-supplied system / temperature / version', () => {
    const r = resolveAnthropicRequest({
      model: 'claude-3-5-sonnet',
      messages: [],
      apiKey: 'k',
      system: 'be brief',
      temperature: 0.3,
      version: '2024-10-22',
      signal: new AbortController().signal,
    })
    expect(r?.system).toBe('be brief')
    expect(r?.temperature).toBe(0.3)
    expect(r?.version).toBe('2024-10-22')
  })
})

describe('runAnthropic (non-streaming)', () => {
  function ok(body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  it('posts to {baseUrl}/messages with x-api-key + anthropic-version and concatenates text blocks', async () => {
    let captured: { url: string; init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      captured = { url, init }
      return ok({
        model: 'claude-3-5-sonnet-20241022',
        content: [
          { type: 'text', text: 'hello' },
          { type: 'text', text: ' world' },
        ],
        stop_reason: 'end_turn',
      })
    })

    const r = await runAnthropic({
      model: 'claude-3-5-sonnet-20241022',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'sk-ant-test',
      baseUrl: 'https://api.anthropic.com/v1',
      version: '2023-06-01',
      maxTokens: 1024,
      system: 'be concise',
      temperature: 0.4,
      signal: new AbortController().signal,
    })
    expect(r).toEqual({
      type: 'success',
      result: 'hello world',
      model: 'claude-3-5-sonnet-20241022',
    })

    expect(captured!.url).toBe('https://api.anthropic.com/v1/messages')
    const headers = captured!.init.headers as Record<string, string>
    expect(headers['x-api-key']).toBe('sk-ant-test')
    expect(headers['anthropic-version']).toBe('2023-06-01')
    expect(headers['content-type']).toBe('application/json')
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent).toEqual({
      model: 'claude-3-5-sonnet-20241022',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 1024,
      stream: false,
      system: 'be concise',
      temperature: 0.4,
    })
  })

  it('applies additionalParams to the body + headers after the default payload is built', async () => {
    let captured: { init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = { init }
      return ok({ content: [{ type: 'text', text: 'x' }] })
    })
    await runAnthropic({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'k',
      baseUrl: 'https://api.anthropic.com/v1',
      version: '2023-06-01',
      maxTokens: 512,
      temperature: 0.5,
      oneHourCache: true,
      additionalParams: [
        ['header::anthropic-beta', 'prompt-caching-2024-07-31'],
        ['extra.flag', 'true'],
        ['extra.nested.value', 'json::[1, 2]'],
        ['temperature', '{{none}}'],
      ],
      signal: new AbortController().signal,
    })
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.model).toBe('m')
    expect(sent.max_tokens).toBe(512)
    expect(sent.temperature).toBeUndefined()
    expect(sent.extra).toEqual({ flag: true, nested: { value: [1, 2] } })
    const headers = captured!.init.headers as Record<string, string>
    expect(headers['anthropic-beta']).toBe('prompt-caching-2024-07-31')
    expect(headers['x-api-key']).toBe('k')
  })

  it('adds the one-hour cache beta and forwards profile headers', async () => {
    let captured: { init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = { init }
      return ok({ content: [{ type: 'text', text: 'x' }] })
    })

    await runAnthropic({
      model: 'm',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'hi', cache_control: { type: 'ephemeral', ttl: '1h' } }] },
      ],
      apiKey: 'k',
      baseUrl: 'https://api.anthropic.com/v1',
      version: '2023-06-01',
      maxTokens: 512,
      oneHourCache: true,
      extraHeaders: { 'X-Profile': 'profile-value' },
      signal: new AbortController().signal,
    })

    const headers = captured!.init.headers as Record<string, string>
    expect(headers['anthropic-beta']).toBe('extended-cache-ttl-2025-04-11')
    expect(headers['X-Profile']).toBe('profile-value')
  })

  it('sends adaptive thinking controls and preserves returned thinking blocks', async () => {
    let captured: RequestInit | null = null
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = init
      return ok({
        content: [
          { type: 'thinking', thinking: 'reasoning' },
          { type: 'text', text: 'answer' },
        ],
      })
    })

    const result = await runAnthropic({
      model: 'claude-adaptive',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'k',
      baseUrl: 'https://api.anthropic.com/v1',
      version: '2023-06-01',
      maxTokens: 512,
      temperature: 0.5,
      topP: 0.8,
      topK: 20,
      thinkingType: 'adaptive',
      adaptiveThinkingEffort: 'xhigh',
      supportsAdaptiveThinking: true,
      supportsXHighEffort: false,
      signal: new AbortController().signal,
    })

    expect(result).toEqual({ type: 'success', result: '<Thoughts>\nreasoning</Thoughts>\n\nanswer' })
    expect(JSON.parse(captured!.body as string)).toMatchObject({
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort: 'high' },
    })
    const body = JSON.parse(captured!.body as string)
    expect(body.temperature).toBeUndefined()
    expect(body.top_p).toBeUndefined()
    expect(body.top_k).toBeUndefined()
  })

  it('omits system / temperature when not provided', async () => {
    let captured: { init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = { init }
      return ok({ content: [{ type: 'text', text: 'x' }] })
    })
    await runAnthropic({
      model: 'm',
      messages: [],
      apiKey: 'k',
      baseUrl: 'https://api.anthropic.com/v1',
      version: '2023-06-01',
      maxTokens: 512,
      signal: new AbortController().signal,
    })
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.system).toBeUndefined()
    expect(sent.temperature).toBeUndefined()
  })

  it('returns fail with upstream error.message on non-2xx', async () => {
    vi.stubGlobal('fetch', async () => {
      return new Response(JSON.stringify({ error: { message: 'invalid_api_key' } }), {
        status: 401,
      })
    })
    const r = await runAnthropic({
      model: 'm',
      messages: [],
      apiKey: 'bad',
      baseUrl: 'https://api.anthropic.com/v1',
      version: '2023-06-01',
      maxTokens: 1024,
      signal: new AbortController().signal,
    })
    expect(r).toEqual({ type: 'fail', result: 'invalid_api_key' })
  })

  it('returns fail when no text content blocks are present', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ content: [] }), { status: 200 }))
    const r = await runAnthropic({
      model: 'm',
      messages: [],
      apiKey: 'k',
      baseUrl: 'https://api.anthropic.com/v1',
      version: '2023-06-01',
      maxTokens: 1024,
      signal: new AbortController().signal,
    })
    expect(r).toEqual({ type: 'fail', result: 'upstream returned no text content' })
  })

  it('returns aborted=true when signal is already aborted', async () => {
    const c = new AbortController()
    c.abort()
    let called = false
    vi.stubGlobal('fetch', async () => {
      called = true
      return ok({ content: [{ type: 'text', text: 'x' }] })
    })
    const r = await runAnthropic({
      model: 'm',
      messages: [],
      apiKey: 'k',
      baseUrl: 'https://api.anthropic.com/v1',
      version: '2023-06-01',
      maxTokens: 1024,
      signal: c.signal,
    })
    expect(r.aborted).toBe(true)
    expect(called).toBe(false)
  })
})

function sseUpstream(chunks: string[]): Response {
  const enc = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c))
      controller.close()
    },
  })
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

function deltaEvent(text: string): string {
  return `event: content_block_delta\n` + `data: ${JSON.stringify({ delta: { type: 'text_delta', text } })}\n\n`
}

function messageDeltaEvent(stopReason: string): string {
  return `event: message_delta\n` + `data: ${JSON.stringify({ delta: { stop_reason: stopReason } })}\n\n`
}

const MESSAGE_STOP = `event: message_stop\ndata: {}\n\n`

function crlf(s: string): string {
  return s.replace(/\n/g, '\r\n')
}

describe('runAnthropicStream', () => {
  it('translates content_block_delta + message_stop into our envelope', async () => {
    vi.stubGlobal('fetch', async () => {
      return sseUpstream([
        `event: message_start\ndata: {}\n\n`,
        `event: content_block_start\ndata: {}\n\n`,
        deltaEvent('hello'),
        deltaEvent(' world'),
        messageDeltaEvent('end_turn'),
        MESSAGE_STOP,
      ])
    })
    const frames: unknown[] = []
    for await (const f of runAnthropicStream({
      model: 'claude-3-5-sonnet',
      messages: [],
      apiKey: 'k',
      baseUrl: 'https://api.anthropic.com/v1',
      version: '2023-06-01',
      maxTokens: 1024,
      signal: new AbortController().signal,
    })) {
      frames.push(f)
    }
    expect(frames).toEqual([
      { kind: 'token', content: 'hello' },
      { kind: 'token', content: ' world' },
      { kind: 'done', finishReason: 'stop' },
    ])
  })

  it('accepts CRLF-delimited upstream SSE frames', async () => {
    vi.stubGlobal('fetch', async () => {
      return sseUpstream([
        crlf(deltaEvent('hello')),
        crlf(deltaEvent(' world')),
        crlf(messageDeltaEvent('end_turn')),
        crlf(MESSAGE_STOP),
      ])
    })
    const frames: unknown[] = []
    for await (const f of runAnthropicStream({
      model: 'claude-3-5-sonnet',
      messages: [],
      apiKey: 'k',
      baseUrl: 'https://api.anthropic.com/v1',
      version: '2023-06-01',
      maxTokens: 1024,
      signal: new AbortController().signal,
    })) {
      frames.push(f)
    }
    expect(frames).toEqual([
      { kind: 'token', content: 'hello' },
      { kind: 'token', content: ' world' },
      { kind: 'done', finishReason: 'stop' },
    ])
  })

  it('maps stop_reason "max_tokens" to "length"', async () => {
    vi.stubGlobal('fetch', async () => {
      return sseUpstream([deltaEvent('cut'), messageDeltaEvent('max_tokens'), MESSAGE_STOP])
    })
    const frames: unknown[] = []
    for await (const f of runAnthropicStream({
      model: 'm',
      messages: [],
      apiKey: 'k',
      baseUrl: 'https://api.anthropic.com/v1',
      version: '2023-06-01',
      maxTokens: 1024,
      signal: new AbortController().signal,
    })) {
      frames.push(f)
    }
    expect(frames.at(-1)).toEqual({ kind: 'done', finishReason: 'length' })
  })

  it('emits a trailing done when upstream closes without message_stop', async () => {
    vi.stubGlobal('fetch', async () => sseUpstream([deltaEvent('partial')]))
    const frames: unknown[] = []
    for await (const f of runAnthropicStream({
      model: 'm',
      messages: [],
      apiKey: 'k',
      baseUrl: 'https://api.anthropic.com/v1',
      version: '2023-06-01',
      maxTokens: 1024,
      signal: new AbortController().signal,
    })) {
      frames.push(f)
    }
    expect(frames).toEqual([
      { kind: 'token', content: 'partial' },
      { kind: 'done', finishReason: 'stop' },
    ])
  })

  it('yields nothing when signal is pre-aborted', async () => {
    const c = new AbortController()
    c.abort()
    vi.stubGlobal('fetch', async () => sseUpstream([deltaEvent('x'), MESSAGE_STOP]))
    const frames: unknown[] = []
    for await (const f of runAnthropicStream({
      model: 'm',
      messages: [],
      apiKey: 'k',
      baseUrl: 'https://api.anthropic.com/v1',
      version: '2023-06-01',
      maxTokens: 1024,
      signal: c.signal,
    })) {
      frames.push(f)
    }
    expect(frames).toEqual([])
  })

  it('surfaces upstream non-OK responses as error frames', async () => {
    vi.stubGlobal('fetch', async () => {
      return new Response(JSON.stringify({ error: { message: 'overloaded', type: 'overloaded_error' } }), {
        status: 529,
        headers: { 'content-type': 'application/json' },
      })
    })
    const frames: unknown[] = []
    for await (const f of runAnthropicStream({
      model: 'm',
      messages: [],
      apiKey: 'k',
      baseUrl: 'https://api.anthropic.com/v1',
      version: '2023-06-01',
      maxTokens: 1024,
      signal: new AbortController().signal,
    })) {
      frames.push(f)
    }
    expect(frames).toEqual([
      {
        kind: 'error',
        error:
          'Provider request failed: HTTP 529 from https://api.anthropic.com/v1/messages (overloaded_error): overloaded',
        status: 529,
        code: 'overloaded_error',
      },
    ])
  })

  it('surfaces a missing upstream stream body as an error frame', async () => {
    vi.stubGlobal('fetch', async () => new Response(null, { status: 200 }))
    const frames: unknown[] = []
    for await (const f of runAnthropicStream({
      model: 'm',
      messages: [],
      apiKey: 'k',
      baseUrl: 'https://api.anthropic.com/v1',
      version: '2023-06-01',
      maxTokens: 1024,
      signal: new AbortController().signal,
    })) {
      frames.push(f)
    }
    expect(frames).toEqual([
      {
        kind: 'error',
        error:
          'Provider request failed: HTTP 200 from https://api.anthropic.com/v1/messages: upstream returned no stream body',
        status: 200,
      },
    ])
  })

  it('surfaces invalid upstream stream JSON as an error frame', async () => {
    vi.stubGlobal('fetch', async () => sseUpstream([`event: content_block_delta\ndata: {nope}\n\n`]))
    const frames: unknown[] = []
    for await (const f of runAnthropicStream({
      model: 'm',
      messages: [],
      apiKey: 'k',
      baseUrl: 'https://api.anthropic.com/v1',
      version: '2023-06-01',
      maxTokens: 1024,
      signal: new AbortController().signal,
    })) {
      frames.push(f)
    }
    expect(frames).toHaveLength(1)
    expect(frames[0]).toMatchObject({
      kind: 'error',
      error: expect.stringContaining('invalid upstream stream JSON'),
    })
  })

  it('surfaces unterminated upstream SSE tails as an error frame', async () => {
    vi.stubGlobal('fetch', async () => sseUpstream([`event: content_block_delta\ndata: {nope}`]))
    const frames: unknown[] = []
    for await (const f of runAnthropicStream({
      model: 'm',
      messages: [],
      apiKey: 'k',
      baseUrl: 'https://api.anthropic.com/v1',
      version: '2023-06-01',
      maxTokens: 1024,
      signal: new AbortController().signal,
    })) {
      frames.push(f)
    }
    expect(frames).toEqual([{ kind: 'error', error: 'truncated upstream stream event' }])
  })

  it('ignores ping and content_block_start/stop events', async () => {
    vi.stubGlobal('fetch', async () => {
      return sseUpstream([
        `event: ping\ndata: {}\n\n`,
        `event: content_block_start\ndata: {}\n\n`,
        deltaEvent('ok'),
        `event: content_block_stop\ndata: {}\n\n`,
        MESSAGE_STOP,
      ])
    })
    const frames: unknown[] = []
    for await (const f of runAnthropicStream({
      model: 'm',
      messages: [],
      apiKey: 'k',
      baseUrl: 'https://api.anthropic.com/v1',
      version: '2023-06-01',
      maxTokens: 1024,
      signal: new AbortController().signal,
    })) {
      frames.push(f)
    }
    expect(frames).toEqual([
      { kind: 'token', content: 'ok' },
      { kind: 'done', finishReason: 'stop' },
    ])
  })

  it('L22: bounds the accumulation buffer when upstream never sends an event delimiter', async () => {
    // > MAX_STREAM_BUFFER_CHARS of delimiter-less bytes, streamed in 1 MB
    // chunks. Without the cap the adapter would buffer the whole stream.
    const chunk = 'x'.repeat(1024 * 1024)
    vi.stubGlobal('fetch', async () =>
      sseUpstream(Array.from({ length: MAX_STREAM_BUFFER_CHARS / chunk.length + 2 }, () => chunk)),
    )
    const frames: unknown[] = []
    for await (const f of runAnthropicStream({
      model: 'm',
      messages: [],
      apiKey: 'k',
      baseUrl: 'https://api.anthropic.com/v1',
      version: '2023-06-01',
      maxTokens: 1024,
      signal: new AbortController().signal,
    })) {
      frames.push(f)
    }
    expect(frames).toEqual([{ kind: 'error', error: STREAM_BUFFER_OVERFLOW_ERROR }])
  })
})
