import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  acknowledgePendingMutation,
  beginPendingMutationDispatch,
  clearPendingMutationOutbox,
  completePendingMutation,
  deletePendingMutationReceiptAcknowledgement,
  listPendingMutationReceiptAcknowledgements,
  listPendingMutations,
  preparePendingMutationOutbox,
  readSinglePendingMutationOwner,
  resetPendingMutationOutboxForTests,
  stagePendingMutation,
  type DurableMutationIntent,
} from './pendingMutationOutbox'

function settingsIntent(value: string): DurableMutationIntent {
  return {
    version: 1,
    requests: [
      {
        method: 'PATCH',
        path: '/settings/runtime',
        body: { patch: { openAIKey: value } },
      },
    ],
  }
}

beforeEach(async () => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  resetPendingMutationOutboxForTests()
  await preparePendingMutationOutbox({
    writerSessionId: 'writer-a',
    writerEpoch: 1,
    databaseLineage: 'database-a',
    requestedWriterWasActive: true,
  })
})

afterEach(async () => {
  await clearPendingMutationOutbox()
  resetPendingMutationOutboxForTests()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('pending mutation outbox', () => {
  it('persists encrypted intents across runtime cache resets without plaintext secrets at rest', async () => {
    const secret = 'sentinel-provider-secret-never-store-plaintext'
    const handle = stagePendingMutation('settings:runtime', settingsIntent(secret))

    await expect(handle.ready).resolves.toBe('persisted')
    const rawRecord = await readRawMutation(handle.mutationId)
    expect(rawRecord).toMatchObject({
      semanticKey: 'settings:runtime',
      mutationId: handle.mutationId,
      sequence: handle.sequence,
      ownerWriterSessionId: 'writer-a',
      writerEpoch: 1,
      databaseLineage: 'database-a',
    })
    expect(JSON.stringify(rawRecord)).not.toContain(secret)
    expect(rawRecord?.ciphertext).toBeInstanceOf(ArrayBuffer)

    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-a',
      writerEpoch: 1,
      databaseLineage: 'database-a',
      requestedWriterWasActive: true,
    })
    const entries = await listPendingMutations()
    expect(entries).toHaveLength(1)
    expect(entries[0]?.intent).toEqual(settingsIntent(secret))
    expect(entries[0]?.handle.mutationId).toBe(handle.mutationId)
  })

  it('coalesces a staged payload under one mutation id and keeps only its latest encrypted value', async () => {
    const first = stagePendingMutation('settings:runtime', settingsIntent('first'))
    const latest = stagePendingMutation('settings:runtime', settingsIntent('latest'), first)

    expect(latest.mutationId).toBe(first.mutationId)
    expect(first.phase).toBe('superseded')
    await Promise.all([first.ready, latest.ready])

    const entries = await listPendingMutations()
    expect(entries).toHaveLength(1)
    expect(entries[0]?.intent).toEqual(settingsIntent('latest'))
    expect(entries[0]?.handle.sequence).toBe(latest.sequence)
  })

  it('keeps a dispatching generation and its queued successor as separate durable rows', async () => {
    const acceptedA = stagePendingMutation('settings:runtime', settingsIntent('accepted-a'))
    await expect(beginPendingMutationDispatch(acceptedA)).resolves.toBe('persisted')

    const queuedB = stagePendingMutation('settings:runtime', settingsIntent('queued-b'), acceptedA)
    expect(queuedB.mutationId).not.toBe(acceptedA.mutationId)
    expect(acceptedA.phase).toBe('dispatching')
    await expect(queuedB.ready).resolves.toBe('persisted')

    let entries = await listPendingMutations()
    expect(entries.map((entry) => entry.intent)).toEqual([settingsIntent('accepted-a'), settingsIntent('queued-b')])

    await expect(completePendingMutation(acceptedA, 1)).resolves.toBe('deleted')
    entries = await listPendingMutations()
    expect(entries).toHaveLength(1)
    expect(entries[0]?.handle.mutationId).toBe(queuedB.mutationId)
    expect(entries[0]?.intent).toEqual(settingsIntent('queued-b'))
  })

  it('rejects a slow older coalesced write after the exact newer payload is durable', async () => {
    const encryptionGate = deferred<void>()
    const originalEncrypt = globalThis.crypto.subtle.encrypt.bind(globalThis.crypto.subtle)
    const encryptSpy = vi.spyOn(globalThis.crypto.subtle, 'encrypt')
    encryptSpy.mockImplementationOnce(async (algorithm, key, data) => {
      await encryptionGate.promise
      return originalEncrypt(algorithm, key, data)
    })

    const older = stagePendingMutation('settings:runtime', settingsIntent('older'))
    await vi.waitFor(() => expect(encryptSpy).toHaveBeenCalledOnce())
    const newer = stagePendingMutation('settings:runtime', settingsIntent('newer'), older)
    expect(newer.mutationId).toBe(older.mutationId)
    await expect(newer.ready).resolves.toBe('persisted')

    encryptionGate.resolve()
    await expect(older.ready).resolves.toBe('superseded')
    const entries = await listPendingMutations()
    expect(entries).toHaveLength(1)
    expect(entries[0]?.handle.sequence).toBe(newer.sequence)
    expect(entries[0]?.intent).toEqual(settingsIntent('newer'))
  })

  it('atomically replaces an accepted row with durable receipt cleanup work', async () => {
    const handle = stagePendingMutation('settings:runtime', settingsIntent('accepted'))
    await expect(handle.ready).resolves.toBe('persisted')

    await expect(completePendingMutation(handle, 1)).resolves.toBe('deleted')
    expect(await listPendingMutations()).toEqual([])
    const acknowledgements = await listPendingMutationReceiptAcknowledgements()
    expect(acknowledgements).toEqual([
      expect.objectContaining({
        mutationId: handle.mutationId,
        requestCount: 1,
        databaseLineage: 'database-a',
      }),
    ])

    await expect(deletePendingMutationReceiptAcknowledgement(acknowledgements[0]!)).resolves.toBe(true)
    expect(await listPendingMutationReceiptAcknowledgements()).toEqual([])
  })

  it('quarantines this writer drafts when bootstrap says another writer owned the server', async () => {
    const rejected = stagePendingMutation('settings:runtime', settingsIntent('stale-tab-edit'))
    await expect(rejected.ready).resolves.toBe('persisted')

    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-a',
      writerEpoch: 2,
      databaseLineage: 'database-a',
      requestedWriterWasActive: false,
    })

    expect(await listPendingMutations()).toEqual([])
    expect(await readRawMutation(rejected.mutationId)).toBeUndefined()
  })

  it('recovers only an unambiguous durable owner before writer bootstrap', async () => {
    const pending = stagePendingMutation('settings:runtime', settingsIntent('recover-owner'))
    await pending.ready
    resetPendingMutationOutboxForTests()

    await expect(readSinglePendingMutationOwner()).resolves.toEqual({
      writerSessionId: 'writer-a',
      writerEpoch: 1,
      databaseLineage: 'database-a',
    })

    await preparePendingMutationOutbox({
      writerSessionId: 'writer-b',
      writerEpoch: 1,
      databaseLineage: 'database-a',
      requestedWriterWasActive: true,
    })
    const other = stagePendingMutation('settings:other', settingsIntent('other-owner'))
    await other.ready
    resetPendingMutationOutboxForTests()
    await expect(readSinglePendingMutationOwner()).resolves.toBeNull()
  })

  it('deletes rows and receipt ACKs belonging to a different database lineage', async () => {
    const old = stagePendingMutation('settings:runtime', settingsIntent('old-database'))
    await old.ready
    await completePendingMutation(old, 1)
    const pending = stagePendingMutation('settings:runtime', settingsIntent('still-pending'))
    await pending.ready

    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-a',
      writerEpoch: 1,
      databaseLineage: 'database-b',
      requestedWriterWasActive: true,
    })

    expect(await listPendingMutations()).toEqual([])
    expect(await listPendingMutationReceiptAcknowledgements()).toEqual([])
    expect(await readRawMutation(pending.mutationId)).toBeUndefined()
  })

  it('deletes an exact no-op row without creating receipt cleanup work', async () => {
    const handle = stagePendingMutation('settings:runtime', settingsIntent('no-op'))
    await expect(handle.ready).resolves.toBe('persisted')
    await expect(acknowledgePendingMutation(handle)).resolves.toBe('deleted')
    expect(await listPendingMutations()).toEqual([])
    expect(await listPendingMutationReceiptAcknowledgements()).toEqual([])
  })

  it('rejects persisted base revisions and command paths outside the autosave allowlist', () => {
    expect(() =>
      stagePendingMutation('settings:runtime', {
        version: 1,
        requests: [
          {
            method: 'PATCH',
            path: '/settings/runtime',
            body: { baseRevision: 4, patch: { maxContext: 8_000 } },
          },
        ],
      }),
    ).toThrow('must not persist a base revision')

    expect(() =>
      stagePendingMutation('unsafe', {
        version: 1,
        requests: [{ method: 'POST', path: '/messages/translate', body: { text: 'side effect' } }],
      }),
    ).toThrow('not allowlisted')
  })
})

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function readRawMutation(mutationId: string): Promise<Record<string, unknown> | undefined> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('risu-pending-mutations-v1', 3)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  try {
    const transaction = database.transaction('mutations', 'readonly')
    return await new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
      const request = transaction.objectStore('mutations').get(mutationId)
      request.onsuccess = () => resolve(request.result as Record<string, unknown> | undefined)
      request.onerror = () => reject(request.error)
    })
  } finally {
    database.close()
  }
}
