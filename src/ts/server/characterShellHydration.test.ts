import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { testDatabaseState } from '../__tests__/resourceDatabaseState'

const projectionState = vi.hoisted(() => ({
  fetchResource: vi.fn(),
  canUse: true,
}))

vi.mock('./resourceReads', () => ({
  fetchServerCharacter: projectionState.fetchResource,
}))

vi.mock('./chatMessageHydration.svelte', () => ({
  applyServerChatMessagesResource: vi.fn(),
  hydrateActiveChat: vi.fn(),
  hydrateActiveCharacterLorebook: vi.fn(),
  resetChatHydration: vi.fn(),
}))

import { selectedCharID } from '../stores.svelte'
import {
  isServerCharacterShell,
  mergeServerResourceCharacterRow,
  mergeServerResourceFields,
  setResourceWriteGuardEnabled,
} from '../storage/database.svelte'
import {
  clearCachedServerCommandRevision,
  peekCachedServerCommandRevision,
  setCachedServerCommandRevision,
} from './commands'
import { hydrateCharacterShell, stopSelectedCharacterShellHydration } from './characterShellHydration.svelte'

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve
  })
  return { promise, resolve }
}

function characterShell() {
  return {
    __serverCharacterShell: true,
    chaId: 'char-1',
    name: 'Shell',
    chats: [{ id: 'chat-1', name: 'Chat', message: [] }],
    chatPage: 0,
    chatFolders: [],
  }
}

function hydratedCharacter(name = 'Hydrated') {
  return {
    chaId: 'char-1',
    name,
    desc: '',
    firstMessage: 'Hello',
    chats: [{ id: 'chat-1', name: 'Chat', message: [] }],
    chatPage: 0,
    chatFolders: [],
    customscript: [],
    triggerscript: [],
    globalLore: [],
  }
}

beforeEach(() => {
  setResourceWriteGuardEnabled(false)
  clearCachedServerCommandRevision()
  stopSelectedCharacterShellHydration()
  selectedCharID.set(0)
  testDatabaseState.db = {
    characters: [characterShell()],
    characterOrder: ['char-1'],
  } as any
  projectionState.canUse = true
  projectionState.fetchResource.mockReset()
})

afterEach(() => {
  const database = JSON.parse(JSON.stringify(testDatabaseState.db))
  setResourceWriteGuardEnabled(false)
  testDatabaseState.db = database
})

describe('character shell hydration', () => {
  it('fetches a character row and replaces a selected bootstrap shell', async () => {
    setCachedServerCommandRevision(5)
    projectionState.fetchResource.mockResolvedValue({
      status: 'ok',
      revision: 5,
      mode: 'character-row',
      characterId: 'char-1',
      character: hydratedCharacter(),
    })

    await expect(hydrateCharacterShell('char-1')).resolves.toBe(true)

    expect(projectionState.fetchResource).toHaveBeenCalledWith('char-1')
    expect(isServerCharacterShell(testDatabaseState.db.characters[0])).toBe(false)
    expect(testDatabaseState.db.characters[0].name).toBe('Hydrated')
    expect(peekCachedServerCommandRevision()).toBe(5)
  })

  it('accepts a character row response after an unrelated projection advances the known revision', async () => {
    setCachedServerCommandRevision(5)
    setResourceWriteGuardEnabled(true)
    const response = deferred<{
      status: 'ok'
      revision: number
      mode: 'character-row'
      characterId: string
      character: Record<string, unknown>
    }>()
    projectionState.fetchResource.mockReturnValue(response.promise)

    const pending = hydrateCharacterShell('char-1')
    setCachedServerCommandRevision(6)
    mergeServerResourceFields({ language: 'ko' } as any)
    response.resolve({
      status: 'ok',
      revision: 5,
      mode: 'character-row',
      characterId: 'char-1',
      character: hydratedCharacter('Hydrated after settings'),
    })

    await expect(pending).resolves.toBe(true)

    expect(isServerCharacterShell(testDatabaseState.db.characters[0])).toBe(false)
    expect(testDatabaseState.db.characters[0].name).toBe('Hydrated after settings')
    expect(testDatabaseState.db.language).toBe('ko')
    expect(peekCachedServerCommandRevision()).toBe(6)
  })

  it('rejects a response after the target character row changes during hydration', async () => {
    setCachedServerCommandRevision(5)
    setResourceWriteGuardEnabled(true)
    const response = deferred<{
      status: 'ok'
      revision: number
      mode: 'character-row'
      characterId: string
      character: Record<string, unknown>
    }>()
    projectionState.fetchResource.mockReturnValue(response.promise)

    const pending = hydrateCharacterShell('char-1')
    setCachedServerCommandRevision(6)
    mergeServerResourceCharacterRow(hydratedCharacter('Newer projection'))
    response.resolve({
      status: 'ok',
      revision: 5,
      mode: 'character-row',
      characterId: 'char-1',
      character: hydratedCharacter('Stale hydration'),
    })

    await expect(pending).resolves.toBe(false)

    expect(isServerCharacterShell(testDatabaseState.db.characters[0])).toBe(false)
    expect(testDatabaseState.db.characters[0].name).toBe('Newer projection')
  })

  it('rejects a character row response older than the request-start revision', async () => {
    setCachedServerCommandRevision(6)
    projectionState.fetchResource.mockResolvedValue({
      status: 'ok',
      revision: 5,
      mode: 'character-row',
      characterId: 'char-1',
      character: hydratedCharacter('Older than request'),
    })

    await expect(hydrateCharacterShell('char-1')).resolves.toBe(false)

    expect(isServerCharacterShell(testDatabaseState.db.characters[0])).toBe(true)
    expect(testDatabaseState.db.characters[0].name).toBe('Shell')
  })
})
