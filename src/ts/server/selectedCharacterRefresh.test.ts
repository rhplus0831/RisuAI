// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { selectedCharID } from '../stores.svelte'
import { charactersResourceState, resetServerResourceState } from './resourceState.svelte'
import {
  resolveSelectedCharacterIndexAfterRefresh,
  trackSelectedCharacterDuringRefresh,
} from './selectedCharacterRefresh'

const character = (chaId: string) => ({ chaId, chats: [] }) as any

beforeEach(() => {
  resetServerResourceState()
  charactersResourceState.characters = [character('owner-a'), character('owner-b')]
  charactersResourceState.currentChar = 0
  charactersResourceState.status = 'ready'
  selectedCharID.set(0)
})

afterEach(() => {
  selectedCharID.set(-1)
  resetServerResourceState()
})

describe('selected character refresh owner contract', () => {
  it('captures stable owner identity instead of relying on a mutable selected index', () => {
    const tracker = trackSelectedCharacterDuringRefresh()
    selectedCharID.set(1)
    charactersResourceState.characters = [character('replacement'), character('owner-b')]

    expect(tracker.snapshot()).toEqual({
      target: { selectedIndex: 1, characterId: 'owner-b' },
      selectionChanged: true,
    })
    tracker.stop()
  })

  it('fails closed when the owner identity is absent after refresh', () => {
    expect(resolveSelectedCharacterIndexAfterRefresh({ selectedIndex: 1, characterId: 'removed' })).toBe(0)

    charactersResourceState.currentChar = -1
    expect(resolveSelectedCharacterIndexAfterRefresh({ selectedIndex: 1, characterId: 'removed' })).toBe(-1)
  })
})
