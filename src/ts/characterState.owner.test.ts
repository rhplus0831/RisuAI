import { beforeEach, describe, expect, it, vi } from 'vitest'

const ownerState = vi.hoisted(() => ({
  aggregateCharacters: [] as any[],
  charactersResourceState: {
    characters: [] as any[],
    currentChar: -1,
    status: 'ready',
  },
}))

vi.mock('./characterImage', () => ({
  getCharImage: vi.fn(async (source: string, type: string) => `${type}:${source}`),
}))
vi.mock('./stores/coreStores.svelte', async () => {
  const { writable } = await import('svelte/store')
  return { selectedCharID: writable(0) }
})
vi.mock('./storage/database.svelte', () => ({
  defaultSdDataFunc: () => ({}),
  getDatabase: () => ({ characters: ownerState.aggregateCharacters }),
}))
vi.mock('./server/resourceState.svelte', () => ({
  charactersResourceState: ownerState.charactersResourceState,
}))

import {
  findCharacterIndexbyId,
  findCharacterbyId,
  getEmotion,
  getEmotionForCharacter,
  getSelectedCharacterOwner,
  selectCharacterOwner,
} from './characterState'
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

beforeEach(() => {
  ownerState.aggregateCharacters = []
  charactersResourceState.characters = []
  charactersResourceState.currentChar = -1
  charactersResourceState.status = 'ready'
  selectedCharID.set(0)
})

describe('character owner emotion projection', () => {
  it('fails closed for missing or duplicate stable IDs and ignores aggregate alternatives', () => {
    const owner = character()
    expect(selectCharacterOwner([owner], 0)).toBe(owner)
    expect(selectCharacterOwner([], 0)).toBeUndefined()
    expect(selectCharacterOwner([owner, character({ name: 'duplicate' })], 0)).toBeUndefined()

    charactersResourceState.characters = [owner]
    charactersResourceState.currentChar = 0
    charactersResourceState.status = 'ready'
    selectedCharID.set(99)
    expect(getSelectedCharacterOwner()).toBe(owner)
  })

  it.each(['idle', 'loading', 'error'] as const)('does not read aggregate rows while the owner is %s', (status) => {
    const aggregate = character({ chaId: 'aggregate-character' })
    ownerState.aggregateCharacters = [aggregate]
    charactersResourceState.characters = [character({ chaId: 'stale-owner' })]
    charactersResourceState.currentChar = 0

    charactersResourceState.status = status
    expect(findCharacterIndexbyId('aggregate-character')).toBe(-1)
    expect(findCharacterbyId('aggregate-character').name).toBe('Unknown Character')
    expect(getSelectedCharacterOwner()).toBeUndefined()
  })

  it.each(['idle', 'loading', 'error'] as const)(
    'does not render an aggregate character while the owner is %s',
    async (status) => {
      const aggregate = character({ chaId: 'aggregate-character' })
      selectedCharID.set(0)
      charactersResourceState.status = status

      await expect(getEmotion({ characters: [aggregate] } as any, {}, 'contain')).resolves.toEqual([])
    },
  )

  it('renders the explicit owner row, including emotion and imggen selection', async () => {
    const owner = character()
    charactersResourceState.status = 'ready'
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
