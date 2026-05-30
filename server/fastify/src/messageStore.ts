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

type JsonRecord = Record<string, unknown>

interface MessageRow {
  uid: string
  role: string
  data: string
  disabled: string | null
  json: string
}

/** Idempotent DDL. Safe to call on fresh + already-migrated databases. */
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
      PRIMARY KEY (chat_id, seq)
    );

    CREATE INDEX IF NOT EXISTS idx_messages_chat_seq ON messages (chat_id, seq);
    CREATE INDEX IF NOT EXISTS idx_messages_uid ON messages (uid);
  `)
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

/** Replace a single chat's messages (DELETE + ordered INSERT). */
export function replaceChatMessages(
  db: DatabaseSync,
  chatId: string,
  messages: readonly unknown[],
): void {
  db.prepare('DELETE FROM messages WHERE chat_id = ?').run(chatId)
  insertChatMessages(db, chatId, messages)
}

function insertChatMessages(
  db: DatabaseSync,
  chatId: string,
  messages: readonly unknown[],
): void {
  if (messages.length === 0) return
  const insert = db.prepare(
    'INSERT INTO messages (chat_id, seq, uid, role, data, disabled, json) VALUES (?, ?, ?, ?, ?, ?, ?)',
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

/** All messages for a chat, in `seq` order, reconstructed from the json column. */
export function getChatMessages(db: DatabaseSync, chatId: string): JsonRecord[] {
  const rows = db
    .prepare('SELECT json FROM messages WHERE chat_id = ? ORDER BY seq')
    .all(chatId) as { json: string }[]
  return rows.map((row) => JSON.parse(row.json) as JsonRecord)
}

/** Every chat's messages, grouped by chat id, in `seq` order (one query). */
export function getAllChatMessagesGrouped(db: DatabaseSync): Map<string, JsonRecord[]> {
  const rows = db
    .prepare('SELECT chat_id, json FROM messages ORDER BY chat_id, seq')
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

/** Chat ids that currently have at least one message row. */
export function getAllChatIdsWithMessages(db: DatabaseSync): string[] {
  const rows = db.prepare('SELECT DISTINCT chat_id FROM messages').all() as {
    chat_id: string
  }[]
  return rows.map((row) => row.chat_id)
}

/** Number of message rows for a chat (cheap header for stub projection). */
export function countChatMessages(db: DatabaseSync, chatId: string): number {
  const row = db
    .prepare('SELECT COUNT(*) AS count FROM messages WHERE chat_id = ?')
    .get(chatId) as { count: number } | undefined
  return row?.count ?? 0
}
