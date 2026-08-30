import { describe, expect, it } from 'vitest'
import { resolveTranscriptRenderMessages } from './DefaultChatScreen.svelte'

describe('DefaultChatScreen transcript render owner', () => {
  it('ignores divergent aggregate rows when an owner projection is available', () => {
    const aggregate = [{ chatId: 'aggregate', data: 'stale' }] as any
    const owner = [{ chatId: 'owner', data: 'fresh' }] as any

    expect(resolveTranscriptRenderMessages({ messages: owner, projectionEpoch: 1 } as any, aggregate)).toBe(owner)
  })

  it('returns the refreshed owner array after its projection epoch advances', () => {
    const first = [{ chatId: 'm1', data: 'first' }] as any
    const second = [{ chatId: 'm1', data: 'second' }] as any
    const owner = { messages: first, projectionEpoch: 1 } as any

    expect(resolveTranscriptRenderMessages(owner, [])).toBe(first)
    owner.messages = second
    owner.projectionEpoch = 2
    expect(resolveTranscriptRenderMessages(owner, [])).toBe(second)
  })
})
