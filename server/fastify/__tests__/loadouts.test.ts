import { describe, expect, it } from 'vitest'
import { ensureLoadoutCollection, normalizeLoadoutCollection, type LoadoutRecord } from '../src/commands/loadouts.js'

function canonicalLoadout(id: string, name = 'Shared name'): LoadoutRecord {
  return {
    id,
    name,
    lastUsed: 10,
    favorite: false,
    characterIds: [],
    modules: [],
    globalVariables: {},
    presetName: '',
    modelPresetId: '',
    modelPresetName: '',
    promptPresetId: '',
    promptPresetName: '',
    personaId: '',
  }
}

describe('loadout repair boundary', () => {
  it('reads canonical persisted loadouts by stable id without changing duplicate names or rows', () => {
    const database = {
      loadouts: [canonicalLoadout('loadout-a'), canonicalLoadout('loadout-b')],
      lastLoadedLoadoutName: 'Shared name',
    }
    const before = structuredClone(database)

    const loadouts = ensureLoadoutCollection(database)

    expect(loadouts.map((loadout) => loadout.id)).toEqual(['loadout-a', 'loadout-b'])
    expect(database).toEqual(before)
  })

  it.each([
    [{ lastLoadedLoadoutName: '' }, 'loadouts must be an array'],
    [{ loadouts: [] }, 'lastLoadedLoadoutName must be a string'],
    [
      { loadouts: [canonicalLoadout('loadout-a'), canonicalLoadout('loadout-a')], lastLoadedLoadoutName: '' },
      'Duplicate loadout id: loadout-a',
    ],
    [
      {
        loadouts: [{ ...canonicalLoadout('loadout-a'), favorite: 'yes' }],
        lastLoadedLoadoutName: '',
      },
      'loadouts[0].favorite must be a boolean',
    ],
    [
      {
        loadouts: [{ id: 'loadout-a', name: 'A' }],
        lastLoadedLoadoutName: '',
      },
      'loadouts[0].lastUsed is required',
    ],
  ])('fails closed without repairing damaged persisted state', (database, expectedError) => {
    const before = structuredClone(database)

    expect(() => ensureLoadoutCollection(database)).toThrow(expectedError)
    expect(database).toEqual(before)
  })

  it('repairs import-boundary ids deterministically without stealing later valid ids', () => {
    const database: Record<string, unknown> = {
      loadouts: [
        { name: 'Missing id' },
        { id: 'loadout-1', name: 'Reserved later' },
        { id: 'duplicate', name: 'First duplicate' },
        { id: 'duplicate', name: 'Second duplicate' },
        null,
      ],
    }

    normalizeLoadoutCollection(database)

    expect((database.loadouts as LoadoutRecord[]).map((loadout) => loadout.id)).toEqual([
      'loadout-1-2',
      'loadout-1',
      'duplicate',
      'loadout-4',
      'loadout-5',
    ])
    expect(database.lastLoadedLoadoutName).toBe('')
    expect(database.loadouts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'loadout-1-2', name: 'Missing id', lastUsed: 0 }),
        expect.objectContaining({ id: 'loadout-5', name: 'Loadout 5', lastUsed: 0 }),
      ]),
    )
    expect(() => ensureLoadoutCollection(database)).not.toThrow()

    const repaired = structuredClone(database)
    normalizeLoadoutCollection(database)
    expect(database).toEqual(repaired)
  })
})
