import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  acknowledgePendingMutation,
  beginPendingMutationDispatch,
  clearPendingMutationOutbox,
  completePendingMutation,
  deletePendingMutationReceiptAcknowledgement,
  discardPendingMutation,
  listPendingMutationPredecessors,
  listPendingMutationReceiptAcknowledgements,
  listPendingMutations,
  preparePendingMutationOutbox,
  readSinglePendingMutationOwner,
  replaceStagedPendingMutationIntent,
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

  it('atomically replaces an unstarted staged payload under a fresh mutation id', async () => {
    const first = stagePendingMutation('settings:runtime', settingsIntent('first'))
    await first.ready
    const remoteReady = deferred<'persisted'>()
    const remoteHandle = { ...(await listPendingMutations())[0]!.handle, ready: remoteReady.promise }
    const remoteBegin = beginPendingMutationDispatch(remoteHandle)
    const latest = stagePendingMutation('settings:runtime', settingsIntent('latest'), first)

    expect(latest.mutationId).not.toBe(first.mutationId)
    expect(first.phase).toBe('superseded')
    await latest.ready
    remoteReady.resolve('persisted')
    await expect(remoteBegin).resolves.toBe('superseded')

    const entries = await listPendingMutations()
    expect(entries).toHaveLength(1)
    expect(entries[0]?.intent).toEqual(settingsIntent('latest'))
    expect(entries[0]?.handle.sequence).toBe(latest.sequence)
  })

  it('keeps both fresh-id generations when another tab marks the predecessor first', async () => {
    const predecessor = stagePendingMutation('settings:runtime', settingsIntent('predecessor'))
    await predecessor.ready
    const remoteHandle = (await listPendingMutations())[0]!.handle
    const encryptionGate = deferred<void>()
    const originalEncrypt = globalThis.crypto.subtle.encrypt.bind(globalThis.crypto.subtle)
    const encryptSpy = vi
      .spyOn(globalThis.crypto.subtle, 'encrypt')
      .mockImplementationOnce(async (algorithm, key, data) => {
        await encryptionGate.promise
        return originalEncrypt(algorithm, key, data)
      })

    const successor = stagePendingMutation('settings:runtime', settingsIntent('successor'), predecessor)
    await vi.waitFor(() => expect(encryptSpy).toHaveBeenCalledOnce())
    await expect(beginPendingMutationDispatch(remoteHandle)).resolves.toBe('persisted')
    encryptionGate.resolve()
    await expect(successor.ready).resolves.toBe('persisted')

    const entries = await listPendingMutations()
    expect(entries.map((entry) => entry.handle.mutationId)).toEqual([predecessor.mutationId, successor.mutationId])
    expect(entries.map((entry) => entry.intent)).toEqual([settingsIntent('predecessor'), settingsIntent('successor')])
    expect(await readRawMutation(predecessor.mutationId)).toMatchObject({ dispatchStarted: true })
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

  it('lists only older generations for the same semantic resource and ownership scope', async () => {
    const retained = stagePendingMutation('settings:runtime', settingsIntent('retained-a'))
    await expect(beginPendingMutationDispatch(retained)).resolves.toBe('persisted')
    const successor = stagePendingMutation('settings:runtime', settingsIntent('successor-b'), retained)
    const unrelated = stagePendingMutation('settings:other', settingsIntent('unrelated'))
    await Promise.all([successor.ready, unrelated.ready])

    await expect(listPendingMutationPredecessors(successor)).resolves.toEqual({
      status: 'ok',
      semanticKeys: ['settings:runtime'],
      entries: [
        {
          handle: expect.objectContaining({
            key: 'settings:runtime',
            mutationId: retained.mutationId,
          }),
          intent: settingsIntent('retained-a'),
        },
      ],
    })
    await expect(listPendingMutationPredecessors(unrelated)).resolves.toEqual({
      status: 'ok',
      entries: [],
      semanticKeys: ['settings:other'],
    })
  })

  it('lists a transitive dependency closure without crossing the referring predecessor order', async () => {
    const olderTargetB = stagePendingMutation('character-owner:char-b', settingsIntent('target-b-older'))
    const selectB = stagePendingMutation('character-selection', {
      ...settingsIntent('select-b'),
      dependencyKeys: ['character-owner:char-b', 'character-selection'],
    })
    const newerTargetB = stagePendingMutation('character-owner:char-b', settingsIntent('target-b-newer'))
    const targetC = stagePendingMutation('character-owner:char-c', settingsIntent('target-c'))
    const selectC = stagePendingMutation('character-selection', {
      ...settingsIntent('select-c'),
      dependencyKeys: ['character-owner:char-c'],
    })
    await Promise.all([olderTargetB.ready, selectB.ready, newerTargetB.ready, targetC.ready, selectC.ready])

    const predecessors = await listPendingMutationPredecessors(selectC)

    expect(predecessors).toMatchObject({
      status: 'ok',
      semanticKeys: ['character-owner:char-b', 'character-owner:char-c', 'character-selection'],
    })
    if (predecessors.status !== 'ok') throw new Error('Expected a predecessor closure')
    expect(predecessors.entries.map((entry) => entry.handle.mutationId)).toEqual([
      olderTargetB.mutationId,
      selectB.mutationId,
      targetC.mutationId,
    ])
    expect(predecessors.entries.map((entry) => entry.handle.mutationId)).not.toContain(newerTargetB.mutationId)
  })

  it('normalizes bounded dependency keys and rejects near-malformed dependency metadata', async () => {
    const normalized = stagePendingMutation('settings:runtime', {
      ...settingsIntent('normalized'),
      dependencyKeys: [' settings:bridge ', 'settings:bridge', 'settings:runtime'],
    })
    await normalized.ready
    expect((await listPendingMutations())[0]?.intent.dependencyKeys).toEqual(['settings:bridge', 'settings:runtime'])

    expect(() =>
      stagePendingMutation('settings:runtime', {
        ...settingsIntent('not-an-array'),
        dependencyKeys: 'settings:bridge',
      } as unknown as DurableMutationIntent),
    ).toThrow('Pending mutation dependency keys must be an array')
    expect(() =>
      stagePendingMutation('settings:runtime', {
        ...settingsIntent('too-many'),
        dependencyKeys: Array.from({ length: 33 }, (_, index) => `dependency:${index}`),
      }),
    ).toThrow('Pending mutation dependency key count is invalid')
    expect(() =>
      stagePendingMutation('settings:runtime', {
        ...settingsIntent('too-long'),
        dependencyKeys: ['x'.repeat(2_049)],
      }),
    ).toThrow('Pending mutation key is invalid')
  })

  it('chains a slow predecessor persistence before atomically replacing it', async () => {
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
    expect(newer.mutationId).not.toBe(older.mutationId)
    let newerSettled = false
    void newer.ready.then(() => {
      newerSettled = true
    })
    await Promise.resolve()
    expect(newerSettled).toBe(false)

    encryptionGate.resolve()
    await expect(Promise.all([older.ready, newer.ready])).resolves.toEqual(['persisted', 'persisted'])
    const entries = await listPendingMutations()
    expect(entries).toHaveLength(1)
    expect(entries[0]?.handle.sequence).toBe(newer.sequence)
    expect(entries[0]?.intent).toEqual(settingsIntent('newer'))
  })

  it('marks legacy rows before dispatch and treats a missing marker as unstarted for replacement', async () => {
    const legacyDispatch = stagePendingMutation('settings:runtime', settingsIntent('legacy-dispatch'))
    await legacyDispatch.ready
    await removeRawDispatchStarted(legacyDispatch.mutationId)
    await expect(beginPendingMutationDispatch(legacyDispatch)).resolves.toBe('persisted')
    expect(await readRawMutation(legacyDispatch.mutationId)).toMatchObject({ dispatchStarted: true })

    const legacyReplace = stagePendingMutation('settings:other', settingsIntent('legacy-replace'))
    await legacyReplace.ready
    await removeRawDispatchStarted(legacyReplace.mutationId)
    const replacement = stagePendingMutation('settings:other', settingsIntent('replacement'), legacyReplace)
    await replacement.ready
    expect((await listPendingMutations()).map((entry) => entry.handle.mutationId)).toEqual([
      legacyDispatch.mutationId,
      replacement.mutationId,
    ])
  })

  it('exactly replaces an unstarted placeholder without changing its id or durable order', async () => {
    const placeholder = stagePendingMutation('settings:runtime', settingsIntent('fallback'))
    await placeholder.ready
    const staleReady = deferred<'persisted'>()
    const staleReplayHandle = { ...(await listPendingMutations())[0]!.handle, ready: staleReady.promise }
    const staleBegin = beginPendingMutationDispatch(staleReplayHandle)
    const before = await readRawMutation(placeholder.mutationId)

    const replacement = await replaceStagedPendingMutationIntent(placeholder, settingsIntent('exact'))
    expect(replacement.status).toBe('replaced')
    if (replacement.status !== 'replaced') throw new Error('Expected an exact replacement')
    const exact = replacement.handle

    expect(exact.mutationId).toBe(placeholder.mutationId)
    expect(exact.sequence).not.toBe(placeholder.sequence)
    expect(await readRawMutation(exact.mutationId)).toMatchObject({ order: before?.order, dispatchStarted: false })
    expect((await listPendingMutations()).map((entry) => entry.intent)).toEqual([settingsIntent('exact')])
    staleReady.resolve('persisted')
    await expect(staleBegin).resolves.toBe('superseded')
    await expect(beginPendingMutationDispatch(exact)).resolves.toBe('persisted')
  })

  it('gives an exact prepared intent a fresh successor id when dispatch marking wins the race', async () => {
    const placeholder = stagePendingMutation('settings:runtime', settingsIntent('fallback'))
    await placeholder.ready
    const remoteHandle = (await listPendingMutations())[0]!.handle
    const encryptionGate = deferred<void>()
    const originalEncrypt = globalThis.crypto.subtle.encrypt.bind(globalThis.crypto.subtle)
    const encryptSpy = vi
      .spyOn(globalThis.crypto.subtle, 'encrypt')
      .mockImplementationOnce(async (algorithm, key, data) => {
        await encryptionGate.promise
        return originalEncrypt(algorithm, key, data)
      })
    const replacement = replaceStagedPendingMutationIntent(placeholder, settingsIntent('exact'))
    await vi.waitFor(() => expect(encryptSpy).toHaveBeenCalledOnce())
    await beginPendingMutationDispatch(remoteHandle)
    encryptionGate.resolve()

    const exact = await replacement

    expect(exact.status).toBe('successor')
    if (exact.status !== 'successor') throw new Error('Expected a fresh successor')
    expect(exact.handle.mutationId).not.toBe(placeholder.mutationId)
    expect((await listPendingMutations()).map((entry) => entry.intent)).toEqual([
      settingsIntent('fallback'),
      settingsIntent('exact'),
    ])
  })

  it('keeps an exact same-scope correction when another tab removes its placeholder first', async () => {
    const placeholder = stagePendingMutation('settings:runtime', settingsIntent('fallback'))
    await placeholder.ready
    const remoteHandle = (await listPendingMutations())[0]!.handle
    await expect(discardPendingMutation(remoteHandle)).resolves.toBe('deleted')

    const exact = await replaceStagedPendingMutationIntent(placeholder, settingsIntent('exact'))

    expect(exact.status).toBe('successor')
    if (exact.status !== 'successor') throw new Error('Expected a fresh successor')
    expect(exact.handle.mutationId).not.toBe(placeholder.mutationId)
    expect((await listPendingMutations()).map((entry) => entry.intent)).toEqual([settingsIntent('exact')])
  })

  it('does not bind a superseded prepared placeholder to a replacement database scope', async () => {
    const placeholder = stagePendingMutation('settings:runtime', settingsIntent('old-database'))
    await placeholder.ready
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-a',
      writerEpoch: 1,
      databaseLineage: 'database-b',
      requestedWriterWasActive: true,
    })

    await expect(replaceStagedPendingMutationIntent(placeholder, settingsIntent('must-not-restage'))).resolves.toEqual({
      status: 'superseded',
    })
    expect(await listPendingMutations()).toEqual([])
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
    const preparation = await preparePendingMutationOutbox({
      writerSessionId: 'writer-a',
      writerEpoch: 2,
      databaseLineage: 'database-a',
      requestedWriterWasActive: false,
    })

    expect(preparation).toEqual({ discarded: 1 })
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

  it.each([
    ['PATCH', '/model-presets/model-a'],
    ['DELETE', '/model-presets/model-a'],
    ['PATCH', '/prompt-presets/prompt-a'],
    ['DELETE', '/prompt-presets/prompt-a'],
    ['POST', '/prompt-items'],
    ['POST', '/prompt-items/reorder'],
    ['DELETE', '/prompt-items/item-a'],
    ['POST', '/prompt-items/enable'],
    ['DELETE', '/personas/persona-a'],
    ['PATCH', '/translator-presets/translator-a'],
    ['DELETE', '/translator-presets/translator-a'],
    ['DELETE', '/characters/character-a'],
    ['POST', '/characters/select'],
    ['DELETE', '/chat-folders/folder-a'],
    ['DELETE', '/modules/module-a'],
    ['PUT', '/chats/chat-a/generation-settings'],
    ['DELETE', '/chats/chat-a'],
    ['PATCH', '/settings/advanced/global-scripts'],
    ['PUT', '/characters/character-a/scripts'],
    ['PATCH', '/characters/character-a/triggers'],
    ['PUT', '/modules/module-a/scripts'],
    ['PATCH', '/modules/module-a/triggers'],
    ['DELETE', '/lorebooks/lorebook-a'],
    ['PUT', '/lorebooks/lorebook-a/entries'],
    ['PUT', '/lorebooks/lorebook-a/entries/entry-a'],
    ['DELETE', '/lorebooks/lorebook-a/entries/entry-a'],
    ['POST', '/lorebooks/lorebook-a/entries/reorder'],
    ['PUT', '/characters/character-a/lorebooks'],
    ['PUT', '/chats/chat-a/lorebooks/entries/entry-a'],
    ['DELETE', '/modules/module-a/lorebooks/entries/entry-a'],
    ['POST', '/chats/chat-a/lorebooks/entries/reorder'],
  ] as const)('allowlists the durable bridge route %s %s', async (method, path) => {
    const handle = stagePendingMutation(`allowlist:${method}:${path}`, {
      version: 1,
      requests: [{ method, path, body: { patch: { value: true } } }],
    })

    await expect(handle.ready).resolves.toBe('persisted')
    await expect(discardPendingMutation(handle)).resolves.toBe('deleted')
  })

  it('keeps similar nested resource routes outside the durable allowlist', () => {
    expect(() =>
      stagePendingMutation('unsafe-nested-route', {
        version: 1,
        requests: [
          {
            method: 'POST',
            path: '/characters/character-a/scripts/reorder',
            body: { scriptIds: ['script-a'] },
          },
        ],
      }),
    ).toThrow('not allowlisted')
  })

  it.each([
    ['POST', '/prompt-items/item-a'],
    ['POST', '/prompt-items/enable/extra'],
    ['POST', '/prompt-items/reorder/extra'],
    ['DELETE', '/personas/persona-a/extra'],
    ['DELETE', '/lorebooks/lorebook-a/entries'],
  ] as const)('rejects the near-miss durable route %s %s', (method, path) => {
    expect(() =>
      stagePendingMutation(`near-miss:${method}:${path}`, {
        version: 1,
        requests: [{ method, path, body: { value: true } }],
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

async function removeRawDispatchStarted(mutationId: string): Promise<void> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('risu-pending-mutations-v1', 3)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  try {
    const transaction = database.transaction('mutations', 'readwrite')
    const store = transaction.objectStore('mutations')
    const record = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const request = store.get(mutationId)
      request.onsuccess = () => resolve(request.result as Record<string, unknown>)
      request.onerror = () => reject(request.error)
    })
    delete record.dispatchStarted
    store.put(record)
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally {
    database.close()
  }
}
