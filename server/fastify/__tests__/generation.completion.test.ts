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
      payload: { ...basePayload, provider: 'novelai' },
    })
    expect(res.statusCode).toBe(501)
    expect(res.json()).toEqual({
      reason: 'provider not implemented yet: novelai',
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

describe('Phase 6-5 POST /api/v1/generate/completion (anthropic)', () => {
  const anthropicPayload = {
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
    messages: [{ role: 'user', content: 'hi' }],
    stream: false,
    options: {
      anthropic: { apiKey: 'sk-ant-test', maxTokens: 512 },
    },
  }

  it('400s when options.anthropic.apiKey is missing', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/completion',
      headers: { 'risu-auth': assertion },
      payload: { ...anthropicPayload, options: { anthropic: {} } },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'options.anthropic.apiKey is required' })
  })

  it('non-streaming forwards to /messages with x-api-key + anthropic-version and returns text', async () => {
    let captured: { url: string; init: RequestInit } | null = null
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      captured = { url, init }
      return new Response(
        JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
          content: [{ type: 'text', text: 'hi from claude' }],
          stop_reason: 'end_turn',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as unknown as typeof globalThis.fetch

    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/completion',
      headers: { 'risu-auth': assertion },
      payload: {
        ...anthropicPayload,
        options: {
          anthropic: { apiKey: 'sk-ant-test', maxTokens: 512, system: 'be brief' },
        },
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      type: 'success',
      result: 'hi from claude',
      model: 'claude-3-5-sonnet-20241022',
    })

    expect(captured!.url).toBe('https://api.anthropic.com/v1/messages')
    const headers = captured!.init.headers as Record<string, string>
    expect(headers['x-api-key']).toBe('sk-ant-test')
    expect(headers['anthropic-version']).toBe('2023-06-01')
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.model).toBe('claude-3-5-sonnet-20241022')
    expect(sent.max_tokens).toBe(512)
    expect(sent.system).toBe('be brief')
    expect(sent.stream).toBe(false)
  })

  it('streaming relays content_block_delta + message_stop into the normalized envelope', async () => {
    const enc = new TextEncoder()
    const upstreamFrames = [
      `event: message_start\ndata: {}\n\n`,
      `event: content_block_delta\ndata: ${JSON.stringify({ delta: { type: 'text_delta', text: 'hi' } })}\n\n`,
      `event: message_delta\ndata: ${JSON.stringify({ delta: { stop_reason: 'end_turn' } })}\n\n`,
      `event: message_stop\ndata: {}\n\n`,
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
      payload: { ...anthropicPayload, stream: true },
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('text/event-stream')
    expect(res.body).toBe(
      `event: chunk\ndata: ${JSON.stringify({ type: 'token', content: 'hi' })}\n\n` +
        `event: done\ndata: ${JSON.stringify({ finishReason: 'stop' })}\n\n`,
    )
  })

  it('applies additionalParams overlay to the anthropic body + headers', async () => {
    let captured: { url: string; init: RequestInit } | null = null
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      captured = { url, init }
      return new Response(
        JSON.stringify({
          content: [{ type: 'text', text: 'rp ok' }],
          stop_reason: 'end_turn',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as unknown as typeof globalThis.fetch

    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/completion',
      headers: { 'risu-auth': assertion },
      payload: {
        provider: 'anthropic',
        model: 'claude-on-proxy',
        messages: [{ role: 'user', content: 'hi' }],
        stream: false,
        options: {
          anthropic: {
            apiKey: 'sk-proxy',
            baseUrl: 'https://proxy.example.com/v1',
            maxTokens: 256,
            additionalParams: [
              ['header::anthropic-beta', 'cool-beta'],
              ['extra.flag', 'true'],
            ],
          },
        },
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ type: 'success', result: 'rp ok' })
    expect(captured!.url).toBe('https://proxy.example.com/v1/messages')
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.extra).toEqual({ flag: true })
    const headers = captured!.init.headers as Record<string, string>
    expect(headers['anthropic-beta']).toBe('cool-beta')
    expect(headers['x-api-key']).toBe('sk-proxy')
  })

  it('400s with a specific error when options.anthropic.additionalParams is malformed', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/completion',
      headers: { 'risu-auth': assertion },
      payload: {
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-20241022',
        messages: [{ role: 'user', content: 'hi' }],
        stream: false,
        options: {
          anthropic: {
            apiKey: 'sk-ant-test',
            additionalParams: 'oops',
          },
        },
      },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/options\.anthropic\.additionalParams/)
  })
})

describe('Phase 6-6 POST /api/v1/generate/completion (mistral)', () => {
  const mistralPayload = {
    provider: 'mistral',
    model: 'mistral-large-latest',
    messages: [
      { role: 'user', content: 'first' },
      { role: 'user', content: 'second' },
    ],
    stream: false,
    options: {
      mistral: { apiKey: 'mk-test', maxTokens: 256, temperature: 0.4 },
    },
  }

  it('400s when options.mistral.apiKey is missing', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/completion',
      headers: { 'risu-auth': assertion },
      payload: { ...mistralPayload, options: { mistral: {} } },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'options.mistral.apiKey is required' })
  })

  it('non-streaming forwards to api.mistral.ai with Bearer auth, safe_prompt=false, and the reformatted messages', async () => {
    let captured: { url: string; init: RequestInit } | null = null
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      captured = { url, init }
      return new Response(
        JSON.stringify({
          model: 'mistral-large-latest',
          choices: [{ message: { content: 'mistral ok' }, finish_reason: 'stop' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as unknown as typeof globalThis.fetch

    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/completion',
      headers: { 'risu-auth': assertion },
      payload: mistralPayload,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      type: 'success',
      result: 'mistral ok',
      model: 'mistral-large-latest',
    })

    expect(captured!.url).toBe('https://api.mistral.ai/v1/chat/completions')
    const headers = captured!.init.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer mk-test')
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.model).toBe('mistral-large-latest')
    expect(sent.safe_prompt).toBe(false)
    expect(sent.max_tokens).toBe(256)
    expect(sent.temperature).toBe(0.4)
    // The two consecutive user turns must be coalesced before the upstream
    // sees them. That collapse happens server-side, not in the SPA payload.
    expect(sent.messages).toEqual([{ role: 'user', content: 'first\nsecond' }])
  })

  it('streaming relays upstream SSE deltas through the normalized envelope', async () => {
    const enc = new TextEncoder()
    const upstreamFrames = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'mis' } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'tral' }, finish_reason: 'stop' }] })}\n\n`,
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
      payload: { ...mistralPayload, stream: true },
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('text/event-stream')
    expect(res.body).toBe(
      `event: chunk\ndata: ${JSON.stringify({ type: 'token', content: 'mis' })}\n\n` +
        `event: chunk\ndata: ${JSON.stringify({ type: 'token', content: 'tral' })}\n\n` +
        `event: done\ndata: ${JSON.stringify({ finishReason: 'stop' })}\n\n`,
    )
  })
})

describe('Phase 6-23 POST /api/v1/generate/completion (mistral additionalParams + reverse_proxy)', () => {
  it('applies additionalParams overlay to the mistral body + headers', async () => {
    let captured: { url: string; init: RequestInit } | null = null
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      captured = { url, init }
      return new Response(
        JSON.stringify({
          model: 'mistral-on-proxy',
          choices: [{ message: { content: 'rp ok' }, finish_reason: 'stop' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as unknown as typeof globalThis.fetch

    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/completion',
      headers: { 'risu-auth': assertion },
      payload: {
        provider: 'mistral',
        model: 'mistral-on-proxy',
        messages: [{ role: 'user', content: 'hi' }],
        stream: false,
        options: {
          mistral: {
            apiKey: 'sk-proxy',
            baseUrl: 'https://proxy.example.com/v1',
            maxTokens: 256,
            extraHeaders: { 'X-Proxy-Risu': 'RisuAI' },
            additionalParams: [
              ['header::X-Custom', 'cool'],
              ['extra.flag', 'true'],
            ],
          },
        },
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ type: 'success', result: 'rp ok' })
    expect(captured!.url).toBe('https://proxy.example.com/v1/chat/completions')
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.extra).toEqual({ flag: true })
    const headers = captured!.init.headers as Record<string, string>
    expect(headers['X-Custom']).toBe('cool')
    expect(headers['X-Proxy-Risu']).toBe('RisuAI')
    expect(headers.authorization).toBe('Bearer sk-proxy')
  })

  it('400s with a specific error when options.mistral.additionalParams is malformed', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/completion',
      headers: { 'risu-auth': assertion },
      payload: {
        provider: 'mistral',
        model: 'mistral-large-latest',
        messages: [{ role: 'user', content: 'hi' }],
        stream: false,
        options: {
          mistral: {
            apiKey: 'mk-test',
            additionalParams: 'oops',
          },
        },
      },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/options\.mistral\.additionalParams/)
  })
})

describe('Phase 6-8 POST /api/v1/generate/completion (openai with custom baseUrl)', () => {
  // DeepSeek / DeepInfra route through provider='openai' with a derived
  // baseUrl (from modelInfo.endpoint) and a key from db.OaiCompAPIKeys[...].
  // The wire shape is identical to vanilla openai; only the URL differs.
  const deepseekPayload = {
    provider: 'openai',
    model: 'deepseek-chat',
    messages: [{ role: 'user', content: 'hi' }],
    stream: false,
    options: {
      openai: {
        apiKey: 'ds-key',
        baseUrl: 'https://api.deepseek.com/beta',
      },
    },
  }

  it('routes to {baseUrl}/chat/completions when options.openai.baseUrl is set', async () => {
    let captured: { url: string; init: RequestInit } | null = null
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      captured = { url, init }
      return new Response(
        JSON.stringify({
          model: 'deepseek-chat',
          choices: [{ message: { content: 'deepseek ok' }, finish_reason: 'stop' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as unknown as typeof globalThis.fetch

    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/completion',
      headers: { 'risu-auth': assertion },
      payload: deepseekPayload,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ type: 'success', result: 'deepseek ok' })
    expect(captured!.url).toBe('https://api.deepseek.com/beta/chat/completions')
    const headers = captured!.init.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer ds-key')
  })
})

describe('Phase 6-17 POST /api/v1/generate/completion (xcustom OAI-compat additionalParams)', () => {
  it('applies the additionalParams overlay to the outgoing body + headers', async () => {
    let captured: { url: string; init: RequestInit } | null = null
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      captured = { url, init }
      return new Response(
        JSON.stringify({
          model: 'gpt-on-acme',
          choices: [{ message: { content: 'xcustom ok' }, finish_reason: 'stop' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as unknown as typeof globalThis.fetch

    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/completion',
      headers: { 'risu-auth': assertion },
      payload: {
        provider: 'openai',
        model: 'gpt-on-acme',
        messages: [{ role: 'user', content: 'hi' }],
        stream: false,
        options: {
          openai: {
            apiKey: 'sk-xcustom',
            baseUrl: 'https://acme.example.com/v1',
            temperature: 0.7,
            additionalParams: [
              ['header::X-Custom', 'hello'],
              ['extra.flag', 'true'],
              ['temperature', '{{none}}'],
            ],
          },
        },
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ type: 'success', result: 'xcustom ok' })
    expect(captured!.url).toBe('https://acme.example.com/v1/chat/completions')
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.extra).toEqual({ flag: true })
    // temperature was set to 0.7 in defaults, then deleted by {{none}}.
    expect(sent.temperature).toBeUndefined()
    const headers = captured!.init.headers as Record<string, string>
    expect(headers['X-Custom']).toBe('hello')
  })

  it('applies oobaSystemHoist + extraHeaders for reverse_proxy through the same openai route', async () => {
    let captured: { url: string; init: RequestInit } | null = null
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      captured = { url, init }
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'rp ok' }, finish_reason: 'stop' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as unknown as typeof globalThis.fetch

    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/completion',
      headers: { 'risu-auth': assertion },
      payload: {
        provider: 'openai',
        model: 'gpt-on-proxy',
        messages: [
          { role: 'system', content: 'rule 1' },
          { role: 'user', content: 'q' },
          { role: 'system', content: 'rule 2' },
        ],
        stream: false,
        options: {
          openai: {
            apiKey: 'sk-proxy',
            baseUrl: 'https://proxy.example.com/v1',
            oobaSystemHoist: true,
            extraHeaders: { 'X-Proxy-Risu': 'RisuAI' },
            additionalParams: [['header::X-Custom', 'rp-hello']],
          },
        },
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ type: 'success', result: 'rp ok' })
    expect(captured!.url).toBe('https://proxy.example.com/v1/chat/completions')
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.messages).toEqual([
      { role: 'user', content: 'q' },
      { role: 'system', content: 'rule 1\nrule 2' },
    ])
    const headers = captured!.init.headers as Record<string, string>
    expect(headers['X-Proxy-Risu']).toBe('RisuAI')
    expect(headers['X-Custom']).toBe('rp-hello')
    expect(headers.authorization).toBe('Bearer sk-proxy')
  })

  it('400s with a specific error when additionalParams shape is malformed', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/completion',
      headers: { 'risu-auth': assertion },
      payload: {
        provider: 'openai',
        model: 'gpt-on-acme',
        messages: [{ role: 'user', content: 'hi' }],
        stream: false,
        options: {
          openai: {
            apiKey: 'sk-xcustom',
            additionalParams: 'oops',
          },
        },
      },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/additionalParams/)
  })
})

describe('Phase 6-7 POST /api/v1/generate/completion (cohere)', () => {
  const coherePayload = {
    provider: 'cohere',
    model: 'command-r-plus-04-2024',
    messages: [
      { role: 'system', content: 'be brief' },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
      { role: 'user', content: 'what now' },
    ],
    stream: false,
    options: { cohere: { apiKey: 'co-test', safetyMode: 'NONE' } },
  }

  it('400s when options.cohere.apiKey is missing', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/completion',
      headers: { 'risu-auth': assertion },
      payload: { ...coherePayload, options: { cohere: {} } },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'options.cohere.apiKey is required' })
  })

  it('400s when stream=true (cohere streaming not supported yet)', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/completion',
      headers: { 'risu-auth': assertion },
      payload: { ...coherePayload, stream: true },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/cohere streaming/)
  })

  it('forwards to api.cohere.com/v1/chat with the reformatted message + chat_history + preamble', async () => {
    let captured: { url: string; init: RequestInit } | null = null
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      captured = { url, init }
      return new Response(JSON.stringify({ text: 'cohere ok' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as unknown as typeof globalThis.fetch

    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/completion',
      headers: { 'risu-auth': assertion },
      payload: coherePayload,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ type: 'success', result: 'cohere ok' })

    expect(captured!.url).toBe('https://api.cohere.com/v1/chat')
    const headers = captured!.init.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer co-test')
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.message).toBe('what now')
    expect(sent.preamble).toBe('be brief')
    expect(sent.chat_history).toEqual([
      { role: 'USER', message: 'hello' },
      { role: 'CHATBOT', message: 'hi' },
    ])
    expect(sent.safety_mode).toBe('NONE')
  })
})

describe('Phase 6-24 POST /api/v1/generate/completion (cohere additionalParams + reverse_proxy)', () => {
  it('applies additionalParams overlay to the cohere body + headers', async () => {
    let captured: { url: string; init: RequestInit } | null = null
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      captured = { url, init }
      return new Response(JSON.stringify({ text: 'rp ok' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as unknown as typeof globalThis.fetch

    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/completion',
      headers: { 'risu-auth': assertion },
      payload: {
        provider: 'cohere',
        model: 'command-on-proxy',
        messages: [{ role: 'user', content: 'hi' }],
        stream: false,
        options: {
          cohere: {
            apiKey: 'sk-proxy',
            baseUrl: 'https://proxy.example.com/v1',
            extraHeaders: { 'X-Proxy-Risu': 'RisuAI' },
            additionalParams: [
              ['header::X-Custom', 'cool'],
              ['extra.flag', 'true'],
            ],
          },
        },
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ type: 'success', result: 'rp ok' })
    expect(captured!.url).toBe('https://proxy.example.com/v1/chat')
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.extra).toEqual({ flag: true })
    const headers = captured!.init.headers as Record<string, string>
    expect(headers['X-Custom']).toBe('cool')
    expect(headers['X-Proxy-Risu']).toBe('RisuAI')
    expect(headers.authorization).toBe('Bearer sk-proxy')
  })

  it('400s with a specific error when options.cohere.additionalParams is malformed', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/completion',
      headers: { 'risu-auth': assertion },
      payload: {
        provider: 'cohere',
        model: 'command-r-plus-04-2024',
        messages: [{ role: 'user', content: 'hi' }],
        stream: false,
        options: {
          cohere: {
            apiKey: 'co-test',
            additionalParams: 'oops',
          },
        },
      },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/options\.cohere\.additionalParams/)
  })
})

describe('Phase 6-12 POST /api/v1/generate/completion (openai-responses)', () => {
  it('forwards to /v1/responses with input items', async () => {
    let captured: { url: string; init: RequestInit } | null = null
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      captured = { url, init }
      return new Response(
        JSON.stringify({
          model: 'gpt-5',
          output: [
            { type: 'message', content: [{ type: 'output_text', text: 'resp ok' }] },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as unknown as typeof globalThis.fetch

    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/completion',
      headers: { 'risu-auth': assertion },
      payload: {
        provider: 'openai-responses',
        model: 'gpt-5',
        messages: [{ role: 'user', content: 'hi' }],
        stream: false,
        options: { 'openai-responses': { apiKey: 'sk-resp', maxOutputTokens: 128 } },
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ type: 'success', result: 'resp ok' })
    expect(captured!.url).toBe('https://api.openai.com/v1/responses')
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.input).toEqual([
      { role: 'user', content: [{ type: 'input_text', text: 'hi' }] },
    ])
    expect(sent.max_output_tokens).toBe(128)
  })
})

describe('Phase 6-25 POST /api/v1/generate/completion (openai-responses additionalParams + reverse_proxy)', () => {
  it('applies additionalParams overlay to the openai-responses body + headers', async () => {
    let captured: { url: string; init: RequestInit } | null = null
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      captured = { url, init }
      return new Response(
        JSON.stringify({
          model: 'gpt-on-proxy',
          output: [
            { type: 'message', content: [{ type: 'output_text', text: 'rp ok' }] },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as unknown as typeof globalThis.fetch

    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/completion',
      headers: { 'risu-auth': assertion },
      payload: {
        provider: 'openai-responses',
        model: 'gpt-on-proxy',
        messages: [{ role: 'user', content: 'hi' }],
        stream: false,
        options: {
          'openai-responses': {
            apiKey: 'sk-proxy',
            baseUrl: 'https://proxy.example.com/v1',
            maxOutputTokens: 256,
            additionalParams: [
              ['header::X-Custom', 'cool'],
              ['extra.flag', 'true'],
            ],
          },
        },
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ type: 'success', result: 'rp ok' })
    expect(captured!.url).toBe('https://proxy.example.com/v1/responses')
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.extra).toEqual({ flag: true })
    const headers = captured!.init.headers as Record<string, string>
    expect(headers['X-Custom']).toBe('cool')
    expect(headers.authorization).toBe('Bearer sk-proxy')
  })

  it('400s with a specific error when options["openai-responses"].additionalParams is malformed', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/completion',
      headers: { 'risu-auth': assertion },
      payload: {
        provider: 'openai-responses',
        model: 'gpt-5',
        messages: [{ role: 'user', content: 'hi' }],
        stream: false,
        options: {
          'openai-responses': {
            apiKey: 'sk-resp',
            additionalParams: 'oops',
          },
        },
      },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/options\["openai-responses"\]\.additionalParams/)
  })
})

describe('Phase 6-26 POST /api/v1/generate/completion (openai-legacy-instruct additionalParams + reverse_proxy)', () => {
  it('applies additionalParams overlay to the legacy-instruct body + headers', async () => {
    let captured: { url: string; init: RequestInit } | null = null
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      captured = { url, init }
      return new Response(
        JSON.stringify({
          model: 'gpt-on-proxy',
          choices: [{ text: 'rp ok' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as unknown as typeof globalThis.fetch

    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/completion',
      headers: { 'risu-auth': assertion },
      payload: {
        provider: 'openai-legacy-instruct',
        model: 'gpt-on-proxy',
        messages: [{ role: 'user', content: 'hi' }],
        stream: false,
        options: {
          'openai-legacy-instruct': {
            apiKey: 'sk-proxy',
            baseUrl: 'https://proxy.example.com/v1',
            maxTokens: 256,
            additionalParams: [
              ['header::X-Custom', 'cool'],
              ['extra.flag', 'true'],
            ],
          },
        },
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ type: 'success', result: 'rp ok' })
    expect(captured!.url).toBe('https://proxy.example.com/v1/completions')
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.extra).toEqual({ flag: true })
    const headers = captured!.init.headers as Record<string, string>
    expect(headers['X-Custom']).toBe('cool')
    expect(headers.authorization).toBe('Bearer sk-proxy')
  })

  it('400s with a specific error when options["openai-legacy-instruct"].additionalParams is malformed', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/completion',
      headers: { 'risu-auth': assertion },
      payload: {
        provider: 'openai-legacy-instruct',
        model: 'gpt-3.5-turbo-instruct',
        messages: [{ role: 'user', content: 'hi' }],
        stream: false,
        options: {
          'openai-legacy-instruct': {
            apiKey: 'sk-test',
            additionalParams: 'oops',
          },
        },
      },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/options\["openai-legacy-instruct"\]\.additionalParams/)
  })
})

describe('Phase 6-10 POST /api/v1/generate/completion (openai-legacy-instruct)', () => {
  const legacyPayload = {
    provider: 'openai-legacy-instruct',
    model: 'gpt-3.5-turbo-instruct',
    messages: [
      { role: 'system', content: 'be brief' },
      { role: 'user', content: 'hi' },
    ],
    stream: false,
    options: {
      'openai-legacy-instruct': { apiKey: 'sk-test', maxTokens: 128 },
    },
  }

  it('400s when apiKey is missing', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/completion',
      headers: { 'risu-auth': assertion },
      payload: { ...legacyPayload, options: { 'openai-legacy-instruct': {} } },
    })
    expect(res.statusCode).toBe(400)
  })

  it('400s when stream=true (not yet supported)', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/completion',
      headers: { 'risu-auth': assertion },
      payload: { ...legacyPayload, stream: true },
    })
    expect(res.statusCode).toBe(400)
  })

  it('forwards to /v1/completions with a flattened prompt', async () => {
    let captured: { url: string; init: RequestInit } | null = null
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      captured = { url, init }
      return new Response(
        JSON.stringify({ choices: [{ text: 'pong' }], model: 'gpt-3.5-turbo-instruct' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as unknown as typeof globalThis.fetch

    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/completion',
      headers: { 'risu-auth': assertion },
      payload: legacyPayload,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ type: 'success', result: 'pong' })
    expect(captured!.url).toBe('https://api.openai.com/v1/completions')
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.prompt).toContain('## User\nhi')
    expect(sent.prompt).toContain('## Response')
  })
})

describe('Phase 6-22 POST /api/v1/generate/completion (horde)', () => {
  it('400s when options.horde.prompt is missing', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/completion',
      headers: { 'risu-auth': assertion },
      payload: {
        provider: 'horde',
        model: 'koboldcpp/Mistral',
        messages: [{ role: 'user', content: 'hi' }],
        stream: false,
        options: { horde: {} },
      },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/options\.horde\.prompt/)
  })

  it('400s when stream=true is requested', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/completion',
      headers: { 'risu-auth': assertion },
      payload: {
        provider: 'horde',
        model: 'koboldcpp/Mistral',
        messages: [{ role: 'user', content: 'hi' }],
        stream: true,
        options: { horde: { prompt: 'flattened' } },
      },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/horde streaming is not yet supported/)
  })

  it('submits async + polls + returns generations[0].text', async () => {
    let pollCount = 0
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      if (url.endsWith('/generate/text/async')) {
        return new Response(JSON.stringify({ id: 'route-job' }), {
          status: 202,
          headers: { 'content-type': 'application/json' },
        })
      }
      if (init?.method === 'DELETE') {
        return new Response('{}', { status: 200 })
      }
      pollCount++
      if (pollCount < 2) {
        return new Response(JSON.stringify({ done: false }), { status: 200 })
      }
      return new Response(
        JSON.stringify({ done: true, generations: [{ text: 'horde route ok' }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as unknown as typeof globalThis.fetch

    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/completion',
      headers: { 'risu-auth': assertion },
      payload: {
        provider: 'horde',
        model: 'koboldcpp/Mistral',
        messages: [{ role: 'user', content: 'hi' }],
        stream: false,
        options: {
          horde: {
            prompt: 'flattened user: hi',
            apiKey: 'my-key',
            // Short poll interval keeps the test fast without fake timers
            // (the route hits real timers under hood).
            pollIntervalMs: 10,
            timeoutMs: 5000,
          },
        },
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ type: 'success', result: 'horde route ok' })
  })
})

describe('Phase 6-21 POST /api/v1/generate/completion (bedrock)', () => {
  it('400s when options.bedrock.credentials is missing', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/completion',
      headers: { 'risu-auth': assertion },
      payload: {
        provider: 'bedrock',
        model: 'us.test',
        messages: [{ role: 'user', content: 'hi' }],
        stream: false,
        options: { bedrock: {} },
      },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/options\.bedrock\.credentials/)
  })

  it('400s when credentials are partially populated', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/completion',
      headers: { 'risu-auth': assertion },
      payload: {
        provider: 'bedrock',
        model: 'us.test',
        messages: [{ role: 'user', content: 'hi' }],
        stream: false,
        options: {
          bedrock: { credentials: { accessKeyId: 'AKIA', secretAccessKey: 's' } },
        },
      },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/options\.bedrock\.region/)
  })

  it('400s when streaming is requested (not supported yet)', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/completion',
      headers: { 'risu-auth': assertion },
      payload: {
        provider: 'bedrock',
        model: 'us.test',
        messages: [{ role: 'user', content: 'hi' }],
        stream: true,
        options: {
          bedrock: {
            credentials: { accessKeyId: 'AKIA', secretAccessKey: 's', region: 'us-east-1' },
          },
        },
      },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/bedrock streaming is not yet supported/)
  })

  it('signs the request with SigV4 and forwards the body to the Bedrock URL', async () => {
    let captured: { url: string; init: RequestInit } | null = null
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      captured = { url, init }
      return new Response(
        JSON.stringify({
          content: [{ type: 'text', text: 'bedrock route ok' }],
          stop_reason: 'end_turn',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as unknown as typeof globalThis.fetch

    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/completion',
      headers: { 'risu-auth': assertion },
      payload: {
        provider: 'bedrock',
        model: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
        messages: [{ role: 'user', content: 'hi' }],
        stream: false,
        options: {
          bedrock: {
            credentials: {
              accessKeyId: 'AKIA',
              secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
              region: 'us-east-1',
            },
            maxTokens: 256,
            system: 'be brief',
          },
        },
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ type: 'success', result: 'bedrock route ok' })
    expect(captured!.url).toBe(
      'https://bedrock-runtime.us-east-1.amazonaws.com/model/us.anthropic.claude-3-5-sonnet-20241022-v2%3A0/invoke',
    )
    const headers = captured!.init.headers as Record<string, string>
    expect(headers['Authorization']).toContain(
      'AWS4-HMAC-SHA256 Credential=AKIA/',
    )
    expect(headers['Authorization']).toContain('us-east-1/bedrock/aws4_request')
    expect(headers['x-amz-date']).toMatch(/^\d{8}T\d{6}Z$/)
    const body = JSON.parse(captured!.init.body as string)
    expect(body.anthropic_version).toBe('bedrock-2023-05-31')
    expect(body.system).toBe('be brief')
    expect(body.max_tokens).toBe(256)
    expect(body.model).toBeUndefined()
  })
})

describe('Phase 6-20 POST /api/v1/generate/completion (gemini vertex)', () => {
  it('400s when options.gemini.vertex is partially populated', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/completion',
      headers: { 'risu-auth': assertion },
      payload: {
        provider: 'gemini',
        model: 'gemini-2.5-pro',
        messages: [{ role: 'user', content: 'hi' }],
        stream: false,
        options: {
          gemini: {
            vertex: { projectId: 'p', region: 'us-central1' },
          },
        },
      },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/options\.gemini\.vertex\.clientEmail/)
  })

  it('routes a buffered Vertex request through token exchange then the vertex prediction endpoint', async () => {
    const { generateKeyPairSync } = await import('node:crypto')
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    })
    const { _resetVertexTokenCacheForTesting } = await import(
      '../src/generation/vertexAuth.js'
    )
    _resetVertexTokenCacheForTesting()

    const calls: Array<{ url: string; init: RequestInit }> = []
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      if (url === 'https://oauth2.googleapis.com/token') {
        return new Response(
          JSON.stringify({ access_token: 'ya29.route-token', expires_in: 3599 }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response(
        JSON.stringify({
          modelVersion: 'gemini-2.5-pro',
          candidates: [
            { content: { parts: [{ text: 'vertex route ok' }] }, finishReason: 'STOP' },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as unknown as typeof globalThis.fetch

    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/completion',
      headers: { 'risu-auth': assertion },
      payload: {
        provider: 'gemini',
        model: 'gemini-2.5-pro',
        messages: [{ role: 'user', content: 'hi' }],
        stream: false,
        options: {
          gemini: {
            vertex: {
              projectId: 'my-project',
              region: 'us-central1',
              clientEmail: 'svc@my-project.iam.gserviceaccount.com',
              privateKey,
            },
          },
        },
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ type: 'success', result: 'vertex route ok' })
    expect(calls.map((c) => c.url)).toEqual([
      'https://oauth2.googleapis.com/token',
      'https://us-central1-aiplatform.googleapis.com/v1/projects/my-project/locations/us-central1/publishers/google/models/gemini-2.5-pro:generateContent',
    ])
    const headers = calls[1].init.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer ya29.route-token')
  })
})

describe('Phase 6-9 POST /api/v1/generate/completion (gemini)', () => {
  const geminiPayload = {
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    messages: [
      { role: 'system', content: 'be brief' },
      { role: 'user', content: 'hi' },
    ],
    stream: false,
    options: { gemini: { apiKey: 'goog-test', maxOutputTokens: 256 } },
  }

  it('400s when options.gemini.apiKey is missing', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/completion',
      headers: { 'risu-auth': assertion },
      payload: { ...geminiPayload, options: { gemini: {} } },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/options\.gemini\.apiKey/)
  })

  it('non-streaming forwards to /models/<model>:generateContent?key=<apiKey> with contents + systemInstruction', async () => {
    let captured: { url: string; init: RequestInit } | null = null
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      captured = { url, init }
      return new Response(
        JSON.stringify({
          modelVersion: 'gemini-2.5-flash',
          candidates: [{ content: { parts: [{ text: 'gemini ok' }] }, finishReason: 'STOP' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as unknown as typeof globalThis.fetch

    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/completion',
      headers: { 'risu-auth': assertion },
      payload: geminiPayload,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      type: 'success',
      result: 'gemini ok',
      model: 'gemini-2.5-flash',
    })

    expect(captured!.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=goog-test',
    )
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.contents).toEqual([{ role: 'user', parts: [{ text: 'hi' }] }])
    expect(sent.systemInstruction).toEqual({ parts: [{ text: 'be brief' }] })
    expect(sent.generationConfig).toEqual({ maxOutputTokens: 256 })
  })

  it('streaming relays per-frame candidates text into the normalized envelope', async () => {
    const enc = new TextEncoder()
    const frame = (text: string, fr?: string): string => {
      const c: Record<string, unknown> = { content: { parts: [{ text }] } }
      if (fr !== undefined) c.finishReason = fr
      return `data: ${JSON.stringify({ candidates: [c] })}\n\n`
    }
    globalThis.fetch = (async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(enc.encode(frame('hi')))
          controller.enqueue(enc.encode(frame(' there', 'STOP')))
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
      payload: { ...geminiPayload, stream: true },
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('text/event-stream')
    expect(res.body).toBe(
      `event: chunk\ndata: ${JSON.stringify({ type: 'token', content: 'hi' })}\n\n` +
        `event: chunk\ndata: ${JSON.stringify({ type: 'token', content: ' there' })}\n\n` +
        `event: done\ndata: ${JSON.stringify({ finishReason: 'stop' })}\n\n`,
    )
  })
})

describe('Phase 6-16 POST /api/v1/generate/completion (ollama)', () => {
  const ollamaPayload = {
    provider: 'ollama',
    model: 'llama3',
    messages: [
      { role: 'system', content: 'be brief' },
      { role: 'user', content: 'hi' },
    ],
    stream: false,
    options: { ollama: { baseUrl: 'http://localhost:11434', maxTokens: 128 } },
  }

  it('400s when options.ollama.baseUrl is missing', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/completion',
      headers: { 'risu-auth': assertion },
      payload: { ...ollamaPayload, options: { ollama: {} } },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/options\.ollama\.baseUrl/)
  })

  it('non-streaming forwards to {baseUrl}/api/chat and returns message.content', async () => {
    let captured: { url: string; init: RequestInit } | null = null
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      captured = { url, init }
      return new Response(
        JSON.stringify({
          model: 'llama3',
          message: { role: 'assistant', content: 'ollama route ok' },
          done: true,
          done_reason: 'stop',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as unknown as typeof globalThis.fetch

    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/completion',
      headers: { 'risu-auth': assertion },
      payload: ollamaPayload,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      type: 'success',
      result: 'ollama route ok',
      model: 'llama3',
    })

    expect(captured!.url).toBe('http://localhost:11434/api/chat')
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.model).toBe('llama3')
    expect(sent.stream).toBe(false)
    expect(sent.messages).toEqual([
      { role: 'system', content: 'be brief' },
      { role: 'user', content: 'hi' },
    ])
    expect(sent.options).toEqual({ num_predict: 128 })
  })

  it('streaming relays per-line NDJSON content into the normalized envelope', async () => {
    const enc = new TextEncoder()
    globalThis.fetch = (async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            enc.encode(
              `${JSON.stringify({ message: { content: 'hi' }, done: false })}\n`,
            ),
          )
          controller.enqueue(
            enc.encode(
              `${JSON.stringify({ message: { content: ' there' }, done: false })}\n`,
            ),
          )
          controller.enqueue(
            enc.encode(
              `${JSON.stringify({ message: { content: '' }, done: true, done_reason: 'stop' })}\n`,
            ),
          )
          controller.close()
        },
      })
      return new Response(body, {
        status: 200,
        headers: { 'content-type': 'application/x-ndjson' },
      })
    }) as unknown as typeof globalThis.fetch

    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/completion',
      headers: { 'risu-auth': assertion },
      payload: { ...ollamaPayload, stream: true },
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('text/event-stream')
    expect(res.body).toBe(
      `event: chunk\ndata: ${JSON.stringify({ type: 'token', content: 'hi' })}\n\n` +
        `event: chunk\ndata: ${JSON.stringify({ type: 'token', content: ' there' })}\n\n` +
        `event: done\ndata: ${JSON.stringify({ finishReason: 'stop' })}\n\n`,
    )
  })
})

