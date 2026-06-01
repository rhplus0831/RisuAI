import { describe, expect, it } from 'vitest'
import {
  STREAM_CLIENT_MAX_BUFFERED_BYTES,
  getWritableBufferedBytes,
  wouldExceedStreamBuffer,
  writeBoundedRaw,
} from '../src/streamBackpressure.js'

interface FakeWritable extends NodeJS.WritableStream {
  chunks: string[]
  writableEnded: boolean
  writableLength: number
}

function fakeWritable(bufferedBytes = 0): FakeWritable {
  return {
    chunks: [],
    writableEnded: false,
    writableLength: bufferedBytes,
    write(this: FakeWritable, chunk: unknown) {
      const text = String(chunk)
      this.chunks.push(text)
      this.writableLength += Buffer.byteLength(text)
      return true
    },
    end(this: FakeWritable) {
      this.writableEnded = true
      return this
    },
    addListener() {
      return this
    },
    emit() {
      return false
    },
    on() {
      return this
    },
    once() {
      return this
    },
    prependListener() {
      return this
    },
    prependOnceListener() {
      return this
    },
    removeListener() {
      return this
    },
    removeAllListeners() {
      return this
    },
    setMaxListeners() {
      return this
    },
    getMaxListeners() {
      return 10
    },
    listeners() {
      return []
    },
    rawListeners() {
      return []
    },
    listenerCount() {
      return 0
    },
    eventNames() {
      return []
    },
  } as unknown as FakeWritable
}

describe('stream backpressure helpers', () => {
  it('reports raw writable buffered bytes', () => {
    const raw = fakeWritable(123)
    expect(getWritableBufferedBytes(raw)).toBe(123)
  })

  it('detects a frame that would exceed the stream buffer cap', () => {
    const raw = fakeWritable(STREAM_CLIENT_MAX_BUFFERED_BYTES - 2)
    expect(wouldExceedStreamBuffer(raw, 'abc')).toBe(true)
    expect(wouldExceedStreamBuffer(raw, 'a')).toBe(false)
  })

  it('closes instead of writing when the cap would be exceeded', () => {
    const raw = fakeWritable(STREAM_CLIENT_MAX_BUFFERED_BYTES)
    let overflow = false
    expect(writeBoundedRaw(raw, 'x', { onOverflow: () => (overflow = true) })).toBe(false)
    expect(overflow).toBe(true)
    expect(raw.writableEnded).toBe(true)
    expect(raw.chunks).toEqual([])
  })

  it('writes while under the cap', () => {
    const raw = fakeWritable()
    expect(writeBoundedRaw(raw, 'event: ping\n\n')).toBe(true)
    expect(raw.writableEnded).toBe(false)
    expect(raw.chunks).toEqual(['event: ping\n\n'])
  })
})
