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
      importMaxBytes: Infinity,
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

function seedPagedMemoryRows(dataDir: string, count: number): void {
  const db = openDatabase(dataDir)
  try {
    db.exec('BEGIN')
    for (let index = 0; index < count; index += 1) {
      const suffix = String(index).padStart(4, '0')
      createMemoryChunk(db, {
        id: `paged-chunk-${suffix}`,
        chatId: 'paged-chat',
        rangeStartSeq: index * 2,
        rangeEndSeq: index * 2 + 1,
        text: `chunk ${index}`,
        status: 'summarized',
      })
      createMemorySummary(db, {
        id: `paged-summary-${suffix}`,
        chatId: 'paged-chat',
        chunkId: `paged-chunk-${suffix}`,
        model: index < 205 ? 'paged-model' : 'other-model',
        text: `summary ${index}`,
        tokens: index,
      })
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  } finally {
    db.close()
  }
}

function seedLegacyCeilingRows(dataDir: string): void {
  const db = openDatabase(dataDir)
  try {
    const chunk = db.prepare(`
      INSERT INTO memory_chunks (
        id, chat_id, range_start_seq, range_end_seq, text, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'summarized', ?, ?)
    `)
    const summary = db.prepare(`
      INSERT INTO memory_summaries (id, chat_id, chunk_id, model, text, tokens, created_at)
      VALUES (?, ?, ?, 'legacy-model', ?, ?, ?)
    `)
    db.exec('BEGIN')
    for (const [chatId, count] of [
      ['legacy-exact', 1_000],
      ['legacy-over', 1_001],
    ] as const) {
      for (let index = 0; index < count; index += 1) {
        const suffix = String(index).padStart(4, '0')
        const chunkId = `${chatId}-chunk-${suffix}`
        const timestamp = `2026-01-01T00:${String(Math.floor(index / 60) % 60).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.000Z`
        chunk.run(chunkId, chatId, index, index, `chunk ${index}`, timestamp, timestamp)
        summary.run(`${chatId}-summary-${suffix}`, chatId, chunkId, `summary ${index}`, index, timestamp)
      }
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  } finally {
    db.close()
  }
}

function seedOrphanedSummaryRows(dataDir: string): void {
  const db = openDatabase(dataDir)
  try {
    createMemoryChunk(db, {
      id: 'orphan-order-live-chunk',
      chatId: 'orphan-order-chat',
      rangeStartSeq: 9,
      rangeEndSeq: 10,
      text: 'live chunk',
      status: 'summarized',
    })
    createMemorySummary(db, {
      id: 'orphan-order-live-summary',
      chatId: 'orphan-order-chat',
      chunkId: 'orphan-order-live-chunk',
      model: 'orphan-model',
      text: 'live summary',
      tokens: 1,
    })
    db.exec('PRAGMA foreign_keys = OFF')
    const insert = db.prepare(`
      INSERT INTO memory_summaries (id, chat_id, chunk_id, model, text, tokens, created_at)
      VALUES (?, 'orphan-order-chat', ?, 'orphan-model', ?, 1, ?)
    `)
    insert.run('orphan-order-summary-a', 'missing-chunk-a', 'orphan a', '2026-01-02T00:00:00.000Z')
    insert.run('orphan-order-summary-b', 'missing-chunk-b', 'orphan b', '2026-01-02T00:00:00.000Z')
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
    expect(body.chunks.map((chunk) => chunk.id)).toEqual(['chunk-first', 'chunk-middle', 'chunk-later'])
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

  it('pages every chunk and filtered summary in stable keyset order', async () => {
    seedPagedMemoryRows(harness.dataDir, 213)

    const drain = async (path: string, key: 'chunks' | 'summaries') => {
      const rows: Array<{ id: string }> = []
      const pageSizes: number[] = []
      let cursor: string | null = null
      do {
        const separator = path.includes('?') ? '&' : '?'
        const res = await harness.app.inject({
          method: 'GET',
          url: `${path}${separator}limit=73${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
          headers: { 'risu-auth': assertion },
        })
        expect(res.statusCode).toBe(200)
        const body = res.json() as Record<string, unknown>
        const page = body[key] as Array<{ id: string }>
        pageSizes.push(page.length)
        rows.push(...page)
        cursor = body.nextCursor as string | null
      } while (cursor)
      return { rows, pageSizes }
    }

    const chunks = await drain('/api/v1/memory/chunks/paged-chat', 'chunks')
    expect(chunks.rows).toHaveLength(213)
    expect(new Set(chunks.rows.map((row) => row.id)).size).toBe(213)
    expect(chunks.rows.map((row) => row.id)).toEqual(
      Array.from({ length: 213 }, (_, index) => `paged-chunk-${String(index).padStart(4, '0')}`),
    )
    expect(Math.max(...chunks.pageSizes)).toBeLessThanOrEqual(73)

    const summaries = await drain('/api/v1/memory/summaries/paged-chat?model=paged-model', 'summaries')
    expect(summaries.rows).toHaveLength(205)
    expect(new Set(summaries.rows.map((row) => row.id)).size).toBe(205)
    expect(summaries.rows.map((row) => row.id)).toEqual(
      Array.from({ length: 205 }, (_, index) => `paged-summary-${String(index).padStart(4, '0')}`),
    )
    expect(Math.max(...summaries.pageSizes)).toBeLessThanOrEqual(73)

    const terminal = await harness.app.inject({
      method: 'GET',
      url:
        '/api/v1/memory/chunks/paged-chat?limit=200&cursor=' +
        encodeURIComponent(
          (
            await harness.app.inject({
              method: 'GET',
              url: '/api/v1/memory/chunks/paged-chat?limit=200',
              headers: { 'risu-auth': assertion },
            })
          ).json().nextCursor,
        ),
      headers: { 'risu-auth': assertion },
    })
    expect(terminal.statusCode).toBe(200)
    expect(terminal.json()).toMatchObject({ nextCursor: null })
  })

  it('keeps live summaries before orphaned summaries across one-row pages', async () => {
    seedOrphanedSummaryRows(harness.dataDir)
    const ids: string[] = []
    let cursor: string | null = null
    do {
      const res = await harness.app.inject({
        method: 'GET',
        url:
          '/api/v1/memory/summaries/orphan-order-chat?model=orphan-model&limit=1' +
          (cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''),
        headers: { 'risu-auth': assertion },
      })
      expect(res.statusCode).toBe(200)
      ids.push(res.json().summaries[0].id)
      cursor = res.json().nextCursor as string | null
    } while (cursor)

    expect(ids).toEqual(['orphan-order-live-summary', 'orphan-order-summary-a', 'orphan-order-summary-b'])
  })

  it('rejects invalid limits and cursors before serving a page', async () => {
    seedPagedMemoryRows(harness.dataDir, 3)
    for (const limit of ['0', '-1', '1.5', '201']) {
      const res = await harness.app.inject({
        method: 'GET',
        url: `/api/v1/memory/chunks/paged-chat?limit=${encodeURIComponent(limit)}`,
        headers: { 'risu-auth': assertion },
      })
      expect(res.statusCode, limit).toBe(400)
    }
    for (const cursor of ['not-json', 'a'.repeat(513)]) {
      const res = await harness.app.inject({
        method: 'GET',
        url: `/api/v1/memory/chunks/paged-chat?limit=2&cursor=${cursor}`,
        headers: { 'risu-auth': assertion },
      })
      expect(res.statusCode, cursor.slice(0, 20)).toBe(400)
    }

    const firstChunks = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/memory/chunks/paged-chat?limit=1',
      headers: { 'risu-auth': assertion },
    })
    const chunkCursor = firstChunks.json().nextCursor as string
    const firstSummaries = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/memory/summaries/paged-chat?model=paged-model&limit=1',
      headers: { 'risu-auth': assertion },
    })
    const summaryCursor = firstSummaries.json().nextCursor as string
    const mismatches = [
      `/api/v1/memory/chunks/other-chat?limit=1&cursor=${encodeURIComponent(chunkCursor)}`,
      `/api/v1/memory/summaries/paged-chat?model=other-model&limit=1&cursor=${encodeURIComponent(summaryCursor)}`,
      `/api/v1/memory/summaries/paged-chat?model=paged-model&limit=1&cursor=${encodeURIComponent(chunkCursor)}`,
      `/api/v1/memory/chunks/paged-chat?limit=1&cursor=${encodeURIComponent(summaryCursor)}`,
      `/api/v1/memory/chunks/paged-chat?cursor=${encodeURIComponent(chunkCursor)}`,
    ]
    for (const url of mismatches) {
      const res = await harness.app.inject({ method: 'GET', url, headers: { 'risu-auth': assertion } })
      expect(res.statusCode, url).toBe(400)
    }
  })

  it('keeps legacy envelopes through 1,000 rows and returns 413 at 1,001', async () => {
    seedLegacyCeilingRows(harness.dataDir)
    for (const [path, key] of [
      ['/api/v1/memory/chunks', 'chunks'],
      ['/api/v1/memory/summaries', 'summaries'],
    ] as const) {
      const exact = await harness.app.inject({
        method: 'GET',
        url: `${path}/legacy-exact`,
        headers: { 'risu-auth': assertion },
      })
      expect(exact.statusCode, path).toBe(200)
      expect(exact.json()[key], path).toHaveLength(1_000)
      expect(exact.json(), path).not.toHaveProperty('nextCursor')

      const over = await harness.app.inject({
        method: 'GET',
        url: `${path}/legacy-over`,
        headers: { 'risu-auth': assertion },
      })
      expect(over.statusCode, path).toBe(413)
      expect(over.json(), path).toEqual({ error: 'memory_read_requires_pagination', maxRows: 1_000 })
    }
  })

  it('edits summary text and Important metadata without discarding job metadata', async () => {
    seedMemoryRows(harness.dataDir)

    const edited = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/memory/summaries/summary-a',
      headers: { 'risu-auth': assertion },
      payload: {
        text: 'edited first summary',
        isImportant: true,
        categoryId: 'story',
        tags: [' favorite ', 'favorite', 'plot'],
      },
    })

    expect(edited.statusCode).toBe(200)
    expect((edited.json() as { summary: MemorySummary }).summary).toMatchObject({
      id: 'summary-a',
      text: 'edited first summary',
      tokens: 0,
      metadata: {
        chatMemos: ['msg-1'],
        isImportant: true,
        categoryId: 'story',
        tags: ['favorite', 'plot'],
      },
    })

    const cleared = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/memory/summaries/summary-a',
      headers: { 'risu-auth': assertion },
      payload: { isImportant: false, categoryId: null, tags: null },
    })
    expect(cleared.statusCode).toBe(200)
    expect((cleared.json() as { summary: MemorySummary }).summary.metadata).toEqual({
      chatMemos: ['msg-1'],
      isImportant: false,
    })
  })

  it('returns compact summary mutation responses when requested', async () => {
    seedMemoryRows(harness.dataDir)

    const edited = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/memory/summaries/summary-a',
      headers: { 'risu-auth': assertion, prefer: 'return=minimal' },
      payload: { tags: [' favorite ', 'favorite', ' plot '] },
    })

    expect(edited.statusCode).toBe(200)
    expect(edited.headers['preference-applied']).toBe('return=minimal')
    expect(edited.json()).toEqual({ summaryId: 'summary-a' })

    const summaries = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/memory/summaries/chat-1',
      headers: { 'risu-auth': assertion },
    })
    const stored = (summaries.json() as { summaries: MemorySummary[] }).summaries.find(
      (summary) => summary.id === 'summary-a',
    )
    expect(stored?.metadata).toEqual({ chatMemos: ['msg-1'], tags: ['favorite', 'plot'] })

    const deleted = await harness.app.inject({
      method: 'DELETE',
      url: '/api/v1/memory/summaries/summary-a',
      headers: { 'risu-auth': assertion, prefer: 'return=minimal' },
    })
    expect(deleted.statusCode).toBe(200)
    expect(deleted.headers['preference-applied']).toBe('return=minimal')
    expect(deleted.json()).toEqual({ summaryId: 'summary-a' })
  })

  it('deletes one server summary and leaves its chunk available for later regeneration', async () => {
    seedMemoryRows(harness.dataDir)

    const deleted = await harness.app.inject({
      method: 'DELETE',
      url: '/api/v1/memory/summaries/summary-a',
      headers: { 'risu-auth': assertion },
    })
    expect(deleted.statusCode).toBe(200)
    expect((deleted.json() as { summary: MemorySummary }).summary.id).toBe('summary-a')

    const summaries = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/memory/summaries/chat-1',
      headers: { 'risu-auth': assertion },
    })
    expect((summaries.json() as { summaries: MemorySummary[] }).summaries.map((summary) => summary.id)).toEqual([
      'summary-b',
    ])

    const chunks = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/memory/chunks/chat-1',
      headers: { 'risu-auth': assertion },
    })
    expect((chunks.json() as { chunks: MemoryChunk[] }).chunks.map((chunk) => chunk.id)).toContain('chunk-first')
  })

  it('validates summary mutations and returns 404 for missing rows', async () => {
    seedMemoryRows(harness.dataDir)

    const invalid = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/memory/summaries/summary-a',
      headers: { 'risu-auth': assertion },
      payload: { isImportant: 'yes' },
    })
    expect(invalid.statusCode).toBe(400)

    const missing = await harness.app.inject({
      method: 'DELETE',
      url: '/api/v1/memory/summaries/missing',
      headers: { 'risu-auth': assertion },
    })
    expect(missing.statusCode).toBe(404)
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
