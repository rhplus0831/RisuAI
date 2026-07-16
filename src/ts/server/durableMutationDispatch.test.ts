import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const commandApi = vi.hoisted(() => ({
  acknowledge: vi.fn(),
  inlineReplay: vi.fn(),
  replay: vi.fn(),
  withoutReceipt: vi.fn(<T>(execute: () => Promise<T>) => execute()),
}))

vi.mock('./commands', () => ({
  acknowledgeServerMutationReceipts: commandApi.acknowledge,
  replayDurableMutationRequestsInline: commandApi.inlineReplay,
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
  commandApi.inlineReplay.mockReset()
  commandApi.inlineReplay.mockResolvedValue({ status: 'ok' })
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

  it('replays an older request that never reached the server before sending its successor', async () => {
    const retained = stagePendingMutation('settings:runtime', intent)
    await dispatchDurableMutation(
      retained,
      intent,
      wrappedDispatch(async () => ({ status: 'error', error: 'network request failed' })),
    )
    const successorIntent: DurableMutationIntent = {
      version: 1,
      requests: [{ method: 'PATCH', path: '/settings/runtime', body: { patch: { maxResponse: 1_000 } } }],
    }
    const successor = stagePendingMutation('settings:runtime', successorIntent, retained)
    const order: string[] = []
    commandApi.inlineReplay.mockImplementation(async () => {
      order.push('retained')
      return { status: 'ok' }
    })

    await expect(
      dispatchDurableMutation(
        successor,
        successorIntent,
        wrappedDispatch(async () => {
          order.push('successor')
          return acceptedResult()
        }),
      ),
    ).resolves.toMatchObject({ status: 'ok' })

    expect(order).toEqual(['retained', 'successor'])
    expect(commandApi.inlineReplay).toHaveBeenCalledWith(intent.requests, retained.mutationId, 'database-a')
    expect(await listPendingMutations()).toEqual([])
  })

  it('deduplicates an accepted response-loss predecessor before sending its successor', async () => {
    const retained = stagePendingMutation('settings:runtime', intent)
    await dispatchDurableMutation(
      retained,
      intent,
      wrappedDispatch(async () => ({ status: 'error', error: 'response stream ended' })),
    )
    const successor = stagePendingMutation('settings:runtime', intent, retained)
    const order: string[] = []
    commandApi.inlineReplay.mockImplementation(async (_requests, mutationId) => {
      order.push(`receipt:${mutationId}`)
      return { status: 'ok' }
    })

    await dispatchDurableMutation(
      successor,
      intent,
      wrappedDispatch(async () => {
        order.push(`successor:${successor.mutationId}`)
        return acceptedResult()
      }),
    )

    expect(order).toEqual([`receipt:${retained.mutationId}`, `successor:${successor.mutationId}`])
    expect(commandApi.acknowledge.mock.calls.map(([mutationId]) => mutationId)).toEqual([
      retained.mutationId,
      successor.mutationId,
    ])
    expect(await listPendingMutations()).toEqual([])
  })

  it('retains both generations and does not send the successor while its predecessor is transient', async () => {
    const retained = stagePendingMutation('settings:runtime', intent)
    await dispatchDurableMutation(
      retained,
      intent,
      wrappedDispatch(async () => ({ status: 'error', error: 'offline' })),
    )
    const successor = stagePendingMutation('settings:runtime', intent, retained)
    commandApi.inlineReplay.mockResolvedValue({ status: 'error', error: 'still offline' })
    const successorRequest = vi.fn(async () => acceptedResult())

    await expect(dispatchDurableMutation(successor, intent, wrappedDispatch(successorRequest))).resolves.toEqual({
      status: 'unavailable',
    })

    expect(successorRequest).not.toHaveBeenCalled()
    expect((await listPendingMutations()).map((entry) => entry.handle.mutationId)).toEqual([
      retained.mutationId,
      successor.mutationId,
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
