import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { webcrypto } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { DatabaseSync } from 'node:sqlite'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import {
  InMemoryCommandEventSink,
  createCommandEventSink,
  listPersistedCommandEventHistory,
  persistCommandEvent,
  selectPersistedCommandEventReplay,
  type CommandEvent,
  type CommandEventListener,
  type CommandEventSink,
} from '../src/commands/events.js'
import { bumpRevision, openDatabase } from '../src/db.js'
import { createMemoryEventBus, type MemoryEvent, type MemoryEventSink } from '../src/memoryEvents.js'

const subtle = webcrypto.subtle

class TrackingCommandEventSink implements CommandEventSink {
  private readonly inner = createCommandEventSink()
  activeListeners = 0
  onBeforeSubscribe?: () => void

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
    this.onBeforeSubscribe?.()
    const unsubscribeInner = this.inner.subscribe(listener)
    this.activeListeners++
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
  closed: boolean
}

async function startHarness(opts: { dataDir?: string; memoryEvents?: MemoryEventSink } = {}): Promise<Harness> {
  process.env.LOG_LEVEL = 'silent'
  const dataDir = opts.dataDir ?? mkdtempSync(path.join(tmpdir(), 'risu-fastify-events-'))
  const commandEvents = new TrackingCommandEventSink()
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
    commandEvents,
    memoryEvents: opts.memoryEvents,
    memoryWorker: false,
  })
  return { app, dataDir, commandEvents, closed: false }
}

async function stopHarness(h: Harness, removeDataDir = true): Promise<void> {
  if (!h.closed) {
    await h.app.close()
    h.closed = true
  }
  if (removeDataDir) {
    rmSync(h.dataDir, { recursive: true, force: true })
  }
}

async function listen(app: FastifyInstance): Promise<string> {
  await app.listen({ host: '127.0.0.1', port: 0 })
  const address = app.server.address() as AddressInfo
  return `http://127.0.0.1:${address.port}`
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

function clearPersistedCommandEvents(dataDir: string): void {
  const db = new DatabaseSync(path.join(dataDir, 'risu.db'))
  try {
    db.exec('DELETE FROM command_events')
  } finally {
    db.close()
  }
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

  it('bounds persisted command event history while preserving contiguous replay', () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-fastify-event-history-'))
    const db = openDatabase(dataDir)
    try {
      persistCommandEvent(db, { type: 'settings.updated', revision: 1, resource: 'settings' }, 2)
      persistCommandEvent(db, { type: 'preset.updated', revision: 2, resource: 'preset' }, 2)
      persistCommandEvent(db, { type: 'chat.updated', revision: 3, resource: 'chat' }, 2)

      expect(listPersistedCommandEventHistory(db)).toEqual([
        { type: 'preset.updated', revision: 2, resource: 'preset' },
        { type: 'chat.updated', revision: 3, resource: 'chat' },
      ])
      expect(selectPersistedCommandEventReplay(db, 2, 3)).toEqual({
        status: 'ok',
        events: [{ type: 'chat.updated', revision: 3, resource: 'chat' }],
      })
      expect(selectPersistedCommandEventReplay(db, 0, 3)).toEqual({
        status: 'unavailable',
        currentRevision: 3,
        oldestRevision: 2,
        latestRevision: 3,
      })
    } finally {
      db.close()
      rmSync(dataDir, { recursive: true, force: true })
    }
  })

  it('L8: prunes by revision keep-window with a bounded range delete, not an OFFSET walk', () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-fastify-event-prune-'))
    const db = openDatabase(dataDir)
    try {
      // Contiguous case: identical retention to the former keep-latest-N-rows
      // walk — the newest `historyLimit` revisions survive.
      for (let revision = 1; revision <= 5; revision++) {
        persistCommandEvent(db, { type: 'settings.updated', revision, resource: 'settings' }, 3)
      }
      expect(listPersistedCommandEventHistory(db).map((event) => event.revision)).toEqual([3, 4, 5])

      // Keep-window semantics: retention is the revision window ending at the
      // just-persisted revision (12 - 3 = 9; everything <= 9 is deleted), not
      // a count of surviving rows. One range DELETE bounds the work.
      persistCommandEvent(db, { type: 'settings.updated', revision: 12, resource: 'settings' }, 3)
      expect(listPersistedCommandEventHistory(db).map((event) => event.revision)).toEqual([12])

      // Below the window nothing is deleted (negative threshold is a no-op).
      persistCommandEvent(db, { type: 'settings.updated', revision: 13, resource: 'settings' }, 1000)
      expect(listPersistedCommandEventHistory(db).map((event) => event.revision)).toEqual([12, 13])
    } finally {
      db.close()
      rmSync(dataDir, { recursive: true, force: true })
    }
  })

  it('keeps memory event bus delivery best-effort across throwing subscribers', () => {
    const bus = createMemoryEventBus()
    const event: MemoryEvent = {
      type: 'memory.job',
      chatId: 'chat-1',
      job: {
        id: 'job-1',
        kind: 'summarize',
        status: 'pending',
        attemptCount: 0,
        maxAttempts: 3,
      },
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
      streamGeminiThoughts: false,
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
      payload: { baseRevision: revision, patch: { streamGeminiThoughts: true } },
    })
    expect(command.statusCode).toBe(200)

    try {
      const text = await readUntil(reader!, (chunk) => chunk.includes('settings.updated'))
      expect(text).toContain('id: 2')
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

  it('replays retained command events after the requested revision', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      streamGeminiThoughts: false,
    })
    const command = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/settings/runtime',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: revision, patch: { streamGeminiThoughts: true } },
    })
    expect(command.statusCode).toBe(200)
    const nextRevision = command.json().revision as number

    const baseUrl = await listen(harness.app)
    const abort = new AbortController()
    const res = await fetch(`${baseUrl}/api/v1/events?sinceRevision=${revision}`, {
      headers: { 'risu-auth': assertion },
      signal: abort.signal,
    })
    const reader = res.body?.getReader()
    expect(reader).toBeDefined()

    try {
      expect(res.status).toBe(200)
      const text = await readUntil(reader!, (chunk) => chunk.includes('settings.updated'))
      expect(text).toContain(`id: ${nextRevision}`)
      expect(text).toContain('event: command')
      const dataLine = text.split('\n').find((line) => line.startsWith('data: '))
      expect(dataLine).toBeDefined()
      expect(JSON.parse(dataLine!.slice('data: '.length))).toEqual({
        type: 'settings.updated',
        revision: nextRevision,
        resource: 'settings',
      })
    } finally {
      abort.abort()
      reader?.releaseLock()
    }
  })

  it('replays the writer-session origin so reconnect keeps own-echo suppression (L29)', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      streamGeminiThoughts: false,
    })
    // Claim the writer session, then mutate as that writer.
    const boot = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion, 'risu-writer-session': 'writer-l29' },
    })
    expect(boot.statusCode).toBe(200)
    const command = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/settings/runtime',
      headers: { 'risu-auth': assertion, 'risu-writer-session': 'writer-l29' },
      payload: { baseRevision: revision, patch: { streamGeminiThoughts: true } },
    })
    expect(command.statusCode).toBe(200)
    const nextRevision = command.json().revision as number

    // The origin persists with the event row...
    const db = new DatabaseSync(path.join(harness.dataDir, 'risu.db'))
    try {
      const persisted = listPersistedCommandEventHistory(db).find((event) => event.revision === nextRevision)
      expect(persisted?.origin).toEqual({ writerSessionId: 'writer-l29' })
    } finally {
      db.close()
    }

    // ...and a reconnect replay carries it, identical to the live emit.
    const baseUrl = await listen(harness.app)
    const abort = new AbortController()
    const res = await fetch(`${baseUrl}/api/v1/events?sinceRevision=${revision}`, {
      headers: { 'risu-auth': assertion },
      signal: abort.signal,
    })
    const reader = res.body?.getReader()
    expect(reader).toBeDefined()
    try {
      const text = await readUntil(reader!, (chunk) => chunk.includes('settings.updated'))
      const dataLine = text.split('\n').find((line) => line.startsWith('data: '))
      expect(dataLine).toBeDefined()
      expect(JSON.parse(dataLine!.slice('data: '.length))).toEqual({
        type: 'settings.updated',
        revision: nextRevision,
        resource: 'settings',
        origin: { writerSessionId: 'writer-l29' },
      })
    } finally {
      abort.abort()
      reader?.releaseLock()
    }
  })

  it('replays stored command events after app restart', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      streamGeminiThoughts: false,
    })
    const command = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/settings/runtime',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: revision, patch: { streamGeminiThoughts: true } },
    })
    expect(command.statusCode).toBe(200)
    const nextRevision = command.json().revision as number

    const dataDir = harness.dataDir
    await stopHarness(harness, false)
    harness = await startHarness({ dataDir })

    const baseUrl = await listen(harness.app)
    const abort = new AbortController()
    const res = await fetch(`${baseUrl}/api/v1/events?sinceRevision=${revision}`, {
      headers: { 'risu-auth': assertion },
      signal: abort.signal,
    })
    const reader = res.body?.getReader()
    expect(reader).toBeDefined()

    try {
      expect(res.status).toBe(200)
      const text = await readUntil(reader!, (chunk) => chunk.includes('settings.updated'))
      expect(text).toContain(`id: ${nextRevision}`)
      const dataLine = text.split('\n').find((line) => line.startsWith('data: '))
      expect(dataLine).toBeDefined()
      expect(JSON.parse(dataLine!.slice('data: '.length))).toEqual({
        type: 'settings.updated',
        revision: nextRevision,
        resource: 'settings',
      })
    } finally {
      abort.abort()
      reader?.releaseLock()
    }
  })

  it('replays a command committed during event stream setup', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      streamGeminiThoughts: false,
    })
    const setupEvent: CommandEvent = {
      type: 'settings.updated',
      revision: revision + 1,
      resource: 'settings',
    }
    let emittedDuringSetup = false
    harness.commandEvents.onBeforeSubscribe = () => {
      if (emittedDuringSetup) return
      emittedDuringSetup = true
      const db = new DatabaseSync(path.join(harness.dataDir, 'risu.db'))
      try {
        expect(bumpRevision(db)).toBe(setupEvent.revision)
        persistCommandEvent(db, setupEvent)
      } finally {
        db.close()
      }
      harness.commandEvents.emit(setupEvent)
    }

    const baseUrl = await listen(harness.app)
    const abort = new AbortController()
    const res = await fetch(`${baseUrl}/api/v1/events?sinceRevision=${revision}`, {
      headers: { 'risu-auth': assertion },
      signal: abort.signal,
    })
    const reader = res.body?.getReader()
    expect(reader).toBeDefined()

    try {
      expect(res.status).toBe(200)
      const text = await readUntil(reader!, (chunk) => chunk.includes('settings.updated'))
      expect(text).toContain(`id: ${setupEvent.revision}`)
      const dataLine = text.split('\n').find((line) => line.startsWith('data: '))
      expect(dataLine).toBeDefined()
      expect(JSON.parse(dataLine!.slice('data: '.length))).toEqual(setupEvent)
      expect(emittedDuringSetup).toBe(true)
    } finally {
      harness.commandEvents.onBeforeSubscribe = undefined
      abort.abort()
      reader?.releaseLock()
    }
  })

  it('accepts Last-Event-ID as a replay cursor', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      streamGeminiThoughts: false,
    })
    const command = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/settings/runtime',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: revision, patch: { streamGeminiThoughts: true } },
    })
    expect(command.statusCode).toBe(200)
    const nextRevision = command.json().revision as number

    const baseUrl = await listen(harness.app)
    const abort = new AbortController()
    const res = await fetch(`${baseUrl}/api/v1/events`, {
      headers: {
        'risu-auth': assertion,
        'Last-Event-ID': String(revision),
      },
      signal: abort.signal,
    })
    const reader = res.body?.getReader()
    expect(reader).toBeDefined()

    try {
      expect(res.status).toBe(200)
      const text = await readUntil(reader!, (chunk) => chunk.includes('settings.updated'))
      expect(text).toContain(`id: ${nextRevision}`)
    } finally {
      abort.abort()
      reader?.releaseLock()
    }
  })

  it('reports replay unavailable when retained history cannot cover the cursor', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      streamGeminiThoughts: false,
    })
    clearPersistedCommandEvents(harness.dataDir)

    const res = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/events?sinceRevision=0',
      headers: { 'risu-auth': assertion },
    })

    expect(res.statusCode).toBe(409)
    expect(res.json()).toEqual({
      error: 'event_replay_unavailable',
      requestedRevision: 0,
      currentRevision: revision,
    })
  })

  it('reports replay unavailable when the cursor is ahead of the server revision', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importDatabase(harness.app, assertion, {
      streamGeminiThoughts: false,
    })

    const res = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/events?sinceRevision=${revision + 1}`,
      headers: { 'risu-auth': assertion },
    })

    expect(res.statusCode).toBe(409)
    expect(res.json()).toEqual({
      error: 'event_replay_unavailable',
      requestedRevision: revision + 1,
      currentRevision: revision,
      oldestRevision: revision,
      latestRevision: revision,
    })
  })

  it('rejects invalid replay cursors before opening the stream', async () => {
    const { assertion } = await setupAuthedClient(harness.app)

    const res = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/events?sinceRevision=wat',
      headers: { 'risu-auth': assertion },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({
      error: 'invalid_event_replay_cursor',
      reason: 'sinceRevision must be a non-negative integer',
    })
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
        job: {
          id: jobId,
          kind: 'summarize',
          status: 'pending',
          attemptCount: 0,
          maxAttempts: 3,
        },
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
        job: {
          id: jobId,
          status: 'pending',
        },
      })
    } finally {
      abort.abort()
      reader?.releaseLock()
    }
  })

  it('unsubscribes listeners when the stream closes', async () => {
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
    expect(harness.commandEvents.activeListeners).toBe(1)

    abort.abort()
    await waitFor(() => harness.commandEvents.activeListeners === 0)
    reader?.releaseLock()
  })

  it('never arms the heartbeat or memory subscription after a mid-handler teardown (L11)', async () => {
    // A slow-consumer overflow during the replay flush runs `cleanup` before
    // the live-delivery legs are armed; the `cleanedUp` latch then keeps
    // cleanup from ever running again, so arming anyway would leak both
    // forever. The guard must skip arming entirely.
    const { armSseLiveDelivery } = await import('../src/routes/events.js')

    let heartbeatStarted = 0
    let memorySubscribed = 0
    const tornDown = armSseLiveDelivery({
      tornDown: () => true,
      startHeartbeat: () => {
        heartbeatStarted += 1
        return setInterval(() => {}, 1_000)
      },
      subscribeMemory: () => {
        memorySubscribed += 1
        return () => {}
      },
    })
    expect(tornDown).toEqual({ heartbeat: null, unsubscribeMemory: null })
    expect(heartbeatStarted).toBe(0)
    expect(memorySubscribed).toBe(0)

    // The live path still arms both.
    const armed = armSseLiveDelivery({
      tornDown: () => false,
      startHeartbeat: () => setInterval(() => {}, 1_000),
      subscribeMemory: () => {
        memorySubscribed += 1
        return () => {}
      },
    })
    expect(armed.heartbeat).not.toBeNull()
    expect(memorySubscribed).toBe(1)
    if (armed.heartbeat) clearInterval(armed.heartbeat)
    armed.unsubscribeMemory?.()
  })
})
