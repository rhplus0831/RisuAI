import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

// Lazy-projection Phase 4: chat messages live in their own SQLite table, one row
// per message, instead of being embedded in `data/db.json`. This module is the
// pure CRUD layer over that table. The `db.json` blob keeps chat *metadata*; the
// `messages` table keeps the unbounded, high-churn `message[]`.
//
// Storage model (see docs/lazy-projection/reference/storage-model.md):
//   - `chat_id` — the chat's id (`Chat.id`).
//   - `seq`     — explicit array-order index (0-based); a relational table has no
//                 inherent order and the conversation depends on it.
//   - `uid`     — the message's own id (today stored confusingly as
//                 `Message.chatId`). Globally unique by the command-layer
//                 invariant (`normalizeGlobalMessageIds` / `validateUniqueMessageIds`),
//                 but the table PK is `(chat_id, seq)` so extraction/round-trip
//                 stay robust even for not-yet-normalized fixtures.
//   - `json`    — the full `Message` record, the lossless source of truth that
//                 `getChatMessages` reconstructs from. The structured columns are
//                 auxiliary (indexing / stub headers).
//   - `alternate` (Phase 6c) — 0 for an active transcript row (the normal case),
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

/**
 * Idempotent DDL. Safe to call on fresh + already-migrated databases. The
 * `alternate` column carries Phase 6c reroll candidates; a fresh database gets it
 * here (the schema-version row is stamped CURRENT, so the v6 migration that adds it
 * to *existing* databases never runs for a fresh one — see `db.ts`).
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

// Phase 4.4: the heavy per-chat `hypaV3Data` blob lives in its own table (one
// row per chat), out of db.json and the wire projection, hydrated on open like
// messages. Distinct from the Hypa V3 *memory tables* (chunks/summaries/...).
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
  db.prepare(
    'INSERT INTO chat_hypa_v3 (chat_id, json) VALUES (?, ?) ' +
      'ON CONFLICT(chat_id) DO UPDATE SET json = excluded.json',
  ).run(chatId, JSON.stringify(value))
}

export function deleteChatHypaV3(db: DatabaseSync, chatId: string): void {
  db.prepare('DELETE FROM chat_hypa_v3 WHERE chat_id = ?').run(chatId)
}

/** A chat's hypaV3Data blob, or undefined if none. */
export function getChatHypaV3(db: DatabaseSync, chatId: string): unknown {
  const row = db.prepare('SELECT json FROM chat_hypa_v3 WHERE chat_id = ?').get(chatId) as
    | { json: string }
    | undefined
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

function toRow(message: JsonRecord): MessageRow {
  const uid = uidOf(message)
  // Persist the uid we keyed on into the stored record so the column and the
  // round-tripped json never disagree (defensive — they already match for
  // normalized data).
  const stored = message.chatId === uid ? message : { ...message, chatId: uid }
  return {
    uid,
    role: typeof message.role === 'string' ? message.role : 'char',
    data: typeof message.data === 'string' ? message.data : String(message.data ?? ''),
    disabled: disabledColumn(message),
    json: JSON.stringify(stored),
  }
}

/** Replace a single chat's ACTIVE messages (DELETE + ordered INSERT); the reroll
 *  buffer (alternate rows) is left intact. */
export function replaceChatMessages(
  db: DatabaseSync,
  chatId: string,
  messages: readonly unknown[],
): void {
  db.prepare('DELETE FROM messages WHERE chat_id = ? AND alternate = 0').run(chatId)
  insertChatMessages(db, chatId, messages)
}

function insertChatMessages(
  db: DatabaseSync,
  chatId: string,
  messages: readonly unknown[],
): void {
  if (messages.length === 0) return
  const insert = db.prepare(
    'INSERT INTO messages (chat_id, seq, uid, role, data, disabled, json, alternate) VALUES (?, ?, ?, ?, ?, ?, ?, 0)',
  )
  messages.forEach((raw, seq) => {
    const message = readMessageObject(raw)
    const row = toRow(message)
    insert.run(chatId, seq, row.uid, row.role, row.data, row.disabled, row.json)
  })
}

/**
 * Rebuild the entire table from a full set of chats (one transactional wipe +
 * insert). Used by the storage-boundary write path while message commands are
 * still whole-blob (Slice 4.1); the caller drives the surrounding transaction.
 */
export function replaceAllChatMessages(
  db: DatabaseSync,
  chats: ReadonlyArray<{ chatId: string; messages: readonly unknown[] }>,
): void {
  db.exec('DELETE FROM messages')
  for (const { chatId, messages } of chats) {
    insertChatMessages(db, chatId, messages)
  }
}

/** Delete one chat's messages (logical cascade — db.json owns chat lifecycle). */
export function deleteChatMessages(db: DatabaseSync, chatId: string): void {
  db.prepare('DELETE FROM messages WHERE chat_id = ?').run(chatId)
}

function stableEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
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
  let prefix = 0
  const shared = Math.min(base.length, next.length)
  while (prefix < shared && stableEqual(base[prefix], next[prefix])) prefix++

  if (prefix === base.length && prefix === next.length) return // unchanged

  if (prefix < base.length) {
    // Active rows only: alternate rows carry a negative `seq` (`seq >= prefix`
    // already excludes them); `alternate = 0` makes that explicit and robust.
    db.prepare('DELETE FROM messages WHERE chat_id = ? AND seq >= ? AND alternate = 0').run(
      chatId,
      prefix,
    )
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
  const rows = db
    .prepare('SELECT json FROM messages WHERE chat_id = ? AND alternate = 0 ORDER BY seq')
    .all(chatId) as { json: string }[]
  return rows.map((row) => JSON.parse(row.json) as JsonRecord)
}

/** Every chat's ACTIVE messages, grouped by chat id, in `seq` order (one query). */
export function getAllChatMessagesGrouped(db: DatabaseSync): Map<string, JsonRecord[]> {
  const rows = db
    .prepare('SELECT chat_id, json FROM messages WHERE alternate = 0 ORDER BY chat_id, seq')
    .all() as { chat_id: string; json: string }[]
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

/** Chat ids that currently have at least one ACTIVE message row. */
export function getAllChatIdsWithMessages(db: DatabaseSync): string[] {
  const rows = db
    .prepare('SELECT DISTINCT chat_id FROM messages WHERE alternate = 0')
    .all() as { chat_id: string }[]
  return rows.map((row) => row.chat_id)
}

/** Number of ACTIVE message rows for a chat (cheap header for stub projection). */
export function countChatMessages(db: DatabaseSync, chatId: string): number {
  const row = db
    .prepare('SELECT COUNT(*) AS count FROM messages WHERE chat_id = ? AND alternate = 0')
    .get(chatId) as { count: number } | undefined
  return row?.count ?? 0
}

// ── Phase 6c: the reroll buffer (alternate rows) ────────────────────────────────
// Preserved reroll candidates for a chat — "don't lose a rerolled result". A
// regenerate moves the candidate it replaces here instead of destroying it; the
// buffer is cleared at the confirm boundary (send / continue). Alternate rows use
// a NEGATIVE `seq` (monotonically decreasing) so the `(chat_id, seq)` PK stays
// unique against active rows (seq >= 0) without a PK change. No order is preserved
// (the only guarantee is "not lost").

/** Append one preserved reroll candidate to a chat's alternate buffer. */
export function addAlternateMessage(db: DatabaseSync, chatId: string, message: unknown): void {
  const row = toRow(readMessageObject(message))
  const min = db
    .prepare('SELECT MIN(seq) AS minSeq FROM messages WHERE chat_id = ? AND alternate = 1')
    .get(chatId) as { minSeq: number | null } | undefined
  const seq = (min?.minSeq ?? 0) - 1 // -1, -2, -3, … (first alternate is -1)
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

/** Drop a chat's reroll buffer (the confirm boundary: send / continue). */
export function clearAlternateMessages(db: DatabaseSync, chatId: string): void {
  db.prepare('DELETE FROM messages WHERE chat_id = ? AND alternate = 1').run(chatId)
}

/** Number of preserved reroll candidates for a chat. */
export function countAlternateMessages(db: DatabaseSync, chatId: string): number {
  const row = db
    .prepare('SELECT COUNT(*) AS count FROM messages WHERE chat_id = ? AND alternate = 1')
    .get(chatId) as { count: number } | undefined
  return row?.count ?? 0
}
