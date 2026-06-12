import type { DatabaseSync, StatementSync } from 'node:sqlite'
import { ValidationError } from './repository.js'

export const MEMORY_CHUNK_STATUSES = ['pending', 'summarized', 'failed'] as const
export const MEMORY_JOB_KINDS = ['chunk', 'embed', 'summarize'] as const
export const MEMORY_JOB_STATUSES = ['pending', 'running', 'completed', 'failed', 'cancelled'] as const
export const MEMORY_JOB_DEFAULT_MAX_ATTEMPTS = 3
export const MEMORY_JOB_DEFAULT_RETRY_BACKOFF_MS = 1_000
const DAY_MS = 24 * 60 * 60 * 1000

export const MEMORY_JOB_TERMINAL_RETENTION_MS = 7 * DAY_MS
export const MEMORY_JOB_TERMINAL_RETENTION_SWEEP_LIMIT = 1000
export const MEMORY_JOB_TERMINAL_STATUSES = ['completed', 'failed', 'cancelled'] as const

export type MemoryChunkStatus = (typeof MEMORY_CHUNK_STATUSES)[number]
export type MemoryJobKind = (typeof MEMORY_JOB_KINDS)[number]
export type MemoryJobStatus = (typeof MEMORY_JOB_STATUSES)[number]

export interface MemoryChunk {
  id: string
  chatId: string
  messageId: string | null
  rangeStartSeq: number
  rangeEndSeq: number
  text: string
  status: MemoryChunkStatus
  createdAt: string
  updatedAt: string
}

export interface CreateMemoryChunkInput {
  id: string
  chatId: string
  messageId?: string | null
  rangeStartSeq: number
  rangeEndSeq: number
  text: string
  status?: MemoryChunkStatus
}

export interface MemorySummary {
  id: string
  chatId: string
  chunkId: string
  model: string
  text: string
  metadata: unknown | null
  tokens: number
  createdAt: string
}

export interface CreateMemorySummaryInput {
  id: string
  chatId: string
  chunkId: string
  model: string
  text: string
  metadata?: unknown | null
  tokens: number
}

export interface MemoryEmbedding {
  id: string
  chatId: string
  chunkId: string
  model: string
  vector: Float32Array
  dim: number
  groupId: string | null
  groupIndex: number | null
  createdAt: string
}

export interface CreateMemoryEmbeddingInput {
  id: string
  chatId: string
  chunkId: string
  model: string
  vector: Float32Array | number[]
  groupId?: string | null
  groupIndex?: number | null
}

export interface MemoryJob {
  id: string
  chatId: string
  kind: MemoryJobKind
  status: MemoryJobStatus
  payload: unknown
  error: string | null
  attemptCount: number
  maxAttempts: number
  nextRunAt: string
  createdAt: string
  updatedAt: string
}

export interface CreateMemoryJobInput {
  id: string
  chatId: string
  kind: MemoryJobKind
  payload: unknown
  status?: MemoryJobStatus
  error?: string | null
  attemptCount?: number
  maxAttempts?: number
  nextRunAt?: string
}

export interface EnqueueMemoryJobInput {
  id: string
  chatId: string
  kind: MemoryJobKind
  payload: unknown
  maxAttempts?: number
  nextRunAt?: string
}

export interface MemoryJobRetryOptions {
  now?: string | Date
  backoffBaseMs?: number
}

export interface PruneTerminalMemoryJobsOptions {
  now?: string | Date
  retentionMs?: number
  maxPerSweep?: number
}

export interface CleanupOrphanedMemoryInput {
  chatId: string
  currentChatMemos: readonly string[]
  preserveOrphanedMemory?: boolean
}

export interface CleanupOrphanedMemoryResult {
  summariesDeleted: number
  chunksDeleted: number
}

export interface MemorySummarySnapshot {
  chatId: string
  summaries: MemorySummary[]
}

export interface CleanupOrphanedMemoryWithSummarySnapshotInput extends CleanupOrphanedMemoryInput {
  summarySnapshot: MemorySummarySnapshot
}

export interface CleanupOrphanedMemoryWithSummarySnapshotResult {
  cleanup: CleanupOrphanedMemoryResult
  summarySnapshot: MemorySummarySnapshot
}

type SqlValue = string | number | bigint | null | Buffer

interface MemoryChunkRow {
  id: string
  chat_id: string
  message_id: string | null
  range_start_seq: number
  range_end_seq: number
  text: string
  status: string
  created_at: string
  updated_at: string
}

interface MemorySummaryRow {
  id: string
  chat_id: string
  chunk_id: string
  model: string
  text: string
  metadata_json: string | null
  tokens: number
  created_at: string
}

interface MemoryEmbeddingRow {
  id: string
  chat_id: string
  chunk_id: string
  model: string
  vector_blob: Uint8Array
  dim: number
  group_id: string | null
  group_index: number | null
  created_at: string
}

interface MemoryJobRow {
  id: string
  chat_id: string
  kind: string
  status: string
  payload_json: string
  error: string | null
  attempt_count: number
  max_attempts: number
  next_run_at: string
  created_at: string
  updated_at: string
}

function isOneOf<T extends readonly string[]>(values: T, value: string): value is T[number] {
  return (values as readonly string[]).includes(value)
}

function requireString(value: string, name: string): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ValidationError(`${name} must be a non-empty string`)
  }
}

function requireInteger(value: number, name: string): void {
  if (!Number.isInteger(value)) {
    throw new ValidationError(`${name} must be an integer`)
  }
}

function requireNonNegativeInteger(value: number, name: string): void {
  requireInteger(value, name)
  if (value < 0) {
    throw new ValidationError(`${name} must be >= 0`)
  }
}

function requirePositiveInteger(value: number, name: string): void {
  requireInteger(value, name)
  if (value <= 0) {
    throw new ValidationError(`${name} must be > 0`)
  }
}

function requireTimestamp(value: string, name: string): void {
  requireString(value, name)
  if (Number.isNaN(Date.parse(value))) {
    throw new ValidationError(`${name} must be a valid timestamp`)
  }
}

function requireChunkStatus(value: string): MemoryChunkStatus {
  if (!isOneOf(MEMORY_CHUNK_STATUSES, value)) {
    throw new ValidationError(`Invalid memory chunk status: ${value}`)
  }
  return value
}

function requireJobKind(value: string): MemoryJobKind {
  if (!isOneOf(MEMORY_JOB_KINDS, value)) {
    throw new ValidationError(`Invalid memory job kind: ${value}`)
  }
  return value
}

function requireJobStatus(value: string): MemoryJobStatus {
  if (!isOneOf(MEMORY_JOB_STATUSES, value)) {
    throw new ValidationError(`Invalid memory job status: ${value}`)
  }
  return value
}

function requireJobStatusList(statuses: readonly MemoryJobStatus[]): MemoryJobStatus[] {
  if (statuses.length === 0) {
    throw new ValidationError('memory job statuses filter must not be empty')
  }
  return statuses.map((status) => requireJobStatus(status))
}

function requireRetentionMs(value: number | undefined): number {
  if (value === undefined) return MEMORY_JOB_TERMINAL_RETENTION_MS
  requireNonNegativeInteger(value, 'retentionMs')
  return value
}

function requireSweepLimit(value: number | undefined): number {
  if (value === undefined) return MEMORY_JOB_TERMINAL_RETENTION_SWEEP_LIMIT
  requirePositiveInteger(value, 'maxPerSweep')
  return value
}

function runStatement(statement: StatementSync, ...values: SqlValue[]): void {
  try {
    statement.run(...values)
  } catch (err) {
    if (err instanceof Error && /constraint/i.test(err.message)) {
      throw new ValidationError(err.message)
    }
    throw err
  }
}

function getRow<TRow>(statement: StatementSync, ...values: SqlValue[]): TRow | undefined {
  return statement.get(...values) as unknown as TRow | undefined
}

function allRows<TRow>(statement: StatementSync, ...values: SqlValue[]): TRow[] {
  return statement.all(...values) as unknown as TRow[]
}

function normalizeTimestamp(value: string | Date | undefined): string {
  if (value === undefined) return new Date().toISOString()
  const iso = value instanceof Date ? value.toISOString() : value
  requireTimestamp(iso, 'timestamp')
  return iso
}

function addMilliseconds(timestamp: string, milliseconds: number): string {
  return new Date(Date.parse(timestamp) + milliseconds).toISOString()
}

export function calculateMemoryJobRetryDelayMs(
  attemptCount: number,
  backoffBaseMs = MEMORY_JOB_DEFAULT_RETRY_BACKOFF_MS,
): number {
  requireNonNegativeInteger(attemptCount, 'attemptCount')
  if (!Number.isFinite(backoffBaseMs) || backoffBaseMs < 0) {
    throw new ValidationError('backoffBaseMs must be >= 0')
  }
  return Math.floor(backoffBaseMs) * 2 ** Math.max(0, attemptCount - 1)
}

export function encodeEmbeddingVector(vector: Float32Array | number[]): Buffer {
  const values = vector instanceof Float32Array ? vector : Float32Array.from(vector)
  if (values.length === 0) {
    throw new ValidationError('embedding vector must not be empty')
  }
  for (const value of values) {
    if (!Number.isFinite(value)) {
      throw new ValidationError('embedding vector values must be finite numbers')
    }
  }
  return Buffer.from(values.buffer, values.byteOffset, values.byteLength)
}

export function decodeEmbeddingVector(blob: Uint8Array, dim: number): Float32Array {
  requireInteger(dim, 'embedding dim')
  if (dim <= 0) {
    throw new ValidationError('embedding dim must be > 0')
  }
  const buffer = Buffer.from(blob)
  if (buffer.byteLength !== dim * Float32Array.BYTES_PER_ELEMENT) {
    throw new ValidationError(`embedding vector blob length ${buffer.byteLength} does not match dim ${dim}`)
  }
  const copy = new ArrayBuffer(buffer.byteLength)
  new Uint8Array(copy).set(buffer)
  return new Float32Array(copy)
}

export function mapMemoryChunkRow(row: MemoryChunkRow): MemoryChunk {
  return {
    id: row.id,
    chatId: row.chat_id,
    messageId: row.message_id,
    rangeStartSeq: row.range_start_seq,
    rangeEndSeq: row.range_end_seq,
    text: row.text,
    status: requireChunkStatus(row.status),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function mapMemorySummaryRow(row: MemorySummaryRow): MemorySummary {
  let metadata: unknown | null = null
  if (row.metadata_json !== null) {
    try {
      metadata = JSON.parse(row.metadata_json)
    } catch {
      throw new ValidationError(`Invalid memory summary metadata JSON for summary ${row.id}`)
    }
  }
  return {
    id: row.id,
    chatId: row.chat_id,
    chunkId: row.chunk_id,
    model: row.model,
    text: row.text,
    metadata,
    tokens: row.tokens,
    createdAt: row.created_at,
  }
}

export function mapMemoryEmbeddingRow(row: MemoryEmbeddingRow): MemoryEmbedding {
  let decodedVector: Float32Array | undefined
  return {
    id: row.id,
    chatId: row.chat_id,
    chunkId: row.chunk_id,
    model: row.model,
    get vector(): Float32Array {
      decodedVector ??= decodeEmbeddingVector(row.vector_blob, row.dim)
      return decodedVector
    },
    dim: row.dim,
    groupId: row.group_id,
    groupIndex: row.group_index,
    createdAt: row.created_at,
  }
}

export function mapMemoryJobRow(row: MemoryJobRow): MemoryJob {
  let payload: unknown
  try {
    payload = JSON.parse(row.payload_json)
  } catch {
    throw new ValidationError(`Invalid memory job payload JSON for job ${row.id}`)
  }
  return {
    id: row.id,
    chatId: row.chat_id,
    kind: requireJobKind(row.kind),
    status: requireJobStatus(row.status),
    payload,
    error: row.error,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    nextRunAt: row.next_run_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function stringifyPayload(payload: unknown): string {
  const json = JSON.stringify(payload)
  if (json === undefined) {
    throw new ValidationError('memory job payload must be JSON serializable')
  }
  return json
}

function stringifyNullableMetadata(metadata: unknown | null | undefined): string | null {
  if (metadata === undefined || metadata === null) return null
  const json = JSON.stringify(metadata)
  if (json === undefined) {
    throw new ValidationError('memory summary metadata must be JSON serializable')
  }
  return json
}

function readSummaryChatMemos(summary: MemorySummary): string[] | null {
  if (!isRecord(summary.metadata)) return null
  const chatMemos = summary.metadata.chatMemos
  if (!Array.isArray(chatMemos)) return null
  if (!chatMemos.every((memo): memo is string => typeof memo === 'string')) return null
  return chatMemos
}

function isMemoSubset(chatMemos: readonly string[], currentChatMemos: ReadonlySet<string>): boolean {
  return chatMemos.every((memo) => currentChatMemos.has(memo))
}

function deleteByIds(db: DatabaseSync, table: string, ids: readonly string[]): void {
  if (ids.length === 0) return
  const placeholders = ids.map(() => '?').join(', ')
  runStatement(db.prepare(`DELETE FROM ${table} WHERE id IN (${placeholders})`), ...ids)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function createMemoryChunk(db: DatabaseSync, input: CreateMemoryChunkInput): MemoryChunk {
  requireString(input.id, 'chunk id')
  requireString(input.chatId, 'chat id')
  requireNonNegativeInteger(input.rangeStartSeq, 'rangeStartSeq')
  requireNonNegativeInteger(input.rangeEndSeq, 'rangeEndSeq')
  if (input.rangeEndSeq < input.rangeStartSeq) {
    throw new ValidationError('rangeEndSeq must be >= rangeStartSeq')
  }
  requireString(input.text, 'chunk text')
  const status = input.status ?? 'pending'
  requireChunkStatus(status)
  runStatement(
    db.prepare(`
      INSERT INTO memory_chunks (
        id,
        chat_id,
        message_id,
        range_start_seq,
        range_end_seq,
        text,
        status
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    input.id,
    input.chatId,
    input.messageId ?? null,
    input.rangeStartSeq,
    input.rangeEndSeq,
    input.text,
    status,
  )
  return getMemoryChunk(db, input.id) as MemoryChunk
}

export function getMemoryChunk(db: DatabaseSync, id: string): MemoryChunk | null {
  requireString(id, 'chunk id')
  const row = getRow<MemoryChunkRow>(db.prepare('SELECT * FROM memory_chunks WHERE id = ?'), id)
  return row ? mapMemoryChunkRow(row) : null
}

export function listMemoryChunks(
  db: DatabaseSync,
  filter: { chatId?: string; status?: MemoryChunkStatus } = {},
): MemoryChunk[] {
  const conditions: string[] = []
  const values: SqlValue[] = []
  if (filter.chatId !== undefined) {
    requireString(filter.chatId, 'chat id')
    conditions.push('chat_id = ?')
    values.push(filter.chatId)
  }
  if (filter.status !== undefined) {
    conditions.push('status = ?')
    values.push(requireChunkStatus(filter.status))
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const rows = allRows<MemoryChunkRow>(
    db.prepare(`
        SELECT *
        FROM memory_chunks
        ${where}
        ORDER BY chat_id, range_start_seq, range_end_seq, created_at, id
      `),
    ...values,
  )
  return rows.map(mapMemoryChunkRow)
}

export function updateMemoryChunkStatus(db: DatabaseSync, id: string, status: MemoryChunkStatus): MemoryChunk | null {
  requireString(id, 'chunk id')
  runStatement(
    db.prepare(`
      UPDATE memory_chunks
      SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?
    `),
    requireChunkStatus(status),
    id,
  )
  return getMemoryChunk(db, id)
}

export function createMemorySummary(db: DatabaseSync, input: CreateMemorySummaryInput): MemorySummary {
  requireString(input.id, 'summary id')
  requireString(input.chatId, 'chat id')
  requireString(input.chunkId, 'chunk id')
  requireString(input.model, 'summary model')
  requireString(input.text, 'summary text')
  requireNonNegativeInteger(input.tokens, 'summary tokens')
  runStatement(
    db.prepare(`
      INSERT INTO memory_summaries (
        id,
        chat_id,
        chunk_id,
        model,
        text,
        metadata_json,
        tokens
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    input.id,
    input.chatId,
    input.chunkId,
    input.model,
    input.text,
    stringifyNullableMetadata(input.metadata),
    input.tokens,
  )
  return getMemorySummary(db, input.id) as MemorySummary
}

export function getMemorySummary(db: DatabaseSync, id: string): MemorySummary | null {
  requireString(id, 'summary id')
  const row = getRow<MemorySummaryRow>(db.prepare('SELECT * FROM memory_summaries WHERE id = ?'), id)
  return row ? mapMemorySummaryRow(row) : null
}

export function listMemorySummaries(
  db: DatabaseSync,
  filter: { chatId?: string; chunkId?: string; model?: string } = {},
): MemorySummary[] {
  const conditions: string[] = []
  const values: SqlValue[] = []
  if (filter.chatId !== undefined) {
    requireString(filter.chatId, 'chat id')
    conditions.push('chat_id = ?')
    values.push(filter.chatId)
  }
  if (filter.chunkId !== undefined) {
    requireString(filter.chunkId, 'chunk id')
    conditions.push('chunk_id = ?')
    values.push(filter.chunkId)
  }
  if (filter.model !== undefined) {
    requireString(filter.model, 'summary model')
    conditions.push('model = ?')
    values.push(filter.model)
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const rows = allRows<MemorySummaryRow>(
    db.prepare(`
        SELECT *
        FROM memory_summaries
        ${where}
        ORDER BY chat_id, created_at, id
      `),
    ...values,
  )
  return rows.map(mapMemorySummaryRow)
}

export function loadMemorySummarySnapshot(db: DatabaseSync, input: { chatId: string }): MemorySummarySnapshot {
  requireString(input.chatId, 'chat id')
  return {
    chatId: input.chatId,
    summaries: listMemorySummaries(db, { chatId: input.chatId }),
  }
}

export function cleanupOrphanedMemory(
  db: DatabaseSync,
  input: CleanupOrphanedMemoryInput,
): CleanupOrphanedMemoryResult {
  requireString(input.chatId, 'chat id')
  for (const memo of input.currentChatMemos) {
    requireString(memo, 'current chat memo')
  }
  if (input.preserveOrphanedMemory === true) {
    return { summariesDeleted: 0, chunksDeleted: 0 }
  }

  // Cheap pre-check (audit L16): the overwhelming case is a chat with no
  // summaries at all — an id-only EXISTS probe skips the summary metadata
  // re-parse and the write transaction entirely.
  const hasSummaries = getRow<{ present: number }>(
    db.prepare('SELECT 1 AS present FROM memory_summaries WHERE chat_id = ? LIMIT 1'),
    input.chatId,
  )
  if (!hasSummaries) {
    return { summariesDeleted: 0, chunksDeleted: 0 }
  }

  return cleanupOrphanedMemoryWithSummarySnapshot(db, {
    ...input,
    summarySnapshot: loadMemorySummarySnapshot(db, { chatId: input.chatId }),
  }).cleanup
}

export function cleanupOrphanedMemoryWithSummarySnapshot(
  db: DatabaseSync,
  input: CleanupOrphanedMemoryWithSummarySnapshotInput,
): CleanupOrphanedMemoryWithSummarySnapshotResult {
  requireString(input.chatId, 'chat id')
  for (const memo of input.currentChatMemos) {
    requireString(memo, 'current chat memo')
  }
  validateMemorySummarySnapshot(input.summarySnapshot, input.chatId)
  if (input.preserveOrphanedMemory === true || input.summarySnapshot.summaries.length === 0) {
    return {
      cleanup: { summariesDeleted: 0, chunksDeleted: 0 },
      summarySnapshot: input.summarySnapshot,
    }
  }

  const currentChatMemos = new Set(input.currentChatMemos)
  const orphanedSummaries = input.summarySnapshot.summaries.filter((summary) => {
    const chatMemos = readSummaryChatMemos(summary)
    return chatMemos !== null && !isMemoSubset(chatMemos, currentChatMemos)
  })
  const summaryIds = orphanedSummaries.map((summary) => summary.id)
  const chunkIds = [...new Set(orphanedSummaries.map((summary) => summary.chunkId))]

  // Nothing orphaned → no `BEGIN IMMEDIATE` write transaction (audit L16).
  // The deletes below would be no-ops; opening a write txn on every
  // generation just contends with the writer for nothing.
  if (summaryIds.length === 0 && chunkIds.length === 0) {
    return {
      cleanup: { summariesDeleted: 0, chunksDeleted: 0 },
      summarySnapshot: input.summarySnapshot,
    }
  }

  db.exec('BEGIN IMMEDIATE')
  try {
    deleteByIds(db, 'memory_summaries', summaryIds)
    deleteByIds(db, 'memory_chunks', chunkIds)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  const deletedSummaryIds = new Set(summaryIds)
  const deletedChunkIds = new Set(chunkIds)
  const retainedSummaries = input.summarySnapshot.summaries.filter(
    (summary) => !deletedSummaryIds.has(summary.id) && !deletedChunkIds.has(summary.chunkId),
  )

  return {
    cleanup: {
      summariesDeleted: summaryIds.length,
      chunksDeleted: chunkIds.length,
    },
    summarySnapshot: {
      chatId: input.summarySnapshot.chatId,
      summaries: retainedSummaries,
    },
  }
}

function validateMemorySummarySnapshot(snapshot: MemorySummarySnapshot, chatId: string): void {
  requireString(snapshot.chatId, 'summary snapshot chat id')
  if (snapshot.chatId !== chatId) {
    throw new ValidationError('memory summary snapshot chatId must match the cleanup chatId')
  }
  for (const summary of snapshot.summaries) {
    if (summary.chatId !== chatId) {
      throw new ValidationError('memory summary snapshot contains summaries from another chat')
    }
  }
}

export function createMemoryEmbedding(db: DatabaseSync, input: CreateMemoryEmbeddingInput): MemoryEmbedding {
  requireString(input.id, 'embedding id')
  requireString(input.chatId, 'chat id')
  requireString(input.chunkId, 'chunk id')
  requireString(input.model, 'embedding model')
  const vectorBlob = encodeEmbeddingVector(input.vector)
  const dim = vectorBlob.byteLength / Float32Array.BYTES_PER_ELEMENT
  const groupIndex = input.groupIndex ?? null
  if (groupIndex !== null) {
    requireNonNegativeInteger(groupIndex, 'embedding groupIndex')
  }
  runStatement(
    db.prepare(`
      INSERT INTO memory_embeddings (
        id,
        chat_id,
        chunk_id,
        model,
        vector_blob,
        dim,
        group_id,
        group_index
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    input.id,
    input.chatId,
    input.chunkId,
    input.model,
    vectorBlob,
    dim,
    input.groupId ?? null,
    groupIndex,
  )
  return getMemoryEmbedding(db, input.id) as MemoryEmbedding
}

export function getMemoryEmbedding(db: DatabaseSync, id: string): MemoryEmbedding | null {
  requireString(id, 'embedding id')
  const row = getRow<MemoryEmbeddingRow>(db.prepare('SELECT * FROM memory_embeddings WHERE id = ?'), id)
  return row ? mapMemoryEmbeddingRow(row) : null
}

export function listMemoryEmbeddings(
  db: DatabaseSync,
  filter: { chatId?: string; chunkId?: string; model?: string; groupId?: string | null } = {},
): MemoryEmbedding[] {
  const conditions: string[] = []
  const values: SqlValue[] = []
  if (filter.chatId !== undefined) {
    requireString(filter.chatId, 'chat id')
    conditions.push('chat_id = ?')
    values.push(filter.chatId)
  }
  if (filter.chunkId !== undefined) {
    requireString(filter.chunkId, 'chunk id')
    conditions.push('chunk_id = ?')
    values.push(filter.chunkId)
  }
  if (filter.model !== undefined) {
    requireString(filter.model, 'embedding model')
    conditions.push('model = ?')
    values.push(filter.model)
  }
  if (filter.groupId !== undefined) {
    if (filter.groupId === null) {
      conditions.push('group_id IS NULL')
    } else {
      requireString(filter.groupId, 'embedding group id')
      conditions.push('group_id = ?')
      values.push(filter.groupId)
    }
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const rows = allRows<MemoryEmbeddingRow>(
    db.prepare(`
        SELECT *
        FROM memory_embeddings
        ${where}
        ORDER BY chat_id, group_id, group_index, created_at, id
      `),
    ...values,
  )
  return rows.map(mapMemoryEmbeddingRow)
}

export function createMemoryJob(db: DatabaseSync, input: CreateMemoryJobInput): MemoryJob {
  requireString(input.id, 'job id')
  requireString(input.chatId, 'chat id')
  const kind = requireJobKind(input.kind)
  const status = input.status ?? 'pending'
  requireJobStatus(status)
  const attemptCount = input.attemptCount ?? 0
  const maxAttempts = input.maxAttempts ?? MEMORY_JOB_DEFAULT_MAX_ATTEMPTS
  const nextRunAt = input.nextRunAt ?? normalizeTimestamp(undefined)
  requireNonNegativeInteger(attemptCount, 'attemptCount')
  requirePositiveInteger(maxAttempts, 'maxAttempts')
  requireTimestamp(nextRunAt, 'nextRunAt')
  runStatement(
    db.prepare(`
      INSERT INTO memory_jobs (
        id,
        chat_id,
        kind,
        status,
        payload_json,
        error,
        attempt_count,
        max_attempts,
        next_run_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    input.id,
    input.chatId,
    kind,
    status,
    stringifyPayload(input.payload),
    input.error ?? null,
    attemptCount,
    maxAttempts,
    nextRunAt,
  )
  return getMemoryJob(db, input.id) as MemoryJob
}

export function enqueueMemoryJob(db: DatabaseSync, input: EnqueueMemoryJobInput): MemoryJob {
  return createMemoryJob(db, {
    id: input.id,
    chatId: input.chatId,
    kind: input.kind,
    payload: input.payload,
    status: 'pending',
    error: null,
    maxAttempts: input.maxAttempts,
    nextRunAt: input.nextRunAt,
  })
}

export function getMemoryJob(db: DatabaseSync, id: string): MemoryJob | null {
  requireString(id, 'job id')
  const row = getRow<MemoryJobRow>(db.prepare('SELECT * FROM memory_jobs WHERE id = ?'), id)
  return row ? mapMemoryJobRow(row) : null
}

export function listMemoryJobs(
  db: DatabaseSync,
  filter: {
    chatId?: string
    kind?: MemoryJobKind
    status?: MemoryJobStatus
    statuses?: readonly MemoryJobStatus[]
  } = {},
): MemoryJob[] {
  const conditions: string[] = []
  const values: SqlValue[] = []
  if (filter.chatId !== undefined) {
    requireString(filter.chatId, 'chat id')
    conditions.push('chat_id = ?')
    values.push(filter.chatId)
  }
  if (filter.kind !== undefined) {
    conditions.push('kind = ?')
    values.push(requireJobKind(filter.kind))
  }
  if (filter.status !== undefined) {
    conditions.push('status = ?')
    values.push(requireJobStatus(filter.status))
  }
  if (filter.statuses !== undefined) {
    const statuses = requireJobStatusList(filter.statuses)
    conditions.push(`status IN (${statuses.map(() => '?').join(', ')})`)
    values.push(...statuses)
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const rows = allRows<MemoryJobRow>(
    db.prepare(`
        SELECT *
        FROM memory_jobs
        ${where}
        ORDER BY created_at, id
      `),
    ...values,
  )
  return rows.map(mapMemoryJobRow)
}

/**
 * Chat ids with at least one runnable (`pending`, due) job, ordered by their
 * oldest pending job (FIFO across fresh chats). Id-only aggregate — no payload
 * columns — so the worker's fairness scan (audit L17) stays off the corpus
 * read path.
 */
export function listPendingMemoryJobChatIds(db: DatabaseSync, filter: { now?: string | Date } = {}): string[] {
  const now = normalizeTimestamp(filter.now)
  const rows = allRows<{ chat_id: string }>(
    db.prepare(`
        SELECT chat_id, MIN(created_at) AS oldest_created_at
        FROM memory_jobs
        WHERE status = 'pending' AND next_run_at <= ?
        GROUP BY chat_id
        ORDER BY oldest_created_at, chat_id
      `),
    now,
  )
  return rows.map((row) => row.chat_id)
}

export function claimNextMemoryJob(
  db: DatabaseSync,
  filter: { chatId?: string; kind?: MemoryJobKind; now?: string | Date } = {},
): MemoryJob | null {
  const now = normalizeTimestamp(filter.now)
  const conditions = ['status = ?', 'next_run_at <= ?']
  const values: SqlValue[] = ['pending', now]
  if (filter.chatId !== undefined) {
    requireString(filter.chatId, 'chat id')
    conditions.push('chat_id = ?')
    values.push(filter.chatId)
  }
  if (filter.kind !== undefined) {
    conditions.push('kind = ?')
    values.push(requireJobKind(filter.kind))
  }
  const row = getRow<MemoryJobRow>(
    db.prepare(`
        UPDATE memory_jobs
        SET status = 'running',
            attempt_count = attempt_count + 1,
            error = NULL,
            updated_at = ?
        WHERE id = (
          SELECT id
          FROM memory_jobs
          WHERE ${conditions.join(' AND ')}
          ORDER BY created_at, id
          LIMIT 1
        )
        RETURNING *
      `),
    now,
    ...values,
  )
  return row ? mapMemoryJobRow(row) : null
}

function transitionMemoryJobStatus(
  db: DatabaseSync,
  id: string,
  fromStatuses: readonly MemoryJobStatus[],
  toStatus: MemoryJobStatus,
  patch: { error?: string | null } = {},
): MemoryJob | null {
  requireString(id, 'job id')
  const legalFromStatuses = requireJobStatusList(fromStatuses)
  const legalToStatus = requireJobStatus(toStatus)
  const updates = ['status = ?', "updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"]
  const values: SqlValue[] = [legalToStatus]
  if (Object.hasOwn(patch, 'error')) {
    updates.push('error = ?')
    values.push(patch.error ?? null)
  }
  values.push(...legalFromStatuses, id)
  const row = getRow<MemoryJobRow>(
    db.prepare(`
        UPDATE memory_jobs
        SET ${updates.join(', ')}
        WHERE status IN (${legalFromStatuses.map(() => '?').join(', ')})
          AND id = ?
        RETURNING *
      `),
    ...values,
  )
  return row ? mapMemoryJobRow(row) : null
}

export function completeMemoryJob(db: DatabaseSync, id: string): MemoryJob | null {
  return transitionMemoryJobStatus(db, id, ['running'], 'completed', { error: null })
}

export function failMemoryJob(db: DatabaseSync, id: string, error: string): MemoryJob | null {
  requireString(error, 'job error')
  return transitionMemoryJobStatus(db, id, ['running'], 'failed', { error })
}

export function retryOrFailMemoryJob(
  db: DatabaseSync,
  id: string,
  error: string,
  options: MemoryJobRetryOptions = {},
): MemoryJob | null {
  requireString(error, 'job error')
  const job = getMemoryJob(db, id)
  if (!job || job.status !== 'running') return null

  const now = normalizeTimestamp(options.now)
  if (job.attemptCount >= job.maxAttempts) {
    return transitionMemoryJobStatus(db, id, ['running'], 'failed', { error })
  }

  const nextRunAt = addMilliseconds(now, calculateMemoryJobRetryDelayMs(job.attemptCount, options.backoffBaseMs))
  return updateMemoryJob(db, id, {
    status: 'pending',
    error,
    nextRunAt,
  })
}

export function cancelMemoryJob(db: DatabaseSync, id: string): MemoryJob | null {
  return transitionMemoryJobStatus(db, id, ['pending', 'running'], 'cancelled', { error: null })
}

export function pruneTerminalMemoryJobs(db: DatabaseSync, options: PruneTerminalMemoryJobsOptions = {}): number {
  const retentionMs = requireRetentionMs(options.retentionMs)
  const maxPerSweep = requireSweepLimit(options.maxPerSweep)
  const cutoff = new Date(Date.parse(normalizeTimestamp(options.now)) - retentionMs).toISOString()
  const terminalStatuses = requireJobStatusList(MEMORY_JOB_TERMINAL_STATUSES)
  const result = db
    .prepare(
      `
        DELETE FROM memory_jobs
        WHERE id IN (
          SELECT id
          FROM memory_jobs
          WHERE status IN (${terminalStatuses.map(() => '?').join(', ')})
            AND updated_at < ?
          ORDER BY updated_at ASC, id ASC
          LIMIT ?
        )
      `,
    )
    .run(...terminalStatuses, cutoff, maxPerSweep)
  return Number(result.changes)
}

export function recoverRunningMemoryJobs(db: DatabaseSync, options: MemoryJobRetryOptions = {}): MemoryJob[] {
  const runningJobs = listMemoryJobs(db, { status: 'running' })
  const recovered: MemoryJob[] = []
  for (const job of runningJobs) {
    const result = retryOrFailMemoryJob(db, job.id, 'memory job was abandoned while running', options)
    if (result) recovered.push(result)
  }
  return recovered
}

export function updateMemoryJob(
  db: DatabaseSync,
  id: string,
  patch: {
    status?: MemoryJobStatus
    payload?: unknown
    error?: string | null
    attemptCount?: number
    maxAttempts?: number
    nextRunAt?: string
  },
): MemoryJob | null {
  requireString(id, 'job id')
  const updates: string[] = []
  const values: SqlValue[] = []
  if (patch.status !== undefined) {
    updates.push('status = ?')
    values.push(requireJobStatus(patch.status))
  }
  if (Object.hasOwn(patch, 'payload')) {
    updates.push('payload_json = ?')
    values.push(stringifyPayload(patch.payload))
  }
  if (Object.hasOwn(patch, 'error')) {
    updates.push('error = ?')
    values.push(patch.error ?? null)
  }
  if (patch.attemptCount !== undefined) {
    requireNonNegativeInteger(patch.attemptCount, 'attemptCount')
    updates.push('attempt_count = ?')
    values.push(patch.attemptCount)
  }
  if (patch.maxAttempts !== undefined) {
    requirePositiveInteger(patch.maxAttempts, 'maxAttempts')
    updates.push('max_attempts = ?')
    values.push(patch.maxAttempts)
  }
  if (patch.nextRunAt !== undefined) {
    requireTimestamp(patch.nextRunAt, 'nextRunAt')
    updates.push('next_run_at = ?')
    values.push(patch.nextRunAt)
  }
  if (updates.length === 0) {
    return getMemoryJob(db, id)
  }
  updates.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')")
  runStatement(
    db.prepare(`
      UPDATE memory_jobs
      SET ${updates.join(', ')}
      WHERE id = ?
    `),
    ...values,
    id,
  )
  return getMemoryJob(db, id)
}
