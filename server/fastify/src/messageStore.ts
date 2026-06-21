import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { recordTableWrite } from './protocolMetrics.js'

// Chat messages live in their own SQLite table, one row per message, instead of
// being embedded in the domain projection. This module is the pure CRUD layer
// over that table. Chat metadata stays in the `chats` table; the `messages`
// table keeps the unbounded, high-churn `message[]`.
//
// Messages table columns:
//   - `chat_id` — the chat's id (`Chat.id`).
//   - `seq`     — explicit array-order index (0-based); a relational table has no
//                 inherent order and the conversation depends on it.
//   - `uid`     — the message's own id (today stored confusingly as
//                 `Message.chatId`). Globally unique by the command-layer
//                 invariant (`normalizeGlobalMessageIds` / `validateUniqueMessageIds`),
//                 but the table PK is `(chat_id, seq)` so extraction/round-trip
//                 stay robust for older fixtures.
//   - `json`    — the full `Message` record, the lossless source of truth that
//                 `getChatMessages` reconstructs from. The structured columns are
//                 auxiliary (indexing / stub headers).
//   - `alternate` — 0 for an active transcript row (the normal case),
//                 1 for a preserved reroll candidate ("don't lose a rerolled
//                 result"). Active rows keep their 0-based `seq`; alternate rows use
//                 a NEGATIVE `seq` so the `(chat_id, seq)` PK never collides with an
//                 active row and the active-transcript diff (`seq >= prefix`) never
//                 touches them. Every active query filters `alternate = 0`; the
//                 reroll buffer is read/cleared via the dedicated alternate ops.

type JsonRecord = Record<string, unknown>

interface MessageRow {
  uid: string
  role: string
  data: string
  disabled: string | null
  json: string
}

export interface ChatMessageDiffInstrumentation {
  genericDiffRuns: number
  stableEqualCalls: number
  stableEqualStringifies: number
  appendFastPathRows: number
}

const chatMessageDiffInstrumentation: ChatMessageDiffInstrumentation = {
  genericDiffRuns: 0,
  stableEqualCalls: 0,
  stableEqualStringifies: 0,
  appendFastPathRows: 0,
}

export function resetChatMessageDiffInstrumentation(): void {
  chatMessageDiffInstrumentation.genericDiffRuns = 0
  chatMessageDiffInstrumentation.stableEqualCalls = 0
  chatMessageDiffInstrumentation.stableEqualStringifies = 0
  chatMessageDiffInstrumentation.appendFastPathRows = 0
}

export function getChatMessageDiffInstrumentation(): ChatMessageDiffInstrumentation {
  return { ...chatMessageDiffInstrumentation }
}

/**
 * Idempotent DDL. Safe to call on fresh + already-migrated databases. The
 * `alternate` column carries reroll candidates; fresh databases get it here
 * because their schema-version row is stamped CURRENT and the v6 migration only
 * upgrades existing databases.
 */
export function createMessageTable(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      chat_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      uid TEXT NOT NULL,
      role TEXT NOT NULL,
      data TEXT NOT NULL,
      disabled TEXT,
      json TEXT NOT NULL,
      alternate INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (chat_id, seq)
    );

    CREATE INDEX IF NOT EXISTS idx_messages_chat_seq ON messages (chat_id, seq);
    CREATE INDEX IF NOT EXISTS idx_messages_uid ON messages (uid);
  `)
}

// The heavy per-chat `hypaV3Data` blob lives in its own table, outside the lean
// wire projection, hydrated on open like messages. Distinct from the Hypa V3
// memory tables (chunks/summaries/...).
export function createChatBlobTable(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_hypa_v3 (
      chat_id TEXT PRIMARY KEY,
      json TEXT NOT NULL
    );
  `)
}

/** Upsert (or delete, when value is null/undefined) a chat's hypaV3Data blob. */
export function setChatHypaV3(db: DatabaseSync, chatId: string, value: unknown): void {
  if (value === undefined || value === null) {
    deleteChatHypaV3(db, chatId)
    return
  }
  recordTableWrite('chat_hypa_v3')
  db.prepare(
    'INSERT INTO chat_hypa_v3 (chat_id, json) VALUES (?, ?) ' +
      'ON CONFLICT(chat_id) DO UPDATE SET json = excluded.json',
  ).run(chatId, JSON.stringify(value))
}

export function deleteChatHypaV3(db: DatabaseSync, chatId: string): void {
  recordTableWrite('chat_hypa_v3')
  db.prepare('DELETE FROM chat_hypa_v3 WHERE chat_id = ?').run(chatId)
}

/** A chat's hypaV3Data blob, or undefined if none. */
export function getChatHypaV3(db: DatabaseSync, chatId: string): unknown {
  const row = db.prepare('SELECT json FROM chat_hypa_v3 WHERE chat_id = ?').get(chatId) as { json: string } | undefined
  return row ? (JSON.parse(row.json) as unknown) : undefined
}

/** All chats' hypaV3Data blobs, grouped by chat id (one query). */
export function getAllChatHypaV3Grouped(db: DatabaseSync): Map<string, unknown> {
  const rows = db.prepare('SELECT chat_id, json FROM chat_hypa_v3').all() as {
    chat_id: string
    json: string
  }[]
  const grouped = new Map<string, unknown>()
  for (const row of rows) grouped.set(row.chat_id, JSON.parse(row.json) as unknown)
  return grouped
}

export function getChatHypaV3GroupedByIds(db: DatabaseSync, chatIds: readonly string[]): Map<string, unknown> {
  const grouped = new Map<string, unknown>()
  for (const ids of idChunks(chatIds)) {
    const rows = db
      .prepare(`SELECT chat_id, json FROM chat_hypa_v3 WHERE chat_id IN (${placeholders(ids.length)})`)
      .all(...ids) as { chat_id: string; json: string }[]
    for (const row of rows) grouped.set(row.chat_id, JSON.parse(row.json) as unknown)
  }
  return grouped
}

/** Chat ids that currently have a hypaV3Data row. */
export function getAllChatIdsWithHypaV3(db: DatabaseSync): string[] {
  const rows = db.prepare('SELECT chat_id FROM chat_hypa_v3').all() as { chat_id: string }[]
  return rows.map((row) => row.chat_id)
}

/** Rebuild the whole hypaV3Data table from a full set of chats (wipe + insert). */
export function replaceAllChatHypaV3(
  db: DatabaseSync,
  chats: ReadonlyArray<{ chatId: string; hypaV3Data: unknown }>,
): void {
  recordTableWrite('chat_hypa_v3')
  db.exec('DELETE FROM chat_hypa_v3')
  for (const { chatId, hypaV3Data } of chats) {
    if (hypaV3Data !== undefined && hypaV3Data !== null) setChatHypaV3(db, chatId, hypaV3Data)
  }
}

function readMessageObject(raw: unknown): JsonRecord {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { role: 'char', data: '', chatId: randomUUID() }
  }
  return raw as JsonRecord
}

// The message's own id (`Message.chatId`). Normalized data always carries one;
// for un-normalized / hand-imported messages that lack it, mint a globally
// unique UUID (matching the command layer's `normalizeGlobalMessageIds`) rather
// than a chat-relative `seq-N` that would collide across chats.
function uidOf(message: JsonRecord): string {
  const raw = message.chatId
  return typeof raw === 'string' && raw.trim() ? raw : randomUUID()
}

function disabledColumn(message: JsonRecord): string | null {
  const value = message.disabled
  if (value === undefined) return null
  if (typeof value === 'string') return value
  return value ? 'true' : 'false'
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function normalizeMessageTranslationForData(message: JsonRecord, data: string): JsonRecord {
  const translation = message.translation
  if (!translation || typeof translation !== 'object' || Array.isArray(translation)) {
    return message
  }
  if ((translation as Record<string, unknown>).source !== 'raw') {
    return message
  }
  if ((translation as Record<string, unknown>).sourceHash === sha256(data)) {
    return message
  }
  return { ...message, translation: null }
}

function toRow(message: JsonRecord): MessageRow {
  const uid = uidOf(message)
  const data = typeof message.data === 'string' ? message.data : String(message.data ?? '')
  // Persist the uid we keyed on into the stored record so the column and the
  // round-tripped json never disagree (defensive — they already match for
  // normalized data).
  const withStableTranslation = normalizeMessageTranslationForData(message, data)
  const stored =
    withStableTranslation.chatId === uid ? withStableTranslation : { ...withStableTranslation, chatId: uid }
  return {
    uid,
    role: typeof message.role === 'string' ? message.role : 'char',
    data,
    disabled: disabledColumn(message),
    json: JSON.stringify(stored),
  }
}

/** Replace a single chat's ACTIVE messages (DELETE + ordered INSERT); the reroll
 *  buffer (alternate rows) is left intact. */
export function replaceChatMessages(db: DatabaseSync, chatId: string, messages: readonly unknown[]): void {
  recordTableWrite('messages')
  db.prepare('DELETE FROM messages WHERE chat_id = ? AND alternate = 0').run(chatId)
  insertChatMessages(db, chatId, messages)
}

export function activeMessageIdExists(db: DatabaseSync, messageId: string): boolean {
  const row = db.prepare('SELECT 1 AS found FROM messages WHERE uid = ? AND alternate = 0 LIMIT 1').get(messageId) as
    | { found: number }
    | undefined
  return !!row
}

export function activeMessageIdExistsOutsideChat(db: DatabaseSync, messageId: string, chatId: string): boolean {
  const row = db
    .prepare('SELECT 1 AS found FROM messages WHERE uid = ? AND chat_id != ? AND alternate = 0 LIMIT 1')
    .get(messageId, chatId) as { found: number } | undefined
  return !!row
}

export interface ActiveMessageLocation {
  chatId: string
  seq: number
  message: JsonRecord
}

export type ActiveMessageLocationResult =
  | { ok: true; location: ActiveMessageLocation }
  | { ok: false; reason: 'missing' | 'ambiguous' }

export function resolveActiveMessageLocationById(db: DatabaseSync, messageId: string): ActiveMessageLocationResult {
  const rows = db
    .prepare('SELECT chat_id, seq, json FROM messages WHERE uid = ? AND alternate = 0 ORDER BY chat_id, seq LIMIT 2')
    .all(messageId) as Array<{ chat_id: string; seq: number; json: string }>
  if (rows.length === 0) return { ok: false, reason: 'missing' }
  if (rows.length > 1) return { ok: false, reason: 'ambiguous' }
  const row = rows[0]
  return {
    ok: true,
    location: {
      chatId: row.chat_id,
      seq: row.seq,
      message: JSON.parse(row.json) as JsonRecord,
    },
  }
}

export function getActiveMessageLocationById(db: DatabaseSync, messageId: string): ActiveMessageLocation | undefined {
  const result = resolveActiveMessageLocationById(db, messageId)
  return result.ok ? result.location : undefined
}

export function appendChatMessage(db: DatabaseSync, chatId: string, raw: unknown): void {
  const message = readMessageObject(raw)
  const row = toRow(message)
  const tail = db.prepare('SELECT MAX(seq) AS maxSeq FROM messages WHERE chat_id = ? AND alternate = 0').get(chatId) as
    | { maxSeq: number | null }
    | undefined
  const seq = (tail?.maxSeq ?? -1) + 1
  recordTableWrite('messages')
  db.prepare(
    'INSERT INTO messages (chat_id, seq, uid, role, data, disabled, json, alternate) VALUES (?, ?, ?, ?, ?, ?, ?, 0)',
  ).run(chatId, seq, row.uid, row.role, row.data, row.disabled, row.json)
}

export function updateActiveMessageById(
  db: DatabaseSync,
  messageId: string,
  patch: JsonRecord,
): { ok: true; chatId: string } | { ok: false; reason: 'missing' | 'ambiguous' } {
  const resolved = resolveActiveMessageLocationById(db, messageId)
  if (resolved.ok === false) return { ok: false, reason: resolved.reason }
  const { location } = resolved

  const next = { ...location.message, ...patch, chatId: messageId }
  const row = toRow(next)
  recordTableWrite('messages')
  db.prepare(
    'UPDATE messages SET uid = ?, role = ?, data = ?, disabled = ?, json = ? WHERE chat_id = ? AND seq = ? AND alternate = 0',
  ).run(row.uid, row.role, row.data, row.disabled, row.json, location.chatId, location.seq)
  return { ok: true, chatId: location.chatId }
}

export function deleteActiveMessageById(
  db: DatabaseSync,
  messageId: string,
): { ok: true; chatId: string } | { ok: false; reason: 'missing' | 'ambiguous' } {
  const resolved = resolveActiveMessageLocationById(db, messageId)
  if (resolved.ok === false) return { ok: false, reason: resolved.reason }
  const { location } = resolved

  const base = getChatMessages(db, location.chatId)
  const next = base.slice()
  next.splice(location.seq, 1)
  applyChatMessageDiff(db, location.chatId, base, next)
  return { ok: true, chatId: location.chatId }
}

export function truncateActiveChatMessages(
  db: DatabaseSync,
  chatId: string,
  afterMessageId: string | null,
): { ok: true; removedCount: number } | { ok: false; reason: 'missing-after'; afterMessageId: string } {
  const base = getChatMessages(db, chatId)
  const keepCount = afterMessageId === null ? 0 : base.findIndex((message) => message.chatId === afterMessageId) + 1
  if (afterMessageId !== null && keepCount === 0) {
    return { ok: false, reason: 'missing-after', afterMessageId }
  }

  const next = base.slice(0, keepCount)
  applyChatMessageDiff(db, chatId, base, next)
  return { ok: true, removedCount: base.length - keepCount }
}

export function replaceActiveChatMessages(db: DatabaseSync, chatId: string, messages: readonly unknown[]): void {
  applyChatMessageDiff(db, chatId, getChatMessages(db, chatId), messages)
}

export type GenerationMessageWriteResult =
  | { ok: true; messageId: string; displaced?: JsonRecord }
  | { ok: false; reason: 'missing-target'; targetMessageId: string }
  | { ok: false; reason: 'duplicate'; messageId: string }

export function writeGenerationChatMessage(
  db: DatabaseSync,
  chatId: string,
  raw: unknown,
  targetMessageId?: string,
): GenerationMessageWriteResult {
  const message = readMessageObject(raw)
  const row = toRow(message)
  const lookupMessageId = targetMessageId ?? row.uid
  const existing = db
    .prepare('SELECT seq, json FROM messages WHERE chat_id = ? AND uid = ? AND alternate = 0 LIMIT 1')
    .get(chatId, lookupMessageId) as { seq: number; json: string } | undefined

  if (!existing && targetMessageId) {
    return { ok: false, reason: 'missing-target', targetMessageId }
  }

  const duplicate = existing
    ? (db
        .prepare(
          'SELECT 1 AS found FROM messages WHERE uid = ? AND alternate = 0 AND NOT (chat_id = ? AND seq = ?) LIMIT 1',
        )
        .get(row.uid, chatId, existing.seq) as { found: number } | undefined)
    : (db.prepare('SELECT 1 AS found FROM messages WHERE uid = ? AND alternate = 0 LIMIT 1').get(row.uid) as
        | { found: number }
        | undefined)
  if (duplicate) {
    return { ok: false, reason: 'duplicate', messageId: row.uid }
  }

  if (!existing) {
    appendChatMessage(db, chatId, message)
    return { ok: true, messageId: row.uid }
  }

  recordTableWrite('messages')
  db.prepare(
    'UPDATE messages SET uid = ?, role = ?, data = ?, disabled = ?, json = ? WHERE chat_id = ? AND seq = ? AND alternate = 0',
  ).run(row.uid, row.role, row.data, row.disabled, row.json, chatId, existing.seq)
  return { ok: true, messageId: row.uid, displaced: JSON.parse(existing.json) as JsonRecord }
}

function insertChatMessages(db: DatabaseSync, chatId: string, messages: readonly unknown[], startSeq = 0): void {
  if (messages.length === 0) return
  recordTableWrite('messages')
  const insert = db.prepare(
    'INSERT INTO messages (chat_id, seq, uid, role, data, disabled, json, alternate) VALUES (?, ?, ?, ?, ?, ?, ?, 0)',
  )
  messages.forEach((raw, index) => {
    const message = readMessageObject(raw)
    const row = toRow(message)
    const seq = startSeq + index
    insert.run(chatId, seq, row.uid, row.role, row.data, row.disabled, row.json)
  })
}

/**
 * Persist a caller-proven append-only replacement by inserting only the desired
 * tail. Returns false when the current active transcript no longer has the
 * expected prefix length, so callers can fall back to the generic diff path.
 */
export function appendActiveChatMessageTail(
  db: DatabaseSync,
  chatId: string,
  messages: readonly unknown[],
  prefixLength: number,
): boolean {
  if (!Number.isInteger(prefixLength) || prefixLength < 0) {
    throw new Error('append prefix length must be a non-negative integer')
  }
  if (messages.length <= prefixLength) return false
  if (countChatMessages(db, chatId) !== prefixLength) return false

  const tail = messages.slice(prefixLength)
  chatMessageDiffInstrumentation.appendFastPathRows += tail.length
  insertChatMessages(db, chatId, tail, prefixLength)
  return true
}

/**
 * Rebuild the entire table from a full set of chats (one transactional wipe +
 * insert). Used by the storage-boundary write path; the caller drives the
 * surrounding transaction.
 */
export function replaceAllChatMessages(
  db: DatabaseSync,
  chats: ReadonlyArray<{ chatId: string; messages: readonly unknown[] }>,
): void {
  recordTableWrite('messages')
  db.exec('DELETE FROM messages')
  for (const { chatId, messages } of chats) {
    insertChatMessages(db, chatId, messages)
  }
}

/** Delete one chat's messages (logical cascade — the chats table owns lifecycle). */
export function deleteChatMessages(db: DatabaseSync, chatId: string): void {
  recordTableWrite('messages')
  db.prepare('DELETE FROM messages WHERE chat_id = ?').run(chatId)
}

function stringifyForStableEqual(value: unknown): string {
  chatMessageDiffInstrumentation.stableEqualStringifies += 1
  return JSON.stringify(value)
}

function stableEqual(a: unknown, b: unknown): boolean {
  chatMessageDiffInstrumentation.stableEqualCalls += 1
  return stringifyForStableEqual(a) === stringifyForStableEqual(b)
}

/**
 * Surgically reconcile a single chat's rows from `base` (current persisted) to
 * `next` (desired) with the minimum number of row writes:
 *   - identical arrays → no write at all;
 *   - a pure append → exactly one INSERT (the new tail row);
 *   - an edit/delete/truncate at position k → one DELETE of seq ≥ k + reinsert
 *     of the (usually short) tail.
 * `seq = array index`, so reseqing the tail after a delete falls out for free.
 * This is what makes a message append O(1) row writes instead of a whole-chat
 * (let alone whole-corpus) rewrite.
 */
export function applyChatMessageDiff(
  db: DatabaseSync,
  chatId: string,
  base: readonly unknown[],
  next: readonly unknown[],
): void {
  chatMessageDiffInstrumentation.genericDiffRuns += 1
  let prefix = 0
  const shared = Math.min(base.length, next.length)
  while (prefix < shared && stableEqual(base[prefix], next[prefix])) prefix++

  if (prefix === base.length && prefix === next.length) return // unchanged

  recordTableWrite('messages')
  if (prefix < base.length) {
    // Active rows only: alternate rows carry a negative `seq` (`seq >= prefix`
    // already excludes them); `alternate = 0` makes that explicit and robust.
    db.prepare('DELETE FROM messages WHERE chat_id = ? AND seq >= ? AND alternate = 0').run(chatId, prefix)
  }
  if (prefix < next.length) {
    const insert = db.prepare(
      'INSERT INTO messages (chat_id, seq, uid, role, data, disabled, json, alternate) VALUES (?, ?, ?, ?, ?, ?, ?, 0)',
    )
    for (let seq = prefix; seq < next.length; seq++) {
      const message = readMessageObject(next[seq])
      const row = toRow(message)
      insert.run(chatId, seq, row.uid, row.role, row.data, row.disabled, row.json)
    }
  }
}

/** All ACTIVE messages for a chat, in `seq` order, reconstructed from the json column. */
export function getChatMessages(db: DatabaseSync, chatId: string): JsonRecord[] {
  const rows = db.prepare('SELECT json FROM messages WHERE chat_id = ? AND alternate = 0 ORDER BY seq').all(chatId) as {
    json: string
  }[]
  return rows.map((row) => JSON.parse(row.json) as JsonRecord)
}

/**
 * ACTIVE messages for a zero-based `[start, start + limit)` range.
 *
 * Used by active-chat window hydration so opening a large chat does not pay to
 * parse every historical row before the first visible messages can render.
 */
export function getChatMessagesRange(db: DatabaseSync, chatId: string, start: number, limit: number): JsonRecord[] {
  if (!Number.isInteger(start) || start < 0 || !Number.isInteger(limit) || limit <= 0) {
    return []
  }
  const rows = db
    .prepare('SELECT json FROM messages WHERE chat_id = ? AND alternate = 0 ORDER BY seq LIMIT ? OFFSET ?')
    .all(chatId, limit, start) as { json: string }[]
  return rows.map((row) => JSON.parse(row.json) as JsonRecord)
}

/** Every chat's ACTIVE messages, grouped by chat id, in `seq` order (one query). */
export function getAllChatMessagesGrouped(db: DatabaseSync): Map<string, JsonRecord[]> {
  const rows = db.prepare('SELECT chat_id, json FROM messages WHERE alternate = 0 ORDER BY chat_id, seq').all() as {
    chat_id: string
    json: string
  }[]
  const grouped = new Map<string, JsonRecord[]>()
  for (const row of rows) {
    let list = grouped.get(row.chat_id)
    if (!list) {
      list = []
      grouped.set(row.chat_id, list)
    }
    list.push(JSON.parse(row.json) as JsonRecord)
  }
  return grouped
}

export function getChatMessagesGroupedByIds(db: DatabaseSync, chatIds: readonly string[]): Map<string, JsonRecord[]> {
  const grouped = new Map<string, JsonRecord[]>()
  for (const ids of idChunks(chatIds)) {
    const rows = db
      .prepare(
        `SELECT chat_id, json FROM messages WHERE alternate = 0 AND chat_id IN (${placeholders(ids.length)}) ORDER BY chat_id, seq`,
      )
      .all(...ids) as { chat_id: string; json: string }[]
    for (const row of rows) {
      let list = grouped.get(row.chat_id)
      if (!list) {
        list = []
        grouped.set(row.chat_id, list)
      }
      list.push(JSON.parse(row.json) as JsonRecord)
    }
  }
  return grouped
}

/** Chat ids that currently have at least one ACTIVE message row. */
export function getAllChatIdsWithMessages(db: DatabaseSync): string[] {
  const rows = db.prepare('SELECT DISTINCT chat_id FROM messages WHERE alternate = 0').all() as {
    chat_id: string
  }[]
  return rows.map((row) => row.chat_id)
}

/** Number of ACTIVE message rows for a chat (cheap header for stub projection). */
export function countChatMessages(db: DatabaseSync, chatId: string): number {
  const row = db.prepare('SELECT COUNT(*) AS count FROM messages WHERE chat_id = ? AND alternate = 0').get(chatId) as
    | { count: number }
    | undefined
  return row?.count ?? 0
}

// Reroll buffer (alternate rows): regenerate stores every candidate of the
// current turn here, including the displaced row and the new candidate, so the
// set survives reloads. Send / continue clears the buffer. Alternate rows use a
// monotonically decreasing negative `seq` so they never collide with active rows.

/**
 * Append one preserved reroll candidate to a chat's alternate buffer, keyed by
 * `uid`: a candidate already buffered (same `uid`) is a no-op. The dedup makes
 * the op idempotent — a regenerate replay (reattach) and the regenerate that
 * preserves both old+new without double-storing a candidate it already holds both
 * land cleanly.
 */
export function addAlternateMessage(db: DatabaseSync, chatId: string, message: unknown): void {
  const row = toRow(readMessageObject(message))
  const existing = db
    .prepare('SELECT 1 FROM messages WHERE chat_id = ? AND alternate = 1 AND uid = ? LIMIT 1')
    .get(chatId, row.uid) as { 1: number } | undefined
  if (existing) return
  const min = db.prepare('SELECT MIN(seq) AS minSeq FROM messages WHERE chat_id = ? AND alternate = 1').get(chatId) as
    | { minSeq: number | null }
    | undefined
  const seq = (min?.minSeq ?? 0) - 1 // -1, -2, -3, … (first alternate is -1)
  recordTableWrite('messages')
  db.prepare(
    'INSERT INTO messages (chat_id, seq, uid, role, data, disabled, json, alternate) VALUES (?, ?, ?, ?, ?, ?, ?, 1)',
  ).run(chatId, seq, row.uid, row.role, row.data, row.disabled, row.json)
}

/** A chat's preserved reroll candidates, most-recently-added first (newest =
 *  most-negative `seq` → ascending). Order is informational only ("not lost"). */
export function getAlternateMessages(db: DatabaseSync, chatId: string): JsonRecord[] {
  const rows = db
    .prepare('SELECT json FROM messages WHERE chat_id = ? AND alternate = 1 ORDER BY seq ASC')
    .all(chatId) as { json: string }[]
  return rows.map((row) => JSON.parse(row.json) as JsonRecord)
}

export function getAlternateMessagesGroupedByIds(
  db: DatabaseSync,
  chatIds: readonly string[],
): Map<string, JsonRecord[]> {
  const grouped = new Map<string, JsonRecord[]>()
  for (const ids of idChunks(chatIds)) {
    const rows = db
      .prepare(
        `SELECT chat_id, json FROM messages WHERE alternate = 1 AND chat_id IN (${placeholders(ids.length)}) ORDER BY chat_id, seq ASC`,
      )
      .all(...ids) as { chat_id: string; json: string }[]
    for (const row of rows) {
      let list = grouped.get(row.chat_id)
      if (!list) {
        list = []
        grouped.set(row.chat_id, list)
      }
      list.push(JSON.parse(row.json) as JsonRecord)
    }
  }
  return grouped
}

/** Drop a chat's reroll buffer (the confirm boundary: send / continue). */
export function clearAlternateMessages(db: DatabaseSync, chatId: string): void {
  recordTableWrite('messages')
  db.prepare('DELETE FROM messages WHERE chat_id = ? AND alternate = 1').run(chatId)
}

/** Number of preserved reroll candidates for a chat. */
export function countAlternateMessages(db: DatabaseSync, chatId: string): number {
  const row = db.prepare('SELECT COUNT(*) AS count FROM messages WHERE chat_id = ? AND alternate = 1').get(chatId) as
    | { count: number }
    | undefined
  return row?.count ?? 0
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(',')
}

function idChunks(chatIds: readonly string[]): string[][] {
  const chunkSize = 500
  const chunks: string[][] = []
  for (let index = 0; index < chatIds.length; index += chunkSize) {
    chunks.push(chatIds.slice(index, index + chunkSize))
  }
  return chunks
}
