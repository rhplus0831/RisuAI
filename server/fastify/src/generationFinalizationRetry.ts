import type { DatabaseSync } from 'node:sqlite'
import type { Message } from '../../../src/ts/storage/database.svelte'
import type { AssembleMutationPayload } from './prompt/assemble.js'
import type { GenerationFinalizationTargetSnapshot } from './routes/generationChat.js'

export type GenerationFinalizationMode = 'send' | 'continue' | 'regenerate'

const DAY_MS = 24 * 60 * 60 * 1000

export const GENERATION_FINALIZATION_TERMINAL_RETRY_RETENTION_MS = 7 * DAY_MS
export const GENERATION_FINALIZATION_TERMINAL_RETRY_SWEEP_LIMIT = 1000
export const GENERATION_FINALIZATION_LEGACY_SNAPSHOT_ERROR = 'stalled_legacy'

export interface GenerationFinalizationAttempt {
  generationId: string
  databaseLineage?: string
  operationId?: string
  operationAttemptNo?: number
  actorWriterSessionId?: string
  actorWriterEpoch?: number
  acceptedMessageId?: string
  terminalOutcome?: 'completed' | 'cancelled'
  chatId: string
  mode: GenerationFinalizationMode
  targetMessageId?: string
  message: Message
  alternateMessages?: Message[]
  chatVarMutations: AssembleMutationPayload['chatVarMutations']
  characterFieldMutations?: AssembleMutationPayload['characterFieldMutations']
  localLoreMutation?: AssembleMutationPayload['localLoreMutation']
  targetSnapshot?: GenerationFinalizationTargetSnapshot
}

interface GenerationFinalizationRetryRow {
  generation_id: string
  database_lineage: string | null
  operation_id: string | null
  operation_attempt_no: number | null
  actor_writer_session_id: string | null
  actor_writer_epoch: number | null
  accepted_message_id: string | null
  terminal_outcome: 'completed' | 'cancelled' | null
  chat_id: string
  mode: GenerationFinalizationMode
  target_message_id: string | null
  message_json: string
  alternate_messages_json: string
  chat_var_mutations_json: string
  target_snapshot_json: string | null
  failure_count: number
  last_error: string | null
  terminal_error: string | null
  status: 'pending' | 'terminal'
}

export interface PruneTerminalGenerationFinalizationRetriesOptions {
  now?: string | Date
  retentionMs?: number
  maxPerSweep?: number
}

export interface GenerationFinalizationRetryReceipt {
  generationId: string
}

export interface PendingGenerationFinalizationRetry {
  attempt: GenerationFinalizationAttempt
  replayability: 'replayable' | 'legacy_snapshot_missing'
}

interface GenerationFinalizationMutationEnvelope {
  chatVarMutations: AssembleMutationPayload['chatVarMutations']
  characterFieldMutations?: AssembleMutationPayload['characterFieldMutations']
  localLoreMutation?: AssembleMutationPayload['localLoreMutation']
}

function serializeGenerationFinalizationMutations(attempt: GenerationFinalizationAttempt): string {
  if (!attempt.characterFieldMutations?.length && !attempt.localLoreMutation) {
    return JSON.stringify(attempt.chatVarMutations)
  }
  return JSON.stringify({
    chatVarMutations: attempt.chatVarMutations,
    ...(attempt.characterFieldMutations?.length ? { characterFieldMutations: attempt.characterFieldMutations } : {}),
    ...(attempt.localLoreMutation ? { localLoreMutation: attempt.localLoreMutation } : {}),
  } satisfies GenerationFinalizationMutationEnvelope)
}

function parseGenerationFinalizationMutations(value: string): GenerationFinalizationMutationEnvelope {
  const parsed = JSON.parse(value) as unknown
  if (Array.isArray(parsed)) {
    return { chatVarMutations: parsed as AssembleMutationPayload['chatVarMutations'] }
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid generation finalization mutation payload')
  }
  const envelope = parsed as Partial<GenerationFinalizationMutationEnvelope>
  if (!Array.isArray(envelope.chatVarMutations)) {
    throw new Error('Invalid generation finalization chat variable mutations')
  }
  return envelope as GenerationFinalizationMutationEnvelope
}

function normalizeTimestamp(value: string | Date | undefined): string {
  const iso = value instanceof Date ? value.toISOString() : (value ?? new Date().toISOString())
  if (Number.isNaN(Date.parse(iso))) {
    throw new Error('now must be a valid timestamp')
  }
  return iso
}

function normalizeNonNegativeInteger(value: number | undefined, defaultValue: number, name: string): number {
  if (value === undefined) return defaultValue
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`)
  }
  return value
}

function normalizePositiveInteger(value: number | undefined, defaultValue: number, name: string): number {
  if (value === undefined) return defaultValue
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return value
}

export function createGenerationFinalizationRetryTable(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS generation_finalization_retries (
      generation_id TEXT PRIMARY KEY,
      database_lineage TEXT,
      operation_id TEXT,
      operation_attempt_no INTEGER CHECK (operation_attempt_no IS NULL OR operation_attempt_no > 0),
      actor_writer_session_id TEXT,
      actor_writer_epoch INTEGER CHECK (actor_writer_epoch IS NULL OR actor_writer_epoch >= 0),
      accepted_message_id TEXT,
      terminal_outcome TEXT CHECK (terminal_outcome IS NULL OR terminal_outcome IN ('completed', 'cancelled')),
      chat_id TEXT NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('send', 'continue', 'regenerate')),
      target_message_id TEXT,
      message_json TEXT NOT NULL CHECK (json_valid(message_json)),
      alternate_messages_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(alternate_messages_json)),
      chat_var_mutations_json TEXT NOT NULL CHECK (json_valid(chat_var_mutations_json)),
      target_snapshot_json TEXT CHECK (target_snapshot_json IS NULL OR json_valid(target_snapshot_json)),
      failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
      last_error TEXT,
      terminal_error TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'terminal')),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE INDEX IF NOT EXISTS idx_generation_finalization_retries_status
      ON generation_finalization_retries (status, updated_at);
  `)
}

export function enqueueGenerationFinalizationRetry(
  db: DatabaseSync,
  attempt: GenerationFinalizationAttempt,
): GenerationFinalizationRetryReceipt {
  if ((attempt.mode === 'continue' || attempt.mode === 'regenerate') && !attempt.targetSnapshot) {
    throw new Error(`Generation finalization ${attempt.mode} attempts require a target snapshot`)
  }
  const operationLineageValues = [
    attempt.databaseLineage,
    attempt.operationId,
    attempt.operationAttemptNo,
    attempt.actorWriterSessionId,
    attempt.actorWriterEpoch,
    attempt.terminalOutcome,
  ]
  const hasOperationLineage =
    operationLineageValues.some((value) => value !== undefined) || attempt.acceptedMessageId !== undefined
  if (hasOperationLineage && operationLineageValues.some((value) => value === undefined)) {
    throw new Error('Protocol generation finalization attempts require complete operation lineage')
  }
  if (attempt.operationId !== undefined && attempt.mode === 'send' && attempt.acceptedMessageId === undefined) {
    throw new Error('Protocol send finalization attempts require an accepted message id')
  }
  const result = db
    .prepare(
      `
      INSERT INTO generation_finalization_retries (
        generation_id,
        database_lineage,
        operation_id,
        operation_attempt_no,
        actor_writer_session_id,
        actor_writer_epoch,
        accepted_message_id,
        terminal_outcome,
        chat_id,
        mode,
        target_message_id,
        message_json,
        alternate_messages_json,
        chat_var_mutations_json,
        target_snapshot_json,
        status,
        last_error,
        terminal_error,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      ON CONFLICT(generation_id) DO UPDATE SET
        database_lineage = excluded.database_lineage,
        operation_id = excluded.operation_id,
        operation_attempt_no = excluded.operation_attempt_no,
        actor_writer_session_id = excluded.actor_writer_session_id,
        actor_writer_epoch = excluded.actor_writer_epoch,
        accepted_message_id = excluded.accepted_message_id,
        terminal_outcome = excluded.terminal_outcome,
        chat_id = excluded.chat_id,
        mode = excluded.mode,
        target_message_id = excluded.target_message_id,
        message_json = excluded.message_json,
        alternate_messages_json = excluded.alternate_messages_json,
        chat_var_mutations_json = excluded.chat_var_mutations_json,
        target_snapshot_json = excluded.target_snapshot_json,
        status = 'pending',
        last_error = NULL,
        terminal_error = NULL,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    `,
    )
    .run(
      attempt.generationId,
      attempt.databaseLineage ?? null,
      attempt.operationId ?? null,
      attempt.operationAttemptNo ?? null,
      attempt.actorWriterSessionId ?? null,
      attempt.actorWriterEpoch ?? null,
      attempt.acceptedMessageId ?? null,
      attempt.terminalOutcome ?? null,
      attempt.chatId,
      attempt.mode,
      attempt.targetMessageId ?? null,
      JSON.stringify(attempt.message),
      JSON.stringify(attempt.alternateMessages ?? []),
      serializeGenerationFinalizationMutations(attempt),
      attempt.targetSnapshot ? JSON.stringify(attempt.targetSnapshot) : null,
    )
  if (result.changes !== 1) {
    throw new Error(`Generation finalization journal write was not confirmed for ${attempt.generationId}`)
  }
  return { generationId: attempt.generationId }
}

export function deleteGenerationFinalizationRetry(
  db: DatabaseSync,
  generationId: string,
): GenerationFinalizationRetryReceipt {
  const result = db.prepare('DELETE FROM generation_finalization_retries WHERE generation_id = ?').run(generationId)
  if (result.changes !== 1) {
    throw new Error(`Generation finalization journal cleanup was not confirmed for ${generationId}`)
  }
  return { generationId }
}

export function pruneTerminalGenerationFinalizationRetries(
  db: DatabaseSync,
  options: PruneTerminalGenerationFinalizationRetriesOptions = {},
): number {
  const retentionMs = normalizeNonNegativeInteger(
    options.retentionMs,
    GENERATION_FINALIZATION_TERMINAL_RETRY_RETENTION_MS,
    'retentionMs',
  )
  const maxPerSweep = normalizePositiveInteger(
    options.maxPerSweep,
    GENERATION_FINALIZATION_TERMINAL_RETRY_SWEEP_LIMIT,
    'maxPerSweep',
  )
  const cutoff = new Date(Date.parse(normalizeTimestamp(options.now)) - retentionMs).toISOString()
  const result = db
    .prepare(
      `
        DELETE FROM generation_finalization_retries
        WHERE generation_id IN (
          SELECT generation_id
          FROM generation_finalization_retries
          WHERE status = 'terminal'
            AND terminal_error IS NOT '${GENERATION_FINALIZATION_LEGACY_SNAPSHOT_ERROR}'
            AND updated_at < ?
          ORDER BY updated_at ASC, generation_id ASC
          LIMIT ?
        )
      `,
    )
    .run(cutoff, maxPerSweep)
  return Number(result.changes)
}

export function markGenerationFinalizationRetryFailure(
  db: DatabaseSync,
  generationId: string,
  error: string,
  terminal: boolean,
): GenerationFinalizationRetryReceipt {
  const result = db
    .prepare(
      `
      UPDATE generation_finalization_retries
      SET
        failure_count = failure_count + 1,
        last_error = ?,
        terminal_error = CASE WHEN ? THEN ? ELSE terminal_error END,
        status = CASE WHEN ? THEN 'terminal' ELSE 'pending' END,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE generation_id = ?
    `,
    )
    .run(error, terminal ? 1 : 0, terminal ? error : null, terminal ? 1 : 0, generationId)
  if (result.changes !== 1) {
    throw new Error(`Generation finalization retry bookkeeping was not confirmed for ${generationId}`)
  }
  return { generationId }
}

export function listPendingGenerationFinalizationRetries(
  db: DatabaseSync,
  limit = 25,
): PendingGenerationFinalizationRetry[] {
  const boundedLimit = Number.isSafeInteger(limit) && limit > 0 ? limit : 25
  const rows = db
    .prepare(
      `
        SELECT
          generation_id,
          database_lineage,
          operation_id,
          operation_attempt_no,
          actor_writer_session_id,
          actor_writer_epoch,
          accepted_message_id,
          terminal_outcome,
          chat_id,
          mode,
          target_message_id,
          message_json,
          alternate_messages_json,
          chat_var_mutations_json,
          target_snapshot_json,
          failure_count,
          last_error,
          terminal_error,
          status
        FROM generation_finalization_retries
        WHERE status = 'pending'
        ORDER BY updated_at ASC, created_at ASC
        LIMIT ?
      `,
    )
    .all(boundedLimit) as unknown as GenerationFinalizationRetryRow[]

  return rows.map((row) => {
    const alternateMessages = JSON.parse(row.alternate_messages_json) as Message[]
    const mutations = parseGenerationFinalizationMutations(row.chat_var_mutations_json)
    const legacySnapshotMissing =
      (row.mode === 'continue' || row.mode === 'regenerate') && row.target_snapshot_json === null
    return {
      attempt: {
        generationId: row.generation_id,
        ...(row.database_lineage !== null ? { databaseLineage: row.database_lineage } : {}),
        ...(row.operation_id !== null ? { operationId: row.operation_id } : {}),
        ...(row.operation_attempt_no !== null ? { operationAttemptNo: row.operation_attempt_no } : {}),
        ...(row.actor_writer_session_id !== null ? { actorWriterSessionId: row.actor_writer_session_id } : {}),
        ...(row.actor_writer_epoch !== null ? { actorWriterEpoch: row.actor_writer_epoch } : {}),
        ...(row.accepted_message_id !== null ? { acceptedMessageId: row.accepted_message_id } : {}),
        ...(row.terminal_outcome !== null ? { terminalOutcome: row.terminal_outcome } : {}),
        chatId: row.chat_id,
        mode: row.mode,
        ...(row.target_message_id !== null ? { targetMessageId: row.target_message_id } : {}),
        message: JSON.parse(row.message_json) as Message,
        ...(alternateMessages.length > 0 ? { alternateMessages } : {}),
        chatVarMutations: mutations.chatVarMutations,
        ...(mutations.characterFieldMutations?.length
          ? { characterFieldMutations: mutations.characterFieldMutations }
          : {}),
        ...(mutations.localLoreMutation ? { localLoreMutation: mutations.localLoreMutation } : {}),
        ...(row.target_snapshot_json !== null
          ? { targetSnapshot: JSON.parse(row.target_snapshot_json) as GenerationFinalizationTargetSnapshot }
          : {}),
      },
      replayability: legacySnapshotMissing ? 'legacy_snapshot_missing' : 'replayable',
    }
  })
}
