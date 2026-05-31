import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { createCommandEventSink, type CommandEventSink } from '../src/commands/events.js'
import { risuSaveFixtureCases } from '../__fixtures__/risuSave/fixtures.js'
import { encodeRisuSaveBlockEnvelope, RisuSaveBlockType } from '../src/risuSave/blockCodec.js'
import { writePersisted } from '../src/repository.js'
import { setupAuthedClient } from './helpers/auth.js'

interface Harness {
  app: FastifyInstance
  dataDir: string
  commandEvents: CommandEventSink
}

const EXPORT_REQUIRED_ARRAY_FAMILIES = [
  'characters',
  'botPresets',
  'modules',
  'loadouts',
  'plugins',
] as const

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

function expectExportRequiredShape(database: Record<string, unknown>): void {
  for (const key of EXPORT_REQUIRED_ARRAY_FAMILIES) {
    expect(Array.isArray(database[key]), key).toBe(true)
  }
  expect(database.pluginCustomStorage).toEqual(expect.any(Object))
  expect(Array.isArray(database.pluginCustomStorage)).toBe(false)
}

let harness: Harness
let assertion: string

beforeEach(async () => {
  harness = await startHarness()
  ;({ assertion } = await setupAuthedClient(harness.app))
})

afterEach(async () => {
  await stopHarness(harness)
})

function authedInject(opts: Record<string, unknown>) {
  const headers = (opts.headers ?? {}) as Record<string, string>
  return harness.app.inject({
    ...opts,
    headers: { 'risu-auth': assertion, ...headers },
  })
}

describe('Phase 9-8a multipart .risu import route', () => {
  it('keeps JSON fixture import behavior available', async () => {
    const imported = await authedInject({
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

    const bootstrap = await authedInject({ method: 'GET', url: '/api/v1/bootstrap' })
    expectExportRequiredShape(bootstrap.json().database)

    const exported = await authedInject({
      method: 'GET',
      url: '/api/v1/export/risusave?envelope=risusave-blocks',
    })
    expect(exported.statusCode).toBe(200)
  })

  it.each([...EXPORT_REQUIRED_ARRAY_FAMILIES, 'pluginCustomStorage'] as const)(
    'normalizes JSON imports that are missing database.%s',
    async (missingKey) => {
      const database: Record<string, unknown> = {
        characters: [],
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
      }
      delete database[missingKey]

      const imported = await authedInject({
        method: 'POST',
        url: '/api/v1/import/risusave',
        payload: { database },
      })

      expect(imported.statusCode).toBe(200)

      const bootstrap = await authedInject({ method: 'GET', url: '/api/v1/bootstrap' })
      expectExportRequiredShape(bootstrap.json().database)

      const exported = await authedInject({
        method: 'GET',
        url: '/api/v1/export/risusave?envelope=risusave-blocks',
      })
      expect(exported.statusCode).toBe(200)
    },
  )

  it('normalizes malformed JSON resource families into the exportable current shape', async () => {
    const imported = await authedInject({
      method: 'POST',
      url: '/api/v1/import/risusave',
      payload: {
        database: {
          characters: 'not an array',
          botPresets: 'not an array',
          modules: 'not an array',
          loadouts: 'not an array',
          plugins: 'not an array',
          pluginCustomStorage: [],
        },
      },
    })

    expect(imported.statusCode).toBe(200)

    const bootstrap = await authedInject({ method: 'GET', url: '/api/v1/bootstrap' })
    expectExportRequiredShape(bootstrap.json().database)

    const exported = await authedInject({
      method: 'GET',
      url: '/api/v1/export/risusave?envelope=risusave-blocks',
    })
    expect(exported.statusCode).toBe(200)
  })

  it('normalizes JSON database imports through the current-shape .risu normalizer', async () => {
    const imported = await authedInject({
      method: 'POST',
      url: '/api/v1/import/risusave',
      payload: {
        database: {
          characters: [
            {
              chaId: 'char-a',
              name: 'A',
              chats: [
                {
                  id: 'chat-a',
                  name: 'Chat A',
                  note: '',
                  localLore: [],
                  message: [
                    { role: 'user', data: 'missing id' },
                    { role: 'char', data: 'kept id', chatId: 'message-a' },
                    { role: 'user', data: 'duplicate id', chatId: 'message-a' },
                  ],
                },
              ],
            },
          ],
        },
      },
    })

    expect(imported.statusCode).toBe(200)

    // Messages are hydrated via the per-chat endpoint, not the stub.
    const hydration = await authedInject({
      method: 'GET',
      url: '/api/v1/projection/chatMessages?id=chat-a',
    })
    const messages = hydration.json().message as Array<{
      chatId?: unknown
      data?: unknown
    }>
    expect(messages.map((message) => message.data)).toEqual([
      'missing id',
      'kept id',
      'duplicate id',
    ])
    expect(messages.map((message) => message.chatId)).toContain('message-a')
    expect(new Set(messages.map((message) => message.chatId)).size).toBe(3)
    expect(messages.every((message) => typeof message.chatId === 'string' && message.chatId)).toBe(
      true,
    )
    const bootstrap = await authedInject({ method: 'GET', url: '/api/v1/bootstrap' })
    expect(bootstrap.json().database).toMatchObject({
      characters: [
        expect.objectContaining({
          chaId: 'char-a',
          chats: [
            expect.objectContaining({
              id: 'chat-a',
              localLore: [],
              message: [], // stub
            }),
          ],
        }),
      ],
      characterOrder: ['char-a'],
      currentChar: 0,
    })
  })

  it('rejects malformed JSON database imports without mutating persistence', async () => {
    const imported = await authedInject({
      method: 'POST',
      url: '/api/v1/import/risusave',
      payload: { database: 'not an object' },
    })

    expect(imported.statusCode).toBe(400)
    expect(imported.json()).toEqual({ error: 'database must be an object' })

    const bootstrap = await authedInject({ method: 'GET', url: '/api/v1/bootstrap' })
    expect(bootstrap.json().revision).toBe(0)
    expect(bootstrap.json().database).toBeNull()
    expect(harness.commandEvents.list()).toEqual([])
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

    const imported = await authedInject({
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

    const imported = await authedInject({
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

    const imported = await authedInject({
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

  it('imports non-reserved RISUSAVE root-component fields', async () => {
    const upload = multipartRisuSave(
      encodeRisuSaveBlockEnvelope([
        {
          name: 'root',
          type: RisuSaveBlockType.ROOT,
          data: JSON.stringify({ version: 1, __directory: ['root-component'] }),
        },
        {
          name: 'root-component',
          type: RisuSaveBlockType.ROOT_COMPONENT,
          data: JSON.stringify({ key: 'customRootField', data: { enabled: true } }),
        },
      ]),
    )

    const imported = await authedInject({
      method: 'POST',
      url: '/api/v1/import/risusave',
      headers: { 'content-type': upload.contentType },
      payload: upload.payload,
    })

    expect(imported.statusCode).toBe(200)

    const bootstrap = await authedInject({ method: 'GET', url: '/api/v1/bootstrap' })
    expect(bootstrap.json().database.customRootField).toEqual({ enabled: true })
    expectExportRequiredShape(bootstrap.json().database)
  })

  it('rejects RISUSAVE root-component resource-family overwrites without mutating persistence', async () => {
    const seeded = await authedInject({
      method: 'POST',
      url: '/api/v1/import/risusave',
      payload: { database: { version: 1, customRootField: { kept: true } } },
    })
    expect(seeded.statusCode).toBe(200)

    const upload = multipartRisuSave(
      encodeRisuSaveBlockEnvelope([
        {
          name: 'root',
          type: RisuSaveBlockType.ROOT,
          data: JSON.stringify({ version: 2, __directory: ['bad-component'] }),
        },
        {
          name: 'bad-component',
          type: RisuSaveBlockType.ROOT_COMPONENT,
          data: JSON.stringify({ key: 'characters', data: 'not an array' }),
        },
      ]),
    )

    const imported = await authedInject({
      method: 'POST',
      url: '/api/v1/import/risusave',
      headers: { 'content-type': upload.contentType },
      payload: upload.payload,
    })

    expect(imported.statusCode).toBe(400)
    expect(imported.json()).toEqual({
      error: 'bad-component block key characters is reserved for resource blocks',
    })
    expect(harness.commandEvents.list()).toEqual([seeded.json().event])

    const bootstrap = await authedInject({ method: 'GET', url: '/api/v1/bootstrap' })
    expect(bootstrap.json().revision).toBe(1)
    expect(bootstrap.json().database.version).toBe(1)
    expect(bootstrap.json().database.customRootField).toEqual({ kept: true })
    expectExportRequiredShape(bootstrap.json().database)

    const exported = await authedInject({
      method: 'GET',
      url: '/api/v1/export/risusave?envelope=risusave-blocks',
    })
    expect(exported.statusCode).toBe(200)
  })

  it('rejects multipart requests without an uploaded file', async () => {
    const upload = multipartTextOnly()

    const imported = await authedInject({
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

    const imported = await authedInject({
      method: 'POST',
      url: '/api/v1/import/risusave',
      headers: { 'content-type': upload.contentType },
      payload: upload.payload,
    })

    expect(imported.statusCode).toBe(400)
    expect(imported.json()).toEqual({ error: 'Unsupported .risu envelope: unknown' })

    const bootstrap = await authedInject({ method: 'GET', url: '/api/v1/bootstrap' })
    expect(bootstrap.json().revision).toBe(0)
    expect(bootstrap.json().database).toBeNull()
    expect(harness.commandEvents.list()).toEqual([])
  })

  it('returns 400 (not 500) for a malformed RISUSAVE block structure', async () => {
    // Valid 'RISUSAVE\0' envelope header followed by a truncated block.
    const upload = multipartRisuSave(new TextEncoder().encode('RISUSAVE\0x'))

    const imported = await authedInject({
      method: 'POST',
      url: '/api/v1/import/risusave',
      headers: { 'content-type': upload.contentType },
      payload: upload.payload,
    })

    expect(imported.statusCode).toBe(400)
    expect(imported.json()).toEqual({ error: 'Malformed RISUSAVE block header at offset 9' })

    const bootstrap = await authedInject({ method: 'GET', url: '/api/v1/bootstrap' })
    expect(bootstrap.json().revision).toBe(0)
    expect(bootstrap.json().database).toBeNull()
    expect(harness.commandEvents.list()).toEqual([])
  })
})
