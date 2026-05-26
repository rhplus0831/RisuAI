import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyOobaSystemHoist,
  resolveOpenAIRequest,
  runOpenAI,
  runOpenAIStream,
} from '../src/generation/openai.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('applyOobaSystemHoist', () => {
  it('returns the same messages array when no system rows are present', () => {
    const msgs = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]
    expect(applyOobaSystemHoist(msgs)).toBe(msgs)
  })

  it('removes systems in place and appends a single trailing system with joined content', () => {
    const r = applyOobaSystemHoist([
      { role: 'system', content: 'a' },
      { role: 'user', content: 'q' },
      { role: 'system', content: 'b' },
    ])
    expect(r).toEqual([
      { role: 'user', content: 'q' },
      { role: 'system', content: 'a\nb' },
    ])
  })

  it('passes through non-string content (multimodal systems) unchanged', () => {
    const multimodal = [{ type: 'text', text: 'hello' }]
    const r = applyOobaSystemHoist([
      { role: 'system', content: multimodal },
      { role: 'user', content: 'q' },
    ])
    expect(r).toEqual([
      { role: 'system', content: multimodal },
      { role: 'user', content: 'q' },
    ])
  })
})

describe('resolveOpenAIRequest', () => {
  it('returns null when apiKey is missing', () => {
    const r = resolveOpenAIRequest({
      model: 'gpt-4o',
      messages: [],
      apiKey: '',
      signal: new AbortController().signal,
    })
    expect(r).toBeNull()
  })

  it('returns null when messages is not an array', () => {
    const r = resolveOpenAIRequest({
      model: 'gpt-4o',
      messages: 'oops' as unknown as unknown[],
      apiKey: 'sk-x',
      signal: new AbortController().signal,
    })
    expect(r).toBeNull()
  })

  it('defaults baseUrl to api.openai.com when not provided', () => {
    const r = resolveOpenAIRequest({
      model: 'gpt-4o',
      messages: [],
      apiKey: 'sk-x',
      signal: new AbortController().signal,
    })
    expect(r?.baseUrl).toBe('https://api.openai.com/v1')
  })

  it('drops a non-positive maxTokens', () => {
    const r = resolveOpenAIRequest({
      model: 'gpt-4o',
      messages: [],
      apiKey: 'sk-x',
      maxTokens: 0,
      signal: new AbortController().signal,
    })
    expect(r?.maxTokens).toBeUndefined()
  })

  it('keeps a positive maxTokens and a finite temperature', () => {
    const r = resolveOpenAIRequest({
      model: 'gpt-4o',
      messages: [],
      apiKey: 'sk-x',
      maxTokens: 256,
      temperature: 0.4,
      signal: new AbortController().signal,
    })
    expect(r?.maxTokens).toBe(256)
    expect(r?.temperature).toBe(0.4)
  })
})

describe('runOpenAI (non-streaming)', () => {
  function ok(body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  it('posts to {baseUrl}/chat/completions with Bearer auth and returns the assistant content', async () => {
    let captured: { url: string; init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      captured = { url, init }
      return ok({
        model: 'gpt-4o',
        choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }],
      })
    })

    const r = await runOpenAI({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      maxTokens: 64,
      temperature: 0.2,
      signal: new AbortController().signal,
    })
    expect(r).toEqual({ type: 'success', result: 'hello', model: 'gpt-4o' })

    expect(captured!.url).toBe('https://api.openai.com/v1/chat/completions')
    const headers = captured!.init.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer sk-test')
    expect(headers['content-type']).toBe('application/json')
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent).toEqual({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      stream: false,
      max_tokens: 64,
      temperature: 0.2,
    })
  })

  it('merges extraHeaders into the upstream request', async () => {
    let capturedHeaders: Record<string, string> = {}
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      capturedHeaders = init.headers as Record<string, string>
      return ok({ choices: [{ message: { content: 'x' } }] })
    })
    await runOpenAI({
      model: 'm',
      messages: [],
      apiKey: 'k',
      baseUrl: 'https://api.openai.com/v1',
      extraHeaders: { 'X-Title': 'RisuAI', 'HTTP-Referer': 'https://risuai.xyz' },
      signal: new AbortController().signal,
    })
    expect(capturedHeaders['X-Title']).toBe('RisuAI')
    expect(capturedHeaders['HTTP-Referer']).toBe('https://risuai.xyz')
    expect(capturedHeaders.authorization).toBe('Bearer k')
  })

  it('hoists every system message into a single trailing system row when oobaSystemHoist is set', async () => {
    let captured: { init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = { init }
      return ok({ choices: [{ message: { content: 'x' } }] })
    })
    await runOpenAI({
      model: 'm',
      messages: [
        { role: 'system', content: 'rule 1' },
        { role: 'user', content: 'q' },
        { role: 'system', content: 'rule 2' },
        { role: 'assistant', content: 'a' },
      ],
      apiKey: 'k',
      baseUrl: 'https://api.openai.com/v1',
      oobaSystemHoist: true,
      signal: new AbortController().signal,
    })
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.messages).toEqual([
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'a' },
      { role: 'system', content: 'rule 1\nrule 2' },
    ])
  })

  it('leaves messages untouched when oobaSystemHoist is undefined/false', async () => {
    let captured: { init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = { init }
      return ok({ choices: [{ message: { content: 'x' } }] })
    })
    await runOpenAI({
      model: 'm',
      messages: [
        { role: 'system', content: 'rule 1' },
        { role: 'user', content: 'q' },
      ],
      apiKey: 'k',
      baseUrl: 'https://api.openai.com/v1',
      signal: new AbortController().signal,
    })
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.messages).toEqual([
      { role: 'system', content: 'rule 1' },
      { role: 'user', content: 'q' },
    ])
  })

  it('applies additionalParams to the body + headers after the default payload is built', async () => {
    let captured: { init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = { init }
      return ok({ choices: [{ message: { content: 'x' } }] })
    })
    await runOpenAI({
      model: 'm',
      messages: [],
      apiKey: 'k',
      baseUrl: 'https://api.openai.com/v1',
      maxTokens: 256,
      temperature: 0.7,
      additionalParams: [
        ['header::X-Title', 'RisuAI'],
        ['extra.flag', 'true'],
        ['extra.nested.value', 'json::[1, 2]'],
        ['temperature', '{{none}}'],
      ],
      signal: new AbortController().signal,
    })
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.model).toBe('m')
    expect(sent.max_tokens).toBe(256)
    expect(sent.temperature).toBeUndefined()
    expect(sent.extra).toEqual({ flag: true, nested: { value: [1, 2] } })
    const headers = captured!.init.headers as Record<string, string>
    expect(headers['X-Title']).toBe('RisuAI')
  })

  it('strips a trailing slash from baseUrl', async () => {
    let capturedUrl = ''
    vi.stubGlobal('fetch', async (url: string) => {
      capturedUrl = url
      return ok({ choices: [{ message: { content: 'x' } }] })
    })
    await runOpenAI({
      model: 'm',
      messages: [],
      apiKey: 'k',
      baseUrl: 'https://api.openai.com/v1/',
      signal: new AbortController().signal,
    })
    expect(capturedUrl).toBe('https://api.openai.com/v1/chat/completions')
  })

  it('returns fail with upstream error.message on non-2xx', async () => {
    vi.stubGlobal('fetch', async () => {
      return new Response(JSON.stringify({ error: { message: 'invalid model' } }), {
        status: 400,
      })
    })
    const r = await runOpenAI({
      model: 'badmodel',
      messages: [],
      apiKey: 'k',
      baseUrl: 'https://api.openai.com/v1',
      signal: new AbortController().signal,
    })
    expect(r).toEqual({ type: 'fail', result: 'invalid model' })
  })

  it('falls back to HTTP <status> when error.message is absent', async () => {
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 500 }))
    const r = await runOpenAI({
      model: 'm',
      messages: [],
      apiKey: 'k',
      baseUrl: 'https://api.openai.com/v1',
      signal: new AbortController().signal,
    })
    expect(r).toEqual({ type: 'fail', result: 'HTTP 500' })
  })

  it('returns fail when upstream returns no content', async () => {
    vi.stubGlobal('fetch', async () => ok({ choices: [{ message: {} }] }))
    const r = await runOpenAI({
      model: 'm',
      messages: [],
      apiKey: 'k',
      baseUrl: 'https://api.openai.com/v1',
      signal: new AbortController().signal,
    })
    expect(r).toEqual({ type: 'fail', result: 'upstream returned no content' })
  })

  it('returns aborted=true when signal is already aborted', async () => {
    const c = new AbortController()
    c.abort()
    let called = false
    vi.stubGlobal('fetch', async () => {
      called = true
      return ok({ choices: [{ message: { content: 'x' } }] })
    })
    const r = await runOpenAI({
      model: 'm',
      messages: [],
      apiKey: 'k',
      baseUrl: 'https://api.openai.com/v1',
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

function tokenFrame(content: string, finish?: string): string {
  const frame = {
    choices: [finish ? { delta: { content }, finish_reason: finish } : { delta: { content } }],
  }
  return `data: ${JSON.stringify(frame)}\n\n`
}

describe('runOpenAIStream', () => {
  it('translates upstream deltas into our token frames + a trailing done', async () => {
    vi.stubGlobal('fetch', async () => {
      return sseUpstream([tokenFrame('hello'), tokenFrame(' world'), `data: [DONE]\n\n`])
    })
    const frames: unknown[] = []
    for await (const f of runOpenAIStream({
      model: 'gpt-4o',
      messages: [],
      apiKey: 'k',
      baseUrl: 'https://api.openai.com/v1',
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

  it('emits a done frame at end-of-stream when upstream omits [DONE]', async () => {
    vi.stubGlobal('fetch', async () => sseUpstream([tokenFrame('only')]))
    const frames: unknown[] = []
    for await (const f of runOpenAIStream({
      model: 'gpt-4o',
      messages: [],
      apiKey: 'k',
      baseUrl: 'https://api.openai.com/v1',
      signal: new AbortController().signal,
    })) {
      frames.push(f)
    }
    expect(frames).toEqual([
      { kind: 'token', content: 'only' },
      { kind: 'done', finishReason: 'stop' },
    ])
  })

  it('propagates upstream finish_reason through the done frame', async () => {
    vi.stubGlobal('fetch', async () => {
      return sseUpstream([tokenFrame('foo'), tokenFrame('', 'length'), `data: [DONE]\n\n`])
    })
    const frames: unknown[] = []
    for await (const f of runOpenAIStream({
      model: 'gpt-4o',
      messages: [],
      apiKey: 'k',
      baseUrl: 'https://api.openai.com/v1',
      signal: new AbortController().signal,
    })) {
      frames.push(f)
    }
    expect(frames).toEqual([
      { kind: 'token', content: 'foo' },
      { kind: 'done', finishReason: 'length' },
    ])
  })

  it('yields nothing when the signal is already aborted', async () => {
    const c = new AbortController()
    c.abort()
    vi.stubGlobal('fetch', async () => sseUpstream([tokenFrame('x')]))
    const frames: unknown[] = []
    for await (const f of runOpenAIStream({
      model: 'gpt-4o',
      messages: [],
      apiKey: 'k',
      baseUrl: 'https://api.openai.com/v1',
      signal: c.signal,
    })) {
      frames.push(f)
    }
    expect(frames).toEqual([])
  })

  it('handles a partial frame split across reader chunks', async () => {
    vi.stubGlobal('fetch', async () => {
      const half = tokenFrame('chunky')
      return sseUpstream([half.slice(0, 10), half.slice(10), `data: [DONE]\n\n`])
    })
    const frames: unknown[] = []
    for await (const f of runOpenAIStream({
      model: 'gpt-4o',
      messages: [],
      apiKey: 'k',
      baseUrl: 'https://api.openai.com/v1',
      signal: new AbortController().signal,
    })) {
      frames.push(f)
    }
    expect(frames).toEqual([
      { kind: 'token', content: 'chunky' },
      { kind: 'done', finishReason: 'stop' },
    ])
  })

  it('surfaces upstream non-OK responses as error frames', async () => {
    vi.stubGlobal('fetch', async () => {
      return new Response(
        JSON.stringify({ error: { message: 'rate limited', code: 'rate_limit' } }),
        {
          status: 500,
          headers: { 'content-type': 'application/json' },
        },
      )
    })
    const frames: unknown[] = []
    for await (const f of runOpenAIStream({
      model: 'gpt-4o',
      messages: [],
      apiKey: 'k',
      baseUrl: 'https://api.openai.com/v1',
      signal: new AbortController().signal,
    })) {
      frames.push(f)
    }
    expect(frames).toEqual([
      { kind: 'error', error: 'rate limited', status: 500, code: 'rate_limit' },
    ])
  })

  it('surfaces a missing upstream stream body as an error frame', async () => {
    vi.stubGlobal('fetch', async () => new Response(null, { status: 200 }))
    const frames: unknown[] = []
    for await (const f of runOpenAIStream({
      model: 'gpt-4o',
      messages: [],
      apiKey: 'k',
      baseUrl: 'https://api.openai.com/v1',
      signal: new AbortController().signal,
    })) {
      frames.push(f)
    }
    expect(frames).toEqual([
      { kind: 'error', error: 'upstream returned no stream body', status: 200 },
    ])
  })

  it('surfaces invalid upstream stream JSON as an error frame', async () => {
    vi.stubGlobal('fetch', async () => sseUpstream(['data: {nope}\n\n']))
    const frames: unknown[] = []
    for await (const f of runOpenAIStream({
      model: 'gpt-4o',
      messages: [],
      apiKey: 'k',
      baseUrl: 'https://api.openai.com/v1',
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
})
