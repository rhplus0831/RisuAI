import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  flattenForLegacyInstruct,
  resolveOpenAILegacyInstructRequest,
  runOpenAILegacyInstruct,
} from '../src/generation/openaiLegacyInstruct.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('flattenForLegacyInstruct', () => {
  it('formats each non-empty turn as `## Author\\n<content>` and appends `## Response`', () => {
    expect(
      flattenForLegacyInstruct([
        { role: 'system', content: 'be brief' },
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
      ]),
    ).toBe('\n## Instruction\nbe brief\n## User\nhi\n## Assistant\nhello\n## Response\n')
  })

  it('drops empty/whitespace-only content', () => {
    expect(
      flattenForLegacyInstruct([
        { role: 'user', content: '   ' },
        { role: 'user', content: 'real' },
      ]),
    ).toBe('\n## User\nreal\n## Response\n')
  })

  it('passes unknown roles through as-is for the author header', () => {
    expect(flattenForLegacyInstruct([{ role: 'narrator', content: 'x' }])).toContain('## narrator')
  })
})

describe('resolveOpenAILegacyInstructRequest', () => {
  it('returns null when apiKey is missing', () => {
    const r = resolveOpenAILegacyInstructRequest({
      model: 'gpt-3.5-turbo-instruct',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: '',
      signal: new AbortController().signal,
    })
    expect(r).toBeNull()
  })

  it('flattens messages into a single prompt string', () => {
    const r = resolveOpenAILegacyInstructRequest({
      model: 'gpt-3.5-turbo-instruct',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'k',
      signal: new AbortController().signal,
    })
    expect(r?.prompt).toContain('## User\nhi')
    expect(r?.prompt).toContain('## Response')
  })
})

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('runOpenAILegacyInstruct', () => {
  it('posts to {baseUrl}/completions with Bearer auth and a flattened prompt', async () => {
    let captured: { url: string; init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      captured = { url, init }
      return ok({ model: 'gpt-3.5-turbo-instruct', choices: [{ text: 'pong' }] })
    })
    const resolved = resolveOpenAILegacyInstructRequest({
      model: 'gpt-3.5-turbo-instruct',
      messages: [
        { role: 'system', content: 'be brief' },
        { role: 'user', content: 'hi' },
      ],
      apiKey: 'sk',
      maxTokens: 128,
      temperature: 0.4,
      signal: new AbortController().signal,
    })!
    const r = await runOpenAILegacyInstruct(resolved)
    expect(r).toEqual({ type: 'success', result: 'pong', model: 'gpt-3.5-turbo-instruct' })
    expect(captured!.url).toBe('https://api.openai.com/v1/completions')
    const headers = captured!.init.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer sk')
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.model).toBe('gpt-3.5-turbo-instruct')
    expect(sent.prompt).toContain('## User\nhi')
    expect(sent.stop).toEqual(['User:', ' User:', 'user:', ' user:'])
    expect(sent.max_tokens).toBe(128)
    expect(sent.temperature).toBe(0.4)
    expect(sent.top_p).toBe(1)
  })

  it('honors a caller-supplied stop list', async () => {
    let captured: { init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = { init }
      return ok({ choices: [{ text: 'x' }] })
    })
    const resolved = resolveOpenAILegacyInstructRequest({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'k',
      stop: ['<|end|>'],
      signal: new AbortController().signal,
    })!
    await runOpenAILegacyInstruct(resolved)
    expect(JSON.parse(captured!.init.body as string).stop).toEqual(['<|end|>'])
  })

  it('strips `##\\n` markers from the returned text', async () => {
    vi.stubGlobal('fetch', async () => ok({ choices: [{ text: 'real##\nmore' }] }))
    const resolved = resolveOpenAILegacyInstructRequest({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'k',
      signal: new AbortController().signal,
    })!
    const r = await runOpenAILegacyInstruct(resolved)
    expect(r.result).toBe('realmore')
  })

  it('routes through a caller-supplied baseUrl (NanoGPT variant)', async () => {
    let capturedUrl = ''
    vi.stubGlobal('fetch', async (url: string) => {
      capturedUrl = url
      return ok({ choices: [{ text: 'x' }] })
    })
    const resolved = resolveOpenAILegacyInstructRequest({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'k',
      baseUrl: 'https://nano-gpt.com/api/v1',
      signal: new AbortController().signal,
    })!
    await runOpenAILegacyInstruct(resolved)
    expect(capturedUrl).toBe('https://nano-gpt.com/api/v1/completions')
  })

  it('merges extraHeaders into the request (NanoGPT X-Provider)', async () => {
    let captured: { init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = { init }
      return ok({ choices: [{ text: 'x' }] })
    })
    const resolved = resolveOpenAILegacyInstructRequest({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'k',
      extraHeaders: { 'X-Provider': 'openai' },
      signal: new AbortController().signal,
    })!
    await runOpenAILegacyInstruct(resolved)
    const headers = captured!.init.headers as Record<string, string>
    expect(headers['X-Provider']).toBe('openai')
  })

  it('returns fail with upstream error.message on non-2xx', async () => {
    vi.stubGlobal('fetch', async () => {
      return new Response(JSON.stringify({ error: { message: 'bad' } }), { status: 401 })
    })
    const resolved = resolveOpenAILegacyInstructRequest({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'k',
      signal: new AbortController().signal,
    })!
    expect(await runOpenAILegacyInstruct(resolved)).toEqual({ type: 'fail', result: 'bad' })
  })

  it('returns aborted=true when signal is pre-aborted', async () => {
    const c = new AbortController()
    c.abort()
    let called = false
    vi.stubGlobal('fetch', async () => {
      called = true
      return ok({ choices: [{ text: 'x' }] })
    })
    const resolved = resolveOpenAILegacyInstructRequest({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'k',
      signal: c.signal,
    })!
    const r = await runOpenAILegacyInstruct(resolved)
    expect(r.aborted).toBe(true)
    expect(called).toBe(false)
  })
})
