import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAX_BUFFERED_BODY_BYTES, readBoundedBodyJson, readBoundedBodyText } from '../src/generation/body.js'
import { runOpenAI } from '../src/generation/openai.js'

/**
 * Bounded buffering for upstream provider bodies (audit M8). Every
 * non-streaming adapter reads through `readBoundedBodyText/Json`, so a
 * misbehaving upstream cannot make the server buffer an unbounded body.
 */

function streamedResponse(chunks: Uint8Array[], init?: ResponseInit): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })
  return new Response(stream, { status: 200, ...init })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('readBoundedBodyText / readBoundedBodyJson (body cap)', () => {
  it('returns the full body when under the cap', async () => {
    const text = await readBoundedBodyText(new Response('hello upstream'), 1024)
    expect(text).toBe('hello upstream')
  })

  it('parses JSON under the cap', async () => {
    const value = await readBoundedBodyJson(new Response('{"ok": true}'), 1024)
    expect(value).toEqual({ ok: true })
  })

  it('returns an empty string for a missing body', async () => {
    const text = await readBoundedBodyText(new Response(null), 1024)
    expect(text).toBe('')
  })

  it('throws once the cumulative body passes the cap instead of buffering it all', async () => {
    const chunk = new Uint8Array(1024).fill(120) // 'x'
    const endless = Array.from({ length: 10 }, () => chunk)
    await expect(readBoundedBodyText(streamedResponse(endless), 4096)).rejects.toThrow(
      /exceeded the 4096-byte buffer cap/,
    )
  })

  it('ships a generous default cap (32 MB) — far above any legitimate completion', () => {
    expect(MAX_BUFFERED_BODY_BYTES).toBe(32 * 1024 * 1024)
  })

  it('a non-streaming adapter fails closed on an over-cap upstream body', async () => {
    // Stream > MAX_BUFFERED_BODY_BYTES in 1 MB chunks; the adapter must fail
    // with a bounded read, not buffer the whole thing.
    const oneMb = new Uint8Array(1024 * 1024).fill(120)
    const chunks = Array.from({ length: 33 }, () => oneMb)
    vi.stubGlobal('fetch', async () => streamedResponse(chunks))
    const result = await runOpenAI({
      model: 'gpt-4o',
      messages: [],
      apiKey: 'k',
      baseUrl: 'https://api.openai.com/v1',
      signal: new AbortController().signal,
    })
    expect(result.type).toBe('fail')
    expect(result.result).toContain('buffer cap')
  })
})
