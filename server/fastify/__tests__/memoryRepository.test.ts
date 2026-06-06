import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { openDatabase } from '../src/db.js'
import {
  cancelMemoryJob,
  claimNextMemoryJob,
  cleanupOrphanedMemory,
  cleanupOrphanedMemoryWithSummarySnapshot,
  completeMemoryJob,
  createMemoryChunk,
  createMemoryEmbedding,
  createMemoryJob,
  createMemorySummary,
  decodeEmbeddingVector,
  encodeEmbeddingVector,
  enqueueMemoryJob,
  failMemoryJob,
  getMemoryChunk,
  getMemoryEmbedding,
  getMemoryJob,
  listMemoryChunks,
  listMemoryEmbeddings,
  listMemoryJobs,
  listMemorySummaries,
  loadMemorySummarySnapshot,
  mapMemoryJobRow,
  pruneTerminalMemoryJobs,
  recoverRunningMemoryJobs,
  retryOrFailMemoryJob,
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

describe('memory repository orphan cleanup', () => {
  it('deletes orphaned summaries and chunks while cascading embeddings', () => {
    const db = openDatabase(makeDataDir())
    try {
      createMemoryChunk(db, {
        id: 'chunk-keep',
        chatId: 'chat-1',
        rangeStartSeq: 0,
        rangeEndSeq: 1,
        text: 'keep chunk',
        status: 'summarized',
      })
      createMemoryChunk(db, {
        id: 'chunk-delete',
        chatId: 'chat-1',
        rangeStartSeq: 2,
        rangeEndSeq: 3,
        text: 'delete chunk',
        status: 'summarized',
      })
      createMemoryChunk(db, {
        id: 'chunk-other-chat',
        chatId: 'chat-2',
        rangeStartSeq: 0,
        rangeEndSeq: 1,
        text: 'other chunk',
        status: 'summarized',
      })
      createMemorySummary(db, {
        id: 'summary-keep',
        chatId: 'chat-1',
        chunkId: 'chunk-keep',
        model: 'model-a',
        text: 'keep summary',
        metadata: { chatMemos: ['memo-a', 'memo-b'] },
        tokens: 3,
      })
      createMemorySummary(db, {
        id: 'summary-delete',
        chatId: 'chat-1',
        chunkId: 'chunk-delete',
        model: 'model-a',
        text: 'delete summary',
        metadata: { chatMemos: ['memo-missing'] },
        tokens: 3,
      })
      createMemorySummary(db, {
        id: 'summary-other-chat',
        chatId: 'chat-2',
        chunkId: 'chunk-other-chat',
        model: 'model-a',
        text: 'other summary',
        metadata: { chatMemos: ['memo-missing'] },
        tokens: 3,
      })
      createMemoryEmbedding(db, {
        id: 'embedding-delete',
        chatId: 'chat-1',
        chunkId: 'chunk-delete',
        model: 'embed-a',
        vector: [1, 2],
      })

      expect(
        cleanupOrphanedMemory(db, {
          chatId: 'chat-1',
          currentChatMemos: ['memo-a', 'memo-b'],
        }),
      ).toEqual({ summariesDeleted: 1, chunksDeleted: 1 })

      expect(listMemorySummaries(db, { chatId: 'chat-1' }).map((row) => row.id)).toEqual([
        'summary-keep',
      ])
      expect(listMemoryChunks(db, { chatId: 'chat-1' }).map((row) => row.id)).toEqual([
        'chunk-keep',
      ])
      expect(getMemoryEmbedding(db, 'embedding-delete')).toBeNull()
      expect(listMemorySummaries(db, { chatId: 'chat-2' }).map((row) => row.id)).toEqual([
        'summary-other-chat',
      ])
    } finally {
      db.close()
    }
  })

  it('preserves orphaned rows when requested', () => {
    const db = openDatabase(makeDataDir())
    try {
      createMemoryChunk(db, {
        id: 'chunk-1',
        chatId: 'chat-1',
        rangeStartSeq: 0,
        rangeEndSeq: 1,
        text: 'chunk text',
        status: 'summarized',
      })
      createMemorySummary(db, {
        id: 'summary-1',
        chatId: 'chat-1',
        chunkId: 'chunk-1',
        model: 'model-a',
        text: 'summary text',
        metadata: { chatMemos: ['removed-memo'] },
        tokens: 3,
      })

      expect(
        cleanupOrphanedMemory(db, {
          chatId: 'chat-1',
          currentChatMemos: [],
          preserveOrphanedMemory: true,
        }),
      ).toEqual({ summariesDeleted: 0, chunksDeleted: 0 })

      expect(listMemorySummaries(db, { chatId: 'chat-1' }).map((row) => row.id)).toEqual([
        'summary-1',
      ])
      expect(listMemoryChunks(db, { chatId: 'chat-1' }).map((row) => row.id)).toEqual([
        'chunk-1',
      ])
    } finally {
      db.close()
    }
  })

  it('opens no write transaction when the chat has no summaries at all (L16)', () => {
    const db = openDatabase(makeDataDir())
    try {
      const execCalls: string[] = []
      const preparedSql: string[] = []
      const originalExec = db.exec.bind(db)
      const originalPrepare = db.prepare.bind(db)
      db.exec = ((sql: string) => {
        execCalls.push(sql)
        return originalExec(sql)
      }) as typeof db.exec
      db.prepare = ((sql: string) => {
        preparedSql.push(sql)
        return originalPrepare(sql)
      }) as typeof db.prepare

      expect(
        cleanupOrphanedMemory(db, {
          chatId: 'chat-1',
          currentChatMemos: ['memo-a'],
        }),
      ).toEqual({ summariesDeleted: 0, chunksDeleted: 0 })

      expect(execCalls.filter((sql) => sql.includes('BEGIN'))).toEqual([])
      // The cheap EXISTS probe ran, but the summary metadata re-parse did not.
      expect(preparedSql.some((sql) => sql.includes('SELECT 1 AS present'))).toBe(true)
      expect(preparedSql.some((sql) => sql.includes('SELECT *'))).toBe(false)
    } finally {
      db.close()
    }
  })

  it('opens no write transaction when summaries exist but none are orphaned (L16)', () => {
    const db = openDatabase(makeDataDir())
    try {
      createMemoryChunk(db, {
        id: 'chunk-kept',
        chatId: 'chat-1',
        rangeStartSeq: 0,
        rangeEndSeq: 1,
        text: 'kept chunk',
        status: 'summarized',
      })
      createMemorySummary(db, {
        id: 'summary-kept',
        chatId: 'chat-1',
        chunkId: 'chunk-kept',
        model: 'model-a',
        text: 'kept summary',
        metadata: { chatMemos: ['memo-a'] },
        tokens: 3,
      })

      const execCalls: string[] = []
      const originalExec = db.exec.bind(db)
      db.exec = ((sql: string) => {
        execCalls.push(sql)
        return originalExec(sql)
      }) as typeof db.exec

      expect(
        cleanupOrphanedMemory(db, {
          chatId: 'chat-1',
          currentChatMemos: ['memo-a', 'memo-b'],
        }),
      ).toEqual({ summariesDeleted: 0, chunksDeleted: 0 })

      expect(execCalls.filter((sql) => sql.includes('BEGIN'))).toEqual([])
      expect(listMemorySummaries(db, { chatId: 'chat-1' }).map((row) => row.id)).toEqual([
        'summary-kept',
      ])
    } finally {
      db.close()
    }
  })

  it('deletes partially matching memo sets and remains idempotent', () => {
    const db = openDatabase(makeDataDir())
    try {
      createMemoryChunk(db, {
        id: 'chunk-partial',
        chatId: 'chat-1',
        rangeStartSeq: 0,
        rangeEndSeq: 2,
        text: 'partial chunk',
        status: 'summarized',
      })
      createMemoryChunk(db, {
        id: 'chunk-unknown-metadata',
        chatId: 'chat-1',
        rangeStartSeq: 3,
        rangeEndSeq: 4,
        text: 'unknown metadata chunk',
        status: 'summarized',
      })
      createMemorySummary(db, {
        id: 'summary-partial',
        chatId: 'chat-1',
        chunkId: 'chunk-partial',
        model: 'model-a',
        text: 'partial summary',
        metadata: { chatMemos: ['memo-a', 'memo-gone'] },
        tokens: 3,
      })
      createMemorySummary(db, {
        id: 'summary-unknown-metadata',
        chatId: 'chat-1',
        chunkId: 'chunk-unknown-metadata',
        model: 'model-a',
        text: 'unknown metadata summary',
        metadata: { source: 'legacy-hypav3' },
        tokens: 3,
      })

      expect(
        cleanupOrphanedMemory(db, {
          chatId: 'chat-1',
          currentChatMemos: ['memo-a'],
        }),
      ).toEqual({ summariesDeleted: 1, chunksDeleted: 1 })
      expect(
        cleanupOrphanedMemory(db, {
          chatId: 'chat-1',
          currentChatMemos: ['memo-a'],
        }),
      ).toEqual({ summariesDeleted: 0, chunksDeleted: 0 })

      expect(listMemorySummaries(db, { chatId: 'chat-1' }).map((row) => row.id)).toEqual([
        'summary-unknown-metadata',
      ])
      expect(listMemoryChunks(db, { chatId: 'chat-1' }).map((row) => row.id)).toEqual([
        'chunk-unknown-metadata',
      ])
    } finally {
      db.close()
    }
  })

  it('L20: cleans orphaned rows from a shared summary snapshot and returns retained summaries', () => {
    const db = openDatabase(makeDataDir())
    try {
      createMemoryChunk(db, {
        id: 'chunk-keep',
        chatId: 'chat-1',
        rangeStartSeq: 0,
        rangeEndSeq: 1,
        text: 'keep chunk',
        status: 'summarized',
      })
      createMemoryChunk(db, {
        id: 'chunk-delete',
        chatId: 'chat-1',
        rangeStartSeq: 2,
        rangeEndSeq: 3,
        text: 'delete chunk',
        status: 'summarized',
      })
      createMemorySummary(db, {
        id: 'summary-keep',
        chatId: 'chat-1',
        chunkId: 'chunk-keep',
        model: 'summary-model',
        text: 'keep summary',
        metadata: { chatMemos: ['memo-a'] },
        tokens: 3,
      })
      createMemorySummary(db, {
        id: 'summary-delete-other-model',
        chatId: 'chat-1',
        chunkId: 'chunk-delete',
        model: 'other-summary-model',
        text: 'delete summary',
        metadata: { chatMemos: ['removed-memo'] },
        tokens: 3,
      })

      const snapshot = loadMemorySummarySnapshot(db, { chatId: 'chat-1' })
      const result = cleanupOrphanedMemoryWithSummarySnapshot(db, {
        chatId: 'chat-1',
        currentChatMemos: ['memo-a'],
        summarySnapshot: snapshot,
      })

      expect(result.cleanup).toEqual({ summariesDeleted: 1, chunksDeleted: 1 })
      expect(result.summarySnapshot.summaries.map((summary) => summary.id)).toEqual([
        'summary-keep',
      ])
      expect(listMemorySummaries(db, { chatId: 'chat-1' }).map((summary) => summary.id)).toEqual([
        'summary-keep',
      ])
      expect(listMemoryChunks(db, { chatId: 'chat-1' }).map((chunk) => chunk.id)).toEqual([
        'chunk-keep',
      ])
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
        attemptCount: 0,
        maxAttempts: 3,
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
      expect(listMemoryJobs(db, { statuses: ['pending', 'running'] }).map((row) => row.id)).toEqual(
        ['job-1', 'job-2', 'job-3'],
      )

      expect(
        updateMemoryJob(db, 'job-1', {
          status: 'failed',
          payload: { chunkId: 'chunk-1', retryable: false },
          error: 'summary failed',
          attemptCount: 2,
          maxAttempts: 4,
          nextRunAt: '2026-05-24T01:00:00.000Z',
        }),
      ).toMatchObject({
        id: 'job-1',
        status: 'failed',
        payload: { chunkId: 'chunk-1', retryable: false },
        error: 'summary failed',
        attemptCount: 2,
        maxAttempts: 4,
        nextRunAt: '2026-05-24T01:00:00.000Z',
      })
      expect(updateMemoryJob(db, 'missing', { status: 'cancelled' })).toBeNull()
    } finally {
      db.close()
    }
  })

  it('enqueues and claims pending jobs in deterministic queue order', () => {
    const db = openDatabase(makeDataDir())
    try {
      const enqueued = enqueueMemoryJob(db, {
        id: 'job-b',
        chatId: 'chat-1',
        kind: 'summarize',
        payload: { chunkId: 'chunk-2' },
      })
      enqueueMemoryJob(db, {
        id: 'job-a',
        chatId: 'chat-1',
        kind: 'summarize',
        payload: { chunkId: 'chunk-1' },
      })
      enqueueMemoryJob(db, {
        id: 'job-c',
        chatId: 'chat-2',
        kind: 'embed',
        payload: { chunkId: 'chunk-3' },
      })
      db.prepare("UPDATE memory_jobs SET created_at = '2026-05-24T00:00:00.000Z'").run()

      expect(enqueued).toMatchObject({
        id: 'job-b',
        chatId: 'chat-1',
        kind: 'summarize',
        status: 'pending',
        error: null,
      })
      expect(claimNextMemoryJob(db, { kind: 'embed' })).toMatchObject({
        id: 'job-c',
        status: 'running',
        attemptCount: 1,
      })
      expect(claimNextMemoryJob(db, { chatId: 'chat-1' })).toMatchObject({
        id: 'job-a',
        status: 'running',
        attemptCount: 1,
      })
      expect(claimNextMemoryJob(db, { chatId: 'chat-1' })).toMatchObject({
        id: 'job-b',
        status: 'running',
        attemptCount: 1,
      })
      expect(claimNextMemoryJob(db)).toBeNull()
      expect(listMemoryJobs(db, { status: 'pending' })).toEqual([])
    } finally {
      db.close()
    }
  })

  it('ignores pending jobs until their next run time arrives', () => {
    const db = openDatabase(makeDataDir())
    try {
      enqueueMemoryJob(db, {
        id: 'job-later',
        chatId: 'chat-1',
        kind: 'summarize',
        payload: {},
        nextRunAt: '2026-05-24T00:01:00.000Z',
      })
      enqueueMemoryJob(db, {
        id: 'job-now',
        chatId: 'chat-1',
        kind: 'summarize',
        payload: {},
        nextRunAt: '2026-05-24T00:00:00.000Z',
      })

      expect(claimNextMemoryJob(db, { now: '2026-05-24T00:00:30.000Z' })).toMatchObject({
        id: 'job-now',
        status: 'running',
      })
      expect(claimNextMemoryJob(db, { now: '2026-05-24T00:00:30.000Z' })).toBeNull()
      expect(claimNextMemoryJob(db, { now: '2026-05-24T00:01:00.000Z' })).toMatchObject({
        id: 'job-later',
        status: 'running',
      })
    } finally {
      db.close()
    }
  })

  it('retries running jobs with exponential backoff before max-attempt failure', () => {
    const db = openDatabase(makeDataDir())
    try {
      enqueueMemoryJob(db, {
        id: 'job-retry',
        chatId: 'chat-1',
        kind: 'summarize',
        payload: {},
        maxAttempts: 3,
        nextRunAt: '2026-05-24T00:00:00.000Z',
      })

      expect(claimNextMemoryJob(db, { now: '2026-05-24T00:00:00.000Z' })).toMatchObject({
        id: 'job-retry',
        attemptCount: 1,
      })
      expect(
        retryOrFailMemoryJob(db, 'job-retry', 'first failure', {
          now: '2026-05-24T00:00:00.000Z',
          backoffBaseMs: 1_000,
        }),
      ).toMatchObject({
        id: 'job-retry',
        status: 'pending',
        error: 'first failure',
        attemptCount: 1,
        nextRunAt: '2026-05-24T00:00:01.000Z',
      })
      expect(claimNextMemoryJob(db, { now: '2026-05-24T00:00:00.999Z' })).toBeNull()
      expect(claimNextMemoryJob(db, { now: '2026-05-24T00:00:01.000Z' })).toMatchObject({
        id: 'job-retry',
        attemptCount: 2,
      })
      expect(
        retryOrFailMemoryJob(db, 'job-retry', 'second failure', {
          now: '2026-05-24T00:00:01.000Z',
          backoffBaseMs: 1_000,
        }),
      ).toMatchObject({
        status: 'pending',
        attemptCount: 2,
        nextRunAt: '2026-05-24T00:00:03.000Z',
      })
      expect(claimNextMemoryJob(db, { now: '2026-05-24T00:00:03.000Z' })).toMatchObject({
        id: 'job-retry',
        attemptCount: 3,
      })
      expect(
        retryOrFailMemoryJob(db, 'job-retry', 'final failure', {
          now: '2026-05-24T00:00:03.000Z',
          backoffBaseMs: 1_000,
        }),
      ).toMatchObject({
        status: 'failed',
        error: 'final failure',
        attemptCount: 3,
      })
    } finally {
      db.close()
    }
  })

  it('recovers abandoned running jobs on boot', () => {
    const db = openDatabase(makeDataDir())
    try {
      createMemoryJob(db, {
        id: 'job-recover',
        chatId: 'chat-1',
        kind: 'chunk',
        payload: {},
        status: 'running',
        attemptCount: 1,
        maxAttempts: 3,
      })
      createMemoryJob(db, {
        id: 'job-exhausted',
        chatId: 'chat-1',
        kind: 'embed',
        payload: {},
        status: 'running',
        attemptCount: 2,
        maxAttempts: 2,
      })

      expect(
        recoverRunningMemoryJobs(db, {
          now: '2026-05-24T00:00:00.000Z',
          backoffBaseMs: 1_000,
        })
          .map((job) => [job.id, job.status, job.nextRunAt])
          .sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
      ).toEqual([
        ['job-exhausted', 'failed', expect.any(String)],
        ['job-recover', 'pending', '2026-05-24T00:00:01.000Z'],
      ])
      expect(getMemoryJob(db, 'job-exhausted')).toMatchObject({
        status: 'failed',
        error: 'memory job was abandoned while running',
      })
    } finally {
      db.close()
    }
  })

  it('completes, fails, and cancels only legal queue transitions', () => {
    const db = openDatabase(makeDataDir())
    try {
      enqueueMemoryJob(db, {
        id: 'complete-me',
        chatId: 'chat-1',
        kind: 'chunk',
        payload: {},
      })
      enqueueMemoryJob(db, {
        id: 'fail-me',
        chatId: 'chat-1',
        kind: 'summarize',
        payload: { chunkId: 'chunk-1' },
      })
      enqueueMemoryJob(db, {
        id: 'cancel-pending',
        chatId: 'chat-1',
        kind: 'embed',
        payload: { chunkId: 'chunk-1' },
      })
      enqueueMemoryJob(db, {
        id: 'cancel-running',
        chatId: 'chat-1',
        kind: 'embed',
        payload: { chunkId: 'chunk-2' },
      })

      expect(completeMemoryJob(db, 'complete-me')).toBeNull()
      expect(failMemoryJob(db, 'fail-me', 'not running yet')).toBeNull()

      expect(claimNextMemoryJob(db, { kind: 'chunk' })).toMatchObject({ id: 'complete-me' })
      expect(completeMemoryJob(db, 'complete-me')).toMatchObject({
        id: 'complete-me',
        status: 'completed',
        error: null,
      })
      expect(failMemoryJob(db, 'complete-me', 'too late')).toBeNull()
      expect(cancelMemoryJob(db, 'complete-me')).toBeNull()

      expect(claimNextMemoryJob(db, { kind: 'summarize' })).toMatchObject({ id: 'fail-me' })
      expect(failMemoryJob(db, 'fail-me', 'summary failed')).toMatchObject({
        id: 'fail-me',
        status: 'failed',
        error: 'summary failed',
      })
      expect(completeMemoryJob(db, 'fail-me')).toBeNull()

      expect(cancelMemoryJob(db, 'cancel-pending')).toMatchObject({
        id: 'cancel-pending',
        status: 'cancelled',
        error: null,
      })
      expect(claimNextMemoryJob(db, { kind: 'embed' })).toMatchObject({ id: 'cancel-running' })
      expect(cancelMemoryJob(db, 'cancel-running')).toMatchObject({
        id: 'cancel-running',
        status: 'cancelled',
      })
      expect(cancelMemoryJob(db, 'cancel-running')).toBeNull()
      expect(completeMemoryJob(db, 'missing')).toBeNull()
    } finally {
      db.close()
    }
  })

  it('L17: prunes only terminal memory jobs older than retention', () => {
    const db = openDatabase(makeDataDir())
    try {
      for (const [id, status] of [
        ['old-cancelled', 'cancelled'],
        ['old-completed', 'completed'],
        ['old-failed', 'failed'],
        ['recent-completed', 'completed'],
        ['pending-old', 'pending'],
        ['running-old', 'running'],
      ] as const) {
        createMemoryJob(db, {
          id,
          chatId: 'chat-1',
          kind: 'chunk',
          payload: {},
          status,
        })
      }
      db.prepare(
        `
          UPDATE memory_jobs
          SET updated_at = '2026-06-01T00:00:00.000Z'
          WHERE id IN ('old-cancelled', 'old-completed', 'old-failed', 'pending-old', 'running-old')
        `,
      ).run()
      db.prepare(
        `
          UPDATE memory_jobs
          SET updated_at = '2026-06-05T12:00:00.000Z'
          WHERE id = 'recent-completed'
        `,
      ).run()

      expect(
        pruneTerminalMemoryJobs(db, {
          now: '2026-06-06T00:00:00.000Z',
          retentionMs: 24 * 60 * 60 * 1000,
          maxPerSweep: 2,
        }),
      ).toBe(2)
      expect(getMemoryJob(db, 'old-failed')).toMatchObject({ status: 'failed' })

      expect(
        pruneTerminalMemoryJobs(db, {
          now: '2026-06-06T00:00:00.000Z',
          retentionMs: 24 * 60 * 60 * 1000,
        }),
      ).toBe(1)

      expect(
        listMemoryJobs(db)
          .map((job) => [job.id, job.status])
          .sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
      ).toEqual([
        ['pending-old', 'pending'],
        ['recent-completed', 'completed'],
        ['running-old', 'running'],
      ])
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
      expect(() => updateMemoryJob(db, 'job-1', { attemptCount: -1 })).toThrow(ValidationError)
      expect(() => updateMemoryJob(db, 'job-1', { maxAttempts: 0 })).toThrow(ValidationError)
      expect(() => updateMemoryJob(db, 'job-1', { nextRunAt: 'not a date' })).toThrow(
        ValidationError,
      )
      expect(() =>
        enqueueMemoryJob(db, {
          id: '',
          chatId: 'chat-1',
          kind: 'chunk',
          payload: {},
        }),
      ).toThrow(ValidationError)
      expect(() => listMemoryJobs(db, { statuses: [] })).toThrow(ValidationError)
      expect(() => failMemoryJob(db, 'job-1', '')).toThrow(ValidationError)

      expect(() =>
        mapMemoryJobRow({
          id: 'job-row',
          chat_id: 'chat-1',
          kind: 'translate',
          status: 'pending',
          payload_json: '{}',
          error: null,
          attempt_count: 0,
          max_attempts: 3,
          next_run_at: '2026-05-24T00:00:00.000Z',
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
          attempt_count: 0,
          max_attempts: 3,
          next_run_at: '2026-05-24T00:00:00.000Z',
          created_at: '2026-05-24T00:00:00.000Z',
          updated_at: '2026-05-24T00:00:00.000Z',
        }),
      ).toThrow(ValidationError)
    } finally {
      db.close()
    }
  })
})
