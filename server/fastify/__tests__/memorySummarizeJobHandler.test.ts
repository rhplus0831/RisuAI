import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { openDatabase } from '../src/db.js'
import {
  createSummarizeMemoryJobBatchHandler,
  createSummarizeMemoryJobHandler,
} from '../src/memorySummarizeJobHandler.js'
import { MemoryWorker } from '../src/memoryWorker.js'
import {
  cancelMemoryJob,
  createMemoryChunk,
  enqueueMemoryJob,
  getMemoryChunk,
  getMemoryJob,
  listMemorySummaries,
  updateMemoryChunkStatus,
} from '../src/memoryRepository.js'
import type { SummaryAdapterResult } from '../src/memorySummaryAdapter.js'
import { writePersistedWithMessages } from '../src/repository.js'
import { assertScopedLoadOnHotPath } from './helpers/loadCostHarness.js'

const dataDirs: string[] = []

function makeDataDir(): string {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-fastify-memory-summarize-handler-'))
  dataDirs.push(dataDir)
  return dataDir
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const dataDir of dataDirs.splice(0)) {
    rmSync(dataDir, { recursive: true, force: true })
  }
})

function payload(chunkId = 'chunk-1', rangeStartSeq = 0, rangeEndSeq = 1) {
  return {
    schemaVersion: 1,
    chunkId,
    model: 'subModel',
    rangeStartSeq,
    rangeEndSeq,
    messageIndexes: [rangeStartSeq, rangeEndSeq],
    chatMemos: [`m${rangeStartSeq}`, `m${rangeEndSeq}`],
  }
}

function database(settings: Record<string, unknown> = {}) {
  return {
    subModel: 'gpt-4o-mini',
    openAIKey: 'sk-test',
    hypaV3PresetId: 0,
    hypaV3Presets: [
      {
        name: 'Default',
        settings: {
          summarizationModel: 'subModel',
          summarizationPrompt: 'Summarize this: {{slot}}',
          reSummarizationPrompt: '',
          ...settings,
        },
      },
    ],
    characters: [{ chats: [{ id: 'chat-1' }] }],
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
    kind: 'summarize',
    payload: jobPayload,
  })
}

function seedBatchJob(
  db: ReturnType<typeof openDatabase>,
  input: {
    id: string
    chunkId: string
    rangeStartSeq: number
    rangeEndSeq: number
    text: string
    nextRunAt?: string
  },
) {
  createMemoryChunk(db, {
    id: input.chunkId,
    chatId: 'chat-1',
    messageId: input.chunkId,
    rangeStartSeq: input.rangeStartSeq,
    rangeEndSeq: input.rangeEndSeq,
    text: input.text,
  })
  return enqueueMemoryJob(db, {
    id: input.id,
    chatId: 'chat-1',
    kind: 'summarize',
    payload: payload(input.chunkId, input.rangeStartSeq, input.rangeEndSeq),
    nextRunAt: input.nextRunAt,
  })
}

describe('summarize memory job handler', () => {
  it('builds the prompt, writes the summary, marks the chunk summarized, and lets the worker complete the job', async () => {
    const db = openDatabase(makeDataDir())
    try {
      seedChunkAndJob(db)
      const summarize = vi.fn(async () => ({ text: 'summary text', tokens: 12 }))
      const worker = new MemoryWorker({
        db,
        handlers: {
          summarize: createSummarizeMemoryJobHandler({
            db,
            loadDatabase: database,
            summarize,
          }),
        },
      })

      expect(await worker.tick()).toBe(true)

      expect(summarize).toHaveBeenCalledOnce()
      const [messages, opts] = (summarize.mock.calls as any[][])[0]
      expect(messages).toEqual([
        {
          role: 'user',
          content: 'assistant: first\nassistant: second',
        },
        {
          role: 'system',
          content: 'Summarize this: {{slot}}',
        },
      ])
      expect(opts).toMatchObject({
        provider: 'openai',
        model: 'gpt-4o-mini',
        options: { openai: { apiKey: 'sk-test' } },
        maxTokens: 8192,
        temperature: 0,
      })
      expect(listMemorySummaries(db, { chatId: 'chat-1', chunkId: 'chunk-1' })).toEqual([
        expect.objectContaining({
          chatId: 'chat-1',
          chunkId: 'chunk-1',
          model: 'subModel',
          text: 'summary text',
          tokens: 12,
          metadata: expect.objectContaining({
            source: 'hypav3-summarize-job',
            provider: 'openai',
            providerModel: 'gpt-4o-mini',
            jobId: 'job-1',
            chatMemos: ['m0', 'm1'],
          }),
        }),
      ])
      expect(getMemoryChunk(db, 'chunk-1')).toMatchObject({ status: 'summarized' })
      expect(getMemoryJob(db, 'job-1')).toMatchObject({ status: 'completed', error: null })
    } finally {
      db.close()
    }
  })

  it('is idempotent when the target summary already exists', async () => {
    const db = openDatabase(makeDataDir())
    try {
      const job = seedChunkAndJob(db)
      const handler = createSummarizeMemoryJobHandler({
        db,
        loadDatabase: database,
        summarize: async () => ({ text: 'summary text', tokens: 0 }),
      })
      await handler(job)
      updateMemoryChunkStatus(db, 'chunk-1', 'pending')

      const summarize = vi.fn(async (): Promise<SummaryAdapterResult> => {
        throw new Error('should not call provider twice')
      })
      await createSummarizeMemoryJobHandler({
        db,
        loadDatabase: database,
        summarize,
      })(job)

      expect(summarize).not.toHaveBeenCalled()
      expect(listMemorySummaries(db, { chatId: 'chat-1', chunkId: 'chunk-1' })).toHaveLength(1)
      expect(getMemoryChunk(db, 'chunk-1')).toMatchObject({ status: 'summarized' })
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
        kind: 'summarize',
        payload: payload('missing-chunk'),
      })
      const handler = createSummarizeMemoryJobHandler({
        db,
        loadDatabase: database,
        summarize: async () => ({ text: 'summary', tokens: 0 }),
      })

      await expect(handler(job)).rejects.toThrow('memory chunk not found: missing-chunk')
    } finally {
      db.close()
    }
  })

  it('fails when persisted chat data is missing', async () => {
    const db = openDatabase(makeDataDir())
    try {
      const job = seedChunkAndJob(db)
      const handler = createSummarizeMemoryJobHandler({
        db,
        loadDatabase: () => ({ ...database(), characters: [] }),
        summarize: async () => ({ text: 'summary', tokens: 0 }),
      })

      await expect(handler(job)).rejects.toThrow('chat data not found for chat chat-1')
      expect(listMemorySummaries(db, { chatId: 'chat-1', chunkId: 'chunk-1' })).toHaveLength(0)
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
        kind: 'summarize',
        payload: { schemaVersion: 1, chunkId: '', model: 'subModel' },
      })
      const summarize = vi.fn(async () => ({ text: 'summary', tokens: 0 }))
      const handler = createSummarizeMemoryJobHandler({
        db,
        loadDatabase: database,
        summarize,
      })

      await expect(handler(job)).rejects.toThrow(
        'summarize payload chunkId must be a non-empty string',
      )
      expect(summarize).not.toHaveBeenCalled()
    } finally {
      db.close()
    }
  })

  it('fails provider errors and marks the chunk failed for observability', async () => {
    const db = openDatabase(makeDataDir())
    try {
      const job = seedChunkAndJob(db)
      const handler = createSummarizeMemoryJobHandler({
        db,
        loadDatabase: database,
        summarize: async () => ({ error: 'provider exploded' }),
      })

      await expect(handler(job)).rejects.toThrow('provider exploded')
      expect(getMemoryChunk(db, 'chunk-1')).toMatchObject({ status: 'failed' })
      expect(listMemorySummaries(db, { chatId: 'chat-1', chunkId: 'chunk-1' })).toHaveLength(0)
    } finally {
      db.close()
    }
  })

  it('rolls back invalid summary writes and marks the chunk failed', async () => {
    const db = openDatabase(makeDataDir())
    try {
      const job = seedChunkAndJob(db)
      const handler = createSummarizeMemoryJobHandler({
        db,
        loadDatabase: database,
        summarize: async () => ({ text: '', tokens: 0 }),
      })

      await expect(handler(job)).rejects.toThrow('summary text must be a non-empty string')
      expect(getMemoryChunk(db, 'chunk-1')).toMatchObject({ status: 'failed' })
      expect(listMemorySummaries(db, { chatId: 'chat-1', chunkId: 'chunk-1' })).toHaveLength(0)
    } finally {
      db.close()
    }
  })

  it('commits batch summaries in planned order only until the first failed write', async () => {
    const db = openDatabase(makeDataDir())
    try {
      seedBatchJob(db, {
        id: 'job-1',
        chunkId: 'chunk-1',
        rangeStartSeq: 0,
        rangeEndSeq: 1,
        text: 'chunk one',
        nextRunAt: '2026-05-25T00:00:00.000Z',
      })
      seedBatchJob(db, {
        id: 'job-2',
        chunkId: 'chunk-2',
        rangeStartSeq: 2,
        rangeEndSeq: 3,
        text: 'chunk two',
        nextRunAt: '2026-05-25T00:00:00.000Z',
      })
      seedBatchJob(db, {
        id: 'job-3',
        chunkId: 'chunk-3',
        rangeStartSeq: 4,
        rangeEndSeq: 5,
        text: 'chunk three',
        nextRunAt: '2026-05-25T00:00:00.000Z',
      })
      const worker = new MemoryWorker({
        db,
        retry: {
          now: '2026-05-25T00:00:00.000Z',
          backoffBaseMs: 1_000,
        },
        batchHandlers: {
          summarize: createSummarizeMemoryJobBatchHandler({
            db,
            loadDatabase: () => database({ summarizationMaxConcurrent: 3 }),
            summarize: async (messages) => {
              const text = String(messages[0]?.content ?? '')
              if (text.includes('chunk two')) return { text: '', tokens: 0 }
              return { text: `summary for ${text}`, tokens: 1 }
            },
          }),
        },
      })

      expect(await worker.tick()).toBe(true)

      expect(listMemorySummaries(db, { chatId: 'chat-1' }).map((summary) => summary.chunkId)).toEqual([
        'chunk-1',
      ])
      expect(getMemoryChunk(db, 'chunk-1')).toMatchObject({ status: 'summarized' })
      expect(getMemoryChunk(db, 'chunk-2')).toMatchObject({ status: 'failed' })
      expect(getMemoryChunk(db, 'chunk-3')).toMatchObject({ status: 'pending' })
      expect(getMemoryJob(db, 'job-1')).toMatchObject({ status: 'completed', error: null })
      expect(getMemoryJob(db, 'job-2')).toMatchObject({
        status: 'pending',
        error: 'summary text must be a non-empty string',
        nextRunAt: '2026-05-25T00:00:01.000Z',
      })
      expect(getMemoryJob(db, 'job-3')).toMatchObject({
        status: 'pending',
        error: 'summary text must be a non-empty string',
        nextRunAt: '2026-05-25T00:00:01.000Z',
      })
    } finally {
      db.close()
    }
  })

  it('limits batch provider dispatch by summarizationMaxConcurrent', async () => {
    const db = openDatabase(makeDataDir())
    try {
      seedBatchJob(db, {
        id: 'job-1',
        chunkId: 'chunk-1',
        rangeStartSeq: 0,
        rangeEndSeq: 1,
        text: 'chunk one',
      })
      seedBatchJob(db, {
        id: 'job-2',
        chunkId: 'chunk-2',
        rangeStartSeq: 2,
        rangeEndSeq: 3,
        text: 'chunk two',
      })
      seedBatchJob(db, {
        id: 'job-3',
        chunkId: 'chunk-3',
        rangeStartSeq: 4,
        rangeEndSeq: 5,
        text: 'chunk three',
      })
      let active = 0
      let maxActive = 0
      const worker = new MemoryWorker({
        db,
        batchHandlers: {
          summarize: createSummarizeMemoryJobBatchHandler({
            db,
            loadDatabase: () => database({ summarizationMaxConcurrent: 2 }),
            summarize: async () => {
              active += 1
              maxActive = Math.max(maxActive, active)
              await Promise.resolve()
              active -= 1
              return { text: 'summary', tokens: 1 }
            },
          }),
        },
      })

      expect(await worker.tick()).toBe(true)

      expect(maxActive).toBeLessThanOrEqual(2)
      expect(listMemorySummaries(db, { chatId: 'chat-1' }).map((summary) => summary.chunkId)).toEqual([
        'chunk-1',
        'chunk-2',
        'chunk-3',
      ])
      expect(getMemoryJob(db, 'job-3')).toMatchObject({ status: 'completed', attemptCount: 1 })
    } finally {
      db.close()
    }
  })

  it('applies summarizationRequestsPerMinute between provider dispatches', async () => {
    const db = openDatabase(makeDataDir())
    try {
      seedBatchJob(db, {
        id: 'job-1',
        chunkId: 'chunk-1',
        rangeStartSeq: 0,
        rangeEndSeq: 1,
        text: 'chunk one',
      })
      seedBatchJob(db, {
        id: 'job-2',
        chunkId: 'chunk-2',
        rangeStartSeq: 2,
        rangeEndSeq: 3,
        text: 'chunk two',
      })
      let now = 0
      const sleeps: number[] = []
      const worker = new MemoryWorker({
        db,
        batchHandlers: {
          summarize: createSummarizeMemoryJobBatchHandler({
            db,
            loadDatabase: () =>
              database({ summarizationMaxConcurrent: 2, summarizationRequestsPerMinute: 60 }),
            now: () => now,
            sleep: async (ms) => {
              sleeps.push(ms)
              now += ms
            },
            summarize: async () => ({ text: 'summary', tokens: 1 }),
          }),
        },
      })

      expect(await worker.tick()).toBe(true)

      expect(sleeps).toEqual([1_000])
      expect(listMemorySummaries(db, { chatId: 'chat-1' })).toHaveLength(2)
    } finally {
      db.close()
    }
  })

  it('does not commit a staged summary after a running batch job is cancelled', async () => {
    const db = openDatabase(makeDataDir())
    try {
      seedBatchJob(db, {
        id: 'job-1',
        chunkId: 'chunk-1',
        rangeStartSeq: 0,
        rangeEndSeq: 1,
        text: 'chunk one',
      })
      seedBatchJob(db, {
        id: 'job-2',
        chunkId: 'chunk-2',
        rangeStartSeq: 2,
        rangeEndSeq: 3,
        text: 'chunk two',
      })
      const worker = new MemoryWorker({
        db,
        batchHandlers: {
          summarize: createSummarizeMemoryJobBatchHandler({
            db,
            loadDatabase: () => database({ summarizationMaxConcurrent: 2 }),
            summarize: async (messages) => {
              const text = String(messages[0]?.content ?? '')
              if (text.includes('chunk one')) cancelMemoryJob(db, 'job-1')
              return { text: 'summary', tokens: 1 }
            },
          }),
        },
      })

      expect(await worker.tick()).toBe(true)

      expect(listMemorySummaries(db, { chatId: 'chat-1' })).toHaveLength(0)
      expect(getMemoryJob(db, 'job-1')).toMatchObject({ status: 'cancelled' })
      expect(getMemoryJob(db, 'job-2')).toMatchObject({
        status: 'pending',
        error: 'summarize job job-1 is no longer running',
      })
    } finally {
      db.close()
    }
  })

  it('L18: the default loader performs zero whole-corpus payload reads per batch', async () => {
    const dataDir = makeDataDir()
    const db = openDatabase(dataDir)
    try {
      writePersistedWithMessages(db, dataDir, {
        _version: 4,
        database: {
          ...database(),
          characters: [
            {
              chaId: 'char-1',
              type: 'character',
              name: 'Tess',
              chats: [
                { id: 'chat-1', name: 'main', message: [{ role: 'user', data: 'hello' }] },
                { id: 'chat-2', name: 'side', message: [{ role: 'user', data: 'bye' }] },
              ],
            },
          ],
        },
        assets: [],
      } as never)
      seedChunkAndJob(db)
      const summarize = vi.fn(async () => ({ text: 'summary text', tokens: 12 }))
      const worker = new MemoryWorker({
        db,
        batchHandlers: {
          // No loadDatabase injection: the default dataDir path is under test.
          summarize: createSummarizeMemoryJobBatchHandler({ db, dataDir, summarize }),
        },
      })

      // hypa_v3_presets is the one collection the memory path legitimately
      // reads whole (it is the settings source); everything else must stay
      // scoped — chat existence is checked via id-only stubs, never the
      // characters/chats/messages payload parse.
      await assertScopedLoadOnHotPath(() => worker.tick(), {
        allowTables: ['hypa_v3_presets'],
      })

      expect(summarize).toHaveBeenCalledOnce()
      expect(listMemorySummaries(db, { chatId: 'chat-1' })).toHaveLength(1)
      expect(getMemoryJob(db, 'job-1')).toMatchObject({ status: 'completed' })
    } finally {
      db.close()
    }
  })

  it('L18: an unknown chat fails with the same chat-not-found error through the scoped loader', async () => {
    const dataDir = makeDataDir()
    const db = openDatabase(dataDir)
    try {
      writePersistedWithMessages(db, dataDir, {
        _version: 4,
        database: {
          ...database(),
          characters: [
            {
              chaId: 'char-1',
              type: 'character',
              name: 'Tess',
              chats: [{ id: 'chat-1', name: 'main', message: [] }],
            },
          ],
        },
        assets: [],
      } as never)
      createMemoryChunk(db, {
        id: 'chunk-x',
        chatId: 'chat-9',
        messageId: 'm1',
        rangeStartSeq: 0,
        rangeEndSeq: 1,
        text: 'assistant: orphaned',
      })
      enqueueMemoryJob(db, {
        id: 'job-x',
        chatId: 'chat-9',
        kind: 'summarize',
        payload: payload('chunk-x'),
      })
      const summarize = vi.fn(async () => ({ text: 'should not run', tokens: 1 }))
      const worker = new MemoryWorker({
        db,
        batchHandlers: {
          summarize: createSummarizeMemoryJobBatchHandler({ db, dataDir, summarize }),
        },
      })

      expect(await worker.tick()).toBe(true)

      expect(summarize).not.toHaveBeenCalled()
      expect(getMemoryJob(db, 'job-x')).toMatchObject({
        status: 'pending',
        error: 'chat data not found for chat chat-9',
      })
    } finally {
      db.close()
    }
  })
})
