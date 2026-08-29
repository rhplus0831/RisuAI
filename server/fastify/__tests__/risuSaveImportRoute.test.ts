import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs, { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { createCommandEventSink, type CommandEventSink } from '../src/commands/events.js'
import { risuSaveFixtureCases } from '../__fixtures__/risuSave/fixtures.js'
import { encodeRisuSaveBlockEnvelope, RisuSaveBlockType } from '../src/risuSave/blockCodec.js'
import { encodeLegacyRisuSaveEnvelope } from '../src/risuSave/legacyEnvelopeCodec.js'
import { RISUSAVE_EMPTY_DATABASE_ERROR, RISUSAVE_INCOMPLETE_BLOCKS_ERROR } from '../src/risuSave/importSnapshot.js'
import { RISU_SERVER_DATA_KEY } from '../src/risuSave/portableMetadata.js'
import {
  insertAssetMetadataBatch,
  listBackups,
  loadChatHydration,
  loadPersisted,
  loadPersistedWithMessages,
} from '../src/repository.js'
import { openDatabase } from '../src/db.js'
import { setupAuthedClient } from './helpers/auth.js'
import { listMemoryChunks, listMemorySummaries } from '../src/memoryRepository.js'
import { injectComposedResourceDatabase } from './helpers/resourceDatabase.js'

interface Harness {
  app: FastifyInstance
  dataDir: string
  commandEvents: CommandEventSink
}

const EXPORT_REQUIRED_ARRAY_FAMILIES = ['characters', 'botPresets', 'modules', 'loadouts', 'plugins'] as const

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
      importMaxBytes: Infinity,
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
      [`--${boundary}`, 'Content-Disposition: form-data; name="note"', '', 'no file here', `--${boundary}--`, ''].join(
        '\r\n',
      ),
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

function failCommandEventPersistence(dataDir: string): void {
  const db = new DatabaseSync(path.join(dataDir, 'risu.db'))
  try {
    db.exec(`
      CREATE TRIGGER fail_command_event_insert
      BEFORE INSERT ON command_events
      BEGIN
        SELECT RAISE(FAIL, 'injected command event failure');
      END;
    `)
  } finally {
    db.close()
  }
}

let harness: Harness
let assertion: string

beforeEach(async () => {
  harness = await startHarness()
  ;({ assertion } = await setupAuthedClient(harness.app))
})

afterEach(async () => {
  vi.restoreAllMocks()
  await stopHarness(harness)
})

function authedInject(opts: Record<string, unknown>) {
  const headers = (opts.headers ?? {}) as Record<string, string>
  return harness.app.inject({
    ...opts,
    headers: { 'risu-auth': assertion, ...headers },
  })
}

function authedComposedResourceDatabase(opts: Record<string, unknown>) {
  const headers = (opts.headers ?? {}) as Record<string, string>
  return injectComposedResourceDatabase(harness.app, {
    ...opts,
    headers: { 'risu-auth': assertion, ...headers },
  } as never)
}

function readBackupDatabase(dataDir: string, id: string): Record<string, unknown> {
  const backupRoot = path.join(dataDir, 'backups', id)
  const backupDb = new DatabaseSync(path.join(backupRoot, 'risu.db'), { readOnly: true })
  try {
    return loadPersistedWithMessages(backupDb, backupRoot).database as Record<string, unknown>
  } finally {
    backupDb.close()
  }
}

describe('multipart .risu import route', () => {
  it('restores portable reroll candidates into durable alternate rows', async () => {
    const imported = await authedInject({
      method: 'POST',
      url: '/api/v1/import/risusave',
      payload: {
        database: {
          characters: [
            {
              chaId: 'alternate-import-char',
              name: 'Alternate Import',
              chats: [
                {
                  id: 'alternate-import-chat',
                  message: [{ role: 'user', data: 'active', chatId: 'active-message' }],
                  alternates: [
                    { role: 'char', data: 'newest candidate', chatId: 'alternate-newest' },
                    { role: 'char', data: 'older candidate', chatId: 'alternate-older' },
                  ],
                },
              ],
            },
          ],
        },
      },
    })

    expect(imported.statusCode).toBe(200)
    const db = openDatabase(harness.dataDir)
    try {
      expect(loadChatHydration(db, harness.dataDir, 'alternate-import-chat').alternates).toEqual([
        { role: 'char', data: 'newest candidate', chatId: 'alternate-newest' },
        { role: 'char', data: 'older candidate', chatId: 'alternate-older' },
      ])
      const storedChat = (
        loadPersisted(db, harness.dataDir).database as { characters: Array<{ chats: Array<Record<string, unknown>> }> }
      ).characters[0].chats[0]
      expect(storedChat).not.toHaveProperty('alternates')
    } finally {
      db.close()
    }
  })

  it('keeps JSON fixture import behavior available', async () => {
    const imported = await authedInject({
      method: 'POST',
      url: '/api/v1/import/risusave',
      payload: { database: { version: 1 } },
    })

    expect(imported.statusCode).toBe(200)
    expect(imported.json()).toEqual({
      revision: 1,
      databaseLineage: expect.any(String),
      writerEpoch: 0,
      event: {
        type: 'state.imported',
        revision: 1,
        resource: 'state',
      },
      assetReport: { referencedCount: 0, missingCount: 0, orphanedCount: 0 },
    })
    expect(harness.commandEvents.list()).toEqual([imported.json().event])
    expect(listBackups(harness.dataDir)).toEqual([])

    const bootstrap = await authedComposedResourceDatabase({ method: 'GET', url: '/api/v1/bootstrap' })
    expectExportRequiredShape(bootstrap.resourceDatabase)

    const exported = await authedInject({
      method: 'GET',
      url: '/api/v1/export/risusave?envelope=risusave-blocks',
    })
    expect(exported.statusCode).toBe(200)
  })

  it.each(['legacy', 'blocks', 'json'] as const)(
    'restores portable tombstones from %s imports without exposing server metadata in bootstrap',
    async (format) => {
      const portableDatabase = {
        characters: [],
        [RISU_SERVER_DATA_KEY]: {
          version: 1,
          memoryLegacySummaryTombstones: [
            {
              summaryId: `summary-${format}`,
              chatId: `chat-${format}`,
              deletedAt: '2026-07-23T00:00:00.000Z',
            },
          ],
        },
      }
      const request =
        format === 'json'
          ? { payload: { database: portableDatabase }, headers: {} }
          : (() => {
              const bytes =
                format === 'legacy'
                  ? encodeLegacyRisuSaveEnvelope(portableDatabase, 'legacy-raw')
                  : encodeRisuSaveBlockEnvelope([
                      {
                        name: 'root',
                        type: RisuSaveBlockType.ROOT,
                        data: JSON.stringify({ ...portableDatabase, __directory: [] }),
                      },
                    ])
              const upload = multipartRisuSave(bytes)
              return {
                payload: upload.payload,
                headers: { 'content-type': upload.contentType },
              }
            })()

      const imported = await authedInject({
        method: 'POST',
        url: '/api/v1/import/risusave',
        ...request,
      })
      expect(imported.statusCode).toBe(200)

      const db = openDatabase(harness.dataDir)
      try {
        expect(
          db
            .prepare(
              `SELECT summary_id, chat_id, deleted_at
               FROM memory_legacy_summary_tombstones`,
            )
            .all(),
        ).toEqual([
          {
            summary_id: `summary-${format}`,
            chat_id: `chat-${format}`,
            deleted_at: '2026-07-23T00:00:00.000Z',
          },
        ])
      } finally {
        db.close()
      }

      const bootstrap = await authedComposedResourceDatabase({ method: 'GET', url: '/api/v1/bootstrap' })
      expect(bootstrap.resourceDatabase).not.toHaveProperty(RISU_SERVER_DATA_KEY)
    },
  )

  it('rejects malformed portable metadata before replacing the JSON database', async () => {
    const baseline = await authedInject({
      method: 'POST',
      url: '/api/v1/import/risusave',
      payload: { database: { characters: [], tag: 'preserve-before-malformed-metadata' } },
    })
    expect(baseline.statusCode).toBe(200)

    const imported = await authedInject({
      method: 'POST',
      url: '/api/v1/import/risusave',
      payload: {
        database: {
          characters: [],
          [RISU_SERVER_DATA_KEY]: {
            version: 1,
            memoryLegacySummaryTombstones: [
              { summaryId: 'duplicate', chatId: 'chat-a', deletedAt: 'now' },
              { summaryId: 'duplicate', chatId: 'chat-b', deletedAt: 'later' },
            ],
          },
        },
      },
    })
    expect(imported.statusCode).toBe(400)
    expect(imported.json().error).toContain('summaryId values must be unique')

    const bootstrap = await authedComposedResourceDatabase({ method: 'GET', url: '/api/v1/bootstrap' })
    expect(bootstrap.resourceDatabase).toMatchObject({ tag: 'preserve-before-malformed-metadata' })
    expect(bootstrap.resourceDatabase).not.toHaveProperty(RISU_SERVER_DATA_KEY)
  })

  it('takes a pre-import safety snapshot for JSON database replacements', async () => {
    const baseline = await authedInject({
      method: 'POST',
      url: '/api/v1/import/risusave',
      payload: { database: { version: 1, tag: 'before-json-import' } },
    })
    expect(baseline.statusCode).toBe(200)

    const imported = await authedInject({
      method: 'POST',
      url: '/api/v1/import/risusave',
      payload: { database: { version: 1, tag: 'after-json-import' } },
    })
    expect(imported.statusCode).toBe(200)

    const automatic = listBackups(harness.dataDir).filter((backup) => backup.kind === 'automatic')
    expect(automatic).toHaveLength(1)
    expect(automatic[0]).toMatchObject({ kind: 'automatic', label: 'Automatic safety snapshot' })
    expect(readBackupDatabase(harness.dataDir, automatic[0].id)).toMatchObject({ tag: 'before-json-import' })
  })

  it('takes a pre-import safety snapshot for multipart .risu replacements', async () => {
    const baseline = await authedInject({
      method: 'POST',
      url: '/api/v1/import/risusave',
      payload: { database: { version: 1, tag: 'before-multipart-import' } },
    })
    expect(baseline.statusCode).toBe(200)

    const upload = multipartRisuSave(fixtureBytes('legacy-raw-basic'))
    const imported = await authedInject({
      method: 'POST',
      url: '/api/v1/import/risusave',
      headers: { 'content-type': upload.contentType },
      payload: upload.payload,
    })
    expect(imported.statusCode).toBe(200)

    const automatic = listBackups(harness.dataDir).filter((backup) => backup.kind === 'automatic')
    expect(automatic).toHaveLength(1)
    expect(readBackupDatabase(harness.dataDir, automatic[0].id)).toMatchObject({ tag: 'before-multipart-import' })
  })

  it('fails import closed when its safety snapshot cannot be created', async () => {
    const baseline = await authedInject({
      method: 'POST',
      url: '/api/v1/import/risusave',
      payload: { database: { version: 1, tag: 'preserved-after-snapshot-failure' } },
    })
    expect(baseline.statusCode).toBe(200)

    const originalWriteFileSync = fs.writeFileSync.bind(fs)
    vi.spyOn(fs, 'writeFileSync').mockImplementation((file, data, options) => {
      if (
        String(file).endsWith(`${path.sep}manifest.json`) &&
        String(file).includes(`${path.sep}backups${path.sep}`) &&
        String(data).includes('"kind":"automatic"')
      ) {
        throw new Error('injected automatic backup manifest failure')
      }
      return originalWriteFileSync(file, data, options)
    })

    const imported = await authedInject({
      method: 'POST',
      url: '/api/v1/import/risusave',
      payload: { database: { version: 1, tag: 'must-not-be-imported' } },
    })
    expect(imported.statusCode).toBe(500)
    expect(imported.json()).toEqual({ error: 'automatic_backup_failed' })
    expect(listBackups(harness.dataDir)).toEqual([])

    const after = await authedComposedResourceDatabase({ method: 'GET', url: '/api/v1/bootstrap' })
    expect(after.resourceDatabase).toMatchObject({ tag: 'preserved-after-snapshot-failure' })
    expect(after.json().revision).toBe(baseline.json().revision)
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

      const bootstrap = await authedComposedResourceDatabase({ method: 'GET', url: '/api/v1/bootstrap' })
      expectExportRequiredShape(bootstrap.resourceDatabase)

      const exported = await authedInject({
        method: 'GET',
        url: '/api/v1/export/risusave?envelope=risusave-blocks',
      })
      expect(exported.statusCode).toBe(200)
    },
  )

  it.each([2, '2.1'] as const)('rejects JSON imports containing V%s-series plugins', async (version) => {
    const imported = await authedInject({
      method: 'POST',
      url: '/api/v1/import/risusave',
      payload: {
        database: {
          plugins: [{ name: 'unsupported-plugin', version }],
        },
      },
    })

    expect(imported.statusCode).toBe(400)
    expect(imported.json().error).toBe('plugins[0].version must be "3.0"; Fastify does not support V2-series plugins')
  })

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

    const bootstrap = await authedComposedResourceDatabase({ method: 'GET', url: '/api/v1/bootstrap' })
    expectExportRequiredShape(bootstrap.resourceDatabase)

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
      url: '/api/v1/chats/chat-a/messages',
    })
    const messages = hydration.json().message as Array<{
      chatId?: unknown
      data?: unknown
    }>
    expect(messages.map((message) => message.data)).toEqual(['missing id', 'kept id', 'duplicate id'])
    expect(messages.map((message) => message.chatId)).toContain('message-a')
    expect(new Set(messages.map((message) => message.chatId)).size).toBe(3)
    expect(messages.every((message) => typeof message.chatId === 'string' && message.chatId)).toBe(true)
    const bootstrap = await authedComposedResourceDatabase({ method: 'GET', url: '/api/v1/bootstrap' })
    expect(bootstrap.resourceDatabase).toMatchObject({
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

  it('preserves a null prompt template during JSON database import', async () => {
    const imported = await authedInject({
      method: 'POST',
      url: '/api/v1/import/risusave',
      payload: {
        database: {
          version: 1,
          promptTemplate: null,
          promptPresets: [{ id: 'prompt-disabled', name: 'Disabled Prompt', promptTemplate: null }],
          promptPresetsId: 0,
        },
      },
    })

    expect(imported.statusCode).toBe(200)

    const db = openDatabase(harness.dataDir)
    try {
      const persisted = loadPersisted(db, harness.dataDir).database as Record<string, unknown>
      // Disabled root collections are omitted by persistence; the regression was
      // materializing this value as an active empty array.
      expect(persisted).not.toHaveProperty('promptTemplate')
      expect((persisted.promptPresets as Array<Record<string, unknown>>)[0].promptTemplate).toBeNull()
    } finally {
      db.close()
    }
  })

  it('forces JSON database imported chat generation settings incomplete while preserving prefill', async () => {
    const imported = await authedInject({
      method: 'POST',
      url: '/api/v1/import/risusave',
      payload: {
        database: {
          version: 1,
          selectedPersona: 'global-persona-must-not-configure-chat',
          modelPresetsId: 0,
          promptPresetsId: 0,
          jailbreakToggle: true,
          globalChatVariables: { toggle_mode: 'global-mode' },
          personas: [{ id: 'persona-a', name: 'Persona A' }],
          modelPresets: [{ id: 'model-a', name: 'Model A' }],
          promptPresets: [{ id: 'prompt-a', name: 'Prompt A' }],
          characters: [
            {
              chaId: 'char-generation-settings-json',
              name: 'Generation Settings JSON',
              chats: [
                {
                  id: 'chat-generation-settings-json',
                  name: 'Configured In Source',
                  note: '',
                  localLore: [],
                  message: [],
                  generationSettings: {
                    configured: true,
                    personaId: 'persona-a',
                    modelPresetId: 'model-a',
                    promptPresetId: 'prompt-a',
                    jailbreakToggle: false,
                    sidebarToggles: {
                      mode: 'source-mode',
                      invalid: 1,
                    },
                    unsupported: 'dropped',
                  },
                },
                {
                  id: 'chat-without-generation-settings-json',
                  name: 'No Settings',
                  note: '',
                  localLore: [],
                  message: [],
                },
              ],
            },
          ],
        },
      },
    })

    expect(imported.statusCode).toBe(200)

    const bootstrap = await authedComposedResourceDatabase({ method: 'GET', url: '/api/v1/bootstrap' })
    const chats = bootstrap.resourceDatabase.characters[0].chats as Array<{
      generationSettings?: Record<string, unknown>
    }>
    expect(chats[0].generationSettings).toEqual({
      configured: false,
      personaId: 'persona-a',
      modelPresetId: 'model-a',
      promptPresetId: 'prompt-a',
      jailbreakToggle: false,
      sidebarToggles: { mode: 'source-mode' },
    })
    expect(chats[1].generationSettings).toBeUndefined()
  })

  it('repairs legacy lorebook key arrays and external aliases during imports', async () => {
    const imported = await authedInject({
      method: 'POST',
      url: '/api/v1/import/risusave',
      payload: {
        database: {
          characters: [
            {
              chaId: 'char-lore-array',
              name: 'Lore Array',
              globalLore: [
                {
                  id: 'char-entry-array',
                  keys: ['gamma', 'delta'],
                  secondary_keys: ['epsilon'],
                  entry: 'character lore content',
                  name: 'Character Entry',
                  mode: 'normal',
                  constant: false,
                  selective: true,
                  priority: 7,
                },
              ],
              chats: [
                {
                  id: 'chat-lore-array',
                  name: 'Chat Lore Array',
                  note: '',
                  localLore: [
                    {
                      id: 'chat-entry-array',
                      key: ['chat'],
                      secondkey: ['side'],
                      content: 'chat lore content',
                      comment: 'Chat Entry',
                      mode: 'normal',
                      alwaysActive: false,
                      selective: true,
                      order: 9,
                    },
                  ],
                  message: [],
                },
              ],
            },
          ],
          characterOrder: ['char-lore-array'],
          modules: [
            {
              id: 'mod-lore-array',
              name: 'Module Lore Array',
              description: '',
              lorebook: [
                {
                  id: 'module-entry-array',
                  key: [],
                  secondkey: [],
                  content: 'module lore content',
                  comment: 'Module Entry',
                  mode: 'normal',
                  alwaysActive: false,
                  selective: false,
                },
              ],
            },
          ],
        },
      },
    })

    expect(imported.statusCode).toBe(200)

    const bootstrap = await authedComposedResourceDatabase({ method: 'GET', url: '/api/v1/bootstrap' })
    const database = bootstrap.resourceDatabase
    expect(database.characters[0].globalLore[0]).toMatchObject({
      id: 'char-entry-array',
      key: 'gamma, delta',
      secondkey: 'epsilon',
      insertorder: 7,
      comment: 'Character Entry',
      content: 'character lore content',
      alwaysActive: false,
      selective: true,
    })
    expect(database.characters[0].chats[0].localLore[0]).toMatchObject({
      id: 'chat-entry-array',
      key: 'chat',
      secondkey: 'side',
      insertorder: 9,
      comment: 'Chat Entry',
      content: 'chat lore content',
      alwaysActive: false,
      selective: true,
    })
    const db = openDatabase(harness.dataDir)
    let persistedDatabase: { modules: Array<{ lorebook?: Array<Record<string, unknown>> }> }
    try {
      persistedDatabase = loadPersisted(db, harness.dataDir).database as typeof persistedDatabase
    } finally {
      db.close()
    }
    expect(persistedDatabase.modules[0].lorebook?.[0]).toMatchObject({
      id: 'module-entry-array',
      key: '',
      secondkey: '',
      insertorder: 100,
      comment: 'Module Entry',
      content: 'module lore content',
      alwaysActive: false,
      selective: false,
    })
  })

  it('imports JSON bodies through the normalized throwaway object without repository structuredClone', async () => {
    const payload = {
      database: {
        characters: [
          {
            chaId: 'char-l28',
            name: 'L28',
            chats: [
              {
                id: 'chat-l28',
                name: 'Chat L28',
                note: '',
                localLore: [],
                message: [
                  { role: 'user', data: 'hello', chatId: 'msg-l28-a' },
                  { role: 'char', data: 'world', chatId: 'msg-l28-b' },
                ],
                hypaV3Data: {
                  summaries: [
                    {
                      text: 'remembered both messages',
                      chatMemos: ['msg-l28-a', 'msg-l28-b'],
                      isImportant: true,
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    }
    const originalPayload = JSON.parse(JSON.stringify(payload)) as typeof payload
    const structuredCloneSpy = vi.spyOn(globalThis, 'structuredClone')
    let imported
    try {
      imported = await authedInject({
        method: 'POST',
        url: '/api/v1/import/risusave',
        payload,
      })
      expect(structuredCloneSpy).not.toHaveBeenCalled()
    } finally {
      structuredCloneSpy.mockRestore()
    }

    expect(imported.statusCode).toBe(200)
    expect(imported.json()).toEqual({
      revision: 1,
      databaseLineage: expect.any(String),
      writerEpoch: 0,
      event: {
        type: 'state.imported',
        revision: 1,
        resource: 'state',
      },
      assetReport: { referencedCount: 0, missingCount: 0, orphanedCount: 0 },
    })
    expect(payload).toEqual(originalPayload)

    const hydration = await authedInject({
      method: 'GET',
      url: '/api/v1/chats/chat-l28/messages',
    })
    expect(hydration.json().message).toEqual([
      { role: 'user', data: 'hello', chatId: 'msg-l28-a' },
      { role: 'char', data: 'world', chatId: 'msg-l28-b' },
    ])

    const verifyDb = openDatabase(harness.dataDir)
    try {
      const chunks = listMemoryChunks(verifyDb, { chatId: 'chat-l28' })
      const summaries = listMemorySummaries(verifyDb, { chatId: 'chat-l28' })
      expect(chunks).toHaveLength(1)
      expect(chunks[0]).toMatchObject({
        chatId: 'chat-l28',
        messageId: 'msg-l28-b',
        rangeStartSeq: 0,
        rangeEndSeq: 1,
        text: 'user: hello\nchar: world',
        status: 'summarized',
      })
      expect(summaries).toHaveLength(1)
      expect(summaries[0]).toMatchObject({
        chatId: 'chat-l28',
        chunkId: chunks[0].id,
        model: 'legacy-hypav3',
        text: 'remembered both messages',
      })
    } finally {
      verifyDb.close()
    }
  })

  it('rejects malformed JSON database imports without mutating persistence', async () => {
    const imported = await authedInject({
      method: 'POST',
      url: '/api/v1/import/risusave',
      payload: { database: 'not an object' },
    })

    expect(imported.statusCode).toBe(400)
    expect(imported.json()).toEqual({ error: 'database must be an object' })

    const bootstrap = await authedComposedResourceDatabase({ method: 'GET', url: '/api/v1/bootstrap' })
    expect(bootstrap.json().revision).toBe(0)
    expect(bootstrap.resourceDatabase).toBeNull()
    expect(harness.commandEvents.list()).toEqual([])
  })

  it('rejects hollow JSON and decoded .risu databases before snapshots or live mutations', async () => {
    const seeded = await authedInject({
      method: 'POST',
      url: '/api/v1/import/risusave',
      payload: {
        database: {
          version: 1,
          tag: 'preserve-live-data',
          characters: [{ chaId: 'live-char', name: 'Live Character', chats: [] }],
          modules: [{ id: 'live-module', name: 'Live Module' }],
        },
      },
    })
    expect(seeded.statusCode).toBe(200)
    const before = await authedComposedResourceDatabase({ method: 'GET', url: '/api/v1/bootstrap' })
    expect(listBackups(harness.dataDir)).toEqual([])

    const jsonImport = await authedInject({
      method: 'POST',
      url: '/api/v1/import/risusave',
      payload: { database: {} },
    })
    expect(jsonImport.statusCode).toBe(400)
    expect(jsonImport.json()).toEqual({ error: RISUSAVE_EMPTY_DATABASE_ERROR })

    const upload = multipartRisuSave(encodeLegacyRisuSaveEnvelope({}, 'legacy-raw'))
    const fileImport = await authedInject({
      method: 'POST',
      url: '/api/v1/import/risusave',
      headers: { 'content-type': upload.contentType },
      payload: upload.payload,
    })
    expect(fileImport.statusCode).toBe(400)
    expect(fileImport.json()).toEqual({ error: RISUSAVE_EMPTY_DATABASE_ERROR })

    const after = await authedComposedResourceDatabase({ method: 'GET', url: '/api/v1/bootstrap' })
    expect(after.json()).toMatchObject({
      revision: before.json().revision,
      databaseLineage: before.json().databaseLineage,
    })
    expect(after.resourceDatabase).toEqual(before.resourceDatabase)
    expect(listBackups(harness.dataDir)).toEqual([])
    expect(harness.commandEvents.list()).toEqual([seeded.json().event])
  })

  it('imports zero-character current and collection-only legacy databases', async () => {
    const current = await authedInject({
      method: 'POST',
      url: '/api/v1/import/risusave',
      payload: { database: { formatversion: 5, username: 'Zero Character User', characters: [] } },
    })
    expect(current.statusCode).toBe(200)

    const legacyUpload = multipartRisuSave(encodeLegacyRisuSaveEnvelope({ characters: [] }, 'legacy-compressed'))
    const legacy = await authedInject({
      method: 'POST',
      url: '/api/v1/import/risusave',
      headers: { 'content-type': legacyUpload.contentType },
      payload: legacyUpload.payload,
    })
    expect(legacy.statusCode).toBe(200)

    const bootstrap = await authedComposedResourceDatabase({ method: 'GET', url: '/api/v1/bootstrap' })
    expect(bootstrap.resourceDatabase.characters).toEqual([])
    expectExportRequiredShape(bootstrap.resourceDatabase)
  })

  it('does not write imported state when command event persistence fails', async () => {
    failCommandEventPersistence(harness.dataDir)

    const imported = await authedInject({
      method: 'POST',
      url: '/api/v1/import/risusave',
      payload: { database: { version: 1 } },
    })

    expect(imported.statusCode).toBe(500)
    expect(harness.commandEvents.list()).toEqual([])
    const bootstrap = await authedComposedResourceDatabase({ method: 'GET', url: '/api/v1/bootstrap' })
    expect(bootstrap.json().revision).toBe(0)
    expect(bootstrap.resourceDatabase).toBeNull()
  })

  it('reports referenced, missing, and orphaned server assets after JSON imports', async () => {
    const present = 'a'.repeat(64)
    const missing = 'b'.repeat(64)
    const orphaned = 'c'.repeat(64)
    const seedDb = new DatabaseSync(path.join(harness.dataDir, 'risu.db'))
    try {
      insertAssetMetadataBatch(seedDb, [
        { id: present, ext: 'png', size: 12, contentType: 'image/png' },
        { id: orphaned, ext: 'webp', size: 44, contentType: 'image/webp' },
      ])
    } finally {
      seedDb.close()
    }

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
      databaseLineage: expect.any(String),
      writerEpoch: 0,
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
      databaseLineage: expect.any(String),
      writerEpoch: 0,
      event: {
        type: 'state.imported',
        revision: 1,
        resource: 'state',
      },
      importReport: {
        incompleteChatCount: 1,
        unsupportedReferenceCount: 0,
      },
      assetReport: { referencedCount: 0, missingCount: 0, orphanedCount: 0 },
    })
    expect(imported.json()).not.toHaveProperty('envelope')
    expect(imported.json().importReport).not.toHaveProperty('unsupportedReferences')
    expect(harness.commandEvents.list()).toEqual([imported.json().event])

    const verifyDb = openDatabase(harness.dataDir)
    try {
      const persisted = loadPersisted(verifyDb, harness.dataDir)
      const database = persisted.database as Record<string, unknown>
      expect((database.characters as unknown[]).length).toBe(1)
      expect(database.characterOrder).toEqual(['fixture-char'])
      expect(database.botPresets).toEqual([
        {
          id: 'preset-a',
          name: 'Preset A',
          localNetworkMode: false,
          localNetworkTimeoutSec: 600,
        },
      ])
    } finally {
      verifyDb.close()
    }
  })

  it('forces multipart .risu imported chat generation settings incomplete and reports the count', async () => {
    const upload = multipartRisuSave(
      encodeLegacyRisuSaveEnvelope(
        {
          version: 1,
          personas: [{ id: 'persona-risu', name: 'Persona Risu' }],
          modelPresets: [{ id: 'model-risu', name: 'Model Risu' }],
          promptPresets: [{ id: 'prompt-risu', name: 'Prompt Risu' }],
          characters: [
            {
              chaId: 'char-generation-settings-risu',
              name: 'Generation Settings Risu',
              chats: [
                {
                  id: 'chat-generation-settings-risu',
                  name: 'Configured In Source',
                  note: '',
                  localLore: [],
                  message: [],
                  generationSettings: {
                    configured: true,
                    personaId: 'persona-risu',
                    modelPresetId: 'model-risu',
                    promptPresetId: 'prompt-risu',
                    jailbreakToggle: true,
                    sidebarToggles: { tone: 'warm' },
                  },
                },
                {
                  id: 'chat-generation-settings-risu-empty',
                  name: 'No Settings',
                  note: '',
                  localLore: [],
                  message: [],
                },
              ],
            },
          ],
        },
        'legacy-raw',
      ),
    )

    const imported = await authedInject({
      method: 'POST',
      url: '/api/v1/import/risusave',
      headers: { 'content-type': upload.contentType },
      payload: upload.payload,
    })

    expect(imported.statusCode).toBe(200)
    expect(imported.json().importReport).toEqual({
      incompleteChatCount: 2,
      unsupportedReferenceCount: 0,
    })
    expect(imported.json().importReport).not.toHaveProperty('unsupportedReferences')

    const bootstrap = await authedComposedResourceDatabase({ method: 'GET', url: '/api/v1/bootstrap' })
    const chats = bootstrap.resourceDatabase.characters[0].chats as Array<{
      generationSettings?: Record<string, unknown>
    }>
    expect(chats[0].generationSettings).toEqual({
      configured: false,
      personaId: 'persona-risu',
      modelPresetId: 'model-risu',
      promptPresetId: 'prompt-risu',
      jailbreakToggle: true,
      sidebarToggles: { tone: 'warm' },
    })
    expect(chats[1].generationSettings).toBeUndefined()
  })

  it('rejects legacy uploads whose expanded payload exceeds the import limit', async () => {
    const upload = multipartRisuSave(
      encodeLegacyRisuSaveEnvelope({ version: 1, oversized: 'x'.repeat(1024 * 1024 + 1) }, 'legacy-compressed'),
    )

    const imported = await authedInject({
      method: 'POST',
      url: '/api/v1/import/risusave',
      headers: { 'content-type': upload.contentType },
      payload: upload.payload,
    })

    expect(imported.statusCode).toBe(400)
    expect(imported.json()).toEqual({ error: 'Expanded .risu payload exceeds size limit' })

    const bootstrap = await authedComposedResourceDatabase({ method: 'GET', url: '/api/v1/bootstrap' })
    expect(bootstrap.json().revision).toBe(0)
    expect(bootstrap.resourceDatabase).toBeNull()
    expect(harness.commandEvents.list()).toEqual([])
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
      databaseLineage: expect.any(String),
      writerEpoch: 0,
      event: {
        type: 'state.imported',
        revision: 1,
        resource: 'state',
      },
      importReport: {
        incompleteChatCount: 0,
        unsupportedReferenceCount: 1,
      },
      assetReport: { referencedCount: 0, missingCount: 0, orphanedCount: 0 },
    })
    expect(imported.json()).not.toHaveProperty('envelope')
    expect(imported.json().importReport).not.toHaveProperty('unsupportedReferences')
  })

  it('salvages supported blocks and reports every skipped standalone CHAT block', async () => {
    const seeded = await authedInject({
      method: 'POST',
      url: '/api/v1/import/risusave',
      payload: {
        database: {
          version: 1,
          tag: 'preserve-before-standalone-chat-import',
          characters: [{ chaId: 'live-char', name: 'Live Character', chats: [] }],
        },
      },
    })
    expect(seeded.statusCode).toBe(200)
    const before = await authedComposedResourceDatabase({ method: 'GET', url: '/api/v1/bootstrap' })
    const upload = multipartRisuSave(
      encodeRisuSaveBlockEnvelope([
        {
          name: 'root',
          type: RisuSaveBlockType.ROOT,
          data: JSON.stringify({
            version: 2,
            tag: 'salvaged-block-save',
            __directory: ['supported-character', 'standalone-chat'],
          }),
        },
        {
          name: 'supported-character',
          type: RisuSaveBlockType.CHARACTER_WITHOUT_CHAT,
          data: JSON.stringify({ chaId: 'salvaged-char', name: 'Salvaged Character', chats: [] }),
        },
        {
          name: 'standalone-chat',
          type: RisuSaveBlockType.CHAT,
          data: JSON.stringify({ id: 'standalone-chat', name: 'Unsupported Chat', message: [] }),
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
    expect(imported.json()).toMatchObject({
      revision: 2,
      importReport: {
        incompleteChatCount: 0,
        unsupportedReferenceCount: 0,
        skippedBlocks: [{ name: 'standalone-chat', type: 'CHAT' }],
      },
    })
    const after = await authedComposedResourceDatabase({ method: 'GET', url: '/api/v1/bootstrap' })
    expect(after.resourceDatabase).toMatchObject({
      tag: 'salvaged-block-save',
      characters: [expect.objectContaining({ chaId: 'salvaged-char', name: 'Salvaged Character' })],
    })
    expect(after.resourceDatabase.tag).not.toBe(before.resourceDatabase.tag)
    expect(listBackups(harness.dataDir)).toHaveLength(1)
    expect(harness.commandEvents.list()).toHaveLength(2)
  })

  it('rejects a block upload truncated exactly after a complete block before taking a snapshot', async () => {
    const seeded = await authedInject({
      method: 'POST',
      url: '/api/v1/import/risusave',
      payload: {
        database: {
          version: 1,
          tag: 'preserve-after-truncation',
          characters: [{ chaId: 'live-char', name: 'Live Character', chats: [] }],
          modules: [{ id: 'live-module', name: 'Live Module' }],
        },
      },
    })
    expect(seeded.statusCode).toBe(200)
    const before = await authedComposedResourceDatabase({ method: 'GET', url: '/api/v1/bootstrap' })

    const blocks = [
      {
        name: 'root',
        type: RisuSaveBlockType.ROOT,
        data: JSON.stringify({ version: 2, __directory: ['preset', 'modules', 'config'] }),
      },
      {
        name: 'preset',
        type: RisuSaveBlockType.BOTPRESET,
        data: JSON.stringify([]),
      },
      {
        name: 'modules',
        type: RisuSaveBlockType.MODULES,
        data: JSON.stringify([]),
      },
      {
        name: 'config',
        type: RisuSaveBlockType.CONFIG,
        data: JSON.stringify({ version: 1 }),
      },
    ]
    const complete = encodeRisuSaveBlockEnvelope(blocks)
    const boundary = encodeRisuSaveBlockEnvelope(blocks.slice(0, 2)).byteLength
    const upload = multipartRisuSave(complete.slice(0, boundary))
    const imported = await authedInject({
      method: 'POST',
      url: '/api/v1/import/risusave',
      headers: { 'content-type': upload.contentType },
      payload: upload.payload,
    })

    expect(imported.statusCode).toBe(400)
    expect(imported.json()).toEqual({ error: RISUSAVE_INCOMPLETE_BLOCKS_ERROR })
    const after = await authedComposedResourceDatabase({ method: 'GET', url: '/api/v1/bootstrap' })
    expect(after.json()).toMatchObject({
      revision: before.json().revision,
      databaseLineage: before.json().databaseLineage,
    })
    expect(after.resourceDatabase).toEqual(before.resourceDatabase)
    expect(listBackups(harness.dataDir)).toEqual([])
    expect(harness.commandEvents.list()).toEqual([seeded.json().event])
  })

  it('rejects block uploads whose expanded payload exceeds the import limit', async () => {
    const upload = multipartRisuSave(
      encodeRisuSaveBlockEnvelope([
        {
          name: 'root',
          type: RisuSaveBlockType.ROOT,
          data: JSON.stringify({ version: 1, oversized: 'x'.repeat(1024 * 1024 + 1) }),
          compression: true,
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
    expect(imported.json()).toEqual({ error: 'Expanded .risu payload exceeds size limit' })

    const bootstrap = await authedComposedResourceDatabase({ method: 'GET', url: '/api/v1/bootstrap' })
    expect(bootstrap.json().revision).toBe(0)
    expect(bootstrap.resourceDatabase).toBeNull()
    expect(harness.commandEvents.list()).toEqual([])
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

    const bootstrap = await authedComposedResourceDatabase({ method: 'GET', url: '/api/v1/bootstrap' })
    expect(bootstrap.resourceDatabase.customRootField).toEqual({ enabled: true })
    expectExportRequiredShape(bootstrap.resourceDatabase)
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

    const bootstrap = await authedComposedResourceDatabase({ method: 'GET', url: '/api/v1/bootstrap' })
    expect(bootstrap.json().revision).toBe(1)
    expect(bootstrap.resourceDatabase.version).toBe(1)
    expect(bootstrap.resourceDatabase.customRootField).toEqual({ kept: true })
    expectExportRequiredShape(bootstrap.resourceDatabase)

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

    const bootstrap = await authedComposedResourceDatabase({ method: 'GET', url: '/api/v1/bootstrap' })
    expect(bootstrap.json().revision).toBe(0)
    expect(bootstrap.resourceDatabase).toBeNull()
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

    const bootstrap = await authedComposedResourceDatabase({ method: 'GET', url: '/api/v1/bootstrap' })
    expect(bootstrap.json().revision).toBe(0)
    expect(bootstrap.resourceDatabase).toBeNull()
    expect(harness.commandEvents.list()).toEqual([])
  })
})
