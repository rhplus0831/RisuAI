import type { DatabaseSync } from 'node:sqlite'
import { bumpRevision, getSchemaState } from '../db.js'
import {
  RevisionMismatchError,
  ValidationError,
  loadPersisted,
  loadPersistedWithMessages,
  stripChatMessages,
  syncChatMessages,
  writePersisted,
} from '../repository.js'
import {
  persistCommandEvent,
  type CommandEvent,
  type CommandEventDraft,
  type CommandEventSink,
} from './events.js'
import { emitProtocolMetric, protocolDurationMs, protocolNowMs } from '../protocolMetrics.js'

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
     * the JSON mutation + revision bump. Used for SQLite-only rows such as
     * reroll-buffer alternates.
     */
    sqlite?: (db: DatabaseSync) => void
  }
}

export interface MessageFreeJsonCommandMutationArgs<TExtra extends Record<string, unknown>> {
  db: DatabaseSync
  dataDir: string
  baseRevision: number
  eventSink: CommandEventSink
  mutate: (database: unknown) => {
    event: CommandEventDraft
    extra?: TExtra
  }
}

export interface TargetedCommandMutationArgs<TExtra extends Record<string, unknown>> {
  db: DatabaseSync
  dataDir: string
  baseRevision: number
  eventSink: CommandEventSink
  mutationPath: string
  writeDatabase?: boolean
  mutate: (
    database: unknown,
    db: DatabaseSync,
  ) => {
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

export function applyTargetedCommandMutation<TExtra extends Record<string, unknown> = {}>(
  args: TargetedCommandMutationArgs<TExtra>,
): JsonCommandMutationResult<TExtra> {
  let transactionOpen = false
  const totalStartedAt = protocolNowMs()
  let loadMs = 0
  let cloneMutateMs = 0
  let sqliteSyncMs = 0
  let dbJsonWriteMs = 0
  let eventEmitMs = 0

  args.db.exec('BEGIN IMMEDIATE')
  transactionOpen = true

  try {
    const { revision: currentRevision } = getSchemaState(args.db)
    if (args.baseRevision !== currentRevision) {
      throw new RevisionMismatchError(currentRevision)
    }

    const loadStartedAt = protocolNowMs()
    const persisted = loadPersisted(args.dataDir)
    loadMs = protocolDurationMs(loadStartedAt)

    const cloneMutateStartedAt = protocolNowMs()
    const mutation = args.mutate(persisted.database, args.db)
    cloneMutateMs = protocolDurationMs(cloneMutateStartedAt)

    const sqliteSyncStartedAt = protocolNowMs()
    const revision = bumpRevision(args.db)
    const event: CommandEvent = { ...mutation.event, revision }
    persistCommandEvent(args.db, event)
    sqliteSyncMs = protocolDurationMs(sqliteSyncStartedAt)

    args.db.exec('COMMIT')
    transactionOpen = false
    if (args.writeDatabase) {
      const dbJsonWriteStartedAt = protocolNowMs()
      stripChatMessages(persisted)
      writePersisted(args.dataDir, persisted)
      dbJsonWriteMs = protocolDurationMs(dbJsonWriteStartedAt)
    }
    const eventEmitStartedAt = protocolNowMs()
    args.eventSink.emit(event)
    eventEmitMs = protocolDurationMs(eventEmitStartedAt)
    emitProtocolMetric('command_mutation', {
      type: event.type,
      resource: event.resource,
      revision,
      loadMs,
      cloneMutateMs,
      sqliteSyncMs,
      dbJsonWriteMs,
      eventEmitMs,
      totalMs: protocolDurationMs(totalStartedAt),
      status: 'ok',
      mutationPath: args.mutationPath,
    })

    return {
      revision,
      event,
      extra: (mutation.extra ?? {}) as TExtra,
    }
  } catch (err) {
    if (transactionOpen) {
      args.db.exec('ROLLBACK')
    }
    emitProtocolMetric('command_mutation', {
      loadMs,
      cloneMutateMs,
      sqliteSyncMs,
      dbJsonWriteMs,
      eventEmitMs,
      totalMs: protocolDurationMs(totalStartedAt),
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
      mutationPath: args.mutationPath,
    })
    throw err
  }
}

export function applyMessageFreeJsonCommandMutation<TExtra extends Record<string, unknown> = {}>(
  args: MessageFreeJsonCommandMutationArgs<TExtra>,
): JsonCommandMutationResult<TExtra> {
  let transactionOpen = false
  const totalStartedAt = protocolNowMs()
  let loadMs = 0
  let cloneMutateMs = 0
  let sqliteSyncMs = 0
  let dbJsonWriteMs = 0
  let eventEmitMs = 0

  args.db.exec('BEGIN IMMEDIATE')
  transactionOpen = true

  try {
    const { revision: currentRevision } = getSchemaState(args.db)
    if (args.baseRevision !== currentRevision) {
      throw new RevisionMismatchError(currentRevision)
    }

    // Only use this path for commands that never inspect or mutate chat
    // messages; it intentionally reads the message-free db.json blob.
    const loadStartedAt = protocolNowMs()
    const persisted = loadPersisted(args.dataDir)
    loadMs = protocolDurationMs(loadStartedAt)

    const cloneMutateStartedAt = protocolNowMs()
    const mutation = args.mutate(persisted.database)
    cloneMutateMs = protocolDurationMs(cloneMutateStartedAt)

    const sqliteSyncStartedAt = protocolNowMs()
    const revision = bumpRevision(args.db)
    const event: CommandEvent = { ...mutation.event, revision }
    persistCommandEvent(args.db, event)
    sqliteSyncMs = protocolDurationMs(sqliteSyncStartedAt)

    args.db.exec('COMMIT')
    transactionOpen = false
    const dbJsonWriteStartedAt = protocolNowMs()
    stripChatMessages(persisted)
    writePersisted(args.dataDir, persisted)
    dbJsonWriteMs = protocolDurationMs(dbJsonWriteStartedAt)
    const eventEmitStartedAt = protocolNowMs()
    args.eventSink.emit(event)
    eventEmitMs = protocolDurationMs(eventEmitStartedAt)
    emitProtocolMetric('command_mutation', {
      type: event.type,
      resource: event.resource,
      revision,
      loadMs,
      cloneMutateMs,
      sqliteSyncMs,
      dbJsonWriteMs,
      eventEmitMs,
      totalMs: protocolDurationMs(totalStartedAt),
      status: 'ok',
      mutationPath: 'message-free',
    })

    return {
      revision,
      event,
      extra: (mutation.extra ?? {}) as TExtra,
    }
  } catch (err) {
    if (transactionOpen) {
      args.db.exec('ROLLBACK')
    }
    emitProtocolMetric('command_mutation', {
      loadMs,
      cloneMutateMs,
      sqliteSyncMs,
      dbJsonWriteMs,
      eventEmitMs,
      totalMs: protocolDurationMs(totalStartedAt),
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
      mutationPath: 'message-free',
    })
    throw err
  }
}

export function applyJsonCommandMutation<TExtra extends Record<string, unknown> = {}>(
  args: JsonCommandMutationArgs<TExtra>,
): JsonCommandMutationResult<TExtra> {
  let transactionOpen = false
  const totalStartedAt = protocolNowMs()
  let loadMs = 0
  let cloneMutateMs = 0
  let sqliteSyncMs = 0
  let dbJsonWriteMs = 0
  let eventEmitMs = 0

  args.db.exec('BEGIN IMMEDIATE')
  transactionOpen = true

  try {
    const { revision: currentRevision } = getSchemaState(args.db)
    if (args.baseRevision !== currentRevision) {
      throw new RevisionMismatchError(currentRevision)
    }

    // Hydrate messages so the mutate callback sees the full `chat.message[]`.
    const loadStartedAt = protocolNowMs()
    const hydrated = loadPersistedWithMessages(args.db, args.dataDir)
    loadMs = protocolDurationMs(loadStartedAt)
    const cloneMutateStartedAt = protocolNowMs()
    const nextDatabase = cloneJsonValue(hydrated.database)
    const mutation = args.mutate(nextDatabase)
    cloneMutateMs = protocolDurationMs(cloneMutateStartedAt)

    // Persist only chats whose messages changed: a message append is one row
    // insert, unrelated chats are not rewritten, and non-message commands write
    // nothing to the messages table. The db.json write is deferred until COMMIT.
    const sqliteSyncStartedAt = protocolNowMs()
    syncChatMessages(args.db, hydrated.database, nextDatabase)
    // Extra SQLite-only writes, such as the reroll buffer, commit or roll back
    // with the message sync and revision bump.
    mutation.sqlite?.(args.db)
    const messageFree = stripChatMessages({ ...hydrated, database: nextDatabase })

    const revision = bumpRevision(args.db)
    const event: CommandEvent = { ...mutation.event, revision }
    persistCommandEvent(args.db, event)
    sqliteSyncMs = protocolDurationMs(sqliteSyncStartedAt)

    args.db.exec('COMMIT')
    transactionOpen = false
    // db.json is durable only after the SQLite COMMIT, never ahead of it. On any
    // pre-COMMIT failure the transaction rolls back the message rows + revision
    // and db.json was never touched — no manual restore needed.
    const dbJsonWriteStartedAt = protocolNowMs()
    writePersisted(args.dataDir, messageFree)
    dbJsonWriteMs = protocolDurationMs(dbJsonWriteStartedAt)
    const eventEmitStartedAt = protocolNowMs()
    args.eventSink.emit(event)
    eventEmitMs = protocolDurationMs(eventEmitStartedAt)
    emitProtocolMetric('command_mutation', {
      type: event.type,
      resource: event.resource,
      revision,
      loadMs,
      cloneMutateMs,
      sqliteSyncMs,
      dbJsonWriteMs,
      eventEmitMs,
      totalMs: protocolDurationMs(totalStartedAt),
      status: 'ok',
      mutationPath: 'hydrated',
    })

    return {
      revision,
      event,
      extra: (mutation.extra ?? {}) as TExtra,
    }
  } catch (err) {
    if (transactionOpen) {
      args.db.exec('ROLLBACK')
    }
    emitProtocolMetric('command_mutation', {
      loadMs,
      cloneMutateMs,
      sqliteSyncMs,
      dbJsonWriteMs,
      eventEmitMs,
      totalMs: protocolDurationMs(totalStartedAt),
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
      mutationPath: 'hydrated',
    })
    throw err
  }
}

function cloneJsonValue<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}
