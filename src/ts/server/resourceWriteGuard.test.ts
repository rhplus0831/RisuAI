import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { testDatabaseState } from '../__tests__/resourceDatabaseState'
import { setResourceWriteGuardEnabled, withTrustedResourceWrite } from './resourceWriteGuard.svelte'
import { seedCloneCostDb, withCloneInstrumentation } from '../__tests__/cloneCostHarness'

beforeEach(() => {
  setResourceWriteGuardEnabled(false)
  testDatabaseState.db = seedCloneCostDb() as any
})

afterEach(() => {
  setResourceWriteGuardEnabled(false)
  testDatabaseState.db = {} as any
})

describe('resource-backed write compatibility guard', () => {
  it('performs zero whole-Database clones for a guarded one-field write', () => {
    // Baseline size of the hydrated characters array (char-0 has a 40-message chat).
    const charactersSize = JSON.stringify(testDatabaseState.db.characters).length
    setResourceWriteGuardEnabled(true)

    const instrumented = withCloneInstrumentation(() =>
      withTrustedResourceWrite(() => {
        testDatabaseState.db.characters[0].name = 'Renamed'
      }),
    )

    // The old guard cloned the whole Database twice (entry structuredClone +
    // refreeze $state.snapshot). Copy-on-write does neither.
    expect(instrumented.structuredCloneCount).toBe(0)
    expect(instrumented.maxClonedSize).toBeLessThan(charactersSize)
    expect(testDatabaseState.db.characters[0].name).toBe('Renamed')
  })

  it('keeps testDatabaseState.db read-only after the write (out-of-guard writes throw)', () => {
    setResourceWriteGuardEnabled(true)

    withTrustedResourceWrite(() => {
      testDatabaseState.db.characters[0].name = 'Renamed'
    })

    expect(() => {
      testDatabaseState.db.characters[0].name = 'Direct'
    }).toThrow()
    expect(() => {
      testDatabaseState.db.characters.push({ chaId: 'x', name: 'x', chats: [] } as any)
    }).toThrow()
    expect(testDatabaseState.db.characters[0].name).toBe('Renamed')
  })

  it('keeps a stable testDatabaseState.db facade across scoped writes', () => {
    setResourceWriteGuardEnabled(true)

    const before = testDatabaseState.db
    withTrustedResourceWrite(() => {
      testDatabaseState.db.characters[0].name = 'One'
    })
    const afterFirst = testDatabaseState.db
    expect(afterFirst).toBe(before)

    withTrustedResourceWrite(() => {
      testDatabaseState.db.characters[0].name = 'Two'
    })
    expect(testDatabaseState.db).toBe(afterFirst)
    expect(testDatabaseState.db.characters[0].name).toBe('Two')
  })

  it('keeps a nested guarded write writable mid-scope and refreezes once at the outer exit', () => {
    setResourceWriteGuardEnabled(true)
    const before = testDatabaseState.db

    withTrustedResourceWrite(() => {
      testDatabaseState.db.characters[0].name = 'Outer'
      withTrustedResourceWrite(() => {
        testDatabaseState.db.characters[1].name = 'Inner'
      })
      // Still in the outer scope: the resource facade is not refrozen yet, so it is
      // writable and reflects both writes.
      testDatabaseState.db.characters[0].chats[0].note = 'still-writable'
      expect(testDatabaseState.db.characters[1].name).toBe('Inner')
    })

    expect(testDatabaseState.db).toBe(before)
    expect(testDatabaseState.db.characters[0].name).toBe('Outer')
    expect(testDatabaseState.db.characters[1].name).toBe('Inner')
    expect(testDatabaseState.db.characters[0].chats[0].note).toBe('still-writable')
    expect(() => {
      testDatabaseState.db.characters[0].name = 'Direct'
    }).toThrow()
  })

  it('preserves unrelated sibling rows and hydrated history across a guarded one-row write', () => {
    setResourceWriteGuardEnabled(true)

    withTrustedResourceWrite(() => {
      testDatabaseState.db.characters[0].name = 'Edited'
    })

    expect(testDatabaseState.db.characters[1].name).toBe('Character 1')
    expect(testDatabaseState.db.characters[0].chats[0].message).toHaveLength(40)
  })

  it('supports a full-resource replacement inside a guarded write (apply path)', () => {
    setResourceWriteGuardEnabled(true)
    const replacement = {
      characters: [{ chaId: 'fresh', name: 'Fresh', chats: [] }],
      loreBookPage: 3,
    }

    withTrustedResourceWrite(() => {
      // Mirrors setDatabaseLite's in-guard behavior: replace testDatabaseState.db wholesale.
      testDatabaseState.db = replacement as any
    })

    expect(testDatabaseState.db.characters).toHaveLength(1)
    expect(testDatabaseState.db.characters[0].chaId).toBe('fresh')
    expect((testDatabaseState.db as any).loreBookPage).toBe(3)
    expect(() => {
      testDatabaseState.db.characters[0].name = 'Direct'
    }).toThrow()
  })

  it('runs the guarded write source in place so the optimistic write is visible immediately', () => {
    setResourceWriteGuardEnabled(true)

    // The optimistic-write gap regression: a guarded write that reads back the
    // value it just set inside the same scope must see it.
    let observedInside = ''
    withTrustedResourceWrite(() => {
      testDatabaseState.db.characters[0].chats[0].scriptstate = { $score: '42' }
      observedInside = String(testDatabaseState.db.characters[0].chats[0].scriptstate.$score)
    })

    expect(observedInside).toBe('42')
    expect(testDatabaseState.db.characters[0].chats[0].scriptstate.$score).toBe('42')
  })

  it('unwraps read-only nested resource values assigned during trusted writes', () => {
    testDatabaseState.db.personas = [
      { id: 'persona-a', name: 'A', icon: '', personaPrompt: '', note: '' },
      { id: 'persona-b', name: 'B', icon: '', personaPrompt: '', note: '' },
    ]
    testDatabaseState.db.selectedPersona = 0
    setResourceWriteGuardEnabled(true)

    const reordered = [testDatabaseState.db.personas[1], testDatabaseState.db.personas[0]]

    withTrustedResourceWrite(() => {
      testDatabaseState.db.personas = reordered
      testDatabaseState.db.selectedPersona = 1
    })

    expect(testDatabaseState.db.personas.map((persona) => persona.id)).toEqual(['persona-b', 'persona-a'])
    expect(() => {
      withTrustedResourceWrite(() => {
        testDatabaseState.db.personas[0].id = 'persona-b-edited'
      })
    }).not.toThrow()
    expect(testDatabaseState.db.personas[0].id).toBe('persona-b-edited')
  })
})
