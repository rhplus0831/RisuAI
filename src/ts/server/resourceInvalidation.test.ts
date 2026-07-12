import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { character } from '../storage/database.svelte'
import type { CommandEvent } from './commands'

const api = vi.hoisted(() => ({
  settings: vi.fn(),
  collections: vi.fn(),
  collection: vi.fn(),
  characters: vi.fn(),
  character: vi.fn(),
  characterOrder: vi.fn(),
  characterSelection: vi.fn(),
  chat: vi.fn(),
  generationChat: vi.fn(),
  lorebook: vi.fn(),
  lorebooks: vi.fn(),
}))

const sideEffects = vi.hoisted(() => ({
  mergePluginStorage: vi.fn((value: Record<string, unknown>) => value),
  reattach: vi.fn(),
  clearTranslation: vi.fn(),
  markLorebook: vi.fn(),
  applyChat: vi.fn(() => true),
  applyLorebook: vi.fn(() => true),
}))

vi.mock('./resourceReads', () => ({
  fetchServerSettings: api.settings,
  fetchServerCollections: api.collections,
  fetchServerCollection: api.collection,
  fetchServerCharacters: api.characters,
  fetchServerCharacter: api.character,
  fetchServerCharacterOrder: api.characterOrder,
  fetchServerCharacterSelection: api.characterSelection,
}))

vi.mock('./hydrationReads', () => ({
  fetchServerChatMessages: api.chat,
  fetchServerGenerationChatMessages: api.generationChat,
  fetchServerCharacterLorebook: api.lorebook,
  fetchServerBulkCharacterLorebooks: api.lorebooks,
}))

import {
  FULL_RESOURCE_REFRESH_MAX_ATTEMPTS,
  loadInitialServerResources,
  refreshAllServerResources,
  refreshInvalidatedServerResources,
  type ServerResourceInvalidationHooks,
} from './resourceInvalidation'
import {
  SERVER_COLLECTION_NAMES,
  applyCharactersResource,
  applyCollectionsResource,
  applySettingsResource,
  getResourceDatabase,
  resetServerResourceState,
} from './resourceState.svelte'

const hooks: ServerResourceInvalidationHooks = {
  mergePendingPluginStorage: sideEffects.mergePluginStorage,
  applyChatMessages: sideEffects.applyChat,
  applyCharacterLorebook: sideEffects.applyLorebook,
  markCharacterLorebookHydrated: sideEffects.markLorebook,
  triggerOpenChatGenerationReattach: sideEffects.reattach,
  clearActiveMessageTranslation: sideEffects.clearTranslation,
}

function metadataCharacter(chaId: string, name: string, chatId = `chat-${chaId}`, message: unknown[] = []): character {
  return {
    chaId,
    name,
    globalLore: [],
    chats: [
      {
        id: chatId,
        name: `${name} chat`,
        message,
      },
    ],
  } as unknown as character
}

function completeCollections(pluginCustomStorage: Record<string, unknown> = {}) {
  return Object.fromEntries(
    SERVER_COLLECTION_NAMES.map((name) => [name, name === 'pluginCustomStorage' ? pluginCustomStorage : []]),
  )
}

function seedResources(revision = 1): void {
  applySettingsResource({ revision, settings: { language: 'en' } })
  applyCollectionsResource({ revision, collections: completeCollections({ resident: true }) })
  const ada = metadataCharacter('char-a', 'Ada', 'chat-a', [{ role: 'user', data: 'resident-a' }])
  ada.chats[0].hypaV3Data = {
    summaries: [{ text: 'resident summary', chatMemos: [], isImportant: false }],
  }
  applyCharactersResource({
    revision,
    characters: [ada, metadataCharacter('char-b', 'Bea', 'chat-b', [{ role: 'user', data: 'resident-b' }])],
    characterOrder: ['char-a', 'char-b'],
    currentChar: 0,
  })
}

function fullReadMocks(revision: number): void {
  api.settings.mockResolvedValue({ status: 'ok', revision, settings: { language: 'ko' } })
  api.collections.mockResolvedValue({
    status: 'ok',
    revision,
    collections: completeCollections({ authoritative: true }),
  })
  api.characters.mockResolvedValue({
    status: 'ok',
    revision,
    characters: [
      metadataCharacter('char-a', 'Ada refreshed', 'chat-a'),
      metadataCharacter('char-b', 'Bea refreshed', 'chat-b'),
    ],
    characterOrder: ['char-b', 'char-a'],
    currentChar: 1,
  })
}

function event(revision: number, resource: string, ids: { id?: string; parentId?: string } = {}): CommandEvent {
  return { type: `${resource}.updated`, revision, resource, ...ids }
}

beforeEach(() => {
  resetServerResourceState()
  for (const mock of Object.values(api)) mock.mockReset()
  for (const mock of Object.values(sideEffects)) mock.mockClear()
  sideEffects.mergePluginStorage.mockImplementation((value: Record<string, unknown>) => value)
})

describe('API-backed resource invalidation', () => {
  it('loads one consistent initial resource set, invalidating chat bodies and preserving pending plugin storage', async () => {
    seedResources(4)
    fullReadMocks(5)
    sideEffects.mergePluginStorage.mockImplementation((value) => ({ ...value, pending: 'local' }))

    await expect(loadInitialServerResources({ hooks })).resolves.toEqual({ status: 'ok', revision: 5, scope: 'full' })

    const database = getResourceDatabase()
    expect(database).toMatchObject({
      language: 'ko',
      pluginCustomStorage: { authoritative: true, pending: 'local' },
      currentChar: 1,
    })
    expect(database.characters.find((candidate) => candidate.chaId === 'char-a')).toMatchObject({
      chaId: 'char-a',
      name: 'Ada refreshed',
      chats: [
        {
          message: [],
        },
      ],
    })
    expect(sideEffects.mergePluginStorage).toHaveBeenCalledWith({ authoritative: true })
  })

  it('retries inconsistent full reads and applies only a common revision', async () => {
    api.settings
      .mockResolvedValueOnce({ status: 'ok', revision: 5, settings: { language: 'stale' } })
      .mockResolvedValueOnce({ status: 'ok', revision: 7, settings: { language: 'fresh' } })
    api.collections
      .mockResolvedValueOnce({ status: 'ok', revision: 6, collections: completeCollections() })
      .mockResolvedValueOnce({ status: 'ok', revision: 7, collections: completeCollections() })
    api.characters
      .mockResolvedValueOnce({
        status: 'ok',
        revision: 6,
        characters: [],
        characterOrder: [],
        currentChar: -1,
      })
      .mockResolvedValueOnce({
        status: 'ok',
        revision: 7,
        characters: [],
        characterOrder: [],
        currentChar: -1,
      })

    await expect(refreshAllServerResources({ hooks })).resolves.toEqual({ status: 'ok', revision: 7, scope: 'full' })
    expect(api.settings).toHaveBeenCalledTimes(2)
    expect(getResourceDatabase().language).toBe('fresh')
  })

  it('fails after bounded revision mismatches without applying any response', async () => {
    seedResources(1)
    api.settings.mockResolvedValue({ status: 'ok', revision: 2, settings: { language: 'not-applied' } })
    api.collections.mockResolvedValue({ status: 'ok', revision: 3, collections: completeCollections() })
    api.characters.mockResolvedValue({
      status: 'ok',
      revision: 3,
      characters: [],
      characterOrder: [],
      currentChar: -1,
    })

    const result = await refreshAllServerResources({ hooks })
    expect(result).toEqual({
      status: 'error',
      error: `Server resource revisions did not converge after ${FULL_RESOURCE_REFRESH_MAX_ATTEMPTS} attempts`,
    })
    expect(api.settings).toHaveBeenCalledTimes(FULL_RESOURCE_REFRESH_MAX_ATTEMPTS)
    expect(getResourceDatabase().language).toBe('en')
    expect(getResourceDatabase().characters).toHaveLength(2)
  })

  it('coalesces known events into minimal settings, collection, and character reads', async () => {
    seedResources(5)
    api.settings.mockResolvedValue({ status: 'ok', revision: 10, settings: { language: 'ja' } })
    api.collection.mockImplementation(async (name: string) => ({
      status: 'ok',
      revision: 10,
      collections: { [name]: name === 'modules' ? [{ id: 'module-a', name: 'A', description: '' }] : [] },
    }))
    api.character.mockResolvedValue({
      status: 'ok',
      revision: 10,
      character: metadataCharacter('char-a', 'Ada updated', 'chat-a'),
    })

    const result = await refreshInvalidatedServerResources(
      [event(6, 'settings'), event(7, 'moduleUpdated', { id: 'module-a' }), event(8, 'characterRow', { id: 'char-a' })],
      { appliedRevision: 5, hooks },
    )

    expect(result).toEqual({ status: 'ok', revision: 8, scope: 'targeted' })
    expect(api.settings).toHaveBeenCalledTimes(1)
    expect(api.collection).toHaveBeenCalledWith('modules', undefined)
    expect(api.character).toHaveBeenCalledWith('char-a', undefined)
    expect(api.collections).not.toHaveBeenCalled()
    expect(api.characters).not.toHaveBeenCalled()
    expect(api.chat).not.toHaveBeenCalled()
    const database = getResourceDatabase()
    expect(database).toMatchObject({ language: 'ja', modules: [{ id: 'module-a' }] })
    expect(database.characters.find((candidate) => candidate.chaId === 'char-a')).toMatchObject({
      chaId: 'char-a',
      name: 'Ada updated',
      chats: [{ message: [{ role: 'user', data: 'resident-a' }] }],
    })
  })

  it('reads Hypa presets only for the cross-resource memory settings event', async () => {
    seedResources(1)
    api.settings
      .mockResolvedValueOnce({ status: 'ok', revision: 2, settings: { hypaV3: true } })
      .mockResolvedValueOnce({ status: 'ok', revision: 3, settings: { hypaV3: true } })
    api.collection.mockResolvedValue({
      status: 'ok',
      revision: 3,
      collections: { hypaV3Presets: [{ name: 'Authoritative memory' }] },
    })

    await expect(
      refreshInvalidatedServerResources(event(2, 'settings', { id: 'memory' }), {
        appliedRevision: 1,
        hooks,
      }),
    ).resolves.toEqual({ status: 'ok', revision: 2, scope: 'targeted' })
    expect(api.settings).toHaveBeenCalledOnce()
    expect(api.collection).not.toHaveBeenCalled()

    await expect(
      refreshInvalidatedServerResources(event(3, 'settingsWithHypaV3Presets', { id: 'memory' }), {
        appliedRevision: 2,
        hooks,
      }),
    ).resolves.toEqual({ status: 'ok', revision: 3, scope: 'targeted' })
    expect(api.settings).toHaveBeenCalledTimes(2)
    expect(api.collection).toHaveBeenCalledOnce()
    expect(api.collection).toHaveBeenCalledWith('hypaV3Presets', undefined)
    expect(getResourceDatabase().hypaV3Presets).toEqual([{ name: 'Authoritative memory' }])
  })

  it('reads only the resource slices changed by each preset selection shape', async () => {
    seedResources(1)
    api.collection
      .mockResolvedValueOnce({
        status: 'ok',
        revision: 2,
        collections: { botPresets: [{ id: 'preset-a', name: 'A' }] },
      })
      .mockResolvedValueOnce({
        status: 'ok',
        revision: 3,
        collections: { botPresets: [{ id: 'preset-b', name: 'B' }] },
      })
    api.settings
      .mockResolvedValueOnce({ status: 'ok', revision: 3, settings: { botPresetsId: 0 } })
      .mockResolvedValueOnce({ status: 'ok', revision: 4, settings: { botPresetsId: 1 } })

    await expect(
      refreshInvalidatedServerResources(event(2, 'presetCollection', { id: 'preset-a' }), {
        appliedRevision: 1,
        hooks,
      }),
    ).resolves.toEqual({ status: 'ok', revision: 2, scope: 'targeted' })
    expect(api.collection).toHaveBeenCalledOnce()
    expect(api.collection).toHaveBeenCalledWith('botPresets', undefined)
    expect(api.settings).not.toHaveBeenCalled()

    await expect(
      refreshInvalidatedServerResources(event(3, 'presetCollectionWithPointer', { id: 'preset-b' }), {
        appliedRevision: 2,
        hooks,
      }),
    ).resolves.toEqual({ status: 'ok', revision: 3, scope: 'targeted' })
    expect(api.collection).toHaveBeenCalledTimes(2)
    expect(api.settings).toHaveBeenCalledOnce()
    expect(getResourceDatabase()).toMatchObject({
      botPresetsId: 0,
      botPresets: [{ id: 'preset-b', name: 'B' }],
    })

    await expect(
      refreshInvalidatedServerResources(event(4, 'presetPointer', { id: 'preset-a' }), {
        appliedRevision: 3,
        hooks,
      }),
    ).resolves.toEqual({ status: 'ok', revision: 4, scope: 'targeted' })
    expect(api.settings).toHaveBeenCalledTimes(2)
    expect(api.collection).toHaveBeenCalledTimes(2)
    expect(getResourceDatabase().botPresetsId).toBe(1)

    await expect(
      refreshInvalidatedServerResources(event(5, 'revisionOnly', { id: 'preset-a' }), {
        appliedRevision: 4,
        hooks,
      }),
    ).resolves.toEqual({ status: 'ok', revision: 5, scope: 'targeted' })
    expect(api.settings).toHaveBeenCalledTimes(2)
    expect(api.collection).toHaveBeenCalledTimes(2)
  })

  it('uses narrow order and selection reads without fetching all characters', async () => {
    seedResources(5)
    api.characterOrder.mockResolvedValue({
      status: 'ok',
      revision: 7,
      characterOrder: ['char-b', 'char-a'],
    })
    api.characterSelection.mockResolvedValue({
      status: 'ok',
      revision: 7,
      characterId: 'char-b',
      currentChar: 1,
      lastInteraction: 77,
    })

    const result = await refreshInvalidatedServerResources(
      [event(6, 'characterOrder'), event(7, 'characterSelection', { id: 'char-b' })],
      { appliedRevision: 5, hooks },
    )

    expect(result).toEqual({ status: 'ok', revision: 7, scope: 'targeted' })
    expect(api.characterOrder).toHaveBeenCalledWith(undefined)
    expect(api.characterSelection).toHaveBeenCalledWith('char-b', undefined)
    expect(api.characters).not.toHaveBeenCalled()
    expect(api.character).not.toHaveBeenCalled()
    expect(getResourceDatabase()).toMatchObject({
      characterOrder: ['char-b', 'char-a'],
      currentChar: 1,
      characters: [{ chaId: 'char-a' }, { chaId: 'char-b', lastInteraction: 77 }],
    })
  })

  it('uses individual chat and bulk lorebook reads while applying hydration side effects', async () => {
    seedResources(1)
    api.chat.mockImplementation(async (chatId: string) => ({
      status: 'ok',
      revision: 5,
      chatId,
      message: [{ role: 'char', data: 'fresh-a' }],
      hypaV3Data: { fresh: 'a' },
      alternates: [{ role: 'char', data: `${chatId}-alternate` }],
    }))
    api.generationChat.mockImplementation(async (chatId: string) => ({
      status: 'ok',
      revision: 5,
      chatId,
      message: [{ role: 'char', data: 'fresh-b' }],
      hypaV3Data: { fresh: 'b' },
      alternates: [{ role: 'char', data: `${chatId}-alternate` }],
      messageStart: 1,
      messageTotal: 2,
    }))
    api.lorebooks.mockResolvedValue({
      status: 'ok',
      revision: 5,
      characters: [
        { characterId: 'char-a', globalLore: [{ key: 'A' }] },
        { characterId: 'char-b', globalLore: [{ key: 'B' }] },
      ],
      missing: [],
    })

    const result = await refreshInvalidatedServerResources(
      [
        event(2, 'message', { id: 'message-a', parentId: 'chat-a' }),
        event(3, 'generation', { id: 'message-b', parentId: 'chat-b' }),
        event(4, 'characterLorebook', { id: 'char-a' }),
        event(5, 'characterLorebook', { id: 'char-b' }),
      ],
      { appliedRevision: 1, hooks },
    )

    expect(result).toEqual({ status: 'ok', revision: 5, scope: 'targeted' })
    expect(api.chat).toHaveBeenCalledTimes(1)
    expect(api.chat).toHaveBeenCalledWith('chat-a', { signal: undefined })
    expect(api.generationChat).toHaveBeenCalledWith('chat-b', 'message-b', { signal: undefined })
    expect(api.lorebooks).toHaveBeenCalledWith(['char-a', 'char-b'], { signal: undefined })
    expect(api.lorebook).not.toHaveBeenCalled()
    expect(sideEffects.applyChat).toHaveBeenCalledWith(
      'chat-a',
      [{ role: 'char', data: 'fresh-a' }],
      { fresh: 'a' },
      [{ role: 'char', data: 'chat-a-alternate' }],
      undefined,
    )
    expect(sideEffects.applyChat).toHaveBeenCalledWith(
      'chat-b',
      [{ role: 'char', data: 'fresh-b' }],
      { fresh: 'b' },
      [{ role: 'char', data: 'chat-b-alternate' }],
      { start: 1, total: 2 },
    )
    expect(sideEffects.applyLorebook).toHaveBeenCalledWith('char-a', [{ key: 'A' }])
    expect(sideEffects.applyLorebook).toHaveBeenCalledWith('char-b', [{ key: 'B' }])
    expect(sideEffects.reattach).toHaveBeenCalledTimes(1)
    expect(sideEffects.clearTranslation).toHaveBeenCalledWith('message-a')
    expect(sideEffects.markLorebook).toHaveBeenCalledTimes(2)
  })

  it('uses a full chat read when generation windows for one chat are ambiguous', async () => {
    seedResources(1)
    api.chat.mockResolvedValue({
      status: 'ok',
      revision: 3,
      chatId: 'chat-a',
      message: [{ role: 'char', data: 'authoritative transcript' }],
      hypaV3Data: undefined,
      alternates: [],
    })

    await expect(
      refreshInvalidatedServerResources(
        [
          event(2, 'generation', { id: 'generated-late', parentId: 'chat-a' }),
          event(3, 'generation', { id: 'generated-earlier', parentId: 'chat-a' }),
        ],
        { appliedRevision: 1, hooks },
      ),
    ).resolves.toEqual({ status: 'ok', revision: 3, scope: 'targeted' })

    expect(api.chat).toHaveBeenCalledOnce()
    expect(api.chat).toHaveBeenCalledWith('chat-a', { signal: undefined })
    expect(api.generationChat).not.toHaveBeenCalled()
    expect(sideEffects.applyChat).toHaveBeenCalledWith(
      'chat-a',
      [{ role: 'char', data: 'authoritative transcript' }],
      undefined,
      [],
      undefined,
    )
  })

  it('lets a full message invalidation win over a generation window for the same chat', async () => {
    seedResources(1)
    api.chat.mockResolvedValue({
      status: 'ok',
      revision: 3,
      chatId: 'chat-a',
      message: [{ role: 'char', data: 'full transcript' }],
      hypaV3Data: undefined,
      alternates: [],
    })

    await expect(
      refreshInvalidatedServerResources(
        [
          event(2, 'generation', { id: 'generated-a', parentId: 'chat-a' }),
          event(3, 'message', { id: 'message-a', parentId: 'chat-a' }),
        ],
        { appliedRevision: 1, hooks },
      ),
    ).resolves.toEqual({ status: 'ok', revision: 3, scope: 'targeted' })

    expect(api.chat).toHaveBeenCalledOnce()
    expect(api.generationChat).not.toHaveBeenCalled()
  })

  it('rejects chat invalidation before reading when required apply hooks are absent', async () => {
    seedResources(1)

    await expect(
      refreshInvalidatedServerResources(event(2, 'generation', { parentId: 'chat-a' }), {
        appliedRevision: 1,
      }),
    ).resolves.toEqual({
      status: 'error',
      error: 'Server resource invalidation requires the applyChatMessages hook',
    })
    expect(api.chat).not.toHaveBeenCalled()
  })

  it('merges pending plugin storage on a targeted invalidation', async () => {
    seedResources(1)
    api.collection.mockResolvedValue({
      status: 'ok',
      revision: 3,
      collections: { pluginCustomStorage: { authoritative: true } },
    })
    sideEffects.mergePluginStorage.mockImplementation((value) => ({ ...value, pending: true }))

    await expect(
      refreshInvalidatedServerResources(event(2, 'pluginStorage', { id: 'key' }), { appliedRevision: 1, hooks }),
    ).resolves.toEqual({ status: 'ok', revision: 2, scope: 'targeted' })

    expect(api.collection).toHaveBeenCalledWith('pluginCustomStorage', undefined)
    expect(getResourceDatabase().pluginCustomStorage).toEqual({ authoritative: true, pending: true })
  })

  it('reads only the owning collection for prompt item events', async () => {
    seedResources(1)
    api.collection.mockImplementation(async (name: string) => ({
      status: 'ok',
      revision: 3,
      collections: { [name]: [] },
    }))

    await expect(
      refreshInvalidatedServerResources(
        [
          event(2, 'promptItem', { id: 'item-a', parentId: 'prompt-preset-a' }),
          event(3, 'promptItem', { id: 'legacy-item-a' }),
        ],
        { appliedRevision: 1, hooks },
      ),
    ).resolves.toEqual({ status: 'ok', revision: 3, scope: 'targeted' })

    expect(api.collection).toHaveBeenCalledTimes(2)
    expect(api.collection).toHaveBeenCalledWith('promptPresets', undefined)
    expect(api.collection).toHaveBeenCalledWith('promptTemplate', undefined)
    expect(api.settings).not.toHaveBeenCalled()
    expect(api.collections).not.toHaveBeenCalled()
  })

  it.each([
    ['a revision gap', event(4, 'settings'), 1],
    ['a state event', event(2, 'state'), 1],
    ['an unknown resource', event(2, 'futureResource'), 1],
    ['a missing required id', event(2, 'characterRow'), 1],
  ])('falls back to a full refresh for %s', async (_label, commandEvent, appliedRevision) => {
    fullReadMocks(9)

    await expect(refreshInvalidatedServerResources(commandEvent, { appliedRevision, hooks })).resolves.toEqual({
      status: 'ok',
      revision: 9,
      scope: 'full',
    })
    expect(api.settings).toHaveBeenCalledTimes(1)
    expect(api.collections).toHaveBeenCalledTimes(1)
    expect(api.characters).toHaveBeenCalledTimes(1)
  })

  it('propagates failed targeted reads without applying successful siblings or returning a revision', async () => {
    seedResources(1)
    api.settings.mockResolvedValue({ status: 'ok', revision: 3, settings: { language: 'not-applied' } })
    api.collection.mockResolvedValue({ status: 'error', error: 'collection failed' })

    const result = await refreshInvalidatedServerResources(
      [event(2, 'settings'), event(3, 'moduleUpdated', { id: 'module-a' })],
      { appliedRevision: 1, hooks },
    )

    expect(result).toEqual({ status: 'error', error: 'collection failed' })
    expect(result).not.toHaveProperty('revision')
    expect(getResourceDatabase().language).toBe('en')
  })

  it('rejects a read older than its event and leaves the applied state unchanged', async () => {
    seedResources(1)
    api.settings.mockResolvedValue({ status: 'ok', revision: 1, settings: { language: 'not-applied' } })

    const result = await refreshInvalidatedServerResources(event(2, 'settings'), { appliedRevision: 1, hooks })

    expect(result).toMatchObject({ status: 'error', error: expect.stringContaining('older than event revision 2') })
    expect(result).not.toHaveProperty('revision')
    expect(getResourceDatabase().language).toBe('en')
  })
})
