import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import {
  NON_DURABLE_REQUEST_DEADLINE_MS,
  attachAbort,
} from '../src/requestAbort.js'
import { PROXY_STREAM_DEFAULT_TIMEOUT_MS } from '../src/streamJobs.js'

/**
 * Non-durable request abort plumbing (audit M8). The signal handed to every
 * provider adapter fires on client disconnect AND at a generous wall-clock
 * deadline mirroring the durable path's 600s `deadlineAt`, so buffered and
 * streaming provider work is bounded at the source instead of per adapter.
 */

function fakeReq(): { raw: EventEmitter & { on: EventEmitter['on']; off: EventEmitter['off'] } } {
  return { raw: new EventEmitter() }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('attachAbort (M8 non-durable deadline)', () => {
  it('M8: the default deadline mirrors the durable 600s reference (generous, not aggressive)', () => {
    expect(NON_DURABLE_REQUEST_DEADLINE_MS).toBe(600_000)
    expect(NON_DURABLE_REQUEST_DEADLINE_MS).toBe(PROXY_STREAM_DEFAULT_TIMEOUT_MS)
  })

  it('M8: a slow-but-valid request is NOT aborted while inside the generous bound', async () => {
    const req = fakeReq()
    const { signal, cleanup } = attachAbort(req)
    await sleep(50)
    expect(signal.aborted).toBe(false)
    cleanup()
  })

  it('M8: the signal aborts once the deadline elapses, with no client disconnect', async () => {
    const req = fakeReq()
    const { signal, cleanup } = attachAbort(req, { deadlineMs: 20 })
    expect(signal.aborted).toBe(false)
    await sleep(60)
    expect(signal.aborted).toBe(true)
    cleanup()
  })

  it('aborts on client disconnect (req.raw close), the pre-existing path', () => {
    const req = fakeReq()
    const { signal, cleanup } = attachAbort(req)
    expect(signal.aborted).toBe(false)
    req.raw.emit('close')
    expect(signal.aborted).toBe(true)
    cleanup()
  })

  it('abort() cancels manually (overflow guard path)', () => {
    const req = fakeReq()
    const { signal, abort, cleanup } = attachAbort(req)
    abort()
    expect(signal.aborted).toBe(true)
    cleanup()
  })

  it('cleanup removes the close listener and defuses the deadline timer', async () => {
    const req = fakeReq()
    const { signal, cleanup } = attachAbort(req, { deadlineMs: 20 })
    cleanup()
    expect(req.raw.listenerCount('close')).toBe(0)
    req.raw.emit('close')
    expect(signal.aborted).toBe(false)
    await sleep(60)
    expect(signal.aborted).toBe(false)
  })
})
