import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { webcrypto } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import * as fflate from 'fflate'
import { buildApp } from '../src/app.js'
import { loadPersisted } from '../src/repository.js'

const subtle = webcrypto.subtle

interface CapturedRequest {
  method: string
  url: string
  headers: http.IncomingHttpHeaders
  body: Buffer
}

interface EchoServer {
  url: string
  requests: CapturedRequest[]
  setResponder(
    fn: (req: http.IncomingMessage, res: http.ServerResponse, body: Buffer) => void | Promise<void>,
  ): void
  close(): Promise<void>
}

function startEcho(): Promise<EchoServer> {
  return new Promise((resolve) => {
    const requests: CapturedRequest[] = []
    let responder: (
      req: http.IncomingMessage,
      res: http.ServerResponse,
      body: Buffer,
    ) => void | Promise<void> = (_req, res) => {
      res.writeHead(404)
      res.end()
    }
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => {
        const body = Buffer.concat(chunks)
        requests.push({
          method: req.method ?? '',
          url: req.url ?? '',
          headers: req.headers,
          body,
        })
        void Promise.resolve(responder(req, res, body)).catch(() => {
          if (!res.headersSent) res.writeHead(500)
          res.end()
        })
      })
    })
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        requests,
        setResponder(fn) {
          responder = fn
        },
        close() {
          return new Promise((r) => server.close(() => r()))
        },
      })
    })
  })
}

interface Harness {
  app: FastifyInstance
  dataDir: string
}

async function startHarness(upstreamUrl: string): Promise<Harness> {
  process.env.LOG_LEVEL = 'silent'
  const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-fastify-realm-import-'))
  const { app } = await buildApp({
    config: {
      host: '127.0.0.1',
      port: 0,
      dataDir,
      bodyLimit: 1024 * 1024,
      trustProxy: false,
      hubUrl: upstreamUrl,
      realmUrl: upstreamUrl,
    },
    assetGc: false,
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
  return `${signingInput}.${Buffer.from(signature).toString('base64url')}`
}

async function setupAuthedClient(app: FastifyInstance): Promise<{ assertion: string }> {
  await app.inject({
    method: 'POST',
    url: '/api/v1/auth/setup',
    payload: { password: 'hunter2' },
  })
  const keypair = (await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair
  const publicKey = await subtle.exportKey('jwk', keypair.publicKey)
  await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { password: 'hunter2', publicKey },
  })
  return { assertion: await signAssertion(keypair.privateKey, publicKey) }
}

async function importEmptyDatabase(app: FastifyInstance, assertion: string): Promise<number> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/import/risusave',
    headers: { 'risu-auth': assertion, 'risu-writer-session': 'writer-a' },
    payload: { database: { characters: [], characterOrder: [], currentChar: -1 } },
  })
  expect(res.statusCode).toBe(200)
  return res.json().revision as number
}

function realmCard(options: { lowLevelAccess?: boolean } = {}) {
  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: 'Realm Utility',
      description: 'does useful things',
      personality: 'helpful',
      scenario: 'testing',
      first_mes: 'hello',
      mes_example: '',
      creator_notes: '',
      system_prompt: '',
      post_history_instructions: '',
      alternate_greetings: [],
      tags: ['utility'],
      creator: 'tester',
      character_version: '1',
      extensions: {
        risuai: {
          emotions: [['happy', 'emotion-img']],
          additionalAssets: [['theme', 'theme-css', 'theme.css']],
          vits: { 'voice.wav': 'voice-wav' },
          lowLevelAccess: options.lowLevelAccess,
        },
      },
      character_book: {
        scan_depth: 5,
        token_budget: 800,
        recursive_scanning: true,
        extensions: {},
        entries: [],
      },
    },
  }
}

function realmCharx(): Uint8Array {
  const card = {
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: {
      name: 'Realm CharX',
      description: 'packed character',
      personality: '',
      scenario: '',
      first_mes: 'hello from charx',
      mes_example: '',
      creator_notes: '',
      system_prompt: '',
      post_history_instructions: '',
      alternate_greetings: [],
      tags: [],
      creator: '',
      character_version: '1',
      extensions: { risuai: {} },
      assets: [
        { type: 'icon', uri: 'embeded://assets/main.png', name: 'main', ext: 'png' },
        { type: 'emotion', uri: 'embeded://assets/happy.png', name: 'happy', ext: 'png' },
        { type: 'x-risu-asset', uri: '__asset:assets/theme.css', name: 'theme', ext: 'css' },
      ],
    },
  }
  return fflate.zipSync(
    {
      'card.json': new TextEncoder().encode(JSON.stringify(card)),
      'assets/main.png': new TextEncoder().encode('main image'),
      'assets/happy.png': new TextEncoder().encode('happy image'),
      'assets/theme.css': new TextEncoder().encode('body { color: red; }'),
    },
    { level: 0 },
  )
}

function jpegPrefixedRealmCharx(): Uint8Array {
  const prefix = Buffer.alloc(128, 0x20)
  prefix.set(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]))
  const zip = realmCharx()
  const bytes = new Uint8Array(prefix.byteLength + zip.byteLength)
  bytes.set(prefix)
  bytes.set(zip, prefix.byteLength)
  return bytes
}

function manyDisplayAssetRealmCharx(assetCount: number): Uint8Array {
  const assets = Array.from({ length: assetCount }, (_, index) => ({
    type: 'x-risu-asset',
    uri: `__asset:assets/display/display-${index}.png`,
    name: `display-${index}`,
    ext: 'png',
  }))
  const card = {
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: {
      name: 'Realm Many Assets',
      description: 'packed character with many display assets',
      personality: '',
      scenario: '',
      first_mes: 'hello from many assets',
      mes_example: '',
      creator_notes: '',
      system_prompt: '',
      post_history_instructions: '',
      alternate_greetings: [],
      tags: [],
      creator: '',
      character_version: '1',
      extensions: { risuai: {} },
      assets: [
        { type: 'icon', uri: 'embeded://assets/main.png', name: 'main', ext: 'png' },
        ...assets,
      ],
    },
  }
  const files: Record<string, Uint8Array> = {
    'card.json': new TextEncoder().encode(JSON.stringify(card)),
    'assets/main.png': new TextEncoder().encode('main image'),
  }
  for (let i = 0; i < assetCount; i += 1) {
    files[`assets/display/display-${i}.png`] = new TextEncoder().encode(`display image ${i}`)
    files[`x_meta/display-${i}.json`] = new TextEncoder().encode('{"ok":true}')
  }
  return fflate.zipSync(files, { level: 0 })
}

let harness: Harness
let echo: EchoServer

beforeEach(async () => {
  echo = await startEcho()
  harness = await startHarness(echo.url)
})

afterEach(async () => {
  await stopHarness(harness)
  await echo.close()
})

describe('Realm character import route', () => {
  it('fetches Realm assets server-side and creates the character in one client request', async () => {
    echo.setResponder((req, res) => {
      if (req.url?.startsWith('/api/v1/download/dynamic/realm-id')) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ card: realmCard(), img: 'main-img' }))
        return
      }
      if (req.url === '/resource/main-img') {
        res.writeHead(200, { 'content-type': 'image/png' })
        res.end('main image')
        return
      }
      if (req.url === '/resource/emotion-img') {
        res.writeHead(200, { 'content-type': 'image/png' })
        res.end('emotion image')
        return
      }
      if (req.url === '/resource/theme-css') {
        res.writeHead(200, { 'content-type': 'text/css' })
        res.end('body { color: red; }')
        return
      }
      if (req.url === '/resource/voice-wav') {
        res.writeHead(200, { 'content-type': 'audio/wav' })
        res.end('voice data')
        return
      }
      res.writeHead(404)
      res.end()
    })

    const { assertion } = await setupAuthedClient(harness.app)
    const baseRevision = await importEmptyDatabase(harness.app, assertion)

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/import/realm-character',
      headers: { 'risu-auth': assertion, 'risu-writer-session': 'writer-a' },
      payload: { id: 'realm-id', baseRevision },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().event).toMatchObject({ type: 'character.created', resource: 'character' })
    expect(echo.requests.map((req) => req.url)).toEqual([
      '/api/v1/download/dynamic/realm-id?cors=true',
      '/resource/main-img',
      '/resource/emotion-img',
      '/resource/theme-css',
      '/resource/voice-wav',
    ])

    const persisted = loadPersisted(harness.dataDir)
    expect(persisted.assets).toHaveLength(4)
    expect(persisted.assets.map((asset) => asset.contentType).sort()).toEqual([
      'audio/wav',
      'image/png',
      'image/png',
      'text/css',
    ])
    const character = (persisted.database as { characters: Array<Record<string, unknown>> })
      .characters[0]
    expect(character.name).toBe('Realm Utility')
    expect(character.image).toMatch(/^[a-f0-9]{64}$/)
    expect(character.emotionImages).toEqual([['happy', expect.stringMatching(/^[a-f0-9]{64}$/)]])
    expect(character.additionalAssets).toEqual([
      ['theme', expect.stringMatching(/^[a-f0-9]{64}$/), 'theme.css'],
    ])
    expect(character.vits).toMatchObject({
      files: { 'voice.wav': expect.stringMatching(/^[a-f0-9]{64}$/) },
    })
  })

  it('requires explicit confirmation before importing low-level-access cards', async () => {
    echo.setResponder((req, res) => {
      if (req.url?.startsWith('/api/v1/download/dynamic/realm-id')) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ card: realmCard({ lowLevelAccess: true }), img: 'main-img' }))
        return
      }
      res.writeHead(404)
      res.end()
    })

    const { assertion } = await setupAuthedClient(harness.app)
    const baseRevision = await importEmptyDatabase(harness.app, assertion)

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/import/realm-character',
      headers: { 'risu-auth': assertion, 'risu-writer-session': 'writer-a' },
      payload: { id: 'realm-id', baseRevision },
    })

    expect(res.statusCode).toBe(409)
    expect(res.json()).toMatchObject({ code: 'low_level_access_confirmation_required' })
    expect(loadPersisted(harness.dataDir).assets).toHaveLength(0)
    expect(echo.requests.map((req) => req.url)).toEqual([
      '/api/v1/download/dynamic/realm-id?cors=true',
    ])
  })

  it('imports Realm charx packages server-side without falling back to client asset uploads', async () => {
    echo.setResponder((req, res) => {
      if (req.url?.startsWith('/api/v1/download/dynamic/realm-id')) {
        res.writeHead(200, { 'content-type': 'application/charx' })
        res.end(Buffer.from(realmCharx()))
        return
      }
      res.writeHead(404)
      res.end()
    })

    const { assertion } = await setupAuthedClient(harness.app)
    const baseRevision = await importEmptyDatabase(harness.app, assertion)

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/import/realm-character',
      headers: { 'risu-auth': assertion, 'risu-writer-session': 'writer-a' },
      payload: { id: 'realm-id', baseRevision },
    })

    expect(res.statusCode).toBe(200)
    expect(echo.requests.map((req) => req.url)).toEqual([
      '/api/v1/download/dynamic/realm-id?cors=true',
    ])

    const persisted = loadPersisted(harness.dataDir)
    expect(persisted.assets).toHaveLength(3)
    expect(persisted.assets.map((asset) => asset.contentType).sort()).toEqual([
      'image/png',
      'image/png',
      'text/css',
    ])
    const character = (persisted.database as { characters: Array<Record<string, unknown>> })
      .characters[0]
    expect(character.name).toBe('Realm CharX')
    expect(character.image).toMatch(/^[a-f0-9]{64}$/)
    expect(character.emotionImages).toEqual([['happy', expect.stringMatching(/^[a-f0-9]{64}$/)]])
    expect(character.additionalAssets).toEqual([
      ['theme', expect.stringMatching(/^[a-f0-9]{64}$/), 'css'],
    ])
  })

  it('imports JPEG-prefixed Realm charx packages', async () => {
    echo.setResponder((req, res) => {
      if (req.url?.startsWith('/api/v1/download/dynamic/realm-id')) {
        res.writeHead(200, { 'content-type': 'application/charx' })
        res.end(Buffer.from(jpegPrefixedRealmCharx()))
        return
      }
      res.writeHead(404)
      res.end()
    })

    const { assertion } = await setupAuthedClient(harness.app)
    const baseRevision = await importEmptyDatabase(harness.app, assertion)

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/import/realm-character',
      headers: { 'risu-auth': assertion, 'risu-writer-session': 'writer-a' },
      payload: { id: 'realm-id', baseRevision },
    })

    expect(res.statusCode).toBe(200)

    const persisted = loadPersisted(harness.dataDir)
    const character = (persisted.database as { characters: Array<Record<string, unknown>> })
      .characters[0]
    expect(character.name).toBe('Realm CharX')
    expect(persisted.assets).toHaveLength(3)
  })

  it('imports Realm charx packages with thousands of display assets', async () => {
    echo.setResponder((req, res) => {
      if (req.url?.startsWith('/api/v1/download/dynamic/realm-id')) {
        res.writeHead(200, { 'content-type': 'application/charx' })
        res.end(Buffer.from(manyDisplayAssetRealmCharx(7000)))
        return
      }
      res.writeHead(404)
      res.end()
    })

    const { assertion } = await setupAuthedClient(harness.app)
    const baseRevision = await importEmptyDatabase(harness.app, assertion)

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/import/realm-character',
      headers: { 'risu-auth': assertion, 'risu-writer-session': 'writer-a' },
      payload: { id: 'realm-id', baseRevision },
    })

    expect(res.statusCode).toBe(200)
    const persisted = loadPersisted(harness.dataDir)
    expect(persisted.assets).toHaveLength(7001)
    const character = (persisted.database as { characters: Array<Record<string, unknown>> })
      .characters[0]
    expect(character.name).toBe('Realm Many Assets')
    expect(character.additionalAssets).toHaveLength(7000)
  }, 30000)
})
