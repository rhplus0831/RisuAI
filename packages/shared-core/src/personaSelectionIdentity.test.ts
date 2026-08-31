import { describe, expect, it } from 'vitest'
import { repairPersonaSelectionIdentity, selectedPersonaIndexFromStableId } from './personaSelectionIdentity.js'

describe('persona selection identity', () => {
  it('prefers one stable selected id over the legacy index and is idempotent', () => {
    const database: Record<string, unknown> = {
      personas: [{ id: 'persona-a' }, { id: 'persona-b' }],
      selectedPersona: 0,
      selectedPersonaId: 'persona-b',
    }

    expect(repairPersonaSelectionIdentity(database)).toEqual({
      changed: true,
      selectedPersona: 1,
      selectedPersonaId: 'persona-b',
    })
    expect(repairPersonaSelectionIdentity(database)).toEqual({
      changed: false,
      selectedPersona: 1,
      selectedPersonaId: 'persona-b',
    })
    expect(selectedPersonaIndexFromStableId(database)).toBe(1)
  })

  it('repairs missing and duplicate ids deterministically without stealing later ids', () => {
    const database: Record<string, unknown> = {
      personas: [{ id: '' }, { id: 'persona-1' }, { id: 'duplicate' }, { id: 'duplicate' }, {}],
      selectedPersona: 3,
      selectedPersonaId: 'duplicate',
    }

    expect(repairPersonaSelectionIdentity(database)).toEqual({
      changed: true,
      selectedPersona: 3,
      selectedPersonaId: 'persona-4',
    })
    expect((database.personas as Array<{ id: string }>).map(({ id }) => id)).toEqual([
      'persona-1-2',
      'persona-1',
      'duplicate',
      'persona-4',
      'persona-5',
    ])

    const retry = structuredClone(database)
    expect(repairPersonaSelectionIdentity(retry).changed).toBe(false)
    expect(retry).toEqual(database)
  })

  it('falls back to the first record or null and makes strict projections fail closed', () => {
    const first: Record<string, unknown> = {
      personas: [{ id: 'persona-a' }, { id: 'persona-b' }],
      selectedPersona: 9,
      selectedPersonaId: 'missing',
    }
    expect(repairPersonaSelectionIdentity(first)).toMatchObject({
      selectedPersona: 0,
      selectedPersonaId: 'persona-a',
    })

    const empty: Record<string, unknown> = { personas: [], selectedPersona: 0 }
    expect(repairPersonaSelectionIdentity(empty)).toEqual({
      changed: true,
      selectedPersona: -1,
      selectedPersonaId: null,
    })

    expect(
      selectedPersonaIndexFromStableId({
        personas: [{ id: 'duplicate' }, { id: 'duplicate' }],
        selectedPersonaId: 'duplicate',
      }),
    ).toBe(-1)
  })
})
