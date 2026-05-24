import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { openDatabase } from '../src/db.js'
import { createSummarizeMemoryJobHandler } from '../src/memorySummarizeJobHandler.js'
import { MemoryWorker } from '../src/memoryWorker.js'
import {
  createMemoryChunk,
  enqueueMemoryJob,
  getMemoryChunk,
  getMemoryJob,
  listMemorySummaries,
  updateMemoryChunkStatus,
} from '../src/memoryRepository.js'
import type { SummaryAdapterResult } from '../src/memorySummaryAdapter.js'

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

function payload(chunkId = 'chunk-1') {
  return {
    schemaVersion: 1,
    chunkId,
    model: 'subModel',
    rangeStartSeq: 0,
    rangeEndSeq: 1,
    messageIndexes: [0, 1],
    chatMemos: ['m0', 'm1'],
  }
}

function database() {
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
      const [messages, opts] = summarize.mock.calls[0]
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
})
