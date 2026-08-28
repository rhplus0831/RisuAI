import { describe, expect, it } from 'vitest'
import { iterateSseEvents, parseSseEvent } from '../sseParse'

function streamOf(text: string): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(enc.encode(text))
      controller.close()
    },
  })
}

describe('parseSseEvent', () => {
  it('extracts the event name and data', () => {
    expect(parseSseEvent('event: prompt\ndata: {"a":1}')).toEqual({
      event: 'prompt',
      data: '{"a":1}',
    })
  })

  it('defaults the event name to "message" when absent', () => {
    expect(parseSseEvent('data: hello')).toEqual({ event: 'message', data: 'hello' })
  })

  it('joins multiple data lines with newlines', () => {
    expect(parseSseEvent('event: x\ndata: a\ndata: b').data).toBe('a\nb')
  })

  it('extracts optional event ids', () => {
    expect(parseSseEvent('id: 42\nevent: command\ndata: {}')).toEqual({
      event: 'command',
      data: '{}',
      id: '42',
    })
  })
})

describe('iterateSseEvents', () => {
  it('yields frames split on the blank-line separator', async () => {
    const body = streamOf('event: stage\ndata: {"s":1}\n\nevent: done\ndata: {}\n\n')
    const seen: Array<{ event: string; data: string }> = []
    for await (const frame of iterateSseEvents(body, null)) seen.push(frame)
    expect(seen).toEqual([
      { event: 'stage', data: '{"s":1}' },
      { event: 'done', data: '{}' },
    ])
  })

  it('reassembles a frame split across chunk boundaries', async () => {
    const enc = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(enc.encode('event: pro'))
        controller.enqueue(enc.encode('mpt\ndata: {"ok":'))
        controller.enqueue(enc.encode('true}\n\n'))
        controller.close()
      },
    })
    const seen: Array<{ event: string; data: string }> = []
    for await (const frame of iterateSseEvents(body, null)) seen.push(frame)
    expect(seen).toEqual([{ event: 'prompt', data: '{"ok":true}' }])
  })

  it('preserves a multibyte character split across byte chunks', async () => {
    const enc = new TextEncoder()
    const prefix = enc.encode('event: token\ndata: {"content":"')
    const bytes = enc.encode('event: token\ndata: {"content":"안"}\n\n')
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, prefix.length + 1))
        controller.enqueue(bytes.slice(prefix.length + 1))
        controller.close()
      },
    })
    const seen = []
    for await (const frame of iterateSseEvents(body, null)) seen.push(frame)
    expect(seen).toEqual([{ event: 'token', data: '{"content":"안"}' }])
  })

  it('recognizes a CRLF separator split across chunks', async () => {
    const enc = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(enc.encode('event: stage\r\ndata: {}\r'))
        controller.enqueue(enc.encode('\n\r'))
        controller.enqueue(enc.encode('\nevent: done\r\ndata: {}\r\n\r\n'))
        controller.close()
      },
    })
    const seen = []
    for await (const frame of iterateSseEvents(body, null)) seen.push(frame)
    expect(seen).toEqual([
      { event: 'stage', data: '{}' },
      { event: 'done', data: '{}' },
    ])
  })

  it('supports CRLF separators and a final unterminated frame', async () => {
    const body = streamOf('event: stage\r\ndata: {"s":1}\r\n\r\nevent: done\r\ndata: {}')
    const seen: Array<{ event: string; data: string }> = []
    for await (const frame of iterateSseEvents(body, null)) seen.push(frame)
    expect(seen).toEqual([
      { event: 'stage', data: '{"s":1}' },
      { event: 'done', data: '{}' },
    ])
  })

  it('stops iterating once the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const body = streamOf('event: stage\ndata: {}\n\n')
    const seen: unknown[] = []
    for await (const frame of iterateSseEvents(body, controller.signal)) seen.push(frame)
    expect(seen).toEqual([])
  })

  it('cancels a pending read when the signal aborts', async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      pull: () => new Promise<void>(() => {}),
      cancel() {
        cancelled = true
      },
    })
    const controller = new AbortController()
    const iterator = iterateSseEvents(body, controller.signal)
    const pending = iterator.next()
    controller.abort()
    await expect(pending).resolves.toEqual({ value: undefined, done: true })
    expect(cancelled).toBe(true)
  })

  it('cancels the source when its consumer returns before the stream closes', async () => {
    const enc = new TextEncoder()
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(enc.encode('event: error\ndata: {}\n\n'))
      },
      cancel() {
        cancelled = true
      },
    })
    const iterator = iterateSseEvents(body, null)
    await expect(iterator.next()).resolves.toEqual({ value: { event: 'error', data: '{}' }, done: false })
    await iterator.return(undefined)
    expect(cancelled).toBe(true)
  })
})
