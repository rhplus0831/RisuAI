import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { webcrypto } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { buildApp, type BuildAppOptions } from '../src/app.js'
import { openDatabase } from '../src/db.js'
import type { MemoryEvent, MemoryEventSink } from '../src/memoryEvents.js'
import { createMemoryJob, type MemoryJob } from '../src/memoryRepository.js'

const subtle = webcrypto.subtle

interface Harness {
  app: FastifyInstance
  dataDir: string
  events: MemoryEvent[]
}

async function startHarness(
  opts: {
    memoryEvents?: MemoryEventSink
    memoryWorker?: BuildAppOptions['memoryWorker']
    prepareDataDir?: (dataDir: string) => void
  } = {},
): Promise<Harness> {
  process.env.LOG_LEVEL = 'silent'
  const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-fastify-memory-jobs-routes-'))
  opts.prepareDataDir?.(dataDir)
  const events: MemoryEvent[] = []
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
    memoryWorker: opts.memoryWorker ?? false,
    memoryEvents: opts.memoryEvents ?? ((event) => events.push(event)),
  })
  return { app, dataDir, events }
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

async function enqueue(app: FastifyInstance, payload: Record<string, unknown>): Promise<MemoryJob> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/memory/jobs',
    headers: { 'risu-auth': assertion },
    payload,
  })
  expect(res.statusCode).toBe(201)
  return (res.json() as { job: MemoryJob }).job
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

describe('Phase 8-2e memory job routes', () => {
  it('rejects all memory job routes without auth when a password is set', async () => {
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
      headers: { 'risu-auth': assertion },
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
      instanceId: expect.any(String),
      chatId: 'chat-1',
      kind: 'summarize',
      status: 'pending',
      payload: { chunkId: 'chunk-1', model: 'model-a' },
      error: null,
      attemptCount: 0,
      maxAttempts: 5,
      nextRunAt: '2026-05-24T00:00:00.000Z',
    })
    expect(body.job.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)

    expect(harness.events).toEqual([
      {
        type: 'memory.job',
        streamId: expect.any(String),
        version: 1,
        chatId: 'chat-1',
        job: {
          id: body.job.id,
          instanceId: body.job.instanceId,
          kind: 'summarize',
          status: 'pending',
          attemptCount: 0,
          maxAttempts: 5,
          updatedAt: expect.any(String),
        },
      },
    ])
  })

  it('persists enqueue work when memory event delivery throws after mutation', async () => {
    await stopHarness(harness)
    harness = await startHarness({
      memoryEvents: () => {
        throw new Error('memory event sink exploded')
      },
    })
    ;({ assertion } = await setupAuthedClient(harness.app))

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/memory/jobs',
      headers: { 'risu-auth': assertion },
      payload: {
        chatId: 'chat-1',
        kind: 'summarize',
        payload: { chunkId: 'chunk-1', model: 'model-a' },
      },
    })

    expect(res.statusCode).toBe(201)
    const job = (res.json() as { job: MemoryJob }).job
    const listed = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/memory/jobs?chatId=chat-1',
      headers: { 'risu-auth': assertion },
    })
    expect(listed.statusCode).toBe(200)
    expect((listed.json() as { jobs: MemoryJob[] }).jobs).toMatchObject([
      { id: job.id, chatId: 'chat-1', kind: 'summarize', status: 'pending' },
    ])
  })

  it('lists active and recent terminal jobs by default and supports filters', async () => {
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
      headers: { 'risu-auth': assertion },
    })
    expect(cancel.statusCode).toBe(200)

    const active = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/memory/jobs',
      headers: { 'risu-auth': assertion },
    })
    expect(active.statusCode).toBe(200)
    const activeJobs = (active.json() as { jobs: MemoryJob[] }).jobs
    expect(activeJobs).toHaveLength(3)
    expect(activeJobs).toContainEqual(expect.objectContaining({ id: embedJob.id }))
    expect(activeJobs).toContainEqual(expect.objectContaining({ chatId: 'chat-1', kind: 'summarize' }))
    expect(activeJobs).toContainEqual(expect.objectContaining({ id: chunkJob.id, status: 'cancelled' }))
    expect(activeJobs[0]).not.toHaveProperty('payload')
    expect(active.headers.etag).toEqual(expect.any(String))
    expect(active.headers['x-risu-memory-stream-id']).toEqual(expect.any(String))
    expect(Number(active.headers['x-risu-memory-version'])).toBeGreaterThanOrEqual(4)

    const chatFiltered = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/memory/jobs?chatId=chat-1',
      headers: { 'risu-auth': assertion },
    })
    expect(chatFiltered.statusCode).toBe(200)
    expect((chatFiltered.json() as { jobs: MemoryJob[] }).jobs).toMatchObject([
      { chatId: 'chat-1', kind: 'summarize', status: 'pending' },
      { id: chunkJob.id, chatId: 'chat-1', kind: 'chunk', status: 'cancelled' },
    ])

    const kindFiltered = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/memory/jobs?kind=embed',
      headers: { 'risu-auth': assertion },
    })
    expect(kindFiltered.statusCode).toBe(200)
    expect((kindFiltered.json() as { jobs: MemoryJob[] }).jobs).toMatchObject([
      { id: embedJob.id, chatId: 'chat-2', kind: 'embed', status: 'pending' },
    ])

    const cancelled = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/memory/jobs?status=cancelled',
      headers: { 'risu-auth': assertion },
    })
    expect(cancelled.statusCode).toBe(200)
    expect((cancelled.json() as { jobs: MemoryJob[] }).jobs).toMatchObject([{ id: chunkJob.id, status: 'cancelled' }])

    const unchanged = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/memory/jobs',
      headers: { 'risu-auth': assertion, 'if-none-match': String(active.headers.etag) },
    })
    expect(unchanged.statusCode).toBe(304)
    expect(unchanged.body).toBe('')
    expect(unchanged.headers['x-risu-memory-stream-id']).toBe(active.headers['x-risu-memory-stream-id'])
    expect(unchanged.headers['x-risu-memory-version']).toBe(active.headers['x-risu-memory-version'])
  })

  it('returns a failed job with a bounded, redacted error and completion time', async () => {
    const db = openDatabase(harness.dataDir)
    try {
      createMemoryJob(db, {
        id: 'failed-job',
        chatId: 'chat-1',
        kind: 'summarize',
        payload: {},
        status: 'failed',
        error: 'upstream failed at https://provider.test?key=provider-secret',
        attemptCount: 3,
        maxAttempts: 3,
      })
    } finally {
      db.close()
    }

    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/memory/jobs?chatId=chat-1',
      headers: { 'risu-auth': assertion },
    })

    expect(response.statusCode).toBe(200)
    expect((response.json() as { jobs: MemoryJob[] }).jobs).toMatchObject([
      {
        id: 'failed-job',
        status: 'failed',
        error: 'upstream failed at https://provider.test?key=[redacted]',
        updatedAt: expect.any(String),
      },
    ])
  })

  it('L17: lists retained memory jobs after startup retention prunes old terminal rows', async () => {
    await stopHarness(harness)
    harness = await startHarness({
      memoryWorker: {
        pollIntervalMs: 10_000,
        terminalRetention: {
          now: '2026-06-06T00:00:00.000Z',
          retentionMs: 24 * 60 * 60 * 1000,
        },
      },
      prepareDataDir: (dataDir) => {
        const db = openDatabase(dataDir)
        try {
          createMemoryJob(db, {
            id: 'old-completed',
            chatId: 'chat-1',
            kind: 'chunk',
            payload: {},
            status: 'completed',
          })
          createMemoryJob(db, {
            id: 'recent-completed',
            chatId: 'chat-1',
            kind: 'chunk',
            payload: {},
            status: 'completed',
          })
          createMemoryJob(db, {
            id: 'pending-old',
            chatId: 'chat-1',
            kind: 'chunk',
            payload: {},
            nextRunAt: '2099-01-01T00:00:00.000Z',
            status: 'pending',
          })
          db.prepare(
            `
              UPDATE memory_jobs
              SET updated_at = '2026-06-01T00:00:00.000Z'
              WHERE id IN ('old-completed', 'pending-old')
            `,
          ).run()
          db.prepare(
            `
              UPDATE memory_jobs
              SET updated_at = '2026-06-05T12:00:00.000Z'
              WHERE id = 'recent-completed'
            `,
          ).run()
        } finally {
          db.close()
        }
      },
    })
    ;({ assertion } = await setupAuthedClient(harness.app))

    const active = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/memory/jobs',
      headers: { 'risu-auth': assertion },
    })
    expect(active.statusCode).toBe(200)
    expect((active.json() as { jobs: MemoryJob[] }).jobs).toMatchObject([
      {
        id: 'pending-old',
        chatId: 'chat-1',
        kind: 'chunk',
        status: 'pending',
      },
      {
        id: 'recent-completed',
        chatId: 'chat-1',
        kind: 'chunk',
        status: 'completed',
      },
    ])

    const completed = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/memory/jobs?status=completed',
      headers: { 'risu-auth': assertion },
    })
    expect(completed.statusCode).toBe(200)
    expect((completed.json() as { jobs: MemoryJob[] }).jobs).toMatchObject([
      {
        id: 'recent-completed',
        chatId: 'chat-1',
        kind: 'chunk',
        status: 'completed',
      },
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
      headers: { 'risu-auth': assertion },
    })

    expect(res.statusCode).toBe(200)
    expect((res.json() as { job: MemoryJob }).job).toMatchObject({
      id: job.id,
      instanceId: job.instanceId,
      chatId: 'chat-1',
      kind: 'chunk',
      status: 'cancelled',
      attemptCount: 0,
      maxAttempts: 3,
    })
    expect(harness.events).toEqual([
      {
        type: 'memory.job',
        streamId: expect.any(String),
        version: expect.any(Number),
        chatId: 'chat-1',
        job: {
          id: job.id,
          instanceId: job.instanceId,
          kind: 'chunk',
          status: 'cancelled',
          attemptCount: 0,
          maxAttempts: 3,
          error: null,
          updatedAt: expect.any(String),
        },
      },
    ])

    const second = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/memory/jobs/${job.id}`,
      headers: { 'risu-auth': assertion },
    })
    expect(second.statusCode).toBe(404)
  })

  it('aborts a running provider operation on cancellation and does not commit completion', async () => {
    await stopHarness(harness)
    let providerSignal: AbortSignal | null = null
    let markProviderStarted!: () => void
    const providerStarted = new Promise<void>((resolve) => {
      markProviderStarted = resolve
    })
    let markProviderSettled!: () => void
    const providerSettled = new Promise<void>((resolve) => {
      markProviderSettled = resolve
    })
    harness = await startHarness({
      memoryWorker: {
        pollIntervalMs: 10_000,
        handlers: {
          summarize: async (_job, context) => {
            providerSignal = context.signal
            markProviderStarted()
            await new Promise<void>((resolve) => {
              if (context.signal.aborted) {
                resolve()
                return
              }
              context.signal.addEventListener('abort', () => resolve(), { once: true })
            })
            markProviderSettled()
          },
        },
      },
    })
    ;({ assertion } = await setupAuthedClient(harness.app))
    const job = await enqueue(harness.app, {
      chatId: 'chat-provider',
      kind: 'summarize',
      payload: { chunkId: 'chunk-provider' },
    })
    await providerStarted

    const cancelled = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/memory/jobs/${job.id}`,
      headers: { 'risu-auth': assertion },
    })
    expect(cancelled.statusCode).toBe(200)
    expect(providerSignal).not.toBeNull()
    expect(providerSignal!.aborted).toBe(true)
    await providerSettled

    const listed = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/memory/jobs?chatId=chat-provider&status=cancelled`,
      headers: { 'risu-auth': assertion },
    })
    expect((listed.json() as { jobs: MemoryJob[] }).jobs).toMatchObject([
      { id: job.id, instanceId: job.instanceId, status: 'cancelled' },
    ])
    expect(harness.events.map((event) => event.job.status)).toEqual(['pending', 'running', 'cancelled'])
  })

  it('returns validation failures for malformed enqueue, list, and cancel requests', async () => {
    for (const payload of [
      null as unknown as undefined,
      { kind: 'chunk' },
      { chatId: '', kind: 'chunk' },
      { chatId: 'chat-1', kind: 'unknown' },
      { chatId: 'chat-1', kind: 'chunk', maxAttempts: 0 },
      { chatId: 'chat-1', kind: 'chunk', nextRunAt: 'not-a-date' },
    ]) {
      const res = await harness.app.inject({
        method: 'POST',
        url: '/api/v1/memory/jobs',
        headers: { 'risu-auth': assertion },
        payload,
      })
      expect(res!.statusCode, JSON.stringify(payload)).toBe(400)
    }

    for (const url of [
      '/api/v1/memory/jobs?kind=unknown',
      '/api/v1/memory/jobs?status=unknown',
      '/api/v1/memory/jobs?chatId=',
    ]) {
      const res = await harness.app.inject({
        method: 'GET',
        url,
        headers: { 'risu-auth': assertion },
      })
      expect(res.statusCode, url).toBe(400)
    }

    const missing = await harness.app.inject({
      method: 'DELETE',
      url: '/api/v1/memory/jobs/no-such-job',
      headers: { 'risu-auth': assertion },
    })
    expect(missing.statusCode).toBe(404)
  })
})
