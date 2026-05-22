import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveOobaLegacyRequest, runOobaLegacy } from '../src/generation/oobaLegacy.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('resolveOobaLegacyRequest', () => {
  it('returns null when baseUrl is missing', () => {
    expect(
      resolveOobaLegacyRequest({
        messages: [{ role: 'user', content: 'hi' }],
        baseUrl: '',
        signal: new AbortController().signal,
      }),
    ).toBeNull()
  })
})

describe('runOobaLegacy', () => {
  it('normalizes the URL to /api/v1/generate and posts a flattened prompt', async () => {
    let captured: { url: string; init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      captured = { url, init }
      return ok({ results: [{ text: 'ooba ok' }] })
    })
    const resolved = resolveOobaLegacyRequest({
      messages: [{ role: 'user', content: 'hi' }],
      baseUrl: 'http://localhost:5000/api/v1/blocking',
      maxTokens: 128,
      temperature: 0.5,
      signal: new AbortController().signal,
    })!
    const r = await runOobaLegacy(resolved)
    expect(r).toEqual({ type: 'success', result: 'ooba ok' })
    expect(captured!.url).toBe('http://localhost:5000/api/v1/generate')
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.prompt).toContain('## User')
    expect(sent.max_new_tokens).toBe(128)
    expect(sent.temperature).toBe(0.5)
    const headers = captured!.init.headers as Record<string, string>
    expect(headers['X-API-KEY']).toBeUndefined()
  })

  it('forwards X-API-KEY when apiKey is provided (Mancer-style)', async () => {
    let captured: { init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = { init }
      return ok({ results: [{ text: 'x' }] })
    })
    const resolved = resolveOobaLegacyRequest({
      messages: [{ role: 'user', content: 'hi' }],
      baseUrl: 'http://example.com/api',
      apiKey: 'mancer-key',
      signal: new AbortController().signal,
    })!
    await runOobaLegacy(resolved)
    const headers = captured!.init.headers as Record<string, string>
    expect(headers['X-API-KEY']).toBe('mancer-key')
  })

  it('returns fail with raw body on non-2xx', async () => {
    vi.stubGlobal('fetch', async () => new Response('nope', { status: 500 }))
    const resolved = resolveOobaLegacyRequest({
      messages: [{ role: 'user', content: 'hi' }],
      baseUrl: 'http://localhost:5000',
      signal: new AbortController().signal,
    })!
    expect((await runOobaLegacy(resolved)).result).toBe('nope')
  })

  it('returns aborted=true on pre-aborted signal', async () => {
    const c = new AbortController()
    c.abort()
    let called = false
    vi.stubGlobal('fetch', async () => {
      called = true
      return ok({ results: [{ text: 'x' }] })
    })
    const resolved = resolveOobaLegacyRequest({
      messages: [{ role: 'user', content: 'hi' }],
      baseUrl: 'http://localhost:5000',
      signal: c.signal,
    })!
    expect((await runOobaLegacy(resolved)).aborted).toBe(true)
    expect(called).toBe(false)
  })
})
