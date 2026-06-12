import { afterEach, describe, expect, it, vi } from 'vitest'
import { createStreamRenderCoalescer, defaultRenderFlushScheduler } from '../postGeneration/streamCoalescer'

// Stability/performance plan, Phase 1 H3: the coalescer is the unit that
// bounds streaming parse work — `notify()` per token, at most one `apply` per
// scheduled frame, a guaranteed full-fidelity `settle()` at stream end.

function manualFrames() {
  const frames: (() => void)[] = []
  return {
    schedule: (flush: () => void) => {
      frames.push(flush)
    },
    runNext: () => {
      const flush = frames.shift()
      if (!flush) throw new Error('no frame scheduled')
      flush()
    },
    get pending() {
      return frames.length
    },
  }
}

describe('createStreamRenderCoalescer', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('coalesces a burst of notifies into one frame, applying the newest payload', async () => {
    const frames = manualFrames()
    let payload = ''
    const applied: string[] = []
    const coalescer = createStreamRenderCoalescer(() => {
      applied.push(payload)
    }, frames.schedule)

    payload = 'a'
    coalescer.notify()
    payload = 'ab'
    coalescer.notify()
    payload = 'abc'
    coalescer.notify()
    // Three notifies, one scheduled frame.
    expect(frames.pending).toBe(1)
    frames.runNext()
    await coalescer.settle()
    expect(applied).toEqual(['abc'])
  })

  it('settle applies a payload notified after the last frame flush', async () => {
    const frames = manualFrames()
    let payload = ''
    const applied: string[] = []
    const coalescer = createStreamRenderCoalescer(() => {
      applied.push(payload)
    }, frames.schedule)

    payload = 'partial'
    coalescer.notify()
    frames.runNext()
    // The apply is chained on a microtask; let it sample 'partial' first.
    await vi.waitFor(() => expect(applied).toEqual(['partial']))
    payload = 'final'
    coalescer.notify()
    // The re-armed frame never runs; settle still applies the newest payload.
    await coalescer.settle()
    expect(applied).toEqual(['partial', 'final'])
    // settle with nothing new is a no-op.
    await coalescer.settle()
    expect(applied).toEqual(['partial', 'final'])
  })

  it('settle waits for an in-flight async apply', async () => {
    const frames = manualFrames()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const applied: string[] = []
    const coalescer = createStreamRenderCoalescer(async () => {
      await gate
      applied.push('done')
    }, frames.schedule)

    coalescer.notify()
    frames.runNext() // apply starts, blocked on the gate
    const settled = vi.fn()
    const settlePromise = coalescer.settle().then(settled)
    await Promise.resolve()
    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()
    release()
    await settlePromise
    expect(applied).toEqual(['done'])
  })

  it('serializes applies: a frame during an in-flight apply waits its turn', async () => {
    const frames = manualFrames()
    let active = 0
    let maxActive = 0
    let payload = ''
    const applied: string[] = []
    const gates: (() => void)[] = []
    const coalescer = createStreamRenderCoalescer(async () => {
      active += 1
      maxActive = Math.max(maxActive, active)
      const seen = payload
      await new Promise<void>((resolve) => {
        gates.push(resolve)
      })
      applied.push(seen)
      active -= 1
    }, frames.schedule)

    payload = 'first'
    coalescer.notify()
    frames.runNext()
    // Wait for the first apply to start (and sample 'first') before mutating.
    await vi.waitFor(() => expect(gates).toHaveLength(1))
    payload = 'second'
    coalescer.notify()
    frames.runNext() // queued behind the first apply, not concurrent
    await Promise.resolve()
    expect(gates).toHaveLength(1) // second apply has not started
    gates.shift()!()
    await vi.waitFor(() => expect(gates).toHaveLength(1))
    gates.shift()!()
    await coalescer.settle()
    expect(maxActive).toBe(1)
    expect(applied).toEqual(['first', 'second'])
  })

  it('captures the first apply rejection: failed flips, settle rethrows, notifies stop scheduling', async () => {
    const frames = manualFrames()
    const coalescer = createStreamRenderCoalescer(() => {
      throw new Error('boom')
    }, frames.schedule)

    coalescer.notify()
    frames.runNext()
    await expect(coalescer.settle()).rejects.toThrow('boom')
    expect(coalescer.failed).toBe(true)
    // After a failure no further frames are armed and settle keeps rethrowing.
    coalescer.notify()
    expect(frames.pending).toBe(0)
    await expect(coalescer.settle()).rejects.toThrow('boom')
  })

  it('defaultRenderFlushScheduler prefers requestAnimationFrame', () => {
    const raf = vi.fn((callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    vi.stubGlobal('requestAnimationFrame', raf)
    const flush = vi.fn()
    defaultRenderFlushScheduler(flush)
    expect(raf).toHaveBeenCalledTimes(1)
    expect(flush).toHaveBeenCalledTimes(1)
  })

  it('defaultRenderFlushScheduler falls back to a short timer without requestAnimationFrame', async () => {
    vi.stubGlobal('requestAnimationFrame', undefined)
    const flush = vi.fn()
    defaultRenderFlushScheduler(flush)
    expect(flush).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(flush).toHaveBeenCalledTimes(1))
  })
})
