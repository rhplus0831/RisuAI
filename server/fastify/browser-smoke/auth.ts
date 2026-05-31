import { createHash, webcrypto } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { expect } from '@playwright/test'

const subtle = webcrypto.subtle
const BROWSER_SMOKE_PASSWORD = 'risu-fastify-browser-smoke'

function passwordDigest(): string {
  return createHash('sha256').update(Buffer.from(BROWSER_SMOKE_PASSWORD, 'utf-8')).digest('hex')
}

async function signAssertion(privateKey: CryptoKey, publicJwk: JsonWebKey): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'ES256', typ: 'JWT' }
  const payload = { iat: now, exp: now + 60, pub: publicJwk }
  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url')
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signingInput = `${headerB64}.${payloadB64}`
  const signature = await subtle.sign(
    { name: 'ECDSA', hash: { name: 'SHA-256' } },
    privateKey,
    Buffer.from(signingInput),
  )
  return `${signingInput}.${Buffer.from(signature).toString('base64url')}`
}

export async function setupBrowserSmokeAuth(app: FastifyInstance): Promise<string> {
  const keypair = (await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair
  const publicKey = await subtle.exportKey('jwk', keypair.publicKey)
  const setup = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/setup',
    payload: { password: passwordDigest(), publicKey },
  })
  expect(setup.statusCode).toBe(200)
  return signAssertion(keypair.privateKey, publicKey)
}
