import { describe, expect, it } from 'vitest'
import { isCanonicalLoadout, isCanonicalLoadoutCollection, type CanonicalLoadout } from './loadoutCanonical'

function canonicalLoadout(id = 'loadout-a'): CanonicalLoadout {
  return {
    id,
    name: 'Loadout A',
    lastUsed: 100,
    favorite: false,
    characterIds: ['char-a'],
    modules: ['module-a'],
    globalVariables: { mood: 'bright' },
    presetName: 'Preset A',
    modelPresetId: '',
    modelPresetName: '',
    promptPresetId: '',
    promptPresetName: '',
    personaId: '',
  }
}

describe('canonical loadout validation', () => {
  it('accepts the exact server row shape and optional agent strings', () => {
    expect(isCanonicalLoadout(canonicalLoadout())).toBe(true)
    expect(
      isCanonicalLoadout({
        ...canonicalLoadout(),
        agentPresetId: '',
        agentPresetName: 'Research Agent',
      }),
    ).toBe(true)
    expect(isCanonicalLoadoutCollection([canonicalLoadout('loadout-a'), canonicalLoadout('loadout-b')])).toBe(true)
  })

  it('requires every server-owned field and rejects unknown keys', () => {
    for (const key of Object.keys(canonicalLoadout())) {
      const missing = { ...canonicalLoadout() }
      Reflect.deleteProperty(missing, key)
      expect(isCanonicalLoadout(missing), key).toBe(false)
    }
    expect(isCanonicalLoadout({ ...canonicalLoadout(), legacyMetadata: true })).toBe(false)
  })

  it.each([
    ['blank id', { id: '   ' }],
    ['blank name', { name: '' }],
    ['non-finite lastUsed', { lastUsed: Number.POSITIVE_INFINITY }],
    ['non-boolean favorite', { favorite: 1 }],
    ['non-string character id', { characterIds: ['char-a', 2] }],
    ['sparse character ids', { characterIds: Array(1) }],
    ['non-string module id', { modules: [false] }],
    ['non-string global value', { globalVariables: { mood: 1 } }],
    ['non-string required preset field', { promptPresetName: undefined }],
    ['non-string optional agent field', { agentPresetId: undefined }],
  ])('rejects %s', (_label, patch) => {
    expect(isCanonicalLoadout({ ...canonicalLoadout(), ...patch })).toBe(false)
  })

  it('requires unique ids across the collection', () => {
    expect(isCanonicalLoadoutCollection([canonicalLoadout(), canonicalLoadout()])).toBe(false)
  })
})
