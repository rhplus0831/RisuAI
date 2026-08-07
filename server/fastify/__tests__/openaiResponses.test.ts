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
        status: 'completed',
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

  it('maps developer-role systems and configured image detail without leaking NewChat metadata', () => {
    const items = buildResponseInput(
      [
        { role: 'system', content: '[Start a new chat]', memo: 'NewChat' },
        { role: 'system', content: 'developer instructions' },
        { role: 'assistant', content: 'history' },
        {
          role: 'user',
          content: 'look',
          multimodals: [{ type: 'image', base64: 'data:image/png;base64,abc' }],
        },
      ],
      { developerRole: true, visionQuality: 'high' },
    )

    expect(items).toEqual([
      { role: 'developer', content: [{ type: 'input_text', text: 'developer instructions' }] },
      {
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: 'history', annotations: [] }],
      },
      {
        role: 'user',
        content: [
          { type: 'input_text', text: 'look' },
          { type: 'input_image', detail: 'high', image_url: 'data:image/png;base64,abc' },
        ],
      },
    ])
  })

  it('drops function / tool rows', () => {
    const items = buildResponseInput([
      { role: 'user', content: 'hi' },
      { role: 'function', content: 'tool out' },
    ])
    expect(items.length).toBe(1)
  })

  it('rebuilds only complete tool continuation pairs without stale provider item ids', () => {
    const resolved = resolveOpenAIResponsesRequest({
      model: 'gpt-5-responses',
      messages: [{ id: 'msg_stale', role: 'user', content: 'continue' }],
      apiKey: 'k',
      tools: [{ type: 'function', name: 'lookup', description: 'Lookup', parameters: { type: 'object' } }],
      toolRounds: [
        {
          assistantContent: 'Checking.',
          calls: [
            {
              id: 'call-1',
              name: 'lookup',
              arguments: { query: 'weather' },
              serverItemId: 'fc_stale',
              reasoning: { id: 'rs_stale' },
            },
            { id: 'call-orphan', name: 'lookup', arguments: { query: 'orphan' } },
          ],
          results: [
            { callId: 'call-1', name: 'lookup', content: 'sunny' },
            { callId: 'result-orphan', name: 'lookup', content: 'ignored' },
          ],
        },
      ] as never,
      signal: new AbortController().signal,
    })!

    expect(resolved.input).toEqual([
      { role: 'user', content: [{ type: 'input_text', text: 'continue' }] },
      {
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: 'Checking.', annotations: [] }],
      },
      {
        type: 'function_call',
        call_id: 'call-1',
        name: 'lookup',
        arguments: '{"query":"weather"}',
        status: 'completed',
      },
      { type: 'function_call_output', call_id: 'call-1', output: 'sunny' },
    ])
    expect(JSON.stringify(resolved.input)).not.toMatch(/msg_stale|fc_stale|rs_stale|call-orphan|result-orphan/u)
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

  it('can request a reasoning summary when the resolved effort is omitted', () => {
    const r = resolveOpenAIResponsesRequest({
      model: 'gpt-5-responses',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'k',
      reasoningSummary: true,
      signal: new AbortController().signal,
    })

    expect(r?.reasoningEffort).toBeUndefined()
    expect(r?.reasoningSummary).toBe(true)
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
    expect(sent.tools).toBeUndefined()
    expect(sent.max_output_tokens).toBe(128)
    expect(sent.temperature).toBe(0.3)
    expect(sent.input).toEqual([{ role: 'user', content: [{ type: 'input_text', text: 'hi' }] }])
  })

  it('appends the Responses path before preserved endpoint query parameters', async () => {
    let capturedUrl = ''
    vi.stubGlobal('fetch', async (url: string) => {
      capturedUrl = url
      return ok({ output_text: 'ok' })
    })
    const resolved = resolveOpenAIResponsesRequest({
      model: 'azure-model',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'sk',
      baseUrl: 'https://azure.example.com/openai/v1?api-version=2026-01-01',
      signal: new AbortController().signal,
    })!

    await runOpenAIResponses(resolved)

    expect(capturedUrl).toBe('https://azure.example.com/openai/v1/responses?api-version=2026-01-01')
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

  it('requests and parses all buffered reasoning summary shapes with double-newline separation', async () => {
    let captured: RequestInit | null = null
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = init
      return ok({
        output: [
          {
            id: 'rs_server_only',
            type: 'reasoning',
            summary: [{ type: 'summary_text', text: 'summary fragment' }],
            content: [{ type: 'reasoning_text', text: 'reasoning fragment' }],
          },
          { type: 'message', content: [{ type: 'output_text', text: 'answer' }] },
        ],
      })
    })
    const resolved = resolveOpenAIResponsesRequest({
      model: 'gpt-5-responses',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'sk',
      reasoningSummary: true,
      signal: new AbortController().signal,
    })!

    expect(await runOpenAIResponses(resolved)).toEqual({
      type: 'success',
      result: '<Thoughts>\n\nsummary fragment\n\nreasoning fragment\n\n</Thoughts>\nanswer',
    })
    expect(JSON.parse(captured!.body as string).reasoning).toEqual({ summary: 'auto' })
  })

  it('returns sanitized function calls and sends paired bounded tool continuation items', async () => {
    const captured: Array<Record<string, any>> = []
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured.push(JSON.parse(init.body as string) as Record<string, any>)
      if (captured.length === 1) {
        return ok({
          output: [
            { id: 'rs_stale', type: 'reasoning', summary: [] },
            {
              id: 'fc_stale',
              type: 'function_call',
              call_id: 'call-lookup',
              name: 'lookup',
              arguments: '{"query":"weather"}',
              status: 'completed',
            },
          ],
        })
      }
      return ok({ output_text: 'final answer' })
    })
    const tools = [{ type: 'function', name: 'lookup', description: 'Lookup', parameters: { type: 'object' } }]
    const first = resolveOpenAIResponsesRequest({
      model: 'gpt-5-responses',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'sk',
      tools,
      signal: new AbortController().signal,
    })!

    const firstResult = await runOpenAIResponses(first)
    expect(firstResult).toEqual({
      type: 'success',
      result: '',
      toolCalls: [{ id: 'call-lookup', name: 'lookup', arguments: { query: 'weather' } }],
    })

    const second = resolveOpenAIResponsesRequest({
      model: 'gpt-5-responses',
      messages: [{ id: 'msg_stale', role: 'user', content: 'hi' }],
      apiKey: 'sk',
      tools,
      toolRounds: [
        {
          assistantContent: '',
          calls: firstResult.toolCalls!,
          results: [{ callId: 'call-lookup', name: 'lookup', content: 'sunny' }],
        },
      ],
      signal: new AbortController().signal,
    })!
    expect(await runOpenAIResponses(second)).toEqual({ type: 'success', result: 'final answer' })
    expect(captured[1].input).toEqual([
      { role: 'user', content: [{ type: 'input_text', text: 'hi' }] },
      {
        type: 'function_call',
        call_id: 'call-lookup',
        name: 'lookup',
        arguments: '{"query":"weather"}',
        status: 'completed',
      },
      { type: 'function_call_output', call_id: 'call-lookup', output: 'sunny' },
    ])
    expect(JSON.stringify(captured[1].input)).not.toMatch(/msg_stale|rs_stale|fc_stale/u)
  })

  it('sends completed history, developer instructions, and configured native image detail on the final wire', async () => {
    let captured: RequestInit | null = null
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = init
      return ok({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }] })
    })
    const resolved = resolveOpenAIResponsesRequest({
      model: 'gpt-responses',
      messages: [
        { role: 'system', content: '[Start a new chat]', memo: 'NewChat' },
        { role: 'system', content: 'rules' },
        { role: 'assistant', content: 'history' },
        {
          role: 'user',
          content: 'look',
          multimodals: [{ type: 'image', base64: 'data:image/png;base64,abc' }],
        },
      ],
      apiKey: 'sk',
      developerRole: true,
      visionQuality: 'high',
      signal: new AbortController().signal,
    })!

    await runOpenAIResponses(resolved)

    expect(JSON.parse(captured!.body as string).input).toEqual([
      { role: 'developer', content: [{ type: 'input_text', text: 'rules' }] },
      {
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: 'history', annotations: [] }],
      },
      {
        role: 'user',
        content: [
          { type: 'input_text', text: 'look' },
          { type: 'input_image', detail: 'high', image_url: 'data:image/png;base64,abc' },
        ],
      },
    ])
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

  it('treats incomplete and failed 2xx Responses payloads as failures', async () => {
    const responses = [
      ok({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output_text: 'partial' }),
      ok({ status: 'failed', error: { message: 'bad request' } }),
    ]
    vi.stubGlobal('fetch', async () => responses.shift()!)
    const request = () =>
      resolveOpenAIResponsesRequest({
        model: 'm',
        messages: [{ role: 'user', content: 'hi' }],
        apiKey: 'k',
        signal: new AbortController().signal,
      })!

    expect(await runOpenAIResponses(request())).toEqual({
      type: 'fail',
      result: 'Incomplete response: max_output_tokens\npartial',
    })
    expect(await runOpenAIResponses(request())).toEqual({ type: 'fail', result: '{"message":"bad request"}' })
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
