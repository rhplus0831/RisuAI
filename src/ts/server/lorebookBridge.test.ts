import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DBState, selectedCharID } from '../stores.svelte'
import { setServerProjectionWriteGuardEnabled } from './projectionWriteGuard.svelte'
import {
  currentGlobalLorebookStateSnapshot,
  restoreGlobalLorebookState,
  restoreScopedLorebookState,
  scopedLorebookStateSnapshot,
} from './lorebookBridge.svelte'
import {
  assertRollbackRestoresOnly,
  assertSnapshotOmitsCollections,
  seedCloneCostDb,
  withCloneInstrumentation,
} from '../__tests__/cloneCostHarness'

beforeEach(() => {
  setServerProjectionWriteGuardEnabled(false)
  selectedCharID.set(0)
  DBState.db = seedCloneCostDb() as any
  DBState.db.loreBook = [{ id: 'g1', name: 'Global', data: [{ key: 'k', content: 'c' }] }] as any
  DBState.db.loreBookPage = 0
})

afterEach(() => {
  setServerProjectionWriteGuardEnabled(false)
})

describe('Phase 0 global-lorebook snapshot kit', () => {
  it('captures only loreBook + page, never the characters or modules collections', () => {
    selectedCharID.set(1)

    const snapshot = currentGlobalLorebookStateSnapshot()

    expect(snapshot.loreBookPage).toBe(0)
    expect(snapshot.loreBook).toHaveLength(1)
    expect(snapshot.loreBook[0].name).toBe('Global')
    expect(snapshot.selectedCharID).toBe(1)
    expect(snapshot).not.toHaveProperty('characters')
    expect(snapshot).not.toHaveProperty('modules')
    assertSnapshotOmitsCollections(snapshot)

    const charactersSize = JSON.stringify(DBState.db.characters).length
    const instrumented = withCloneInstrumentation(() => currentGlobalLorebookStateSnapshot())
    expect(instrumented.maxClonedSize).toBeLessThan(charactersSize)
  })

  it('restores loreBook + page only, preserving concurrent character edits', () => {
    assertRollbackRestoresOnly({
      capture: () => currentGlobalLorebookStateSnapshot(),
      mutate: () => {
        DBState.db.loreBook = [
          { id: 'g1', name: 'Mutated', data: [] },
          { id: 'g2', name: 'New', data: [] },
        ] as any
        DBState.db.loreBookPage = 1
        // a concurrent, unrelated character edit a global-lore rollback must not wipe
        DBState.db.characters[0].name = 'Concurrent edit'
      },
      expectMutated: () => {
        expect(DBState.db.loreBook).toHaveLength(2)
      },
      restore: (snapshot) => restoreGlobalLorebookState(snapshot),
      expectRestored: () => {
        expect(DBState.db.loreBook).toHaveLength(1)
        expect(DBState.db.loreBook[0].name).toBe('Global')
        expect(DBState.db.loreBookPage).toBe(0)
      },
      expectUntouched: () => {
        // the heavy restoreLorebookState would have re-cloned the whole characters array
        expect(DBState.db.characters[0].name).toBe('Concurrent edit')
      },
    })
  })
})

describe('Phase 0 exported scoped-lorebook pair', () => {
  it('restores one character globalLore by scope key, leaving siblings untouched', () => {
    DBState.db.characters[1].globalLore = [{ key: 'sibling', content: 'sibling' }] as any
    const previous = JSON.stringify([{ key: 'orig', content: 'original' }])

    const snapshot = scopedLorebookStateSnapshot('character:char-0', previous)
    expect(snapshot.scopeKey).toBe('character:char-0')
    expect(snapshot).toMatchObject({ characters: [], modules: [], loreBook: [] })

    DBState.db.characters[0].globalLore = [{ key: 'changed', content: 'changed' }] as any
    restoreScopedLorebookState(snapshot)

    expect(DBState.db.characters[0].globalLore).toEqual([{ key: 'orig', content: 'original' }])
    expect(DBState.db.characters[1].globalLore).toEqual([{ key: 'sibling', content: 'sibling' }])
  })
})
