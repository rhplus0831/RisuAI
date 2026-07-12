import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'

const characterCardsState = vi.hoisted(() => ({
  importCharacter: vi.fn(),
}))

vi.mock('./storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'change-char-token',
}))

vi.mock('./alert', async () => {
  const { writable } = await import('svelte/store')
  return {
    alertAddCharacter: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn(),
    alertNormal: vi.fn(),
    alertSelect: vi.fn(),
    alertStore: writable({ type: 'none', msg: '' }),
    alertWait: vi.fn(),
  }
})

vi.mock('./process/coldstorage.svelte', () => ({
  getColdStorageItem: vi.fn(),
}))

vi.mock('./characterCards', () => ({
  importCharacter: characterCardsState.importCharacter,
}))

import { alertAddCharacter } from './alert'
import { clearCachedServerCommandRevision } from './server/commands'
import { stopSelectedCharacterShellHydration } from './server/characterShellHydration.svelte'
import { setServerProjectionWriteGuardEnabled } from './server/projectionWriteGuard.svelte'
import { DBState, selectedCharID } from './stores.svelte'
import { isServerCharacterShell, type character } from './storage/database.svelte'
import { addCharacter, changeChar } from './characters'

interface CapturedFetch {
  url: string
  method: string
  body: unknown
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve
  })
  return { promise, resolve }
}

function characterShell(characterId: string, name: string): character {
  return {
    __serverCharacterShell: true,
    chaId: characterId,
    name,
    chats: [{ id: `${characterId}-chat`, name: 'Chat', message: [] }],
    chatPage: 0,
    chatFolders: [],
  } as unknown as character
}

function hydratedCharacter(characterId: string, name: string): character {
  return {
    chaId: characterId,
    name,
    desc: '',
    firstMessage: 'Hello',
    chats: [{ id: `${characterId}-chat`, name: 'Chat', message: [] }],
    chatPage: 0,
    chatFolders: [],
    customscript: [],
    triggerscript: [],
    globalLore: [],
  } as unknown as character
}

function fullCharacter(characterId: string, name: string): character {
  return {
    ...hydratedCharacter(characterId, name),
    lastInteraction: 100,
  } as character
}

function stubChangeCharFetch(characterRowResponse: Promise<Response>): CapturedFetch[] {
  const calls: CapturedFetch[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input)
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
      calls.push({ url, method: init.method ?? 'GET', body })

      if (url === '/api/v1/bootstrap') {
        return jsonResponse({ revision: 10 })
      }
      if (url.startsWith('/api/v1/characters/')) {
        return characterRowResponse
      }
      if (url === '/api/v1/commands/characters') {
        return jsonResponse({
          revision: 11,
          event: { type: 'character.created', revision: 11, resource: 'character' },
          characterId: body?.character?.chaId,
        })
      }
      if (url === '/api/v1/commands/characters/select') {
        return jsonResponse({
          revision: 11,
          event: { type: 'character.selected', revision: 11, resource: 'characterSelection' },
        })
      }
      return jsonResponse({ error: `unexpected ${url}` }, 404)
    }) as unknown as typeof fetch,
  )
  return calls
}

function selectedCharacterCommandIds(calls: CapturedFetch[]): string[] {
  return calls
    .filter((call) => call.url === '/api/v1/commands/characters/select')
    .map((call) => (call.body as { characterId?: string } | null)?.characterId)
    .filter((characterId): characterId is string => typeof characterId === 'string')
}

async function waitForCharacterRowFetch(calls: CapturedFetch[]): Promise<void> {
  await vi.waitFor(() => {
    expect(calls.some((call) => call.url.startsWith('/api/v1/characters/'))).toBe(true)
  })
}

async function flushAsyncWork(ticks = 4): Promise<void> {
  for (let tick = 0; tick < ticks; tick += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

beforeEach(() => {
  vi.mocked(alertAddCharacter).mockReset()
  characterCardsState.importCharacter.mockReset()
  clearCachedServerCommandRevision()
  stopSelectedCharacterShellHydration()
  setServerProjectionWriteGuardEnabled(false)
  selectedCharID.set(-1)
  DBState.db = {
    currentChar: -1,
    characters: [characterShell('char-a', 'Shell A'), fullCharacter('char-b', 'Character B')],
    characterOrder: ['char-a', 'char-b'],
  } as any
})

afterEach(() => {
  stopSelectedCharacterShellHydration()
  setServerProjectionWriteGuardEnabled(false)
  vi.unstubAllGlobals()
})

describe('changeChar shell selection freshness', () => {
  it('preserves a newer character selection when an older shell hydration resolves later', async () => {
    const characterRow = deferred<Response>()
    const calls = stubChangeCharFetch(characterRow.promise)

    const delayedSelection = changeChar(0)
    await waitForCharacterRowFetch(calls)

    await changeChar(1)
    expect(get(selectedCharID)).toBe(1)
    expect((DBState.db as any).currentChar).toBe(1)

    characterRow.resolve(
      jsonResponse({
        revision: 10,
        character: hydratedCharacter('char-a', 'Hydrated A'),
      }),
    )
    await delayedSelection
    await flushAsyncWork()

    expect(isServerCharacterShell(DBState.db.characters[0])).toBe(false)
    expect(DBState.db.characters[0].name).toBe('Hydrated A')
    expect(get(selectedCharID)).toBe(1)
    expect((DBState.db as any).currentChar).toBe(1)
    await vi.waitFor(() => {
      expect(selectedCharacterCommandIds(calls)).toContain('char-b')
    })
    expect(selectedCharacterCommandIds(calls)).not.toContain('char-a')
  })

  it('selects the live index for the captured character id after shell hydration reorders the row', async () => {
    const characterRow = deferred<Response>()
    const calls = stubChangeCharFetch(characterRow.promise)
    selectedCharID.set(1)
    ;(DBState.db as any).currentChar = 1

    const pendingSelection = changeChar(0)
    await waitForCharacterRowFetch(calls)

    DBState.db.characters = [DBState.db.characters[1], DBState.db.characters[0]]
    selectedCharID.set(0)
    ;(DBState.db as any).currentChar = 0
    characterRow.resolve(
      jsonResponse({
        revision: 10,
        character: hydratedCharacter('char-a', 'Hydrated A'),
      }),
    )

    await pendingSelection

    expect(DBState.db.characters[0].chaId).toBe('char-b')
    expect(DBState.db.characters[1].chaId).toBe('char-a')
    expect(DBState.db.characters[1].name).toBe('Hydrated A')
    expect(get(selectedCharID)).toBe(1)
    expect((DBState.db as any).currentChar).toBe(1)
    await vi.waitFor(() => {
      expect(selectedCharacterCommandIds(calls)).toContain('char-a')
    })
  })

  it('does not select a shell target that disappeared before hydration completed', async () => {
    const characterRow = deferred<Response>()
    const calls = stubChangeCharFetch(characterRow.promise)
    selectedCharID.set(1)
    ;(DBState.db as any).currentChar = 1

    const pendingSelection = changeChar(0)
    await waitForCharacterRowFetch(calls)

    DBState.db.characters = [DBState.db.characters[1]]
    selectedCharID.set(0)
    ;(DBState.db as any).currentChar = 0
    characterRow.resolve(
      jsonResponse({
        revision: 10,
        character: hydratedCharacter('char-a', 'Hydrated A'),
      }),
    )

    await pendingSelection
    await flushAsyncWork()

    expect(DBState.db.characters.map((candidate) => candidate.chaId)).toEqual(['char-b'])
    expect(get(selectedCharID)).toBe(0)
    expect((DBState.db as any).currentChar).toBe(0)
    expect(selectedCharacterCommandIds(calls)).not.toContain('char-a')
  })
})

describe('addCharacter import navigation freshness', () => {
  it('selects the production-imported optimistic character by returned chaId when projection reorders it away from the tail', async () => {
    const calls = stubChangeCharFetch(Promise.resolve(jsonResponse({})))
    let importedCharacterId: string | null | undefined
    DBState.db = {
      currentChar: 0,
      characters: [fullCharacter('char-a', 'Character A'), fullCharacter('char-b', 'Character B')],
      characterOrder: ['char-a', 'char-b'],
    } as any
    selectedCharID.set(0)
    vi.mocked(alertAddCharacter).mockResolvedValue('importCharacter')
    characterCardsState.importCharacter.mockImplementation(async () => {
      const actualCharacterCards = await vi.importActual<typeof import('./characterCards')>('./characterCards')
      importedCharacterId = await actualCharacterCards.importCharacterProcess({
        name: 'imported-character.json',
        data: Buffer.from(
          JSON.stringify({
            name: 'Imported',
            description: 'Imported description',
            first_mes: 'Hello from import',
          }),
        ),
      })
      const imported = DBState.db.characters.find((character) => character.chaId === importedCharacterId)
      expect(imported).toBeTruthy()
      DBState.db.characters = [
        imported!,
        fullCharacter('char-a', 'Character A'),
        fullCharacter('tail-char', 'Tail Character'),
      ]
      ;(DBState.db as any).currentChar = 1
      selectedCharID.set(1)
      return importedCharacterId
    })

    await addCharacter()

    expect(get(selectedCharID)).toBe(0)
    expect((DBState.db as any).currentChar).toBe(0)
    expect(importedCharacterId).toBeTruthy()
    expect(DBState.db.characters[0].chaId).toBe(importedCharacterId)
    await vi.waitFor(() => {
      expect(calls.some((call) => call.url === '/api/v1/commands/characters')).toBe(true)
    })
    await vi.waitFor(() => {
      expect(selectedCharacterCommandIds(calls)).toContain(importedCharacterId)
    })
    expect(selectedCharacterCommandIds(calls)).not.toContain('tail-char')
  })

  it('skips stale post-import navigation when the user selects another character before import finishes', async () => {
    const calls = stubChangeCharFetch(Promise.resolve(jsonResponse({})))
    const importResult = deferred<string | null | undefined>()
    DBState.db = {
      currentChar: 0,
      characters: [fullCharacter('char-a', 'Character A'), fullCharacter('char-b', 'Character B')],
      characterOrder: ['char-a', 'char-b'],
    } as any
    selectedCharID.set(0)
    vi.mocked(alertAddCharacter).mockResolvedValue('importCharacter')
    characterCardsState.importCharacter.mockReturnValue(importResult.promise)

    const pendingAdd = addCharacter()
    await vi.waitFor(() => {
      expect(characterCardsState.importCharacter).toHaveBeenCalledTimes(1)
    })

    DBState.db.characters.push(fullCharacter('imported-char', 'Imported'))
    ;(DBState.db as any).currentChar = 1
    selectedCharID.set(1)
    importResult.resolve('imported-char')
    await pendingAdd

    expect(get(selectedCharID)).toBe(1)
    expect((DBState.db as any).currentChar).toBe(1)
    expect(selectedCharacterCommandIds(calls)).not.toContain('imported-char')
  })
})
