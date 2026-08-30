import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createLorebookPageOwner, lorebookPageOwner } from './lorebookPageOwner.svelte'
import type { ServerStandaloneSettingPayload } from '@risuai/protocol/standalone-settings'

function payload(revision: number, value: unknown): ServerStandaloneSettingPayload {
  return { revision, setting: 'loreBookPage', state: { present: true, value } }
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

describe('lorebook page owner', () => {
  beforeEach(() => {
    lorebookPageOwner.reset()
  })

  it('has stable identity and exposes only the standalone pointer lifecycle', () => {
    expect(lorebookPageOwner).toBe(lorebookPageOwner)
    expect(lorebookPageOwner.resource).toBe('loreBookPage')
    expect(lorebookPageOwner.drafts).toBe('not-applicable')
    expect(lorebookPageOwner.snapshot()).toEqual({
      resource: 'loreBookPage',
      status: 'unloaded',
      revision: null,
      state: { present: false },
      error: null,
      mutation: { status: 'idle' },
    })
    expect(lorebookPageOwner.snapshot()).not.toHaveProperty('loreBook')
    expect(lorebookPageOwner.snapshot()).not.toHaveProperty('settings')
  })

  it('publishes loading and ready snapshots for an authoritative refresh', async () => {
    const owner = createLorebookPageOwner({ read: vi.fn().mockResolvedValue(payload(7, 3)) })
    const snapshots = vi.fn()
    const unsubscribe = owner.subscribe(snapshots)

    await expect(owner.refresh()).resolves.toEqual({ status: 'ok', revision: 7 })
    expect(snapshots.mock.calls.map(([entry]) => entry.status)).toEqual(['unloaded', 'loading', 'ready'])
    expect(owner.snapshot()).toEqual({
      resource: 'loreBookPage',
      status: 'ready',
      revision: 7,
      state: { present: true, value: 3 },
      error: null,
      mutation: { status: 'idle' },
    })
    unsubscribe()
  })

  it('adopts an existing authoritative response without issuing another read', () => {
    const read = vi.fn()
    const owner = createLorebookPageOwner({ read })
    const snapshots = vi.fn()
    owner.subscribe(snapshots)

    expect(owner.hydrate(payload(7, 3))).toBe(true)
    expect(owner.hydrate(payload(6, 1))).toBe(false)
    expect(read).not.toHaveBeenCalled()
    expect(owner.snapshot()).toMatchObject({ status: 'ready', revision: 7, state: { present: true, value: 3 } })
    expect(snapshots).toHaveBeenCalledTimes(2)
  })

  it('supersedes an in-flight owner read when route hydration wins', async () => {
    const read = deferred<ReturnType<typeof payload>>()
    const owner = createLorebookPageOwner({ read: vi.fn().mockReturnValue(read.promise) })

    const refresh = owner.refresh()
    expect(owner.hydrate(payload(9, 2))).toBe(true)
    read.resolve(payload(8, 1))

    await expect(refresh).resolves.toEqual({ status: 'superseded' })
    expect(owner.snapshot()).toMatchObject({ revision: 9, state: { present: true, value: 2 } })
  })

  it('projects structural selection without dispatching a page command and resets cleanly', () => {
    const select = vi.fn()
    const owner = createLorebookPageOwner({ select })
    owner.hydrate(payload(4, 0))

    expect(owner.projectStructuralSelection(2)).toBe(true)
    expect(owner.projectStructuralSelection(-1)).toBe(false)
    expect(select).not.toHaveBeenCalled()
    expect(owner.snapshot()).toMatchObject({ revision: 4, state: { present: true, value: 2 } })

    owner.reset()
    expect(owner.snapshot()).toMatchObject({ status: 'unloaded', revision: null, state: { present: false } })
  })

  it('owns stale state, minimum-revision retry, and focused errors', async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce(payload(4, 1))
      .mockResolvedValueOnce(payload(5, 2))
      .mockResolvedValueOnce({ status: 'error', error: 'focused read failed' })
    const owner = createLorebookPageOwner({ read })

    await expect(owner.refresh()).resolves.toEqual({ status: 'ok', revision: 4 })
    owner.invalidate(5)
    expect(owner.snapshot().status).toBe('stale')
    await expect(owner.retry()).resolves.toEqual({ status: 'ok', revision: 5 })
    expect(owner.snapshot()).toMatchObject({ status: 'ready', revision: 5, state: { present: true, value: 2 } })
    await expect(owner.refresh()).resolves.toEqual({ status: 'error', error: 'focused read failed' })
    expect(owner.snapshot()).toMatchObject({ status: 'error', error: 'focused read failed' })
  })

  it('turns a rejected focused read into owner-scoped error state', async () => {
    const owner = createLorebookPageOwner({ read: vi.fn().mockRejectedValue(new Error('network failed')) })

    await expect(owner.refresh()).resolves.toEqual({ status: 'error', error: 'network failed' })
    expect(owner.snapshot()).toMatchObject({ status: 'error', error: 'network failed' })
  })

  it('rejects an older minimum revision and reports unavailable reads', async () => {
    const owner = createLorebookPageOwner({
      read: vi.fn().mockResolvedValueOnce(payload(8, 1)).mockResolvedValueOnce({ status: 'unavailable' }),
    })

    await expect(owner.refresh({ minimumRevision: 9 })).resolves.toEqual({
      status: 'error',
      error: 'Lorebook page response revision 8 is older than 9',
    })
    await expect(owner.refresh()).resolves.toEqual({ status: 'unavailable' })
    expect(owner.snapshot()).toMatchObject({ status: 'error', error: 'Server resource APIs are unavailable' })
  })

  it('prevents a superseded request from replacing the current attempt', async () => {
    const first = deferred<ReturnType<typeof payload>>()
    const second = deferred<ReturnType<typeof payload>>()
    const read = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const owner = createLorebookPageOwner({ read })

    const older = owner.refresh()
    const newer = owner.refresh()
    second.resolve(payload(12, 4))
    await expect(newer).resolves.toEqual({ status: 'ok', revision: 12 })
    first.resolve(payload(11, 1))
    await expect(older).resolves.toEqual({ status: 'superseded' })
    expect(owner.snapshot()).toMatchObject({ revision: 12, state: { present: true, value: 4 } })
  })

  it('optimistically selects and accepts the exact page attempt', async () => {
    const selection = deferred<{ status: 'accepted'; revision: number }>()
    const select = vi.fn().mockReturnValue(selection.promise)
    const owner = createLorebookPageOwner({
      read: vi.fn().mockResolvedValue(payload(4, 0)),
      select,
    })
    await owner.refresh()

    const pending = owner.select({ lorebookId: 'book-b', index: 1 })
    expect(owner.snapshot()).toMatchObject({
      state: { present: true, value: 1 },
      mutation: { status: 'pending', attempt: 1, index: 1, lorebookId: 'book-b' },
    })
    selection.resolve({ status: 'accepted', revision: 5 })

    await expect(pending).resolves.toEqual({ status: 'accepted', revision: 5 })
    expect(select).toHaveBeenCalledWith('book-b', undefined)
    expect(owner.snapshot()).toMatchObject({
      status: 'ready',
      revision: 5,
      state: { present: true, value: 1 },
      mutation: { status: 'idle' },
    })
  })

  it('rolls back only the current failed selection attempt', async () => {
    const firstSettlement = deferred<'accepted' | 'failed'>()
    const select = vi
      .fn()
      .mockResolvedValueOnce({ status: 'queued', mutationId: 'mutation-a', settlement: firstSettlement.promise })
      .mockResolvedValueOnce({ status: 'accepted', revision: 8 })
    const owner = createLorebookPageOwner({ read: vi.fn().mockResolvedValue(payload(6, 0)), select })
    await owner.refresh()

    const first = await owner.select({ lorebookId: 'book-b', index: 1 })
    expect(first.status).toBe('queued')
    await expect(owner.select({ lorebookId: 'book-c', index: 2 })).resolves.toEqual({
      status: 'accepted',
      revision: 8,
    })
    firstSettlement.resolve('failed')
    if (first.status === 'queued') await expect(first.settlement).resolves.toBe('failed')

    expect(owner.snapshot()).toMatchObject({
      revision: 8,
      state: { present: true, value: 2 },
      mutation: { status: 'idle' },
    })
  })

  it('retains a queued projection, marks accepted replay stale, and reloads authoritatively', async () => {
    const settlement = deferred<'accepted' | 'failed'>()
    const read = vi.fn().mockResolvedValueOnce(payload(2, 0)).mockResolvedValueOnce(payload(4, 1))
    const owner = createLorebookPageOwner({
      read,
      select: vi.fn().mockResolvedValue({ status: 'queued', mutationId: 'mutation-a', settlement: settlement.promise }),
    })
    await owner.refresh()

    const queued = await owner.select({ lorebookId: 'book-b', index: 1 })
    expect(queued).toMatchObject({ status: 'queued', mutationId: 'mutation-a' })
    expect(owner.snapshot()).toMatchObject({
      state: { present: true, value: 1 },
      mutation: { status: 'queued', mutationId: 'mutation-a' },
    })
    settlement.resolve('accepted')
    if (queued.status === 'queued') await expect(queued.settlement).resolves.toBe('accepted')
    expect(owner.snapshot()).toMatchObject({ status: 'stale', mutation: { status: 'idle' } })

    await expect(owner.retry()).resolves.toEqual({ status: 'ok', revision: 4 })
    expect(owner.snapshot()).toMatchObject({
      status: 'ready',
      revision: 4,
      state: { present: true, value: 1 },
    })
  })

  it('restores the prior snapshot when the current queued selection fails', async () => {
    const settlement = deferred<'accepted' | 'failed'>()
    const owner = createLorebookPageOwner({
      read: vi.fn().mockResolvedValue(payload(3, 0)),
      select: vi.fn().mockResolvedValue({ status: 'queued', mutationId: 'mutation-a', settlement: settlement.promise }),
    })
    await owner.refresh()

    const queued = await owner.select({ lorebookId: 'book-b', index: 1 })
    settlement.resolve('failed')
    if (queued.status === 'queued') await expect(queued.settlement).resolves.toBe('failed')

    expect(owner.snapshot()).toMatchObject({
      status: 'ready',
      revision: 3,
      state: { present: true, value: 0 },
      mutation: { status: 'failed', error: 'Queued lorebook selection failed' },
    })
  })
})
