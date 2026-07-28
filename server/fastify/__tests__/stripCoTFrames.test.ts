import { describe, expect, it } from 'vitest'
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

    await expect(collect(stripCoTFromCompletionFrames(frames))).resolves.toEqual([
      { kind: 'token', content: '  Visible answer\n' },
      { kind: 'done', finishReason: 'stop' },
    ])
  })
})
