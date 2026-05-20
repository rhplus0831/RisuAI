import http from 'node:http'
import type { AddressInfo } from 'node:net'
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

interface CapturedRequest {
  method: string
  url: string
  headers: http.IncomingHttpHeaders
  body: Buffer
}

interface EchoServer {
  url: string
  requests: CapturedRequest[]
  setResponder(
    fn: (
      req: http.IncomingMessage,
      res: http.ServerResponse,
      body: Buffer,
    ) => void | Promise<void>,
  ): void
  close(): Promise<void>
}

function startEcho(): Promise<EchoServer> {
  return new Promise((resolve) => {
    const requests: CapturedRequest[] = []
    let responder: (
      req: http.IncomingMessage,
      res: http.ServerResponse,
      body: Buffer,
    ) => void | Promise<void> = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('ok')
    }
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => {
        const body = Buffer.concat(chunks)
        requests.push({
          method: req.method ?? '',
          url: req.url ?? '',
          headers: req.headers,
          body,
        })
        void Promise.resolve(responder(req, res, body)).catch(() => {
          if (!res.headersSent) res.writeHead(500)
          res.end()
        })
      })
    })
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        requests,
        setResponder(fn) {
          responder = fn
        },
        close() {
          return new Promise((r) => server.close(() => r()))
        },
      })
    })
  })
}

let harness: Harness
let echo: EchoServer

beforeEach(async () => {
  harness = await startHarness()
  echo = await startEcho()
})

afterEach(async () => {
  await echo.close()
  await stopHarness(harness)
})

describe('Phase 3 POST /api/v1/proxy/fetch', () => {
  it('returns 401 without auth once a password is set', async () => {
    await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/setup',
      payload: { password: 'hunter2' },
    })
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/proxy/fetch',
      headers: { 'risu-url': encodeURIComponent(echo.url) },
    })
    expect(res.statusCode).toBe(401)
    expect(echo.requests).toHaveLength(0)
  })

  it('returns 400 when risu-url is missing', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/proxy/fetch',
      headers: { 'risu-auth': assertion },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'URL has no param' })
    expect(echo.requests).toHaveLength(0)
  })

  it('forwards upstream status, body, and filters response headers', async () => {
    echo.setResponder((_req, res) => {
      res.writeHead(202, {
        'content-type': 'text/plain',
        'cache-control': 'no-store',
        'content-encoding': 'identity',
        'content-security-policy': "default-src 'none'",
        'content-security-policy-report-only': 'whatever',
        'clear-site-data': '"cache"',
        'x-custom': 'preserved',
      })
      res.end('hello upstream')
    })
    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/proxy/fetch',
      headers: {
        'risu-auth': assertion,
        'risu-url': encodeURIComponent(echo.url),
      },
    })
    expect(res.statusCode).toBe(202)
    expect(res.headers['content-type']).toBe('text/plain')
    expect(res.headers['x-custom']).toBe('preserved')
    expect(res.headers['cache-control']).toBeUndefined()
    expect(res.headers['content-encoding']).toBeUndefined()
    expect(res.headers['content-security-policy']).toBeUndefined()
    expect(res.headers['content-security-policy-report-only']).toBeUndefined()
    expect(res.headers['clear-site-data']).toBeUndefined()
    expect(res.body).toBe('hello upstream')
  })

  it('forwards POST body bytes upstream verbatim', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const payload = Buffer.from(JSON.stringify({ hello: 'world', n: 7 }))
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/proxy/fetch',
      headers: {
        'risu-auth': assertion,
        'risu-url': encodeURIComponent(echo.url),
        'content-type': 'application/json',
      },
      payload,
    })
    expect(res.statusCode).toBe(200)
    expect(echo.requests).toHaveLength(1)
    expect(echo.requests[0].method).toBe('POST')
    expect(Buffer.compare(echo.requests[0].body, payload)).toBe(0)
    expect(echo.requests[0].headers['content-type']).toBe('application/json')
  })

  it('strips risu-* and host-class headers from the upstream request', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    await harness.app.inject({
      method: 'POST',
      url: '/api/v1/proxy/fetch',
      headers: {
        'risu-auth': assertion,
        'risu-url': encodeURIComponent(echo.url),
        'risu-timeout-ms': '5000',
        connection: 'keep-alive',
        'x-keep-me': 'yes',
      },
      payload: Buffer.from(''),
    })
    expect(echo.requests).toHaveLength(1)
    const fwd = echo.requests[0].headers
    expect(fwd['risu-auth']).toBeUndefined()
    expect(fwd['risu-url']).toBeUndefined()
    expect(fwd['risu-timeout-ms']).toBeUndefined()
    expect(fwd['x-keep-me']).toBe('yes')
    // host is rewritten by undici to the upstream's host, not the inbound's
    expect(fwd['host']).toMatch(/^127\.0\.0\.1:/)
  })

  it('uses risu-header JSON override and discards inbound headers', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const overrideHeaders = {
      'x-only-from-override': 'yes',
      authorization: 'Bearer fake',
    }
    await harness.app.inject({
      method: 'POST',
      url: '/api/v1/proxy/fetch',
      headers: {
        'risu-auth': assertion,
        'risu-url': encodeURIComponent(echo.url),
        'risu-header': encodeURIComponent(JSON.stringify(overrideHeaders)),
        'x-inbound-only': 'should-be-dropped',
      },
      payload: Buffer.from(''),
    })
    expect(echo.requests).toHaveLength(1)
    const fwd = echo.requests[0].headers
    expect(fwd['x-only-from-override']).toBe('yes')
    expect(fwd['authorization']).toBe('Bearer fake')
    expect(fwd['x-inbound-only']).toBeUndefined()
  })

  it('returns 504 when risu-timeout-ms elapses before upstream responds', async () => {
    echo.setResponder((_req, res) => {
      setTimeout(() => {
        res.writeHead(200)
        res.end('late')
      }, 500)
    })
    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/proxy/fetch',
      headers: {
        'risu-auth': assertion,
        'risu-url': encodeURIComponent(echo.url),
        'risu-timeout-ms': '50',
      },
    })
    expect(res.statusCode).toBe(504)
    expect(res.json()).toEqual({
      error: 'Proxy request timed out after 50ms',
    })
  })

  it('streams a multi-chunk upstream body through unbuffered', async () => {
    echo.setResponder((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('data: one\n\n')
      setTimeout(() => {
        res.write('data: two\n\n')
        res.end()
      }, 20)
    })
    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/proxy/fetch',
      headers: {
        'risu-auth': assertion,
        'risu-url': encodeURIComponent(echo.url),
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('text/event-stream')
    expect(res.body).toBe('data: one\n\ndata: two\n\n')
  })
})
