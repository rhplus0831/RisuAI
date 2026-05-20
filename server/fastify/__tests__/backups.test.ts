import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
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

async function importDb(
  app: FastifyInstance,
  assertion: string,
  database: unknown,
): Promise<number> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/import/risusave',
    headers: { 'risu-auth': assertion },
    payload: { database },
  })
  expect(res.statusCode).toBe(200)
  return res.json().revision as number
}

let harness: Harness

beforeEach(async () => {
  harness = await startHarness()
})

afterEach(async () => {
  await stopHarness(harness)
})

describe('Phase 2D backups', () => {
  it('rejects all four routes without auth when password is set', async () => {
    await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/setup',
      payload: { password: 'hunter2' },
    })
    for (const op of [
      { method: 'POST' as const, url: '/api/v1/backups' },
      { method: 'GET' as const, url: '/api/v1/backups' },
      { method: 'POST' as const, url: '/api/v1/backups/2026-05-20-12-00-00-abc123/restore' },
      { method: 'DELETE' as const, url: '/api/v1/backups/2026-05-20-12-00-00-abc123' },
    ]) {
      const res = await harness.app.inject(op)
      expect(res.statusCode, `${op.method} ${op.url}`).toBe(401)
    }
  })

  it('creates a backup on a fresh data dir', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/backups',
      headers: { 'risu-auth': assertion },
      payload: {},
    })
    expect(res.statusCode).toBe(201)
    const manifest = res.json()
    expect(manifest).toMatchObject({
      _version: 1,
      label: null,
      revision: 0,
      assetCount: 0,
    })
    expect(manifest.id).toMatch(/^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}-[a-f0-9]{6}$/)
    expect(existsSync(path.join(harness.dataDir, 'backups', manifest.id, 'db.json'))).toBe(true)
    expect(existsSync(path.join(harness.dataDir, 'backups', manifest.id, 'manifest.json'))).toBe(
      true,
    )
  })

  it('persists an explicit label', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/backups',
      headers: { 'risu-auth': assertion },
      payload: { label: 'before refactor' },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().label).toBe('before refactor')
  })

  it('rejects a non-string label', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/backups',
      headers: { 'risu-auth': assertion },
      payload: { label: 42 },
    })
    expect(res.statusCode).toBe(400)
  })

  it('captures the live revision and asset count', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    await importDb(harness.app, assertion, { v: 1 })
    await importDb(harness.app, assertion, { v: 2 })
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/backups',
      headers: { 'risu-auth': assertion },
      payload: {},
    })
    expect(res.json().revision).toBe(2)
    expect(res.json().assetCount).toBe(0)
  })

  it('lists backups newest-first', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const a = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/backups',
      headers: { 'risu-auth': assertion },
      payload: { label: 'a' },
    })
    await new Promise((r) => setTimeout(r, 15))
    const b = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/backups',
      headers: { 'risu-auth': assertion },
      payload: { label: 'b' },
    })
    const list = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/backups',
      headers: { 'risu-auth': assertion },
    })
    expect(list.statusCode).toBe(200)
    const ids = list.json().backups.map((m: { id: string }) => m.id)
    expect(ids).toEqual([b.json().id, a.json().id])
  })

  it('lists empty on a fresh data dir', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/backups',
      headers: { 'risu-auth': assertion },
    })
    expect(res.json()).toEqual({ backups: [] })
  })

  it('round-trips: import A, backup, import B, restore, bootstrap returns A', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    await importDb(harness.app, assertion, { tag: 'A' })
    const backup = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/backups',
      headers: { 'risu-auth': assertion },
      payload: { label: 'snapshot of A' },
    })
    expect(backup.statusCode).toBe(201)
    const backupId = backup.json().id

    await importDb(harness.app, assertion, { tag: 'B' })
    const beforeRestore = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(beforeRestore.json().database).toEqual({ tag: 'B' })

    const restored = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/backups/${backupId}/restore`,
      headers: { 'risu-auth': assertion },
    })
    expect(restored.statusCode).toBe(200)
    const revisionAfter = restored.json().revision

    const afterRestore = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(afterRestore.json().database).toEqual({ tag: 'A' })
    expect(afterRestore.json().revision).toBe(revisionAfter)
  })

  it('restore of an unknown id returns 404', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/backups/2026-05-20-12-00-00-aaaaaa/restore',
      headers: { 'risu-auth': assertion },
    })
    expect(res.statusCode).toBe(404)
  })

  it('delete removes the backup directory', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const created = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/backups',
      headers: { 'risu-auth': assertion },
      payload: {},
    })
    const id = created.json().id
    expect(existsSync(path.join(harness.dataDir, 'backups', id))).toBe(true)

    const del = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/backups/${id}`,
      headers: { 'risu-auth': assertion },
    })
    expect(del.statusCode).toBe(200)
    expect(del.json()).toEqual({ id })
    expect(existsSync(path.join(harness.dataDir, 'backups', id))).toBe(false)

    const list = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/backups',
      headers: { 'risu-auth': assertion },
    })
    expect(list.json().backups).toEqual([])
  })

  it('delete of unknown id returns 404', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'DELETE',
      url: '/api/v1/backups/2026-05-20-12-00-00-aaaaaa',
      headers: { 'risu-auth': assertion },
    })
    expect(res.statusCode).toBe(404)
  })

  it('rejects path-traversal attempts via the id parameter', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    for (const malformed of ['..', '../foo', 'not-a-valid-id', '2026-05-20']) {
      const restore = await harness.app.inject({
        method: 'POST',
        url: `/api/v1/backups/${encodeURIComponent(malformed)}/restore`,
        headers: { 'risu-auth': assertion },
      })
      expect(restore.statusCode).toBe(404)

      const del = await harness.app.inject({
        method: 'DELETE',
        url: `/api/v1/backups/${encodeURIComponent(malformed)}`,
        headers: { 'risu-auth': assertion },
      })
      expect(del.statusCode).toBe(404)
    }
  })
})
