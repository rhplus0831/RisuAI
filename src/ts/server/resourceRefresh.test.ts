import { beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'

const refreshApi = vi.hoisted(() => ({
  refreshAll: vi.fn(),
  refreshInvalidated: vi.fn(),
}))
const bootstrapApi = vi.hoisted(() => ({ fetchReadOnly: vi.fn() }))
const sideEffects = vi.hoisted(() => ({
  hydrateActiveChat: vi.fn(async () => undefined),
  resetChatHydration: vi.fn(),
  recordLorebooks: vi.fn(),
  resetLorebooks: vi.fn(),
  setGenerationJobs: vi.fn(),
  triggerReattach: vi.fn(),
  setTranslations: vi.fn(),
  recordRefresh: vi.fn(),
  hydratePromptTemplate: vi.fn(async () => true),
}))

vi.mock('../process/modules', () => ({
  getModuleAssets: vi.fn(() => []),
  getModuleLorebooks: vi.fn(() => []),
  getModules: vi.fn(() => []),
  moduleUpdate: vi.fn(),
}))
vi.mock('../model/modellist', () => ({ getModelInfo: vi.fn(() => ({ type: 'chat' })) }))

vi.mock('./resourceInvalidation', () => ({
  refreshAllServerResources: refreshApi.refreshAll,
  refreshInvalidatedServerResources: refreshApi.refreshInvalidated,
}))
vi.mock('./bootstrap', () => ({ fetchServerBootstrapReadOnly: bootstrapApi.fetchReadOnly }))
vi.mock('./chatMessageHydration.svelte', () => ({
  applyServerChatMessagesResource: vi.fn(() => true),
  hydrateActiveChat: sideEffects.hydrateActiveChat,
  resetChatHydration: sideEffects.resetChatHydration,
}))
vi.mock('./lorebookBridge.svelte', () => ({
  applyServerCharacterLorebookResource: vi.fn(() => true),
  markCharacterLorebookHydrated: vi.fn(),
  recordHydratedCharacterLorebooks: sideEffects.recordLorebooks,
  resetLorebookHydration: sideEffects.resetLorebooks,
}))
vi.mock('../pluginCommands', () => ({
  mergePendingPluginStorageResource: vi.fn((value) => value),
}))
vi.mock('../process/reattach', () => ({
  setActiveGenerationJobs: sideEffects.setGenerationJobs,
  triggerOpenChatGenerationReattach: sideEffects.triggerReattach,
}))
vi.mock('./messageTranslationJobs', () => ({
  clearActiveMessageTranslation: vi.fn(),
  setActiveMessageTranslations: sideEffects.setTranslations,
}))
vi.mock('./protocolDiagnostics', () => ({ recordFullResourceRefresh: sideEffects.recordRefresh }))
vi.mock('./promptTemplateHydration', () => ({
  ensurePromptTemplateHydrated: sideEffects.hydratePromptTemplate,
}))

import { forceServerResourceRefresh, refreshServerRealmImportResources } from './resourceRefresh'
import {
  clearAppliedServerResourceRevision,
  clearCachedServerCommandRevision,
  peekAppliedServerResourceRevision,
  peekCachedServerCommandRevision,
  setAppliedServerResourceRevision,
  setCachedServerCommandRevision,
} from './commands'
import { getResourceDatabase, replaceResourceDatabase, resetServerResourceState } from './resourceState.svelte'
import { setResourceWriteGuardEnabled } from '../storage/database.svelte'
import { selectedCharID } from '../stores.svelte'

function database(characters: Array<{ chaId: string; name: string }>, currentChar = 0) {
  return {
    characters: characters.map((character) => ({
      ...character,
      type: 'character',
      chatPage: 0,
      chats: [{ id: `chat-${character.chaId}`, message: [] }],
    })),
    characterOrder: characters.map((character) => character.chaId),
    currentChar,
    modules: [],
    personas: [],
    botPresets: [],
  } as never
}

beforeEach(() => {
  vi.clearAllMocks()
  setResourceWriteGuardEnabled(false)
  resetServerResourceState()
  replaceResourceDatabase(
    database(
      [
        { chaId: 'char-a', name: 'Ada' },
        { chaId: 'char-b', name: 'Bea' },
      ],
      0,
    ),
    4,
  )
  selectedCharID.set(1)
  clearCachedServerCommandRevision()
  clearAppliedServerResourceRevision()
  refreshApi.refreshAll.mockResolvedValue({ status: 'ok', revision: 5, scope: 'full' })
  refreshApi.refreshInvalidated.mockResolvedValue({ status: 'ok', revision: 5, scope: 'targeted' })
  bootstrapApi.fetchReadOnly.mockResolvedValue({
    status: 'ok',
    bootstrap: {
      initialized: true,
      revision: 5,
      activeGenerationJobs: [{ chatId: 'chat-b', jobId: 'job-b' }],
      activeMessageTranslations: [{ chatId: 'chat-b', messageId: 'message-b' }],
    },
  })
})

describe('Realm import resource refresh', () => {
  it('applies a contiguous character-created event without destructive refresh side effects', async () => {
    const event = {
      type: 'character.created',
      resource: 'character',
      revision: 21,
      id: 'char-imported',
    }
    setCachedServerCommandRevision(20)
    setAppliedServerResourceRevision(20)
    refreshApi.refreshInvalidated.mockImplementationOnce(async () => {
      replaceResourceDatabase(
        database([
          { chaId: 'char-a', name: 'Ada' },
          { chaId: 'char-b', name: 'Bea' },
          { chaId: 'char-imported', name: 'Imported' },
        ]),
        21,
      )
      return { status: 'ok', revision: 21, scope: 'targeted' }
    })

    await expect(
      refreshServerRealmImportResources({
        revision: 21,
        event,
        characterId: 'char-imported',
      }),
    ).resolves.toEqual({ status: 'ok', revision: 21 })

    expect(refreshApi.refreshInvalidated).toHaveBeenCalledWith(event, {
      appliedRevision: 20,
      hooks: expect.any(Object),
    })
    expect(refreshApi.refreshAll).not.toHaveBeenCalled()
    expect(sideEffects.recordRefresh).not.toHaveBeenCalled()
    expect(bootstrapApi.fetchReadOnly).not.toHaveBeenCalled()
    expect(sideEffects.resetChatHydration).not.toHaveBeenCalled()
    expect(sideEffects.resetLorebooks).not.toHaveBeenCalled()
    expect(sideEffects.hydrateActiveChat).not.toHaveBeenCalled()
    expect(sideEffects.triggerReattach).not.toHaveBeenCalled()
    expect(sideEffects.recordLorebooks).toHaveBeenCalledTimes(1)
    expect(peekCachedServerCommandRevision()).toBe(21)
    expect(peekAppliedServerResourceRevision()).toBe(21)
  })

  it('retains a complete refresh when the returned event crosses a revision gap', async () => {
    setCachedServerCommandRevision(22)
    setAppliedServerResourceRevision(20)
    refreshApi.refreshAll.mockResolvedValueOnce({ status: 'ok', revision: 22, scope: 'full' })

    await expect(
      refreshServerRealmImportResources({
        revision: 22,
        event: {
          type: 'character.created',
          resource: 'character',
          revision: 22,
          id: 'char-imported',
        },
        characterId: 'char-imported',
      }),
    ).resolves.toEqual({ status: 'ok', revision: 22 })

    expect(refreshApi.refreshInvalidated).not.toHaveBeenCalled()
    expect(refreshApi.refreshAll).toHaveBeenCalledTimes(1)
    expect(sideEffects.recordRefresh).toHaveBeenCalledWith('realm-import', 'character')
  })
})

describe('complete server resource refresh', () => {
  it('advances cursors only after success and refreshes transient runtime state', async () => {
    await expect(forceServerResourceRefresh('backup-restore')).resolves.toEqual({ status: 'ok', revision: 5 })

    expect(peekCachedServerCommandRevision()).toBe(5)
    expect(peekAppliedServerResourceRevision()).toBe(5)
    expect(get(selectedCharID)).toBe(1)
    expect(sideEffects.resetChatHydration).toHaveBeenCalledTimes(1)
    expect(sideEffects.hydrateActiveChat).toHaveBeenCalledWith({ force: true })
    expect(sideEffects.hydratePromptTemplate).toHaveBeenCalledWith({ force: true, minimumRevision: 5 })
    expect(sideEffects.setGenerationJobs).toHaveBeenCalledWith([{ chatId: 'chat-b', jobId: 'job-b' }])
    expect(sideEffects.setTranslations).toHaveBeenCalledWith([{ chatId: 'chat-b', messageId: 'message-b' }])
    expect(sideEffects.recordRefresh).toHaveBeenCalledWith('backup-restore', undefined)
  })

  it('preserves the selected character identity when a refresh reorders rows', async () => {
    refreshApi.refreshAll.mockImplementationOnce(async () => {
      replaceResourceDatabase(
        database(
          [
            { chaId: 'char-b', name: 'Bea refreshed' },
            { chaId: 'char-a', name: 'Ada refreshed' },
          ],
          1,
        ),
        6,
      )
      return { status: 'ok', revision: 6, scope: 'full' }
    })

    await forceServerResourceRefresh('realm-import')
    expect(get(selectedCharID)).toBe(0)
  })

  it('preserves a newer selection by character id when a pending refresh reorders rows', async () => {
    let finishRead!: () => void
    const readFinished = new Promise<void>((resolve) => {
      finishRead = resolve
    })
    refreshApi.refreshAll.mockImplementationOnce(async () => {
      await readFinished
      replaceResourceDatabase(
        database(
          [
            { chaId: 'char-b', name: 'Bea refreshed' },
            { chaId: 'char-a', name: 'Ada refreshed' },
          ],
          0,
        ),
        6,
      )
      return { status: 'ok', revision: 6, scope: 'full' }
    })

    const refresh = forceServerResourceRefresh('backup-restore')
    await vi.waitFor(() => expect(refreshApi.refreshAll).toHaveBeenCalledTimes(1))
    selectedCharID.set(0)
    finishRead()
    await refresh

    expect(get(selectedCharID)).toBe(1)
    expect(getResourceDatabase().characters[get(selectedCharID)]?.chaId).toBe('char-a')
  })

  it('does not advance cursors or run hydration side effects after a failed read', async () => {
    refreshApi.refreshAll.mockResolvedValueOnce({ status: 'error', error: 'settings failed' })

    await expect(forceServerResourceRefresh('backup-restore')).resolves.toEqual({
      status: 'error',
      error: 'settings failed',
    })
    expect(peekCachedServerCommandRevision()).toBeNull()
    expect(peekAppliedServerResourceRevision()).toBeNull()
    expect(sideEffects.resetChatHydration).not.toHaveBeenCalled()
    expect(sideEffects.hydratePromptTemplate).not.toHaveBeenCalled()
    expect(bootstrapApi.fetchReadOnly).not.toHaveBeenCalled()
  })

  it('does not complete a full refresh when the selected prompt-template owner cannot be hydrated', async () => {
    sideEffects.hydratePromptTemplate.mockResolvedValueOnce(false)

    await expect(forceServerResourceRefresh('backup-restore')).resolves.toEqual({
      status: 'error',
      error: 'Selected prompt-template owner hydration failed',
    })

    expect(peekCachedServerCommandRevision()).toBeNull()
    expect(peekAppliedServerResourceRevision()).toBeNull()
    expect(sideEffects.resetChatHydration).not.toHaveBeenCalled()
    expect(bootstrapApi.fetchReadOnly).not.toHaveBeenCalled()
  })

  it('coalesces overlapping requests and performs one pending follow-up refresh', async () => {
    let resolveFirst: ((value: { status: 'ok'; revision: number; scope: 'full' }) => void) | undefined
    refreshApi.refreshAll
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve
          }),
      )
      .mockResolvedValueOnce({ status: 'ok', revision: 7, scope: 'full' })

    const first = forceServerResourceRefresh('first')
    const second = forceServerResourceRefresh('second')
    expect(refreshApi.refreshAll).toHaveBeenCalledTimes(1)
    resolveFirst?.({ status: 'ok', revision: 6, scope: 'full' })

    await expect(Promise.all([first, second])).resolves.toEqual([
      { status: 'ok', revision: 7 },
      { status: 'ok', revision: 7 },
    ])
    expect(refreshApi.refreshAll).toHaveBeenCalledTimes(2)
  })
})
