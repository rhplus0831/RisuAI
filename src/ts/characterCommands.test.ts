import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'

const alertConfirmState = vi.hoisted(() => ({
  messages: [] as string[],
  responses: [] as boolean[],
}))

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

vi.mock('./alert', async (importActual) => {
  const actual = await importActual<typeof import('./alert')>()
  return {
    ...actual,
    alertConfirm: vi.fn(async (message: string) => {
      alertConfirmState.messages.push(message)
      return alertConfirmState.responses.shift() ?? true
    }),
  }
})

import {
  changedCharacterFields,
  currentCharacterRowSnapshot,
  currentCharacterSelectionSnapshot,
  currentCharacterStateSnapshot,
  currentCharacterTrashTimeSnapshot,
  dispatchCompatibleCharacterUpdateScoped,
  prepareCompatibleCharacterUpdate,
  restoreCharacterRow,
  restoreCharacterTrashTime,
  sanitizeCharacterPatch,
  setCharacterSupaMemory,
} from './characterCommands'
import { setCharacterByIndex } from './storage/database.svelte'
import { clearCachedServerCommandRevision } from './server/commands'
import { setServerProjectionWriteGuardEnabled } from './server/projectionWriteGuard.svelte'
import { DBState, selectedCharID } from './stores.svelte'
import { removeChar } from './characters'
import {
  assertRollbackRestoresOnly,
  assertSnapshotIsScalar,
  assertSnapshotOmitsCollections,
  seedCloneCostDb,
  withAsyncCloneInstrumentation,
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

function deferredResponse(): {
  promise: Promise<Response>
  resolve: (response: Response) => void
} {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>((innerResolve) => {
    resolve = innerResolve
  })
  return { promise, resolve }
}

async function waitForCharacterPatch(calls: CapturedFetch[], characterId: string): Promise<void> {
  await vi.waitFor(() => {
    expect(
      calls.some((call) => call.url === `/api/v1/commands/characters/${characterId}`),
    ).toBe(true)
  })
}

async function withMockedNow<T>(now: number, fn: () => Promise<T>): Promise<T> {
  const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now)
  try {
    return await fn()
  } finally {
    nowSpy.mockRestore()
  }
}

beforeEach(() => {
  clearCachedServerCommandRevision()
  setServerProjectionWriteGuardEnabled(false)
  selectedCharID.set(0)
  alertConfirmState.messages = []
  alertConfirmState.responses = [true, true]
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

describe('Phase 2 character-row scoped dispatch', () => {
  it('dispatchCompatibleCharacterUpdateScoped rolls back only the target row on failure', async () => {
    const calls: CapturedFetch[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input)
        calls.push({
          url,
          method: init.method ?? 'GET',
          authHeader: null,
          body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
        })
        if (url === '/api/v1/bootstrap') return jsonResponse({ revision: 10 })
        if (url === '/api/v1/commands/characters/char-a') return jsonResponse({ error: 'nope' }, 500)
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )
    DBState.db = {
      characters: [
        { chaId: 'char-a', name: 'Character', chats: [] },
        { chaId: 'char-b', name: 'Sibling', chats: [] },
      ],
      characterOrder: [],
    } as any
    selectedCharID.set(0)

    const previous = currentCharacterRowSnapshot(0)
    const previousCharacter = JSON.parse(JSON.stringify(DBState.db.characters[0]))

    // optimistic edit to the target row plus an unrelated concurrent sibling edit
    const nextCharacter = { ...previousCharacter, name: 'Optimistic' }
    DBState.db.characters[0] = nextCharacter as any
    DBState.db.characters[1].name = 'Concurrent sibling edit'

    dispatchCompatibleCharacterUpdateScoped(previousCharacter as any, nextCharacter as any, previous)
    await waitForCallCount(calls, 2)

    // the failed update restores only the target row; the sibling edit survives a
    // whole-array restore would have wiped.
    expect(DBState.db.characters[0].name).toBe('Character')
    expect(DBState.db.characters[1].name).toBe('Concurrent sibling edit')
  })

  it('setCharacterByIndex captures a single-row rollback baseline, never the whole array', async () => {
    DBState.db = seedCloneCostDb() as any // char-0 large (40 messages), siblings small
    selectedCharID.set(1)
    const charactersSize = JSON.stringify(DBState.db.characters).length
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ revision: 10 })) as unknown as typeof fetch,
    )

    const target = JSON.parse(JSON.stringify(DBState.db.characters[1]))
    target.name = 'Renamed'

    // The selection capture + the compatible-update diff stay bounded to the one
    // edited row; the large sibling (char-0) transcript is never serialized.
    const instrumented = withCloneInstrumentation(() => {
      setCharacterByIndex(1, target as any)
    })
    expect(instrumented.maxClonedSize).toBeLessThan(charactersSize)

    // drain the async dispatch so it does not leak into the next test
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
})

describe('Phase 3 kept-key character diff (M13)', () => {
  it('M13: changedCharacterFields diffs without cloning the chats payload', () => {
    DBState.db = seedCloneCostDb() as any // char-0 carries a 40-message hydrated chat
    const previous = DBState.db.characters[0]
    const next = { ...previous, name: 'Renamed' }
    const chatsSize = JSON.stringify(previous.chats).length

    const instrumented = withCloneInstrumentation(() => changedCharacterFields(previous, next as any))

    // Pre-fix the diff cloned BOTH characters in full (chats with every hydrated
    // history included) before stripping exactly those keys.
    expect(instrumented.maxClonedSize).toBeLessThan(chatsSize)
    expect(instrumented.result).toEqual({ name: 'Renamed' })
  })

  it('M13: the per-key diff matches the old clone-then-sanitize semantics', () => {
    const previous = {
      chaId: 'char-a',
      name: 'Old name',
      desc: 'same',
      nested: { a: 1, b: [1, 2] },
      removed: 'gone after',
      chats: [{ id: 'chat-1', message: [{ role: 'user', data: 'x' }] }],
      scriptstate: { $x: '1' },
    }
    const next = {
      chaId: 'char-a',
      name: 'New name',
      desc: 'same',
      nested: { a: 1, b: [1, 2, 3] },
      added: 'new field',
      chats: [{ id: 'chat-1', message: [] }], // excluded key change must be ignored
      scriptstate: { $x: '2' }, // excluded key change must be ignored
    }

    const patch = changedCharacterFields(previous as any, next as any)

    expect(patch).toMatchObject({
      name: 'New name',
      nested: { a: 1, b: [1, 2, 3] },
      added: 'new field',
    })
    // a deleted kept field appears as an explicit undefined; sanitize drops it
    expect('removed' in patch).toBe(true)
    expect(patch.removed).toBeUndefined()
    expect(sanitizeCharacterPatch(patch)).toEqual({
      name: 'New name',
      nested: { a: 1, b: [1, 2, 3] },
      added: 'new field',
    })
    // excluded keys never enter the patch, changed or not
    expect('chats' in patch).toBe(false)
    expect('scriptstate' in patch).toBe(false)
    expect('chaId' in patch).toBe(false)
    expect('desc' in patch).toBe(false)
  })

  it('M13: prepareCompatibleCharacterUpdate builds its factory without serializing the transcript', () => {
    DBState.db = seedCloneCostDb() as any
    const previous = DBState.db.characters[0]
    const next = { ...previous, name: 'Renamed' }
    const chatsSize = JSON.stringify(previous.chats).length
    const rowSnapshot = currentCharacterStateSnapshot() // captured outside the measurement

    const instrumented = withCloneInstrumentation(() =>
      prepareCompatibleCharacterUpdate(previous, next as any, rowSnapshot),
    )

    expect(instrumented.maxClonedSize).toBeLessThan(chatsSize)
    expect(instrumented.result.factories).toHaveLength(1)
  })
})

describe('Phase 4 removeChar trashTime field rollback (L33)', () => {
  it('L33: trashTime snapshots are scalar and restore only the target field', () => {
    DBState.db = seedCloneCostDb() as any
    selectedCharID.set(1)

    const snapshot = currentCharacterTrashTimeSnapshot(1)

    expect(snapshot).toEqual({
      characterId: 'char-1',
      index: 1,
      hadTrashTime: false,
      trashTime: undefined,
      currentChar: 0,
      selectedCharID: 1,
    })
    assertSnapshotIsScalar(snapshot)

    const charactersSize = JSON.stringify(DBState.db.characters).length
    const instrumented = withCloneInstrumentation(() => currentCharacterTrashTimeSnapshot(1))
    expect(instrumented.maxClonedSize).toBeLessThan(charactersSize)

    DBState.db.characters[1].trashTime = 123
    DBState.db.characters[1].name = 'Same row concurrent edit'
    DBState.db.characters[0].name = 'Sibling concurrent edit'

    restoreCharacterTrashTime(snapshot)

    expect(Object.prototype.hasOwnProperty.call(DBState.db.characters[1], 'trashTime')).toBe(false)
    expect(DBState.db.characters[1].name).toBe('Same row concurrent edit')
    expect(DBState.db.characters[0].name).toBe('Sibling concurrent edit')
  })

  it('L33: removeChar normal trash captures no whole-characters clone and reuses one timestamp', async () => {
    DBState.db = seedCloneCostDb({
      hydratedMessageCount: 80,
      messageBodySize: 500,
    }) as any
    DBState.db.characterOrder = ['char-0', 'char-1', 'char-2']
    selectedCharID.set(1)
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
        if (url === '/api/v1/commands/characters/char-1') {
          return jsonResponse({
            revision: 11,
            event: { type: 'character.updated', revision: 11, resource: 'character' },
          })
        }
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )
    const charactersSize = JSON.stringify(DBState.db.characters).length

    const instrumented = await withMockedNow(987654, () =>
      withAsyncCloneInstrumentation(() => removeChar(1, 'Character 1', 'normal')),
    )

    expect(instrumented.maxClonedSize).toBeLessThan(charactersSize)
    expect(DBState.db.characters[1].trashTime).toBe(987654)
    expect(get(selectedCharID)).toBe(-1)
    expect(alertConfirmState.messages).toHaveLength(2)
    expect(alertConfirmState.messages[0]).toContain('Character 1')
    expect(alertConfirmState.messages[1]).toContain('Character 1')

    await waitForCallCount(calls, 2)
    expect(calls.find((call) => call.url === '/api/v1/commands/characters/char-1')).toEqual({
      url: '/api/v1/commands/characters/char-1',
      method: 'PATCH',
      authHeader: 'character-command-token',
      body: {
        baseRevision: 10,
        patch: { trashTime: 987654 },
      },
    })
  })

  it('L33: failed removeChar trash update restores only trashTime', async () => {
    const calls: CapturedFetch[] = []
    const patchResponse = deferredResponse()
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
        if (url === '/api/v1/commands/characters/char-a') return patchResponse.promise
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )
    DBState.db = {
      characters: [
        { chaId: 'char-a', name: 'Character', chats: [] },
        { chaId: 'char-b', name: 'Sibling', chats: [] },
      ],
      characterOrder: ['char-a', 'char-b'],
      currentChar: 0,
    } as any
    selectedCharID.set(0)

    await withMockedNow(222222, () => removeChar(0, 'Character', 'normal'))
    await waitForCharacterPatch(calls, 'char-a')
    expect(DBState.db.characters[0].trashTime).toBe(222222)
    expect(get(selectedCharID)).toBe(-1)

    DBState.db.characters[0].name = 'Same row concurrent edit'
    DBState.db.characters[1].name = 'Sibling concurrent edit'
    patchResponse.resolve(jsonResponse({ error: 'nope' }, 500))

    await vi.waitFor(() => {
      expect(Object.prototype.hasOwnProperty.call(DBState.db.characters[0], 'trashTime')).toBe(
        false,
      )
    })
    expect(DBState.db.characters[0].name).toBe('Same row concurrent edit')
    expect(DBState.db.characters[1].name).toBe('Sibling concurrent edit')
    expect(get(selectedCharID)).toBe(0)
  })

  it('L33: trash rollback restores by stable id after index shifts', async () => {
    const calls: CapturedFetch[] = []
    const patchResponse = deferredResponse()
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
        if (url === '/api/v1/commands/characters/char-b') return patchResponse.promise
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )
    DBState.db = {
      characters: [
        { chaId: 'char-a', name: 'A', chats: [] },
        { chaId: 'char-b', name: 'B', chats: [], trashTime: 111111 },
        { chaId: 'char-c', name: 'C', chats: [] },
      ],
      characterOrder: ['char-a', 'char-c'],
      currentChar: 1,
    } as any
    selectedCharID.set(1)

    await withMockedNow(333333, () => removeChar(1, 'B', 'normal'))
    await waitForCharacterPatch(calls, 'char-b')
    expect(DBState.db.characters[1].trashTime).toBe(333333)

    DBState.db.characters.unshift({ chaId: 'char-new', name: 'Inserted', chats: [] } as any)
    DBState.db.characters[1].name = 'Stale index sibling edit'
    patchResponse.resolve(jsonResponse({ error: 'nope' }, 500))

    await vi.waitFor(() => {
      expect(DBState.db.characters.find((c: any) => c.chaId === 'char-b')?.trashTime).toBe(111111)
    })
    expect(DBState.db.characters[1].chaId).toBe('char-a')
    expect(DBState.db.characters[1].name).toBe('Stale index sibling edit')
    expect(DBState.db.characters[0].chaId).toBe('char-new')
  })
})
