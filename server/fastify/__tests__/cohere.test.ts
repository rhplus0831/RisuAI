import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  reformatForCohere,
  resolveCohereRequest,
  runCohere,
} from '../src/generation/cohere.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('reformatForCohere', () => {
  it('extracts a single user message into `message` and emits empty history', () => {
    const r = reformatForCohere([{ role: 'user', content: 'hi' }])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.message).toBe('hi')
    expect(r.chatHistory).toEqual([])
    expect(r.preamble).toBeUndefined()
  })

  it('promotes a leading system message into preamble', () => {
    const r = reformatForCohere([
      { role: 'system', content: 'be terse' },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
      { role: 'user', content: 'what now' },
    ])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.preamble).toBe('be terse')
    expect(r.message).toBe('what now')
    expect(r.chatHistory).toEqual([
      { role: 'USER', message: 'hello' },
      { role: 'CHATBOT', message: 'hi' },
    ])
  })

  it('maps role tags into USER / CHATBOT / SYSTEM history entries', () => {
    const r = reformatForCohere([
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'system', content: 'mid-system' },
      { role: 'user', content: 'q2' },
    ])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.chatHistory).toEqual([
      { role: 'USER', message: 'q1' },
      { role: 'CHATBOT', message: 'a1' },
      { role: 'SYSTEM', message: 'mid-system' },
    ])
    expect(r.message).toBe('q2')
  })

  it('drops empty-content entries from chat_history', () => {
    const r = reformatForCohere([
      { role: 'user', content: '' },
      { role: 'assistant', content: '' },
      { role: 'user', content: 'real' },
    ])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.chatHistory).toEqual([])
    expect(r.message).toBe('real')
  })

  it('fails when the conversation never contains a user message', () => {
    const r = reformatForCohere([
      { role: 'system', content: 's' },
      { role: 'assistant', content: 'a' },
    ])
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toMatch(/user message/)
  })

  it('fails on an empty input', () => {
    const r = reformatForCohere([])
    expect(r.ok).toBe(false)
  })
})

describe('resolveCohereRequest', () => {
  it('returns null when apiKey is missing', () => {
    const r = resolveCohereRequest({
      model: 'command-r-plus',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: '',
      signal: new AbortController().signal,
    })
    expect(r).toBeNull()
  })

  it('returns null when reformat fails (no user message)', () => {
    const r = resolveCohereRequest({
      model: 'command-r-plus',
      messages: [{ role: 'system', content: 's' }],
      apiKey: 'k',
      signal: new AbortController().signal,
    })
    expect(r).toBeNull()
  })

  it('defaults baseUrl and applies optional parameters', () => {
    const r = resolveCohereRequest({
      model: 'command-r-plus',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'k',
      temperature: 0.3,
      topK: 5,
      topP: 0.9,
      presencePenalty: 0.1,
      frequencyPenalty: 0.2,
      safetyMode: 'NONE',
      signal: new AbortController().signal,
    })
    expect(r?.baseUrl).toBe('https://api.cohere.com/v1')
    expect(r?.temperature).toBe(0.3)
    expect(r?.topK).toBe(5)
    expect(r?.topP).toBe(0.9)
    expect(r?.presencePenalty).toBe(0.1)
    expect(r?.frequencyPenalty).toBe(0.2)
    expect(r?.safetyMode).toBe('NONE')
  })

  it('drops an unknown safetyMode value', () => {
    const r = resolveCohereRequest({
      model: 'command-r-plus',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'k',
      safetyMode: 'YOLO',
      signal: new AbortController().signal,
    })
    expect(r?.safetyMode).toBeUndefined()
  })
})

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('runCohere', () => {
  it('posts to {baseUrl}/chat with Bearer auth and the reformatted body', async () => {
    let captured: { url: string; init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      captured = { url, init }
      return ok({ text: 'hi from cohere' })
    })
    const resolved = resolveCohereRequest({
      model: 'command-r-plus',
      messages: [
        { role: 'system', content: 'be brief' },
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi' },
        { role: 'user', content: 'what now' },
      ],
      apiKey: 'co-test',
      temperature: 0.4,
      topK: 3,
      topP: 0.85,
      safetyMode: 'NONE',
      signal: new AbortController().signal,
    })!
    const r = await runCohere(resolved)
    expect(r).toEqual({ type: 'success', result: 'hi from cohere' })
    expect(captured!.url).toBe('https://api.cohere.com/v1/chat')
    const headers = captured!.init.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer co-test')
    expect(headers['content-type']).toBe('application/json')
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.model).toBe('command-r-plus')
    expect(sent.message).toBe('what now')
    expect(sent.preamble).toBe('be brief')
    expect(sent.chat_history).toEqual([
      { role: 'USER', message: 'hello' },
      { role: 'CHATBOT', message: 'hi' },
    ])
    expect(sent.safety_mode).toBe('NONE')
    expect(sent.temperature).toBe(0.4)
    expect(sent.k).toBe(3)
    expect(sent.p).toBe(0.85)
  })

  it('forwards extraHeaders into the upstream request alongside Bearer', async () => {
    let captured: { init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = { init }
      return ok({ text: 'ok' })
    })
    const resolved = resolveCohereRequest({
      model: 'command-r-plus',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'co',
      extraHeaders: { 'X-Proxy-Risu': 'RisuAI' },
      signal: new AbortController().signal,
    })!
    await runCohere(resolved)
    const headers = captured!.init.headers as Record<string, string>
    expect(headers['X-Proxy-Risu']).toBe('RisuAI')
    expect(headers.authorization).toBe('Bearer co')
  })

  it('applies additionalParams to the body + headers after the default payload is built', async () => {
    let captured: { init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = { init }
      return ok({ text: 'ok' })
    })
    const resolved = resolveCohereRequest({
      model: 'command-r-plus',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'co',
      temperature: 0.5,
      additionalParams: [
        ['header::X-Custom', 'one'],
        ['extra.flag', 'true'],
        ['extra.nested.value', 'json::[1, 2]'],
        ['temperature', '{{none}}'],
      ],
      signal: new AbortController().signal,
    })!
    await runCohere(resolved)
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.temperature).toBeUndefined()
    expect(sent.extra).toEqual({ flag: true, nested: { value: [1, 2] } })
    const headers = captured!.init.headers as Record<string, string>
    expect(headers['X-Custom']).toBe('one')
    expect(headers.authorization).toBe('Bearer co')
  })

  it('strips a trailing slash from baseUrl before appending /chat', async () => {
    let captured: { url: string } | null = null
    vi.stubGlobal('fetch', async (url: string) => {
      captured = { url }
      return ok({ text: 'x' })
    })
    const resolved = resolveCohereRequest({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'co',
      baseUrl: 'https://proxy.example.com/v1/',
      signal: new AbortController().signal,
    })!
    await runCohere(resolved)
    expect(captured!.url).toBe('https://proxy.example.com/v1/chat')
  })

  it('folds preamble into the message with `system:` prefix when there is no chat history', async () => {
    let captured: { init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = { init }
      return ok({ text: 'ok' })
    })
    const resolved = resolveCohereRequest({
      model: 'command-r-plus',
      messages: [
        { role: 'system', content: 'be brief' },
        { role: 'user', content: 'hello' },
      ],
      apiKey: 'co',
      signal: new AbortController().signal,
    })!
    await runCohere(resolved)
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.preamble).toBeUndefined()
    expect(sent.message).toBe('system: be brief')
    expect(sent.chat_history).toEqual([])
  })

  it('returns fail with stringified upstream body on non-2xx', async () => {
    vi.stubGlobal('fetch', async () => {
      return new Response(JSON.stringify({ message: 'invalid api key' }), { status: 401 })
    })
    const resolved = resolveCohereRequest({
      model: 'command-r-plus',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'bad',
      signal: new AbortController().signal,
    })!
    const r = await runCohere(resolved)
    expect(r.type).toBe('fail')
    expect(r.result).toContain('invalid api key')
  })

  it('returns fail when neither `text` nor `message.content[].text` is present', async () => {
    vi.stubGlobal('fetch', async () => ok({}))
    const resolved = resolveCohereRequest({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'k',
      signal: new AbortController().signal,
    })!
    const r = await runCohere(resolved)
    expect(r.type).toBe('fail')
  })

  it('falls back to message.content[].text for v2-shaped responses', async () => {
    vi.stubGlobal('fetch', async () =>
      ok({
        message: { content: [{ text: 'hello' }, { text: ' world' }] },
      }),
    )
    const resolved = resolveCohereRequest({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'k',
      signal: new AbortController().signal,
    })!
    expect(await runCohere(resolved)).toEqual({ type: 'success', result: 'hello world' })
  })

  it('returns aborted=true when signal is pre-aborted', async () => {
    const c = new AbortController()
    c.abort()
    let called = false
    vi.stubGlobal('fetch', async () => {
      called = true
      return ok({ text: 'x' })
    })
    const resolved = resolveCohereRequest({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'k',
      signal: c.signal,
    })!
    const r = await runCohere(resolved)
    expect(r.aborted).toBe(true)
    expect(called).toBe(false)
  })
})
