import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { webcrypto } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { ACTIVE_WRITER_SESSION_HEADER } from '../src/activeWriter.js'

// Table-wide protection invariants for the Fastify port.
//
// The auth (`requireAuth`) and active-writer (`isServerOwnedMutation`) gates are
// applied per-route by hand. `activeWriter.test.ts` and `smoke.test.ts` exercise a
// hand-picked subset; nothing asserts the property across the *whole* live route
// table, so a newly added mutating route that forgets `requireAuth` would mutate
// SQLite/db.json/assets unauthenticated and pass the existing suite. These tests
// derive the route set from the running app (`printRoutes`) and enforce the
// property over every mutating route, so an omission fails here.

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

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

// Routes that are intentionally reachable without a `risu-auth` assertion. Each
// entry is a deliberate, documented decision; everything else MUST require auth.
//   - auth/setup + auth/login: the password-bootstrap handshake (setup self-refuses
//     once a password exists).
//   - auth/crypto: a stateless sha256 helper, no server state.
//   - assets/exists: a read-only existence probe (no mutation).
//   - the `*` catch-all: the static SPA fallback (serves the client shell / 404s).
const PUBLIC_MUTATING_ROUTES = new Set<string>([
  'POST /api/v1/auth/setup',
  'POST /api/v1/auth/login',
  'POST /api/v1/auth/crypto',
  'POST /api/v1/assets/exists',
  'POST *',
  'PUT *',
  'PATCH *',
  'DELETE *',
])

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
  return path.replace(/:[^/]+/g, 'x')
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
  it('requires auth on every mutating API route once a password is set', async () => {
    await setupPassword(harness.app)

    const routes = parseRouteTree(harness.app.printRoutes({ commonPrefix: false }))
    const mutating = routes.filter(
      (r) => MUTATING_METHODS.has(r.method) && r.path.startsWith('/api/v1/'),
    )
    // Sanity: the parser actually found the command surface.
    expect(mutating.length).toBeGreaterThan(50)

    const unprotected: string[] = []
    for (const route of mutating) {
      const key = `${route.method} ${route.path}`
      if (PUBLIC_MUTATING_ROUTES.has(key)) continue
      const res = await harness.app.inject({
        method: route.method as 'POST',
        url: concreteUrl(route.path),
        // No `risu-auth` header: a protected route must reject before doing work.
        payload: {},
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
      payload: { value: 'abc' },
    })
    expect(crypto.statusCode).not.toBe(401)

    // assets/exists: a read-only probe, reachable without a token.
    const exists = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/assets/exists',
      payload: { ids: [] },
    })
    expect(exists.statusCode).not.toBe(401)
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
})
