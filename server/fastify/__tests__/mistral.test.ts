import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  reformatForMistral,
  resolveMistralRequest,
  runMistral,
  runMistralStream,
} from '../src/generation/mistral.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('reformatForMistral', () => {
  it('passes a single user message through unchanged', () => {
    expect(reformatForMistral([{ role: 'user', content: 'hi' }])).toEqual([
      { role: 'user', content: 'hi' },
    ])
  })

  it('demotes an assistant-first message to a system row with a role prefix', () => {
    // Mistral rejects conversations that start with assistant. The local browser
    // path encodes the dropped role into the system content so no text is lost.
    expect(reformatForMistral([{ role: 'assistant', content: 'opener' }])).toEqual([
      { role: 'system', content: 'assistant:opener' },
    ])
  })

  it('coalesces consecutive same-role messages into a single newline-joined turn', () => {
    expect(
      reformatForMistral([
        { role: 'user', content: 'first' },
        { role: 'user', content: 'second' },
        { role: 'assistant', content: 'a' },
        { role: 'assistant', content: 'b' },
      ]),
    ).toEqual([
      { role: 'user', content: 'first\nsecond' },
      { role: 'assistant', content: 'a\nb' },
    ])
  })

  it('inlines system content after a user turn with a "System:" prefix', () => {
    expect(
      reformatForMistral([
        { role: 'user', content: 'hello' },
        { role: 'system', content: 'be terse' },
      ]),
    ).toEqual([{ role: 'user', content: 'hello\nSystem:be terse' }])
  })

  it('promotes a system-after-assistant message into a new user turn', () => {
    expect(
      reformatForMistral([
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'ok' },
        { role: 'system', content: 'be terse' },
      ]),
    ).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: 'System:be terse' },
    ])
  })

  it('demotes a function-role row to user, dropping the role tag', () => {
    expect(
      reformatForMistral([
        { role: 'user', content: 'hi' },
        { role: 'function', content: 'tool out' },
      ]),
    ).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'user', content: 'tool out' },
    ])
  })

  it('does not mutate the input array', () => {
    const input = [
      { role: 'user', content: 'a' },
      { role: 'user', content: 'b' },
    ]
    const snapshot = JSON.stringify(input)
    reformatForMistral(input)
    expect(JSON.stringify(input)).toBe(snapshot)
  })
})

describe('resolveMistralRequest', () => {
  it('returns null when apiKey is missing', () => {
    const r = resolveMistralRequest({
      model: 'mistral-large-latest',
      messages: [],
      apiKey: '',
      signal: new AbortController().signal,
    })
    expect(r).toBeNull()
  })

  it('returns null when model is missing', () => {
    const r = resolveMistralRequest({
      model: '',
      messages: [],
      apiKey: 'k',
      signal: new AbortController().signal,
    })
    expect(r).toBeNull()
  })

  it('returns null when messages is not an array', () => {
    const r = resolveMistralRequest({
      model: 'm',
      messages: 'oops',
      apiKey: 'k',
      signal: new AbortController().signal,
    })
    expect(r).toBeNull()
  })

  it('defaults baseUrl and safePrompt false; reformats messages', () => {
    const r = resolveMistralRequest({
      model: 'm',
      messages: [
        { role: 'user', content: 'a' },
        { role: 'user', content: 'b' },
      ],
      apiKey: 'k',
      signal: new AbortController().signal,
    })
    expect(r?.baseUrl).toBe('https://api.mistral.ai/v1')
    expect(r?.safePrompt).toBe(false)
    expect(r?.messages).toEqual([{ role: 'user', content: 'a\nb' }])
  })

  it('honors caller-supplied safePrompt, numeric params, and baseUrl', () => {
    const r = resolveMistralRequest({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'k',
      baseUrl: 'https://proxy.example.com/v1',
      safePrompt: true,
      maxTokens: 256,
      temperature: 0.2,
      presencePenalty: 0.1,
      frequencyPenalty: 0.3,
      topP: 0.9,
      signal: new AbortController().signal,
    })
    expect(r?.baseUrl).toBe('https://proxy.example.com/v1')
    expect(r?.safePrompt).toBe(true)
    expect(r?.maxTokens).toBe(256)
    expect(r?.temperature).toBe(0.2)
    expect(r?.presencePenalty).toBe(0.1)
    expect(r?.frequencyPenalty).toBe(0.3)
    expect(r?.topP).toBe(0.9)
  })
})

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('runMistral (non-streaming)', () => {
  it('posts {baseUrl}/chat/completions with Bearer + reformatted body', async () => {
    let captured: { url: string; init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      captured = { url, init }
      return ok({
        model: 'mistral-large-latest',
        choices: [{ message: { content: 'hi back' } }],
      })
    })

    const resolved = resolveMistralRequest({
      model: 'mistral-large-latest',
      messages: [
        { role: 'user', content: 'a' },
        { role: 'user', content: 'b' },
      ],
      apiKey: 'mk',
      temperature: 0.5,
      maxTokens: 128,
      signal: new AbortController().signal,
    })!
    const r = await runMistral(resolved)
    expect(r).toEqual({
      type: 'success',
      result: 'hi back',
      model: 'mistral-large-latest',
    })
    expect(captured!.url).toBe('https://api.mistral.ai/v1/chat/completions')
    const headers = captured!.init.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer mk')
    expect(headers['content-type']).toBe('application/json')
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent).toEqual({
      model: 'mistral-large-latest',
      messages: [{ role: 'user', content: 'a\nb' }],
      safe_prompt: false,
      stream: false,
      max_tokens: 128,
      temperature: 0.5,
    })
  })

  it('omits temperature / penalty fields when absent', async () => {
    let captured: { init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = { init }
      return ok({ choices: [{ message: { content: 'x' } }] })
    })
    const resolved = resolveMistralRequest({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'k',
      signal: new AbortController().signal,
    })!
    await runMistral(resolved)
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.temperature).toBeUndefined()
    expect(sent.max_tokens).toBeUndefined()
    expect(sent.presence_penalty).toBeUndefined()
    expect(sent.frequency_penalty).toBeUndefined()
    expect(sent.top_p).toBeUndefined()
  })

  it('forwards extraHeaders into the upstream request alongside Bearer', async () => {
    let captured: { init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = { init }
      return ok({ choices: [{ message: { content: 'x' } }] })
    })
    const resolved = resolveMistralRequest({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'k',
      extraHeaders: { 'X-Proxy-Risu': 'RisuAI' },
      signal: new AbortController().signal,
    })!
    await runMistral(resolved)
    const headers = captured!.init.headers as Record<string, string>
    expect(headers['X-Proxy-Risu']).toBe('RisuAI')
    expect(headers.authorization).toBe('Bearer k')
  })

  it('applies additionalParams to the body + headers after the default payload is built', async () => {
    let captured: { init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = { init }
      return ok({ choices: [{ message: { content: 'x' } }] })
    })
    const resolved = resolveMistralRequest({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'k',
      temperature: 0.5,
      additionalParams: [
        ['header::X-Custom', 'one'],
        ['extra.flag', 'true'],
        ['extra.nested.value', 'json::[1, 2]'],
        ['temperature', '{{none}}'],
      ],
      signal: new AbortController().signal,
    })!
    await runMistral(resolved)
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.temperature).toBeUndefined()
    expect(sent.extra).toEqual({ flag: true, nested: { value: [1, 2] } })
    const headers = captured!.init.headers as Record<string, string>
    expect(headers['X-Custom']).toBe('one')
    expect(headers.authorization).toBe('Bearer k')
  })

  it('forwards safe_prompt=true when the caller opts in', async () => {
    let captured: { init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = { init }
      return ok({ choices: [{ message: { content: 'x' } }] })
    })
    const resolved = resolveMistralRequest({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'k',
      safePrompt: true,
      signal: new AbortController().signal,
    })!
    await runMistral(resolved)
    expect(JSON.parse(captured!.init.body as string).safe_prompt).toBe(true)
  })

  it('strips a trailing slash from baseUrl before appending /chat/completions', async () => {
    let captured: { url: string } | null = null
    vi.stubGlobal('fetch', async (url: string) => {
      captured = { url }
      return ok({ choices: [{ message: { content: 'x' } }] })
    })
    const resolved = resolveMistralRequest({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'k',
      baseUrl: 'https://api.mistral.ai/v1/',
      signal: new AbortController().signal,
    })!
    await runMistral(resolved)
    expect(captured!.url).toBe('https://api.mistral.ai/v1/chat/completions')
  })

  it('returns fail with upstream error.message on non-2xx', async () => {
    vi.stubGlobal('fetch', async () => {
      return new Response(JSON.stringify({ error: { message: 'bad token' } }), { status: 401 })
    })
    const resolved = resolveMistralRequest({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'k',
      signal: new AbortController().signal,
    })!
    expect(await runMistral(resolved)).toEqual({ type: 'fail', result: 'bad token' })
  })

  it('returns fail with HTTP status fallback when upstream omits error.message', async () => {
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 502 }))
    const resolved = resolveMistralRequest({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'k',
      signal: new AbortController().signal,
    })!
    expect(await runMistral(resolved)).toEqual({ type: 'fail', result: 'HTTP 502' })
  })

  it('returns fail when choices is empty', async () => {
    vi.stubGlobal('fetch', async () => ok({ choices: [] }))
    const resolved = resolveMistralRequest({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'k',
      signal: new AbortController().signal,
    })!
    expect(await runMistral(resolved)).toEqual({
      type: 'fail',
      result: 'upstream returned no content',
    })
  })

  it('returns aborted=true and does not call fetch when signal is pre-aborted', async () => {
    const c = new AbortController()
    c.abort()
    let called = false
    vi.stubGlobal('fetch', async () => {
      called = true
      return ok({ choices: [{ message: { content: 'x' } }] })
    })
    const resolved = resolveMistralRequest({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'k',
      signal: c.signal,
    })!
    const r = await runMistral(resolved)
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

function deltaFrame(text: string, finishReason?: string): string {
  const payload: Record<string, unknown> = { choices: [{ delta: { content: text } }] }
  if (finishReason !== undefined) {
    ;(payload.choices as Array<Record<string, unknown>>)[0].finish_reason = finishReason
  }
  return `data: ${JSON.stringify(payload)}\n\n`
}

function crlf(s: string): string {
  return s.replace(/\n/g, '\r\n')
}

describe('runMistralStream', () => {
  it('relays token deltas and emits done with stop on [DONE] sentinel', async () => {
    vi.stubGlobal('fetch', async () =>
      sseUpstream([deltaFrame('hello'), deltaFrame(' world'), 'data: [DONE]\n\n']),
    )
    const resolved = resolveMistralRequest({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'k',
      signal: new AbortController().signal,
    })!
    const frames: unknown[] = []
    for await (const f of runMistralStream(resolved)) frames.push(f)
    expect(frames).toEqual([
      { kind: 'token', content: 'hello' },
      { kind: 'token', content: ' world' },
      { kind: 'done', finishReason: 'stop' },
    ])
  })

  it('accepts CRLF-delimited upstream SSE frames', async () => {
    vi.stubGlobal('fetch', async () =>
      sseUpstream([crlf(deltaFrame('hello')), crlf(deltaFrame(' world')), 'data: [DONE]\r\n\r\n']),
    )
    const resolved = resolveMistralRequest({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'k',
      signal: new AbortController().signal,
    })!
    const frames: unknown[] = []
    for await (const f of runMistralStream(resolved)) frames.push(f)
    expect(frames).toEqual([
      { kind: 'token', content: 'hello' },
      { kind: 'token', content: ' world' },
      { kind: 'done', finishReason: 'stop' },
    ])
  })

  it('propagates a non-stop finish_reason into the trailing done frame', async () => {
    vi.stubGlobal('fetch', async () =>
      sseUpstream([deltaFrame('cut', 'length'), 'data: [DONE]\n\n']),
    )
    const resolved = resolveMistralRequest({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'k',
      signal: new AbortController().signal,
    })!
    const frames: unknown[] = []
    for await (const f of runMistralStream(resolved)) frames.push(f)
    expect(frames.at(-1)).toEqual({ kind: 'done', finishReason: 'length' })
  })

  it('emits a trailing done when upstream closes without [DONE]', async () => {
    vi.stubGlobal('fetch', async () => sseUpstream([deltaFrame('partial')]))
    const resolved = resolveMistralRequest({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'k',
      signal: new AbortController().signal,
    })!
    const frames: unknown[] = []
    for await (const f of runMistralStream(resolved)) frames.push(f)
    expect(frames).toEqual([
      { kind: 'token', content: 'partial' },
      { kind: 'done', finishReason: 'stop' },
    ])
  })

  it('yields nothing when signal is pre-aborted', async () => {
    const c = new AbortController()
    c.abort()
    vi.stubGlobal('fetch', async () => sseUpstream([deltaFrame('x'), 'data: [DONE]\n\n']))
    const resolved = resolveMistralRequest({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'k',
      signal: c.signal,
    })!
    const frames: unknown[] = []
    for await (const f of runMistralStream(resolved)) frames.push(f)
    expect(frames).toEqual([])
  })

  it('surfaces upstream non-OK responses as error frames', async () => {
    vi.stubGlobal('fetch', async () => {
      return new Response(JSON.stringify({ error: { message: 'rate limited', code: 'quota' } }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      })
    })
    const resolved = resolveMistralRequest({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'k',
      signal: new AbortController().signal,
    })!
    const frames: unknown[] = []
    for await (const f of runMistralStream(resolved)) frames.push(f)
    expect(frames).toEqual([{ kind: 'error', error: 'rate limited', status: 429, code: 'quota' }])
  })

  it('surfaces a missing upstream stream body as an error frame', async () => {
    vi.stubGlobal('fetch', async () => new Response(null, { status: 200 }))
    const resolved = resolveMistralRequest({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'k',
      signal: new AbortController().signal,
    })!
    const frames: unknown[] = []
    for await (const f of runMistralStream(resolved)) frames.push(f)
    expect(frames).toEqual([
      { kind: 'error', error: 'upstream returned no stream body', status: 200 },
    ])
  })

  it('surfaces invalid upstream stream JSON as an error frame', async () => {
    vi.stubGlobal('fetch', async () => sseUpstream(['data: {nope}\n\n']))
    const resolved = resolveMistralRequest({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'k',
      signal: new AbortController().signal,
    })!
    const frames: unknown[] = []
    for await (const f of runMistralStream(resolved)) frames.push(f)
    expect(frames).toHaveLength(1)
    expect(frames[0]).toMatchObject({
      kind: 'error',
      error: expect.stringContaining('invalid upstream stream JSON'),
    })
  })

  it('surfaces unterminated upstream SSE tails as an error frame', async () => {
    vi.stubGlobal('fetch', async () => sseUpstream(['data: {nope}']))
    const resolved = resolveMistralRequest({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'k',
      signal: new AbortController().signal,
    })!
    const frames: unknown[] = []
    for await (const f of runMistralStream(resolved)) frames.push(f)
    expect(frames).toEqual([{ kind: 'error', error: 'truncated upstream stream event' }])
  })

  it('reassembles partial frames split across reader reads', async () => {
    const big = JSON.stringify({ choices: [{ delta: { content: 'split' } }] })
    const mid = Math.floor(big.length / 2)
    const part1 = `data: ${big.slice(0, mid)}`
    const part2 = `${big.slice(mid)}\n\ndata: [DONE]\n\n`
    vi.stubGlobal('fetch', async () => sseUpstream([part1, part2]))
    const resolved = resolveMistralRequest({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'k',
      signal: new AbortController().signal,
    })!
    const frames: unknown[] = []
    for await (const f of runMistralStream(resolved)) frames.push(f)
    expect(frames).toEqual([
      { kind: 'token', content: 'split' },
      { kind: 'done', finishReason: 'stop' },
    ])
  })
})
