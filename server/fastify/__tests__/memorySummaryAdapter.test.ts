import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OpenAIChat } from '../../../src/ts/process/index.svelte'
import { summarizeOnce } from '../src/memorySummaryAdapter.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

function chat(role: OpenAIChat['role'], content: string): OpenAIChat {
  return { role, content }
}

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function bad(body: unknown, status = 400): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('memory summary provider adapter', () => {
  it('calls OpenAI-compatible chat completions and normalizes cleaned text', async () => {
    let captured: { url: string; init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      captured = { url, init }
      return ok({
        choices: [
          {
            message: {
              content: '<Thoughts>hidden</Thoughts>\n<think>also hidden</think>\nSummary',
            },
          },
        ],
      })
    })

    const result = await summarizeOnce([chat('user', 'hello')], {
      provider: 'openai',
      model: 'gpt-4o-mini',
      options: {
        openai: {
          apiKey: 'sk-test',
          baseUrl: 'https://example.test/v1',
          maxTokens: 1,
          temperature: 0.9,
        },
      },
      maxTokens: 8192,
      temperature: 0,
      signal: new AbortController().signal,
    })

    expect(result).toEqual({ text: 'Summary', tokens: 0 })
    expect(captured!.url).toBe('https://example.test/v1/chat/completions')
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent).toEqual({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hello' }],
      stream: false,
      max_tokens: 8192,
      temperature: 0,
    })
  })

  it('uses route-equivalent NanoGPT provider options', async () => {
    let captured: { url: string; headers: Record<string, string> } | null = null
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      captured = { url, headers: init.headers as Record<string, string> }
      return ok({ choices: [{ message: { content: 'Nano summary' } }] })
    })

    const result = await summarizeOnce([chat('user', 'hello')], {
      provider: 'nanogpt',
      model: 'model',
      options: {
        nanogpt: {
          apiKey: 'nano-key',
          providerHint: 'provider-a',
          useSubscription: true,
        },
      },
      signal: new AbortController().signal,
    })

    expect(result).toEqual({ text: 'Nano summary', tokens: 0 })
    expect(captured!.url).toBe('https://nano-gpt.com/api/subscription/v1/chat/completions')
    expect(captured!.headers.authorization).toBe('Bearer nano-key')
    expect(captured!.headers['X-Provider']).toBe('provider-a')
  })

  it('uses route-equivalent OpenRouter provider options', async () => {
    let captured: { url: string; headers: Record<string, string> } | null = null
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      captured = { url, headers: init.headers as Record<string, string> }
      return ok({ choices: [{ message: { content: 'OpenRouter summary' } }] })
    })

    const result = await summarizeOnce([chat('user', 'hello')], {
      provider: 'openrouter',
      model: 'openrouter/model',
      options: {
        openrouter: {
          apiKey: 'or-key',
        },
      },
      signal: new AbortController().signal,
    })

    expect(result).toEqual({ text: 'OpenRouter summary', tokens: 0 })
    expect(captured!.url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(captured!.headers.authorization).toBe('Bearer or-key')
    expect(captured!.headers['X-Title']).toBe('RisuAI')
    expect(captured!.headers['HTTP-Referer']).toBe('https://risuai.xyz')
  })

  it('normalizes upstream failures into adapter errors', async () => {
    vi.stubGlobal('fetch', async () => bad({ error: { message: 'nope' } }))

    const result = await summarizeOnce([chat('user', 'hello')], {
      provider: 'openai',
      model: 'gpt-4o-mini',
      options: { openai: { apiKey: 'sk-test' } },
      signal: new AbortController().signal,
    })

    expect(result).toEqual({ error: 'nope' })
  })

  it('treats aborted responses as adapter errors', async () => {
    const controller = new AbortController()
    controller.abort()

    const result = await summarizeOnce([chat('user', 'hello')], {
      provider: 'openai',
      model: 'gpt-4o-mini',
      options: { openai: { apiKey: 'sk-test' } },
      signal: controller.signal,
    })

    expect(result).toEqual({ error: 'aborted' })
  })

  it('reports provider configuration errors before calling upstream', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)

    const result = await summarizeOnce([chat('user', 'hello')], {
      provider: 'openai',
      model: 'gpt-4o-mini',
      options: { openai: { apiKey: 'sk-test', additionalParams: ['bad'] } },
      signal: new AbortController().signal,
    })

    expect(result).toEqual({
      error: 'options.openai.additionalParams must be an array of [string, string] pairs',
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('reports empty summaries after output scrubbing as errors', async () => {
    vi.stubGlobal('fetch', async () => ok({ choices: [{ message: { content: '<Thoughts>hidden</Thoughts>' } }] }))

    const result = await summarizeOnce([chat('user', 'hello')], {
      provider: 'openai',
      model: 'gpt-4o-mini',
      options: { openai: { apiKey: 'sk-test' } },
      signal: new AbortController().signal,
    })

    expect(result).toEqual({ error: 'Empty summary after removing Thoughts content' })
  })
})
