import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const commandApi = vi.hoisted(() => ({
  acknowledge: vi.fn(),
  replay: vi.fn(),
  withoutReceipt: vi.fn(<T>(execute: () => Promise<T>) => execute()),
}))

vi.mock('./commands', () => ({
  acknowledgeServerMutationReceipts: commandApi.acknowledge,
  replayDurableMutationRequests: commandApi.replay,
  runServerCommandWithoutMutationReceipt: commandApi.withoutReceipt,
}))

import { dispatchDurableMutation } from './durableMutationDispatch'
import {
  clearPendingMutationOutbox,
  listPendingMutationReceiptAcknowledgements,
  listPendingMutations,
  preparePendingMutationOutbox,
  resetPendingMutationOutboxForTests,
  stagePendingMutation,
  type DurableMutationIntent,
} from './pendingMutationOutbox'

const intent: DurableMutationIntent = {
  version: 1,
  requests: [{ method: 'PATCH', path: '/settings/runtime', body: { patch: { maxContext: 8_000 } } }],
}

beforeEach(async () => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  resetPendingMutationOutboxForTests()
  commandApi.acknowledge.mockReset()
  commandApi.acknowledge.mockResolvedValue(true)
  commandApi.withoutReceipt.mockClear()
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

describe('durable mutation dispatch', () => {
  it('does not start the request until the exact encrypted generation is durable', async () => {
    const encryptionGate = deferred<void>()
    const originalEncrypt = globalThis.crypto.subtle.encrypt.bind(globalThis.crypto.subtle)
    vi.spyOn(globalThis.crypto.subtle, 'encrypt').mockImplementationOnce(async (algorithm, key, data) => {
      await encryptionGate.promise
      return originalEncrypt(algorithm, key, data)
    })
    const handle = stagePendingMutation('settings:runtime', intent)
    const request = vi.fn(async () => acceptedResult())
    const dispatch = wrappedDispatch(request)

    const pending = dispatchDurableMutation(handle, intent, dispatch)
    await Promise.resolve()
    expect(dispatch).toHaveBeenCalledOnce()
    expect(request).not.toHaveBeenCalled()

    encryptionGate.resolve()
    await expect(pending).resolves.toMatchObject({ status: 'ok' })
    expect(request).toHaveBeenCalledOnce()
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        mutationId: handle.mutationId,
        databaseLineage: 'database-a',
        executionWrapper: expect.any(Function),
      }),
    )
  })

  it('locks duplicate same-id dispatches and revalidates the row after the first caller completes', async () => {
    const handle = stagePendingMutation('settings:runtime', intent)
    await handle.ready
    const firstResponse = deferred<ReturnType<typeof acceptedResult>>()
    const request = vi.fn(async () => firstResponse.promise)
    const dispatch = wrappedDispatch(request)

    const first = dispatchDurableMutation(handle, intent, dispatch)
    const duplicate = dispatchDurableMutation(handle, intent, dispatch)
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce())

    firstResponse.resolve(acceptedResult())
    await expect(first).resolves.toMatchObject({ status: 'ok' })
    await expect(duplicate).resolves.toEqual({ status: 'unavailable' })
    expect(request).toHaveBeenCalledOnce()
    expect(await listPendingMutations()).toEqual([])
  })

  it('retains transient failures but discards a terminal stale-writer rejection', async () => {
    const transient = stagePendingMutation('settings:runtime', intent)
    await dispatchDurableMutation(
      transient,
      intent,
      wrappedDispatch(async () => ({ status: 'error', error: 'offline' })),
    )
    expect((await listPendingMutations()).map((entry) => entry.handle.mutationId)).toContain(transient.mutationId)

    const stale = stagePendingMutation('settings:runtime-2', intent)
    await dispatchDurableMutation(
      stale,
      intent,
      wrappedDispatch(async () => ({
        status: 'error',
        error: 'active_writer_stale',
        reason: 'stale-writer',
      })),
    )
    expect((await listPendingMutations()).map((entry) => entry.handle.mutationId)).not.toContain(stale.mutationId)
  })

  it('still sends an ordinary autosave when durable browser storage is unavailable', async () => {
    const request = vi.fn(async () => acceptedResult())
    const unavailableHandle = {
      key: 'settings:runtime',
      mutationId: 'storage-unavailable',
      sequence: 1,
      ownerWriterSessionId: 'writer-a',
      writerEpoch: 1,
      databaseLineage: 'database-a',
      phase: 'staged' as const,
      ready: Promise.resolve('unavailable' as const),
    }

    await expect(dispatchDurableMutation(unavailableHandle, intent, wrappedDispatch(request))).resolves.toMatchObject({
      status: 'ok',
    })
    expect(request).toHaveBeenCalledOnce()
    expect(commandApi.withoutReceipt).toHaveBeenCalledOnce()
  })

  it('keeps an accepted receipt acknowledgement durable when its network cleanup fails', async () => {
    commandApi.acknowledge.mockResolvedValue(false)
    const handle = stagePendingMutation('settings:runtime', intent)

    await dispatchDurableMutation(
      handle,
      intent,
      wrappedDispatch(async () => acceptedResult()),
    )

    expect(await listPendingMutations()).toEqual([])
    expect(await listPendingMutationReceiptAcknowledgements()).toEqual([
      expect.objectContaining({ mutationId: handle.mutationId, databaseLineage: 'database-a' }),
    ])
  })
})

function acceptedResult() {
  return {
    status: 'ok' as const,
    revision: 2,
    event: { type: 'settings.updated', revision: 2, resource: 'settings' },
  }
}

function wrappedDispatch<T>(request: () => Promise<T>) {
  return vi.fn((options: { executionWrapper?: (execute: () => Promise<T>) => Promise<T> }) => {
    return options.executionWrapper ? options.executionWrapper(request) : request()
  })
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}
