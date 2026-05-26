import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { createCommandEventSink, type CommandEventSink } from '../src/commands/events.js'
import { risuSaveFixtureCases } from '../__fixtures__/risuSave/fixtures.js'
import { RisuSaveBlockType } from '../src/risuSave/blockCodec.js'
import { writePersisted } from '../src/repository.js'

interface Harness {
  app: FastifyInstance
  dataDir: string
  commandEvents: CommandEventSink
}

async function startHarness(): Promise<Harness> {
  process.env.LOG_LEVEL = 'silent'
  const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-fastify-risu-import-'))
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
    memoryWorker: false,
    commandEvents,
  })
  return { app, dataDir, commandEvents }
}

async function stopHarness(h: Harness): Promise<void> {
  await h.app.close()
  rmSync(h.dataDir, { recursive: true, force: true })
}

function fixtureBytes(name: string): Uint8Array {
  const fixture = risuSaveFixtureCases.find((item) => item.name === name)
  expect(fixture).toBeDefined()
  return fixture!.bytes
}

function multipartRisuSave(bytes: Uint8Array, filename = 'database.risu') {
  const boundary = `risu-boundary-${Date.now()}`
  const head = Buffer.from(
    [
      `--${boundary}`,
      `Content-Disposition: form-data; name="file"; filename="${filename}"`,
      'Content-Type: application/octet-stream',
      '',
      '',
    ].join('\r\n'),
  )
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`)
  return {
    payload: Buffer.concat([head, Buffer.from(bytes), tail]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  }
}

function multipartTextOnly() {
  const boundary = `risu-boundary-${Date.now()}`
  return {
    payload: Buffer.from(
      [
        `--${boundary}`,
        'Content-Disposition: form-data; name="note"',
        '',
        'no file here',
        `--${boundary}--`,
        '',
      ].join('\r\n'),
    ),
    contentType: `multipart/form-data; boundary=${boundary}`,
  }
}

let harness: Harness

beforeEach(async () => {
  harness = await startHarness()
})

afterEach(async () => {
  await stopHarness(harness)
})

describe('Phase 9-8a multipart .risu import route', () => {
  it('keeps JSON fixture import behavior available', async () => {
    const imported = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/import/risusave',
      payload: { database: { v: 1 } },
    })

    expect(imported.statusCode).toBe(200)
    expect(imported.json()).toEqual({
      revision: 1,
      event: {
        type: 'state.imported',
        revision: 1,
        resource: 'state',
      },
      assetReport: { referencedCount: 0, missingCount: 0, orphanedCount: 0 },
    })
    expect(harness.commandEvents.list()).toEqual([imported.json().event])
  })

  it('reports referenced, missing, and orphaned server assets after JSON imports', async () => {
    const present = 'a'.repeat(64)
    const missing = 'b'.repeat(64)
    const orphaned = 'c'.repeat(64)
    writePersisted(harness.dataDir, {
      _version: 1,
      database: null,
      assets: [
        { id: present, ext: 'png', size: 12, contentType: 'image/png' },
        { id: orphaned, ext: 'webp', size: 44, contentType: 'image/webp' },
      ],
    })

    const imported = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/import/risusave',
      payload: {
        database: {
          version: 1,
          userIcon: present,
          characters: [{ chaId: 'char-a', name: 'A', image: missing }],
        },
      },
    })

    expect(imported.statusCode).toBe(200)
    expect(imported.json()).toEqual({
      revision: 1,
      event: {
        type: 'state.imported',
        revision: 1,
        resource: 'state',
      },
      assetReport: { referencedCount: 2, missingCount: 1, orphanedCount: 1 },
    })
  })

  it('rejects unauthenticated multipart imports once a password is set', async () => {
    await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/setup',
      payload: { password: 'hunter2' },
    })
    const upload = multipartRisuSave(fixtureBytes('legacy-raw-basic'))

    const imported = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/import/risusave',
      headers: { 'content-type': upload.contentType },
      payload: upload.payload,
    })

    expect(imported.statusCode).toBe(401)
    expect(harness.commandEvents.list()).toEqual([])
  })

  it('imports legacy .risu uploads through the server codec', async () => {
    const upload = multipartRisuSave(fixtureBytes('legacy-raw-basic'))

    const imported = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/import/risusave',
      headers: { 'content-type': upload.contentType },
      payload: upload.payload,
    })

    expect(imported.statusCode).toBe(200)
    expect(imported.json()).toEqual({
      revision: 1,
      event: {
        type: 'state.imported',
        revision: 1,
        resource: 'state',
      },
      envelope: 'legacy-raw',
      importReport: {
        unsupportedReferenceCount: 0,
        unsupportedReferences: [],
      },
      assetReport: { referencedCount: 0, missingCount: 0, orphanedCount: 0 },
    })
    expect(harness.commandEvents.list()).toEqual([imported.json().event])

    const persisted = JSON.parse(readFileSync(path.join(harness.dataDir, 'db.json'), 'utf8'))
    expect(persisted.database.characters).toHaveLength(1)
    expect(persisted.database.characterOrder).toEqual(['fixture-char'])
    expect(persisted.database.botPresets).toEqual([{ id: 'preset-a', name: 'Preset A' }])
  })

  it('imports RISUSAVE block uploads and reports unsupported references', async () => {
    const upload = multipartRisuSave(fixtureBytes('risusave-remote-reference'))

    const imported = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/import/risusave',
      headers: { 'content-type': upload.contentType },
      payload: upload.payload,
    })

    expect(imported.statusCode).toBe(200)
    expect(imported.json()).toEqual({
      revision: 1,
      event: {
        type: 'state.imported',
        revision: 1,
        resource: 'state',
      },
      envelope: 'risusave-blocks',
      importReport: {
        unsupportedReferenceCount: 1,
        unsupportedReferences: [
          { name: 'remote-char', type: RisuSaveBlockType.REMOTE, kind: 'remote' },
        ],
      },
      assetReport: { referencedCount: 0, missingCount: 0, orphanedCount: 0 },
    })

    const persisted = JSON.parse(readFileSync(path.join(harness.dataDir, 'db.json'), 'utf8'))
    expect(persisted.database.version).toBe(1)
    expect(persisted.database.__directory).toBeUndefined()
  })

  it('rejects multipart requests without an uploaded file', async () => {
    const upload = multipartTextOnly()

    const imported = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/import/risusave',
      headers: { 'content-type': upload.contentType },
      payload: upload.payload,
    })

    expect(imported.statusCode).toBe(400)
    expect(imported.json()).toEqual({ error: 'risusave file missing' })
    expect(harness.commandEvents.list()).toEqual([])
  })

  it('rejects malformed .risu uploads without mutating persistence', async () => {
    const upload = multipartRisuSave(fixtureBytes('malformed-unknown-envelope'))

    const imported = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/import/risusave',
      headers: { 'content-type': upload.contentType },
      payload: upload.payload,
    })

    expect(imported.statusCode).toBe(400)
    expect(imported.json()).toEqual({ error: 'Unsupported .risu envelope: unknown' })

    const bootstrap = await harness.app.inject({ method: 'GET', url: '/api/v1/bootstrap' })
    expect(bootstrap.json().revision).toBe(0)
    expect(bootstrap.json().database).toBeNull()
    expect(harness.commandEvents.list()).toEqual([])
  })
})
