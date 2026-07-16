import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const commandApi = vi.hoisted(() => ({
  acknowledge: vi.fn(),
  replay: vi.fn(),
}))

vi.mock('./commands', () => ({
  acknowledgeServerMutationReceipts: commandApi.acknowledge,
  replayDurableMutationRequests: commandApi.replay,
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
    const dispatch = vi.fn(async () => acceptedResult())

    const pending = dispatchDurableMutation(handle, intent, dispatch)
    await Promise.resolve()
    expect(dispatch).not.toHaveBeenCalled()

    encryptionGate.resolve()
    await expect(pending).resolves.toMatchObject({ status: 'ok' })
    expect(dispatch).toHaveBeenCalledWith({ mutationId: handle.mutationId, databaseLineage: 'database-a' })
  })

  it('locks duplicate same-id dispatches and revalidates the row after the first caller completes', async () => {
    const handle = stagePendingMutation('settings:runtime', intent)
    await handle.ready
    const firstResponse = deferred<ReturnType<typeof acceptedResult>>()
    const dispatch = vi.fn(async () => firstResponse.promise)

    const first = dispatchDurableMutation(handle, intent, dispatch)
    const duplicate = dispatchDurableMutation(handle, intent, dispatch)
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledOnce())

    firstResponse.resolve(acceptedResult())
    await expect(first).resolves.toMatchObject({ status: 'ok' })
    await expect(duplicate).resolves.toEqual({ status: 'unavailable' })
    expect(dispatch).toHaveBeenCalledOnce()
    expect(await listPendingMutations()).toEqual([])
  })

  it('retains transient failures but discards a terminal stale-writer rejection', async () => {
    const transient = stagePendingMutation('settings:runtime', intent)
    await dispatchDurableMutation(transient, intent, async () => ({ status: 'error', error: 'offline' }))
    expect((await listPendingMutations()).map((entry) => entry.handle.mutationId)).toContain(transient.mutationId)

    const stale = stagePendingMutation('settings:runtime-2', intent)
    await dispatchDurableMutation(stale, intent, async () => ({
      status: 'error',
      error: 'active_writer_stale',
      reason: 'stale-writer',
    }))
    expect((await listPendingMutations()).map((entry) => entry.handle.mutationId)).not.toContain(stale.mutationId)
  })

  it('keeps an accepted receipt acknowledgement durable when its network cleanup fails', async () => {
    commandApi.acknowledge.mockResolvedValue(false)
    const handle = stagePendingMutation('settings:runtime', intent)

    await dispatchDurableMutation(handle, intent, async () => acceptedResult())

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

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}
