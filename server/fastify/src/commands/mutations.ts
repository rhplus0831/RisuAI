import type { DatabaseSync } from 'node:sqlite'
import { bumpRevision, getSchemaState } from '../db.js'
import {
  RevisionMismatchError,
  ValidationError,
  loadPersisted,
  loadPersistedWithMessages,
  writePersisted,
  writePersistedWithMessages,
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
  let wrotePersisted = false
  let transactionOpen = false
  // Message-free snapshot of db.json for rollback restore. Messages roll back
  // with the SQLite transaction; db.json (a file write) is restored manually.
  let previousMessageFree = loadPersisted(args.dataDir)

  args.db.exec('BEGIN IMMEDIATE')
  transactionOpen = true

  try {
    const { revision: currentRevision } = getSchemaState(args.db)
    if (args.baseRevision !== currentRevision) {
      throw new RevisionMismatchError(currentRevision)
    }

    previousMessageFree = loadPersisted(args.dataDir)
    // Hydrate messages so the mutate callback sees the full `chat.message[]`.
    const hydrated = loadPersistedWithMessages(args.db, args.dataDir)
    const nextDatabase = cloneJsonValue(hydrated.database)
    const mutation = args.mutate(nextDatabase)

    // Set before the write: any failure inside the split rolls db.json back too.
    wrotePersisted = true
    writePersistedWithMessages(args.db, args.dataDir, { ...hydrated, database: nextDatabase })

    const revision = bumpRevision(args.db)
    const event: CommandEvent = { ...mutation.event, revision }

    args.db.exec('COMMIT')
    transactionOpen = false
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
    if (wrotePersisted) {
      writePersisted(args.dataDir, previousMessageFree)
    }
    throw err
  }
}

function cloneJsonValue<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}
