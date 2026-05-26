import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  reformatForGemini,
  resolveGeminiRequest,
  runGemini,
  runGeminiStream,
} from '../src/generation/gemini.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('reformatForGemini', () => {
  it('maps assistant→model and keeps user role; emits no systemInstruction', () => {
    const r = reformatForGemini([
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'a' },
    ])
    expect(r.systemInstruction).toBeUndefined()
    expect(r.contents).toEqual([
      { role: 'user', parts: [{ text: 'q' }] },
      { role: 'model', parts: [{ text: 'a' }] },
    ])
  })

  it('lifts system rows into a joined systemInstruction', () => {
    const r = reformatForGemini([
      { role: 'system', content: 'rule 1' },
      { role: 'system', content: 'rule 2' },
      { role: 'user', content: 'hi' },
    ])
    expect(r.systemInstruction).toBe('rule 1\n\nrule 2')
    expect(r.contents).toEqual([{ role: 'user', parts: [{ text: 'hi' }] }])
  })

  it('coalesces consecutive same-role messages with newline join', () => {
    const r = reformatForGemini([
      { role: 'user', content: 'a' },
      { role: 'user', content: 'b' },
      { role: 'assistant', content: 'c' },
      { role: 'assistant', content: 'd' },
    ])
    expect(r.contents).toEqual([
      { role: 'user', parts: [{ text: 'a\nb' }] },
      { role: 'model', parts: [{ text: 'c\nd' }] },
    ])
  })

  it('drops function/tool roles entirely', () => {
    const r = reformatForGemini([
      { role: 'user', content: 'q' },
      { role: 'function', content: 'tool out' },
      { role: 'assistant', content: 'a' },
    ])
    expect(r.contents).toEqual([
      { role: 'user', parts: [{ text: 'q' }] },
      { role: 'model', parts: [{ text: 'a' }] },
    ])
  })

  it('skips empty-content system messages without crashing', () => {
    const r = reformatForGemini([
      { role: 'system', content: '' },
      { role: 'user', content: 'hi' },
    ])
    expect(r.systemInstruction).toBeUndefined()
    expect(r.contents).toEqual([{ role: 'user', parts: [{ text: 'hi' }] }])
  })
})

describe('resolveGeminiRequest', () => {
  it('returns null when apiKey is missing', () => {
    const r = resolveGeminiRequest({
      model: 'gemini-2.5-flash',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: '',
      signal: new AbortController().signal,
    })
    expect(r).toBeNull()
  })

  it('returns null when contents would be empty after reformat (system-only conversation)', () => {
    const r = resolveGeminiRequest({
      model: 'gemini-2.5-flash',
      messages: [{ role: 'system', content: 'system-only' }],
      apiKey: 'k',
      signal: new AbortController().signal,
    })
    expect(r).toBeNull()
  })

  it('defaults baseUrl and applies generation_config params', () => {
    const r = resolveGeminiRequest({
      model: 'gemini-2.5-flash',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'k',
      maxOutputTokens: 200,
      temperature: 0.7,
      topP: 0.9,
      topK: 40,
      signal: new AbortController().signal,
    })
    expect(r?.baseUrl).toBe('https://generativelanguage.googleapis.com/v1beta')
    expect(r?.maxOutputTokens).toBe(200)
    expect(r?.temperature).toBe(0.7)
    expect(r?.topP).toBe(0.9)
    expect(r?.topK).toBe(40)
  })
})

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('runGemini', () => {
  it('posts to /models/<model>:generateContent?key=... and extracts candidates[*].content.parts[*].text', async () => {
    let captured: { url: string; init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      captured = { url, init }
      return ok({
        modelVersion: 'gemini-2.5-flash',
        candidates: [
          { content: { parts: [{ text: 'hi' }, { text: ' there' }] }, finishReason: 'STOP' },
        ],
      })
    })
    const resolved = resolveGeminiRequest({
      model: 'gemini-2.5-flash',
      messages: [
        { role: 'system', content: 'be brief' },
        { role: 'user', content: 'hello' },
      ],
      apiKey: 'goog-test',
      maxOutputTokens: 128,
      temperature: 0.4,
      signal: new AbortController().signal,
    })!
    const r = await runGemini(resolved)
    expect(r).toEqual({ type: 'success', result: 'hi there', model: 'gemini-2.5-flash' })

    expect(captured!.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=goog-test',
    )
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.contents).toEqual([{ role: 'user', parts: [{ text: 'hello' }] }])
    expect(sent.systemInstruction).toEqual({ parts: [{ text: 'be brief' }] })
    expect(sent.generationConfig).toEqual({ maxOutputTokens: 128, temperature: 0.4 })
  })

  it('url-encodes the apiKey so chars like & or = stay intact', async () => {
    let capturedUrl = ''
    vi.stubGlobal('fetch', async (url: string) => {
      capturedUrl = url
      return ok({ candidates: [{ content: { parts: [{ text: 'x' }] } }] })
    })
    const resolved = resolveGeminiRequest({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'a&b=c',
      signal: new AbortController().signal,
    })!
    await runGemini(resolved)
    expect(capturedUrl).toContain('key=a%26b%3Dc')
  })

  it('omits systemInstruction when no system rows are present', async () => {
    let captured: { init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = { init }
      return ok({ candidates: [{ content: { parts: [{ text: 'x' }] } }] })
    })
    const resolved = resolveGeminiRequest({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'k',
      signal: new AbortController().signal,
    })!
    await runGemini(resolved)
    expect(JSON.parse(captured!.init.body as string).systemInstruction).toBeUndefined()
  })

  it('returns fail with upstream error.message on non-2xx', async () => {
    vi.stubGlobal('fetch', async () => {
      return new Response(
        JSON.stringify({ error: { message: 'API_KEY_INVALID', status: 'INVALID_ARGUMENT' } }),
        { status: 400 },
      )
    })
    const resolved = resolveGeminiRequest({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'bad',
      signal: new AbortController().signal,
    })!
    expect(await runGemini(resolved)).toEqual({ type: 'fail', result: 'API_KEY_INVALID' })
  })

  it('falls back to raw body when upstream non-2xx is not JSON', async () => {
    vi.stubGlobal('fetch', async () => new Response('upstream down', { status: 503 }))
    const resolved = resolveGeminiRequest({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'k',
      signal: new AbortController().signal,
    })!
    expect(await runGemini(resolved)).toEqual({ type: 'fail', result: 'upstream down' })
  })

  it('returns fail when candidates produce no text', async () => {
    vi.stubGlobal('fetch', async () => ok({ candidates: [{ content: { parts: [] } }] }))
    const resolved = resolveGeminiRequest({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'k',
      signal: new AbortController().signal,
    })!
    expect(await runGemini(resolved)).toEqual({
      type: 'fail',
      result: 'upstream returned no text content',
    })
  })

  it('returns aborted=true when signal is pre-aborted', async () => {
    const c = new AbortController()
    c.abort()
    let called = false
    vi.stubGlobal('fetch', async () => {
      called = true
      return ok({ candidates: [{ content: { parts: [{ text: 'x' }] } }] })
    })
    const resolved = resolveGeminiRequest({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'k',
      signal: c.signal,
    })!
    const r = await runGemini(resolved)
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

function geminiFrame(text: string, finishReason?: string): string {
  const payload: Record<string, unknown> = {
    candidates: [{ content: { parts: [{ text }] } }],
  }
  if (finishReason !== undefined) {
    ;(payload.candidates as Array<Record<string, unknown>>)[0].finishReason = finishReason
  }
  return `data: ${JSON.stringify(payload)}\n\n`
}

function crlf(s: string): string {
  return s.replace(/\n/g, '\r\n')
}

describe('runGeminiStream', () => {
  it('hits :streamGenerateContent?alt=sse and translates per-frame text into kind:token', async () => {
    let capturedUrl = ''
    vi.stubGlobal('fetch', async (url: string) => {
      capturedUrl = url
      return sseUpstream([geminiFrame('hi'), geminiFrame(' there', 'STOP')])
    })
    const resolved = resolveGeminiRequest({
      model: 'gemini-2.5-flash',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'k',
      signal: new AbortController().signal,
    })!
    const frames: unknown[] = []
    for await (const f of runGeminiStream(resolved)) frames.push(f)
    expect(capturedUrl).toContain(':streamGenerateContent?alt=sse&key=k')
    expect(frames).toEqual([
      { kind: 'token', content: 'hi' },
      { kind: 'token', content: ' there' },
      { kind: 'done', finishReason: 'stop' },
    ])
  })

  it('accepts CRLF-delimited upstream SSE frames', async () => {
    vi.stubGlobal('fetch', async () => {
      return sseUpstream([crlf(geminiFrame('hi')), crlf(geminiFrame(' there', 'STOP'))])
    })
    const resolved = resolveGeminiRequest({
      model: 'gemini-2.5-flash',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'k',
      signal: new AbortController().signal,
    })!
    const frames: unknown[] = []
    for await (const f of runGeminiStream(resolved)) frames.push(f)
    expect(frames).toEqual([
      { kind: 'token', content: 'hi' },
      { kind: 'token', content: ' there' },
      { kind: 'done', finishReason: 'stop' },
    ])
  })

  it('maps MAX_TOKENS finishReason to "length"', async () => {
    vi.stubGlobal('fetch', async () => sseUpstream([geminiFrame('cut', 'MAX_TOKENS')]))
    const resolved = resolveGeminiRequest({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'k',
      signal: new AbortController().signal,
    })!
    const frames: unknown[] = []
    for await (const f of runGeminiStream(resolved)) frames.push(f)
    expect(frames.at(-1)).toEqual({ kind: 'done', finishReason: 'length' })
  })

  it('yields nothing when signal is pre-aborted', async () => {
    const c = new AbortController()
    c.abort()
    vi.stubGlobal('fetch', async () => sseUpstream([geminiFrame('x', 'STOP')]))
    const resolved = resolveGeminiRequest({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'k',
      signal: c.signal,
    })!
    const frames: unknown[] = []
    for await (const f of runGeminiStream(resolved)) frames.push(f)
    expect(frames).toEqual([])
  })

  it('surfaces upstream non-OK responses as error frames', async () => {
    vi.stubGlobal('fetch', async () => {
      return new Response(
        JSON.stringify({ error: { message: 'permission denied', status: 'PERMISSION_DENIED' } }),
        {
          status: 403,
          headers: { 'content-type': 'application/json' },
        },
      )
    })
    const resolved = resolveGeminiRequest({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'k',
      signal: new AbortController().signal,
    })!
    const frames: unknown[] = []
    for await (const f of runGeminiStream(resolved)) frames.push(f)
    expect(frames).toEqual([
      { kind: 'error', error: 'permission denied', status: 403, code: 'PERMISSION_DENIED' },
    ])
  })

  it('surfaces a missing upstream stream body as an error frame', async () => {
    vi.stubGlobal('fetch', async () => new Response(null, { status: 200 }))
    const resolved = resolveGeminiRequest({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'k',
      signal: new AbortController().signal,
    })!
    const frames: unknown[] = []
    for await (const f of runGeminiStream(resolved)) frames.push(f)
    expect(frames).toEqual([
      { kind: 'error', error: 'upstream returned no stream body', status: 200 },
    ])
  })

  it('surfaces invalid upstream stream JSON as an error frame', async () => {
    vi.stubGlobal('fetch', async () => sseUpstream(['data: {nope}\n\n']))
    const resolved = resolveGeminiRequest({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'k',
      signal: new AbortController().signal,
    })!
    const frames: unknown[] = []
    for await (const f of runGeminiStream(resolved)) frames.push(f)
    expect(frames).toHaveLength(1)
    expect(frames[0]).toMatchObject({
      kind: 'error',
      error: expect.stringContaining('invalid upstream stream JSON'),
    })
  })

  it('surfaces unterminated upstream SSE tails as an error frame', async () => {
    vi.stubGlobal('fetch', async () => sseUpstream(['data: {nope}']))
    const resolved = resolveGeminiRequest({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'k',
      signal: new AbortController().signal,
    })!
    const frames: unknown[] = []
    for await (const f of runGeminiStream(resolved)) frames.push(f)
    expect(frames).toEqual([{ kind: 'error', error: 'truncated upstream stream event' }])
  })

  it('reassembles a frame split across two reader reads', async () => {
    const big = JSON.stringify({ candidates: [{ content: { parts: [{ text: 'split' }] } }] })
    const mid = Math.floor(big.length / 2)
    const part1 = `data: ${big.slice(0, mid)}`
    const part2 = `${big.slice(mid)}\n\n`
    vi.stubGlobal('fetch', async () => sseUpstream([part1, part2]))
    const resolved = resolveGeminiRequest({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'k',
      signal: new AbortController().signal,
    })!
    const frames: unknown[] = []
    for await (const f of runGeminiStream(resolved)) frames.push(f)
    expect(frames).toEqual([
      { kind: 'token', content: 'split' },
      { kind: 'done', finishReason: 'stop' },
    ])
  })
})

describe('Vertex AI Gemini routing', () => {
  it('routes to <region>-aiplatform.googleapis.com with Bearer auth (no key= query)', async () => {
    // Two-fetch sequence: first hits oauth2.googleapis.com/token, second
    // hits the Vertex prediction endpoint. We stub fetch to dispatch on URL.
    const calls: Array<{ url: string; init: RequestInit }> = []
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      if (url === 'https://oauth2.googleapis.com/token') {
        return new Response(
          JSON.stringify({ access_token: 'ya29.vertex-token', expires_in: 3599 }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response(
        JSON.stringify({
          modelVersion: 'gemini-2.5-pro',
          candidates: [{ content: { parts: [{ text: 'vertex ok' }] }, finishReason: 'STOP' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    })

    const { privateKey } = (await import('node:crypto')).generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    })
    const { _resetVertexTokenCacheForTesting } = await import('../src/generation/vertexAuth.js')
    _resetVertexTokenCacheForTesting()

    const resolved = resolveGeminiRequest({
      model: 'gemini-2.5-pro',
      messages: [{ role: 'user', content: 'hi' }],
      vertex: {
        projectId: 'my-project',
        region: 'us-central1',
        clientEmail: 'svc@my-project.iam.gserviceaccount.com',
        privateKey,
      },
      signal: new AbortController().signal,
    })!
    const r = await runGemini(resolved)
    expect(r).toEqual({ type: 'success', result: 'vertex ok', model: 'gemini-2.5-pro' })

    expect(calls).toHaveLength(2)
    expect(calls[0].url).toBe('https://oauth2.googleapis.com/token')
    expect(calls[1].url).toBe(
      'https://us-central1-aiplatform.googleapis.com/v1/projects/my-project/locations/us-central1/publishers/google/models/gemini-2.5-pro:generateContent',
    )
    const headers = calls[1].init.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer ya29.vertex-token')
    // No key= query when using Bearer auth.
    expect(calls[1].url).not.toContain('key=')
  })

  it('uses the global host when region === "global"', async () => {
    let predictionUrl = ''
    vi.stubGlobal('fetch', async (url: string) => {
      if (url === 'https://oauth2.googleapis.com/token') {
        return new Response(JSON.stringify({ access_token: 't', expires_in: 3599 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      predictionUrl = url
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: 'g' }] } }] }),
        { status: 200 },
      )
    })

    const { privateKey } = (await import('node:crypto')).generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    })
    const { _resetVertexTokenCacheForTesting } = await import('../src/generation/vertexAuth.js')
    _resetVertexTokenCacheForTesting()

    const resolved = resolveGeminiRequest({
      model: 'gemini-2.5-pro',
      messages: [{ role: 'user', content: 'hi' }],
      vertex: {
        projectId: 'p',
        region: 'global',
        clientEmail: 'svc@p.iam.gserviceaccount.com',
        privateKey,
      },
      signal: new AbortController().signal,
    })!
    await runGemini(resolved)
    expect(predictionUrl).toBe(
      'https://aiplatform.googleapis.com/v1/projects/p/locations/global/publishers/google/models/gemini-2.5-pro:generateContent',
    )
  })

  it('forces gemini-3-* preview models onto the global endpoint regardless of region', async () => {
    let predictionUrl = ''
    vi.stubGlobal('fetch', async (url: string) => {
      if (url === 'https://oauth2.googleapis.com/token') {
        return new Response(JSON.stringify({ access_token: 't', expires_in: 3599 }), {
          status: 200,
        })
      }
      predictionUrl = url
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: 'g' }] } }] }),
        { status: 200 },
      )
    })

    const { privateKey } = (await import('node:crypto')).generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    })
    const { _resetVertexTokenCacheForTesting } = await import('../src/generation/vertexAuth.js')
    _resetVertexTokenCacheForTesting()

    const resolved = resolveGeminiRequest({
      model: 'gemini-3-pro-preview',
      messages: [{ role: 'user', content: 'hi' }],
      vertex: {
        projectId: 'p',
        region: 'us-east1',
        clientEmail: 'svc@p.iam.gserviceaccount.com',
        privateKey,
      },
      signal: new AbortController().signal,
    })!
    await runGemini(resolved)
    expect(predictionUrl).toContain(
      'https://aiplatform.googleapis.com/v1/projects/p/locations/global/',
    )
  })

  it('returns fail with the vertexAuth error when token exchange fails', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      if (url === 'https://oauth2.googleapis.com/token') {
        return new Response('{"error":"invalid_grant"}', { status: 400 })
      }
      throw new Error('should not reach prediction endpoint')
    })

    const { privateKey } = (await import('node:crypto')).generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    })
    const { _resetVertexTokenCacheForTesting } = await import('../src/generation/vertexAuth.js')
    _resetVertexTokenCacheForTesting()

    const resolved = resolveGeminiRequest({
      model: 'gemini-2.5-pro',
      messages: [{ role: 'user', content: 'hi' }],
      vertex: {
        projectId: 'p',
        region: 'us-central1',
        clientEmail: 'svc@p.iam.gserviceaccount.com',
        privateKey,
      },
      signal: new AbortController().signal,
    })!
    const r = await runGemini(resolved)
    expect(r.type).toBe('fail')
    expect((r as { result: string }).result).toContain('invalid_grant')
  })

  it('resolveGeminiRequest returns null when neither apiKey nor vertex is provided', () => {
    const r = resolveGeminiRequest({
      model: 'gemini-2.5-pro',
      messages: [{ role: 'user', content: 'hi' }],
      signal: new AbortController().signal,
    })
    expect(r).toBeNull()
  })

  it('resolveGeminiRequest returns null when vertex is partially populated', () => {
    const r = resolveGeminiRequest({
      model: 'gemini-2.5-pro',
      messages: [{ role: 'user', content: 'hi' }],
      vertex: {
        projectId: 'p',
        region: '',
        clientEmail: 'svc@p.iam.gserviceaccount.com',
        privateKey: 'x',
      },
      signal: new AbortController().signal,
    })
    expect(r).toBeNull()
  })
})
