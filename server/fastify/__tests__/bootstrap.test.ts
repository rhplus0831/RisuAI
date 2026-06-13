import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { webcrypto } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { buildApp } from '../src/app.js'
import { CURRENT_SCHEMA_VERSION, openDatabase } from '../src/db.js'
import { loadPersisted } from '../src/repository.js'
import { MASKED_PROVIDER_SECRET } from '../src/providerSecrets.js'
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
      importMaxBytes: Infinity,
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

async function signAssertion(privateKey: CryptoKey, publicJwk: JsonWebKey, ttlSec = 60): Promise<string> {
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

let harness: Harness

beforeEach(async () => {
  harness = await startHarness()
})

afterEach(async () => {
  await stopHarness(harness)
})

function expectNormalizedAdaDatabase(database: unknown, expected: Record<string, unknown> = {}): void {
  expect(database).toMatchObject({
    ...expected,
    characters: [
      expect.objectContaining({
        chaId: 'char-a',
        name: 'Ada',
        chats: [],
        chatFolders: [],
        customscript: [],
        triggerscript: [],
        globalLore: [],
      }),
    ],
    characterOrder: ['char-a'],
    currentChar: 0,
  })
}

describe('Phase 2A bootstrap + import', () => {
  it('rejects bootstrap on a fresh data dir until a password is set', async () => {
    const res = await harness.app.inject({ method: 'GET', url: '/api/v1/bootstrap' })
    expect(res.statusCode).toBe(401)
  })

  it('rejects unauthenticated bootstrap once a password is set', async () => {
    await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/setup',
      payload: { password: 'hunter2' },
    })
    const res = await harness.app.inject({ method: 'GET', url: '/api/v1/bootstrap' })
    expect(res.statusCode).toBe(401)
  })

  it('accepts bootstrap immediately when setup registers the client key', async () => {
    const keypair = (await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
      'verify',
    ])) as CryptoKeyPair
    const publicKey = await subtle.exportKey('jwk', keypair.publicKey)

    const setup = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/setup',
      payload: { password: 'hunter2', publicKey },
    })
    expect(setup.statusCode).toBe(200)

    const assertion = await signAssertion(keypair.privateKey, publicKey)
    const res = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().revision).toBe(0)
  })

  it('imports a database and serves it back via bootstrap', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const sample = { greeting: 'hi', characters: [{ chaId: 'char-a', name: 'Ada' }] }

    const imported = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/import/risusave',
      headers: { 'risu-auth': assertion },
      payload: { database: sample },
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

    // After Phase 5, db.json is removed; all state lives in SQLite.
    const db = openDatabase(harness.dataDir)
    try {
      const onDisk = loadPersisted(db, harness.dataDir)
      expectNormalizedAdaDatabase(onDisk.database, { greeting: 'hi' })
    } finally {
      db.close()
    }

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.statusCode).toBe(200)
    expect(bootstrap.json().revision).toBe(1)
    expect(bootstrap.json().schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(bootstrap.json().assetBaseUrl).toBe('/api/v1/assets')
    expectNormalizedAdaDatabase(bootstrap.json().database, { greeting: 'hi' })
  })

  it('L19: gzip-compresses large bootstrap JSON without changing the body', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const sample = {
      greeting: 'hi',
      characters: [
        {
          chaId: 'char-a',
          name: 'Ada',
          desc: 'Large bootstrap card text. '.repeat(400),
          firstMessage: 'Hello from a compressible card. '.repeat(160),
          chats: [],
        },
      ],
    }
    const imported = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/import/risusave',
      headers: { 'risu-auth': assertion },
      payload: { database: sample },
    })
    expect(imported.statusCode).toBe(200)

    const uncompressed = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(uncompressed.statusCode).toBe(200)
    expect(uncompressed.headers['content-encoding']).toBeUndefined()

    const compressed = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion, 'accept-encoding': 'gzip' },
    })
    expect(compressed.statusCode).toBe(200)
    expect(compressed.headers['content-encoding']).toBe('gzip')
    const compressedBytes = Buffer.from(compressed.rawPayload)
    const uncompressedBytes = Buffer.from(uncompressed.rawPayload)
    expect(gunzipSync(compressedBytes).toString('utf8')).toBe(uncompressed.body)
    expect(compressedBytes.length).toBeLessThan(uncompressedBytes.length * 0.7)
  })

  it('stores imported chat messages in SQLite, message-free on disk, hydrated over the wire', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const sample = {
      characters: [
        {
          chaId: 'char-a',
          name: 'Ada',
          chats: [
            {
              id: 'chat-1',
              name: 'Chat 1',
              note: '',
              localLore: [],
              message: [
                { role: 'user', data: 'hello', chatId: 'm1' },
                { role: 'char', data: 'hi there', chatId: 'm2' },
              ],
              hypaV3Data: { mainChunks: [{ text: 'summary' }], lastImportantSummary: 1 },
            },
          ],
        },
      ],
    }

    const imported = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/import/risusave',
      headers: { 'risu-auth': assertion },
      payload: { database: sample },
    })
    expect(imported.statusCode).toBe(200)

    // After Phase 5, db.json is removed; verify via loadPersisted that the
    // chat metadata is present but messages are not embedded (they live in the
    // messages table).
    const verifyDb = openDatabase(harness.dataDir)
    try {
      const onDisk = loadPersisted(verifyDb, harness.dataDir)
      const onDiskChat = (onDisk.database as Record<string, unknown[]>).characters[0] as Record<string, unknown[]>
      const chat = (onDiskChat.chats as Record<string, unknown>[])[0]
      expect(chat.id).toBe('chat-1')
      // loadPersisted does not join messages; they live in SQLite only.
      expect(chat.message).toBeUndefined()
      expect(chat.hypaV3Data).toBeUndefined()
    } finally {
      verifyDb.close()
    }

    // The messages + hypaV3Data live as rows in their SQLite tables.
    const db = new DatabaseSync(path.join(harness.dataDir, 'risu.db'))
    try {
      const rows = db.prepare('SELECT chat_id, seq, uid, data FROM messages ORDER BY seq').all() as {
        chat_id: string
        seq: number
        uid: string
        data: string
      }[]
      expect(rows).toEqual([
        { chat_id: 'chat-1', seq: 0, uid: 'm1', data: 'hello' },
        { chat_id: 'chat-1', seq: 1, uid: 'm2', data: 'hi there' },
      ])
      const hypaRow = db.prepare('SELECT json FROM chat_hypa_v3 WHERE chat_id = ?').get('chat-1') as
        | { json: string }
        | undefined
      expect(JSON.parse(hypaRow!.json)).toEqual({
        mainChunks: [{ text: 'summary' }],
        lastImportantSummary: 1,
      })
    } finally {
      db.close()
    }

    // The bootstrap projection ships a chat stub: metadata present, message[] empty.
    // The client hydrates messages on open.
    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.statusCode).toBe(200)
    const stubChat = bootstrap.json().database.characters[0].chats[0]
    expect(stubChat.id).toBe('chat-1')
    expect(stubChat.message).toEqual([])
    expect(stubChat.hypaV3Data).toBeUndefined() // stripped from the wire stub

    // The per-chat hydration endpoint serves the real messages + hypaV3Data.
    const hydration = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/projection/chatMessages?id=chat-1',
      headers: { 'risu-auth': assertion },
    })
    expect(hydration.statusCode).toBe(200)
    expect(hydration.json()).toMatchObject({
      resource: 'chatMessages',
      mode: 'chat-messages',
      chatId: 'chat-1',
      message: [
        { role: 'user', data: 'hello', chatId: 'm1' },
        { role: 'char', data: 'hi there', chatId: 'm2' },
      ],
      hypaV3Data: { mainChunks: [{ text: 'summary' }], lastImportantSummary: 1 },
    })
  })

  it('ships inactive character shells in bootstrap and hydrates full rows via characterRow', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const sample = {
      currentChar: 0,
      characterOrder: ['char-a', 'char-b'],
      characters: [
        {
          chaId: 'char-a',
          name: 'Ada',
          image: 'ada-icon',
          desc: 'Selected description',
          firstMessage: 'Selected greeting',
          chats: [{ id: 'chat-a', name: 'Selected chat', message: [{ role: 'user', data: 'hello' }] }],
          globalLore: [{ key: 'selected', content: 'selected lore' }],
        },
        {
          chaId: 'char-b',
          name: 'Babbage',
          image: 'babbage-icon',
          lastInteraction: 123,
          chatPage: 0,
          chatFolders: [{ id: 'folder-a', name: 'Pinned', folded: false }],
          desc: 'Inactive heavy description',
          firstMessage: 'Inactive greeting',
          exampleMessage: 'Inactive example',
          customscript: [{ type: 'start', script: 'heavy script' }],
          globalLore: [{ key: 'inactive', content: 'inactive lore' }],
          oaiTTSConfig: {
            enabled: true,
            baseURL: 'https://api.openai.com/v1',
            apiKey: 'sk-character-tts',
            model: 'tts-1',
          },
          chats: [
            {
              id: 'chat-b',
              name: 'Inactive chat',
              note: 'chat note',
              fmIndex: -1,
              folderId: 'folder-a',
              modules: ['module-a'],
              localLore: [{ key: 'chat-lore', content: 'chat lore' }],
              bookmarks: ['msg-b'],
              bookmarkNames: { 'msg-b': 'Pinned' },
              message: [{ role: 'char', data: 'heavy message' }],
              hypaV3Data: { mainChunks: [{ text: 'summary' }] },
            },
          ],
        },
      ],
    }

    const imported = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/import/risusave',
      headers: { 'risu-auth': assertion },
      payload: { database: sample },
    })
    expect(imported.statusCode).toBe(200)

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.statusCode).toBe(200)
    const characters = bootstrap.json().database.characters
    expect(characters[0]).toMatchObject({
      chaId: 'char-a',
      name: 'Ada',
      desc: 'Selected description',
      firstMessage: 'Selected greeting',
    })
    expect(characters[0]).not.toHaveProperty('__serverCharacterShell')
    expect(characters[0].chats[0].message).toEqual([])

    expect(characters[1]).toMatchObject({
      __serverCharacterShell: true,
      chaId: 'char-b',
      name: 'Babbage',
      image: 'babbage-icon',
      lastInteraction: 123,
      chatPage: 0,
      chatFolders: [{ id: 'folder-a', name: 'Pinned', folded: false }],
      chats: [
        {
          id: 'chat-b',
          name: 'Inactive chat',
          note: 'chat note',
          fmIndex: -1,
          folderId: 'folder-a',
          modules: ['module-a'],
          localLore: [{ key: 'chat-lore', content: 'chat lore' }],
          bookmarks: ['msg-b'],
          bookmarkNames: { 'msg-b': 'Pinned' },
          message: [],
        },
      ],
    })
    expect(characters[1]).not.toHaveProperty('desc')
    expect(characters[1]).not.toHaveProperty('firstMessage')
    expect(characters[1]).not.toHaveProperty('exampleMessage')
    expect(characters[1]).not.toHaveProperty('customscript')
    expect(characters[1]).not.toHaveProperty('globalLore')
    expect(characters[1]).not.toHaveProperty('oaiTTSConfig')
    expect(characters[1].chats[0]).not.toHaveProperty('hypaV3Data')

    const hydration = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/projection/characterRow?id=char-b',
      headers: { 'risu-auth': assertion },
    })
    expect(hydration.statusCode).toBe(200)
    expect(hydration.json()).toMatchObject({
      resource: 'characterRow',
      mode: 'character-row',
      characterId: 'char-b',
      character: {
        chaId: 'char-b',
        name: 'Babbage',
        desc: 'Inactive heavy description',
        firstMessage: 'Inactive greeting',
        exampleMessage: 'Inactive example',
        customscript: [{ type: 'start', script: 'heavy script' }],
        globalLore: [{ key: 'inactive', content: 'inactive lore' }],
        oaiTTSConfig: {
          enabled: true,
          baseURL: 'https://api.openai.com/v1',
          apiKey: MASKED_PROVIDER_SECRET,
          model: 'tts-1',
        },
      },
    })
    expect(hydration.json().character).not.toHaveProperty('__serverCharacterShell')
    expect(hydration.json().character.chats[0].message).toEqual([])
    expect(hydration.json().character.chats[0]).not.toHaveProperty('hypaV3Data')
  })

  it('rejects import with missing database field', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/import/risusave',
      headers: { 'risu-auth': assertion },
      payload: {},
    })
    expect(res.statusCode).toBe(400)
  })

  it('bumps revision on each successive import', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const first = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/import/risusave',
      headers: { 'risu-auth': assertion },
      payload: { database: { v: 1 } },
    })
    expect(first.json().revision).toBe(1)

    const second = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/import/risusave',
      headers: { 'risu-auth': assertion },
      payload: { database: { v: 2 } },
    })
    expect(second.json().revision).toBe(2)

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.json().revision).toBe(2)
    expect(bootstrap.json().database).toMatchObject({
      v: 2,
      characters: [],
      botPresets: [],
      modules: [],
      loadouts: [],
      plugins: [],
      pluginCustomStorage: {},
    })
  })

  it('masks provider secrets in bootstrap without changing persisted data', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const sample = {
      openAIKey: 'sk-openai',
      aiModel: 'gpt4o-chatgpt',
      OaiCompAPIKeys: { deepseek: 'ds-key' },
      customModels: [
        {
          id: 'xcustom:::a',
          name: 'custom',
          key: 'custom-key',
          url: 'https://example.com/v1',
        },
      ],
      authRefreshes: [
        {
          url: 'https://mcp.example.com',
          tokenUrl: 'https://mcp.example.com/token',
          refreshToken: 'refresh-secret',
          clientId: 'client-id',
          clientSecret: 'client-secret',
        },
      ],
      google: { accessToken: 'gemini-secret', projectId: 'project-a' },
      hordeConfig: { apiKey: 'horde-key', model: 'horde-model' },
      novelai: { token: 'novel-token', model: 'clio-v1' },
      openaiCompatImage: { url: 'https://image.example.com', key: 'image-key' },
      wavespeedImage: { key: 'wavespeed-key', model: 'speedy' },
      characters: [{ chaId: 'char-a', name: 'Ada', chats: [] }],
    }

    const imported = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/import/risusave',
      headers: { 'risu-auth': assertion },
      payload: { database: sample },
    })
    expect(imported.statusCode).toBe(200)

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.statusCode).toBe(200)
    expect(bootstrap.json().database).toMatchObject({
      openAIKey: MASKED_PROVIDER_SECRET,
      OaiCompAPIKeys: { deepseek: MASKED_PROVIDER_SECRET },
      customModels: [{ ...sample.customModels[0], key: MASKED_PROVIDER_SECRET }],
      authRefreshes: [
        {
          ...sample.authRefreshes[0],
          refreshToken: MASKED_PROVIDER_SECRET,
          clientSecret: MASKED_PROVIDER_SECRET,
        },
      ],
      google: { accessToken: MASKED_PROVIDER_SECRET, projectId: 'project-a' },
      hordeConfig: { apiKey: MASKED_PROVIDER_SECRET, model: 'horde-model' },
      novelai: { token: MASKED_PROVIDER_SECRET, model: 'clio-v1' },
      openaiCompatImage: { url: 'https://image.example.com', key: MASKED_PROVIDER_SECRET },
      wavespeedImage: { key: MASKED_PROVIDER_SECRET, model: 'speedy' },
    })
    expectNormalizedAdaDatabase(bootstrap.json().database)

    const secretsDb = openDatabase(harness.dataDir)
    try {
      const onDisk = loadPersisted(secretsDb, harness.dataDir)
      expectNormalizedAdaDatabase(onDisk.database, {
        openAIKey: 'sk-openai',
        aiModel: 'gpt4o-chatgpt',
        OaiCompAPIKeys: { deepseek: 'ds-key' },
      })
    } finally {
      secretsDb.close()
    }
  })

  it('masks nested preset and character-owned secrets in bootstrap', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const sample = {
      openAIKey: 'sk-top-level',
      botPresetsId: 0,
      botPresets: [
        {
          id: 'preset-a',
          name: 'Preset A',
          openAIKey: 'sk-preset-key',
          proxyKey: 'proxy-preset-key',
          aiModel: 'gpt4o-chatgpt',
        },
        {
          id: 'preset-b',
          name: 'Preset B',
          openAIKey: '',
        },
      ],
      characters: [
        {
          chaId: 'char-a',
          name: 'Ada',
          chats: [],
          oaiVoice: 'alloy',
          oaiTTSConfig: {
            enabled: true,
            baseURL: 'https://api.openai.com/v1',
            apiKey: 'sk-tts-key',
            model: 'tts-1',
          },
        },
      ],
    }

    const imported = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/import/risusave',
      headers: { 'risu-auth': assertion },
      payload: { database: sample },
    })
    expect(imported.statusCode).toBe(200)

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.statusCode).toBe(200)
    expect(bootstrap.json().database).toMatchObject({
      openAIKey: MASKED_PROVIDER_SECRET,
      botPresets: [
        {
          ...sample.botPresets[0],
          openAIKey: MASKED_PROVIDER_SECRET,
          proxyKey: MASKED_PROVIDER_SECRET,
        },
        { ...sample.botPresets[1] },
      ],
      characters: [
        {
          ...sample.characters[0],
          oaiTTSConfig: {
            ...sample.characters[0].oaiTTSConfig,
            apiKey: MASKED_PROVIDER_SECRET,
          },
        },
      ],
    })
    expectNormalizedAdaDatabase(bootstrap.json().database)

    const nestedDb = openDatabase(harness.dataDir)
    try {
      const onDisk = loadPersisted(nestedDb, harness.dataDir)
      expectNormalizedAdaDatabase(onDisk.database, {
        openAIKey: 'sk-top-level',
        botPresetsId: 0,
      })
    } finally {
      nestedDb.close()
    }
  })
})
