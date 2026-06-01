import type { DatabaseSync } from 'node:sqlite'
import type { Message } from '../../../src/ts/storage/database.svelte'
import type { AssembleMutationPayload } from './prompt/assemble.js'

export type GenerationFinalizationMode = 'send' | 'continue' | 'regenerate'

export interface GenerationFinalizationAttempt {
  generationId: string
  chatId: string
  mode: GenerationFinalizationMode
  targetMessageId?: string
  message: Message
  chatVarMutations: AssembleMutationPayload['chatVarMutations']
}

interface GenerationFinalizationRetryRow {
  generation_id: string
  chat_id: string
  mode: GenerationFinalizationMode
  target_message_id: string | null
  message_json: string
  chat_var_mutations_json: string
  failure_count: number
  last_error: string | null
  terminal_error: string | null
  status: 'pending' | 'terminal'
}

export function createGenerationFinalizationRetryTable(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS generation_finalization_retries (
      generation_id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('send', 'continue', 'regenerate')),
      target_message_id TEXT,
      message_json TEXT NOT NULL CHECK (json_valid(message_json)),
      chat_var_mutations_json TEXT NOT NULL CHECK (json_valid(chat_var_mutations_json)),
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
): void {
  db.prepare(
    `
      INSERT INTO generation_finalization_retries (
        generation_id,
        chat_id,
        mode,
        target_message_id,
        message_json,
        chat_var_mutations_json,
        status,
        last_error,
        terminal_error,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      ON CONFLICT(generation_id) DO UPDATE SET
        chat_id = excluded.chat_id,
        mode = excluded.mode,
        target_message_id = excluded.target_message_id,
        message_json = excluded.message_json,
        chat_var_mutations_json = excluded.chat_var_mutations_json,
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
    JSON.stringify(attempt.chatVarMutations),
  )
}

export function deleteGenerationFinalizationRetry(db: DatabaseSync, generationId: string): void {
  db.prepare('DELETE FROM generation_finalization_retries WHERE generation_id = ?').run(
    generationId,
  )
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
          chat_var_mutations_json,
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
    .all(boundedLimit) as GenerationFinalizationRetryRow[]

  return rows.map((row) => ({
    generationId: row.generation_id,
    chatId: row.chat_id,
    mode: row.mode,
    ...(row.target_message_id !== null ? { targetMessageId: row.target_message_id } : {}),
    message: JSON.parse(row.message_json) as Message,
    chatVarMutations: JSON.parse(
      row.chat_var_mutations_json,
    ) as AssembleMutationPayload['chatVarMutations'],
  }))
}
