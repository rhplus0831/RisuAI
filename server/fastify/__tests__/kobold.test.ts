import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveKoboldRequest, runKobold } from '../src/generation/kobold.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('resolveKoboldRequest', () => {
  it('returns null when baseUrl is missing', () => {
    expect(
      resolveKoboldRequest({
        messages: [{ role: 'user', content: 'hi' }],
        baseUrl: '',
        signal: new AbortController().signal,
      }),
    ).toBeNull()
  })

  it('flattens messages into a prompt string', () => {
    const r = resolveKoboldRequest({
      messages: [{ role: 'user', content: 'hi' }],
      baseUrl: 'http://localhost:5001',
      signal: new AbortController().signal,
    })
    expect(r?.prompt).toContain('## User\nhi')
    expect(r?.prompt).toContain('## Response')
  })
})

describe('runKobold', () => {
  it('appends /api/v1/generate to a bare base URL and returns results[0].text', async () => {
    let captured: { url: string; init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      captured = { url, init }
      return ok({ results: [{ text: 'kobold ok' }] })
    })
    const resolved = resolveKoboldRequest({
      messages: [{ role: 'user', content: 'hi' }],
      baseUrl: 'http://localhost:5001',
      maxTokens: 128,
      temperature: 0.7,
      signal: new AbortController().signal,
    })!
    const r = await runKobold(resolved)
    expect(r).toEqual({ type: 'success', result: 'kobold ok' })
    expect(captured!.url).toBe('http://localhost:5001/api/v1/generate')
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.prompt).toContain('## User')
    expect(sent.max_length).toBe(128)
    expect(sent.temperature).toBe(0.7)
    expect(sent.n).toBe(1)
  })

  it('keeps a baseUrl that already includes /api/v1/generate', async () => {
    let capturedUrl = ''
    vi.stubGlobal('fetch', async (url: string) => {
      capturedUrl = url
      return ok({ results: [{ text: 'x' }] })
    })
    const resolved = resolveKoboldRequest({
      messages: [{ role: 'user', content: 'hi' }],
      baseUrl: 'http://localhost:5001/api/v1/generate',
      signal: new AbortController().signal,
    })!
    await runKobold(resolved)
    expect(capturedUrl).toBe('http://localhost:5001/api/v1/generate')
  })

  it('returns fail with raw body on non-2xx', async () => {
    vi.stubGlobal('fetch', async () => new Response('overloaded', { status: 503 }))
    const resolved = resolveKoboldRequest({
      messages: [{ role: 'user', content: 'hi' }],
      baseUrl: 'http://localhost:5001',
      signal: new AbortController().signal,
    })!
    expect(await runKobold(resolved)).toEqual({ type: 'fail', result: 'overloaded' })
  })

  it('returns fail when results array lacks text', async () => {
    vi.stubGlobal('fetch', async () => ok({ results: [] }))
    const resolved = resolveKoboldRequest({
      messages: [{ role: 'user', content: 'hi' }],
      baseUrl: 'http://localhost:5001',
      signal: new AbortController().signal,
    })!
    expect((await runKobold(resolved)).type).toBe('fail')
  })

  it('returns aborted=true on pre-aborted signal', async () => {
    const c = new AbortController()
    c.abort()
    let called = false
    vi.stubGlobal('fetch', async () => {
      called = true
      return ok({ results: [{ text: 'x' }] })
    })
    const resolved = resolveKoboldRequest({
      messages: [{ role: 'user', content: 'hi' }],
      baseUrl: 'http://localhost:5001',
      signal: c.signal,
    })!
    expect((await runKobold(resolved)).aborted).toBe(true)
    expect(called).toBe(false)
  })
})
