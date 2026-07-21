import type { DatabaseSync } from 'node:sqlite'

export const INITIALIZE_CONFLICT_ERROR = 'initialize_conflict'

export type DatabaseInitializationState = 'uninitialized' | 'initialized' | 'conflict'

export interface DatabaseInitializationAssessment {
  state: DatabaseInitializationState
  evidence: readonly string[]
}

export class InitializeConflictError extends Error {
  readonly code = INITIALIZE_CONFLICT_ERROR

  constructor(readonly evidence: readonly string[]) {
    super(INITIALIZE_CONFLICT_ERROR)
    this.name = 'InitializeConflictError'
  }
}

function settingsRowIsObject(db: DatabaseSync): boolean {
  const row = db.prepare('SELECT data_json FROM settings WHERE id = 1').get() as { data_json: string } | undefined
  if (!row) return false

  try {
    const parsed: unknown = JSON.parse(row.data_json)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
  } catch {
    return false
  }
}

/**
 * Classify whether first-run initialization is safe.
 *
 * A valid settings object is the normal initialization authority. When that
 * row is missing or malformed, durable domain rows and revision history form a
 * second, fail-closed authority: they prove this is a damaged existing
 * database, not a fresh one that may be seeded.
 */
export function assessDatabaseInitialization(db: DatabaseSync): DatabaseInitializationAssessment {
  if (settingsRowIsObject(db)) {
    return { state: 'initialized', evidence: [] }
  }

  const row = db
    .prepare(
      `
        SELECT
          EXISTS(SELECT 1 FROM characters LIMIT 1) AS characters,
          EXISTS(SELECT 1 FROM chats LIMIT 1) AS chats,
          EXISTS(SELECT 1 FROM messages LIMIT 1) AS messages,
          COALESCE((SELECT revision FROM schema_version WHERE id = 1), 0) AS revision,
          EXISTS(SELECT 1 FROM command_events LIMIT 1) AS command_events
      `,
    )
    .get() as {
    characters: number
    chats: number
    messages: number
    revision: number
    command_events: number
  }

  const evidence: string[] = []
  if (row.characters !== 0) evidence.push('characters')
  if (row.chats !== 0) evidence.push('chats')
  if (row.messages !== 0) evidence.push('messages')
  if (row.revision > 0) evidence.push(`revision=${row.revision}`)
  if (row.command_events !== 0) evidence.push('command_events')

  return evidence.length > 0 ? { state: 'conflict', evidence } : { state: 'uninitialized', evidence: [] }
}
