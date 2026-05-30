import type { DatabaseSync } from 'node:sqlite'
import { bumpRevision, getSchemaState } from '../db.js'
import {
  RevisionMismatchError,
  ValidationError,
  loadPersistedWithMessages,
  stripChatMessages,
  syncChatMessages,
  writePersisted,
} from '../repository.js'
import type { CommandEvent, CommandEventDraft, CommandEventSink } from './events.js'

export interface JsonCommandMutationResult<TExtra extends Record<string, unknown>> {
  revision: number
  event: CommandEvent
  extra: TExtra
}

export interface JsonCommandMutationArgs<TExtra extends Record<string, unknown>> {
  db: DatabaseSync
  dataDir: string
  baseRevision: number
  eventSink: CommandEventSink
  mutate: (database: unknown) => {
    event: CommandEventDraft
    extra?: TExtra
    /**
     * Optional extra SQLite writes to run INSIDE the same transaction, after the
     * active-message sync and before COMMIT — so they roll back atomically with
     * the JSON mutation + revision bump. Phase 6c uses this for the reroll-buffer
     * (alternate) rows, which live in SQLite only (not the JSON `database`).
     */
    sqlite?: (db: DatabaseSync) => void
  }
}

export function readBaseRevision(body: unknown): number {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationError('request body must be an object')
  }
  const baseRevision = (body as { baseRevision?: unknown }).baseRevision
  if (!Number.isInteger(baseRevision) || (baseRevision as number) < 0) {
    throw new ValidationError('baseRevision must be a non-negative integer')
  }
  return baseRevision as number
}

export function applyJsonCommandMutation<TExtra extends Record<string, unknown> = {}>(
  args: JsonCommandMutationArgs<TExtra>,
): JsonCommandMutationResult<TExtra> {
  let transactionOpen = false

  args.db.exec('BEGIN IMMEDIATE')
  transactionOpen = true

  try {
    const { revision: currentRevision } = getSchemaState(args.db)
    if (args.baseRevision !== currentRevision) {
      throw new RevisionMismatchError(currentRevision)
    }

    // Hydrate messages so the mutate callback sees the full `chat.message[]`.
    const hydrated = loadPersistedWithMessages(args.db, args.dataDir)
    const nextDatabase = cloneJsonValue(hydrated.database)
    const mutation = args.mutate(nextDatabase)

    // Surgically persist only the chats whose messages changed (Slice 4.2): a
    // message append is one row insert, an unrelated chat is never rewritten, and
    // a non-message command writes nothing to the messages table. Inside the
    // transaction; the db.json file write is deferred until after COMMIT.
    syncChatMessages(args.db, hydrated.database, nextDatabase)
    // Phase 6c: extra SQLite-only writes (the reroll buffer) inside the same
    // transaction, so they commit/roll back with the message sync + revision bump.
    mutation.sqlite?.(args.db)
    const messageFree = stripChatMessages({ ...hydrated, database: nextDatabase })

    const revision = bumpRevision(args.db)
    const event: CommandEvent = { ...mutation.event, revision }

    args.db.exec('COMMIT')
    transactionOpen = false
    // db.json is durable only after the SQLite COMMIT, never ahead of it. On any
    // pre-COMMIT failure the transaction rolls back the message rows + revision
    // and db.json was never touched — no manual restore needed.
    writePersisted(args.dataDir, messageFree)
    args.eventSink.emit(event)

    return {
      revision,
      event,
      extra: (mutation.extra ?? {}) as TExtra,
    }
  } catch (err) {
    if (transactionOpen) {
      args.db.exec('ROLLBACK')
    }
    throw err
  }
}

function cloneJsonValue<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}
