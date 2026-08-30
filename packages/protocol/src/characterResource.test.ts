import { describe, expect, it } from 'vitest'
import {
  SERVER_CHARACTER_RESOURCE_VERSION,
  isServerCharacterDetailResource,
  isServerCharacterOrderResource,
  isServerCharacterSelectionResource,
} from './characterResource'

describe('targeted character resource protocol', () => {
  it('publishes a version while preserving the existing wire envelopes', () => {
    expect(SERVER_CHARACTER_RESOURCE_VERSION).toBe(1)
    expect(
      isServerCharacterDetailResource({ revision: 3, character: { chaId: 'char-a', name: 'Ada', chats: [] } }),
    ).toBe(true)
    expect(isServerCharacterOrderResource({ revision: 3, characterOrder: ['char-a'] })).toBe(true)
    expect(isServerCharacterSelectionResource({ revision: 3, characterId: 'char-a', currentChar: 0 })).toBe(true)
  })

  it('rejects malformed, empty-identity, extra-field, and invalid-revision payloads', () => {
    expect(isServerCharacterDetailResource({ revision: 0, character: { chaId: ' ' } })).toBe(false)
    expect(isServerCharacterDetailResource({ revision: 0, character: { name: 'missing id' } })).toBe(false)
    expect(isServerCharacterDetailResource({ revision: -1, character: { chaId: 'char-a' } })).toBe(false)
    expect(isServerCharacterOrderResource({ revision: 1, characterOrder: [], extra: true })).toBe(false)
    expect(isServerCharacterSelectionResource({ revision: 1, characterId: ' ', currentChar: 0 })).toBe(false)
    expect(isServerCharacterSelectionResource({ revision: 1, characterId: 'char-a', currentChar: -1 })).toBe(false)
    expect(
      isServerCharacterSelectionResource({ revision: 1, characterId: 'char-a', currentChar: 0, lastInteraction: NaN }),
    ).toBe(false)
  })
})
