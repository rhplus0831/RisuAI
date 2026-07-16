import { beforeEach, describe, expect, it, vi } from 'vitest'

const outboxApi = vi.hoisted(() => ({ list: vi.fn() }))
const durableApi = vi.hoisted(() => ({ replay: vi.fn() }))

vi.mock('./pendingMutationOutbox', () => ({
  listPendingMutations: outboxApi.list,
}))
vi.mock('./durableMutationDispatch', () => ({
  dispatchDurableMutationReplay: durableApi.replay,
}))

import { replayPendingMutations } from './pendingMutationReplay'

beforeEach(() => {
  vi.clearAllMocks()
  durableApi.replay.mockResolvedValue({ disposition: 'succeeded', result: { status: 'ok' } })
})

describe('pending mutation replay', () => {
  it('replays entries serially and retains only transient failures', async () => {
    const entries = [entry('settings:runtime', 'mutation-a'), entry('chat:chat-a', 'mutation-b')]
    outboxApi.list.mockResolvedValue(entries)
    const order: string[] = []
    durableApi.replay.mockImplementation(async (handle) => {
      order.push(handle.mutationId)
      return handle.mutationId === 'mutation-a'
        ? { disposition: 'succeeded', result: { status: 'ok' } }
        : { disposition: 'retained', result: { status: 'error', error: 'offline' } }
    })

    const summary = await replayPendingMutations()

    expect(order).toEqual(['mutation-a', 'mutation-b'])
    expect(summary).toEqual({ attempted: 2, discarded: 0, retained: 1, succeeded: 1 })
  })

  it('counts terminal ownership failures as discarded instead of retrying forever', async () => {
    outboxApi.list.mockResolvedValue([entry('settings:runtime', 'stale-a')])
    durableApi.replay.mockResolvedValue({
      disposition: 'discarded',
      result: { status: 'error', error: 'active_writer_stale', reason: 'stale-writer' },
    })

    await expect(replayPendingMutations()).resolves.toEqual({
      attempted: 1,
      discarded: 1,
      retained: 0,
      succeeded: 0,
    })
  })
})

function entry(key: string, mutationId: string) {
  return {
    handle: {
      key,
      mutationId,
      sequence: 1,
      ownerWriterSessionId: 'writer-a',
      writerEpoch: 1,
      databaseLineage: 'database-a',
      phase: 'staged',
      ready: Promise.resolve('persisted'),
    },
    intent: {
      version: 1,
      requests: [{ method: 'PATCH', path: '/settings/runtime', body: { patch: { maxContext: 8_000 } } }],
    },
  }
}
