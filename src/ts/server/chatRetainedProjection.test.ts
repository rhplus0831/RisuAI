import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearRetainedChatProjections,
  reapplyRetainedCharacterProjections,
  reapplyRetainedChatBodyProjections,
  registerRetainedChatProjection,
} from './chatRetainedProjection'

describe('retained chat projection registry', () => {
  beforeEach(() => clearRetainedChatProjections())

  it('reapplies matching projections in registration order', () => {
    const applied: string[] = []
    registerRetainedChatProjection({ kind: 'character', characterId: 'char-a' }, () => applied.push('first'))
    registerRetainedChatProjection({ kind: 'character', characterId: 'char-b' }, () => applied.push('other'))
    registerRetainedChatProjection({ kind: 'character', characterId: 'char-a' }, () => applied.push('second'))
    registerRetainedChatProjection({ kind: 'chat-body', chatId: 'chat-a' }, () => applied.push('body'))

    reapplyRetainedCharacterProjections('char-a')
    reapplyRetainedChatBodyProjections('chat-a')

    expect(applied).toEqual(['first', 'second', 'body'])
  })

  it('releases exact registrations and invalidates the remaining ownership scope', () => {
    const releasedInvalidation = vi.fn()
    const retainedInvalidation = vi.fn()
    const release = registerRetainedChatProjection({ kind: 'character', characterId: 'char-a' }, vi.fn(), () =>
      releasedInvalidation(),
    )
    registerRetainedChatProjection({ kind: 'chat-body', chatId: 'chat-a' }, vi.fn(), retainedInvalidation)

    release()
    clearRetainedChatProjections()

    expect(releasedInvalidation).not.toHaveBeenCalled()
    expect(retainedInvalidation).toHaveBeenCalledOnce()
  })
})
