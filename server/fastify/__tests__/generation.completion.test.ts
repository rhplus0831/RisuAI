import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { webcrypto } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'

const subtle = webcrypto.subtle

interface Harness {
  app: FastifyInstance
  dataDir: string
}

async function startHarness(): Promise<Harness> {
  process.env.LOG_LEVEL = 'silent'
  const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-fastify-'))
  const { app } = await buildApp({
    config: {
      host: '127.0.0.1',
      port: 0,
      dataDir,
      bodyLimit: 1024 * 1024,
      trustProxy: false,
      hubUrl: 'https://sv.risuai.xyz',
    },
  })
  return { app, dataDir }
}

async function stopHarness(h: Harness): Promise<void> {
  await h.app.close()
  rmSync(h.dataDir, { recursive: true, force: true })
}

async function signAssertion(
  privateKey: CryptoKey,
  publicJwk: JsonWebKey,
  ttlSec = 60,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'ES256', typ: 'JWT' }
  const payload = { iat: now, exp: now + ttlSec, pub: publicJwk }
  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url')
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signingInput = `${headerB64}.${payloadB64}`
  const signature = await subtle.sign(
    { name: 'ECDSA', hash: { name: 'SHA-256' } },
    privateKey,
    Buffer.from(signingInput),
  )
  const sigB64 = Buffer.from(signature).toString('base64url')
  return `${signingInput}.${sigB64}`
}

async function setupAuthedClient(app: FastifyInstance): Promise<{ assertion: string }> {
  const setup = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/setup',
    payload: { password: 'hunter2' },
  })
  expect(setup.statusCode).toBe(200)

  const keypair = (await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair
  const publicKey = await subtle.exportKey('jwk', keypair.publicKey)

  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { password: 'hunter2', publicKey },
  })
  expect(login.statusCode).toBe(200)

  const assertion = await signAssertion(keypair.privateKey, publicKey)
  return { assertion }
}

let harness: Harness
let originalFetch: typeof globalThis.fetch | undefined

beforeEach(async () => {
  harness = await startHarness()
  originalFetch = globalThis.fetch
})

afterEach(async () => {
  if (originalFetch) {
    globalThis.fetch = originalFetch
  }
  await stopHarness(harness)
})

const basePayload = {
  provider: 'echo',
  model: 'echo_model',
  messages: [{ role: 'user', content: 'hi' }],
  stream: false,
}

describe('Phase 6-1 POST /api/v1/generate/completion', () => {
  it('returns 401 without auth once a password is set', async () => {
    await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/setup',
      payload: { password: 'hunter2' },
    })
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/completion',
      payload: basePayload,
    })
    expect(res.statusCode).toBe(401)
  })

  it('rejects a body missing provider with 400', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/completion',
      headers: { 'risu-auth': assertion },
      payload: { ...basePayload, provider: undefined },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'provider is required' })
  })

  it('rejects a body where messages is not an array', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/completion',
      headers: { 'risu-auth': assertion },
      payload: { ...basePayload, messages: 'oops' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/messages/)
  })

  it('rejects a non-boolean stream field', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/completion',
      headers: { 'risu-auth': assertion },
      payload: { ...basePayload, stream: 'yes' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/stream/)
  })

  it('returns 501 for providers not yet implemented', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/completion',
      headers: { 'risu-auth': assertion },
      payload: { ...basePayload, provider: 'anthropic' },
    })
    expect(res.statusCode).toBe(501)
    expect(res.json()).toEqual({
      reason: 'provider not implemented yet: anthropic',
    })
  })

  it('echo non-streaming returns the configured message', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/completion',
      headers: { 'risu-auth': assertion },
      payload: {
        ...basePayload,
        options: { echo: { message: 'pong', delayMs: 0 } },
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ type: 'success', result: 'pong' })
  })

  it('echo non-streaming falls back to default message when options.echo is absent', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/completion',
      headers: { 'risu-auth': assertion },
      payload: basePayload,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ type: 'success', result: 'Echo Message' })
  })

  it('echo streaming emits one chunk frame and one done frame', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/completion',
      headers: { 'risu-auth': assertion },
      payload: {
        ...basePayload,
        stream: true,
        options: { echo: { message: 'flow', delayMs: 0 } },
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('text/event-stream')
    expect(res.body).toBe(
      `event: chunk\ndata: ${JSON.stringify({ type: 'token', content: 'flow' })}\n\n` +
        `event: done\ndata: ${JSON.stringify({ finishReason: 'stop' })}\n\n`,
    )
  })

  it('echo non-streaming honors options.echo.delayMs', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const start = Date.now()
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/completion',
      headers: { 'risu-auth': assertion },
      payload: {
        ...basePayload,
        options: { echo: { message: 'slow', delayMs: 40 } },
      },
    })
    const elapsed = Date.now() - start
    expect(res.statusCode).toBe(200)
    expect(elapsed).toBeGreaterThanOrEqual(30)
    expect(res.json()).toEqual({ type: 'success', result: 'slow' })
  })
})

describe('Phase 6-4 POST /api/v1/generate/completion (openai)', () => {
  const openaiPayload = {
    provider: 'openai',
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'hi' }],
    stream: false,
    options: {
      openai: {
        apiKey: 'sk-test',
        baseUrl: 'https://upstream.example.com/v1',
      },
    },
  }

  it('400s when options.openai.apiKey is missing', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/completion',
      headers: { 'risu-auth': assertion },
      payload: { ...openaiPayload, options: { openai: { apiKey: '' } } },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({
      error: 'options.openai.apiKey is required',
    })
  })

  it('non-streaming forwards model + messages + Bearer auth and returns assistant content', async () => {
    let captured: { url: string; init: RequestInit } | null = null
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      captured = { url, init }
      return new Response(
        JSON.stringify({
          model: 'gpt-4o',
          choices: [{ message: { content: 'pong' }, finish_reason: 'stop' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as unknown as typeof globalThis.fetch

    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/completion',
      headers: { 'risu-auth': assertion },
      payload: openaiPayload,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ type: 'success', result: 'pong', model: 'gpt-4o' })

    expect(captured!.url).toBe('https://upstream.example.com/v1/chat/completions')
    const headers = captured!.init.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer sk-test')
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.model).toBe('gpt-4o')
    expect(sent.messages).toEqual([{ role: 'user', content: 'hi' }])
    expect(sent.stream).toBe(false)
  })

  it('non-streaming propagates upstream error.message as a 200 + type=fail', async () => {
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({ error: { message: 'rate limit hit' } }),
        { status: 429 },
      )
    }) as unknown as typeof globalThis.fetch

    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/completion',
      headers: { 'risu-auth': assertion },
      payload: openaiPayload,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ type: 'fail', result: 'rate limit hit' })
  })

  it('streaming relays upstream SSE deltas through the normalized envelope', async () => {
    const enc = new TextEncoder()
    const upstreamFrames = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'hel' } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'lo' }, finish_reason: 'stop' }] })}\n\n`,
      `data: [DONE]\n\n`,
    ]
    globalThis.fetch = (async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const f of upstreamFrames) controller.enqueue(enc.encode(f))
          controller.close()
        },
      })
      return new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
    }) as unknown as typeof globalThis.fetch

    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/completion',
      headers: { 'risu-auth': assertion },
      payload: { ...openaiPayload, stream: true },
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('text/event-stream')
    expect(res.body).toBe(
      `event: chunk\ndata: ${JSON.stringify({ type: 'token', content: 'hel' })}\n\n` +
        `event: chunk\ndata: ${JSON.stringify({ type: 'token', content: 'lo' })}\n\n` +
        `event: done\ndata: ${JSON.stringify({ finishReason: 'stop' })}\n\n`,
    )
  })
})

describe('Phase 6-4c POST /api/v1/generate/completion (nanogpt + openrouter)', () => {
  const okOpenAIResponse = (text: string) =>
    new Response(
      JSON.stringify({ choices: [{ message: { content: text }, finish_reason: 'stop' }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )

  it('nanogpt 400s when options.nanogpt.apiKey is missing', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/completion',
      headers: { 'risu-auth': assertion },
      payload: {
        provider: 'nanogpt',
        model: 'nanogpt',
        messages: [{ role: 'user', content: 'hi' }],
        stream: false,
        options: { nanogpt: {} },
      },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'options.nanogpt.apiKey is required' })
  })

  it('nanogpt forwards to nano-gpt.com with optional X-Provider', async () => {
    let captured: { url: string; init: RequestInit } | null = null
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      captured = { url, init }
      return okOpenAIResponse('hi from nano')
    }) as unknown as typeof globalThis.fetch

    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/completion',
      headers: { 'risu-auth': assertion },
      payload: {
        provider: 'nanogpt',
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'hi' }],
        stream: false,
        options: { nanogpt: { apiKey: 'nk-test', providerHint: 'openai' } },
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ type: 'success', result: 'hi from nano' })

    expect(captured!.url).toBe('https://nano-gpt.com/api/v1/chat/completions')
    const headers = captured!.init.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer nk-test')
    expect(headers['X-Provider']).toBe('openai')
  })

  it('nanogpt routes the subscription endpoint when useSubscription=true', async () => {
    let capturedUrl = ''
    globalThis.fetch = (async (url: string) => {
      capturedUrl = url
      return okOpenAIResponse('sub')
    }) as unknown as typeof globalThis.fetch

    const { assertion } = await setupAuthedClient(harness.app)
    await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/completion',
      headers: { 'risu-auth': assertion },
      payload: {
        provider: 'nanogpt',
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'hi' }],
        stream: false,
        options: { nanogpt: { apiKey: 'nk-test', useSubscription: true } },
      },
    })
    expect(capturedUrl).toBe(
      'https://nano-gpt.com/api/subscription/v1/chat/completions',
    )
  })

  it('openrouter 400s when options.openrouter.apiKey is missing', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/completion',
      headers: { 'risu-auth': assertion },
      payload: {
        provider: 'openrouter',
        model: 'openrouter-model',
        messages: [{ role: 'user', content: 'hi' }],
        stream: false,
        options: { openrouter: {} },
      },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'options.openrouter.apiKey is required' })
  })

  it('openrouter forwards to openrouter.ai with X-Title + HTTP-Referer', async () => {
    let captured: { url: string; init: RequestInit } | null = null
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      captured = { url, init }
      return okOpenAIResponse('openrouter ok')
    }) as unknown as typeof globalThis.fetch

    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/completion',
      headers: { 'risu-auth': assertion },
      payload: {
        provider: 'openrouter',
        model: 'anthropic/claude-3.5-sonnet',
        messages: [{ role: 'user', content: 'hi' }],
        stream: false,
        options: { openrouter: { apiKey: 'or-test' } },
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ type: 'success', result: 'openrouter ok' })

    expect(captured!.url).toBe('https://openrouter.ai/api/v1/chat/completions')
    const headers = captured!.init.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer or-test')
    expect(headers['X-Title']).toBe('RisuAI')
    expect(headers['HTTP-Referer']).toBe('https://risuai.xyz')
  })
})
