import { describe, expect, it, vi } from 'vitest'
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
  it('has stable identity and exposes only the standalone pointer lifecycle', () => {
    expect(lorebookPageOwner).toBe(lorebookPageOwner)
    expect(lorebookPageOwner.resource).toBe('loreBookPage')
    expect(lorebookPageOwner.snapshot()).toEqual({
      resource: 'loreBookPage',
      status: 'unloaded',
      revision: null,
      state: { present: false },
      error: null,
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
    })
    unsubscribe()
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
})
