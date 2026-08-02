import { afterEach, describe, expect, it, vi } from 'vitest'
import { reformatForOllama, resolveOllamaRequest, runOllama, runOllamaStream } from '../src/generation/ollama.js'
import { MAX_STREAM_BUFFER_CHARS, STREAM_BUFFER_OVERFLOW_ERROR } from '../src/generation/sse.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function ndjsonResponse(chunks: string[]): Response {
  const enc = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c))
      controller.close()
    },
  })
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'application/x-ndjson' },
  })
}

describe('reformatForOllama', () => {
  it('passes user / assistant / system rows through unchanged', () => {
    expect(
      reformatForOllama([
        { role: 'system', content: 's' },
        { role: 'user', content: 'u' },
        { role: 'assistant', content: 'a' },
      ]),
    ).toEqual([
      { role: 'system', content: 's' },
      { role: 'user', content: 'u' },
      { role: 'assistant', content: 'a' },
    ])
  })

  it('drops function roles and preserves Ollama tool-result rows', () => {
    expect(
      reformatForOllama([
        { role: 'user', content: 'u' },
        { role: 'function', content: 'fn out' },
        { role: 'tool', content: 'tool out', tool_name: 'lookup' },
        { role: 'assistant', content: 'a' },
      ]),
    ).toEqual([
      { role: 'user', content: 'u' },
      { role: 'tool', content: 'tool out', tool_name: 'lookup' },
      { role: 'assistant', content: 'a' },
    ])
  })

  it('converts OpenAI-style assistant tool_calls into Ollama argument objects', () => {
    expect(
      reformatForOllama([
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call-1',
              type: 'function',
              function: { name: 'lookup', arguments: '{"query":"weather"}' },
            },
          ],
        },
      ]),
    ).toEqual([
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            type: 'function',
            function: { name: 'lookup', arguments: { query: 'weather' } },
          },
        ],
      },
    ])
  })

  it('coerces non-string content to empty string instead of crashing', () => {
    expect(reformatForOllama([{ role: 'user', content: [{ type: 'text', text: 'hi' }] }])).toEqual([
      { role: 'user', content: '' },
    ])
  })
})

describe('resolveOllamaRequest', () => {
  it('returns null when model is missing', () => {
    expect(
      resolveOllamaRequest({
        messages: [{ role: 'user', content: 'hi' }],
        baseUrl: 'http://localhost:11434',
        signal: new AbortController().signal,
      }),
    ).toBeNull()
  })

  it('returns null when baseUrl is missing', () => {
    expect(
      resolveOllamaRequest({
        model: 'llama3',
        messages: [{ role: 'user', content: 'hi' }],
        baseUrl: '',
        signal: new AbortController().signal,
      }),
    ).toBeNull()
  })

  it('accepts tool-result rows as Ollama chat history', () => {
    const r = resolveOllamaRequest({
      model: 'llama3',
      messages: [{ role: 'tool', content: 'x', tool_name: 'lookup' }],
      baseUrl: 'http://localhost:11434',
      signal: new AbortController().signal,
    })
    expect(r?.messages).toEqual([{ role: 'tool', content: 'x', tool_name: 'lookup' }])
  })

  it('carries apiKey + sampler knobs through', () => {
    const r = resolveOllamaRequest({
      model: 'llama3',
      messages: [{ role: 'user', content: 'hi' }],
      baseUrl: 'http://localhost:11434',
      apiKey: 'tok',
      maxTokens: 512,
      temperature: 0.5,
      topP: 0.9,
      topK: 40,
      think: 'medium',
      signal: new AbortController().signal,
    })
    expect(r?.apiKey).toBe('tok')
    expect(r?.maxTokens).toBe(512)
    expect(r?.temperature).toBe(0.5)
    expect(r?.topP).toBe(0.9)
    expect(r?.topK).toBe(40)
    expect(r?.think).toBe('medium')
  })

  it('normalizes native function tools', () => {
    const r = resolveOllamaRequest({
      model: 'llama3',
      messages: [{ role: 'user', content: 'hi' }],
      baseUrl: 'http://localhost:11434',
      tools: [
        {
          type: 'function',
          function: {
            name: 'lookup',
            description: 'Look something up',
            parameters: { type: 'object', properties: { query: { type: 'string' } } },
          },
        },
      ],
      signal: new AbortController().signal,
    })
    expect(r?.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'lookup',
          description: 'Look something up',
          parameters: { type: 'object', properties: { query: { type: 'string' } } },
        },
      },
    ])
  })
})

describe('runOllama (buffered)', () => {
  it('POSTs to {baseUrl}/api/chat with stream:false and returns message.content', async () => {
    let captured: { url: string; init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      captured = { url, init }
      return ok({
        model: 'llama3',
        message: { role: 'assistant', content: 'ollama ok' },
        done: true,
        done_reason: 'stop',
        total_duration: 42,
        prompt_eval_count: 8,
        eval_count: 3,
      })
    })
    const resolved = resolveOllamaRequest({
      model: 'llama3',
      messages: [
        { role: 'system', content: 'be nice' },
        { role: 'user', content: 'hi' },
      ],
      baseUrl: 'http://localhost:11434',
      maxTokens: 128,
      temperature: 0.4,
      signal: new AbortController().signal,
    })!
    const r = await runOllama(resolved)
    expect(r).toEqual({
      type: 'success',
      result: 'ollama ok',
      model: 'llama3',
      apiMetadata: { total_duration: 42, prompt_eval_count: 8, eval_count: 3 },
    })
    expect(captured!.url).toBe('http://localhost:11434/api/chat')
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.model).toBe('llama3')
    expect(sent.stream).toBe(false)
    expect(sent.messages).toEqual([
      { role: 'system', content: 'be nice' },
      { role: 'user', content: 'hi' },
    ])
    expect(sent.options).toEqual({ num_predict: 128, temperature: 0.4 })
    const headers = captured!.init.headers as Record<string, string>
    expect(headers.authorization).toBeUndefined()
  })

  it('sends native Ollama tools when provided', async () => {
    const sentBodies: Record<string, unknown>[] = []
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      sentBodies.push(JSON.parse(init.body as string) as Record<string, unknown>)
      return ok({
        message: { role: 'assistant', content: 'tool-ready' },
        done: true,
      })
    })
    const resolved = resolveOllamaRequest({
      model: 'llama3',
      messages: [{ role: 'user', content: 'hi' }],
      baseUrl: 'http://localhost:11434',
      tools: [
        {
          type: 'function',
          function: {
            name: 'lookup',
            parameters: { type: 'object', properties: { query: { type: 'string' } } },
          },
        },
      ],
      signal: new AbortController().signal,
    })!
    await runOllama(resolved)
    expect(sentBodies[0]?.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'lookup',
          parameters: { type: 'object', properties: { query: { type: 'string' } } },
        },
      },
    ])
  })

  it.each([
    ['off', false],
    ['on', true],
    ['low', 'low'],
    ['medium', 'medium'],
    ['high', 'high'],
  ] as const)('maps the configured %s mode to Ollama think=%s', async (_mode, think) => {
    let sent: Record<string, unknown> = {}
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body)) as Record<string, unknown>
      return ok({ message: { content: 'answer' }, done: true })
    })
    const resolved = resolveOllamaRequest({
      model: 'deep-model',
      messages: [{ role: 'user', content: 'hi' }],
      baseUrl: 'http://localhost:11434',
      think,
      signal: new AbortController().signal,
    })!

    await runOllama(resolved)

    expect(sent.think).toBe(think)
  })

  it('combines buffered message.thinking and content in the shared envelope', async () => {
    vi.stubGlobal('fetch', async () =>
      ok({
        model: 'deep-model',
        message: { role: 'assistant', thinking: 'reasoning', content: 'answer' },
        done: true,
      }),
    )
    const resolved = resolveOllamaRequest({
      model: 'deep-model',
      messages: [{ role: 'user', content: 'hi' }],
      baseUrl: 'http://localhost:11434',
      signal: new AbortController().signal,
    })!

    expect(await runOllama(resolved)).toEqual({
      type: 'success',
      result: '<Thoughts>\nreasoning\n</Thoughts>\n\nanswer',
      model: 'deep-model',
    })
  })

  it('strips a trailing slash from baseUrl when composing the URL', async () => {
    let capturedUrl = ''
    vi.stubGlobal('fetch', async (url: string) => {
      capturedUrl = url
      return ok({ message: { content: 'x' }, done: true })
    })
    const resolved = resolveOllamaRequest({
      model: 'llama3',
      messages: [{ role: 'user', content: 'hi' }],
      baseUrl: 'http://localhost:11434/',
      signal: new AbortController().signal,
    })!
    await runOllama(resolved)
    expect(capturedUrl).toBe('http://localhost:11434/api/chat')
  })

  it('forwards Authorization: Bearer <apiKey> when provided', async () => {
    let captured: { init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = { init }
      return ok({ message: { content: 'x' }, done: true })
    })
    const resolved = resolveOllamaRequest({
      model: 'llama3',
      messages: [{ role: 'user', content: 'hi' }],
      baseUrl: 'http://localhost:11434',
      apiKey: 'reverse-proxy-token',
      signal: new AbortController().signal,
    })!
    await runOllama(resolved)
    const headers = captured!.init.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer reverse-proxy-token')
  })

  it('returns fail with parsed error message on non-2xx JSON', async () => {
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(JSON.stringify({ error: 'model not found' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        }),
    )
    const resolved = resolveOllamaRequest({
      model: 'llama3',
      messages: [{ role: 'user', content: 'hi' }],
      baseUrl: 'http://localhost:11434',
      signal: new AbortController().signal,
    })!
    expect(await runOllama(resolved)).toEqual({
      type: 'fail',
      result: 'model not found',
    })
  })

  it('falls back to raw body when upstream non-2xx is not JSON', async () => {
    vi.stubGlobal('fetch', async () => new Response('upstream down', { status: 503 }))
    const resolved = resolveOllamaRequest({
      model: 'llama3',
      messages: [{ role: 'user', content: 'hi' }],
      baseUrl: 'http://localhost:11434',
      signal: new AbortController().signal,
    })!
    expect(await runOllama(resolved)).toEqual({
      type: 'fail',
      result: 'upstream down',
    })
  })

  it('returns fail when upstream message.content is empty', async () => {
    vi.stubGlobal('fetch', async () => ok({ message: { content: '' }, done: true }))
    const resolved = resolveOllamaRequest({
      model: 'llama3',
      messages: [{ role: 'user', content: 'hi' }],
      baseUrl: 'http://localhost:11434',
      signal: new AbortController().signal,
    })!
    expect(await runOllama(resolved)).toEqual({
      type: 'fail',
      result: 'upstream returned no message content',
    })
  })

  it('returns aborted=true when signal is pre-aborted (no fetch called)', async () => {
    const c = new AbortController()
    c.abort()
    let called = false
    vi.stubGlobal('fetch', async () => {
      called = true
      return ok({ message: { content: 'x' }, done: true })
    })
    const resolved = resolveOllamaRequest({
      model: 'llama3',
      messages: [{ role: 'user', content: 'hi' }],
      baseUrl: 'http://localhost:11434',
      signal: c.signal,
    })!
    const r = await runOllama(resolved)
    expect(r.aborted).toBe(true)
    expect(called).toBe(false)
  })
})

describe('runOllamaStream', () => {
  it('hits /api/chat with stream:true and yields one token per NDJSON line then done', async () => {
    let captured: { url: string; init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      captured = { url, init }
      return ndjsonResponse([
        `${JSON.stringify({ model: 'llama3', message: { content: 'hi' }, done: false })}\n`,
        `${JSON.stringify({ model: 'llama3', message: { content: ' there' }, done: false })}\n`,
        `${JSON.stringify({
          model: 'llama3',
          message: { content: '' },
          done: true,
          done_reason: 'stop',
          total_duration: 42,
        })}\n`,
      ])
    })
    const resolved = resolveOllamaRequest({
      model: 'llama3',
      messages: [{ role: 'user', content: 'hi' }],
      baseUrl: 'http://localhost:11434',
      signal: new AbortController().signal,
    })!
    const frames: unknown[] = []
    for await (const f of runOllamaStream(resolved)) frames.push(f)
    expect(captured!.url).toBe('http://localhost:11434/api/chat')
    expect(JSON.parse(captured!.init.body as string).stream).toBe(true)
    expect(frames).toEqual([
      { kind: 'token', content: 'hi' },
      { kind: 'token', content: ' there' },
      { kind: 'done', finishReason: 'stop', apiMetadata: { model: 'llama3', total_duration: 42 } },
    ])
  })

  it('maps a length-truncated done_reason to "length"', async () => {
    vi.stubGlobal('fetch', async () =>
      ndjsonResponse([
        `${JSON.stringify({ message: { content: 'cut' }, done: false })}\n`,
        `${JSON.stringify({ message: { content: '' }, done: true, done_reason: 'length' })}\n`,
      ]),
    )
    const resolved = resolveOllamaRequest({
      model: 'llama3',
      messages: [{ role: 'user', content: 'hi' }],
      baseUrl: 'http://localhost:11434',
      signal: new AbortController().signal,
    })!
    const frames: unknown[] = []
    for await (const f of runOllamaStream(resolved)) frames.push(f)
    expect(frames.at(-1)).toEqual({ kind: 'done', finishReason: 'length' })
  })

  it('streams message.thinking before content in one shared envelope', async () => {
    vi.stubGlobal('fetch', async () =>
      ndjsonResponse([
        `${JSON.stringify({ message: { thinking: 'reason' }, done: false })}\n`,
        `${JSON.stringify({ message: { thinking: 'ing' }, done: false })}\n`,
        `${JSON.stringify({ message: { content: 'answer' }, done: false })}\n`,
        `${JSON.stringify({ message: {}, done: true, done_reason: 'stop' })}\n`,
      ]),
    )
    const resolved = resolveOllamaRequest({
      model: 'deep-model',
      messages: [{ role: 'user', content: 'hi' }],
      baseUrl: 'http://localhost:11434',
      signal: new AbortController().signal,
    })!
    const frames: unknown[] = []
    for await (const frame of runOllamaStream(resolved)) frames.push(frame)

    expect(frames).toEqual([
      { kind: 'token', content: '<Thoughts>\n' },
      { kind: 'token', content: 'reason' },
      { kind: 'token', content: 'ing' },
      { kind: 'token', content: '\n</Thoughts>\n\n' },
      { kind: 'token', content: 'answer' },
      { kind: 'done', finishReason: 'stop' },
    ])
  })

  it('reassembles an NDJSON line split across two reader reads', async () => {
    const big = JSON.stringify({ message: { content: 'split-content' }, done: false })
    const mid = Math.floor(big.length / 2)
    vi.stubGlobal('fetch', async () =>
      ndjsonResponse([
        big.slice(0, mid),
        `${big.slice(mid)}\n${JSON.stringify({ message: { content: '' }, done: true })}\n`,
      ]),
    )
    const resolved = resolveOllamaRequest({
      model: 'llama3',
      messages: [{ role: 'user', content: 'hi' }],
      baseUrl: 'http://localhost:11434',
      signal: new AbortController().signal,
    })!
    const frames: unknown[] = []
    for await (const f of runOllamaStream(resolved)) frames.push(f)
    expect(frames).toEqual([
      { kind: 'token', content: 'split-content' },
      { kind: 'done', finishReason: 'stop' },
    ])
  })

  it('emits an error when an NDJSON line is malformed', async () => {
    vi.stubGlobal('fetch', async () =>
      ndjsonResponse([
        `not-json\n`,
        `${JSON.stringify({ message: { content: 'after-bad-line' }, done: false })}\n`,
        `${JSON.stringify({ message: { content: '' }, done: true })}\n`,
      ]),
    )
    const resolved = resolveOllamaRequest({
      model: 'llama3',
      messages: [{ role: 'user', content: 'hi' }],
      baseUrl: 'http://localhost:11434',
      signal: new AbortController().signal,
    })!
    const frames: unknown[] = []
    for await (const f of runOllamaStream(resolved)) frames.push(f)
    expect(frames).toHaveLength(1)
    expect(frames[0]).toMatchObject({
      kind: 'error',
      error: expect.stringContaining('invalid upstream stream JSON'),
    })
  })

  it('yields nothing when signal is pre-aborted', async () => {
    const c = new AbortController()
    c.abort()
    vi.stubGlobal('fetch', async () =>
      ndjsonResponse([`${JSON.stringify({ message: { content: 'x' }, done: true })}\n`]),
    )
    const resolved = resolveOllamaRequest({
      model: 'llama3',
      messages: [{ role: 'user', content: 'hi' }],
      baseUrl: 'http://localhost:11434',
      signal: c.signal,
    })!
    const frames: unknown[] = []
    for await (const f of runOllamaStream(resolved)) frames.push(f)
    expect(frames).toEqual([])
  })

  it('emits an error frame with parsed message when upstream is non-2xx', async () => {
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(JSON.stringify({ error: 'model unavailable' }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        }),
    )
    const resolved = resolveOllamaRequest({
      model: 'llama3',
      messages: [{ role: 'user', content: 'hi' }],
      baseUrl: 'http://localhost:11434',
      signal: new AbortController().signal,
    })!
    const frames: unknown[] = []
    for await (const f of runOllamaStream(resolved)) frames.push(f)
    expect(frames).toEqual([
      {
        kind: 'error',
        error: 'Provider request failed: HTTP 500 from http://localhost:11434/api/chat: model unavailable',
        status: 500,
      },
    ])
  })

  it('emits an error frame with raw text when upstream non-2xx is not JSON', async () => {
    vi.stubGlobal('fetch', async () => new Response('bad gateway', { status: 502 }))
    const resolved = resolveOllamaRequest({
      model: 'llama3',
      messages: [{ role: 'user', content: 'hi' }],
      baseUrl: 'http://localhost:11434',
      signal: new AbortController().signal,
    })!
    const frames: unknown[] = []
    for await (const f of runOllamaStream(resolved)) frames.push(f)
    expect(frames).toEqual([
      {
        kind: 'error',
        error: 'Provider request failed: HTTP 502 from http://localhost:11434/api/chat: bad gateway',
        status: 502,
      },
    ])
  })

  it('emits an error frame when upstream has no stream body', async () => {
    vi.stubGlobal('fetch', async () => new Response(null, { status: 200 }))
    const resolved = resolveOllamaRequest({
      model: 'llama3',
      messages: [{ role: 'user', content: 'hi' }],
      baseUrl: 'http://localhost:11434',
      signal: new AbortController().signal,
    })!
    const frames: unknown[] = []
    for await (const f of runOllamaStream(resolved)) frames.push(f)
    expect(frames).toEqual([
      {
        kind: 'error',
        error:
          'Provider request failed: HTTP 200 from http://localhost:11434/api/chat: upstream returned no stream body',
        status: 200,
      },
    ])
  })

  it('emits an error frame when fetch fails', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('connection refused')
    })
    const resolved = resolveOllamaRequest({
      model: 'llama3',
      messages: [{ role: 'user', content: 'hi' }],
      baseUrl: 'http://localhost:11434',
      signal: new AbortController().signal,
    })!
    const frames: unknown[] = []
    for await (const f of runOllamaStream(resolved)) frames.push(f)
    expect(frames).toEqual([
      {
        kind: 'error',
        error: 'upstream fetch failed for http://localhost:11434/api/chat: connection refused',
        code: 'fetch_failed',
      },
    ])
  })

  it('emits an error frame when reading the upstream stream fails', async () => {
    vi.stubGlobal('fetch', async () => {
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.error(new Error('socket closed'))
        },
      })
      return new Response(body, {
        status: 200,
        headers: { 'content-type': 'application/x-ndjson' },
      })
    })
    const resolved = resolveOllamaRequest({
      model: 'llama3',
      messages: [{ role: 'user', content: 'hi' }],
      baseUrl: 'http://localhost:11434',
      signal: new AbortController().signal,
    })!
    const frames: unknown[] = []
    for await (const f of runOllamaStream(resolved)) frames.push(f)
    expect(frames).toEqual([{ kind: 'error', error: 'upstream stream read failed: socket closed' }])
  })

  it('emits an error frame when the final NDJSON object is malformed', async () => {
    vi.stubGlobal('fetch', async () =>
      ndjsonResponse([`${JSON.stringify({ message: { content: 'one' }, done: false })}\n`, '{bad-tail']),
    )
    const resolved = resolveOllamaRequest({
      model: 'llama3',
      messages: [{ role: 'user', content: 'hi' }],
      baseUrl: 'http://localhost:11434',
      signal: new AbortController().signal,
    })!
    const frames: unknown[] = []
    for await (const f of runOllamaStream(resolved)) frames.push(f)
    expect(frames[0]).toEqual({ kind: 'token', content: 'one' })
    expect(frames[1]).toMatchObject({
      kind: 'error',
      error: expect.stringContaining('invalid upstream stream JSON'),
    })
  })

  it('handles a final NDJSON object that lacks a trailing newline', async () => {
    vi.stubGlobal('fetch', async () =>
      ndjsonResponse([
        `${JSON.stringify({ message: { content: 'one' }, done: false })}\n`,
        JSON.stringify({ message: { content: '' }, done: true }),
      ]),
    )
    const resolved = resolveOllamaRequest({
      model: 'llama3',
      messages: [{ role: 'user', content: 'hi' }],
      baseUrl: 'http://localhost:11434',
      signal: new AbortController().signal,
    })!
    const frames: unknown[] = []
    for await (const f of runOllamaStream(resolved)) frames.push(f)
    expect(frames).toEqual([
      { kind: 'token', content: 'one' },
      { kind: 'done', finishReason: 'stop' },
    ])
  })

  it('L22: bounds the line buffer when upstream never sends a newline', async () => {
    const chunk = 'x'.repeat(1024 * 1024)
    vi.stubGlobal('fetch', async () =>
      ndjsonResponse(Array.from({ length: MAX_STREAM_BUFFER_CHARS / chunk.length + 2 }, () => chunk)),
    )
    const resolved = resolveOllamaRequest({
      model: 'llama3',
      messages: [{ role: 'user', content: 'hi' }],
      baseUrl: 'http://localhost:11434',
      signal: new AbortController().signal,
    })!
    const frames: unknown[] = []
    for await (const f of runOllamaStream(resolved)) frames.push(f)
    expect(frames).toEqual([{ kind: 'error', error: STREAM_BUFFER_OVERFLOW_ERROR }])
  })
})
