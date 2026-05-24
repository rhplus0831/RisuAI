import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { openDatabase } from '../src/db.js'
import { buildApp } from '../src/app.js'
import { enqueueMemoryJob, getMemoryJob, listMemoryJobs } from '../src/memoryRepository.js'
import { MemoryWorker, type MemoryJobHandler } from '../src/memoryWorker.js'

const dataDirs: string[] = []

function makeDataDir(): string {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-fastify-memory-worker-'))
  dataDirs.push(dataDir)
  return dataDir
}

function deferred(): { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void } {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

afterEach(() => {
  vi.useRealTimers()
  for (const dataDir of dataDirs.splice(0)) {
    rmSync(dataDir, { recursive: true, force: true })
  }
})

describe('memory worker lifecycle and dispatch', () => {
  it('starts and stops idempotently', async () => {
    const db = openDatabase(makeDataDir())
    try {
      const worker = new MemoryWorker({ db, pollIntervalMs: 10 })

      worker.start()
      worker.start()
      expect(worker.isRunning).toBe(true)

      await worker.stop()
      await worker.stop()
      expect(worker.isRunning).toBe(false)
      expect(worker.isProcessing).toBe(false)
    } finally {
      db.close()
    }
  })

  it('dispatches chunk, embed, and summarize jobs through stub handlers', async () => {
    const db = openDatabase(makeDataDir())
    try {
      enqueueMemoryJob(db, {
        id: 'job-chunk',
        chatId: 'chat-1',
        kind: 'chunk',
        payload: { reason: 'chunk' },
      })
      enqueueMemoryJob(db, {
        id: 'job-embed',
        chatId: 'chat-1',
        kind: 'embed',
        payload: { chunkId: 'chunk-1' },
      })
      enqueueMemoryJob(db, {
        id: 'job-summarize',
        chatId: 'chat-1',
        kind: 'summarize',
        payload: { chunkId: 'chunk-1', model: 'model-a' },
      })

      const handled: string[] = []
      const handler: MemoryJobHandler = (job) => {
        handled.push(`${job.kind}:${job.id}`)
      }
      const worker = new MemoryWorker({
        db,
        handlers: { chunk: handler, embed: handler, summarize: handler },
      })

      expect(await worker.tick()).toBe(true)
      expect(await worker.tick()).toBe(true)
      expect(await worker.tick()).toBe(true)
      expect(await worker.tick()).toBe(false)

      expect(handled).toEqual(['chunk:job-chunk', 'embed:job-embed', 'summarize:job-summarize'])
      expect(listMemoryJobs(db).map((job) => [job.id, job.status])).toEqual([
        ['job-chunk', 'completed'],
        ['job-embed', 'completed'],
        ['job-summarize', 'completed'],
      ])
    } finally {
      db.close()
    }
  })

  it('claims only one job at a time', async () => {
    const db = openDatabase(makeDataDir())
    try {
      enqueueMemoryJob(db, { id: 'job-1', chatId: 'chat-1', kind: 'chunk', payload: {} })
      enqueueMemoryJob(db, { id: 'job-2', chatId: 'chat-1', kind: 'embed', payload: {} })
      const gate = deferred()
      const handled: string[] = []
      const worker = new MemoryWorker({
        db,
        handlers: {
          chunk: async (job) => {
            handled.push(job.id)
            await gate.promise
          },
        },
      })

      const firstTick = worker.tick()
      expect(await worker.tick()).toBe(false)
      expect(worker.isProcessing).toBe(true)
      expect(handled).toEqual(['job-1'])
      expect(getMemoryJob(db, 'job-1')).toMatchObject({ status: 'running' })
      expect(getMemoryJob(db, 'job-2')).toMatchObject({ status: 'pending' })

      gate.resolve()
      expect(await firstTick).toBe(true)
      expect(getMemoryJob(db, 'job-1')).toMatchObject({ status: 'completed' })
      expect(getMemoryJob(db, 'job-2')).toMatchObject({ status: 'pending' })
    } finally {
      db.close()
    }
  })

  it('fails a claimed job when a handler throws', async () => {
    const db = openDatabase(makeDataDir())
    try {
      enqueueMemoryJob(db, { id: 'job-fail', chatId: 'chat-1', kind: 'summarize', payload: {} })
      const worker = new MemoryWorker({
        db,
        handlers: {
          summarize: () => {
            throw new Error('summary stub exploded')
          },
        },
      })

      expect(await worker.tick()).toBe(true)
      expect(getMemoryJob(db, 'job-fail')).toMatchObject({
        status: 'failed',
        error: 'summary stub exploded',
      })
    } finally {
      db.close()
    }
  })

  it('waits for the in-flight handler during graceful shutdown', async () => {
    const db = openDatabase(makeDataDir())
    try {
      enqueueMemoryJob(db, { id: 'job-stop', chatId: 'chat-1', kind: 'chunk', payload: {} })
      const gate = deferred()
      let settled = false
      const worker = new MemoryWorker({
        db,
        handlers: {
          chunk: async () => {
            await gate.promise
          },
        },
      })

      const tick = worker.tick()
      const stop = worker.stop().then(() => {
        settled = true
      })
      await Promise.resolve()
      expect(settled).toBe(false)

      gate.resolve()
      await tick
      await stop
      expect(settled).toBe(true)
      expect(worker.isRunning).toBe(false)
      expect(getMemoryJob(db, 'job-stop')).toMatchObject({ status: 'completed' })
    } finally {
      db.close()
    }
  })

  it('starts with Fastify and stops before the database closes', async () => {
    vi.useFakeTimers()
    process.env.LOG_LEVEL = 'silent'
    const dataDir = makeDataDir()
    const db = openDatabase(dataDir)
    enqueueMemoryJob(db, { id: 'job-app', chatId: 'chat-1', kind: 'chunk', payload: {} })
    db.close()

    const gate = deferred()
    let handlerStarted = false
    let appClosed = false
    const { app } = await buildApp({
      config: {
        host: '127.0.0.1',
        port: 0,
        dataDir,
        bodyLimit: 1024 * 1024,
        trustProxy: false,
        hubUrl: 'https://sv.risuai.xyz',
      },
      memoryWorker: {
        pollIntervalMs: 10_000,
        handlers: {
          chunk: async () => {
            handlerStarted = true
            await gate.promise
          },
        },
      },
    })

    await vi.advanceTimersByTimeAsync(0)
    expect(handlerStarted).toBe(true)
    const close = app.close().then(() => {
      appClosed = true
    })
    await Promise.resolve()
    expect(appClosed).toBe(false)

    gate.resolve()
    await close
    expect(appClosed).toBe(true)

    const checkDb = openDatabase(dataDir)
    try {
      expect(getMemoryJob(checkDb, 'job-app')).toMatchObject({ status: 'completed' })
    } finally {
      checkDb.close()
    }
  })
})
