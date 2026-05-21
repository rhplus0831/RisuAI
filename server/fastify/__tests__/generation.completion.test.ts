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

beforeEach(async () => {
  harness = await startHarness()
})

afterEach(async () => {
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

  it('returns 501 for providers not implemented in Phase 6-1', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/completion',
      headers: { 'risu-auth': assertion },
      payload: { ...basePayload, provider: 'openai' },
    })
    expect(res.statusCode).toBe(501)
    expect(res.json()).toEqual({
      reason: 'provider not implemented in Phase 6-1: openai',
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
