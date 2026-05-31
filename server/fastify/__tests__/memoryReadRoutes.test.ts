import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { webcrypto } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { openDatabase } from '../src/db.js'
import {
  createMemoryChunk,
  createMemorySummary,
  type MemoryChunk,
  type MemorySummary,
} from '../src/memoryRepository.js'

const subtle = webcrypto.subtle

interface Harness {
  app: FastifyInstance
  dataDir: string
}

async function startHarness(): Promise<Harness> {
  process.env.LOG_LEVEL = 'silent'
  const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-fastify-memory-read-routes-'))
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

  return { assertion: await signAssertion(keypair.privateKey, publicKey) }
}

function seedMemoryRows(dataDir: string): void {
  const db = openDatabase(dataDir)
  try {
    createMemoryChunk(db, {
      id: 'chunk-later',
      chatId: 'chat-1',
      messageId: 'msg-3',
      rangeStartSeq: 20,
      rangeEndSeq: 29,
      text: 'later chunk text',
      status: 'pending',
    })
    createMemoryChunk(db, {
      id: 'chunk-first',
      chatId: 'chat-1',
      messageId: 'msg-1',
      rangeStartSeq: 0,
      rangeEndSeq: 9,
      text: 'first chunk text',
      status: 'summarized',
    })
    createMemoryChunk(db, {
      id: 'chunk-middle',
      chatId: 'chat-1',
      messageId: 'msg-2',
      rangeStartSeq: 10,
      rangeEndSeq: 19,
      text: 'middle chunk text',
      status: 'summarized',
    })
    createMemoryChunk(db, {
      id: 'chunk-other-chat',
      chatId: 'chat-2',
      rangeStartSeq: 0,
      rangeEndSeq: 4,
      text: 'other chat chunk text',
    })
    createMemorySummary(db, {
      id: 'summary-a',
      chatId: 'chat-1',
      chunkId: 'chunk-first',
      model: 'model-a',
      text: 'first summary',
      metadata: { chatMemos: ['msg-1'] },
      tokens: 3,
    })
    createMemorySummary(db, {
      id: 'summary-b',
      chatId: 'chat-1',
      chunkId: 'chunk-middle',
      model: 'model-b',
      text: 'middle summary',
      tokens: 4,
    })
    createMemorySummary(db, {
      id: 'summary-c',
      chatId: 'chat-2',
      chunkId: 'chunk-other-chat',
      model: 'model-a',
      text: 'other chat summary',
      tokens: 5,
    })
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
  await stopHarness(harness)
})

describe('Phase 8-7a memory read routes', () => {
  it('rejects memory read routes without auth when a password is set', async () => {
    for (const url of ['/api/v1/memory/chunks/chat-1', '/api/v1/memory/summaries/chat-1']) {
      const res = await harness.app.inject({ method: 'GET', url })
      expect(res.statusCode, url).toBe(401)
    }
  })

  it('lists chunks for one chat in repository order', async () => {
    seedMemoryRows(harness.dataDir)

    const res = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/memory/chunks/chat-1',
      headers: { 'risu-auth': assertion },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json() as { chunks: MemoryChunk[] }
    expect(body.chunks.map((chunk) => chunk.id)).toEqual([
      'chunk-first',
      'chunk-middle',
      'chunk-later',
    ])
    expect(body.chunks).toMatchObject([
      {
        id: 'chunk-first',
        chatId: 'chat-1',
        messageId: 'msg-1',
        rangeStartSeq: 0,
        rangeEndSeq: 9,
        text: 'first chunk text',
        status: 'summarized',
      },
      {
        id: 'chunk-middle',
        chatId: 'chat-1',
        messageId: 'msg-2',
        rangeStartSeq: 10,
        rangeEndSeq: 19,
        text: 'middle chunk text',
        status: 'summarized',
      },
      {
        id: 'chunk-later',
        chatId: 'chat-1',
        messageId: 'msg-3',
        rangeStartSeq: 20,
        rangeEndSeq: 29,
        text: 'later chunk text',
        status: 'pending',
      },
    ])
  })

  it('lists summaries for one chat and supports model filtering', async () => {
    seedMemoryRows(harness.dataDir)

    const all = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/memory/summaries/chat-1',
      headers: { 'risu-auth': assertion },
    })
    expect(all.statusCode).toBe(200)
    const allSummaries = (all.json() as { summaries: MemorySummary[] }).summaries
    expect(allSummaries.map((summary) => summary.id)).toEqual(['summary-a', 'summary-b'])
    expect(allSummaries).toMatchObject([
      {
        id: 'summary-a',
        chatId: 'chat-1',
        chunkId: 'chunk-first',
        model: 'model-a',
        text: 'first summary',
        metadata: { chatMemos: ['msg-1'] },
        tokens: 3,
      },
      {
        id: 'summary-b',
        chatId: 'chat-1',
        chunkId: 'chunk-middle',
        model: 'model-b',
        text: 'middle summary',
        metadata: null,
        tokens: 4,
      },
    ])

    const filtered = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/memory/summaries/chat-1?model=model-a',
      headers: { 'risu-auth': assertion },
    })
    expect(filtered.statusCode).toBe(200)
    expect((filtered.json() as { summaries: MemorySummary[] }).summaries).toMatchObject([
      { id: 'summary-a', chatId: 'chat-1', model: 'model-a' },
    ])
  })

  it('returns empty arrays for chats with no chunks or summaries', async () => {
    seedMemoryRows(harness.dataDir)

    const chunks = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/memory/chunks/missing-chat',
      headers: { 'risu-auth': assertion },
    })
    expect(chunks.statusCode).toBe(200)
    expect(chunks.json()).toEqual({ chunks: [] })

    const summaries = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/memory/summaries/chat-1?model=missing-model',
      headers: { 'risu-auth': assertion },
    })
    expect(summaries.statusCode).toBe(200)
    expect(summaries.json()).toEqual({ summaries: [] })
  })

  it('validates malformed summary filters', async () => {
    const res = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/memory/summaries/chat-1?model=',
      headers: { 'risu-auth': assertion },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'model must be a non-empty string when provided' })
  })

  it('accepts authenticated memory read requests', async () => {
    seedMemoryRows(harness.dataDir)

    const chunks = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/memory/chunks/chat-1',
      headers: { 'risu-auth': assertion },
    })
    expect(chunks.statusCode).toBe(200)
    expect((chunks.json() as { chunks: MemoryChunk[] }).chunks).toHaveLength(3)

    const summaries = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/memory/summaries/chat-1?model=model-b',
      headers: { 'risu-auth': assertion },
    })
    expect(summaries.statusCode).toBe(200)
    expect((summaries.json() as { summaries: MemorySummary[] }).summaries).toMatchObject([
      { id: 'summary-b', model: 'model-b' },
    ])
  })
})
