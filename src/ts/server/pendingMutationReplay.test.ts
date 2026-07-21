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

  it('counts terminal mutation-id failures as discarded instead of retrying forever', async () => {
    outboxApi.list.mockResolvedValue([entry('settings:runtime', 'conflict-a')])
    durableApi.replay.mockResolvedValue({
      disposition: 'discarded',
      result: { status: 'error', error: 'mutation_id_conflict', reason: 'mutation-id-conflict' },
    })

    await expect(replayPendingMutations()).resolves.toEqual({
      attempted: 1,
      discarded: 1,
      retained: 0,
      succeeded: 0,
    })
  })

  it('blocks only later rows for a semantic key when its oldest replay remains transient', async () => {
    outboxApi.list.mockResolvedValue([
      entry('settings:runtime', 'mutation-a'),
      entry('settings:runtime', 'mutation-b'),
      entry('chat:chat-a', 'mutation-c'),
    ])
    durableApi.replay.mockImplementation(async (handle) =>
      handle.mutationId === 'mutation-a'
        ? { disposition: 'retained', result: { status: 'error', error: 'offline' } }
        : { disposition: 'succeeded', result: { status: 'ok' } },
    )

    await expect(replayPendingMutations()).resolves.toEqual({
      attempted: 2,
      discarded: 0,
      retained: 2,
      succeeded: 1,
    })
    expect(durableApi.replay.mock.calls.map(([handle]) => handle.mutationId)).toEqual(['mutation-a', 'mutation-c'])
  })

  it('keeps a prompt row blocked across reload until its owner repair succeeds', async () => {
    const entries = [
      entry('prompt-template-owner:preset-a', 'id-repair', '/prompt-presets/preset-a'),
      entry('prompt-template-owner:preset-a', 'row-successor', '/prompt-items/row-a'),
    ]
    outboxApi.list.mockResolvedValue(entries)
    durableApi.replay.mockImplementation(async (handle) =>
      handle.mutationId === 'id-repair'
        ? { disposition: 'retained', result: { status: 'error', error: 'offline' } }
        : { disposition: 'succeeded', result: { status: 'ok' } },
    )

    await expect(replayPendingMutations()).resolves.toEqual({
      attempted: 1,
      discarded: 0,
      retained: 2,
      succeeded: 0,
    })
    expect(durableApi.replay.mock.calls.map(([handle]) => handle.mutationId)).toEqual(['id-repair'])

    durableApi.replay.mockClear()
    durableApi.replay.mockResolvedValue({ disposition: 'succeeded', result: { status: 'ok' } })

    await expect(replayPendingMutations()).resolves.toEqual({
      attempted: 2,
      discarded: 0,
      retained: 0,
      succeeded: 2,
    })
    expect(durableApi.replay.mock.calls.map(([handle]) => handle.mutationId)).toEqual(['id-repair', 'row-successor'])
  })

  it('propagates a retained dependency into the successor selection lane', async () => {
    outboxApi.list.mockResolvedValue([
      entry('character-owner:char-b', 'patch-b'),
      entry('character-selection', 'select-b', '/characters/select', ['character-owner:char-b']),
      entry('character-selection', 'select-c', '/characters/select'),
      entry('settings:runtime', 'unrelated'),
    ])
    durableApi.replay.mockImplementation(async (handle) =>
      handle.mutationId === 'patch-b'
        ? { disposition: 'retained', result: { status: 'error', error: 'offline' } }
        : { disposition: 'succeeded', result: { status: 'ok' } },
    )

    await expect(replayPendingMutations()).resolves.toEqual({
      attempted: 2,
      discarded: 0,
      retained: 3,
      succeeded: 1,
    })
    expect(durableApi.replay.mock.calls.map(([handle]) => handle.mutationId)).toEqual(['patch-b', 'unrelated'])
  })

  it('allows a dependent successor after its terminal predecessor is discarded', async () => {
    outboxApi.list.mockResolvedValue([
      entry('character-owner:char-b', 'orphaned-patch'),
      entry('character-selection', 'select-b', '/characters/select', ['character-owner:char-b']),
    ])
    durableApi.replay.mockImplementation(async (handle) =>
      handle.mutationId === 'orphaned-patch'
        ? {
            disposition: 'discarded',
            result: { status: 'error', error: 'character not found', reason: 'not-found' },
          }
        : { disposition: 'succeeded', result: { status: 'ok' } },
    )

    await expect(replayPendingMutations()).resolves.toEqual({
      attempted: 2,
      discarded: 1,
      retained: 0,
      succeeded: 1,
    })
    expect(durableApi.replay.mock.calls.map(([handle]) => handle.mutationId)).toEqual(['orphaned-patch', 'select-b'])
  })
})

function entry(key: string, mutationId: string, path = '/settings/runtime', dependencyKeys?: string[]) {
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
      requests: [{ method: 'PATCH', path, body: { patch: { maxContext: 8_000 } } }],
      ...(dependencyKeys ? { dependencyKeys } : {}),
    },
  }
}
