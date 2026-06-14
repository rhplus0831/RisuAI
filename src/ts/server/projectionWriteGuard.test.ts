import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DBState } from '../stores.svelte'
import { setServerProjectionWriteGuardEnabled, withTrustedServerProjectionWrite } from './projectionWriteGuard.svelte'
import { seedCloneCostDb, withCloneInstrumentation } from '../__tests__/cloneCostHarness'

beforeEach(() => {
  setServerProjectionWriteGuardEnabled(false)
  DBState.db = seedCloneCostDb() as any
})

afterEach(() => {
  setServerProjectionWriteGuardEnabled(false)
  DBState.db = {} as any
})

describe('Phase 1 copy-on-write projection write guard', () => {
  it('performs zero whole-Database clones for a guarded one-field write', () => {
    // Baseline size of the hydrated characters array (char-0 has a 40-message chat).
    const charactersSize = JSON.stringify(DBState.db.characters).length
    setServerProjectionWriteGuardEnabled(true)

    const instrumented = withCloneInstrumentation(() =>
      withTrustedServerProjectionWrite(() => {
        DBState.db.characters[0].name = 'Renamed'
      }),
    )

    // The old guard cloned the whole Database twice (entry structuredClone +
    // refreeze $state.snapshot). Copy-on-write does neither.
    expect(instrumented.structuredCloneCount).toBe(0)
    expect(instrumented.maxClonedSize).toBeLessThan(charactersSize)
    expect(DBState.db.characters[0].name).toBe('Renamed')
  })

  it('keeps DBState.db read-only after the write (out-of-guard writes throw)', () => {
    setServerProjectionWriteGuardEnabled(true)

    withTrustedServerProjectionWrite(() => {
      DBState.db.characters[0].name = 'Renamed'
    })

    expect(() => {
      DBState.db.characters[0].name = 'Direct'
    }).toThrow()
    expect(() => {
      DBState.db.characters.push({ chaId: 'x', name: 'x', chats: [] } as any)
    }).toThrow()
    expect(DBState.db.characters[0].name).toBe('Renamed')
  })

  it('mints a fresh DBState.db identity per guarded write so dependent effects re-run', () => {
    setServerProjectionWriteGuardEnabled(true)

    const before = DBState.db
    withTrustedServerProjectionWrite(() => {
      DBState.db.characters[0].name = 'One'
    })
    const afterFirst = DBState.db
    expect(afterFirst).not.toBe(before)

    withTrustedServerProjectionWrite(() => {
      DBState.db.characters[0].name = 'Two'
    })
    expect(DBState.db).not.toBe(afterFirst)
    expect(DBState.db.characters[0].name).toBe('Two')
  })

  it('keeps a nested guarded write writable mid-scope and refreezes once at the outer exit', () => {
    setServerProjectionWriteGuardEnabled(true)
    const before = DBState.db

    withTrustedServerProjectionWrite(() => {
      DBState.db.characters[0].name = 'Outer'
      withTrustedServerProjectionWrite(() => {
        DBState.db.characters[1].name = 'Inner'
      })
      // Still in the outer scope: the projection is not refrozen yet, so it is
      // writable and reflects both writes.
      DBState.db.characters[0].chats[0].note = 'still-writable'
      expect(DBState.db.characters[1].name).toBe('Inner')
    })

    expect(DBState.db).not.toBe(before)
    expect(DBState.db.characters[0].name).toBe('Outer')
    expect(DBState.db.characters[1].name).toBe('Inner')
    expect(DBState.db.characters[0].chats[0].note).toBe('still-writable')
    expect(() => {
      DBState.db.characters[0].name = 'Direct'
    }).toThrow()
  })

  it('preserves unrelated sibling rows and hydrated history across a guarded one-row write', () => {
    setServerProjectionWriteGuardEnabled(true)

    withTrustedServerProjectionWrite(() => {
      DBState.db.characters[0].name = 'Edited'
    })

    expect(DBState.db.characters[1].name).toBe('Character 1')
    expect(DBState.db.characters[0].chats[0].message).toHaveLength(40)
  })

  it('supports a full-projection replacement inside a guarded write (apply path)', () => {
    setServerProjectionWriteGuardEnabled(true)
    const replacement = {
      characters: [{ chaId: 'fresh', name: 'Fresh', chats: [] }],
      loreBookPage: 3,
    }

    withTrustedServerProjectionWrite(() => {
      // Mirrors setDatabaseLite's in-guard behavior: replace DBState.db wholesale.
      DBState.db = replacement as any
    })

    expect(DBState.db.characters).toHaveLength(1)
    expect(DBState.db.characters[0].chaId).toBe('fresh')
    expect((DBState.db as any).loreBookPage).toBe(3)
    expect(() => {
      DBState.db.characters[0].name = 'Direct'
    }).toThrow()
  })

  it('runs the guarded write source in place so the optimistic write is visible immediately', () => {
    setServerProjectionWriteGuardEnabled(true)

    // The optimistic-write gap regression: a guarded write that reads back the
    // value it just set inside the same scope must see it.
    let observedInside = ''
    withTrustedServerProjectionWrite(() => {
      DBState.db.characters[0].chats[0].scriptstate = { $score: '42' }
      observedInside = String(DBState.db.characters[0].chats[0].scriptstate.$score)
    })

    expect(observedInside).toBe('42')
    expect(DBState.db.characters[0].chats[0].scriptstate.$score).toBe('42')
  })

  it('unwraps read-only nested projection values assigned during trusted writes', () => {
    DBState.db.personas = [
      { id: 'persona-a', name: 'A', icon: '', personaPrompt: '', note: '' },
      { id: 'persona-b', name: 'B', icon: '', personaPrompt: '', note: '' },
    ]
    DBState.db.selectedPersona = 0
    setServerProjectionWriteGuardEnabled(true)

    const reordered = [DBState.db.personas[1], DBState.db.personas[0]]

    withTrustedServerProjectionWrite(() => {
      DBState.db.personas = reordered
      DBState.db.selectedPersona = 1
    })

    expect(DBState.db.personas.map((persona) => persona.id)).toEqual(['persona-b', 'persona-a'])
    expect(() => {
      withTrustedServerProjectionWrite(() => {
        DBState.db.personas[0].id = 'persona-b-edited'
      })
    }).not.toThrow()
    expect(DBState.db.personas[0].id).toBe('persona-b-edited')
  })
})
