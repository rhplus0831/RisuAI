import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'

vi.mock('../platform', async (importActual) => {
  const actual = await importActual<typeof import('../platform')>()
  return { ...actual, isFastifyServer: true }
})

vi.mock('../storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'lorebook-command-token',
}))

import { selectedCharID } from '../stores.svelte'
import { getDatabase, setDatabaseLite } from '../storage/database.svelte'
import { setResourceWriteGuardEnabled } from './resourceWriteGuard.svelte'
import {
  applyLorebookEntryDraftEdit,
  currentGlobalLorebookStateSnapshot,
  currentLorebookCollectionScopedSnapshot,
  currentLorebookStateSnapshot,
  deleteGlobalLorebookById,
  dispatchCreateGlobalLorebook,
  dispatchSelectGlobalLorebook,
  dispatchUpdateGlobalLorebook,
  ensureGlobalLorebookListIds,
  globalLorebookListIdsNeedNormalization,
  markCharacterLorebookHydrated,
  replaceGlobalLorebookEntryCollection,
  resetServerBackedLorebookBridgeForTests,
  resetLorebookHydration,
  restoreGlobalLorebookState,
  restoreLorebookState,
  restoreScopedLorebookState,
  scopedLorebookStateSnapshot,
  selectGlobalLorebook,
} from './lorebookBridge.svelte'
import { GLOBAL_LOREBOOK_SELECTION_MUTATION_KEY, globalLorebookOwnerMutationKey } from './lorebookMutationKeys'
import { clearCachedServerCommandRevision, setCachedServerCommandRevision } from './commands'
import {
  beginPendingMutationDispatch,
  clearPendingMutationOutbox,
  listPendingMutations,
  preparePendingMutationOutbox,
  resetPendingMutationOutboxForTests,
} from './pendingMutationOutbox'
import { replayPendingMutations } from './pendingMutationReplay'
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

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

async function waitForCallCount(calls: CapturedFetch[], expected: number): Promise<void> {
  for (let attempt = 0; attempt < 20 && calls.length < expected; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  expect(calls).toHaveLength(expected)
}

beforeEach(() => {
  clearCachedServerCommandRevision()
  setResourceWriteGuardEnabled(false)
  selectedCharID.set(0)
  setDatabaseLite(seedCloneCostDb() as any)
  getDatabase().loreBook = [{ id: 'g1', name: 'Global', data: [{ key: 'k', content: 'c' }] }] as any
  getDatabase().loreBookPage = 0
})

afterEach(() => {
  resetServerBackedLorebookBridgeForTests()
  setResourceWriteGuardEnabled(false)
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

    const charactersSize = JSON.stringify(getDatabase().characters).length
    const instrumented = withCloneInstrumentation(() => currentGlobalLorebookStateSnapshot())
    expect(instrumented.maxClonedSize).toBeLessThan(charactersSize)
  })

  it('restores loreBook + page only, preserving concurrent character edits', () => {
    assertRollbackRestoresOnly({
      capture: () => currentGlobalLorebookStateSnapshot(),
      mutate: () => {
        getDatabase().loreBook = [
          { id: 'g1', name: 'Mutated', data: [] },
          { id: 'g2', name: 'New', data: [] },
        ] as any
        getDatabase().loreBookPage = 1
        // a concurrent, unrelated character edit a global-lore rollback must not wipe
        getDatabase().characters[0].name = 'Concurrent edit'
      },
      expectMutated: () => {
        expect(getDatabase().loreBook).toHaveLength(2)
      },
      restore: (snapshot) => restoreGlobalLorebookState(snapshot),
      expectRestored: () => {
        expect(getDatabase().loreBook).toHaveLength(1)
        expect(getDatabase().loreBook[0].name).toBe('Global')
        expect(getDatabase().loreBookPage).toBe(0)
      },
      expectUntouched: () => {
        // the heavy restoreLorebookState would have re-cloned the whole characters array
        expect(getDatabase().characters[0].name).toBe('Concurrent edit')
      },
    })
  })
})

describe('Phase 0 exported scoped-lorebook pair', () => {
  it('restores one character globalLore by scope key, leaving siblings untouched', () => {
    getDatabase().characters[1].globalLore = [{ key: 'sibling', content: 'sibling' }] as any
    const previous = JSON.stringify([{ key: 'orig', content: 'original' }])

    const snapshot = scopedLorebookStateSnapshot('character:char-0', previous)
    expect(snapshot.scopeKey).toBe('character:char-0')
    expect(snapshot).toMatchObject({ characters: [], modules: [], loreBook: [] })

    getDatabase().characters[0].globalLore = [{ key: 'changed', content: 'changed' }] as any
    restoreScopedLorebookState(snapshot)

    expect(getDatabase().characters[0].globalLore).toEqual([{ key: 'orig', content: 'original' }])
    expect(getDatabase().characters[1].globalLore).toEqual([{ key: 'sibling', content: 'sibling' }])
  })
})

describe('Phase 2 global-lorebook scoped dispatch', () => {
  it('dispatchSelectGlobalLorebook restores only the lorebook pointer on failure', async () => {
    getDatabase().loreBook = [
      { id: 'g1', name: 'Global', data: [] },
      { id: 'g2', name: 'Second', data: [] },
    ] as any
    getDatabase().loreBookPage = 0

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
    getDatabase().loreBookPage = 1
    getDatabase().characters[0].name = 'Concurrent edit'

    dispatchSelectGlobalLorebook('g2', previous)
    await waitForCallCount(calls, 2)

    // only the lorebook pointer is restored; the sibling character edit survives
    expect(getDatabase().loreBookPage).toBe(0)
    expect(getDatabase().characters[0].name).toBe('Concurrent edit')
  })
})

describe('Phase 3 discrete-editor scoped snapshot (L32)', () => {
  function seedDiscreteDb(): void {
    setDatabaseLite(seedCloneCostDb() as any)
    getDatabase().loreBook = [
      { name: 'Global', data: [{ key: 'g', content: 'G' }] }, // book id missing on purpose
    ] as any
    getDatabase().loreBookPage = 0
    // char-0: hydrated lore the editor edits; char-1: id-less sibling entries the
    // scoped ensure must NOT touch (the old whole-DB id-assign rewrote them all).
    getDatabase().characters[0].globalLore = [{ key: 'a', content: 'A' }] as any
    getDatabase().characters[1].globalLore = [{ key: 'sib', content: 'S' }] as any
    getDatabase().characters[1].chats[0].localLore = [{ key: 'sibchat', content: 'SC' }] as any
    resetLorebookHydration()
    markCharacterLorebookHydrated('char-0')
    markCharacterLorebookHydrated('char-1')
  }

  it('L32: a character-scoped editor snapshot never clones the characters or modules graph', () => {
    seedDiscreteDb()
    const charactersSize = JSON.stringify(getDatabase().characters).length

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
    for (const entry of getDatabase().characters[0].globalLore as any[]) {
      expect(typeof entry.id).toBe('string')
      expect(entry.id.length).toBeGreaterThan(0)
    }
    // ...while the sibling collections the whole-DB ensure used to rewrite stay untouched
    expect((getDatabase().characters[1].globalLore as any[])[0].id).toBeUndefined()
    expect((getDatabase().characters[1].chats[0].localLore as any[])[0].id).toBeUndefined()
    expect((getDatabase().loreBook as any[])[0].id).toBeUndefined()
  })

  it('L32: the scoped ensure never touches a non-hydrated character (no-data-loss guard)', () => {
    seedDiscreteDb()
    resetLorebookHydration() // char-0 is no longer marked hydrated

    currentLorebookCollectionScopedSnapshot({ kind: 'character', characterId: 'char-0' })

    // entries keep their id-less stub shape; nothing was assigned or defaulted
    expect((getDatabase().characters[0].globalLore as any[])[0].id).toBeUndefined()
  })

  it('L32: a failed discrete edit restores only the edited collection', () => {
    seedDiscreteDb()
    const previous = currentLorebookCollectionScopedSnapshot({
      kind: 'character',
      characterId: 'char-0',
    })

    // optimistic edit to the target + a concurrent, unrelated sibling edit
    getDatabase().characters[0].globalLore = [{ key: 'changed', content: 'changed' }] as any
    getDatabase().characters[1].globalLore = [{ key: 'concurrent', content: 'concurrent' }] as any

    restoreLorebookState(previous)

    expect((getDatabase().characters[0].globalLore as any[]).map((e) => e.key)).toEqual(['a'])
    expect((getDatabase().characters[1].globalLore as any[]).map((e) => e.key)).toEqual(['concurrent'])
  })

  it('L32: a chat-scoped editor snapshot restores only that chat localLore', () => {
    seedDiscreteDb()
    const previous = currentLorebookCollectionScopedSnapshot({ kind: 'chat', chatId: 'chat-0' })

    getDatabase().characters[0].chats[0].localLore = [{ key: 'changed', content: 'x' }] as any
    getDatabase().characters[1].chats[0].localLore = [{ key: 'sibchanged', content: 'y' }] as any

    restoreLorebookState(previous)

    expect((getDatabase().characters[0].chats[0].localLore as any[]).map((e) => e.key)).toEqual([])
    expect((getDatabase().characters[1].chats[0].localLore as any[]).map((e) => e.key)).toEqual(['sibchanged'])
  })

  it('L32: ensureGlobalLorebookListIds assigns ids on the global list only', () => {
    seedDiscreteDb()

    ensureGlobalLorebookListIds()

    const book = (getDatabase().loreBook as any[])[0]
    expect(typeof book.id).toBe('string')
    expect(typeof book.data[0].id).toBe('string')
    // the global-list ensure never reaches characters or chats
    expect((getDatabase().characters[1].globalLore as any[])[0].id).toBeUndefined()
    expect((getDatabase().characters[1].chats[0].localLore as any[])[0].id).toBeUndefined()
  })

  it('skips projection refreeze when global lorebook ids are already normalized', () => {
    getDatabase().loreBook = [
      { id: 'book-1', name: 'Global', data: [{ id: 'entry-1', key: 'k', content: 'c' }] },
    ] as any
    setResourceWriteGuardEnabled(true)
    const before = getDatabase()

    expect(globalLorebookListIdsNeedNormalization()).toBe(false)
    ensureGlobalLorebookListIds()

    expect(getDatabase()).toBe(before)
  })

  it('normalizes missing global lorebook ids through the stable resource facade', () => {
    getDatabase().loreBook = [{ name: 'Global', data: [{ key: 'k', content: 'c' }] }] as any
    setResourceWriteGuardEnabled(true)
    const before = getDatabase()

    expect(globalLorebookListIdsNeedNormalization()).toBe(true)
    ensureGlobalLorebookListIds()

    expect(getDatabase()).toBe(before)
    expect(globalLorebookListIdsNeedNormalization()).toBe(false)
    expect((getDatabase().loreBook as any[])[0].id).toEqual(expect.any(String))
    expect((getDatabase().loreBook as any[])[0].data[0].id).toEqual(expect.any(String))
  })

  it('L32: a global-scoped editor snapshot restores only the edited book entries', () => {
    seedDiscreteDb()
    ensureGlobalLorebookListIds()
    const bookId = (getDatabase().loreBook as any[])[0].id as string

    const previous = currentLorebookCollectionScopedSnapshot({ kind: 'global', lorebookId: bookId })

    ;(getDatabase().loreBook as any[])[0].data = [{ key: 'changed', content: 'x', id: 'n1' }]
    getDatabase().characters[0].globalLore = [{ key: 'concurrent', content: 'c' }] as any

    restoreLorebookState(previous)

    expect(((getDatabase().loreBook as any[])[0].data as any[]).map((e) => e.key)).toEqual(['g'])
    expect((getDatabase().characters[0].globalLore as any[]).map((e) => e.key)).toEqual(['concurrent'])
  })
})

describe('lorebook durable generation ordering', () => {
  it('keeps a marked entry edit ahead of the full-entry correction for a net revert', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-lorebook-marker',
      writerEpoch: 4,
      databaseLineage: 'lineage-lorebook-marker',
      requestedWriterWasActive: true,
    })
    const original = {
      id: 'entry-marker',
      key: 'marker',
      secondkey: '',
      insertorder: 100,
      comment: 'Marker entry',
      content: 'server baseline',
      mode: 'normal',
      alwaysActive: false,
      selective: false,
    }
    setDatabaseLite({
      characters: [],
      modules: [],
      loreBookPage: 0,
      loreBook: [{ id: 'book-marker', name: 'Marker book', data: [original] }],
    } as any)
    setCachedServerCommandRevision(30)
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: 'marked predecessor still offline' }), {
            status: 503,
            headers: { 'content-type': 'application/json' },
          }),
      ) as unknown as typeof fetch,
    )
    const scope = { kind: 'global', lorebookId: 'book-marker' } as const

    try {
      applyLorebookEntryDraftEdit(scope, 0, { ...original, content: 'marked stale edit' } as any, 10_000)
      let staged = await listPendingMutations()
      await vi.waitFor(async () => {
        staged = await listPendingMutations()
        expect(staged).toHaveLength(1)
      })
      await expect(beginPendingMutationDispatch(staged[0].handle)).resolves.toBe('persisted')

      applyLorebookEntryDraftEdit(scope, 0, original as any, 10_000)
      await vi.waitFor(async () => {
        staged = await listPendingMutations()
        expect(staged.map((entry) => entry.intent)).toEqual([
          {
            version: 1,
            dependencyKeys: [GLOBAL_LOREBOOK_SELECTION_MUTATION_KEY],
            requests: [
              {
                method: 'PUT',
                path: '/lorebooks/book-marker/entries/entry-marker',
                body: { patch: { content: 'marked stale edit' } },
              },
            ],
          },
          {
            version: 1,
            dependencyKeys: [GLOBAL_LOREBOOK_SELECTION_MUTATION_KEY],
            requests: [
              {
                method: 'PUT',
                path: '/lorebooks/book-marker/entries/entry-marker',
                body: { entry: original },
              },
            ],
          },
        ])
      })
      expect(staged[0].handle.mutationId).not.toBe(staged[1].handle.mutationId)
    } finally {
      resetServerBackedLorebookBridgeForTests()
      await Promise.resolve()
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
    }
  })

  it('retains the structural delta without sending it past a transient entry predecessor', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-lorebook-structural',
      writerEpoch: 5,
      databaseLineage: 'lineage-lorebook-structural',
      requestedWriterWasActive: true,
    })
    setCachedServerCommandRevision(40)
    const original = {
      id: 'entry-before-structure',
      key: 'before',
      secondkey: '',
      insertorder: 100,
      comment: 'Before structure',
      content: 'original content',
      mode: 'normal',
      alwaysActive: false,
      selective: false,
    }
    const added = {
      id: 'entry-inline-add',
      key: '',
      secondkey: '',
      insertorder: 100,
      comment: '',
      content: '',
      mode: 'normal',
      alwaysActive: true,
      selective: false,
      folder: 'folder-inline',
    }
    setDatabaseLite({
      characters: [],
      modules: [],
      loreBookPage: 0,
      loreBook: [{ id: 'book-structural', name: 'Structural book', data: [original] }],
    } as any)
    const calls: Array<{ url: string; body: unknown }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input)
        calls.push({
          url,
          body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
        })
        return new Response(JSON.stringify({ error: 'offline predecessor' }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        })
      }) as unknown as typeof fetch,
    )
    const scope = { kind: 'global', lorebookId: 'book-structural' } as const

    try {
      applyLorebookEntryDraftEdit(scope, 0, { ...original, content: 'edited before add' } as any, 10_000)
      expect(
        replaceGlobalLorebookEntryCollection(
          'book-structural',
          [{ ...original, content: 'edited before add' }, added] as any,
          0,
        ),
      ).toBe(true)

      const predecessorUrl = '/api/v1/commands/lorebooks/book-structural/entries/entry-before-structure'
      const structuralUrl = '/api/v1/commands/lorebooks/book-structural/entries/entry-inline-add'
      await vi.waitFor(() => {
        expect(calls.filter((call) => call.url === predecessorUrl)).toHaveLength(2)
      })
      expect(calls.some((call) => call.url === structuralUrl)).toBe(false)
      await vi.waitFor(async () => {
        expect((await listPendingMutations()).map((entry) => entry.intent)).toEqual([
          {
            version: 1,
            dependencyKeys: [GLOBAL_LOREBOOK_SELECTION_MUTATION_KEY],
            requests: [
              {
                method: 'PUT',
                path: '/lorebooks/book-structural/entries/entry-before-structure',
                body: { patch: { content: 'edited before add' } },
              },
            ],
          },
          {
            version: 1,
            dependencyKeys: [GLOBAL_LOREBOOK_SELECTION_MUTATION_KEY],
            requests: [
              {
                method: 'PUT',
                path: '/lorebooks/book-structural/entries/entry-inline-add',
                body: { entry: added },
              },
            ],
          },
        ])
      })
    } finally {
      resetServerBackedLorebookBridgeForTests()
      await Promise.resolve()
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
    }
  })

  it('keeps a marked create ahead of an immediate full-collection correction when the create is removed', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-lorebook-create-revert',
      writerEpoch: 6,
      databaseLineage: 'lineage-lorebook-create-revert',
      requestedWriterWasActive: true,
    })
    setCachedServerCommandRevision(50)
    const original = {
      id: 'entry-collection-baseline',
      key: 'baseline',
      content: 'baseline content',
    }
    const created = {
      id: 'entry-created-then-removed',
      key: 'temporary',
      content: 'temporary content',
    }
    setDatabaseLite({
      characters: [],
      modules: [],
      loreBookPage: 0,
      loreBook: [{ id: 'book-create-revert', name: 'Create revert book', data: [original] }],
    } as any)
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        calls.push(String(input))
        return new Response(JSON.stringify({ error: 'marked create still offline' }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        })
      }) as unknown as typeof fetch,
    )

    try {
      expect(replaceGlobalLorebookEntryCollection('book-create-revert', [original, created] as any, 10_000)).toBe(true)
      let staged = await listPendingMutations()
      await vi.waitFor(async () => {
        staged = await listPendingMutations()
        expect(staged).toHaveLength(1)
      })
      await expect(beginPendingMutationDispatch(staged[0].handle)).resolves.toBe('persisted')

      expect(replaceGlobalLorebookEntryCollection('book-create-revert', [original] as any, 10_000)).toBe(true)
      await vi.waitFor(async () => {
        staged = await listPendingMutations()
        expect(staged.map((entry) => entry.intent)).toEqual([
          {
            version: 1,
            dependencyKeys: [GLOBAL_LOREBOOK_SELECTION_MUTATION_KEY],
            requests: [
              {
                method: 'PUT',
                path: '/lorebooks/book-create-revert/entries/entry-created-then-removed',
                body: { entry: created },
              },
            ],
          },
          {
            version: 1,
            dependencyKeys: [GLOBAL_LOREBOOK_SELECTION_MUTATION_KEY],
            requests: [
              {
                method: 'PUT',
                path: '/lorebooks/book-create-revert/entries',
                body: { entries: [original] },
              },
            ],
          },
        ])
      })
      await vi.waitFor(() => {
        expect(
          calls.filter(
            (url) => url === '/api/v1/commands/lorebooks/book-create-revert/entries/entry-created-then-removed',
          ),
        ).toHaveLength(1)
      })
      expect(calls).not.toContain('/api/v1/commands/lorebooks/book-create-revert/entries')
    } finally {
      resetServerBackedLorebookBridgeForTests()
      await Promise.resolve()
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
    }
  })

  it('keeps a transient global entry edit ahead of its owner-ordered lorebook delete', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-global-lorebook-delete-order',
      writerEpoch: 7,
      databaseLineage: 'lineage-global-lorebook-delete-order',
      requestedWriterWasActive: true,
    })
    const original = {
      id: 'entry-before-book-delete',
      key: 'before delete',
      secondkey: '',
      insertorder: 100,
      comment: 'Before delete',
      content: 'original content',
      mode: 'normal',
      alwaysActive: false,
      selective: false,
    }
    setDatabaseLite({
      characters: [],
      modules: [],
      loreBookPage: 0,
      loreBook: [
        { id: 'book-delete-order', name: 'Delete order', data: [original] },
        { id: 'book-delete-sibling', name: 'Sibling', data: [] },
      ],
    } as any)
    setCachedServerCommandRevision(60)
    let recover = false
    let revision = 60
    const calls: CapturedFetch[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input)
        const method = init.method ?? 'GET'
        if (url === '/api/v1/commands/mutation-receipts/ack') {
          return new Response(JSON.stringify({ acknowledged: true }), {
            headers: { 'content-type': 'application/json' },
          })
        }
        calls.push({
          url,
          method,
          body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
        })
        if (!recover) {
          return new Response(JSON.stringify({ error: 'global lorebook owner offline' }), {
            status: 503,
            headers: { 'content-type': 'application/json' },
          })
        }
        revision += 1
        if (method === 'PUT') {
          return new Response(
            JSON.stringify({
              revision,
              event: {
                type: 'lorebook.entries.replaced',
                revision,
                resource: 'globalLorebook',
                id: 'book-delete-order',
              },
              lorebookId: 'book-delete-order',
              entryId: original.id,
              entryIndex: 0,
              created: false,
              patchedKeys: ['content'],
              deletedKeys: [],
            }),
            { headers: { 'content-type': 'application/json' } },
          )
        }
        return new Response(
          JSON.stringify({
            revision,
            event: {
              type: 'lorebook.deleted',
              revision,
              resource: 'globalLorebook',
              id: 'book-delete-order',
            },
            lorebookId: 'book-delete-order',
          }),
          { headers: { 'content-type': 'application/json' } },
        )
      }) as unknown as typeof fetch,
    )

    try {
      const scope = { kind: 'global', lorebookId: 'book-delete-order' } as const
      expect(
        applyLorebookEntryDraftEdit(scope, 0, { ...original, content: 'latest content before delete' } as any, 10_000),
      ).toBe(true)
      expect(deleteGlobalLorebookById('book-delete-order')).toBe(true)

      await vi.waitFor(() => {
        expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(2)
      })
      expect(calls.some((call) => call.method === 'DELETE')).toBe(false)
      expect(
        (await listPendingMutations()).map((entry) => ({ key: entry.handle.key, request: entry.intent.requests[0] })),
      ).toEqual([
        {
          key: globalLorebookOwnerMutationKey('book-delete-order'),
          request: {
            method: 'PUT',
            path: '/lorebooks/book-delete-order/entries/entry-before-book-delete',
            body: { patch: { content: 'latest content before delete' } },
          },
        },
        {
          key: GLOBAL_LOREBOOK_SELECTION_MUTATION_KEY,
          request: {
            method: 'DELETE',
            path: '/lorebooks/book-delete-order',
            body: {},
          },
        },
      ])

      recover = true
      const recoveryStart = calls.length
      await expect(replayPendingMutations()).resolves.toMatchObject({ succeeded: 2 })
      expect(calls.slice(recoveryStart).map((call) => `${call.method} ${call.url}`)).toEqual([
        'PUT /api/v1/commands/lorebooks/book-delete-order/entries/entry-before-book-delete',
        'DELETE /api/v1/commands/lorebooks/book-delete-order',
      ])
      expect(await listPendingMutations()).toEqual([])
    } finally {
      resetServerBackedLorebookBridgeForTests()
      await Promise.resolve()
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
    }
  })

  it('restores the latest edited global lorebook row, siblings, and page after delete failure', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-global-lorebook-delete-rollback',
      writerEpoch: 8,
      databaseLineage: 'lineage-global-lorebook-delete-rollback',
      requestedWriterWasActive: true,
    })
    const original = {
      id: 'entry-delete-rollback',
      key: 'rollback',
      content: 'original content',
    }
    setDatabaseLite({
      characters: [],
      modules: [],
      loreBookPage: 1,
      loreBook: [
        { id: 'book-rollback-sibling', name: 'Sibling latest', data: [] },
        { id: 'book-delete-rollback', name: 'Delete rollback', data: [original] },
        { id: 'book-rollback-later', name: 'Later latest', data: [] },
      ],
    } as any)
    setCachedServerCommandRevision(70)
    const calls: CapturedFetch[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input)
        const method = init.method ?? 'GET'
        if (url === '/api/v1/commands/mutation-receipts/ack') {
          return new Response(JSON.stringify({ acknowledged: true }), {
            headers: { 'content-type': 'application/json' },
          })
        }
        calls.push({
          url,
          method,
          body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
        })
        if (method === 'DELETE') {
          return new Response(JSON.stringify({ error: 'forced global lorebook delete failure' }), {
            status: 500,
            headers: { 'content-type': 'application/json' },
          })
        }
        return new Response(
          JSON.stringify({
            revision: 71,
            event: {
              type: 'lorebook.entries.replaced',
              revision: 71,
              resource: 'globalLorebook',
              id: 'book-delete-rollback',
            },
            lorebookId: 'book-delete-rollback',
            entryId: original.id,
            entryIndex: 0,
            created: false,
            patchedKeys: ['content'],
            deletedKeys: [],
          }),
          { headers: { 'content-type': 'application/json' } },
        )
      }) as unknown as typeof fetch,
    )

    try {
      expect(
        applyLorebookEntryDraftEdit(
          { kind: 'global', lorebookId: 'book-delete-rollback' },
          0,
          { ...original, content: 'latest edited content' } as any,
          10_000,
        ),
      ).toBe(true)
      expect(deleteGlobalLorebookById('book-delete-rollback')).toBe(true)
      expect((getDatabase().loreBook as any[]).map((book) => book.id)).toEqual([
        'book-rollback-sibling',
        'book-rollback-later',
      ])
      expect(getDatabase().loreBookPage).toBe(0)

      await vi.waitFor(() => {
        expect(calls.map((call) => call.method)).toEqual(['PUT', 'DELETE'])
        expect((getDatabase().loreBook as any[]).map((book) => book.id)).toEqual([
          'book-rollback-sibling',
          'book-delete-rollback',
          'book-rollback-later',
        ])
      })
      expect((getDatabase().loreBook as any[])[1].data[0].content).toBe('latest edited content')
      expect((getDatabase().loreBook as any[])[0].name).toBe('Sibling latest')
      expect((getDatabase().loreBook as any[])[2].name).toBe('Later latest')
      expect(getDatabase().loreBookPage).toBe(1)
      expect((await listPendingMutations()).map((entry) => entry.intent.requests[0]?.method)).toEqual(['DELETE'])
    } finally {
      resetServerBackedLorebookBridgeForTests()
      await Promise.resolve()
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
    }
  })

  it('reloads and replays a durable global lorebook delete', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    const scope = {
      writerSessionId: 'writer-global-lorebook-delete-reload',
      writerEpoch: 9,
      databaseLineage: 'lineage-global-lorebook-delete-reload',
      requestedWriterWasActive: true,
    }
    await preparePendingMutationOutbox(scope)
    setDatabaseLite({
      characters: [],
      modules: [],
      loreBookPage: 0,
      loreBook: [
        { id: 'book-delete-reload', name: 'Reload delete', data: [] },
        { id: 'book-reload-sibling', name: 'Sibling', data: [] },
      ],
    } as any)
    setCachedServerCommandRevision(80)
    let recover = false
    const calls: CapturedFetch[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input)
        if (url === '/api/v1/commands/mutation-receipts/ack') {
          return new Response(JSON.stringify({ acknowledged: true }), {
            headers: { 'content-type': 'application/json' },
          })
        }
        calls.push({
          url,
          method: init.method ?? 'GET',
          body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
        })
        if (!recover) {
          return new Response(JSON.stringify({ error: 'offline before reload' }), {
            status: 503,
            headers: { 'content-type': 'application/json' },
          })
        }
        return new Response(
          JSON.stringify({
            revision: 81,
            event: {
              type: 'lorebook.deleted',
              revision: 81,
              resource: 'globalLorebook',
              id: 'book-delete-reload',
            },
            lorebookId: 'book-delete-reload',
          }),
          { headers: { 'content-type': 'application/json' } },
        )
      }) as unknown as typeof fetch,
    )

    try {
      expect(deleteGlobalLorebookById('book-delete-reload')).toBe(true)
      await waitForCallCount(calls, 1)
      expect((await listPendingMutations()).map((entry) => entry.intent.requests[0])).toEqual([
        {
          method: 'DELETE',
          path: '/lorebooks/book-delete-reload',
          body: {},
        },
      ])

      resetPendingMutationOutboxForTests()
      await preparePendingMutationOutbox(scope)
      expect((await listPendingMutations()).map((entry) => entry.handle.key)).toEqual([
        GLOBAL_LOREBOOK_SELECTION_MUTATION_KEY,
      ])

      recover = true
      const replayStart = calls.length
      await expect(replayPendingMutations()).resolves.toMatchObject({ succeeded: 1 })
      expect(calls.slice(replayStart).map((call) => `${call.method} ${call.url}`)).toEqual([
        'DELETE /api/v1/commands/lorebooks/book-delete-reload',
      ])
      expect(await listPendingMutations()).toEqual([])
    } finally {
      resetServerBackedLorebookBridgeForTests()
      await Promise.resolve()
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
    }
  })

  it('keeps a new lorebook rename and selection behind its transient create', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-global-lorebook-create-followups',
      writerEpoch: 10,
      databaseLineage: 'lineage-global-lorebook-create-followups',
      requestedWriterWasActive: true,
    })
    setDatabaseLite({
      characters: [],
      modules: [],
      loreBookPage: 0,
      loreBook: [{ id: 'book-existing', name: 'Existing', data: [] }],
    } as any)
    setCachedServerCommandRevision(90)

    const firstCreate = deferred<Response>()
    let recover = false
    let revision = 90
    const calls: CapturedFetch[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input)
        if (url === '/api/v1/commands/mutation-receipts/ack') {
          return new Response(JSON.stringify({ acknowledged: true }), {
            headers: { 'content-type': 'application/json' },
          })
        }
        const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
        calls.push({ url, method: init.method ?? 'GET', body })
        if (calls.length === 1) return firstCreate.promise
        if (!recover) {
          return new Response(JSON.stringify({ error: 'temporarily unavailable' }), {
            status: 503,
            headers: { 'content-type': 'application/json' },
          })
        }

        revision += 1
        if (url === '/api/v1/commands/lorebooks' && init.method === 'POST') {
          return new Response(
            JSON.stringify({
              revision,
              event: {
                type: 'lorebook.created',
                revision,
                resource: 'globalLorebook',
                id: 'book-new',
              },
              lorebookId: 'book-new',
            }),
            { headers: { 'content-type': 'application/json' } },
          )
        }
        if (url === '/api/v1/commands/lorebooks/book-new' && init.method === 'PATCH') {
          return new Response(
            JSON.stringify({
              revision,
              event: {
                type: 'lorebook.updated',
                revision,
                resource: 'globalLorebook',
                id: 'book-new',
              },
              lorebookId: 'book-new',
            }),
            { headers: { 'content-type': 'application/json' } },
          )
        }
        if (url === '/api/v1/commands/lorebooks/book-new/select') {
          return new Response(
            JSON.stringify({
              revision,
              event: {
                type: 'lorebook.selected',
                revision,
                resource: 'globalLorebook',
                id: 'book-new',
              },
              selectedLorebookId: 'book-new',
            }),
            { headers: { 'content-type': 'application/json' } },
          )
        }
        return new Response(JSON.stringify({ error: `unexpected ${url}` }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        })
      }) as unknown as typeof fetch,
    )

    const created = { id: 'book-new', name: 'New', data: [] }
    try {
      const beforeCreate = currentGlobalLorebookStateSnapshot()
      getDatabase().loreBook.push(created as any)
      dispatchCreateGlobalLorebook(created, beforeCreate)
      await waitForCallCount(calls, 1)

      const beforeRename = currentLorebookStateSnapshot()
      created.name = 'Renamed before recovery'
      dispatchUpdateGlobalLorebook('book-new', { name: created.name }, beforeRename)
      expect(selectGlobalLorebook(1)).toBe(true)
      firstCreate.resolve(
        new Response(JSON.stringify({ error: 'temporarily unavailable' }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        }),
      )

      await vi.waitFor(async () => expect(await listPendingMutations()).toHaveLength(3))
      const retained = await listPendingMutations()
      expect(retained.map((entry) => entry.handle.key)).toEqual([
        globalLorebookOwnerMutationKey('book-new'),
        globalLorebookOwnerMutationKey('book-new'),
        GLOBAL_LOREBOOK_SELECTION_MUTATION_KEY,
      ])
      expect(retained[2].intent.dependencyKeys).toEqual([globalLorebookOwnerMutationKey('book-new')])
      expect(calls.some((call) => call.url.endsWith('/book-new/select'))).toBe(false)
      expect(calls.some((call) => call.method === 'PATCH')).toBe(false)

      recover = true
      const recoveryStart = calls.length
      await expect(replayPendingMutations()).resolves.toMatchObject({ succeeded: 3 })
      expect(calls.slice(recoveryStart).map((call) => `${call.method} ${call.url}`)).toEqual([
        'POST /api/v1/commands/lorebooks',
        'PATCH /api/v1/commands/lorebooks/book-new',
        'POST /api/v1/commands/lorebooks/book-new/select',
      ])
      expect(await listPendingMutations()).toEqual([])
    } finally {
      firstCreate.resolve(
        new Response(JSON.stringify({ error: 'temporarily unavailable' }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        }),
      )
      resetServerBackedLorebookBridgeForTests()
      await Promise.resolve()
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
    }
  })

  it('does not let a restored lorebook rename overtake its retained delete', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-global-lorebook-delete-rename',
      writerEpoch: 11,
      databaseLineage: 'lineage-global-lorebook-delete-rename',
      requestedWriterWasActive: true,
    })
    setDatabaseLite({
      characters: [],
      modules: [],
      loreBookPage: 0,
      loreBook: [
        { id: 'book-delete-rename', name: 'Delete then rename', data: [] },
        { id: 'book-delete-rename-fallback', name: 'Fallback', data: [] },
      ],
    } as any)
    setCachedServerCommandRevision(100)

    let recover = false
    let revision = 100
    const calls: CapturedFetch[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input)
        if (url === '/api/v1/commands/mutation-receipts/ack') {
          return new Response(JSON.stringify({ acknowledged: true }), {
            headers: { 'content-type': 'application/json' },
          })
        }
        calls.push({
          url,
          method: init.method ?? 'GET',
          body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
        })
        if (!recover) {
          if (init.method === 'PATCH') throw new Error('rename overtook retained lorebook delete')
          return new Response(JSON.stringify({ error: 'temporarily unavailable' }), {
            status: 503,
            headers: { 'content-type': 'application/json' },
          })
        }
        revision += 1
        if (init.method === 'DELETE') {
          return new Response(
            JSON.stringify({
              revision,
              event: {
                type: 'lorebook.deleted',
                revision,
                resource: 'globalLorebook',
                id: 'book-delete-rename',
              },
              lorebookId: 'book-delete-rename',
            }),
            { headers: { 'content-type': 'application/json' } },
          )
        }
        return new Response(JSON.stringify({ error: 'lorebook no longer exists' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        })
      }) as unknown as typeof fetch,
    )

    try {
      expect(deleteGlobalLorebookById('book-delete-rename')).toBe(true)
      await waitForCallCount(calls, 1)
      await vi.waitFor(() =>
        expect((getDatabase().loreBook as any[]).some((book) => book.id === 'book-delete-rename')).toBe(true),
      )

      const previous = currentLorebookStateSnapshot()
      const restored = (getDatabase().loreBook as any[]).find((book) => book.id === 'book-delete-rename')
      restored.name = 'Rename after rollback'
      dispatchUpdateGlobalLorebook('book-delete-rename', { name: restored.name }, previous)

      await waitForCallCount(calls, 2)
      expect(calls.map((call) => call.method)).toEqual(['DELETE', 'DELETE'])
      const retained = await listPendingMutations()
      expect(retained.map((entry) => entry.handle.key)).toEqual([
        GLOBAL_LOREBOOK_SELECTION_MUTATION_KEY,
        globalLorebookOwnerMutationKey('book-delete-rename'),
      ])
      expect(retained[1].intent.dependencyKeys).toEqual([GLOBAL_LOREBOOK_SELECTION_MUTATION_KEY])

      recover = true
      const recoveryStart = calls.length
      await expect(replayPendingMutations()).resolves.toMatchObject({ succeeded: 1, discarded: 1 })
      expect(calls.slice(recoveryStart).map((call) => `${call.method} ${call.url}`)).toEqual([
        'DELETE /api/v1/commands/lorebooks/book-delete-rename',
        'PATCH /api/v1/commands/lorebooks/book-delete-rename',
      ])
      expect((getDatabase().loreBook as any[]).map((book) => book.id)).not.toContain('book-delete-rename')
      expect(await listPendingMutations()).toEqual([])
    } finally {
      resetServerBackedLorebookBridgeForTests()
      await Promise.resolve()
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
    }
  })

  it('replays a retained lorebook delete before a newer explicit selection', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-global-lorebook-selection-order',
      writerEpoch: 10,
      databaseLineage: 'lineage-global-lorebook-selection-order',
      requestedWriterWasActive: true,
    })
    setDatabaseLite({
      characters: [],
      modules: [],
      loreBookPage: 0,
      loreBook: [
        { id: 'book-delete-a', name: 'Delete A', data: [] },
        { id: 'book-b', name: 'Book B', data: [] },
        { id: 'book-select-c', name: 'Select C', data: [] },
      ],
    } as any)
    setCachedServerCommandRevision(90)

    let recover = false
    let revision = 90
    let serverSelectedLorebookId = 'book-delete-a'
    const calls: CapturedFetch[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input)
        if (url === '/api/v1/commands/mutation-receipts/ack') {
          return new Response(JSON.stringify({ acknowledged: true }), {
            headers: { 'content-type': 'application/json' },
          })
        }
        calls.push({
          url,
          method: init.method ?? 'GET',
          body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
        })
        if (!recover) {
          return new Response(JSON.stringify({ error: 'temporarily unavailable' }), {
            status: 503,
            headers: { 'content-type': 'application/json' },
          })
        }

        revision += 1
        if (url.endsWith('/lorebooks/book-delete-a')) {
          serverSelectedLorebookId = 'book-b'
          return new Response(
            JSON.stringify({
              revision,
              event: {
                type: 'lorebook.deleted',
                revision,
                resource: 'globalLorebook',
                id: 'book-delete-a',
              },
              lorebookId: 'book-delete-a',
            }),
            { headers: { 'content-type': 'application/json' } },
          )
        }
        if (url.endsWith('/lorebooks/book-select-c/select')) {
          serverSelectedLorebookId = 'book-select-c'
          return new Response(
            JSON.stringify({
              revision,
              event: {
                type: 'lorebook.selected',
                revision,
                resource: 'globalLorebook',
                id: 'book-select-c',
              },
              selectedLorebookId: 'book-select-c',
            }),
            { headers: { 'content-type': 'application/json' } },
          )
        }
        return new Response(JSON.stringify({ error: `unexpected ${url}` }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        })
      }) as unknown as typeof fetch,
    )

    try {
      expect(deleteGlobalLorebookById('book-delete-a')).toBe(true)
      await waitForCallCount(calls, 1)
      await vi.waitFor(() =>
        expect((getDatabase().loreBook as any[]).map((book) => book.id)).toContain('book-delete-a'),
      )

      const selectIndex = (getDatabase().loreBook as any[]).findIndex((book) => book.id === 'book-select-c')
      expect(selectGlobalLorebook(selectIndex)).toBe(true)
      await waitForCallCount(calls, 2)
      expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
        'DELETE /api/v1/commands/lorebooks/book-delete-a',
        'DELETE /api/v1/commands/lorebooks/book-delete-a',
      ])
      expect((getDatabase().loreBook as any[])[getDatabase().loreBookPage]?.id).toBe('book-select-c')

      expect(
        (await listPendingMutations()).map((entry) => ({
          key: entry.handle.key,
          dependencies: entry.intent.dependencyKeys ?? [],
          request: entry.intent.requests[0],
        })),
      ).toEqual([
        {
          key: GLOBAL_LOREBOOK_SELECTION_MUTATION_KEY,
          dependencies: [globalLorebookOwnerMutationKey('book-delete-a')],
          request: {
            method: 'DELETE',
            path: '/lorebooks/book-delete-a',
            body: {},
          },
        },
        {
          key: GLOBAL_LOREBOOK_SELECTION_MUTATION_KEY,
          dependencies: [globalLorebookOwnerMutationKey('book-select-c')],
          request: {
            method: 'POST',
            path: '/lorebooks/book-select-c/select',
            body: {},
          },
        },
      ])

      recover = true
      const recoveryStart = calls.length
      await expect(replayPendingMutations()).resolves.toMatchObject({ succeeded: 2 })
      expect(calls.slice(recoveryStart).map((call) => `${call.method} ${call.url}`)).toEqual([
        'DELETE /api/v1/commands/lorebooks/book-delete-a',
        'POST /api/v1/commands/lorebooks/book-select-c/select',
      ])
      expect(serverSelectedLorebookId).toBe('book-select-c')
      expect((getDatabase().loreBook as any[]).map((book) => book.id)).not.toContain('book-delete-a')
      expect((getDatabase().loreBook as any[])[getDatabase().loreBookPage]?.id).toBe('book-select-c')
      expect(await listPendingMutations()).toEqual([])
    } finally {
      resetServerBackedLorebookBridgeForTests()
      await Promise.resolve()
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
    }
  })
})
