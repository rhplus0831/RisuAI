import { expect } from 'vitest'
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

/**
 * The shared normalization-scope assertion (Phase 0). Given a `tableRowidsById`
 * snapshot of one table before and after a command, fail if any row that was not
 * expected to change kept a *different* rowid — i.e. was DELETE+reINSERTed (the
 * over-broad rewrite a targeted write must avoid). `expectedChangedIds` are the
 * ids the command is allowed to create/delete/replace (default none, the
 * pure-`UPDATE` case where every row keeps its rowid). This is the codified form
 * of the reference fix's "unrelated rows not rewritten" check; every Tier write
 * slice asserts its narrow scope through it.
 */
export function assertOnlyRowsWritten(
  before: Record<string, number>,
  after: Record<string, number>,
  expectedChangedIds: readonly string[] = [],
): void {
  const allowed = new Set(expectedChangedIds)
  for (const [id, rowid] of Object.entries(before)) {
    if (allowed.has(id)) continue
    expect(after[id], `unrelated row "${id}" was rewritten (rowid changed)`).toBe(rowid)
  }
}
