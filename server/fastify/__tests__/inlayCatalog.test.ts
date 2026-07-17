import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHash, webcrypto } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { ACTIVE_WRITER_SESSION_HEADER } from '../src/activeWriter.js'
import { buildApp } from '../src/app.js'
import { createCommandEventSink, type CommandEventSink } from '../src/commands/events.js'

const subtle = webcrypto.subtle
const WRITER_ID = 'inlay-writer'
const IMAGE_BYTES = Buffer.from('durable-inlay-image')
const IMAGE_ID = createHash('sha256').update(IMAGE_BYTES).digest('hex')
const SECOND_IMAGE_BYTES = Buffer.from('second-durable-inlay-image')

interface Harness {
  app: FastifyInstance
  commandEvents: CommandEventSink
  dataDir: string
}

async function startHarness(): Promise<Harness> {
  process.env.LOG_LEVEL = 'silent'
  const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-inlay-catalog-'))
  const commandEvents = createCommandEventSink()
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
    commandEvents,
  })
  return { app, commandEvents, dataDir }
}

async function signAssertion(privateKey: CryptoKey, publicJwk: JsonWebKey): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ iat: now, exp: now + 60, pub: publicJwk })).toString('base64url')
  const signingInput = `${header}.${payload}`
  const signature = await subtle.sign(
    { name: 'ECDSA', hash: { name: 'SHA-256' } },
    privateKey,
    Buffer.from(signingInput),
  )
  return `${signingInput}.${Buffer.from(signature).toString('base64url')}`
}

async function setupWriter(app: FastifyInstance): Promise<string> {
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/setup',
        payload: { password: 'hunter2' },
      })
    ).statusCode,
  ).toBe(200)
  const keypair = (await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair
  const publicKey = await subtle.exportKey('jwk', keypair.publicKey)
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { password: 'hunter2', publicKey },
      })
    ).statusCode,
  ).toBe(200)
  const assertion = await signAssertion(keypair.privateKey, publicKey)
  const bootstrap = await app.inject({
    method: 'GET',
    url: '/api/v1/bootstrap',
    headers: { 'risu-auth': assertion, [ACTIVE_WRITER_SESSION_HEADER]: WRITER_ID },
  })
  expect(bootstrap.statusCode).toBe(200)
  return assertion
}

function writerHeaders(assertion: string): Record<string, string> {
  return {
    'risu-auth': assertion,
    [ACTIVE_WRITER_SESSION_HEADER]: WRITER_ID,
  }
}

async function uploadAsset(app: FastifyInstance, assertion: string, bytes: Buffer): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/assets',
    headers: { ...writerHeaders(assertion), 'content-type': 'image/png' },
    payload: bytes,
  })
  expect(response.statusCode).toBe(201)
  return response.json().assetId as string
}

async function upsertCatalogAsset(
  app: FastifyInstance,
  assertion: string,
  assetId: string,
  baseRevision: number,
  name: string,
) {
  return app.inject({
    method: 'PUT',
    url: `/api/v1/commands/inlay-assets/${assetId}`,
    headers: writerHeaders(assertion),
    payload: { baseRevision, name, aliases: [`alias:${name}`], width: 32, height: 24 },
  })
}

let harness: Harness

beforeEach(async () => {
  harness = await startHarness()
})

afterEach(async () => {
  await harness.app.close()
  rmSync(harness.dataDir, { recursive: true, force: true })
})

describe('server-owned inlay catalog', () => {
  it('synchronizes independent readers and deletes only catalog membership', async () => {
    const assertion = await setupWriter(harness.app)
    expect(await uploadAsset(harness.app, assertion, IMAGE_BYTES)).toBe(IMAGE_ID)

    const staleWriter = await harness.app.inject({
      method: 'PUT',
      url: `/api/v1/commands/inlay-assets/${IMAGE_ID}`,
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: 0, name: 'image.png' },
    })
    expect(staleWriter.statusCode).toBe(423)

    const upsert = await upsertCatalogAsset(harness.app, assertion, IMAGE_ID, 0, 'image.png')
    expect(upsert.statusCode).toBe(200)
    expect(upsert.json()).toMatchObject({
      revision: 1,
      event: { type: 'inlayCatalog.upserted', resource: 'inlayCatalog', id: IMAGE_ID, revision: 1 },
      asset: { assetId: IMAGE_ID, aliases: ['alias:image.png'], name: 'image.png', size: IMAGE_BYTES.length },
    })

    const [clientA, clientB] = await Promise.all([
      harness.app.inject({ method: 'GET', url: '/api/v1/inlay-assets', headers: { 'risu-auth': assertion } }),
      harness.app.inject({ method: 'GET', url: '/api/v1/inlay-assets', headers: { 'risu-auth': assertion } }),
    ])
    expect(clientA.statusCode).toBe(200)
    expect(clientB.json()).toEqual(clientA.json())
    expect(clientA.json().assets).toHaveLength(1)

    const conflict = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/commands/inlay-assets/${IMAGE_ID}`,
      headers: writerHeaders(assertion),
      payload: { baseRevision: 0 },
    })
    expect(conflict.statusCode).toBe(409)
    expect(conflict.json()).toEqual({ error: 'revision_conflict', currentRevision: 1 })

    const deleted = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/commands/inlay-assets/${IMAGE_ID}`,
      headers: writerHeaders(assertion),
      payload: { baseRevision: 1 },
    })
    expect(deleted.statusCode).toBe(200)
    expect(deleted.json().event).toMatchObject({ type: 'inlayCatalog.deleted', resource: 'inlayCatalog' })

    const catalogAfterDelete = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/inlay-assets',
      headers: { 'risu-auth': assertion },
    })
    expect(catalogAfterDelete.json()).toMatchObject({ revision: 2, assets: [] })
    const retainedBytes = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/assets/${IMAGE_ID}`,
      headers: { 'risu-auth': assertion },
    })
    expect(retainedBytes.statusCode).toBe(200)
    expect(retainedBytes.rawPayload).toEqual(IMAGE_BYTES)
    expect(harness.commandEvents.list().map((event) => event.type)).toEqual([
      'inlayCatalog.upserted',
      'inlayCatalog.deleted',
    ])
  })

  it('restores catalog rows with the backup while preserving immutable bytes', async () => {
    const assertion = await setupWriter(harness.app)
    const firstId = await uploadAsset(harness.app, assertion, IMAGE_BYTES)
    const created = await upsertCatalogAsset(harness.app, assertion, firstId, 0, 'before-backup.png')
    expect(created.statusCode).toBe(200)

    const backup = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/backups',
      headers: writerHeaders(assertion),
      payload: { label: 'with inlay catalog' },
    })
    expect(backup.statusCode).toBe(201)

    const secondId = await uploadAsset(harness.app, assertion, SECOND_IMAGE_BYTES)
    const second = await upsertCatalogAsset(harness.app, assertion, secondId, 1, 'after-backup.png')
    expect(second.statusCode).toBe(200)
    const removedFirst = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/commands/inlay-assets/${firstId}`,
      headers: writerHeaders(assertion),
      payload: { baseRevision: 2 },
    })
    expect(removedFirst.statusCode).toBe(200)

    const restore = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/backups/${backup.json().id}/restore`,
      headers: writerHeaders(assertion),
    })
    expect(restore.statusCode).toBe(200)

    const restored = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/inlay-assets',
      headers: { 'risu-auth': assertion },
    })
    expect(restored.statusCode).toBe(200)
    expect(restored.json().assets).toMatchObject([{ assetId: firstId, name: 'before-backup.png' }])
    expect(restored.json().assets).toHaveLength(1)
    expect(restored.json().assets.some((asset: { assetId: string }) => asset.assetId === secondId)).toBe(false)
  })
})
