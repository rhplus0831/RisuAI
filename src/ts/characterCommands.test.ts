import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./platform', async (importActual) => {
  const actual = await importActual<typeof import('./platform')>()
  return {
    ...actual,
    isFastifyServer: true,
  }
})

vi.mock('./storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'character-command-token',
}))

import {
  currentCharacterRowSnapshot,
  currentCharacterSelectionSnapshot,
  currentCharacterStateSnapshot,
  restoreCharacterRow,
  setCharacterSupaMemory,
} from './characterCommands'
import { clearCachedServerCommandRevision } from './server/commands'
import { setServerProjectionWriteGuardEnabled } from './server/projectionWriteGuard.svelte'
import { DBState, selectedCharID } from './stores.svelte'
import {
  assertRollbackRestoresOnly,
  assertSnapshotIsScalar,
  assertSnapshotOmitsCollections,
  seedCloneCostDb,
  withCloneInstrumentation,
} from './__tests__/cloneCostHarness'

interface CapturedFetch {
  url: string
  method: string
  authHeader: string | null
  body: unknown
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function stubCommandFetch(): CapturedFetch[] {
  const calls: CapturedFetch[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const headers = init.headers as Record<string, string> | undefined
      const url = String(input)
      calls.push({
        url,
        method: init.method ?? 'GET',
        authHeader: headers?.['risu-auth'] ?? null,
        body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
      })

      if (url === '/api/v1/bootstrap') return jsonResponse({ revision: 10 })
      if (url === '/api/v1/commands/characters/char-a') {
        return jsonResponse({
          revision: 11,
          event: { type: 'character.updated', revision: 11, resource: 'character' },
        })
      }
      return jsonResponse({ error: `unexpected ${url}` }, 404)
    }) as unknown as typeof fetch,
  )
  return calls
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
  DBState.db = {
    characters: [{ chaId: 'char-a', name: 'Character', chats: [], supaMemory: false }],
    characterOrder: [],
  } as any
})

afterEach(() => {
  setServerProjectionWriteGuardEnabled(false)
  vi.unstubAllGlobals()
})

describe('character command projection helpers', () => {
  it('routes supa memory toggles through a character command under the projection guard', async () => {
    const calls = stubCommandFetch()
    setServerProjectionWriteGuardEnabled(true)

    expect(() => {
      DBState.db.characters[0].supaMemory = true
    }).toThrow()

    setCharacterSupaMemory('char-a', true)

    expect(DBState.db.characters[0].supaMemory).toBe(false)

    await waitForCallCount(calls, 2)
    expect(calls).toEqual([
      {
        url: '/api/v1/bootstrap',
        method: 'GET',
        authHeader: 'character-command-token',
        body: null,
      },
      {
        url: '/api/v1/commands/characters/char-a',
        method: 'PATCH',
        authHeader: 'character-command-token',
        body: {
          baseRevision: 10,
          patch: { supaMemory: true },
        },
      },
    ])
  })
})

describe('Phase 0 character-row snapshot kit', () => {
  it('captures one character row plus selection scalars, never the whole array', () => {
    DBState.db = seedCloneCostDb() as any
    selectedCharID.set(2)

    const snapshot = currentCharacterRowSnapshot(1)

    expect(snapshot.characterId).toBe('char-1')
    expect(snapshot.index).toBe(1)
    expect(snapshot.character?.chaId).toBe('char-1')
    expect(snapshot.currentChar).toBe(0)
    expect(snapshot.selectedCharID).toBe(2)
    expect(snapshot).not.toHaveProperty('characters')
    expect(Array.isArray((snapshot as { character?: unknown }).character)).toBe(false)
    assertSnapshotOmitsCollections(snapshot)

    const charactersSize = JSON.stringify(DBState.db.characters).length
    const instrumented = withCloneInstrumentation(() => currentCharacterRowSnapshot(1))
    expect(instrumented.maxClonedSize).toBeLessThan(charactersSize)
  })

  it('restores only the targeted row and preserves concurrent edits to siblings', () => {
    DBState.db = seedCloneCostDb() as any
    selectedCharID.set(1)

    assertRollbackRestoresOnly({
      capture: () => currentCharacterRowSnapshot(1),
      mutate: () => {
        // optimistic edit to the targeted row that the failing command will undo
        DBState.db.characters[1].name = 'Optimistic'
        // a concurrent, unrelated edit to a sibling row
        DBState.db.characters[0].name = 'Concurrent sibling edit'
      },
      expectMutated: () => {
        expect(DBState.db.characters[1].name).toBe('Optimistic')
      },
      restore: (snapshot) => restoreCharacterRow(snapshot),
      expectRestored: () => {
        expect(DBState.db.characters[1].name).toBe('Character 1')
      },
      expectUntouched: () => {
        // a full-array restore would have wiped the sibling's concurrent edit
        expect(DBState.db.characters[0].name).toBe('Concurrent sibling edit')
      },
    })
  })

  it('restores the row by stable id even when its index has shifted', () => {
    DBState.db = seedCloneCostDb() as any
    selectedCharID.set(0)
    const snapshot = currentCharacterRowSnapshot(1)

    // Simulate a reorder/insert before the captured index so the row moves from
    // index 1 to index 2.
    DBState.db.characters[1].name = 'Optimistic'
    DBState.db.characters.unshift({ chaId: 'char-new', name: 'Inserted', chats: [] } as any)
    expect(DBState.db.characters[2].chaId).toBe('char-1')

    restoreCharacterRow(snapshot)

    // char-1 is restored at its new id-located index, not at the stale index 1.
    expect(DBState.db.characters.find((c: any) => c.chaId === 'char-1')?.name).toBe('Character 1')
    // the stale captured index (1) now holds char-0 and must be left untouched.
    expect(DBState.db.characters[1].chaId).toBe('char-0')
    expect(DBState.db.characters[1].name).toBe('Character 0')
  })

  it('sanity baseline: the selection snapshot performs zero whole-characters clones, the legacy snapshot performs one', () => {
    DBState.db = seedCloneCostDb() as any
    selectedCharID.set(0)
    const charactersSize = JSON.stringify(DBState.db.characters).length

    const selection = withCloneInstrumentation(() => currentCharacterSelectionSnapshot('char-0'))
    expect(selection.maxClonedSize).toBeLessThan(charactersSize)
    assertSnapshotIsScalar(selection.result)

    const legacy = withCloneInstrumentation(() => currentCharacterStateSnapshot())
    expect(legacy.maxClonedSize).toBeGreaterThanOrEqual(charactersSize)
  })
})
