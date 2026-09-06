import type { DatabaseSync } from 'node:sqlite'
import { isDeepStrictEqual } from 'node:util'
import { recordTableWrite } from './protocolMetrics.js'

interface PromptMemoryMessageSource {
  chatId: unknown
  role: unknown
  data: unknown
}

export interface UnsummarizedMemoryInvalidationResult {
  chunksDeleted: number
  jobsDeleted: number
}

/**
 * Returns true when a transcript rewrite changes rows that an existing prompt
 * memory chunk could have captured. A pure append keeps every prior chunk
 * valid, while edits, removals, reorders, and an `allBefore` boundary do not.
 */
export function invalidatesPromptMemorySource(before: readonly unknown[], after: readonly unknown[]): boolean {
  const previousSource = promptMemorySource(before)
  const nextSource = promptMemorySource(after)
  if (nextSource.length < previousSource.length) return true
  return !isDeepStrictEqual(previousSource, nextSource.slice(0, previousSource.length))
}

/**
 * Remove derived chunks that have not produced a summary, together with every
 * durable job that names one of those chunks. The caller owns the surrounding
 * transaction so transcript and memory invalidation commit or roll back
 * together.
 */
export function invalidateUnsummarizedMemoryForChat(
  db: DatabaseSync,
  chatId: string,
): UnsummarizedMemoryInvalidationResult {
  const jobs = db
    .prepare(
      `
        DELETE FROM memory_jobs
        WHERE chat_id = ?
          AND json_extract(payload_json, '$.chunkId') IN (
            SELECT memory_chunks.id
            FROM memory_chunks
            WHERE memory_chunks.chat_id = ?
              AND NOT EXISTS (
                SELECT 1
                FROM memory_summaries
                WHERE memory_summaries.chunk_id = memory_chunks.id
              )
          )
      `,
    )
    .run(chatId, chatId)
  if (jobs.changes > 0) recordTableWrite('memory_jobs')
  const chunks = db
    .prepare(
      `
        DELETE FROM memory_chunks
        WHERE chat_id = ?
          AND NOT EXISTS (
            SELECT 1
            FROM memory_summaries
            WHERE memory_summaries.chunk_id = memory_chunks.id
          )
      `,
    )
    .run(chatId)
  if (chunks.changes > 0) recordTableWrite('memory_chunks')
  return {
    chunksDeleted: Number(chunks.changes),
    jobsDeleted: Number(jobs.changes),
  }
}

function promptMemorySource(messages: readonly unknown[]): PromptMemoryMessageSource[] {
  const source: PromptMemoryMessageSource[] = []
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = asRecord(messages[index])
    if (message.disabled === true) continue
    if (message.disabled === 'allBefore') break
    source.unshift({
      chatId: message.chatId,
      role: message.role,
      data: message.data,
    })
  }
  return source
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}
