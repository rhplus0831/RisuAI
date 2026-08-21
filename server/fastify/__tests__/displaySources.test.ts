import { createHash, webcrypto } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { openDatabase } from '../src/db.js'
import { applyImport } from '../src/repository.js'
import { normalizeRisuSaveSnapshotDatabase } from '../src/risuSave/importSnapshot.js'

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
  it('runs the intermediate transform, commits Lua scriptstate once, and never persists displaySource', async () => {
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
            customscript: [{ comment: '', in: 'hello', out: 'hi', type: 'editdisplay' }],
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
                        setChatVar(id, 'choice', 'updated')
                        return data .. ' [lua]'
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
                message: [{ role: 'char', data: 'hello', chatId: 'message-1' }],
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
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/chats/chat-1/display-sources',
      headers: { 'risu-auth': assertion, 'risu-writer-session': 'writer-a' },
      payload: {
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
        ],
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      protocolVersion: 1,
      revision: seeded.revision + 1,
      contextFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u),
      entries: [
        {
          requestKey: 'request-a',
          status: 'ok',
          sourceHash: sourceHash(source),
          displaySource: 'hi [lua]',
          dependencyFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u),
        },
      ],
    })

    const persistedDb = openDatabase(harness.dataDir)
    try {
      const row = persistedDb.prepare('SELECT data_json FROM chats WHERE id = ?').get('chat-1') as {
        data_json: string
      }
      const persistedChat = JSON.parse(row.data_json) as Record<string, unknown>
      expect(persistedChat.scriptstate).toEqual({ $choice: 'updated' })
      expect(JSON.stringify(persistedChat)).not.toContain('hi [lua]')
    } finally {
      persistedDb.close()
    }

    expect(runtime.writerEpoch).toBeGreaterThanOrEqual(1)
    expect(runtime.databaseLineage).toEqual(expect.any(String))
  })

  it('requires the active writer and validates strict source hashes', async () => {
    const assertion = await setupAuthedClient(harness.app)
    await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion, 'risu-writer-session': 'writer-new' },
    })

    const stale = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/chats/chat-1/display-sources',
      headers: { 'risu-auth': assertion, 'risu-writer-session': 'writer-old' },
      payload: {},
    })
    expect(stale.statusCode).toBe(423)

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
