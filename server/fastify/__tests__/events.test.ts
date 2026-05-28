import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { webcrypto } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import {
  InMemoryCommandEventSink,
  createCommandEventSink,
  type CommandEvent,
  type CommandEventListener,
  type CommandEventSink,
} from '../src/commands/events.js'
import {
  createMemoryEventBus,
  type MemoryEvent,
  type MemoryEventSink,
} from '../src/memoryEvents.js'

const subtle = webcrypto.subtle

class TrackingCommandEventSink implements CommandEventSink {
  private readonly inner = createCommandEventSink()
  activeListeners = 0

  emit(event: CommandEvent): void {
    this.inner.emit(event)
  }

  list(): readonly CommandEvent[] {
    return this.inner.list()
  }

  clear(): void {
    this.inner.clear()
  }

  subscribe(listener: CommandEventListener): () => void {
    this.activeListeners++
    const unsubscribeInner = this.inner.subscribe(listener)
    return () => {
      unsubscribeInner()
      this.activeListeners--
    }
  }
}

interface Harness {
  app: FastifyInstance
  dataDir: string
  commandEvents: TrackingCommandEventSink
}

async function startHarness(opts: { memoryEvents?: MemoryEventSink } = {}): Promise<Harness> {
  process.env.LOG_LEVEL = 'silent'
  const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-fastify-events-'))
  const commandEvents = new TrackingCommandEventSink()
  const { app } = await buildApp({
    config: {
      host: '127.0.0.1',
      port: 0,
      dataDir,
      bodyLimit: 1024 * 1024,
      trustProxy: false,
      hubUrl: 'https://sv.risuai.xyz',
    },
    commandEvents,
    memoryEvents: opts.memoryEvents,
    memoryWorker: false,
  })
  return { app, dataDir, commandEvents }
}

async function stopHarness(h: Harness): Promise<void> {
  await h.app.close()
  rmSync(h.dataDir, { recursive: true, force: true })
}

async function listen(app: FastifyInstance): Promise<string> {
  await app.listen({ host: '127.0.0.1', port: 0 })
  const address = app.server.address() as AddressInfo
  return `http://127.0.0.1:${address.port}`
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

async function importDatabase(
  app: FastifyInstance,
  assertion: string,
  database: Record<string, unknown>,
): Promise<number> {
  const imported = await app.inject({
    method: 'POST',
    url: '/api/v1/import/risusave',
    headers: { 'risu-auth': assertion },
    payload: { database },
  })
  expect(imported.statusCode).toBe(200)
  return imported.json().revision as number
}

async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  predicate: (text: string) => boolean,
): Promise<string> {
  const deadline = Date.now() + 2_000
  let text = ''
  while (Date.now() < deadline) {
    const result = await Promise.race([
      reader.read(),
      new Promise<ReadableStreamReadResult<Uint8Array>>((_, reject) =>
        setTimeout(() => reject(new Error('timed out waiting for SSE data')), 250),
      ),
    ])
    if (result.done) break
    text += Buffer.from(result.value).toString('utf8')
    if (predicate(text)) return text
  }
  throw new Error(`timed out waiting for SSE data; received ${JSON.stringify(text)}`)
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('timed out waiting for condition')
}

let harness: Harness

beforeEach(async () => {
  harness = await startHarness()
})

afterEach(async () => {
  await stopHarness(harness)
})

describe('Phase 9-5a command events stream', () => {
  it('bounds retained command event history while preserving live fanout', () => {
    const sink = new InMemoryCommandEventSink(2)
    const seen: CommandEvent[] = []
    sink.subscribe((event) => {
      seen.push(event)
    })

    const events: CommandEvent[] = [
      { type: 'settings.updated', revision: 1, resource: 'settings' },
      { type: 'preset.updated', revision: 2, resource: 'preset', id: 'preset-1' },
      { type: 'chat.updated', revision: 3, resource: 'chat', id: 'chat-1' },
    ]

    for (const event of events) {
      sink.emit(event)
    }

    expect(seen).toEqual(events)
    expect(sink.list()).toEqual(events.slice(1))

    sink.clear()
    expect(sink.list()).toEqual([])
  })

  it('keeps memory event bus delivery best-effort across throwing subscribers', () => {
    const bus = createMemoryEventBus()
    const event: MemoryEvent = {
      type: 'memory.job',
      chatId: 'chat-1',
      jobId: 'job-1',
      kind: 'summarize',
      status: 'pending',
      attemptCount: 0,
      maxAttempts: 3,
      nextRunAt: '2026-05-24T00:00:00.000Z',
      error: null,
    }
    const seen: MemoryEvent[] = []

    bus.subscribe(() => {
      throw new Error('memory subscriber exploded')
    })
    bus.subscribe((received) => {
      seen.push(received)
    })

    expect(() => bus.emit(event)).not.toThrow()
    expect(seen).toEqual([event])
  })

  it('rejects unauthenticated event streams once a password is set', async () => {
    await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/setup',
      payload: { password: 'hunter2' },
    })

    const res = await harness.app.inject({ method: 'GET', url: '/api/v1/events' })

    expect(res.statusCode).toBe(401)
    expect(res.json()).toEqual({ error: 'Auth required' })
  })

  it('sets up an authenticated SSE stream', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const baseUrl = await listen(harness.app)
    const abort = new AbortController()

    const res = await fetch(`${baseUrl}/api/v1/events`, {
      headers: { 'risu-auth': assertion },
      signal: abort.signal,
    })
    const reader = res.body?.getReader()
    expect(reader).toBeDefined()

    try {
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('text/event-stream')
      const text = await readUntil(reader!, (chunk) => chunk.includes(': connected\n\n'))
      expect(text).toContain(': connected\n\n')
    } finally {
      abort.abort()
      reader?.releaseLock()
    }
  })

  it('delivers command events from successful command mutations', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      useServerPromptAssembly: false,
    })
    const baseUrl = await listen(harness.app)
    const abort = new AbortController()

    const res = await fetch(`${baseUrl}/api/v1/events`, {
      headers: { 'risu-auth': assertion },
      signal: abort.signal,
    })
    const reader = res.body?.getReader()
    expect(reader).toBeDefined()
    await readUntil(reader!, (chunk) => chunk.includes(': connected\n\n'))

    const command = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/settings/runtime',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: revision, patch: { useServerPromptAssembly: true } },
    })
    expect(command.statusCode).toBe(200)

    try {
      const text = await readUntil(reader!, (chunk) => chunk.includes('settings.updated'))
      expect(text).toContain('event: command')
      const dataLine = text.split('\n').find((line) => line.startsWith('data: '))
      expect(dataLine).toBeDefined()
      expect(JSON.parse(dataLine!.slice('data: '.length))).toEqual({
        type: 'settings.updated',
        revision: 2,
        resource: 'settings',
      })
    } finally {
      abort.abort()
      reader?.releaseLock()
    }
  })

  it('delivers memory progress events from memory job mutations', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const baseUrl = await listen(harness.app)
    const abort = new AbortController()

    const res = await fetch(`${baseUrl}/api/v1/events`, {
      headers: { 'risu-auth': assertion },
      signal: abort.signal,
    })
    const reader = res.body?.getReader()
    expect(reader).toBeDefined()
    await readUntil(reader!, (chunk) => chunk.includes(': connected\n\n'))

    const memoryJob = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/memory/jobs',
      headers: { 'risu-auth': assertion },
      payload: {
        chatId: 'chat-1',
        kind: 'summarize',
        payload: { chunkId: 'chunk-1', model: 'model-a' },
      },
    })
    expect(memoryJob.statusCode).toBe(201)
    const jobId = memoryJob.json().job.id as string

    try {
      const text = await readUntil(reader!, (chunk) => chunk.includes('event: memory'))
      expect(text).toContain('event: memory')
      const dataLine = text.split('\n').find((line) => line.startsWith('data: '))
      expect(dataLine).toBeDefined()
      expect(JSON.parse(dataLine!.slice('data: '.length))).toMatchObject({
        type: 'memory.job',
        chatId: 'chat-1',
        jobId,
        kind: 'summarize',
        status: 'pending',
        attemptCount: 0,
        maxAttempts: 3,
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
      })
    } finally {
      abort.abort()
      reader?.releaseLock()
    }
  })

  it('continues memory SSE fanout when an external memory sink throws', async () => {
    await stopHarness(harness)
    harness = await startHarness({
      memoryEvents: () => {
        throw new Error('external memory sink exploded')
      },
    })

    const { assertion } = await setupAuthedClient(harness.app)
    const baseUrl = await listen(harness.app)
    const abort = new AbortController()

    const res = await fetch(`${baseUrl}/api/v1/events`, {
      headers: { 'risu-auth': assertion },
      signal: abort.signal,
    })
    const reader = res.body?.getReader()
    expect(reader).toBeDefined()
    await readUntil(reader!, (chunk) => chunk.includes(': connected\n\n'))

    const memoryJob = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/memory/jobs',
      headers: { 'risu-auth': assertion },
      payload: {
        chatId: 'chat-1',
        kind: 'summarize',
        payload: { chunkId: 'chunk-1', model: 'model-a' },
      },
    })
    expect(memoryJob.statusCode).toBe(201)
    const jobId = memoryJob.json().job.id as string

    try {
      const text = await readUntil(reader!, (chunk) => chunk.includes('event: memory'))
      expect(text).toContain('event: memory')
      const dataLine = text.split('\n').find((line) => line.startsWith('data: '))
      expect(dataLine).toBeDefined()
      expect(JSON.parse(dataLine!.slice('data: '.length))).toMatchObject({
        type: 'memory.job',
        chatId: 'chat-1',
        jobId,
        status: 'pending',
      })
    } finally {
      abort.abort()
      reader?.releaseLock()
    }
  })

  it('unsubscribes listeners when the stream closes', async () => {
    const baseUrl = await listen(harness.app)
    const abort = new AbortController()

    const res = await fetch(`${baseUrl}/api/v1/events`, { signal: abort.signal })
    const reader = res.body?.getReader()
    expect(reader).toBeDefined()
    await readUntil(reader!, (chunk) => chunk.includes(': connected\n\n'))
    expect(harness.commandEvents.activeListeners).toBe(1)

    abort.abort()
    await waitFor(() => harness.commandEvents.activeListeners === 0)
    reader?.releaseLock()
  })
})
