import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { webcrypto } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { ACTIVE_WRITER_SESSION_HEADER } from '../src/activeWriter.js'
import { findProtocolRouteDecision, isProtocolMutatingMethod } from '../src/routeManifest.js'
import { authLoginRateLimit, generationSubmitRateLimit } from '../src/routeRateLimits.js'

// Table-wide protection invariants for the Fastify port.
//
// Auth (`requireAuth`) stays explicit in route handlers, while route ownership
// decisions live in the protocol manifest. These tests derive the route set from
// the running app (`printRoutes`) and make every API route carry a manifest
// decision, then enforce the auth decisions against the live handlers.

const subtle = webcrypto.subtle

interface Harness {
  app: FastifyInstance
  dataDir: string
}

async function startHarness(): Promise<Harness> {
  process.env.LOG_LEVEL = 'silent'
  const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-fastify-route-protection-'))
  const { app } = await buildApp({
    config: {
      host: '127.0.0.1',
      port: 0,
      dataDir,
      bodyLimit: 1024 * 1024,
      importMaxBytes: Infinity,
      trustProxy: false,
      hubUrl: 'https://sv.risuai.xyz',
    },
    memoryWorker: false,
  })
  await app.ready()
  return { app, dataDir }
}

async function stopHarness(h: Harness): Promise<void> {
  await h.app.close()
  rmSync(h.dataDir, { recursive: true, force: true })
}

type InjectMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS'

interface ParsedRoute {
  method: string
  path: string
}

/**
 * Parse `app.printRoutes({ commonPrefix: false })` (an ASCII tree) into flat
 * (method, path) pairs. Deriving the route list from the live app — rather than
 * hard-coding it — is the point: a new route automatically enters this test.
 */
function parseRouteTree(tree: string): ParsedRoute[] {
  const routes: ParsedRoute[] = []
  const stack: Array<{ depth: number; seg: string }> = []
  for (const line of tree.split('\n')) {
    if (!line.trim()) continue
    const match = line.match(/^([\s│]*)(?:├──|└──)?\s*(\S.*)$/)
    if (!match) continue
    const depth = Math.floor((match[1] ?? '').length / 4)
    let rest = match[2]
    let methods: string[] | null = null
    const withMethods = rest.match(/^(.*?)\s*\(([A-Z, ]+)\)\s*$/)
    let seg: string
    if (withMethods) {
      seg = withMethods[1]
      methods = withMethods[2].split(',').map((m) => m.trim())
    } else {
      seg = rest.trim()
    }
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop()
    const fullPath = stack.map((s) => s.seg).join('') + seg
    stack.push({ depth, seg })
    if (methods) {
      for (const method of methods) routes.push({ method, path: fullPath })
    }
  }
  return routes
}

/** Replace `:param` route segments with a concrete placeholder so inject hits it. */
function concreteUrl(path: string): string {
  return path.replace(/:[^/]+/g, 'x').replace(/\*/g, 'x')
}

async function setupPassword(app: FastifyInstance): Promise<string> {
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

  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'ES256', typ: 'JWT' }
  const payload = { iat: now, exp: now + 60, pub: publicKey }
  const b64 = (obj: unknown): string => Buffer.from(JSON.stringify(obj)).toString('base64url')
  const signingInput = `${b64(header)}.${b64(payload)}`
  const signature = await subtle.sign(
    { name: 'ECDSA', hash: { name: 'SHA-256' } },
    keypair.privateKey,
    Buffer.from(signingInput),
  )
  return `${signingInput}.${Buffer.from(signature).toString('base64url')}`
}

let harness: Harness

beforeEach(async () => {
  harness = await startHarness()
})

afterEach(async () => {
  await stopHarness(harness)
})

describe('route protection (table-wide auth enforcement)', () => {
  it('has a protocol-manifest decision for every live API route', async () => {
    const routes = parseRouteTree(harness.app.printRoutes({ commonPrefix: false }))
    const unclassified = routes
      .filter((route) => route.path.startsWith('/api/v1/'))
      .filter((route) => !findProtocolRouteDecision(route.method, route.path))
      .map((route) => `${route.method} ${route.path}`)

    expect(unclassified).toEqual([])
  })

  it('requires auth on every manifest-protected API route once a password is set', async () => {
    await setupPassword(harness.app)

    const routes = parseRouteTree(harness.app.printRoutes({ commonPrefix: false }))
    const apiRoutes = routes.filter((route) => route.path.startsWith('/api/v1/'))
    // Sanity: the parser actually found the command surface.
    expect(apiRoutes.filter((route) => isProtocolMutatingMethod(route.method)).length).toBeGreaterThan(50)

    const unprotected: string[] = []
    for (const route of apiRoutes) {
      const key = `${route.method} ${route.path}`
      const decision = findProtocolRouteDecision(route.method, route.path)
      if (!decision || decision.auth.decision === 'public') continue

      const method = route.method as InjectMethod
      const request = {
        method,
        url: concreteUrl(route.path),
        ...(isProtocolMutatingMethod(route.method) ? { payload: {} } : {}),
      }
      const res = await harness.app.inject({
        ...request,
        // No `risu-auth` header: a protected route must reject before doing work.
      })
      // requireAuth rejects with 401; anything else (200/400/404/409/423/500…)
      // means the handler ran past the auth gate without a token.
      if (res.statusCode !== 401) {
        unprotected.push(`${key} -> ${res.statusCode}`)
      }
    }

    expect(unprotected).toEqual([])
  })

  it('leaves the documented public routes reachable without auth', async () => {
    await setupPassword(harness.app)

    // auth/crypto: stateless helper, succeeds without a token.
    const crypto = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/crypto',
      payload: { data: 'abc' },
    })
    expect(crypto.statusCode).toBe(200)

    // assets/exists: a read-only probe, reachable without a token.
    const exists = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/assets/exists',
      payload: { ids: [] },
    })
    expect(exists.statusCode).not.toBe(401)

    // content-addressed asset reads are public; a missing asset should 404, not 401.
    const missingAssetId = 'a'.repeat(64)
    const asset = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/assets/${missingAssetId}`,
    })
    expect(asset.statusCode).toBe(404)
  })

  it('requires auth on the durable-generation reattach + cancel routes', async () => {
    await setupPassword(harness.app)
    const reattach = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/generate/chat/some-id/stream',
    })
    expect(reattach.statusCode).toBe(401)
    const cancel = await harness.app.inject({
      method: 'DELETE',
      url: '/api/v1/generate/chat/some-id',
    })
    expect(cancel.statusCode).toBe(401)
  })

  it('rejects accidental HEAD requests on expensive GET routes', async () => {
    const assertion = await setupPassword(harness.app)
    const urls = [
      '/api/v1/bootstrap',
      '/api/v1/chats/chat-a/messages',
      '/api/v1/export/risusave',
      '/api/v1/export/bundle',
      '/api/v1/export/local-backup',
      '/api/v1/events',
      '/api/v1/generate/chat/missing-job/stream',
    ]

    for (const url of urls) {
      const res = await harness.app.inject({
        method: 'HEAD',
        url,
        headers: { 'risu-auth': assertion },
      })
      expect(res.statusCode, url).toBe(404)
    }
  })

  it('authenticates raw buffered proxy bodies before body parsing', async () => {
    await setupPassword(harness.app)
    const payload = Buffer.alloc(1024 * 1024 + 1)

    for (const url of ['/api/v1/proxy/fetch', '/api/v1/hub/upload']) {
      const res = await harness.app.inject({
        method: 'POST',
        url,
        headers: {
          'content-type': 'application/octet-stream',
          ...(url.includes('/proxy/') ? { 'risu-url': encodeURIComponent('https://example.com/') } : {}),
        },
        payload,
      })
      expect(res.statusCode, url).toBe(401)
    }
  })
})

describe('active-writer header validation', () => {
  async function authed(): Promise<string> {
    return setupPassword(harness.app)
  }

  it('treats a missing writer-session header as a non-writer once a session is latched', async () => {
    const assertion = await authed()
    // Latch session-a as the active writer via the writer-intent bootstrap.
    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion, [ACTIVE_WRITER_SESSION_HEADER]: 'session-a' },
    })
    expect(bootstrap.statusCode).toBe(200)

    // A mutating request with NO writer-session header is not the active writer.
    const noHeader = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/import/risusave',
      headers: { 'risu-auth': assertion },
      payload: { database: { streamGeminiThoughts: false } },
    })
    expect(noHeader.statusCode).toBe(423)
    expect(noHeader.json()).toMatchObject({ error: 'active_writer_stale' })
  })

  it('rejects an empty / whitespace-only / oversize writer-session header', async () => {
    const assertion = await authed()
    await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion, [ACTIVE_WRITER_SESSION_HEADER]: 'session-a' },
    })

    for (const bad of ['', '   ', 'x'.repeat(129)]) {
      const res = await harness.app.inject({
        method: 'POST',
        url: '/api/v1/import/risusave',
        headers: { 'risu-auth': assertion, [ACTIVE_WRITER_SESSION_HEADER]: bad },
        payload: { database: { streamGeminiThoughts: false } },
      })
      expect(res.statusCode).toBe(423)
    }
  })

  it('accepts mutations before any writer session is latched (fresh server)', async () => {
    const assertion = await authed()
    // No bootstrap-with-writer-header yet: state.sessionId is null, so any
    // authenticated writer is accepted (the single-user bootstrap window).
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/import/risusave',
      headers: { 'risu-auth': assertion },
      payload: { database: { streamGeminiThoughts: false } },
    })
    expect(res.statusCode).toBe(200)
  })

  it('does not apply the active-writer gate to authenticated hash-aware resource reads', async () => {
    const assertion = await authed()
    await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion, [ACTIVE_WRITER_SESSION_HEADER]: 'session-a' },
    })

    for (const url of [
      '/api/v1/settings',
      '/api/v1/settings/display',
      '/api/v1/collections',
      '/api/v1/collections/modules',
      '/api/v1/characters',
    ]) {
      const res = await harness.app.inject({
        method: 'POST',
        url,
        headers: { 'risu-auth': assertion },
        payload: { cache: { version: 1, hashes: {} } },
      })
      expect(res.statusCode, url).toBe(200)
    }
  })
})

describe('explicit route rate limits', () => {
  it('limits auth login attempts with an explicit route limit', async () => {
    const setup = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/setup',
      payload: { password: 'hunter2' },
    })
    expect(setup.statusCode).toBe(200)

    const publicKey = await subtle.exportKey(
      'jwk',
      ((await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair)
        .publicKey,
    )
    const allowedAttempts = Number(authLoginRateLimit.max)
    for (let i = 0; i < allowedAttempts; i += 1) {
      const res = await harness.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { password: 'wrong-password', publicKey },
      })
      expect(res.statusCode).toBe(400)
    }

    const limited = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { password: 'wrong-password', publicKey },
    })
    expect(limited.statusCode).toBe(429)
  })

  it('does not apply ordinary request limits to durable generation reattach streams', async () => {
    const assertion = await setupPassword(harness.app)
    const attempts = Number(generationSubmitRateLimit.max) + 1

    for (let i = 0; i < attempts; i += 1) {
      const res = await harness.app.inject({
        method: 'GET',
        url: '/api/v1/generate/chat/missing-job/stream',
        headers: { 'risu-auth': assertion },
      })
      expect(res.statusCode).toBe(404)
    }
  })
})
