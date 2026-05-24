import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { webcrypto } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import type { MemoryEvent } from '../src/memoryEvents.js'
import type { MemoryJob } from '../src/memoryRepository.js'

const subtle = webcrypto.subtle

interface Harness {
  app: FastifyInstance
  dataDir: string
  events: MemoryEvent[]
}

async function startHarness(): Promise<Harness> {
  process.env.LOG_LEVEL = 'silent'
  const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-fastify-memory-jobs-routes-'))
  const events: MemoryEvent[] = []
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
    memoryEvents: (event) => events.push(event),
  })
  return { app, dataDir, events }
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

async function enqueue(app: FastifyInstance, payload: Record<string, unknown>): Promise<MemoryJob> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/memory/jobs',
    payload,
  })
  expect(res.statusCode).toBe(201)
  return (res.json() as { job: MemoryJob }).job
}

let harness: Harness

beforeEach(async () => {
  harness = await startHarness()
})

afterEach(async () => {
  await stopHarness(harness)
})

describe('Phase 8-2e memory job routes', () => {
  it('rejects all memory job routes without auth when a password is set', async () => {
    await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/setup',
      payload: { password: 'hunter2' },
    })

    for (const op of [
      { method: 'POST' as const, url: '/api/v1/memory/jobs', payload: {} },
      { method: 'GET' as const, url: '/api/v1/memory/jobs' },
      { method: 'DELETE' as const, url: '/api/v1/memory/jobs/job-1' },
    ]) {
      const res = await harness.app.inject(op)
      expect(res.statusCode, `${op.method} ${op.url}`).toBe(401)
    }
  })

  it('enqueues a pending job and emits a memory.job event', async () => {
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/memory/jobs',
      payload: {
        chatId: 'chat-1',
        kind: 'summarize',
        payload: { chunkId: 'chunk-1', model: 'model-a' },
        maxAttempts: 5,
        nextRunAt: '2026-05-24T00:00:00.000Z',
      },
    })

    expect(res.statusCode).toBe(201)
    const body = res.json() as { job: MemoryJob }
    expect(body.job).toMatchObject({
      chatId: 'chat-1',
      kind: 'summarize',
      status: 'pending',
      payload: { chunkId: 'chunk-1', model: 'model-a' },
      error: null,
      attemptCount: 0,
      maxAttempts: 5,
      nextRunAt: '2026-05-24T00:00:00.000Z',
    })
    expect(body.job.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )

    expect(harness.events).toEqual([
      {
        type: 'memory.job',
        chatId: 'chat-1',
        jobId: body.job.id,
        kind: 'summarize',
        status: 'pending',
        attemptCount: 0,
        maxAttempts: 5,
        nextRunAt: '2026-05-24T00:00:00.000Z',
        error: null,
        sideEffect: {
          kind: 'hypav3_progress',
          payload: {
            open: true,
            miniMsg: '1',
            msg: '[Hypa V3] Waiting to summarize...',
            subMsg: '1 queued',
            status: 'pending',
            queuedCount: 1,
          },
        },
      },
    ])
  })

  it('lists active jobs by default and supports chat, kind, and status filters', async () => {
    const chunkJob = await enqueue(harness.app, {
      chatId: 'chat-1',
      kind: 'chunk',
      payload: { reason: 'new-chat-row' },
    })
    const embedJob = await enqueue(harness.app, {
      chatId: 'chat-2',
      kind: 'embed',
      payload: { chunkId: 'chunk-2' },
    })
    await enqueue(harness.app, {
      chatId: 'chat-1',
      kind: 'summarize',
      payload: { chunkId: 'chunk-1' },
    })
    const cancel = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/memory/jobs/${chunkJob.id}`,
    })
    expect(cancel.statusCode).toBe(200)

    const active = await harness.app.inject({ method: 'GET', url: '/api/v1/memory/jobs' })
    expect(active.statusCode).toBe(200)
    const activeJobs = (active.json() as { jobs: MemoryJob[] }).jobs
    expect(activeJobs).toHaveLength(2)
    expect(activeJobs).toContainEqual(expect.objectContaining({ id: embedJob.id }))
    expect(activeJobs).toContainEqual(
      expect.objectContaining({ chatId: 'chat-1', kind: 'summarize' }),
    )

    const chatFiltered = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/memory/jobs?chatId=chat-1',
    })
    expect(chatFiltered.statusCode).toBe(200)
    expect((chatFiltered.json() as { jobs: MemoryJob[] }).jobs).toMatchObject([
      { chatId: 'chat-1', kind: 'summarize', status: 'pending' },
    ])

    const kindFiltered = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/memory/jobs?kind=embed',
    })
    expect(kindFiltered.statusCode).toBe(200)
    expect((kindFiltered.json() as { jobs: MemoryJob[] }).jobs).toMatchObject([
      { id: embedJob.id, chatId: 'chat-2', kind: 'embed', status: 'pending' },
    ])

    const cancelled = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/memory/jobs?status=cancelled',
    })
    expect(cancelled.statusCode).toBe(200)
    expect((cancelled.json() as { jobs: MemoryJob[] }).jobs).toMatchObject([
      { id: chunkJob.id, status: 'cancelled' },
    ])
  })

  it('cancels a pending job and emits the cancellation event', async () => {
    const job = await enqueue(harness.app, {
      chatId: 'chat-1',
      kind: 'chunk',
      payload: { reason: 'manual' },
    })
    harness.events.splice(0)

    const res = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/memory/jobs/${job.id}`,
    })

    expect(res.statusCode).toBe(200)
    expect((res.json() as { job: MemoryJob }).job).toMatchObject({
      id: job.id,
      chatId: 'chat-1',
      kind: 'chunk',
      status: 'cancelled',
      error: null,
    })
    expect(harness.events).toEqual([
      {
        type: 'memory.job',
        chatId: 'chat-1',
        jobId: job.id,
        kind: 'chunk',
        status: 'cancelled',
        attemptCount: 0,
        maxAttempts: 3,
        nextRunAt: expect.any(String),
        error: null,
        sideEffect: {
          kind: 'hypav3_progress',
          payload: {
            open: false,
            miniMsg: '',
            msg: '',
            subMsg: '',
            status: 'cancelled',
            queuedCount: 0,
          },
        },
      },
    ])

    const second = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/memory/jobs/${job.id}`,
    })
    expect(second.statusCode).toBe(404)
  })

  it('returns validation failures for malformed enqueue, list, and cancel requests', async () => {
    for (const payload of [
      null,
      { kind: 'chunk' },
      { chatId: '', kind: 'chunk' },
      { chatId: 'chat-1', kind: 'unknown' },
      { chatId: 'chat-1', kind: 'chunk', maxAttempts: 0 },
      { chatId: 'chat-1', kind: 'chunk', nextRunAt: 'not-a-date' },
    ]) {
      const res = await harness.app.inject({
        method: 'POST',
        url: '/api/v1/memory/jobs',
        payload,
      })
      expect(res.statusCode, JSON.stringify(payload)).toBe(400)
    }

    for (const url of [
      '/api/v1/memory/jobs?kind=unknown',
      '/api/v1/memory/jobs?status=unknown',
      '/api/v1/memory/jobs?chatId=',
    ]) {
      const res = await harness.app.inject({ method: 'GET', url })
      expect(res.statusCode, url).toBe(400)
    }

    const missing = await harness.app.inject({
      method: 'DELETE',
      url: '/api/v1/memory/jobs/no-such-job',
    })
    expect(missing.statusCode).toBe(404)
  })

  it('accepts authenticated memory job requests', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/memory/jobs',
      headers: { 'risu-auth': assertion },
      payload: {
        chatId: 'chat-1',
        kind: 'embed',
        payload: { chunkId: 'chunk-1' },
      },
    })
    expect(res.statusCode).toBe(201)

    const list = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/memory/jobs',
      headers: { 'risu-auth': assertion },
    })
    expect(list.statusCode).toBe(200)
    expect((list.json() as { jobs: MemoryJob[] }).jobs).toHaveLength(1)
  })
})
