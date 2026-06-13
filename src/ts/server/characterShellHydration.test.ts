import { beforeEach, describe, expect, it, vi } from 'vitest'

const projectionState = vi.hoisted(() => ({
  fetchResource: vi.fn(),
  canUse: true,
}))

vi.mock('./projection', () => ({
  canUseServerProjection: () => projectionState.canUse,
  fetchServerProjectionResource: projectionState.fetchResource,
}))

vi.mock('./chatMessageHydration.svelte', () => ({
  hydrateActiveChat: vi.fn(),
  hydrateActiveCharacterLorebook: vi.fn(),
}))

import { DBState, selectedCharID } from '../stores.svelte'
import { isServerCharacterShell, setServerProjectionWriteGuardEnabled } from '../storage/database.svelte'
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
  setServerProjectionWriteGuardEnabled(false)
  clearCachedServerCommandRevision()
  stopSelectedCharacterShellHydration()
  selectedCharID.set(0)
  DBState.db = {
    characters: [characterShell()],
    characterOrder: ['char-1'],
  } as any
  projectionState.canUse = true
  projectionState.fetchResource.mockReset()
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

    expect(projectionState.fetchResource).toHaveBeenCalledWith('characterRow', { id: 'char-1' })
    expect(isServerCharacterShell(DBState.db.characters[0])).toBe(false)
    expect(DBState.db.characters[0].name).toBe('Hydrated')
    expect(peekCachedServerCommandRevision()).toBe(5)
  })

  it('ignores a character row response older than the current cached command revision', async () => {
    setCachedServerCommandRevision(5)
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
    response.resolve({
      status: 'ok',
      revision: 5,
      mode: 'character-row',
      characterId: 'char-1',
      character: hydratedCharacter('Old hydration'),
    })

    await expect(pending).resolves.toBe(false)

    expect(isServerCharacterShell(DBState.db.characters[0])).toBe(true)
    expect(DBState.db.characters[0].name).toBe('Shell')
  })
})
