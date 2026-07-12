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
  currentLorebookCollectionScopedSnapshot,
  currentLorebookStateSnapshot,
  dispatchSelectGlobalLorebook,
  ensureGlobalLorebookListIds,
  globalLorebookListIdsNeedNormalization,
  markCharacterLorebookHydrated,
  resetLorebookHydration,
  restoreGlobalLorebookState,
  restoreLorebookState,
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

describe('Phase 3 discrete-editor scoped snapshot (L32)', () => {
  function seedDiscreteDb(): void {
    DBState.db = seedCloneCostDb() as any
    DBState.db.loreBook = [
      { name: 'Global', data: [{ key: 'g', content: 'G' }] }, // book id missing on purpose
    ] as any
    DBState.db.loreBookPage = 0
    // char-0: hydrated lore the editor edits; char-1: id-less sibling entries the
    // scoped ensure must NOT touch (the old whole-DB id-assign rewrote them all).
    DBState.db.characters[0].globalLore = [{ key: 'a', content: 'A' }] as any
    DBState.db.characters[1].globalLore = [{ key: 'sib', content: 'S' }] as any
    DBState.db.characters[1].chats[0].localLore = [{ key: 'sibchat', content: 'SC' }] as any
    resetLorebookHydration()
    markCharacterLorebookHydrated('char-0')
    markCharacterLorebookHydrated('char-1')
  }

  it('L32: a character-scoped editor snapshot never clones the characters or modules graph', () => {
    seedDiscreteDb()
    const charactersSize = JSON.stringify(DBState.db.characters).length

    const instrumented = withCloneInstrumentation(() =>
      currentLorebookCollectionScopedSnapshot({ kind: 'character', characterId: 'char-0' }),
    )

    expect(instrumented.maxClonedSize).toBeLessThan(charactersSize)
    expect(instrumented.result.scopeKey).toBe('character:char-0')
    // the scoped shape carries empty placeholders, never the live collections
    expect(instrumented.result).toMatchObject({ characters: [], modules: [], loreBook: [] })

    // contrast: the broad snapshot the editors used to take clones everything
    const broad = withCloneInstrumentation(() => currentLorebookStateSnapshot())
    expect(broad.maxClonedSize).toBeGreaterThanOrEqual(charactersSize)
  })

  it('L32: the scoped id-assign touches only the edited collection, not the whole DB', () => {
    seedDiscreteDb()

    currentLorebookCollectionScopedSnapshot({ kind: 'character', characterId: 'char-0' })

    // the edited collection got ids...
    for (const entry of DBState.db.characters[0].globalLore as any[]) {
      expect(typeof entry.id).toBe('string')
      expect(entry.id.length).toBeGreaterThan(0)
    }
    // ...while the sibling collections the whole-DB ensure used to rewrite stay untouched
    expect((DBState.db.characters[1].globalLore as any[])[0].id).toBeUndefined()
    expect((DBState.db.characters[1].chats[0].localLore as any[])[0].id).toBeUndefined()
    expect((DBState.db.loreBook as any[])[0].id).toBeUndefined()
  })

  it('L32: the scoped ensure never touches a non-hydrated character (no-data-loss guard)', () => {
    seedDiscreteDb()
    resetLorebookHydration() // char-0 is no longer marked hydrated

    currentLorebookCollectionScopedSnapshot({ kind: 'character', characterId: 'char-0' })

    // entries keep their id-less stub shape; nothing was assigned or defaulted
    expect((DBState.db.characters[0].globalLore as any[])[0].id).toBeUndefined()
  })

  it('L32: a failed discrete edit restores only the edited collection', () => {
    seedDiscreteDb()
    const previous = currentLorebookCollectionScopedSnapshot({
      kind: 'character',
      characterId: 'char-0',
    })

    // optimistic edit to the target + a concurrent, unrelated sibling edit
    DBState.db.characters[0].globalLore = [{ key: 'changed', content: 'changed' }] as any
    DBState.db.characters[1].globalLore = [{ key: 'concurrent', content: 'concurrent' }] as any

    restoreLorebookState(previous)

    expect((DBState.db.characters[0].globalLore as any[]).map((e) => e.key)).toEqual(['a'])
    expect((DBState.db.characters[1].globalLore as any[]).map((e) => e.key)).toEqual(['concurrent'])
  })

  it('L32: a chat-scoped editor snapshot restores only that chat localLore', () => {
    seedDiscreteDb()
    const previous = currentLorebookCollectionScopedSnapshot({ kind: 'chat', chatId: 'chat-0' })

    DBState.db.characters[0].chats[0].localLore = [{ key: 'changed', content: 'x' }] as any
    DBState.db.characters[1].chats[0].localLore = [{ key: 'sibchanged', content: 'y' }] as any

    restoreLorebookState(previous)

    expect((DBState.db.characters[0].chats[0].localLore as any[]).map((e) => e.key)).toEqual([])
    expect((DBState.db.characters[1].chats[0].localLore as any[]).map((e) => e.key)).toEqual(['sibchanged'])
  })

  it('L32: ensureGlobalLorebookListIds assigns ids on the global list only', () => {
    seedDiscreteDb()

    ensureGlobalLorebookListIds()

    const book = (DBState.db.loreBook as any[])[0]
    expect(typeof book.id).toBe('string')
    expect(typeof book.data[0].id).toBe('string')
    // the global-list ensure never reaches characters or chats
    expect((DBState.db.characters[1].globalLore as any[])[0].id).toBeUndefined()
    expect((DBState.db.characters[1].chats[0].localLore as any[])[0].id).toBeUndefined()
  })

  it('skips projection refreeze when global lorebook ids are already normalized', () => {
    DBState.db.loreBook = [{ id: 'book-1', name: 'Global', data: [{ id: 'entry-1', key: 'k', content: 'c' }] }] as any
    setServerProjectionWriteGuardEnabled(true)
    const before = DBState.db

    expect(globalLorebookListIdsNeedNormalization()).toBe(false)
    ensureGlobalLorebookListIds()

    expect(DBState.db).toBe(before)
  })

  it('normalizes missing global lorebook ids through the stable resource facade', () => {
    DBState.db.loreBook = [{ name: 'Global', data: [{ key: 'k', content: 'c' }] }] as any
    setServerProjectionWriteGuardEnabled(true)
    const before = DBState.db

    expect(globalLorebookListIdsNeedNormalization()).toBe(true)
    ensureGlobalLorebookListIds()

    expect(DBState.db).toBe(before)
    expect(globalLorebookListIdsNeedNormalization()).toBe(false)
    expect((DBState.db.loreBook as any[])[0].id).toEqual(expect.any(String))
    expect((DBState.db.loreBook as any[])[0].data[0].id).toEqual(expect.any(String))
  })

  it('L32: a global-scoped editor snapshot restores only the edited book entries', () => {
    seedDiscreteDb()
    ensureGlobalLorebookListIds()
    const bookId = (DBState.db.loreBook as any[])[0].id as string

    const previous = currentLorebookCollectionScopedSnapshot({ kind: 'global', lorebookId: bookId })

    ;(DBState.db.loreBook as any[])[0].data = [{ key: 'changed', content: 'x', id: 'n1' }]
    DBState.db.characters[0].globalLore = [{ key: 'concurrent', content: 'c' }] as any

    restoreLorebookState(previous)

    expect(((DBState.db.loreBook as any[])[0].data as any[]).map((e) => e.key)).toEqual(['g'])
    expect((DBState.db.characters[0].globalLore as any[]).map((e) => e.key)).toEqual(['concurrent'])
  })
})
