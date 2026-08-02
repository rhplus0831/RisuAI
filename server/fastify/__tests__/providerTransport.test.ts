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

  it('omits a negotiated duplicate done result after token frames delivered it', async () => {
    const events: PromptChatEvent[] = []

    const result = await emitProviderChunks(
      frames([
        { kind: 'token', content: 'Hel' },
        { kind: 'token', content: 'lo' },
        { kind: 'done', finishReason: 'stop' },
      ]),
      (event) => events.push(event),
      undefined,
      { omitResultWhenStreamed: true },
    )

    expect(events).toEqual([{ type: 'token', content: 'Hel' }, { type: 'token', content: 'lo' }, { type: 'done' }])
    expect(result).toEqual({ status: 'done', result: 'Hello', finishReason: 'stop' })
    expect(JSON.stringify(events.at(-1))).not.toContain('Hello')
    expect(JSON.stringify(events.at(-1))!.length).toBeLessThan(JSON.stringify({ type: 'done', result: 'Hello' }).length)
  })

  it('retains the done result when no non-empty token text was delivered', async () => {
    const events: PromptChatEvent[] = []

    const result = await emitProviderChunks(
      frames([{ kind: 'done', finishReason: 'stop' }]),
      (event) => events.push(event),
      undefined,
      { omitResultWhenStreamed: true },
    )

    expect(events).toEqual([{ type: 'done', result: '' }])
    expect(result).toEqual({ status: 'done', result: '', finishReason: 'stop' })
  })

  it('carries multi-generation alternates through post-generation and the terminal done event', async () => {
    const events: PromptChatEvent[] = []
    const postGenerationCalls: Array<{ result: string; alternates: readonly string[] }> = []
    const sideEffectCalls: string[][] = []

    const result = await emitProviderChunks(
      frames([
        { kind: 'token', content: 'primary' },
        { kind: 'done', finishReason: 'stop', alternates: ['choice two', 'choice three'] },
      ]),
      (event) => events.push(event),
      undefined,
      {
        postGeneration: async (completion, alternates) => {
          postGenerationCalls.push({ result: completion, alternates })
          return {
            frame: { revision: 2 },
            primary: completion.toUpperCase(),
            alternates: alternates.map((choice) => choice.toUpperCase()),
          }
        },
        sideEffects: (choices) => {
          sideEffectCalls.push([...choices])
          return choices.map((text) => ({ type: 'side_effect', kind: 'tts', payload: { text } }))
        },
      },
    )

    expect(postGenerationCalls).toEqual([{ result: 'primary', alternates: ['choice two', 'choice three'] }])
    expect(sideEffectCalls).toEqual([['PRIMARY', 'CHOICE TWO', 'CHOICE THREE']])
    expect(events.slice(1, -1)).toEqual([
      { type: 'side_effect', kind: 'tts', payload: { text: 'PRIMARY' } },
      { type: 'side_effect', kind: 'tts', payload: { text: 'CHOICE TWO' } },
      { type: 'side_effect', kind: 'tts', payload: { text: 'CHOICE THREE' } },
    ])
    expect(events.at(-1)).toEqual({
      type: 'done',
      result: 'primary',
      alternates: ['CHOICE TWO', 'CHOICE THREE'],
      postGeneration: { revision: 2 },
    })
    expect(result).toEqual({
      status: 'done',
      result: 'primary',
      finishReason: 'stop',
      alternates: ['CHOICE TWO', 'CHOICE THREE'],
    })
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
      { type: 'error', error: 'provider exploded', reason: 'provider_stream_exception' },
      { type: 'done' },
    ])
    expect(result).toEqual({ status: 'error', result: 'partial' })
  })

  it('maps provider error frames to error then done', async () => {
    const events: PromptChatEvent[] = []

    const result = await emitProviderChunks(
      frames([
        { kind: 'token', content: 'partial' },
        { kind: 'error', error: 'upstream refused', status: 500, statusText: 'Bad Gateway', code: 'upstream_500' },
      ]),
      (event) => events.push(event),
      undefined,
      { omitResultWhenStreamed: true },
    )

    expect(events).toEqual([
      { type: 'token', content: 'partial' },
      {
        type: 'error',
        error: 'upstream refused',
        reason: 'provider_stream_error_frame',
        status: 500,
        statusText: 'Bad Gateway',
        code: 'upstream_500',
      },
      { type: 'done' },
    ])
    expect(result).toEqual({ status: 'error', result: 'partial' })
  })

  it.each([
    { messageKind: 'a missing message', frame: { kind: 'error' } as const },
    { messageKind: 'a blank message', frame: { kind: 'error', error: '   ' } as const },
  ])('uses a clear provider-stream fallback for $messageKind', async ({ frame }) => {
    const events: PromptChatEvent[] = []

    const result = await emitProviderChunks(frames([frame]), (event) => events.push(event))

    expect(events).toEqual([
      {
        type: 'error',
        error: 'Provider stream failed without an error message.',
        reason: 'provider_stream_error_frame_empty',
      },
      { type: 'done' },
    ])
    expect(result).toEqual({ status: 'error', result: '' })
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
