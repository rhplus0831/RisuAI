import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { webcrypto } from 'node:crypto'
import { buildApp } from '../src/app.js'
import { CURRENT_SCHEMA_VERSION } from '../src/db.js'
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

let harness: Harness

beforeEach(async () => {
  harness = await startHarness()
})

afterEach(async () => {
  await stopHarness(harness)
})

function expectNormalizedAdaDatabase(
  database: unknown,
  expected: Record<string, unknown> = {},
): void {
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
  it('returns empty database on a fresh data dir (no password)', async () => {
    const res = await harness.app.inject({ method: 'GET', url: '/api/v1/bootstrap' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      revision: 0,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      database: null,
      assetBaseUrl: '/api/v1/assets',
      // Durable generation (Milestone 1): empty when no generation is in flight.
      activeGenerationJobs: [],
    })
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

    expect(existsSync(path.join(harness.dataDir, 'db.json'))).toBe(true)
    const onDisk = JSON.parse(readFileSync(path.join(harness.dataDir, 'db.json'), 'utf8'))
    expect(onDisk._version).toBe(1)
    expect(onDisk.assets).toEqual([])
    expectNormalizedAdaDatabase(onDisk.database, { greeting: 'hi' })

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

    // db.json on disk is message-free: the chat exists but carries no message[].
    const onDisk = JSON.parse(readFileSync(path.join(harness.dataDir, 'db.json'), 'utf8'))
    const onDiskChat = onDisk.database.characters[0].chats[0]
    expect(onDiskChat.id).toBe('chat-1')
    expect(onDiskChat.message).toBeUndefined()

    // The messages live as rows in the SQLite messages table.
    const db = new DatabaseSync(path.join(harness.dataDir, 'risu.db'))
    try {
      const rows = db
        .prepare('SELECT chat_id, seq, uid, data FROM messages ORDER BY seq')
        .all() as { chat_id: string; seq: number; uid: string; data: string }[]
      expect(rows).toEqual([
        { chat_id: 'chat-1', seq: 0, uid: 'm1', data: 'hello' },
        { chat_id: 'chat-1', seq: 1, uid: 'm2', data: 'hi there' },
      ])
    } finally {
      db.close()
    }

    // Phase 4.3: the bootstrap projection ships a chat STUB — metadata present,
    // message[] empty. The client hydrates messages on open.
    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.statusCode).toBe(200)
    const stubChat = bootstrap.json().database.characters[0].chats[0]
    expect(stubChat.id).toBe('chat-1')
    expect(stubChat.message).toEqual([])

    // The per-chat hydration endpoint serves the real messages on open.
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
    })
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

    const onDisk = JSON.parse(readFileSync(path.join(harness.dataDir, 'db.json'), 'utf8'))
    expectNormalizedAdaDatabase(onDisk.database, {
      openAIKey: 'sk-openai',
      aiModel: 'gpt4o-chatgpt',
      OaiCompAPIKeys: { deepseek: 'ds-key' },
    })
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

    const onDisk = JSON.parse(readFileSync(path.join(harness.dataDir, 'db.json'), 'utf8'))
    expectNormalizedAdaDatabase(onDisk.database, {
      openAIKey: 'sk-top-level',
      botPresetsId: 0,
    })
  })
})
