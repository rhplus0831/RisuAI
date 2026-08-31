import { describe, expect, it } from 'vitest'
import { hypaV3PresetIndexFromStableId, repairHypaV3PresetSelectionIdentity } from './hypaV3PresetSelectionIdentity.js'

describe('Hypa V3 preset selection identity', () => {
  it('prefers one stable selected id over the legacy index and is idempotent', () => {
    const database: Record<string, unknown> = {
      hypaV3Presets: [{ id: 'memory-a' }, { id: 'memory-b' }],
      hypaV3PresetId: 0,
      selectedHypaV3PresetId: 'memory-b',
    }

    expect(repairHypaV3PresetSelectionIdentity(database)).toEqual({
      changed: true,
      hypaV3PresetId: 1,
      selectedHypaV3PresetId: 'memory-b',
    })
    expect(repairHypaV3PresetSelectionIdentity(database)).toEqual({
      changed: false,
      hypaV3PresetId: 1,
      selectedHypaV3PresetId: 'memory-b',
    })
    expect(hypaV3PresetIndexFromStableId(database)).toBe(1)
  })

  it('repairs missing and duplicate ids deterministically without stealing later ids', () => {
    const database: Record<string, unknown> = {
      hypaV3Presets: [{ id: '' }, { id: 'hypa-v3-preset-1' }, { id: 'duplicate' }, { id: 'duplicate' }, {}],
      hypaV3PresetId: 3,
      selectedHypaV3PresetId: 'duplicate',
    }

    expect(repairHypaV3PresetSelectionIdentity(database)).toEqual({
      changed: true,
      hypaV3PresetId: 3,
      selectedHypaV3PresetId: 'hypa-v3-preset-4',
    })
    expect((database.hypaV3Presets as Array<{ id: string }>).map(({ id }) => id)).toEqual([
      'hypa-v3-preset-1-2',
      'hypa-v3-preset-1',
      'duplicate',
      'hypa-v3-preset-4',
      'hypa-v3-preset-5',
    ])

    const retry = structuredClone(database)
    expect(repairHypaV3PresetSelectionIdentity(retry).changed).toBe(false)
    expect(retry).toEqual(database)
  })

  it('falls back to the first record or null and makes strict projections fail closed', () => {
    const first: Record<string, unknown> = {
      hypaV3Presets: [{ id: 'memory-a' }, { id: 'memory-b' }],
      hypaV3PresetId: 9,
      selectedHypaV3PresetId: 'missing',
    }
    expect(repairHypaV3PresetSelectionIdentity(first)).toMatchObject({
      hypaV3PresetId: 0,
      selectedHypaV3PresetId: 'memory-a',
    })

    const empty: Record<string, unknown> = { hypaV3Presets: [], hypaV3PresetId: 0 }
    expect(repairHypaV3PresetSelectionIdentity(empty)).toEqual({
      changed: true,
      hypaV3PresetId: -1,
      selectedHypaV3PresetId: null,
    })

    expect(
      hypaV3PresetIndexFromStableId({
        hypaV3Presets: [{ id: 'duplicate' }, { id: 'duplicate' }],
        selectedHypaV3PresetId: 'duplicate',
      }),
    ).toBe(-1)
  })
})
