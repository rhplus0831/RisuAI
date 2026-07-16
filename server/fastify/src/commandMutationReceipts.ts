import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { CommandEvent } from './commands/events.js'
import { assertDatabaseLineage, getDatabaseLineage } from './databaseLineage.js'

export const COMMAND_MUTATION_ID_HEADER = 'risu-mutation-id'
export const COMMAND_MUTATION_ID_MAX_LENGTH = 128
export const COMMAND_MUTATION_ACK_MAX_REQUEST_COUNT = 100
export const COMMAND_MUTATION_ACK_GRACE_HOURS = 24

export interface CommandMutationReceiptKey {
  databaseLineage: string
  writerSessionId: string
  mutationId: string
  requestFingerprint: string
}

export interface CommandMutationReceiptResult<TExtra extends Record<string, unknown>> {
  revision: number
  event: CommandEvent
  extra: TExtra
}

interface CommandMutationReceiptRow {
  requestFingerprint: string
  responseJson: string
}

export class CommandMutationIdConflictError extends Error {
  constructor() {
    super('risu-mutation-id was already used for a different command')
    this.name = 'CommandMutationIdConflictError'
  }
}

export function createCommandMutationReceiptTable(db: DatabaseSync): void {
  createCanonicalCommandMutationReceiptTable(db)
  createCommandMutationReceiptIndexes(db)
}

export function migrateCommandMutationReceiptsToDatabaseLineage(db: DatabaseSync): void {
  const columns = db.prepare('PRAGMA table_info(command_mutation_receipts)').all() as Array<{ name: string }>
  if (columns.length === 0) {
    createCommandMutationReceiptTable(db)
    return
  }
  if (columns.some((column) => column.name === 'database_lineage')) {
    createCommandMutationReceiptTable(db)
    return
  }

  const databaseLineage = getDatabaseLineage(db)
  db.exec(`
    DROP INDEX IF EXISTS idx_command_mutation_receipts_created_at;
    ALTER TABLE command_mutation_receipts RENAME TO command_mutation_receipts_v24;
  `)
  createCanonicalCommandMutationReceiptTable(db)
  db.prepare(
    `
      INSERT INTO command_mutation_receipts (
        mutation_id,
        database_lineage,
        creator_writer_session_id,
        request_fingerprint,
        response_json,
        created_at
      )
      SELECT mutation_id, ?, creator_writer_session_id, request_fingerprint, response_json, created_at
      FROM command_mutation_receipts_v24
    `,
  ).run(databaseLineage)
  db.exec('DROP TABLE command_mutation_receipts_v24')
  createCommandMutationReceiptIndexes(db)
}

function createCanonicalCommandMutationReceiptTable(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS command_mutation_receipts (
      mutation_id TEXT PRIMARY KEY,
      database_lineage TEXT NOT NULL,
      creator_writer_session_id TEXT NOT NULL,
      request_fingerprint TEXT NOT NULL,
      response_json TEXT NOT NULL CHECK (json_valid(response_json)),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      acknowledged_at TEXT,
      delete_after TEXT
    )
  `)
}

function createCommandMutationReceiptIndexes(db: DatabaseSync): void {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_command_mutation_receipts_created_at
      ON command_mutation_receipts (created_at);

    CREATE INDEX IF NOT EXISTS idx_command_mutation_receipts_delete_after
      ON command_mutation_receipts (delete_after);
  `)
}

/**
 * Fingerprints command semantics, not the optimistic-concurrency cursor. A
 * legitimate stale-revision retry may rebuild only `baseRevision`, while a
 * reused mutation id with a different route or payload must fail closed.
 */
export function commandMutationRequestFingerprint(method: string, path: string, body: unknown): string {
  const semanticBody = isJsonRecord(body)
    ? Object.fromEntries(Object.entries(body).filter(([key]) => key !== 'baseRevision'))
    : body
  const canonical = canonicalJsonValue({
    method: method.toUpperCase(),
    path,
    body: semanticBody,
  })
  return createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex')
}

export function loadCommandMutationReceipt<TExtra extends Record<string, unknown>>(
  db: DatabaseSync,
  key: CommandMutationReceiptKey,
): CommandMutationReceiptResult<TExtra> | undefined {
  assertDatabaseLineage(db, key.databaseLineage)
  const row = db
    .prepare(
      `
        SELECT request_fingerprint AS requestFingerprint,
               response_json AS responseJson
        FROM command_mutation_receipts
        WHERE mutation_id = ? AND database_lineage = ?
      `,
    )
    .get(key.mutationId, key.databaseLineage) as unknown as CommandMutationReceiptRow | undefined
  if (!row) return undefined
  if (row.requestFingerprint !== key.requestFingerprint) {
    throw new CommandMutationIdConflictError()
  }
  return parseStoredResult<TExtra>(row.responseJson)
}

export function persistCommandMutationReceipt<TExtra extends Record<string, unknown>>(
  db: DatabaseSync,
  key: CommandMutationReceiptKey,
  result: CommandMutationReceiptResult<TExtra>,
): void {
  assertDatabaseLineage(db, key.databaseLineage)
  pruneAcknowledgedCommandMutationReceipts(db)
  db.prepare(
    `
      INSERT INTO command_mutation_receipts (
        mutation_id,
        database_lineage,
        creator_writer_session_id,
        request_fingerprint,
        response_json
      ) VALUES (?, ?, ?, ?, ?)
    `,
  ).run(key.mutationId, key.databaseLineage, key.writerSessionId, key.requestFingerprint, JSON.stringify(result))
}

export function acknowledgeCommandMutationReceipts(
  db: DatabaseSync,
  databaseLineage: string,
  mutationIds: readonly string[],
): number {
  if (mutationIds.length === 0) return 0
  let transactionOpen = false
  db.exec('BEGIN IMMEDIATE')
  transactionOpen = true
  try {
    assertDatabaseLineage(db, databaseLineage)
    pruneAcknowledgedCommandMutationReceipts(db)
    const acknowledge = db.prepare(
      `
        UPDATE command_mutation_receipts
        SET acknowledged_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
            delete_after = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)
        WHERE mutation_id = ?
          AND database_lineage = ?
          AND acknowledged_at IS NULL
      `,
    )
    let acknowledged = 0
    for (const mutationId of mutationIds) {
      acknowledged += Number(
        acknowledge.run(`+${COMMAND_MUTATION_ACK_GRACE_HOURS} hours`, mutationId, databaseLineage).changes,
      )
    }
    db.exec('COMMIT')
    transactionOpen = false
    return acknowledged
  } catch (error) {
    if (transactionOpen) db.exec('ROLLBACK')
    throw error
  }
}

export function pruneAcknowledgedCommandMutationReceipts(db: DatabaseSync): number {
  return Number(
    db
      .prepare(
        `
          DELETE FROM command_mutation_receipts
          WHERE acknowledged_at IS NOT NULL
            AND delete_after IS NOT NULL
            AND delete_after <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        `,
      )
      .run().changes,
  )
}

function parseStoredResult<TExtra extends Record<string, unknown>>(
  responseJson: string,
): CommandMutationReceiptResult<TExtra> {
  let value: unknown
  try {
    value = JSON.parse(responseJson)
  } catch {
    throw new Error('Stored command mutation receipt is not valid JSON')
  }
  if (!isJsonRecord(value)) {
    throw new Error('Stored command mutation receipt must be an object')
  }
  if (!Number.isSafeInteger(value.revision) || (value.revision as number) < 0) {
    throw new Error('Stored command mutation receipt has an invalid revision')
  }
  if (!isJsonRecord(value.event) || value.event.revision !== value.revision) {
    throw new Error('Stored command mutation receipt has an invalid event')
  }
  if (!isJsonRecord(value.extra)) {
    throw new Error('Stored command mutation receipt has invalid extra data')
  }
  return value as unknown as CommandMutationReceiptResult<TExtra>
}

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJsonValue)
  if (!isJsonRecord(value)) return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalJsonValue(entry)]),
  )
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
