import { describe, expect, it, vi } from 'vitest'

vi.mock('./characterImage', () => ({
  getCharImage: vi.fn(async (source: string, type: string) => `${type}:${source}`),
}))
vi.mock('./stores/coreStores.svelte', async () => {
  const { writable } = await import('svelte/store')
  return { selectedCharID: writable(0) }
})
vi.mock('./storage/database.svelte', () => ({ getDatabase: () => ({ characters: [] }) }))
vi.mock('./server/resourceState.svelte', () => ({ charactersResourceState: { characters: [], currentChar: -1 } }))

import { getEmotionForCharacter, getSelectedCharacterOwner, selectCharacterOwner } from './characterState'
import { charactersResourceState } from './server/resourceState.svelte'
import { selectedCharID } from './stores/coreStores.svelte'

const character = (overrides: Record<string, unknown> = {}) =>
  ({
    chaId: 'owner-character',
    name: 'Owner character',
    viewScreen: 'emotion',
    emotionImages: [['normal', 'owner-default']],
    image: 'owner-avatar',
    ...overrides,
  }) as any

describe('character owner emotion projection', () => {
  it('fails closed for missing or duplicate stable IDs and ignores aggregate alternatives', () => {
    const owner = character()
    expect(selectCharacterOwner([owner], 0)).toBe(owner)
    expect(selectCharacterOwner([], 0)).toBeUndefined()
    expect(selectCharacterOwner([owner, character({ name: 'duplicate' })], 0)).toBeUndefined()

    charactersResourceState.characters = [owner]
    charactersResourceState.currentChar = 0
    selectedCharID.set(99)
    expect(getSelectedCharacterOwner()).toBe(owner)
  })

  it('renders the explicit owner row, including emotion and imggen selection', async () => {
    const owner = character()
    expect(
      await getEmotionForCharacter(owner, { 'owner-character': [['happy', 'owner-emotion', 1]] }, 'contain'),
    ).toEqual(['normal', 'contain:owner-emotion'])
    expect(
      await getEmotionForCharacter(
        { ...owner, viewScreen: 'imggen' },
        { 'owner-character': [['happy', 'generated-image', 1]] },
        'contain',
      ),
    ).toEqual(['normal', 'generated-image'])
    expect(await getEmotionForCharacter(undefined, {}, 'contain')).toEqual([])
  })
})
