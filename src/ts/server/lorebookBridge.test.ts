import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../platform', async (importActual) => {
  const actual = await importActual<typeof import('../platform')>()
  return { ...actual, isFastifyServer: true }
})

vi.mock('../storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'lorebook-command-token',
}))

import { DBState, selectedCharID } from '../stores.svelte'
import { setServerProjectionWriteGuardEnabled } from './projectionWriteGuard.svelte'
import {
  currentGlobalLorebookStateSnapshot,
  dispatchSelectGlobalLorebook,
  restoreGlobalLorebookState,
  restoreScopedLorebookState,
  scopedLorebookStateSnapshot,
} from './lorebookBridge.svelte'
import { clearCachedServerCommandRevision } from './commands'
import {
  assertRollbackRestoresOnly,
  assertSnapshotOmitsCollections,
  seedCloneCostDb,
  withCloneInstrumentation,
} from '../__tests__/cloneCostHarness'

interface CapturedFetch {
  url: string
  method: string
  body: unknown
}

async function waitForCallCount(calls: CapturedFetch[], expected: number): Promise<void> {
  for (let attempt = 0; attempt < 20 && calls.length < expected; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  expect(calls).toHaveLength(expected)
}

beforeEach(() => {
  clearCachedServerCommandRevision()
  setServerProjectionWriteGuardEnabled(false)
  selectedCharID.set(0)
  DBState.db = seedCloneCostDb() as any
  DBState.db.loreBook = [{ id: 'g1', name: 'Global', data: [{ key: 'k', content: 'c' }] }] as any
  DBState.db.loreBookPage = 0
})

afterEach(() => {
  setServerProjectionWriteGuardEnabled(false)
  vi.unstubAllGlobals()
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

describe('Phase 2 global-lorebook scoped dispatch', () => {
  it('dispatchSelectGlobalLorebook restores only the lorebook pointer on failure', async () => {
    DBState.db.loreBook = [
      { id: 'g1', name: 'Global', data: [] },
      { id: 'g2', name: 'Second', data: [] },
    ] as any
    DBState.db.loreBookPage = 0

    const calls: CapturedFetch[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input)
        calls.push({
          url,
          method: init.method ?? 'GET',
          body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
        })
        if (url === '/api/v1/bootstrap') return new Response(JSON.stringify({ revision: 10 }))
        if (url === '/api/v1/commands/lorebooks/g2/select') {
          return new Response(JSON.stringify({ error: 'nope' }), { status: 500 })
        }
        return new Response(JSON.stringify({ error: `unexpected ${url}` }), { status: 404 })
      }) as unknown as typeof fetch,
    )

    const previous = currentGlobalLorebookStateSnapshot()
    // the snapshot must not carry the whole characters / modules collections
    assertSnapshotOmitsCollections(previous)

    // optimistic local select + a concurrent, unrelated character edit a whole-array
    // rollback would have wiped
    DBState.db.loreBookPage = 1
    DBState.db.characters[0].name = 'Concurrent edit'

    dispatchSelectGlobalLorebook('g2', previous)
    await waitForCallCount(calls, 2)

    // only the lorebook pointer is restored; the sibling character edit survives
    expect(DBState.db.loreBookPage).toBe(0)
    expect(DBState.db.characters[0].name).toBe('Concurrent edit')
  })
})
