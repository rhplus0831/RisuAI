import { describe, expect, it } from 'vitest'
import { resolveMobileSelectedCharacter, shouldRenderMobileChat } from './MobileBody.svelte'

function character(chaId: string, name: string, extra: Record<string, unknown> = {}) {
  return { chaId, name, type: 'character', chats: [], ...extra } as any
}

describe('MobileBody character owner boundary', () => {
  it('uses the resource-selected unique owner after readiness without reading aggregate state', () => {
    const owner = character('char-a', 'Owner')

    const selectedCharacter = resolveMobileSelectedCharacter({
      ownerCharacters: [character('char-b', 'Other'), owner],
      ownerStatus: 'ready',
      ownerSelectedIndex: 1,
    })

    expect(selectedCharacter).toBe(owner)
    expect(shouldRenderMobileChat(selectedCharacter)).toBe(true)
  })

  it.each(['idle', 'loading'] as const)('does not render a chat while owners are %s', (ownerStatus) => {
    const selectedCharacter = resolveMobileSelectedCharacter({
      ownerCharacters: [character('char-a', 'Resident row')],
      ownerStatus,
      ownerSelectedIndex: 0,
    })

    expect(selectedCharacter).toBeUndefined()
    expect(shouldRenderMobileChat(selectedCharacter)).toBe(false)
  })

  it('keeps a ready shell as the authoritative resource owner', () => {
    const shell = character('char-a', 'Shell', { __serverCharacterShell: true })

    expect(
      resolveMobileSelectedCharacter({
        ownerCharacters: [shell],
        ownerStatus: 'ready',
        ownerSelectedIndex: 0,
      }),
    ).toBe(shell)
  })

  it('fails closed on duplicate resource character IDs', () => {
    expect(
      resolveMobileSelectedCharacter({
        ownerCharacters: [character('char-a', 'First'), character('char-a', 'Second')],
        ownerStatus: 'ready',
        ownerSelectedIndex: 0,
      }),
    ).toBeUndefined()
  })

  it('fails closed on owner errors without reading aggregate compatibility', () => {
    expect(
      resolveMobileSelectedCharacter({
        ownerCharacters: [character('char-a', 'Resident owner')],
        ownerStatus: 'error',
        ownerSelectedIndex: 0,
      }),
    ).toBeUndefined()
  })
})
