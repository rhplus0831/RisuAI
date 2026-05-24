import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { openDatabase } from '../src/db.js'
import {
  createMemoryChunk,
  createMemoryEmbedding,
  createMemoryJob,
  createMemorySummary,
  decodeEmbeddingVector,
  encodeEmbeddingVector,
  getMemoryChunk,
  getMemoryEmbedding,
  getMemoryJob,
  listMemoryChunks,
  listMemoryEmbeddings,
  listMemoryJobs,
  listMemorySummaries,
  mapMemoryJobRow,
  updateMemoryChunkStatus,
  updateMemoryJob,
} from '../src/memoryRepository.js'
import { ValidationError } from '../src/repository.js'

const dataDirs: string[] = []

function makeDataDir(): string {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-fastify-memory-repository-'))
  dataDirs.push(dataDir)
  return dataDir
}

afterEach(() => {
  for (const dataDir of dataDirs.splice(0)) {
    rmSync(dataDir, { recursive: true, force: true })
  }
})

describe('memory repository chunks', () => {
  it('creates, reads, filters, and updates memory chunks', () => {
    const db = openDatabase(makeDataDir())
    try {
      const chunk = createMemoryChunk(db, {
        id: 'chunk-1',
        chatId: 'chat-1',
        messageId: 'message-1',
        rangeStartSeq: 2,
        rangeEndSeq: 4,
        text: 'chunk text',
      })

      expect(chunk).toMatchObject({
        id: 'chunk-1',
        chatId: 'chat-1',
        messageId: 'message-1',
        rangeStartSeq: 2,
        rangeEndSeq: 4,
        text: 'chunk text',
        status: 'pending',
      })
      expect(getMemoryChunk(db, 'chunk-1')).toEqual(chunk)

      createMemoryChunk(db, {
        id: 'chunk-2',
        chatId: 'chat-1',
        rangeStartSeq: 5,
        rangeEndSeq: 7,
        text: 'done',
        status: 'summarized',
      })
      createMemoryChunk(db, {
        id: 'chunk-3',
        chatId: 'chat-2',
        rangeStartSeq: 0,
        rangeEndSeq: 1,
        text: 'other',
      })

      expect(listMemoryChunks(db, { chatId: 'chat-1' }).map((row) => row.id)).toEqual([
        'chunk-1',
        'chunk-2',
      ])
      expect(
        listMemoryChunks(db, { chatId: 'chat-1', status: 'pending' }).map((row) => row.id),
      ).toEqual(['chunk-1'])

      expect(updateMemoryChunkStatus(db, 'chunk-1', 'summarized')).toMatchObject({
        id: 'chunk-1',
        status: 'summarized',
      })
      expect(updateMemoryChunkStatus(db, 'missing', 'failed')).toBeNull()
    } finally {
      db.close()
    }
  })

  it('validates chunk ranges and uniqueness conflicts', () => {
    const db = openDatabase(makeDataDir())
    try {
      expect(() =>
        createMemoryChunk(db, {
          id: 'bad-range',
          chatId: 'chat-1',
          rangeStartSeq: 3,
          rangeEndSeq: 2,
          text: 'bad',
        }),
      ).toThrow(ValidationError)

      createMemoryChunk(db, {
        id: 'chunk-1',
        chatId: 'chat-1',
        rangeStartSeq: 0,
        rangeEndSeq: 1,
        text: 'chunk text',
      })
      expect(() =>
        createMemoryChunk(db, {
          id: 'chunk-1',
          chatId: 'chat-1',
          rangeStartSeq: 0,
          rangeEndSeq: 1,
          text: 'duplicate',
        }),
      ).toThrow(ValidationError)
    } finally {
      db.close()
    }
  })
})

describe('memory repository summaries', () => {
  it('creates, reads, filters, and enforces one summary per chunk/model', () => {
    const db = openDatabase(makeDataDir())
    try {
      createMemoryChunk(db, {
        id: 'chunk-1',
        chatId: 'chat-1',
        rangeStartSeq: 0,
        rangeEndSeq: 1,
        text: 'chunk text',
      })
      createMemoryChunk(db, {
        id: 'chunk-2',
        chatId: 'chat-1',
        rangeStartSeq: 2,
        rangeEndSeq: 3,
        text: 'chunk text 2',
      })

      const summary = createMemorySummary(db, {
        id: 'summary-1',
        chatId: 'chat-1',
        chunkId: 'chunk-1',
        model: 'model-a',
        text: 'summary text',
        tokens: 12,
      })
      createMemorySummary(db, {
        id: 'summary-2',
        chatId: 'chat-1',
        chunkId: 'chunk-2',
        model: 'model-b',
        text: 'summary text 2',
        tokens: 4,
      })

      expect(summary).toMatchObject({
        id: 'summary-1',
        chatId: 'chat-1',
        chunkId: 'chunk-1',
        model: 'model-a',
        text: 'summary text',
        tokens: 12,
      })
      expect(
        listMemorySummaries(db, { chatId: 'chat-1', model: 'model-a' }).map((row) => row.id),
      ).toEqual(['summary-1'])

      expect(() =>
        createMemorySummary(db, {
          id: 'summary-dup',
          chatId: 'chat-1',
          chunkId: 'chunk-1',
          model: 'model-a',
          text: 'duplicate model',
          tokens: 1,
        }),
      ).toThrow(ValidationError)
      expect(() =>
        createMemorySummary(db, {
          id: 'summary-bad',
          chatId: 'chat-1',
          chunkId: 'missing',
          model: 'model-a',
          text: 'missing chunk',
          tokens: 1,
        }),
      ).toThrow(ValidationError)
    } finally {
      db.close()
    }
  })
})

describe('memory repository embeddings', () => {
  it('encodes, decodes, reads, filters, and preserves contextual group fields', () => {
    const db = openDatabase(makeDataDir())
    try {
      createMemoryChunk(db, {
        id: 'chunk-1',
        chatId: 'chat-1',
        rangeStartSeq: 0,
        rangeEndSeq: 1,
        text: 'chunk text',
      })
      createMemoryChunk(db, {
        id: 'chunk-2',
        chatId: 'chat-1',
        rangeStartSeq: 2,
        rangeEndSeq: 3,
        text: 'chunk text 2',
      })

      const embedding = createMemoryEmbedding(db, {
        id: 'embedding-1',
        chatId: 'chat-1',
        chunkId: 'chunk-1',
        model: 'embed-a',
        vector: [0.25, -1.5, 3],
        groupId: 'group-1',
        groupIndex: 0,
      })
      createMemoryEmbedding(db, {
        id: 'embedding-2',
        chatId: 'chat-1',
        chunkId: 'chunk-2',
        model: 'embed-b',
        vector: new Float32Array([9, 8]),
      })

      expect(Array.from(embedding.vector)).toEqual([0.25, -1.5, 3])
      expect(embedding).toMatchObject({
        id: 'embedding-1',
        chatId: 'chat-1',
        chunkId: 'chunk-1',
        model: 'embed-a',
        dim: 3,
        groupId: 'group-1',
        groupIndex: 0,
      })
      expect(getMemoryEmbedding(db, 'embedding-1')).toMatchObject({
        id: 'embedding-1',
        dim: 3,
      })
      expect(
        listMemoryEmbeddings(db, { chatId: 'chat-1', groupId: 'group-1' }).map((row) => row.id),
      ).toEqual(['embedding-1'])
      expect(listMemoryEmbeddings(db, { groupId: null }).map((row) => row.id)).toEqual([
        'embedding-2',
      ])
    } finally {
      db.close()
    }
  })

  it('validates vector shape, decode dimensions, and uniqueness conflicts', () => {
    const db = openDatabase(makeDataDir())
    try {
      createMemoryChunk(db, {
        id: 'chunk-1',
        chatId: 'chat-1',
        rangeStartSeq: 0,
        rangeEndSeq: 1,
        text: 'chunk text',
      })

      expect(() => encodeEmbeddingVector([])).toThrow(ValidationError)
      expect(() => encodeEmbeddingVector([1, Number.NaN])).toThrow(ValidationError)
      expect(() => decodeEmbeddingVector(Buffer.from([0, 1, 2]), 2)).toThrow(ValidationError)

      createMemoryEmbedding(db, {
        id: 'embedding-1',
        chatId: 'chat-1',
        chunkId: 'chunk-1',
        model: 'embed-a',
        vector: [1, 2],
      })
      expect(() =>
        createMemoryEmbedding(db, {
          id: 'embedding-dup',
          chatId: 'chat-1',
          chunkId: 'chunk-1',
          model: 'embed-a',
          vector: [3, 4],
        }),
      ).toThrow(ValidationError)
      expect(() =>
        createMemoryEmbedding(db, {
          id: 'embedding-bad-group',
          chatId: 'chat-1',
          chunkId: 'chunk-1',
          model: 'embed-b',
          vector: [1],
          groupIndex: -1,
        }),
      ).toThrow(ValidationError)
    } finally {
      db.close()
    }
  })
})

describe('memory repository jobs', () => {
  it('creates, reads, filters, and updates inert job rows', () => {
    const db = openDatabase(makeDataDir())
    try {
      const job = createMemoryJob(db, {
        id: 'job-1',
        chatId: 'chat-1',
        kind: 'summarize',
        payload: { chunkId: 'chunk-1', model: 'model-a' },
      })
      createMemoryJob(db, {
        id: 'job-2',
        chatId: 'chat-1',
        kind: 'embed',
        payload: { chunkId: 'chunk-1', model: 'embed-a' },
        status: 'running',
      })
      createMemoryJob(db, {
        id: 'job-3',
        chatId: 'chat-2',
        kind: 'chunk',
        payload: { from: 0 },
      })

      expect(job).toMatchObject({
        id: 'job-1',
        chatId: 'chat-1',
        kind: 'summarize',
        status: 'pending',
        payload: { chunkId: 'chunk-1', model: 'model-a' },
        error: null,
      })
      expect(getMemoryJob(db, 'job-1')).toEqual(job)
      expect(listMemoryJobs(db, { chatId: 'chat-1' }).map((row) => row.id)).toEqual([
        'job-1',
        'job-2',
      ])
      expect(listMemoryJobs(db, { status: 'pending' }).map((row) => row.id)).toEqual([
        'job-1',
        'job-3',
      ])

      expect(
        updateMemoryJob(db, 'job-1', {
          status: 'failed',
          payload: { chunkId: 'chunk-1', retryable: false },
          error: 'summary failed',
        }),
      ).toMatchObject({
        id: 'job-1',
        status: 'failed',
        payload: { chunkId: 'chunk-1', retryable: false },
        error: 'summary failed',
      })
      expect(updateMemoryJob(db, 'missing', { status: 'cancelled' })).toBeNull()
    } finally {
      db.close()
    }
  })

  it('validates payload serialization, row mapper statuses, and uniqueness conflicts', () => {
    const db = openDatabase(makeDataDir())
    try {
      expect(() =>
        createMemoryJob(db, {
          id: 'bad-payload',
          chatId: 'chat-1',
          kind: 'chunk',
          payload: undefined,
        }),
      ).toThrow(ValidationError)

      createMemoryJob(db, {
        id: 'job-1',
        chatId: 'chat-1',
        kind: 'chunk',
        payload: { ok: true },
      })
      expect(() =>
        createMemoryJob(db, {
          id: 'job-1',
          chatId: 'chat-1',
          kind: 'chunk',
          payload: { ok: true },
        }),
      ).toThrow(ValidationError)
      expect(() => updateMemoryJob(db, 'job-1', { payload: undefined })).toThrow(ValidationError)

      expect(() =>
        mapMemoryJobRow({
          id: 'job-row',
          chat_id: 'chat-1',
          kind: 'translate',
          status: 'pending',
          payload_json: '{}',
          error: null,
          created_at: '2026-05-24T00:00:00.000Z',
          updated_at: '2026-05-24T00:00:00.000Z',
        }),
      ).toThrow(ValidationError)
      expect(() =>
        mapMemoryJobRow({
          id: 'job-row',
          chat_id: 'chat-1',
          kind: 'chunk',
          status: 'pending',
          payload_json: '{',
          error: null,
          created_at: '2026-05-24T00:00:00.000Z',
          updated_at: '2026-05-24T00:00:00.000Z',
        }),
      ).toThrow(ValidationError)
    } finally {
      db.close()
    }
  })
})
