import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'

vi.mock('../process/modules', () => ({
  getModuleAssets: vi.fn(() => []),
  getModuleLorebooks: vi.fn(() => []),
  getModules: vi.fn(() => []),
  moduleUpdate: vi.fn(),
}))

import { getActiveWriterSessionId } from './activeWriterSession'
import { registerDurableMutationSettlementListener } from './durableMutationDispatch'
import {
  clearPendingMutationOutbox,
  preparePendingMutationOutbox,
  resetPendingMutationOutboxForTests,
  stagePendingMutation,
} from './pendingMutationOutbox'
import {
  adoptReplacementDatabaseOwnership,
  beginLocalReplacementDatabaseOperation,
  hasPendingReplacementDatabaseRefresh,
  isReplacementDatabaseOwnershipRefreshPending,
  markReplacementDatabaseOwnershipRefreshed,
  waitForLocalReplacementDatabaseOperations,
  wasReplacementDatabaseOwnershipRefreshed,
} from './replacementDatabaseOwnership'

beforeEach(async () => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  resetPendingMutationOutboxForTests()
  await preparePendingMutationOutbox({
    writerSessionId: getActiveWriterSessionId(),
    writerEpoch: 1,
    databaseLineage: 'database-before',
    requestedWriterWasActive: true,
  })
})

afterEach(async () => {
  await clearPendingMutationOutbox()
  resetPendingMutationOutboxForTests()
  vi.unstubAllGlobals()
})

describe('replacement database ownership', () => {
  it('settles local listeners even when another tab already removed the shared outbox row', async () => {
    const handle = stagePendingMutation('settings:exact', {
      version: 1,
      requests: [{ method: 'PATCH', path: '/settings/display', body: { patch: { notification: false } } }],
    })
    await expect(handle.ready).resolves.toBe('persisted')
    const listener = vi.fn()
    const cleanup = registerDurableMutationSettlementListener(handle.mutationId, listener)
    await clearPendingMutationOutbox()

    await expect(
      adoptReplacementDatabaseOwnership({ databaseLineage: 'database-restored', writerEpoch: 2 }),
    ).resolves.toEqual({ discarded: 1, ownershipChanged: true })

    expect(listener).toHaveBeenCalledWith('discarded', {})
    expect(hasPendingReplacementDatabaseRefresh()).toBe(true)
    expect(isReplacementDatabaseOwnershipRefreshPending({ databaseLineage: 'database-restored', writerEpoch: 2 })).toBe(
      true,
    )
    expect(wasReplacementDatabaseOwnershipRefreshed({ databaseLineage: 'database-restored', writerEpoch: 2 })).toBe(
      false,
    )
    await expect(
      adoptReplacementDatabaseOwnership({ databaseLineage: 'database-restored', writerEpoch: 2 }),
    ).resolves.toEqual({ discarded: 0, ownershipChanged: false })
    expect(listener).toHaveBeenCalledOnce()
    markReplacementDatabaseOwnershipRefreshed({ databaseLineage: 'database-restored', writerEpoch: 2 })
    expect(hasPendingReplacementDatabaseRefresh()).toBe(false)
    expect(wasReplacementDatabaseOwnershipRefreshed({ databaseLineage: 'database-restored', writerEpoch: 2 })).toBe(
      true,
    )
    cleanup()
  })

  it('holds replacement events until the initiating local operation finishes', async () => {
    const finish = beginLocalReplacementDatabaseOperation()
    let settled = false
    const waiting = waitForLocalReplacementDatabaseOperations().then(() => {
      settled = true
    })

    await Promise.resolve()
    expect(settled).toBe(false)
    finish()
    await waiting
    expect(settled).toBe(true)
  })
})
