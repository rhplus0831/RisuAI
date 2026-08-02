import type { DatabaseSync } from 'node:sqlite'
import type { Message } from '../../../src/ts/storage/database.svelte'
import type { AssembleMutationPayload } from './prompt/assemble.js'
import type { GenerationFinalizationTargetSnapshot } from './routes/generationChat.js'

export type GenerationFinalizationMode = 'send' | 'continue' | 'regenerate'

const DAY_MS = 24 * 60 * 60 * 1000

export const GENERATION_FINALIZATION_TERMINAL_RETRY_RETENTION_MS = 7 * DAY_MS
export const GENERATION_FINALIZATION_TERMINAL_RETRY_SWEEP_LIMIT = 1000

export interface GenerationFinalizationAttempt {
  generationId: string
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

export function enqueueGenerationFinalizationRetry(db: DatabaseSync, attempt: GenerationFinalizationAttempt): void {
  db.prepare(
    `
      INSERT INTO generation_finalization_retries (
        generation_id,
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
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      ON CONFLICT(generation_id) DO UPDATE SET
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
  ).run(
    attempt.generationId,
    attempt.chatId,
    attempt.mode,
    attempt.targetMessageId ?? null,
    JSON.stringify(attempt.message),
    JSON.stringify(attempt.alternateMessages ?? []),
    serializeGenerationFinalizationMutations(attempt),
    attempt.targetSnapshot ? JSON.stringify(attempt.targetSnapshot) : null,
  )
}

export function deleteGenerationFinalizationRetry(db: DatabaseSync, generationId: string): void {
  db.prepare('DELETE FROM generation_finalization_retries WHERE generation_id = ?').run(generationId)
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
): void {
  db.prepare(
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
  ).run(error, terminal ? 1 : 0, terminal ? error : null, terminal ? 1 : 0, generationId)
}

export function listPendingGenerationFinalizationRetries(
  db: DatabaseSync,
  limit = 25,
): GenerationFinalizationAttempt[] {
  const boundedLimit = Number.isSafeInteger(limit) && limit > 0 ? limit : 25
  const rows = db
    .prepare(
      `
        SELECT
          generation_id,
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
    return {
      generationId: row.generation_id,
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
    }
  })
}
