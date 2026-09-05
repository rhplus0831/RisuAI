import { describe, expect, it, vi } from 'vitest'
import { createTranscriptReservations } from './transcriptReservations'

describe('transcript interaction reservations', () => {
  it('admits only eight distinct row owners, sharing a slot for overlapping row operations', () => {
    const reservations = createTranscriptReservations(vi.fn())
    const releases = Array.from({ length: 8 }, (_, index) => reservations.reserve(`id-${index}`, {})!)
    expect(reservations.reserve('id-8', {})).toBeNull()
    const owner = {}
    const shared = reservations.reserve('id-0', owner)!
    expect(reservations.reserve('id-0', owner)).toBe(shared)
    releases[0]()
    expect(reservations.reserve('id-8', {})).toBeNull()
    shared()
    expect(reservations.reserve('id-8', {})).not.toBeNull()
    expect(reservations.ids()).toHaveLength(8)
  })

  it('fences late releases after a chat reset and coalesces availability notifications', async () => {
    const reservations = createTranscriptReservations(vi.fn())
    const notify = vi.fn()
    const unsubscribe = reservations.subscribeAvailable(notify)
    const oldRelease = reservations.reserve('same-id', {})!
    reservations.reset()
    const newRelease = reservations.reserve('same-id', {})!
    oldRelease()
    oldRelease()
    expect(reservations.ids()).toEqual(['same-id'])
    newRelease()
    await Promise.resolve()
    expect(notify).toHaveBeenCalledTimes(1)
    unsubscribe()
    reservations.reset()
    await Promise.resolve()
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('lets deferred work claim the released slot without notifying on every acquisition', async () => {
    const reservations = createTranscriptReservations(vi.fn())
    const releases = Array.from({ length: 8 }, (_, index) => reservations.reserve(`${index}`, {})!)
    const owner = {}
    let resumed: (() => void) | null = null
    const retry = vi.fn(() => {
      resumed = reservations.reserve('deferred', owner)
    })
    reservations.subscribeAvailable(retry)
    releases[3]()
    await Promise.resolve()
    expect(resumed).not.toBeNull()
    expect(reservations.ids()).toHaveLength(8)
    await Promise.resolve()
    expect(retry).toHaveBeenCalledTimes(1)
  })
})
