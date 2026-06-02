import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'

// Rowid-stability primitives for the mutation-range review gate (Phase 0). A
// SQLite rowid only changes when a row is DELETE+reINSERTed, so snapshotting
// id→rowid before and after a command proves whether unrelated rows were
// rewritten (the broad `replaceAll*` path rewrites everything; a narrowed write
// leaves unrelated rowids stable). `b57df5cd` (`characters/select`) is the
// reference fix this template generalizes.

/** Snapshot of every row's stable rowid in `characters` / `chats`, keyed by id. */
export function tableRowidsById(
  dataDir: string,
  table: 'characters' | 'chats',
): Record<string, number> {
  const db = new DatabaseSync(path.join(dataDir, 'risu.db'))
  try {
    const rows = db.prepare(`SELECT id, rowid FROM ${table} ORDER BY id`).all() as Array<{
      id: string
      rowid: number
    }>
    return Object.fromEntries(rows.map((row) => [row.id, row.rowid]))
  } finally {
    db.close()
  }
}

/** Snapshot of a chat's active message rows (seq → rowid), for message-store
 *  stability checks alongside the table snapshots. */
export function activeMessageRowids(
  dataDir: string,
  chatId: string,
): { seq: number; rowid: number }[] {
  const db = new DatabaseSync(path.join(dataDir, 'risu.db'))
  try {
    return db
      .prepare('SELECT rowid, seq FROM messages WHERE chat_id = ? AND alternate = 0 ORDER BY seq')
      .all(chatId) as { seq: number; rowid: number }[]
  } finally {
    db.close()
  }
}
