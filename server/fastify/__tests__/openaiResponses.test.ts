import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildResponseInput,
  resolveOpenAIResponsesRequest,
  runOpenAIResponses,
} from '../src/generation/openaiResponses.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('buildResponseInput', () => {
  it('wraps user/system rows in input_text and assistant rows in output_text', () => {
    const items = buildResponseInput([
      { role: 'system', content: 'be brief' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
      { role: 'user', content: 'follow-up' },
    ])
    expect(items).toEqual([
      { role: 'system', content: [{ type: 'input_text', text: 'be brief' }] },
      { role: 'user', content: [{ type: 'input_text', text: 'hi' }] },
      {
        type: 'message',
        role: 'assistant',
        status: 'complete',
        content: [{ type: 'output_text', text: 'hello', annotations: [] }],
      },
      { role: 'user', content: [{ type: 'input_text', text: 'follow-up' }] },
    ])
  })

  it('marks a trailing assistant message as incomplete (continue-from prefill)', () => {
    const items = buildResponseInput([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'partial' },
    ])
    expect((items[1] as { status: string }).status).toBe('incomplete')
  })

  it('drops function / tool rows', () => {
    const items = buildResponseInput([
      { role: 'user', content: 'hi' },
      { role: 'function', content: 'tool out' },
    ])
    expect(items.length).toBe(1)
  })
})

describe('resolveOpenAIResponsesRequest', () => {
  it('returns null when apiKey is missing', () => {
    expect(
      resolveOpenAIResponsesRequest({
        model: 'gpt-5-responses',
        messages: [],
        apiKey: '',
        signal: new AbortController().signal,
      }),
    ).toBeNull()
  })

  it('defaults baseUrl and applies optional fields', () => {
    const r = resolveOpenAIResponsesRequest({
      model: 'gpt-5-responses',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'k',
      maxOutputTokens: 256,
      temperature: 0.4,
      topP: 0.9,
      store: false,
      signal: new AbortController().signal,
    })
    expect(r?.baseUrl).toBe('https://api.openai.com/v1')
    expect(r?.maxOutputTokens).toBe(256)
    expect(r?.temperature).toBe(0.4)
    expect(r?.topP).toBe(0.9)
    expect(r?.store).toBe(false)
  })
})

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('runOpenAIResponses', () => {
  it('posts to {baseUrl}/responses with input items and Bearer auth', async () => {
    let captured: { url: string; init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      captured = { url, init }
      return ok({
        model: 'gpt-5-responses',
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: 'pong' }],
          },
        ],
      })
    })
    const resolved = resolveOpenAIResponsesRequest({
      model: 'gpt-5-responses',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'sk',
      maxOutputTokens: 128,
      temperature: 0.3,
      signal: new AbortController().signal,
    })!
    const r = await runOpenAIResponses(resolved)
    expect(r).toEqual({ type: 'success', result: 'pong', model: 'gpt-5-responses' })
    expect(captured!.url).toBe('https://api.openai.com/v1/responses')
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.model).toBe('gpt-5-responses')
    expect(sent.tools).toEqual([])
    expect(sent.max_output_tokens).toBe(128)
    expect(sent.temperature).toBe(0.3)
    expect(sent.input).toEqual([
      { role: 'user', content: [{ type: 'input_text', text: 'hi' }] },
    ])
  })

  it('applies additionalParams to the body + headers after the default payload is built', async () => {
    let captured: { init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = { init }
      return ok({
        model: 'gpt-5-responses',
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'x' }] }],
      })
    })
    const resolved = resolveOpenAIResponsesRequest({
      model: 'gpt-5-responses',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'sk',
      temperature: 0.5,
      additionalParams: [
        ['header::X-Custom', 'one'],
        ['extra.flag', 'true'],
        ['extra.nested.value', 'json::[1, 2]'],
        ['temperature', '{{none}}'],
      ],
      signal: new AbortController().signal,
    })!
    await runOpenAIResponses(resolved)
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.temperature).toBeUndefined()
    expect(sent.extra).toEqual({ flag: true, nested: { value: [1, 2] } })
    const headers = captured!.init.headers as Record<string, string>
    expect(headers['X-Custom']).toBe('one')
    expect(headers.authorization).toBe('Bearer sk')
  })

  it('returns fail with upstream error.message on non-2xx', async () => {
    vi.stubGlobal('fetch', async () => {
      return new Response(JSON.stringify({ error: { message: 'bad model' } }), { status: 400 })
    })
    const resolved = resolveOpenAIResponsesRequest({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'k',
      signal: new AbortController().signal,
    })!
    expect(await runOpenAIResponses(resolved)).toEqual({ type: 'fail', result: 'bad model' })
  })

  it('returns fail when output contains no message-type item with output_text', async () => {
    vi.stubGlobal('fetch', async () => ok({ output: [] }))
    const resolved = resolveOpenAIResponsesRequest({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'k',
      signal: new AbortController().signal,
    })!
    expect(await runOpenAIResponses(resolved)).toEqual({
      type: 'fail',
      result: 'upstream returned no output text',
    })
  })

  it('returns aborted=true when signal is pre-aborted', async () => {
    const c = new AbortController()
    c.abort()
    let called = false
    vi.stubGlobal('fetch', async () => {
      called = true
      return ok({})
    })
    const resolved = resolveOpenAIResponsesRequest({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'k',
      signal: c.signal,
    })!
    const r = await runOpenAIResponses(resolved)
    expect(r.aborted).toBe(true)
    expect(called).toBe(false)
  })
})
