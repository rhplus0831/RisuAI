import { beforeEach, describe, expect, it, vi } from 'vitest'

const { processScriptFullSpy } = vi.hoisted(() => ({
  processScriptFullSpy: vi.fn(),
}))

vi.mock('../scripts', async (importActual) => {
  const actual = await importActual<typeof import('../scripts')>()
  return { ...actual, processScriptFull: processScriptFullSpy }
})

vi.mock('../modules', async (importActual) => {
  const actual = await importActual<typeof import('../modules')>()
  return { ...actual, moduleUpdate: () => {} }
})

import {
  setDatabase,
  type Database,
  type MessageGenerationInfo,
  type MessagePresetInfo,
  type character,
} from '../../storage/database.svelte'
import { selectedCharID, DBState } from '../../stores.svelte'
import type { StreamResponseChunk, requestDataResponse } from '../request/request'
import { consumeStreamResponse } from '../postGeneration/streamResponse'

const REFORMAT = (s: string) => s.trim()

function makeChar(): character {
  return {
    name: 'Test',
    chaId: 'cha-1',
    chats: [
      {
        message: [{ role: 'user', data: 'hi' }],
        note: '',
        name: 'main',
        localLore: [],
      },
    ],
    chatPage: 0,
    reloadKeys: 0,
    image: '',
    emotionImages: [],
    bias: [],
    viewScreen: 'none',
    globalLore: [],
    chaVer: 0,
    firstMessage: '',
    desc: '',
    notes: '',
  } as unknown as character
}

function seed(): character {
  setDatabase({ characters: [makeChar()] } as Database)
  selectedCharID.set(0)
  return DBState.db.characters[0]
}

interface StreamHandle {
  stream: ReadableStream<StreamResponseChunk>
  push: (chunk: StreamResponseChunk) => void
  close: () => void
  error: (e: unknown) => void
}

function makeControlledStream(): StreamHandle {
  let controller!: ReadableStreamDefaultController<StreamResponseChunk>
  const stream = new ReadableStream<StreamResponseChunk>({
    start(c) {
      controller = c
    },
  })
  return {
    stream,
    push: (chunk) => {
      try {
        controller.enqueue(chunk)
      } catch {
        /* already closed via reader.cancel() */
      }
    },
    close: () => {
      try {
        controller.close()
      } catch {
        /* already closed via reader.cancel() */
      }
    },
    error: (e) => {
      try {
        controller.error(e)
      } catch {
        /* already closed */
      }
    },
  }
}

function streamingReq(stream: ReadableStream<StreamResponseChunk>): requestDataResponse & { type: 'streaming' } {
  return { type: 'streaming', result: stream } as requestDataResponse & { type: 'streaming' }
}

function callArgs(
  req: requestDataResponse & { type: 'streaming' },
  currentChar: character,
  signal: AbortSignal,
  overrides: Partial<Parameters<typeof consumeStreamResponse>[0]> = {},
) {
  return {
    req,
    arg: {},
    nowChatroom: currentChar,
    currentChar,
    selectedChar: 0,
    selectedChat: 0,
    generationId: 'gen-1',
    generationInfo: {} as MessageGenerationInfo,
    promptInfo: {} as MessagePresetInfo,
    abortSignal: signal,
    reformatContent: REFORMAT,
    ...overrides,
  }
}

describe('consumeStreamResponse', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(1000))
    processScriptFullSpy.mockReset()
    processScriptFullSpy.mockImplementation(async (_c: unknown, data: string) => ({
      data,
      emoChanged: false,
    }))
  })

  it('single chunk: pushes initial message, writes processed data, returns lastResponseChunk', async () => {
    const currentChar = seed()
    const { stream, push, close } = makeControlledStream()
    const ctrl = new AbortController()
    const promise = consumeStreamResponse(callArgs(streamingReq(stream), currentChar, ctrl.signal))
    push({ msgKey: 'hello' })
    close()
    const out = await promise
    expect(out.result).toBe('hello')
    expect(out.lastResponseChunk).toEqual({ msgKey: 'hello' })
    expect(out.streamAborted).toBe(false)
    expect(out.msgIndex).toBe(1)
    const messages = DBState.db.characters[0].chats[0].message
    expect(messages).toHaveLength(2)
    expect(messages[1].data).toBe('hello')
    expect(messages[1].role).toBe('char')
    expect(messages[1].chatId).toBe('gen-1')
  })

  it('multiple chunks: last chunk wins for message slot and result', async () => {
    const currentChar = seed()
    const { stream, push, close } = makeControlledStream()
    const ctrl = new AbortController()
    const promise = consumeStreamResponse(callArgs(streamingReq(stream), currentChar, ctrl.signal))
    push({ msgKey: 'a' })
    push({ msgKey: 'ab' })
    push({ msgKey: 'abc' })
    close()
    const out = await promise
    expect(out.result).toBe('abc')
    expect(DBState.db.characters[0].chats[0].message[1].data).toBe('abc')
    // Render coalescing: the microtask-paced chunks share one full-fidelity
    // apply at settle time instead of one editoutput parse per chunk.
    expect(processScriptFullSpy).toHaveBeenCalledTimes(1)
    expect(processScriptFullSpy).toHaveBeenCalledWith(currentChar, 'abc', 'editoutput', 1)
  })

  it('continue mode: decrements msgIndex, prepends prefix from prior message', async () => {
    const currentChar = seed()
    DBState.db.characters[0].chats[0].message.push({ role: 'char', data: 'partial' })
    const { stream, push, close } = makeControlledStream()
    const ctrl = new AbortController()
    const promise = consumeStreamResponse(
      callArgs(streamingReq(stream), currentChar, ctrl.signal, { arg: { continue: true } }),
    )
    push({ msgKey: 'extra' })
    close()
    const out = await promise
    expect(out.msgIndex).toBe(1)
    expect(processScriptFullSpy).toHaveBeenCalledWith(currentChar, 'partialextra', 'editoutput', 1)
    expect(DBState.db.characters[0].chats[0].message).toHaveLength(2)
  })

  it('empty/falsy chunk value: coerces to empty string instead of throwing', async () => {
    const currentChar = seed()
    const { stream, push, close } = makeControlledStream()
    const ctrl = new AbortController()
    const promise = consumeStreamResponse(callArgs(streamingReq(stream), currentChar, ctrl.signal))
    push({ msgKey: '' })
    close()
    const out = await promise
    expect(out.result).toBe('')
    expect(processScriptFullSpy).toHaveBeenCalledWith(currentChar, '', 'editoutput', 1)
  })

  it('removeIncompleteResponse=true: routes the chunk through trimUntilPunctuation (real impl)', async () => {
    const currentChar = seed()
    DBState.db.removeIncompleteResponse = true
    const { stream, push, close } = makeControlledStream()
    const ctrl = new AbortController()
    const promise = consumeStreamResponse(callArgs(streamingReq(stream), currentChar, ctrl.signal))
    // 'noPunct' has no trailing punctuation → real trim strips to ''.
    push({ msgKey: 'noPunct' })
    close()
    const out = await promise
    expect(out.result).toBe('')
    expect(processScriptFullSpy).toHaveBeenCalledWith(currentChar, '', 'editoutput', 1)
  })

  it('pre-aborted signal: skips the read loop entirely, streamAborted=true', async () => {
    const currentChar = seed()
    const { stream, close } = makeControlledStream()
    const ctrl = new AbortController()
    ctrl.abort()
    const out = await consumeStreamResponse(callArgs(streamingReq(stream), currentChar, ctrl.signal))
    expect(out.streamAborted).toBe(true)
    expect(processScriptFullSpy).not.toHaveBeenCalled()
    close()
  })

  it('mid-stream abort: stops the loop, preserves the last-applied chunk', async () => {
    const currentChar = seed()
    const { stream, push, close } = makeControlledStream()
    const ctrl = new AbortController()
    const promise = consumeStreamResponse(callArgs(streamingReq(stream), currentChar, ctrl.signal))
    push({ msgKey: 'first' })
    // Let the first chunk get processed before aborting.
    await Promise.resolve()
    await Promise.resolve()
    ctrl.abort()
    close()
    const out = await promise
    expect(out.streamAborted).toBe(true)
    expect(DBState.db.characters[0].chats[0].message[1].data).toBe('first')
  })

  it('reader error after abort is swallowed (streamAborted ends true)', async () => {
    const currentChar = seed()
    const { stream, error } = makeControlledStream()
    const ctrl = new AbortController()
    const promise = consumeStreamResponse(callArgs(streamingReq(stream), currentChar, ctrl.signal))
    ctrl.abort()
    error(new Error('reader-broke'))
    const out = await promise
    expect(out.streamAborted).toBe(true)
  })

  it('reader error without abort is rethrown', async () => {
    const currentChar = seed()
    const { stream, error } = makeControlledStream()
    const ctrl = new AbortController()
    const promise = consumeStreamResponse(callArgs(streamingReq(stream), currentChar, ctrl.signal))
    error(new Error('unrelated-failure'))
    await expect(promise).rejects.toThrow('unrelated-failure')
  })

  it('finally always runs: isStreaming flipped on then off, reloadKeys bumped each stage', async () => {
    const currentChar = seed()
    DBState.db.characters[0].reloadKeys = 0
    const { stream, push, close } = makeControlledStream()
    const ctrl = new AbortController()
    const promise = consumeStreamResponse(callArgs(streamingReq(stream), currentChar, ctrl.signal))
    push({ msgKey: 'hi' })
    close()
    await promise
    expect(DBState.db.characters[0].chats[0].isStreaming).toBe(false)
    // setup (+1) + per-chunk (+1) + finally (+1) = 3
    expect(DBState.db.characters[0].reloadKeys).toBe(3)
  })

  it('removes the abort listener in finally (later abort has no effect on result)', async () => {
    const currentChar = seed()
    const { stream, push, close } = makeControlledStream()
    const ctrl = new AbortController()
    const promise = consumeStreamResponse(callArgs(streamingReq(stream), currentChar, ctrl.signal))
    push({ msgKey: 'done' })
    close()
    const out = await promise
    expect(out.streamAborted).toBe(false)
    ctrl.abort()
    // No throw, no late mutation: the listener was removed in finally.
    expect(DBState.db.characters[0].chats[0].message[1].data).toBe('done')
  })
})

// Streaming display writes are frame-coalesced instead of parsed per token.
describe('H3 streaming render coalescing', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(1000))
    processScriptFullSpy.mockReset()
    processScriptFullSpy.mockImplementation(async (_c: unknown, data: string) => ({
      data,
      emoChanged: false,
    }))
  })

  it('bounds parse work for an N-token stream: applies are O(flushes), not O(N)', async () => {
    const currentChar = seed()
    DBState.db.characters[0].reloadKeys = 0
    const { stream, push, close } = makeControlledStream()
    const ctrl = new AbortController()
    const promise = consumeStreamResponse(callArgs(streamingReq(stream), currentChar, ctrl.signal))
    const tokenCount = 200
    let accumulated = ''
    for (let i = 0; i < tokenCount; i += 1) {
      accumulated += `tok${i} `
      push({ msgKey: accumulated })
    }
    close()
    const out = await promise

    // Final text identical to the per-chunk behavior: newest payload, reformat
    // (trim) + editoutput applied once at full fidelity.
    expect(out.result).toBe(accumulated)
    expect(DBState.db.characters[0].chats[0].message[1].data).toBe(accumulated.trim())
    // Old behavior: 200 editoutput parses + 200 display writes. Coalesced: the
    // microtask-paced chunks drain before any animation frame elapses, so the
    // settle apply is the only one (bound generously to tolerate one frame).
    expect(processScriptFullSpy.mock.calls.length).toBeLessThanOrEqual(2)
    // reloadKeys bumps == display reparses: setup (+1) + applies (<=2) +
    // finally (+1) — bounded, instead of 202.
    expect(DBState.db.characters[0].reloadKeys).toBeLessThanOrEqual(4)
  })

  it('flushes on the frame scheduler so the display progresses mid-stream', async () => {
    const currentChar = seed()
    const frames: (() => void)[] = []
    const { stream, push, close } = makeControlledStream()
    const ctrl = new AbortController()
    const promise = consumeStreamResponse(
      callArgs(streamingReq(stream), currentChar, ctrl.signal, {
        renderFlushScheduler: (flush) => {
          frames.push(flush)
        },
      }),
    )

    // First chunk arrives: one frame flush is scheduled; running it shows the
    // partial text before the stream is anywhere near done.
    push({ msgKey: 'Hello' })
    await vi.waitFor(() => expect(frames.length).toBe(1))
    frames.shift()!()
    await vi.waitFor(() => expect(DBState.db.characters[0].chats[0].message[1].data).toBe('Hello'))

    // Later chunks re-arm at most one further frame; without running it, the
    // terminal settle still applies the newest payload at full fidelity.
    push({ msgKey: 'Hello wor' })
    push({ msgKey: 'Hello world' })
    close()
    const out = await promise
    expect(out.result).toBe('Hello world')
    expect(DBState.db.characters[0].chats[0].message[1].data).toBe('Hello world')
    // One frame apply + one settle apply.
    expect(processScriptFullSpy).toHaveBeenCalledTimes(2)
  })

  it('a mid-stream apply failure propagates and still runs the finally cleanup', async () => {
    const currentChar = seed()
    processScriptFullSpy.mockRejectedValue(new Error('script-broke'))
    const { stream, push, close } = makeControlledStream()
    const ctrl = new AbortController()
    const promise = consumeStreamResponse(callArgs(streamingReq(stream), currentChar, ctrl.signal))
    push({ msgKey: 'boom' })
    close()
    await expect(promise).rejects.toThrow('script-broke')
    expect(DBState.db.characters[0].chats[0].isStreaming).toBe(false)
    // The apply never succeeded, so the message slot keeps its initial value.
    expect(DBState.db.characters[0].chats[0].message[1].data).toBe('')
  })
})
