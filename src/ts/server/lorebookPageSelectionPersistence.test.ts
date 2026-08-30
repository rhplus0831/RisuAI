import { describe, expect, it, vi } from 'vitest'
import {
  createLorebookPageSelectionPersistence,
  lorebookPageSelectionIntent,
  type LorebookPageSelectionPersistenceDependencies,
} from './lorebookPageSelectionPersistence'
import type { PendingMutationHandle } from './pendingMutationOutbox'

function pendingHandle(): PendingMutationHandle {
  return {
    key: 'lorebook:global-selection',
    mutationId: 'mutation-a',
    sequence: 1,
    ownerWriterSessionId: 'writer-a',
    writerEpoch: 2,
    databaseLineage: 'lineage-a',
    ready: Promise.resolve('persisted'),
    phase: 'staged',
  }
}

function acceptedCommandResult(revision: number) {
  return {
    status: 'ok' as const,
    revision,
    event: { revision, resource: 'loreBook', action: 'select', id: 'book-a' },
    selectedLorebookId: 'book-a',
  }
}

describe('lorebook page selection persistence', () => {
  it('uses the reviewed durable operation and deterministic owner keys', () => {
    expect(lorebookPageSelectionIntent('book / a')).toEqual({
      version: 1,
      dependencyKeys: ['lorebook:global:book / a'],
      requests: [
        {
          method: 'POST',
          path: '/lorebooks/book%20%2F%20a/select',
          body: {},
        },
      ],
    })
  })

  it('returns accepted only after the exact durable dispatch succeeds', async () => {
    const cleanup = vi.fn()
    const stage = vi.fn().mockReturnValue(pendingHandle())
    const execute = vi.fn().mockResolvedValue(acceptedCommandResult(7))
    const dependencies: LorebookPageSelectionPersistenceDependencies = {
      stage,
      execute,
      dispatch: (_handle, _intent, dispatch) => dispatch({ failureRollbackDisposition: () => 'rollback' }),
      subscribeSettlement: vi.fn().mockReturnValue(cleanup),
    }
    const persist = createLorebookPageSelectionPersistence(dependencies)
    const controller = new AbortController()

    await expect(persist('book-a', controller.signal)).resolves.toEqual({ status: 'accepted', revision: 7 })
    expect(stage).toHaveBeenCalledWith('lorebook:global-selection', lorebookPageSelectionIntent('book-a'))
    expect(execute).toHaveBeenCalledWith(
      'book-a',
      controller.signal,
      expect.objectContaining({ failureRollbackDisposition: expect.any(Function) }),
    )
    expect(cleanup).toHaveBeenCalledOnce()
  })

  it('reports retained writer loss as queued and exposes replay settlement', async () => {
    let settle!: Parameters<LorebookPageSelectionPersistenceDependencies['subscribeSettlement']>[1]
    const dependencies: LorebookPageSelectionPersistenceDependencies = {
      stage: vi.fn().mockReturnValue(pendingHandle()),
      execute: vi.fn().mockResolvedValue({ status: 'unavailable' }),
      dispatch: (_handle, _intent, dispatch) => dispatch({ failureRollbackDisposition: () => 'retain' }),
      subscribeSettlement: (_mutationId, listener) => {
        settle = listener
        return vi.fn()
      },
    }
    const persist = createLorebookPageSelectionPersistence(dependencies)

    const receipt = await persist('book-a')
    expect(receipt).toMatchObject({ status: 'queued', mutationId: 'mutation-a' })
    expect(receipt.status).toBe('queued')
    if (receipt.status !== 'queued') return
    const listener = vi.fn()
    receipt.subscribeSettlement(listener)
    settle('accepted', {})
    await expect(receipt.settlement).resolves.toBe('accepted')
    expect(listener).toHaveBeenCalledWith('accepted')
  })

  it('returns failed for rollback-classified rejection and staging failure', async () => {
    const cleanup = vi.fn()
    const rejected: LorebookPageSelectionPersistenceDependencies = {
      stage: vi.fn().mockReturnValue(pendingHandle()),
      execute: vi.fn().mockResolvedValue({ status: 'error', error: 'missing book', reason: 'not-found' }),
      dispatch: (_handle, _intent, dispatch) => dispatch({ failureRollbackDisposition: () => 'rollback' }),
      subscribeSettlement: vi.fn().mockReturnValue(cleanup),
    }
    await expect(createLorebookPageSelectionPersistence(rejected)('book-a')).resolves.toEqual({
      status: 'failed',
      error: 'missing book',
    })
    expect(cleanup).toHaveBeenCalledOnce()

    const unavailable = createLorebookPageSelectionPersistence({
      ...rejected,
      stage: vi.fn(() => {
        throw new Error('outbox unavailable')
      }),
    })
    await expect(unavailable('book-a')).resolves.toEqual({ status: 'failed', error: 'outbox unavailable' })
    await expect(unavailable('   ')).resolves.toEqual({ status: 'failed', error: 'Lorebook id is required' })
  })
})
