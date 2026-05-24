import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { openDatabase } from '../src/db.js'
import {
  createEmbedMemoryJobBatchHandler,
  createEmbedMemoryJobHandler,
} from '../src/memoryEmbedJobHandler.js'
import { MemoryWorker } from '../src/memoryWorker.js'
import {
  cancelMemoryJob,
  createMemoryChunk,
  enqueueMemoryJob,
  getMemoryJob,
  listMemoryEmbeddings,
} from '../src/memoryRepository.js'

const dataDirs: string[] = []

function makeDataDir(): string {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-fastify-memory-embed-handler-'))
  dataDirs.push(dataDir)
  return dataDir
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const dataDir of dataDirs.splice(0)) {
    rmSync(dataDir, { recursive: true, force: true })
  }
})

function payload(chunkId = 'chunk-1', model = 'custom') {
  return {
    schemaVersion: 1,
    chunkId,
    model,
  }
}

function database(settings: Record<string, unknown> = {}) {
  return {
    hypaModel: 'custom',
    hypaCustomSettings: {
      url: 'https://example.test/v1',
      model: 'custom-embed',
      key: 'sk-test',
    },
    hypaV3PresetId: 0,
    hypaV3Presets: [
      {
        name: 'Default',
        settings: {
          embeddingRequestsPerMinute: 100,
          embeddingMaxConcurrent: 1,
          ...settings,
        },
      },
    ],
  }
}

function seedChunkAndJob(db: ReturnType<typeof openDatabase>, jobPayload = payload()) {
  createMemoryChunk(db, {
    id: jobPayload.chunkId,
    chatId: 'chat-1',
    messageId: 'm1',
    rangeStartSeq: 0,
    rangeEndSeq: 1,
    text: 'assistant: first\nassistant: second',
  })
  return enqueueMemoryJob(db, {
    id: 'job-1',
    chatId: 'chat-1',
    kind: 'embed',
    payload: jobPayload,
  })
}

function seedBatchJob(
  db: ReturnType<typeof openDatabase>,
  input: { id: string; chunkId: string; text: string },
) {
  createMemoryChunk(db, {
    id: input.chunkId,
    chatId: 'chat-1',
    messageId: input.chunkId,
    rangeStartSeq: 0,
    rangeEndSeq: 1,
    text: input.text,
  })
  return enqueueMemoryJob(db, {
    id: input.id,
    chatId: 'chat-1',
    kind: 'embed',
    payload: payload(input.chunkId),
  })
}

describe('embed memory job handler', () => {
  it('fetches an embedding, writes the vector, and lets the worker complete the job', async () => {
    const db = openDatabase(makeDataDir())
    try {
      seedChunkAndJob(db)
      const embed = vi.fn(async () => ({
        model: 'custom',
        vectors: [new Float32Array([0.25, -1.5, 3])],
        dim: 3,
      }))
      const worker = new MemoryWorker({
        db,
        handlers: {
          embed: createEmbedMemoryJobHandler({
            db,
            loadDatabase: database,
            embed,
          }),
        },
      })

      expect(await worker.tick()).toBe(true)

      expect(embed).toHaveBeenCalledOnce()
      expect(embed.mock.calls[0][0]).toMatchObject({
        request: {
          provider: 'custom',
          endpoint: 'https://example.test/v1/embeddings',
          apiKey: 'sk-test',
          model: 'custom-embed',
          wireModel: 'custom-embed',
        },
        input: ['assistant: first\nassistant: second'],
      })
      const embeddings = listMemoryEmbeddings(db, { chatId: 'chat-1', chunkId: 'chunk-1' })
      expect(embeddings).toHaveLength(1)
      expect(embeddings[0]).toMatchObject({
        chatId: 'chat-1',
        chunkId: 'chunk-1',
        model: 'custom',
        dim: 3,
        groupId: null,
        groupIndex: null,
      })
      expect(Array.from(embeddings[0].vector)).toEqual([0.25, -1.5, 3])
      expect(getMemoryJob(db, 'job-1')).toMatchObject({ status: 'completed', error: null })
    } finally {
      db.close()
    }
  })

  it('is idempotent when the target embedding already exists', async () => {
    const db = openDatabase(makeDataDir())
    try {
      const job = seedChunkAndJob(db)
      const handler = createEmbedMemoryJobHandler({
        db,
        loadDatabase: database,
        embed: async () => ({ model: 'custom', vectors: [new Float32Array([1, 2])], dim: 2 }),
      })
      await handler(job)

      const embed = vi.fn(async () => {
        throw new Error('should not call provider twice')
      })
      await createEmbedMemoryJobHandler({
        db,
        loadDatabase: database,
        embed,
      })(job)

      expect(embed).not.toHaveBeenCalled()
      expect(listMemoryEmbeddings(db, { chatId: 'chat-1', chunkId: 'chunk-1' })).toHaveLength(1)
    } finally {
      db.close()
    }
  })

  it('fails missing chunks with a useful error', async () => {
    const db = openDatabase(makeDataDir())
    try {
      const job = enqueueMemoryJob(db, {
        id: 'job-1',
        chatId: 'chat-1',
        kind: 'embed',
        payload: payload('missing-chunk'),
      })
      const handler = createEmbedMemoryJobHandler({
        db,
        loadDatabase: database,
        embed: async () => ({ model: 'custom', vectors: [new Float32Array([1])], dim: 1 }),
      })

      await expect(handler(job)).rejects.toThrow('memory chunk not found: missing-chunk')
    } finally {
      db.close()
    }
  })

  it('fails invalid payloads before provider dispatch', async () => {
    const db = openDatabase(makeDataDir())
    try {
      const job = enqueueMemoryJob(db, {
        id: 'job-1',
        chatId: 'chat-1',
        kind: 'embed',
        payload: { schemaVersion: 1, chunkId: '', model: 'custom' },
      })
      const embed = vi.fn(async () => ({ model: 'custom', vectors: [new Float32Array([1])], dim: 1 }))
      const handler = createEmbedMemoryJobHandler({
        db,
        loadDatabase: database,
        embed,
      })

      await expect(handler(job)).rejects.toThrow('embed payload chunkId must be a non-empty string')
      expect(embed).not.toHaveBeenCalled()
    } finally {
      db.close()
    }
  })

  it('fails unsupported embedding models before provider dispatch', async () => {
    const db = openDatabase(makeDataDir())
    try {
      const job = seedChunkAndJob(db, payload('chunk-1', 'MiniLM'))
      const embed = vi.fn(async () => ({ model: 'MiniLM', vectors: [new Float32Array([1])], dim: 1 }))
      const handler = createEmbedMemoryJobHandler({
        db,
        loadDatabase: database,
        embed,
      })

      await expect(handler(job)).rejects.toThrow(
        'server-side memory embeddings do not support browser-local model MiniLM',
      )
      expect(embed).not.toHaveBeenCalled()
      expect(listMemoryEmbeddings(db, { chatId: 'chat-1' })).toHaveLength(0)
    } finally {
      db.close()
    }
  })

  it('fails provider errors without writing a vector', async () => {
    const db = openDatabase(makeDataDir())
    try {
      const job = seedChunkAndJob(db)
      const handler = createEmbedMemoryJobHandler({
        db,
        loadDatabase: database,
        embed: async () => ({ error: 'provider exploded' }),
      })

      await expect(handler(job)).rejects.toThrow('provider exploded')
      expect(listMemoryEmbeddings(db, { chatId: 'chat-1' })).toHaveLength(0)
    } finally {
      db.close()
    }
  })

  it('rolls back invalid embedding writes', async () => {
    const db = openDatabase(makeDataDir())
    try {
      const job = seedChunkAndJob(db)
      const handler = createEmbedMemoryJobHandler({
        db,
        loadDatabase: database,
        embed: async () => ({ model: 'custom', vectors: [new Float32Array([1, 2])], dim: 3 }),
      })

      await expect(handler(job)).rejects.toThrow('embedding dimension mismatch: expected 3, got 2')
      expect(listMemoryEmbeddings(db, { chatId: 'chat-1' })).toHaveLength(0)
    } finally {
      db.close()
    }
  })

  it('limits batch provider dispatch by embeddingMaxConcurrent', async () => {
    const db = openDatabase(makeDataDir())
    try {
      seedBatchJob(db, { id: 'job-1', chunkId: 'chunk-1', text: 'chunk one' })
      seedBatchJob(db, { id: 'job-2', chunkId: 'chunk-2', text: 'chunk two' })
      seedBatchJob(db, { id: 'job-3', chunkId: 'chunk-3', text: 'chunk three' })
      let active = 0
      let maxActive = 0
      const worker = new MemoryWorker({
        db,
        batchHandlers: {
          embed: createEmbedMemoryJobBatchHandler({
            db,
            loadDatabase: () => database({ embeddingMaxConcurrent: 2 }),
            embed: async () => {
              active += 1
              maxActive = Math.max(maxActive, active)
              await Promise.resolve()
              active -= 1
              return { model: 'custom', vectors: [new Float32Array([1])], dim: 1 }
            },
          }),
        },
      })

      expect(await worker.tick()).toBe(true)

      expect(maxActive).toBeLessThanOrEqual(2)
      expect(listMemoryEmbeddings(db, { chatId: 'chat-1' }).map((embedding) => embedding.chunkId)).toEqual([
        'chunk-1',
        'chunk-2',
        'chunk-3',
      ])
      expect(getMemoryJob(db, 'job-3')).toMatchObject({ status: 'completed', attemptCount: 1 })
    } finally {
      db.close()
    }
  })

  it('applies embeddingRequestsPerMinute between provider dispatches', async () => {
    const db = openDatabase(makeDataDir())
    try {
      seedBatchJob(db, { id: 'job-1', chunkId: 'chunk-1', text: 'chunk one' })
      seedBatchJob(db, { id: 'job-2', chunkId: 'chunk-2', text: 'chunk two' })
      let now = 0
      const sleeps: number[] = []
      const worker = new MemoryWorker({
        db,
        batchHandlers: {
          embed: createEmbedMemoryJobBatchHandler({
            db,
            loadDatabase: () =>
              database({ embeddingMaxConcurrent: 2, embeddingRequestsPerMinute: 60 }),
            now: () => now,
            sleep: async (ms) => {
              sleeps.push(ms)
              now += ms
            },
            embed: async () => ({ model: 'custom', vectors: [new Float32Array([1])], dim: 1 }),
          }),
        },
      })

      expect(await worker.tick()).toBe(true)

      expect(sleeps).toEqual([1_000])
      expect(listMemoryEmbeddings(db, { chatId: 'chat-1' })).toHaveLength(2)
    } finally {
      db.close()
    }
  })

  it('does not commit a staged embedding after a running batch job is cancelled', async () => {
    const db = openDatabase(makeDataDir())
    try {
      seedBatchJob(db, { id: 'job-1', chunkId: 'chunk-1', text: 'chunk one' })
      seedBatchJob(db, { id: 'job-2', chunkId: 'chunk-2', text: 'chunk two' })
      const worker = new MemoryWorker({
        db,
        batchHandlers: {
          embed: createEmbedMemoryJobBatchHandler({
            db,
            loadDatabase: () => database({ embeddingMaxConcurrent: 2 }),
            embed: async (opts) => {
              const text = String(opts.input[0] ?? '')
              if (text.includes('chunk one')) cancelMemoryJob(db, 'job-1')
              return { model: 'custom', vectors: [new Float32Array([1])], dim: 1 }
            },
          }),
        },
      })

      expect(await worker.tick()).toBe(true)

      expect(listMemoryEmbeddings(db, { chatId: 'chat-1' })).toHaveLength(0)
      expect(getMemoryJob(db, 'job-1')).toMatchObject({ status: 'cancelled' })
      expect(getMemoryJob(db, 'job-2')).toMatchObject({
        status: 'pending',
        error: 'embed job job-1 is no longer running',
      })
    } finally {
      db.close()
    }
  })
})
