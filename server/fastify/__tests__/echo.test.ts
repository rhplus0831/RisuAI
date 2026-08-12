import { describe, expect, it } from 'vitest'
import { resolveEchoRequest, runEcho, runEchoStream } from '../src/generation/echo.js'

describe('resolveEchoRequest', () => {
  it('falls back to "Echo Message" when message is missing', () => {
    const r = resolveEchoRequest({
      message: undefined,
      delayMs: undefined,
      signal: new AbortController().signal,
    })
    expect(r.message).toBe('Echo Message')
    expect(r.delayMs).toBe(0)
  })

  it('clamps a negative delay to 0 and accepts a positive delay', () => {
    const r1 = resolveEchoRequest({
      message: 'hi',
      delayMs: -10,
      signal: new AbortController().signal,
    })
    expect(r1.delayMs).toBe(0)

    const r2 = resolveEchoRequest({
      message: 'hi',
      delayMs: 25,
      signal: new AbortController().signal,
    })
    expect(r2.delayMs).toBe(25)
  })

  it('rejects non-number delays', () => {
    const r = resolveEchoRequest({
      message: 'hi',
      delayMs: '25' as unknown as number,
      signal: new AbortController().signal,
    })
    expect(r.delayMs).toBe(0)
  })

  it('applies body additional parameters to the local echo request', () => {
    const r = resolveEchoRequest({
      message: 'original',
      delayMs: 25,
      additionalParams: [
        ['message', 'overridden'],
        ['delayMs', '0'],
      ],
      signal: new AbortController().signal,
    })

    expect(r.message).toBe('overridden')
    expect(r.delayMs).toBe(0)
  })
})

describe('runEcho (non-streaming)', () => {
  it('returns aborted=true when signal aborts during the delay', async () => {
    const c = new AbortController()
    setTimeout(() => c.abort(), 15)
    const res = await runEcho({
      message: 'x',
      delayMs: 200,
      signal: c.signal,
    })
    expect(res.aborted).toBe(true)
    expect(res.type).toBe('fail')
  })

  it('returns aborted=true immediately when the signal is already aborted', async () => {
    const c = new AbortController()
    c.abort()
    const res = await runEcho({
      message: 'x',
      delayMs: 200,
      signal: c.signal,
    })
    expect(res.aborted).toBe(true)
  })
})

describe('runEchoStream', () => {
  it('yields token then done', async () => {
    const frames: unknown[] = []
    for await (const f of runEchoStream({
      message: 'hello',
      delayMs: 0,
      signal: new AbortController().signal,
    })) {
      frames.push(f)
    }
    expect(frames).toEqual([
      { kind: 'token', content: 'hello' },
      { kind: 'done', finishReason: 'stop' },
    ])
  })

  it('yields nothing when aborted before yielding', async () => {
    const c = new AbortController()
    setTimeout(() => c.abort(), 5)
    const frames: unknown[] = []
    for await (const f of runEchoStream({
      message: 'hello',
      delayMs: 200,
      signal: c.signal,
    })) {
      frames.push(f)
    }
    expect(frames).toEqual([])
  })
})
