import { describe, expect, it } from 'vitest'
import { resolveMobileSideChatCharacter } from './MobileBody.svelte'

function character(chaId: string, name: string, extra: Record<string, unknown> = {}) {
  return { chaId, name, type: 'character', chats: [], ...extra } as any
}

describe('MobileBody character owner boundary', () => {
  it('prefers hydrated owner detail over conflicting aggregate data', () => {
    const aggregate = character('char-a', 'Aggregate')
    const owner = character('char-a', 'Owner')

    expect(resolveMobileSideChatCharacter([owner], aggregate, 0)?.name).toBe('Owner')
  })

  it('falls back to aggregate data for shell owner rows', () => {
    const aggregate = character('char-a', 'Aggregate')
    const shell = character('char-a', 'Shell', { __serverCharacterShell: true })

    expect(resolveMobileSideChatCharacter([shell], aggregate, 0)).toBe(aggregate)
  })
})
