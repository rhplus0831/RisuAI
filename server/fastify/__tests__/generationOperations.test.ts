import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { openDatabase } from '../src/db.js'
import { getDatabaseLineage } from '../src/databaseLineage.js'
import {
  GenerationOperationAttemptConflictError,
  InvalidGenerationOperationTransitionError,
  bindCancelledGenerationOperation,
  createGenerationOperation,
  generationOperationRequestFingerprint,
  getGenerationOperationProjectionEpoch,
  reconcileGenerationOperationsAtStartup,
  reserveGenerationOperationAttempt,
  transitionGenerationOperation,
} from '../src/generationOperations.js'

const dataDirs: string[] = []

function openTestDatabase() {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-generation-operations-'))
  dataDirs.push(dataDir)
  const db = openDatabase(dataDir)
  return { db, lineage: getDatabaseLineage(db) }
}

function acceptedInput(lineage: string, operationId = 'operation-a', chatId = 'chat-a') {
  return {
    databaseLineage: lineage,
    operationId,
    protocolVersion: 1,
    requestOrigin: 'accepted_send' as const,
    creatorWriterSessionId: 'writer-a',
    creatorWriterEpoch: 2,
    bindingServerInstanceId: 'server-a',
    characterId: 'character-a',
    chatId,
    mode: 'send' as const,
    acceptedMessageId: `message-${operationId}`,
    clientDraftGeneration: { databaseLineage: lineage, sequence: 4 },
    requestFingerprint: 'a'.repeat(64),
    intent: { mode: 'send', syntheticSayNothing: false },
    acceptedRevision: 7,
    state: 'accepted' as const,
    createdAt: '2026-08-11T00:00:00.000Z',
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.RISU_PROTOCOL_METRICS
  for (const dataDir of dataDirs.splice(0)) rmSync(dataDir, { recursive: true, force: true })
})

describe('generation operation store', () => {
  it('canonicalizes immutable request semantics and excludes only baseRevision from the fingerprint', () => {
    const first = generationOperationRequestFingerprint({
      baseRevision: 4,
      operationId: 'operation-a',
      nested: { z: 1, a: ['text', -0, true] },
    })
    const replay = generationOperationRequestFingerprint({
      nested: { a: ['text', 0, true], z: 1 },
      operationId: 'operation-a',
      baseRevision: 99,
    })
    const changed = generationOperationRequestFingerprint({
      operationId: 'operation-a',
      nested: { a: ['changed', 0, true], z: 1 },
      baseRevision: 99,
    })

    expect(first).toMatch(/^[a-f0-9]{64}$/)
    expect(replay).toBe(first)
    expect(changed).not.toBe(first)
  })

  it('guards state/version transitions, advances epochs, and rejects invalid terminal shortcuts', () => {
    const { db, lineage } = openTestDatabase()
    try {
      const accepted = createGenerationOperation(db, acceptedInput(lineage))
      expect(accepted).toMatchObject({
        state: 'accepted',
        stateVersion: 1,
        projectionEpoch: 1,
        clientDraftGeneration: { databaseLineage: lineage, sequence: 4 },
      })
      expect(getGenerationOperationProjectionEpoch(db)).toBe(1)

      expect(() =>
        transitionGenerationOperation(db, {
          databaseLineage: lineage,
          operationId: 'operation-a',
          expectedState: 'accepted',
          expectedStateVersion: 1,
          nextState: 'completed',
        }),
      ).toThrow(InvalidGenerationOperationTransitionError)
      expect(getGenerationOperationProjectionEpoch(db)).toBe(1)

      const reservation = reserveGenerationOperationAttempt(db, {
        databaseLineage: lineage,
        operationId: 'operation-a',
        expectedState: 'accepted',
        expectedStateVersion: 1,
        retryRequestId: 'operation-a',
        jobId: 'job-a',
        serverInstanceId: 'server-a',
        actorWriterSessionId: 'writer-a',
        actorWriterEpoch: 2,
        launchRevision: 7,
        createdAt: '2026-08-11T00:00:01.000Z',
      })
      expect(reservation).toMatchObject({
        status: 'applied',
        operation: {
          state: 'launching',
          stateVersion: 2,
          projectionEpoch: 2,
          currentAttempt: { attemptNo: 1, status: 'reserved', jobId: 'job-a' },
        },
      })

      const replay = reserveGenerationOperationAttempt(db, {
        databaseLineage: lineage,
        operationId: 'operation-a',
        expectedState: 'accepted',
        expectedStateVersion: 1,
        retryRequestId: 'operation-a',
        jobId: 'ignored-on-replay',
        serverInstanceId: 'server-a',
        actorWriterSessionId: 'writer-a',
        actorWriterEpoch: 2,
        launchRevision: 7,
      })
      expect(replay).toMatchObject({ status: 'replayed', operation: { projectionEpoch: 2 } })
      expect(getGenerationOperationProjectionEpoch(db)).toBe(2)

      const stale = transitionGenerationOperation(db, {
        databaseLineage: lineage,
        operationId: 'operation-a',
        expectedState: 'launching',
        expectedStateVersion: 1,
        nextState: 'owned_by_job',
      })
      expect(stale).toMatchObject({ status: 'stale', operation: { stateVersion: 2, projectionEpoch: 2 } })
      expect(getGenerationOperationProjectionEpoch(db)).toBe(2)

      const owned = transitionGenerationOperation(db, {
        databaseLineage: lineage,
        operationId: 'operation-a',
        expectedState: 'launching',
        expectedStateVersion: 2,
        nextState: 'owned_by_job',
        updatedAt: '2026-08-11T00:00:02.000Z',
      })
      expect(owned).toMatchObject({
        status: 'applied',
        operation: {
          state: 'owned_by_job',
          stateVersion: 3,
          projectionEpoch: 3,
          currentAttempt: { status: 'running' },
        },
      })

      expect(() =>
        transitionGenerationOperation(db, {
          databaseLineage: lineage,
          operationId: 'operation-a',
          expectedState: 'owned_by_job',
          expectedStateVersion: 3,
          nextState: 'completed',
        }),
      ).toThrow(InvalidGenerationOperationTransitionError)

      const finalizing = transitionGenerationOperation(db, {
        databaseLineage: lineage,
        operationId: 'operation-a',
        expectedState: 'owned_by_job',
        expectedStateVersion: 3,
        nextState: 'finalizing',
        desiredTerminalOutcome: 'completed',
      })
      expect(finalizing).toMatchObject({
        status: 'applied',
        operation: { state: 'finalizing', stateVersion: 4, projectionEpoch: 4 },
      })

      const completed = transitionGenerationOperation(db, {
        databaseLineage: lineage,
        operationId: 'operation-a',
        expectedState: 'finalizing',
        expectedStateVersion: 4,
        nextState: 'completed',
        resultMessageId: 'assistant-a',
      })
      expect(completed).toMatchObject({
        status: 'applied',
        operation: {
          state: 'completed',
          stateVersion: 5,
          projectionEpoch: 5,
          resultMessageId: 'assistant-a',
        },
      })
      expect(completed.status === 'applied' && completed.operation.currentAttempt).toBeUndefined()
      expect(getGenerationOperationProjectionEpoch(db)).toBe(5)

      expect(() =>
        transitionGenerationOperation(db, {
          databaseLineage: lineage,
          operationId: 'operation-a',
          expectedState: 'completed',
          expectedStateVersion: 5,
          nextState: 'launching',
        }),
      ).toThrow(InvalidGenerationOperationTransitionError)
    } finally {
      db.close()
    }
  })

  it('keeps retry reservation idempotency operation-scoped and rolls epoch changes back on conflicts', () => {
    const { db, lineage } = openTestDatabase()
    try {
      createGenerationOperation(db, acceptedInput(lineage, 'operation-a', 'chat-a'))
      expect(() => createGenerationOperation(db, acceptedInput(lineage, 'operation-b', 'chat-a'))).toThrow()
      expect(getGenerationOperationProjectionEpoch(db)).toBe(1)

      createGenerationOperation(db, acceptedInput(lineage, 'operation-b', 'chat-b'))
      reserveGenerationOperationAttempt(db, {
        databaseLineage: lineage,
        operationId: 'operation-a',
        expectedState: 'accepted',
        expectedStateVersion: 1,
        retryRequestId: 'retry-a',
        jobId: 'job-a',
        serverInstanceId: 'server-a',
        actorWriterSessionId: 'writer-a',
        actorWriterEpoch: 2,
        launchRevision: 7,
      })
      const epoch = getGenerationOperationProjectionEpoch(db)
      expect(() =>
        reserveGenerationOperationAttempt(db, {
          databaseLineage: lineage,
          operationId: 'operation-b',
          expectedState: 'accepted',
          expectedStateVersion: 1,
          retryRequestId: 'retry-a',
          jobId: 'job-b',
          serverInstanceId: 'server-a',
          actorWriterSessionId: 'writer-a',
          actorWriterEpoch: 2,
          launchRevision: 7,
        }),
      ).toThrow(GenerationOperationAttemptConflictError)
      expect(getGenerationOperationProjectionEpoch(db)).toBe(epoch)
    } finally {
      db.close()
    }
  })

  it('binds a cancel-before-submit tombstone without appending or launching', () => {
    const { db, lineage } = openTestDatabase()
    try {
      const tombstone = createGenerationOperation(db, {
        databaseLineage: lineage,
        operationId: 'cancel-first',
        protocolVersion: 1,
        requestOrigin: 'unbound',
        creatorWriterSessionId: 'writer-a',
        creatorWriterEpoch: 2,
        state: 'cancel_requested',
      })
      expect(tombstone).toMatchObject({ state: 'cancel_requested', stateVersion: 1, projectionEpoch: 1 })

      expect(() =>
        transitionGenerationOperation(db, {
          databaseLineage: lineage,
          operationId: 'cancel-first',
          expectedState: 'cancel_requested',
          expectedStateVersion: 1,
          nextState: 'cancelled',
        }),
      ).toThrow(/bindCancelledGenerationOperation/)
      expect(getGenerationOperationProjectionEpoch(db)).toBe(1)

      const bound = bindCancelledGenerationOperation(db, {
        databaseLineage: lineage,
        operationId: 'cancel-first',
        expectedStateVersion: 1,
        requestOrigin: 'accepted_send',
        bindingServerInstanceId: 'server-a',
        characterId: 'character-a',
        chatId: 'chat-a',
        mode: 'send',
        acceptedMessageId: 'message-cancel-first',
        clientDraftGeneration: { sequence: 8 },
        requestFingerprint: 'c'.repeat(64),
        intent: { mode: 'send' },
      })
      expect(bound).toMatchObject({
        status: 'applied',
        operation: {
          requestOrigin: 'accepted_send',
          state: 'cancelled',
          stateVersion: 2,
          projectionEpoch: 2,
          clientDraftGeneration: { sequence: 8 },
        },
      })
      expect(db.prepare('SELECT COUNT(*) AS count FROM generation_operation_attempts').get()).toEqual({ count: 0 })
      expect(getGenerationOperationProjectionEpoch(db)).toBe(2)

      const stale = bindCancelledGenerationOperation(db, {
        databaseLineage: lineage,
        operationId: 'cancel-first',
        expectedStateVersion: 1,
        requestOrigin: 'accepted_send',
        bindingServerInstanceId: 'server-a',
        characterId: 'character-a',
        chatId: 'chat-a',
        mode: 'send',
        acceptedMessageId: 'message-cancel-first',
        requestFingerprint: 'c'.repeat(64),
        intent: { mode: 'send' },
      })
      expect(stale).toMatchObject({ status: 'stale', operation: { state: 'cancelled', projectionEpoch: 2 } })
      expect(getGenerationOperationProjectionEpoch(db)).toBe(2)
    } finally {
      db.close()
    }
  })

  it('emits a metadata-only startup sweep metric', () => {
    const { db } = openTestDatabase()
    process.env.RISU_PROTOCOL_METRICS = '1'
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    try {
      expect(reconcileGenerationOperationsAtStartup(db, 'server-new')).toMatchObject({
        examinedOperationCount: 0,
        changedOperationCount: 0,
        projectionEpoch: 0,
      })
      expect(info).toHaveBeenCalledTimes(1)
      expect(info.mock.calls[0]?.[0]).toContain('"metric":"generation_operation_startup_sweep"')
      expect(info.mock.calls[0]?.[0]).not.toContain('server-new')
    } finally {
      db.close()
    }
  })
})
