import { describe, expect, it, vi } from 'vitest'
import type { CompletionStreamFrame } from '../src/generation/frames.js'
import { stripCoTFromCompletionFrames } from '../src/generation/stripCoT.js'

async function collect(frames: AsyncIterable<CompletionStreamFrame>): Promise<CompletionStreamFrame[]> {
  const collected: CompletionStreamFrame[] = []
  for await (const frame of frames) collected.push(frame)
  return collected
}

async function* source(frames: CompletionStreamFrame[]): AsyncGenerator<CompletionStreamFrame> {
  for (const frame of frames) yield frame
}

describe('stripCoTFromCompletionFrames', () => {
  it('removes known nested reasoning across stream chunk boundaries and from alternates', async () => {
    const frames = source([
      { kind: 'token', content: '<Tho' },
      { kind: 'token', content: 'ughts data-private="true">hidden <thi' },
      { kind: 'token', content: 'nk>nested</think></Thoughts>\nVisible answer' },
      {
        kind: 'done',
        finishReason: 'stop',
        alternates: ['<think>alternate private</think>Alternate answer'],
      },
    ])

    await expect(collect(stripCoTFromCompletionFrames(frames))).resolves.toEqual([
      { kind: 'token', content: 'Visible answer' },
      { kind: 'done', finishReason: 'stop', alternates: ['Alternate answer'] },
    ])
  })

  it('preserves unchanged output byte-for-byte when no known reasoning block exists', async () => {
    const frames = source([
      { kind: 'token', content: '  Visible ' },
      { kind: 'token', content: 'answer\n' },
      { kind: 'done', finishReason: 'stop' },
    ])

    const emitted = await collect(stripCoTFromCompletionFrames(frames))
    expect(
      emitted
        .filter((frame) => frame.kind === 'token')
        .map((frame) => frame.content)
        .join(''),
    ).toBe('  Visible answer\n')
    expect(emitted.at(-1)).toEqual({ kind: 'done', finishReason: 'stop' })
  })

  it('reports upstream counts during hidden reasoning and does not recount a pending text flush', async () => {
    const countTokens = vi.fn(() => 3)
    const frames = stripCoTFromCompletionFrames(
      source([
        { kind: 'token', content: '<think>hidden' },
        { kind: 'token', content: '</think>Visible <' },
        { kind: 'done', finishReason: 'length', alternates: ['<think>hidden</think>Alternative'] },
      ]),
      { countTokens },
    )

    await expect(collect(frames)).resolves.toEqual([
      { kind: 'token', content: '', tokenCount: 3 },
      { kind: 'token', content: 'Visible', tokenCount: 3 },
      { kind: 'token', content: ' <', tokenCount: 0 },
      { kind: 'done', finishReason: 'length', alternates: ['Alternative'] },
    ])
    expect(countTokens).toHaveBeenNthCalledWith(1, '<think>hidden')
    expect(countTokens).toHaveBeenNthCalledWith(2, '</think>Visible <')
  })

  it('retains whole-string whitespace normalization for buffered consumers', async () => {
    await expect(
      collect(
        stripCoTFromCompletionFrames(
          source([
            { kind: 'token', content: '  prefix <think>hidden</think> tail  ' },
            { kind: 'done', finishReason: 'stop' },
          ]),
          { buffered: true },
        ),
      ),
    ).resolves.toEqual([
      { kind: 'token', content: 'prefix  tail' },
      { kind: 'done', finishReason: 'stop' },
    ])
  })

  it.each(['frame', 'throw', 'eof'] as const)(
    'retains safe partial output on source %s without exposing unterminated reasoning',
    async (end) => {
      const failure = new Error('upstream failed')
      async function* input(): AsyncGenerator<CompletionStreamFrame> {
        yield { kind: 'token', content: '<think>hidden</think>Visible <' }
        yield { kind: 'token', content: 'think>private unfinished' }
        if (end === 'throw') throw failure
        if (end === 'frame') yield { kind: 'error', error: failure.message }
      }
      const emitted: CompletionStreamFrame[] = []
      const reading = (async () => {
        for await (const frame of stripCoTFromCompletionFrames(input())) emitted.push(frame)
      })()
      if (end === 'throw') await expect(reading).rejects.toBe(failure)
      else await reading
      expect(emitted.filter((frame) => frame.kind === 'token')).toEqual([{ kind: 'token', content: 'Visible' }])
      if (end === 'frame') expect(emitted.at(-1)).toEqual({ kind: 'error', error: 'upstream failed' })
    },
  )

  it('closes the provider iterator when a consumer cancels after visible text', async () => {
    const closed = vi.fn()
    async function* input(): AsyncGenerator<CompletionStreamFrame> {
      try {
        yield { kind: 'token', content: 'Visible<think>hidden' }
        yield { kind: 'token', content: 'more hidden</think>later' }
      } finally {
        closed()
      }
    }
    const iterator = stripCoTFromCompletionFrames(input())
    await expect(iterator.next()).resolves.toMatchObject({ value: { kind: 'token', content: 'Visible' } })
    await expect(iterator.return(undefined)).resolves.toMatchObject({ done: true })
    expect(closed).toHaveBeenCalledOnce()
  })

  it('keeps streaming when progress tokenization fails', async () => {
    await expect(
      collect(
        stripCoTFromCompletionFrames(
          source([{ kind: 'token', content: '<think>private</think>Visible' }, { kind: 'done' }]),
          {
            countTokens: () => {
              throw new Error('tokenizer failed')
            },
          },
        ),
      ),
    ).resolves.toEqual([{ kind: 'token', content: 'Visible', tokenCount: 1 }, { kind: 'done' }])
  })
})
