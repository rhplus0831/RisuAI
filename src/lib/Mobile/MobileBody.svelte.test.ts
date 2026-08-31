import { describe, expect, it, vi } from 'vitest'
import { resolveMobileSelectedCharacter, shouldRenderMobileChat } from './MobileBody.svelte'

function character(chaId: string, name: string, extra: Record<string, unknown> = {}) {
  return { chaId, name, type: 'character', chats: [], ...extra } as any
}

describe('MobileBody character owner boundary', () => {
  it('uses the resource-selected unique owner after readiness without reading aggregate state', () => {
    const aggregate = character('char-a', 'Aggregate')
    const owner = character('char-a', 'Owner')
    const readCompatibilityCharacters = vi.fn(() => [aggregate])

    const selectedCharacter = resolveMobileSelectedCharacter({
      ownerCharacters: [character('char-b', 'Other'), owner],
      ownerStatus: 'ready',
      ownerSelectedIndex: 1,
      compatibilitySelectedIndex: -1,
      readCompatibilityCharacters,
    })

    expect(selectedCharacter).toBe(owner)
    expect(shouldRenderMobileChat(selectedCharacter)).toBe(true)
    expect(readCompatibilityCharacters).not.toHaveBeenCalled()
  })

  it('keeps aggregate compatibility before resource readiness', () => {
    const aggregate = character('char-a', 'Aggregate')

    expect(
      resolveMobileSelectedCharacter({
        ownerCharacters: [],
        ownerStatus: 'idle',
        ownerSelectedIndex: -1,
        compatibilitySelectedIndex: 0,
        readCompatibilityCharacters: () => [aggregate],
      }),
    ).toBe(aggregate)
  })

  it('does not render a chat before readiness when compatibility has no selection', () => {
    const selectedCharacter = resolveMobileSelectedCharacter({
      ownerCharacters: [],
      ownerStatus: 'loading',
      ownerSelectedIndex: 0,
      compatibilitySelectedIndex: -1,
      readCompatibilityCharacters: () => [character('char-a', 'Aggregate')],
    })

    expect(selectedCharacter).toBeUndefined()
    expect(shouldRenderMobileChat(selectedCharacter)).toBe(false)
  })

  it('resolves pre-readiness owner detail by stable ID rather than aggregate position', () => {
    const aggregate = character('char-a', 'Aggregate')
    const owner = character('char-a', 'Owner')

    expect(
      resolveMobileSelectedCharacter({
        ownerCharacters: [character('char-b', 'Other'), owner],
        ownerStatus: 'loading',
        ownerSelectedIndex: -1,
        compatibilitySelectedIndex: 0,
        readCompatibilityCharacters: () => [aggregate],
      }),
    ).toBe(owner)
  })

  it('falls back to matching aggregate data for pre-readiness shell owner rows', () => {
    const aggregate = character('char-a', 'Aggregate')
    const shell = character('char-a', 'Shell', { __serverCharacterShell: true })

    expect(
      resolveMobileSelectedCharacter({
        ownerCharacters: [shell],
        ownerStatus: 'idle',
        ownerSelectedIndex: -1,
        compatibilitySelectedIndex: 0,
        readCompatibilityCharacters: () => [aggregate],
      }),
    ).toBe(aggregate)
  })

  it('keeps a ready shell as the authoritative resource owner', () => {
    const shell = character('char-a', 'Shell', { __serverCharacterShell: true })

    expect(
      resolveMobileSelectedCharacter({
        ownerCharacters: [shell],
        ownerStatus: 'ready',
        ownerSelectedIndex: 0,
        compatibilitySelectedIndex: 0,
        readCompatibilityCharacters: () => [character('char-a', 'Aggregate')],
      }),
    ).toBe(shell)
  })

  it('fails closed on duplicate resource character IDs', () => {
    const readCompatibilityCharacters = vi.fn(() => [character('char-a', 'Aggregate')])

    expect(
      resolveMobileSelectedCharacter({
        ownerCharacters: [character('char-a', 'First'), character('char-a', 'Second')],
        ownerStatus: 'ready',
        ownerSelectedIndex: 0,
        compatibilitySelectedIndex: 0,
        readCompatibilityCharacters,
      }),
    ).toBeUndefined()
    expect(readCompatibilityCharacters).not.toHaveBeenCalled()
  })

  it('fails closed on duplicate compatibility character IDs', () => {
    expect(
      resolveMobileSelectedCharacter({
        ownerCharacters: [],
        ownerStatus: 'idle',
        ownerSelectedIndex: -1,
        compatibilitySelectedIndex: 0,
        readCompatibilityCharacters: () => [character('char-a', 'First'), character('char-a', 'Second')],
      }),
    ).toBeUndefined()
  })

  it('fails closed on duplicate pre-readiness owner IDs instead of using aggregate data', () => {
    expect(
      resolveMobileSelectedCharacter({
        ownerCharacters: [character('char-a', 'First'), character('char-a', 'Second')],
        ownerStatus: 'loading',
        ownerSelectedIndex: -1,
        compatibilitySelectedIndex: 0,
        readCompatibilityCharacters: () => [character('char-a', 'Aggregate')],
      }),
    ).toBeUndefined()
  })

  it('fails closed on owner errors without reading aggregate compatibility', () => {
    const readCompatibilityCharacters = vi.fn(() => [character('char-a', 'Aggregate')])

    expect(
      resolveMobileSelectedCharacter({
        ownerCharacters: [character('char-a', 'Resident owner')],
        ownerStatus: 'error',
        ownerSelectedIndex: 0,
        compatibilitySelectedIndex: 0,
        readCompatibilityCharacters,
      }),
    ).toBeUndefined()
    expect(readCompatibilityCharacters).not.toHaveBeenCalled()
  })
})
