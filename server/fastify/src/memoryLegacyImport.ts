import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { createMemoryChunk, createMemorySummary, getMemoryChunk, getMemorySummary } from './memoryRepository.js'
import { LEGACY_HYPA_V3_SUMMARY_MODEL } from './memorySummaryCompatibility.js'
import type { PortableMemoryLegacySummaryTombstone } from './risuSave/portableMetadata.js'

export { LEGACY_HYPA_V3_SUMMARY_MODEL } from './memorySummaryCompatibility.js'

interface LegacyDatabase {
  characters?: LegacyCharacter[]
}

interface LegacyCharacter {
  chaId?: unknown
  chats?: LegacyChat[]
}

interface LegacyChat {
  id?: unknown
  message?: LegacyMessage[]
  hypaV3Data?: LegacyHypaV3Data
}

interface LegacyMessage {
  role?: unknown
  data?: unknown
  chatId?: unknown
}

interface LegacyHypaV3Data {
  summaries?: LegacySummary[]
}

interface LegacySummary {
  text?: unknown
  chatMemos?: unknown
  isImportant?: unknown
  categoryId?: unknown
  tags?: unknown
}

export interface LegacyHypaV3BackfillResult {
  chunksCreated: number
  summariesCreated: number
}

interface LegacySummaryPlan {
  chunkId: string
  summaryId: string
  chatId: string
  messageId: string | null
  rangeStartSeq: number
  rangeEndSeq: number
  chunkText: string
  summaryText: string
  metadata: LegacySummaryMetadata
}

interface LegacySummaryMetadata {
  source: 'legacy-hypav3'
  summaryIndex: number
  chatMemos: string[]
  isImportant: boolean
  categoryId?: string
  tags?: string[]
}

export function replaceLegacyHypaV3MemoryRows(db: DatabaseSync, database: unknown): LegacyHypaV3BackfillResult {
  return withTransaction(db, () => replaceLegacyHypaV3MemoryRowsInTransaction(db, database))
}

export function replaceLegacyHypaV3MemoryRowsInTransaction(
  db: DatabaseSync,
  database: unknown,
  tombstones: readonly PortableMemoryLegacySummaryTombstone[] = [],
): LegacyHypaV3BackfillResult {
  db.exec(`
    DELETE FROM memory_jobs;
    DELETE FROM memory_embeddings;
    DELETE FROM memory_summaries;
    DELETE FROM memory_chunks;
    DELETE FROM memory_legacy_summary_tombstones;
  `)
  insertLegacySummaryTombstonesInTransaction(db, tombstones)
  return backfillLegacyHypaV3MemoryRows(db, database)
}

export function listLegacySummaryTombstones(db: DatabaseSync): PortableMemoryLegacySummaryTombstone[] {
  return db
    .prepare(
      `SELECT summary_id AS summaryId, chat_id AS chatId, deleted_at AS deletedAt
       FROM memory_legacy_summary_tombstones
       ORDER BY summary_id ASC`,
    )
    .all() as unknown as PortableMemoryLegacySummaryTombstone[]
}

export function insertLegacySummaryTombstonesInTransaction(
  db: DatabaseSync,
  tombstones: readonly PortableMemoryLegacySummaryTombstone[],
): void {
  if (tombstones.length === 0) return
  const insert = db.prepare(
    `INSERT INTO memory_legacy_summary_tombstones (summary_id, chat_id, deleted_at)
     VALUES (?, ?, ?)`,
  )
  for (const tombstone of tombstones) {
    insert.run(tombstone.summaryId, tombstone.chatId, tombstone.deletedAt)
  }
}

export function backfillLegacyHypaV3MemoryRows(db: DatabaseSync, database: unknown): LegacyHypaV3BackfillResult {
  const plans = collectLegacySummaryPlans(database)
  const isDeleted = db.prepare('SELECT 1 FROM memory_legacy_summary_tombstones WHERE summary_id = ? LIMIT 1')
  let chunksCreated = 0
  let summariesCreated = 0

  for (const plan of plans) {
    if (isDeleted.get(plan.summaryId)) continue
    if (!getMemoryChunk(db, plan.chunkId)) {
      createMemoryChunk(db, {
        id: plan.chunkId,
        chatId: plan.chatId,
        messageId: plan.messageId,
        rangeStartSeq: plan.rangeStartSeq,
        rangeEndSeq: plan.rangeEndSeq,
        text: plan.chunkText,
        status: 'summarized',
      })
      chunksCreated += 1
    }
    if (!getMemorySummary(db, plan.summaryId)) {
      createMemorySummary(db, {
        id: plan.summaryId,
        chatId: plan.chatId,
        chunkId: plan.chunkId,
        model: LEGACY_HYPA_V3_SUMMARY_MODEL,
        text: plan.summaryText,
        metadata: plan.metadata,
        tokens: 0,
      })
      summariesCreated += 1
    }
  }

  return { chunksCreated, summariesCreated }
}

function collectLegacySummaryPlans(database: unknown): LegacySummaryPlan[] {
  if (!isRecord(database)) return []
  const db = database as LegacyDatabase
  if (!Array.isArray(db.characters)) return []

  const plans: LegacySummaryPlan[] = []
  db.characters.forEach((character, characterIndex) => {
    if (!Array.isArray(character?.chats)) return
    const characterId = stringOrFallback(character.chaId, `character-${characterIndex}`)

    character.chats.forEach((chat, chatIndex) => {
      const summaries = chat?.hypaV3Data?.summaries
      if (!Array.isArray(summaries) || summaries.length === 0) return
      const chatId = stringOrFallback(chat.id, `${characterId}:chat-${chatIndex}`)
      const messages = Array.isArray(chat.message) ? chat.message : []
      const messageSeqById = new Map<string, number>()
      messages.forEach((message, index) => {
        if (typeof message?.chatId === 'string' && message.chatId.length > 0) {
          messageSeqById.set(message.chatId, index)
        }
      })

      summaries.forEach((summary, summaryIndex) => {
        if (!isRecord(summary) || typeof summary.text !== 'string' || summary.text.length === 0) {
          return
        }
        const chatMemos = normalizeChatMemos(summary.chatMemos)
        const resolvedSeqs = chatMemos
          .map((memo) => messageSeqById.get(memo))
          .filter((seq): seq is number => seq !== undefined)
        const rangeStartSeq = resolvedSeqs.length > 0 ? Math.min(...resolvedSeqs) : fallbackSummarySeq(summaryIndex)
        const rangeEndSeq = resolvedSeqs.length > 0 ? Math.max(...resolvedSeqs) : fallbackSummarySeq(summaryIndex)
        const messageId = chatMemos.at(-1) ?? null
        const chunkText = buildChunkText(messages, chatMemos, summary.text)
        const stableKey = `${characterId}\0${chatId}\0${summaryIndex}`
        const chunkId = `legacy-hypav3-chunk-${shortHash(stableKey)}`
        const summaryId = `legacy-hypav3-summary-${shortHash(stableKey)}`

        plans.push({
          chunkId,
          summaryId,
          chatId,
          messageId,
          rangeStartSeq,
          rangeEndSeq,
          chunkText,
          summaryText: summary.text,
          metadata: buildMetadata(summary, summaryIndex, chatMemos),
        })
      })
    })
  })

  return plans
}

function buildChunkText(messages: LegacyMessage[], chatMemos: string[], summaryText: string): string {
  const memoSet = new Set(chatMemos)
  const rows = messages
    .filter((message) => typeof message.chatId === 'string' && memoSet.has(message.chatId))
    .map((message) => {
      const role = typeof message.role === 'string' && message.role.length > 0 ? message.role : 'unknown'
      const data = typeof message.data === 'string' ? message.data : ''
      return `${role}: ${data}`
    })
    .filter((row) => row.trim().length > 0)
  return rows.length > 0 ? rows.join('\n') : summaryText
}

function buildMetadata(summary: LegacySummary, summaryIndex: number, chatMemos: string[]): LegacySummaryMetadata {
  const metadata: LegacySummaryMetadata = {
    source: 'legacy-hypav3',
    summaryIndex,
    chatMemos,
    isImportant: summary.isImportant === true,
  }
  if (typeof summary.categoryId === 'string' && summary.categoryId.length > 0) {
    metadata.categoryId = summary.categoryId
  }
  if (Array.isArray(summary.tags)) {
    const tags = summary.tags.filter((tag): tag is string => typeof tag === 'string')
    if (tags.length > 0) metadata.tags = tags
  }
  return metadata
}

function normalizeChatMemos(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((memo): memo is string => typeof memo === 'string' && memo.length > 0)
}

function fallbackSummarySeq(summaryIndex: number): number {
  return Number.MAX_SAFE_INTEGER - 100_000 + summaryIndex
}

function stringOrFallback(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function withTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
