import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash, webcrypto } from 'node:crypto'
import { buildApp } from '../src/app.js'
import { createCommandEventSink, type CommandEventSink } from '../src/commands/events.js'
import type { FastifyInstance } from 'fastify'

const subtle = webcrypto.subtle

interface Harness {
  app: FastifyInstance
  dataDir: string
  commandEvents: CommandEventSink
}

async function startHarness(): Promise<Harness> {
  process.env.LOG_LEVEL = 'silent'
  const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-fastify-'))
  const commandEvents = createCommandEventSink()
  const { app } = await buildApp({
    config: {
      host: '127.0.0.1',
      port: 0,
      dataDir,
      bodyLimit: 1024 * 1024,
      trustProxy: false,
      hubUrl: 'https://sv.risuai.xyz',
    },
    commandEvents,
  })
  return { app, dataDir, commandEvents }
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

const PNG_BYTES = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000001000000010806000000' +
    '1f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082',
  'hex',
)
const PNG_SHA = createHash('sha256').update(PNG_BYTES).digest('hex')

let harness: Harness

beforeEach(async () => {
  harness = await startHarness()
})

afterEach(async () => {
  await stopHarness(harness)
})

describe('Phase 2C assets', () => {
  it('rejects upload without auth once a password is set', async () => {
    await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/setup',
      payload: { password: 'hunter2' },
    })
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/assets',
      headers: { 'content-type': 'image/png' },
      payload: PNG_BYTES,
    })
    expect(res.statusCode).toBe(401)
  })

  it('uploads a PNG, computes sha256, writes file, returns metadata', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/assets',
      headers: { 'content-type': 'image/png', 'risu-auth': assertion },
      payload: PNG_BYTES,
    })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toEqual({
      assetId: PNG_SHA,
      size: PNG_BYTES.length,
      contentType: 'image/png',
      revision: 1,
    })
    const onDisk = path.join(harness.dataDir, 'assets', `${PNG_SHA}.png`)
    expect(existsSync(onDisk)).toBe(true)
    expect(Buffer.from(readFileSync(onDisk))).toEqual(PNG_BYTES)
  })

  it('emits an asset.created event with the bumped revision only for new assets', async () => {
    const { assertion } = await setupAuthedClient(harness.app)

    const first = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/assets',
      headers: { 'content-type': 'image/png', 'risu-auth': assertion },
      payload: PNG_BYTES,
    })
    expect(first.statusCode).toBe(201)
    expect(harness.commandEvents.list()).toEqual([
      { type: 'asset.created', resource: 'asset', revision: 1, id: PNG_SHA },
    ])

    // Re-uploading identical bytes does not bump the revision, so no event.
    const second = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/assets',
      headers: { 'content-type': 'image/png', 'risu-auth': assertion },
      payload: PNG_BYTES,
    })
    expect(second.statusCode).toBe(200)
    expect(harness.commandEvents.list()).toHaveLength(1)
  })

  it('is idempotent on re-upload of the same bytes', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const first = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/assets',
      headers: { 'content-type': 'image/png', 'risu-auth': assertion },
      payload: PNG_BYTES,
    })
    expect(first.statusCode).toBe(201)
    expect(first.json().revision).toBe(1)

    const second = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/assets',
      headers: { 'content-type': 'image/png', 'risu-auth': assertion },
      payload: PNG_BYTES,
    })
    expect(second.statusCode).toBe(200)
    expect(second.json()).toEqual({
      assetId: PNG_SHA,
      size: PNG_BYTES.length,
      contentType: 'image/png',
      revision: 1,
    })
  })

  it('returns 415 for an unsupported content-type', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/assets',
      headers: { 'content-type': 'application/x-evil', 'risu-auth': assertion },
      payload: Buffer.from('hello'),
    })
    expect(res.statusCode).toBe(415)
  })

  it('GET serves stored bytes with content-type and immutable cache header', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    await harness.app.inject({
      method: 'POST',
      url: '/api/v1/assets',
      headers: { 'content-type': 'image/png', 'risu-auth': assertion },
      payload: PNG_BYTES,
    })
    const res = await harness.app.inject({ method: 'GET', url: `/api/v1/assets/${PNG_SHA}` })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('image/png')
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable')
    expect(res.headers['content-length']).toBe(String(PNG_BYTES.length))
    expect(Buffer.from(res.rawPayload)).toEqual(PNG_BYTES)
  })

  it('GET unknown id returns 404', async () => {
    const unknown = 'a'.repeat(64)
    const res = await harness.app.inject({ method: 'GET', url: `/api/v1/assets/${unknown}` })
    expect(res.statusCode).toBe(404)
  })

  it('GET malformed id returns 404', async () => {
    const res = await harness.app.inject({ method: 'GET', url: '/api/v1/assets/not-a-sha' })
    expect(res.statusCode).toBe(404)
  })

  it('HEAD existing asset returns headers with no body', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    await harness.app.inject({
      method: 'POST',
      url: '/api/v1/assets',
      headers: { 'content-type': 'image/png', 'risu-auth': assertion },
      payload: PNG_BYTES,
    })
    const res = await harness.app.inject({ method: 'HEAD', url: `/api/v1/assets/${PNG_SHA}` })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('image/png')
    expect(res.headers['content-length']).toBe(String(PNG_BYTES.length))
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable')
    expect(res.body).toBe('')
  })

  it('HEAD unknown id returns 404', async () => {
    const unknown = 'a'.repeat(64)
    const res = await harness.app.inject({ method: 'HEAD', url: `/api/v1/assets/${unknown}` })
    expect(res.statusCode).toBe(404)
  })

  it('POST /assets/exists reports missing and present ids', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    await harness.app.inject({
      method: 'POST',
      url: '/api/v1/assets',
      headers: { 'content-type': 'image/png', 'risu-auth': assertion },
      payload: PNG_BYTES,
    })
    const otherId = 'b'.repeat(64)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/assets/exists',
      payload: { ids: [PNG_SHA, otherId] },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ missing: [otherId] })
  })

  it('POST /assets/exists with empty array returns empty missing', async () => {
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/assets/exists',
      payload: { ids: [] },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ missing: [] })
  })

  it('POST /assets/exists rejects non-array ids', async () => {
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/assets/exists',
      payload: { ids: 'not-an-array' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('POST /assets/exists rejects ids that are not sha256 hex', async () => {
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/assets/exists',
      payload: { ids: ['not-a-sha'] },
    })
    expect(res.statusCode).toBe(400)
  })

  it('uploaded asset appears in bootstrap response', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    await harness.app.inject({
      method: 'POST',
      url: '/api/v1/assets',
      headers: { 'content-type': 'image/png', 'risu-auth': assertion },
      payload: PNG_BYTES,
    })
    const onDisk = JSON.parse(readFileSync(path.join(harness.dataDir, 'db.json'), 'utf8'))
    expect(onDisk.assets).toEqual([
      { id: PNG_SHA, ext: 'png', size: PNG_BYTES.length, contentType: 'image/png' },
    ])
  })
})
