import { describe, expect, it } from 'vitest'
import type { CompletionStreamFrame } from '../src/generation/frames.js'
import { emitProviderChunks } from '../src/prompt/providerTransport.js'
import type { PromptChatEvent } from '../src/prompt/sseEvents.js'

async function* frames(items: CompletionStreamFrame[]): AsyncGenerator<CompletionStreamFrame> {
  for (const item of items) {
    yield item
  }
}

describe('emitProviderChunks', () => {
  it('maps provider token frames to chat token events and terminal done', async () => {
    const events: PromptChatEvent[] = []

    const result = await emitProviderChunks(
      frames([
        { kind: 'token', content: 'Hel' },
        { kind: 'token', content: 'lo' },
        { kind: 'done', finishReason: 'stop' },
      ]),
      (event) => events.push(event),
    )

    expect(events).toEqual([
      { type: 'token', content: 'Hel' },
      { type: 'token', content: 'lo' },
      { type: 'done', result: 'Hello' },
    ])
    expect(result).toEqual({ status: 'done', result: 'Hello', finishReason: 'stop' })
  })

  it('emits a terminal done when a provider source ends without an explicit done frame', async () => {
    const events: PromptChatEvent[] = []

    const result = await emitProviderChunks(frames([{ kind: 'token', content: 'partial' }]), (event) =>
      events.push(event),
    )

    expect(events).toEqual([
      { type: 'token', content: 'partial' },
      { type: 'done', result: 'partial' },
    ])
    expect(result).toEqual({ status: 'done', result: 'partial' })
  })

  it('maps provider source failures to error then done', async () => {
    const events: PromptChatEvent[] = []

    async function* failing(): AsyncGenerator<CompletionStreamFrame> {
      yield { kind: 'token', content: 'partial' }
      throw new Error('provider exploded')
    }

    const result = await emitProviderChunks(failing(), (event) => events.push(event))

    expect(events).toEqual([
      { type: 'token', content: 'partial' },
      { type: 'error', error: 'provider exploded' },
      { type: 'done' },
    ])
    expect(result).toEqual({ status: 'error', result: 'partial' })
  })

  it('maps provider error frames to error then done', async () => {
    const events: PromptChatEvent[] = []

    const result = await emitProviderChunks(
      frames([
        { kind: 'token', content: 'partial' },
        { kind: 'error', error: 'upstream refused', status: 500 },
      ]),
      (event) => events.push(event),
    )

    expect(events).toEqual([
      { type: 'token', content: 'partial' },
      { type: 'error', error: 'upstream refused' },
      { type: 'done' },
    ])
    expect(result).toEqual({ status: 'error', result: 'partial' })
  })

  it('does not emit after the request signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const events: PromptChatEvent[] = []

    const result = await emitProviderChunks(
      frames([{ kind: 'token', content: 'ignored' }]),
      (event) => events.push(event),
      controller.signal,
    )

    expect(events).toEqual([])
    expect(result).toEqual({ status: 'aborted', result: '' })
  })
})
