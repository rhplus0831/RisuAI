import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { webcrypto } from 'node:crypto'
import { buildApp } from '../src/app.js'
import type { FastifyInstance } from 'fastify'

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
    },
  })
  return { app, dataDir }
}

async function stopHarness(h: Harness): Promise<void> {
  await h.app.close()
  rmSync(h.dataDir, { recursive: true, force: true })
}

let harness: Harness

beforeEach(async () => {
  harness = await startHarness()
})

afterEach(async () => {
  await stopHarness(harness)
})

describe('Fastify foundation smoke', () => {
  it('reports health', async () => {
    const res = await harness.app.inject({ method: 'GET', url: '/api/v1/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok', revision: 0, schemaVersion: 0 })
  })

  it('walks the no-password setup-login flow and accepts the resulting assertion', async () => {
    const status1 = await harness.app.inject({ method: 'GET', url: '/api/v1/auth/status' })
    expect(status1.statusCode).toBe(200)
    expect(status1.json()).toEqual({ noPassword: true, authorized: false })

    const setup = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/setup',
      payload: { password: 'hunter2' },
    })
    expect(setup.statusCode).toBe(200)
    expect(setup.json()).toEqual({ status: 'success' })

    const setupAgain = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/setup',
      payload: { password: 'other' },
    })
    expect(setupAgain.statusCode).toBe(400)

    const keypair = (await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
      'verify',
    ])) as CryptoKeyPair
    const publicKey = await subtle.exportKey('jwk', keypair.publicKey)

    const loginBad = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { password: 'wrong', publicKey },
    })
    expect(loginBad.statusCode).toBe(400)

    const login = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { password: 'hunter2', publicKey },
    })
    expect(login.statusCode).toBe(200)
    expect(login.json()).toEqual({ status: 'success' })

    const assertion = await signAssertion(keypair.privateKey, publicKey)

    const status2 = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/auth/status',
      headers: { 'risu-auth': assertion },
    })
    expect(status2.statusCode).toBe(200)
    expect(status2.json()).toEqual({ noPassword: false, authorized: true })

    const expired = await signAssertion(keypair.privateKey, publicKey, -60)
    const statusExpired = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/auth/status',
      headers: { 'risu-auth': expired },
    })
    expect(statusExpired.json()).toEqual({ noPassword: false, authorized: false })
  })
})

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
