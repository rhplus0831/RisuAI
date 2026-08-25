import { createHash, webcrypto } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { getSchemaState, openDatabase } from '../src/db.js'
import { applyImport } from '../src/repository.js'
import { normalizeRisuSaveSnapshotDatabase } from '../src/risuSave/importSnapshot.js'
import { subscribeProtocolMetrics } from '../src/protocolMetrics.js'
import { assertScopedLoadOnHotPath } from './helpers/loadCostHarness.js'

const subtle = webcrypto.subtle

interface Harness {
  app: FastifyInstance
  dataDir: string
}

async function startHarness(): Promise<Harness> {
  process.env.LOG_LEVEL = 'silent'
  const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-display-source-'))
  const { app } = await buildApp({
    config: {
      host: '127.0.0.1',
      port: 0,
      dataDir,
      bodyLimit: 8 * 1024 * 1024,
      importMaxBytes: Infinity,
      trustProxy: false,
      hubUrl: 'https://sv.risuai.xyz',
    },
    memoryWorker: false,
    assetGc: false,
  })
  return { app, dataDir }
}

async function signAssertion(privateKey: CryptoKey, publicJwk: JsonWebKey): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const headerB64 = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'JWT' })).toString('base64url')
  const payloadB64 = Buffer.from(JSON.stringify({ iat: now, exp: now + 60, pub: publicJwk })).toString('base64url')
  const signingInput = `${headerB64}.${payloadB64}`
  const signature = await subtle.sign(
    { name: 'ECDSA', hash: { name: 'SHA-256' } },
    privateKey,
    Buffer.from(signingInput),
  )
  return `${signingInput}.${Buffer.from(signature).toString('base64url')}`
}

async function setupAuthedClient(app: FastifyInstance): Promise<string> {
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
  return signAssertion(keypair.privateKey, publicKey)
}

function sourceHash(source: string): string {
  return createHash('sha256').update(source).digest('hex')
}

let harness: Harness

beforeEach(async () => {
  harness = await startHarness()
})

afterEach(async () => {
  await harness.app.close()
  rmSync(harness.dataDir, { recursive: true, force: true })
})

describe('POST /api/v1/chats/:chatId/display-sources', () => {
  it('keeps Lua scriptstate ephemeral within each target and never persists display-time state', async () => {
    const assertion = await setupAuthedClient(harness.app)
    const db = openDatabase(harness.dataDir)
    const seeded = await applyImport(
      db,
      harness.dataDir,
      normalizeRisuSaveSnapshotDatabase({
        currentChar: 0,
        characters: [
          {
            type: 'character',
            name: 'Tess',
            chaId: 'char-1',
            chatPage: 0,
            triggerscript: [
              {
                comment: 'display lua',
                type: 'display',
                conditions: [],
                effect: [
                  {
                    type: 'triggerlua',
                    code: `
                      listenEdit('editDisplay', function(id, data, meta)
                        local before = getChatVar(id, 'choice')
                        setChatVar(id, 'choice', data)
                        local after = getChatVar(id, 'choice')
                        return data .. ' [before=' .. before .. ', after=' .. after .. ']'
                      end)
                    `,
                  },
                ],
              },
            ],
            chats: [
              {
                id: 'chat-1',
                name: 'Chat',
                note: '',
                localLore: [],
                scriptstate: { $choice: 'seed' },
                message: [
                  { role: 'char', data: 'hello', chatId: 'message-1' },
                  { role: 'char', data: 'world', chatId: 'message-2' },
                ],
              },
            ],
          },
        ],
      }),
    )
    db.close()

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion, 'risu-writer-session': 'writer-a' },
    })
    expect(bootstrap.statusCode).toBe(200)
    const runtime = bootstrap.json() as { writerEpoch: number; databaseLineage: string }
    const source = 'hello'
    const request = {
      protocolVersion: 1,
      baseRevision: seeded.revision,
      context: { pageSessionId: 'page-a', screenWidth: 800, screenHeight: 600, browserLanguage: 'en-US' },
      targets: [
        {
          requestKey: 'request-a',
          characterId: 'char-1',
          messageId: 'message-1',
          index: 0,
          role: 'char',
          firstMessage: false,
          layer: 'original',
          source,
          sourceHash: sourceHash(source),
          projectionEpoch: 1,
        },
        {
          requestKey: 'request-b',
          characterId: 'char-1',
          messageId: 'message-2',
          index: 1,
          role: 'char',
          firstMessage: false,
          layer: 'original',
          source: 'world',
          sourceHash: sourceHash('world'),
          projectionEpoch: 2,
        },
      ],
    }
    const observedMetrics: Array<Readonly<Record<string, unknown>>> = []
    const previousMetrics = process.env.RISU_PROTOCOL_METRICS
    process.env.RISU_PROTOCOL_METRICS = '1'
    const unsubscribeMetrics = subscribeProtocolMetrics((metric) => observedMetrics.push(metric))
    let response
    let cachedResponse
    try {
      const sendRequest = () =>
        harness.app.inject({
          method: 'POST',
          url: '/api/v1/chats/chat-1/display-sources',
          // The route is a read-only POST; a stale writer header must not gate display projection.
          headers: { 'risu-auth': assertion, 'risu-writer-session': 'writer-old' },
          payload: request,
        })
      response = await assertScopedLoadOnHotPath(sendRequest, {
        allowTables: ['modules', 'prompt_presets', 'personas'],
      })
      cachedResponse = await assertScopedLoadOnHotPath(sendRequest, {
        allowTables: ['modules', 'prompt_presets', 'personas'],
      })
    } finally {
      unsubscribeMetrics()
      if (previousMetrics === undefined) delete process.env.RISU_PROTOCOL_METRICS
      else process.env.RISU_PROTOCOL_METRICS = previousMetrics
    }

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      protocolVersion: 1,
      revision: seeded.revision,
      contextFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u),
      entries: [
        {
          requestKey: 'request-a',
          status: 'ok',
          sourceHash: sourceHash(source),
          displaySource: 'hello [before=seed, after=hello]',
          dependencyFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u),
        },
        {
          requestKey: 'request-b',
          status: 'ok',
          sourceHash: sourceHash('world'),
          displaySource: 'world [before=seed, after=world]',
          dependencyFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u),
        },
      ],
    })
    expect(cachedResponse.statusCode).toBe(200)
    const batchMetrics = observedMetrics.filter((metric) => metric.metric === 'display_source_batch')
    expect(batchMetrics).toHaveLength(2)
    expect(batchMetrics[0]).toMatchObject({
      queueDepth: 0,
      transcriptMessageCount: 2,
      batchCacheHitCount: 0,
      batchCacheMissCount: 2,
      batchInflightJoinCount: 0,
      streamingBypassCount: 0,
      scopeLoadMs: expect.any(Number),
      sharedDependencyMs: expect.any(Number),
      targetFingerprintMs: expect.any(Number),
    })
    expect(batchMetrics[1]).toMatchObject({ batchCacheHitCount: 2, batchCacheMissCount: 0 })

    const persistedDb = openDatabase(harness.dataDir)
    try {
      const row = persistedDb.prepare('SELECT data_json FROM chats WHERE id = ?').get('chat-1') as {
        data_json: string
      }
      const persistedChat = JSON.parse(row.data_json) as Record<string, unknown>
      expect(persistedChat.scriptstate).toEqual({ $choice: 'seed' })
      expect(JSON.stringify(persistedChat)).not.toContain('before=seed')
      expect(getSchemaState(persistedDb).revision).toBe(seeded.revision)
    } finally {
      persistedDb.close()
    }

    expect(runtime.writerEpoch).toBeGreaterThanOrEqual(1)
    expect(runtime.databaseLineage).toEqual(expect.any(String))
  })

  it('validates strict source hashes', async () => {
    const assertion = await setupAuthedClient(harness.app)
    await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion, 'risu-writer-session': 'writer-new' },
    })

    const malformed = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/chats/chat-1/display-sources',
      headers: { 'risu-auth': assertion, 'risu-writer-session': 'writer-new' },
      payload: {
        protocolVersion: 1,
        baseRevision: 0,
        context: { pageSessionId: 'page-a' },
        targets: [
          {
            requestKey: 'request-a',
            characterId: 'char-1',
            index: 0,
            role: 'char',
            firstMessage: false,
            layer: 'original',
            source: 'body',
            sourceHash: 'not-a-hash',
            projectionEpoch: 1,
          },
        ],
      },
    })
    expect(malformed.statusCode).toBe(400)
  })
})
