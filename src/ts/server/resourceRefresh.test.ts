import { beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'

const refreshApi = vi.hoisted(() => ({ refreshAll: vi.fn() }))
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

import { forceServerResourceRefresh } from './resourceRefresh'
import {
  clearAppliedServerResourceRevision,
  clearCachedServerCommandRevision,
  peekAppliedServerResourceRevision,
  peekCachedServerCommandRevision,
} from './commands'
import { replaceResourceDatabase, resetServerResourceState } from './resourceState.svelte'
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

describe('complete server resource refresh', () => {
  it('advances cursors only after success and refreshes transient runtime state', async () => {
    await expect(forceServerResourceRefresh('backup-restore')).resolves.toEqual({ status: 'ok', revision: 5 })

    expect(peekCachedServerCommandRevision()).toBe(5)
    expect(peekAppliedServerResourceRevision()).toBe(5)
    expect(get(selectedCharID)).toBe(1)
    expect(sideEffects.resetChatHydration).toHaveBeenCalledTimes(1)
    expect(sideEffects.hydrateActiveChat).toHaveBeenCalledWith({ force: true })
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

  it('does not advance cursors or run hydration side effects after a failed read', async () => {
    refreshApi.refreshAll.mockResolvedValueOnce({ status: 'error', error: 'settings failed' })

    await expect(forceServerResourceRefresh('backup-restore')).resolves.toEqual({
      status: 'error',
      error: 'settings failed',
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
