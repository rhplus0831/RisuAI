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
    fn: (req: http.IncomingMessage, res: http.ServerResponse, body: Buffer) => void | Promise<void>,
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

interface Harness {
  app: FastifyInstance
  dataDir: string
}

async function startHarness(hubUrl: string): Promise<Harness> {
  process.env.LOG_LEVEL = 'silent'
  const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-fastify-'))
  const { app } = await buildApp({
    config: {
      host: '127.0.0.1',
      port: 0,
      dataDir,
      bodyLimit: 1024 * 1024,
      trustProxy: false,
      hubUrl,
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
  await app.inject({
    method: 'POST',
    url: '/api/v1/auth/setup',
    payload: { password: 'hunter2' },
  })
  const keypair = (await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair
  const publicKey = await subtle.exportKey('jwk', keypair.publicKey)
  await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { password: 'hunter2', publicKey },
  })
  return { assertion: await signAssertion(keypair.privateKey, publicKey) }
}

let harness: Harness
let echo: EchoServer

beforeEach(async () => {
  echo = await startEcho()
  harness = await startHarness(echo.url)
})

afterEach(async () => {
  await stopHarness(harness)
  await echo.close()
})

describe('Phase 3C hub passthrough', () => {
  it('rejects without auth once a password is set', async () => {
    await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/setup',
      payload: { password: 'hunter2' },
    })
    const res = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/hub/anything',
    })
    expect(res.statusCode).toBe(401)
    expect(echo.requests).toHaveLength(0)
  })

  it('forwards GET to hubUrl with the path suffix and query string', async () => {
    echo.setResponder((req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end(`hello ${req.url}`)
    })
    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/hub/risuhub/manifests?lang=en',
      headers: { 'risu-auth': assertion },
    })
    expect(res.statusCode).toBe(200)
    expect(res.body).toBe('hello /risuhub/manifests?lang=en')
    expect(echo.requests).toHaveLength(1)
    expect(echo.requests[0].method).toBe('GET')
  })

  it('forwards POST body bytes and sets origin to the hub origin', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const payload = Buffer.from(JSON.stringify({ name: 'mychar', revision: 1 }))
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/hub/upload',
      headers: {
        'risu-auth': assertion,
        'content-type': 'application/json',
        'x-custom-thing': 'present',
      },
      payload,
    })
    expect(res.statusCode).toBe(200)
    expect(echo.requests).toHaveLength(1)
    expect(echo.requests[0].method).toBe('POST')
    expect(Buffer.compare(echo.requests[0].body, payload)).toBe(0)
    expect(echo.requests[0].headers['content-type']).toBe('application/json')
    expect(echo.requests[0].headers['x-custom-thing']).toBe('present')
    expect(echo.requests[0].headers['origin']).toBe(new URL(echo.url).origin)
  })

  it('uses the shared proxy response-header strip policy', async () => {
    echo.setResponder((_req, res) => {
      res.writeHead(200, {
        'content-type': 'text/plain',
        'content-security-policy': "default-src 'none'",
        'content-security-policy-report-only': "script-src 'none'",
        'clear-site-data': '"cache"',
        'cache-control': 'no-store',
        'content-encoding': 'identity',
        'x-passthrough': 'kept',
      })
      res.end('body')
    })
    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/hub/anything',
      headers: { 'risu-auth': assertion },
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-security-policy']).toBeUndefined()
    expect(res.headers['content-security-policy-report-only']).toBeUndefined()
    expect(res.headers['clear-site-data']).toBeUndefined()
    expect(res.headers['cache-control']).toBeUndefined()
    expect(res.headers['content-encoding']).toBeUndefined()
    expect(res.headers['x-passthrough']).toBe('kept')
    expect(res.body).toBe('body')
  })

  it('strips proxy control headers from forwarded headers', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    await harness.app.inject({
      method: 'GET',
      url: '/api/v1/hub/anything',
      headers: {
        'risu-auth': assertion,
        'risu-timeout-ms': '1234',
        'risu-url': encodeURIComponent('https://example.invalid/override'),
        'risu-header': encodeURIComponent(JSON.stringify({ 'x-leak': 'nope' })),
        'x-risu-node-path': encodeURIComponent(`${echo.url}/anything`),
        connection: 'keep-alive',
        'x-keep-me': 'yes',
      },
    })
    expect(echo.requests).toHaveLength(1)
    const fwd = echo.requests[0].headers
    expect(fwd['risu-auth']).toBeUndefined()
    expect(fwd['risu-timeout-ms']).toBeUndefined()
    expect(fwd['risu-url']).toBeUndefined()
    expect(fwd['risu-header']).toBeUndefined()
    expect(fwd['x-risu-node-path']).toBeUndefined()
    expect(fwd['x-keep-me']).toBe('yes')
  })

  it('honors x-risu-node-path as a complete URL override', async () => {
    let altCalls = 0
    const altServer = http.createServer((req, res) => {
      altCalls += 1
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end(`alt ${req.url}`)
    })
    await new Promise<void>((r) => altServer.listen(0, '127.0.0.1', () => r()))
    const altAddr = altServer.address() as AddressInfo
    const altUrl = `http://127.0.0.1:${altAddr.port}/custom/path?x=1`
    try {
      const { assertion } = await setupAuthedClient(harness.app)
      const res = await harness.app.inject({
        method: 'GET',
        url: '/api/v1/hub/ignored',
        headers: {
          'risu-auth': assertion,
          'x-risu-node-path': encodeURIComponent(altUrl),
        },
      })
      expect(res.statusCode).toBe(200)
      expect(res.body).toBe('alt /custom/path?x=1')
      expect(altCalls).toBe(1)
      expect(echo.requests).toHaveLength(0)
    } finally {
      await new Promise<void>((r) => altServer.close(() => r()))
    }
  })

  it('follows a single 302 redirect and returns the redirected response', async () => {
    const altPaths: string[] = []
    let redirectedTo: string | undefined
    echo.setResponder((req, res) => {
      if (req.url === '/first') {
        redirectedTo = `${echo.url}/final`
        res.writeHead(302, { location: redirectedTo })
        res.end()
        return
      }
      altPaths.push(req.url ?? '')
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('final body')
    })
    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/hub/first',
      headers: { 'risu-auth': assertion },
    })
    expect(res.statusCode).toBe(200)
    expect(res.body).toBe('final body')
    expect(altPaths).toEqual(['/final'])
    expect(redirectedTo).toBeDefined()
  })

  it('returns 502 when the upstream connection fails', async () => {
    // Close the echo server so the upstream is unreachable.
    await echo.close()
    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/hub/dead',
      headers: { 'risu-auth': assertion },
    })
    expect(res.statusCode).toBe(502)
    expect(res.json()).toMatchObject({
      error: expect.stringContaining('Proxy request failed'),
    })
  })
})
