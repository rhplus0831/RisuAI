import { get } from 'svelte/store'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Message } from '../storage/database.svelte'
import {
  beginGenerationDisplayProjection,
  findGenerationDisplayProjection,
  finishGenerationDisplayProjection,
  generationDisplayProjectionForMessage,
  generationDisplayProjections,
  generationPresentationAliases,
  generationPresentationKey,
  resetGenerationDisplayProjectionsForTests,
  updateGenerationDisplayProjection,
  type GenerationDisplayProjectionRef,
} from './generationDisplayProjection.svelte'

function projectionRef(overrides: Partial<GenerationDisplayProjectionRef> = {}): GenerationDisplayProjectionRef {
  return {
    operationId: 'operation-1',
    attemptNo: 1,
    characterId: 'character-1',
    chatId: 'chat-1',
    mode: 'regenerate',
    targetMessageId: 'message-old',
    projectionEpoch: 4,
    ...overrides,
  }
}

describe('generation display projections', () => {
  beforeEach(() => resetGenerationDisplayProjectionsForTests())

  it('projects regenerate text without mutating the authoritative message', () => {
    const message = { role: 'char', data: 'old reply', chatId: 'message-old' } as Message
    const ref = projectionRef()

    beginGenerationDisplayProjection(ref)
    expect(updateGenerationDisplayProjection(ref, { status: 'streaming', text: 'new partial' })).toBe(true)

    expect(message).toEqual({ role: 'char', data: 'old reply', chatId: 'message-old' })
    expect(findGenerationDisplayProjection(ref)).toMatchObject({
      targetMessageId: 'message-old',
      text: 'new partial',
      status: 'streaming',
    })
  })

  it('ignores stale attempt frames after a retry replaces the projection', () => {
    const first = projectionRef()
    const second = projectionRef({ attemptNo: 2, projectionEpoch: 5 })
    beginGenerationDisplayProjection(first)
    beginGenerationDisplayProjection(second)

    expect(updateGenerationDisplayProjection(first, { text: 'stale' })).toBe(false)
    expect(updateGenerationDisplayProjection(second, { status: 'streaming', text: 'current' })).toBe(true)
    expect(get(generationDisplayProjections)).toEqual([
      expect.objectContaining({ attemptNo: 2, projectionEpoch: 5, text: 'current' }),
    ])
  })

  it('reattaches to one projection and inherits its presentation key at terminal handoff', () => {
    const ref = projectionRef()
    beginGenerationDisplayProjection(ref)
    beginGenerationDisplayProjection(ref)
    updateGenerationDisplayProjection(ref, {
      generationId: 'message-new',
      status: 'finalizing',
      text: 'complete reply',
    })

    expect(get(generationDisplayProjections)).toHaveLength(1)
    expect(
      generationDisplayProjectionForMessage(get(generationDisplayProjections), 'chat-1', 'message-old'),
    ).toBeDefined()
    expect(
      generationDisplayProjectionForMessage(get(generationDisplayProjections), 'chat-1', 'message-new'),
    ).toBeDefined()
    const aliases = get(generationPresentationAliases)
    expect(generationPresentationKey(aliases, 'chat-1', 'message-old', 'old-fallback')).toBe('message-old')
    expect(generationPresentationKey(aliases, 'chat-1', 'message-new', 'new-fallback')).toBe('message-old')

    finishGenerationDisplayProjection(ref)
    expect(get(generationDisplayProjections)).toEqual([])
  })
})
