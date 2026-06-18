import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import type { ActiveGenerationJob, ServerBootstrapResult } from './bootstrap'
import type { Database } from '../storage/database.svelte'

const projectionResyncSpies = vi.hoisted(() => ({
  fetchServerBootstrapProjectionReadOnly: vi.fn(),
  hydrateActiveCharacterLorebook: vi.fn(async () => undefined),
  hydrateActiveChat: vi.fn(async () => undefined),
  hydrateSelectedCharacterShell: vi.fn(async () => undefined),
  recordFullBootstrapResync: vi.fn(),
  recordHydratedCharacterLorebooks: vi.fn(),
  resetChatHydration: vi.fn(),
  resetLorebookHydration: vi.fn(),
  resetPromptTemplateHydration: vi.fn(),
  setActiveGenerationJobs: vi.fn(),
  startPromptTemplateHydration: vi.fn(),
  triggerOpenChatGenerationReattach: vi.fn(),
}))

vi.mock('../platform', () => ({ isFastifyServer: true }))

vi.mock('./bootstrap', () => ({
  fetchServerBootstrapProjectionReadOnly: projectionResyncSpies.fetchServerBootstrapProjectionReadOnly,
}))

vi.mock('./chatMessageHydration.svelte', () => ({
  hydrateActiveCharacterLorebook: projectionResyncSpies.hydrateActiveCharacterLorebook,
  hydrateActiveChat: projectionResyncSpies.hydrateActiveChat,
  resetChatHydration: projectionResyncSpies.resetChatHydration,
}))

vi.mock('./characterShellHydration.svelte', () => ({
  hydrateSelectedCharacterShell: projectionResyncSpies.hydrateSelectedCharacterShell,
}))

vi.mock('./lorebookBridge.svelte', () => ({
  recordHydratedCharacterLorebooks: projectionResyncSpies.recordHydratedCharacterLorebooks,
  resetLorebookHydration: projectionResyncSpies.resetLorebookHydration,
}))

vi.mock('./promptTemplateHydration', () => ({
  resetPromptTemplateHydration: projectionResyncSpies.resetPromptTemplateHydration,
  startPromptTemplateHydration: projectionResyncSpies.startPromptTemplateHydration,
}))

vi.mock('../process/reattach', () => ({
  setActiveGenerationJobs: projectionResyncSpies.setActiveGenerationJobs,
  triggerOpenChatGenerationReattach: projectionResyncSpies.triggerOpenChatGenerationReattach,
}))

vi.mock('../process/modules', () => ({
  getModuleLorebooks: vi.fn(() => []),
  getModules: vi.fn(() => []),
  moduleUpdate: vi.fn(),
}))

vi.mock('./protocolDiagnostics', () => ({
  recordFullBootstrapResync: projectionResyncSpies.recordFullBootstrapResync,
}))

import { DBState, selectedCharID } from '../stores.svelte'
import { clearCachedServerCommandRevision, peekCachedServerCommandRevision } from './commands'
import { forceServerProjectionResync } from './projectionResync'
import { setServerProjectionWriteGuardEnabled } from './projectionWriteGuard.svelte'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve
    reject = innerReject
  })
  return { promise, resolve, reject }
}

function okBootstrap(
  revision: number,
  database: Record<string, unknown>,
  activeGenerationJobs: ActiveGenerationJob[] = [],
): ServerBootstrapResult {
  return {
    status: 'ok',
    projection: {
      revision,
      database: database as Database,
      activeGenerationJobs,
    },
  }
}

function databaseFor(name: string, revision: number): Record<string, unknown> {
  return {
    characters: [{ chaId: `char-${revision}`, name, chats: [], globalLore: [{ key: name }] }],
    currentChar: 0,
    modules: [],
    personas: [],
    language: name,
  }
}

async function waitForBootstrapFetchCount(count: number): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    if (projectionResyncSpies.fetchServerBootstrapProjectionReadOnly.mock.calls.length >= count) return
    await Promise.resolve()
  }
  expect(projectionResyncSpies.fetchServerBootstrapProjectionReadOnly).toHaveBeenCalledTimes(count)
}

function expectNoApplySideEffects(): void {
  expect(peekCachedServerCommandRevision()).toBeNull()
  expect(projectionResyncSpies.resetPromptTemplateHydration).not.toHaveBeenCalled()
  expect(projectionResyncSpies.setActiveGenerationJobs).not.toHaveBeenCalled()
  expect(projectionResyncSpies.triggerOpenChatGenerationReattach).not.toHaveBeenCalled()
  expect(projectionResyncSpies.resetChatHydration).not.toHaveBeenCalled()
  expect(projectionResyncSpies.resetLorebookHydration).not.toHaveBeenCalled()
  expect(projectionResyncSpies.recordHydratedCharacterLorebooks).not.toHaveBeenCalled()
  expect(projectionResyncSpies.hydrateSelectedCharacterShell).not.toHaveBeenCalled()
  expect(projectionResyncSpies.hydrateActiveChat).not.toHaveBeenCalled()
  expect(projectionResyncSpies.hydrateActiveCharacterLorebook).not.toHaveBeenCalled()
  expect(projectionResyncSpies.startPromptTemplateHydration).not.toHaveBeenCalled()
}

let consoleWarnSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.stubGlobal('safeStructuredClone', (value: unknown) => JSON.parse(JSON.stringify(value)))
  consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  setServerProjectionWriteGuardEnabled(false)
  clearCachedServerCommandRevision()
  DBState.db = { characters: [], language: 'initial' } as Database
  selectedCharID.set(-1)
  projectionResyncSpies.fetchServerBootstrapProjectionReadOnly.mockReset()
  projectionResyncSpies.hydrateActiveCharacterLorebook.mockClear()
  projectionResyncSpies.hydrateActiveChat.mockClear()
  projectionResyncSpies.hydrateSelectedCharacterShell.mockClear()
  projectionResyncSpies.recordFullBootstrapResync.mockClear()
  projectionResyncSpies.recordHydratedCharacterLorebooks.mockClear()
  projectionResyncSpies.resetChatHydration.mockClear()
  projectionResyncSpies.resetLorebookHydration.mockClear()
  projectionResyncSpies.resetPromptTemplateHydration.mockClear()
  projectionResyncSpies.setActiveGenerationJobs.mockClear()
  projectionResyncSpies.startPromptTemplateHydration.mockClear()
  projectionResyncSpies.triggerOpenChatGenerationReattach.mockClear()
})

afterEach(() => {
  consoleWarnSpy.mockRestore()
  vi.unstubAllGlobals()
})

describe('forceServerProjectionResync', () => {
  it('skips an older in-flight bootstrap when a newer request arrives and applies the newer success once', async () => {
    const bootstraps: Deferred<ServerBootstrapResult>[] = []
    projectionResyncSpies.fetchServerBootstrapProjectionReadOnly.mockImplementation(() => {
      const response = deferred<ServerBootstrapResult>()
      bootstraps.push(response)
      return response.promise
    })

    const older = forceServerProjectionResync('older-bootstrap')
    expect(projectionResyncSpies.fetchServerBootstrapProjectionReadOnly).toHaveBeenCalledTimes(1)

    const newer = forceServerProjectionResync('newer-bootstrap')
    expect(projectionResyncSpies.fetchServerBootstrapProjectionReadOnly).toHaveBeenCalledTimes(1)

    bootstraps[0].resolve(okBootstrap(10, databaseFor('older', 10), [{ chatId: 'old-chat', jobId: 'old-job' }]))
    await waitForBootstrapFetchCount(2)
    expect(DBState.db).toMatchObject({ language: 'initial', characters: [] })
    expectNoApplySideEffects()

    bootstraps[1].resolve(okBootstrap(11, databaseFor('newer', 11), [{ chatId: 'new-chat', jobId: 'new-job' }]))

    await expect(Promise.all([older, newer])).resolves.toEqual([
      { status: 'ok', revision: 11 },
      { status: 'ok', revision: 11 },
    ])
    expect(DBState.db).toMatchObject({
      language: 'newer',
      characters: [{ chaId: 'char-11', name: 'newer' }],
    })
    expect(peekCachedServerCommandRevision()).toBe(11)
    expect(projectionResyncSpies.setActiveGenerationJobs).toHaveBeenCalledTimes(1)
    expect(projectionResyncSpies.setActiveGenerationJobs).toHaveBeenCalledWith([
      { chatId: 'new-chat', jobId: 'new-job' },
    ])
    expect(projectionResyncSpies.resetChatHydration).toHaveBeenCalledTimes(1)
    expect(projectionResyncSpies.hydrateActiveChat).toHaveBeenCalledTimes(1)
    expect(projectionResyncSpies.hydrateActiveChat).toHaveBeenCalledWith({ force: true })
    expect(projectionResyncSpies.recordFullBootstrapResync).toHaveBeenCalledTimes(2)
  })

  it('returns a newer failure after skipping an older success and leaves the old projection unapplied', async () => {
    const bootstraps: Deferred<ServerBootstrapResult>[] = []
    projectionResyncSpies.fetchServerBootstrapProjectionReadOnly.mockImplementation(() => {
      const response = deferred<ServerBootstrapResult>()
      bootstraps.push(response)
      return response.promise
    })

    const older = forceServerProjectionResync('older-bootstrap')
    const newer = forceServerProjectionResync('newer-bootstrap')

    bootstraps[0].resolve(okBootstrap(20, databaseFor('older', 20), [{ chatId: 'old-chat', jobId: 'old-job' }]))
    await waitForBootstrapFetchCount(2)
    expect(DBState.db).toMatchObject({ language: 'initial', characters: [] })
    expectNoApplySideEffects()

    bootstraps[1].resolve({ status: 'error', error: 'newer bootstrap failed' })

    await expect(Promise.all([older, newer])).resolves.toEqual([
      { status: 'error', error: 'newer bootstrap failed' },
      { status: 'error', error: 'newer bootstrap failed' },
    ])
    expect(DBState.db).toMatchObject({ language: 'initial', characters: [] })
    expectNoApplySideEffects()
  })

  it('keeps single resync success behavior intact', async () => {
    const activeGenerationJobs = [{ chatId: 'chat-a', jobId: 'job-a' }]
    projectionResyncSpies.fetchServerBootstrapProjectionReadOnly.mockResolvedValue(
      okBootstrap(
        30,
        {
          characters: [
            { chaId: 'char-a', name: 'Alpha', chats: [], globalLore: [{ key: 'alpha' }] },
            { chaId: 'char-b', name: 'Beta', chats: [] },
          ],
          currentChar: 1,
          modules: [],
          personas: [],
          language: 'ko',
        },
        activeGenerationJobs,
      ),
    )
    selectedCharID.set(0)

    await expect(forceServerProjectionResync('single-bootstrap')).resolves.toEqual({
      status: 'ok',
      revision: 30,
    })

    expect(DBState.db).toMatchObject({
      language: 'ko',
      characters: [
        { chaId: 'char-a', name: 'Alpha' },
        { chaId: 'char-b', name: 'Beta' },
      ],
    })
    expect(get(selectedCharID)).toBe(1)
    expect(peekCachedServerCommandRevision()).toBe(30)
    expect(projectionResyncSpies.resetPromptTemplateHydration).toHaveBeenCalledTimes(1)
    expect(projectionResyncSpies.setActiveGenerationJobs).toHaveBeenCalledWith(activeGenerationJobs)
    expect(projectionResyncSpies.triggerOpenChatGenerationReattach).toHaveBeenCalledTimes(1)
    expect(projectionResyncSpies.resetChatHydration).toHaveBeenCalledTimes(1)
    expect(projectionResyncSpies.resetLorebookHydration).toHaveBeenCalledTimes(1)
    expect(projectionResyncSpies.recordHydratedCharacterLorebooks).toHaveBeenCalledWith([
      { chaId: 'char-a', name: 'Alpha', chats: [], globalLore: [{ key: 'alpha' }] },
      { chaId: 'char-b', name: 'Beta', chats: [] },
    ])
    expect(projectionResyncSpies.hydrateSelectedCharacterShell).toHaveBeenCalledTimes(1)
    expect(projectionResyncSpies.hydrateActiveChat).toHaveBeenCalledWith({ force: true })
    expect(projectionResyncSpies.hydrateActiveCharacterLorebook).toHaveBeenCalledWith({ force: true })
    expect(projectionResyncSpies.startPromptTemplateHydration).toHaveBeenCalledTimes(1)
  })
})
