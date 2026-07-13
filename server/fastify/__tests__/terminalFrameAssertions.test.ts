import { describe, expect, it } from 'vitest'
import { formatPromptChatFrame } from '../src/prompt/sseEvents.js'
import {
  expectFrameOrder,
  expectNoSuccessDoneAfterAbort,
  expectSingleTerminal,
  expectTerminalDone,
  expectTerminalErrorThenDone,
  parseEvents,
  type PromptChatFrame,
} from './helpers/terminalFrameAssertions.js'

describe('terminal frame assertion helpers', () => {
  it('passes current success terminal semantics for raw SSE bodies', () => {
    const body =
      formatPromptChatFrame({ type: 'token', content: 'hello' }) +
      formatPromptChatFrame({ type: 'done', result: 'hello' })

    expectFrameOrder(body, ['token', 'done'])
    const done = expectTerminalDone(body)
    expect(done.data.result).toBe('hello')
  })

  it('accepts compact inline success frames whose tokens carry the result', () => {
    const body =
      formatPromptChatFrame({ type: 'token', content: 'hel' }) +
      formatPromptChatFrame({ type: 'token', content: 'lo' }) +
      formatPromptChatFrame({ type: 'done', generationId: 'generation-1' })

    const frames = parseEvents(body)
    expect(
      frames
        .filter((frame) => frame.type === 'token')
        .map((frame) => frame.data.content)
        .join(''),
    ).toBe('hello')
    const done = expectTerminalDone(frames)
    expect(done.data).toEqual({ generationId: 'generation-1' })
    expect(Object.hasOwn(done.data, 'result')).toBe(false)
  })

  it('passes current provider error then done terminal semantics', () => {
    const frames: PromptChatFrame[] = [
      { type: 'token', data: { content: 'partial' } },
      { type: 'error', data: { error: 'provider exploded' } },
      { type: 'done', data: {} },
    ]

    expectTerminalErrorThenDone(frames)
    expectNoSuccessDoneAfterAbort(frames)
  })

  it('normalizes already-parsed transport event arrays', () => {
    expectTerminalDone([
      { type: 'token', content: 'hello' },
      { type: 'done', result: 'hello' },
    ])
  })

  it('parses ordered typed frames from response bodies', () => {
    const frames = parseEvents(formatPromptChatFrame({ type: 'done' }))

    expect(frames).toEqual([{ type: 'done', data: {} }])
  })

  it('fails on duplicate terminals', () => {
    expect(() =>
      expectSingleTerminal([
        { type: 'token', data: { content: 'partial' } },
        { type: 'done', data: { result: 'partial' } },
        { type: 'done', data: {} },
      ]),
    ).toThrow(/expected exactly one terminal frame/)
  })

  it('fails on success done after an abort-shaped stream', () => {
    expect(() =>
      expectNoSuccessDoneAfterAbort([
        { type: 'token', data: { content: 'partial' } },
        { type: 'error', data: { error: 'aborted by explicit cancel' } },
        { type: 'done', data: { result: 'partial' } },
      ]),
    ).toThrow(/aborted stream must not emit success done frames/)
  })

  it('fails on out-of-order terminal frames', () => {
    expect(() =>
      expectTerminalErrorThenDone([
        { type: 'token', data: { content: 'partial' } },
        { type: 'done', data: {} },
        { type: 'error', data: { error: 'provider exploded' } },
      ]),
    ).toThrow(/expected terminal error then done/)
  })
})
