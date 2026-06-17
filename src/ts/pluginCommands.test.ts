import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'plugin-command-token',
}))

import { clearCachedServerCommandRevision } from './server/commands'
import {
  setServerProjectionWriteGuardEnabled,
  withTrustedServerProjectionWrite,
} from './server/projectionWriteGuard.svelte'
import { DBState } from './stores.svelte'
import {
  currentPluginStorageSnapshot,
  deletePlugin,
  dispatchBulkPluginStorage,
  dispatchDeletePluginStorage,
  dispatchPutPluginStorage,
  setPluginArgument,
  togglePluginEnabled,
} from './pluginCommands'
import type { RisuPlugin } from './plugins/plugins.svelte'

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

function cloneJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function seedPlugin(name: string, overrides: Partial<RisuPlugin> = {}): RisuPlugin {
  return {
    name,
    script: 'Risuai.log("plugin")',
    arguments: {},
    realArg: {},
    version: '3.0',
    customLink: [],
    argMeta: {},
    enabled: true,
    ...overrides,
  }
}

function seedPluginState(): void {
  DBState.db = {
    currentPluginProvider: 'plugin-a',
    pluginCustomStorage: {
      retained: { value: 1 },
    },
    plugins: [
      seedPlugin('plugin-a', {
        arguments: { mode: ['fast', 'slow'] },
        realArg: { mode: 'fast', token: 'abc' },
        enabled: true,
      }),
      seedPlugin('plugin-b', {
        realArg: { mode: 'standby' },
        enabled: false,
      }),
    ],
  } as any
}

function stubCommandFetch(options: { failCommands?: boolean } = {}): CapturedFetch[] {
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
      if (options.failCommands) return jsonResponse({ error: 'forced failure' }, 500)
      return jsonResponse({
        revision: 11,
        event: { type: 'plugin.updated', revision: 11, resource: 'plugin', id: 'plugin-a' },
      })
    }) as unknown as typeof fetch,
  )
  return calls
}

function stubDeferredCommandFetch(): {
  calls: CapturedFetch[]
  commandResponses: Array<{ resolve: (response: Response) => void }>
} {
  const calls: CapturedFetch[] = []
  const commandResponses: Array<{ resolve: (response: Response) => void }> = []
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
      return new Promise<Response>((resolve) => {
        commandResponses.push({ resolve })
      })
    }) as unknown as typeof fetch,
  )
  return { calls, commandResponses }
}

async function waitForCallCount(calls: CapturedFetch[], expected: number): Promise<void> {
  for (let attempt = 0; attempt < 20 && calls.length < expected; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  expect(calls).toHaveLength(expected)
}

async function flushCommandEffects(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function writePluginStorage(storage: Record<string, unknown>): void {
  withTrustedServerProjectionWrite(() => {
    DBState.db.pluginCustomStorage = cloneJsonValue(storage)
  })
}

beforeEach(() => {
  clearCachedServerCommandRevision()
  setServerProjectionWriteGuardEnabled(false)
  vi.unstubAllGlobals()
  seedPluginState()
})

afterEach(() => {
  setServerProjectionWriteGuardEnabled(false)
  vi.unstubAllGlobals()
})

describe('plugin projection command helpers', () => {
  it('updates plugin arguments, dispatches the update command, and rolls back on failure', async () => {
    const calls = stubCommandFetch({ failCommands: true })
    const previousPlugins = cloneJsonValue(DBState.db.plugins)
    const previousStorage = cloneJsonValue(DBState.db.pluginCustomStorage)
    setServerProjectionWriteGuardEnabled(true)

    expect(() => {
      DBState.db.plugins[0].realArg.mode = 'raw'
    }).toThrow(/read-only server projection/)

    expect(setPluginArgument('plugin-a', 'mode', 'slow')).toBe(true)
    expect(DBState.db.plugins[0].realArg).toEqual({ mode: 'slow', token: 'abc' })

    await waitForCallCount(calls, 2)
    await flushCommandEffects()

    expect(calls).toEqual([
      {
        url: '/api/v1/bootstrap',
        method: 'GET',
        authHeader: 'plugin-command-token',
        body: null,
      },
      {
        url: '/api/v1/commands/plugins/plugin-a',
        method: 'PATCH',
        authHeader: 'plugin-command-token',
        body: {
          baseRevision: 10,
          patch: {
            realArg: { mode: 'slow', token: 'abc' },
          },
        },
      },
    ])
    expect(DBState.db.plugins).toEqual(previousPlugins)
    expect(DBState.db.currentPluginProvider).toBe('plugin-a')
    expect(DBState.db.pluginCustomStorage).toEqual(previousStorage)
  })

  it('toggles enabled state, dispatches the enable command, and rolls back on failure', async () => {
    const calls = stubCommandFetch({ failCommands: true })
    const previousPlugins = cloneJsonValue(DBState.db.plugins)
    const previousStorage = cloneJsonValue(DBState.db.pluginCustomStorage)
    setServerProjectionWriteGuardEnabled(true)

    expect(togglePluginEnabled('plugin-a')).toBe(true)
    expect(DBState.db.plugins[0].enabled).toBe(false)

    await waitForCallCount(calls, 2)
    await flushCommandEffects()

    expect(calls).toEqual([
      {
        url: '/api/v1/bootstrap',
        method: 'GET',
        authHeader: 'plugin-command-token',
        body: null,
      },
      {
        url: '/api/v1/commands/plugins/plugin-a/enable',
        method: 'POST',
        authHeader: 'plugin-command-token',
        body: {
          baseRevision: 10,
          enabled: false,
        },
      },
    ])
    expect(DBState.db.plugins).toEqual(previousPlugins)
    expect(DBState.db.currentPluginProvider).toBe('plugin-a')
    expect(DBState.db.pluginCustomStorage).toEqual(previousStorage)
  })

  it('deletes plugins, clears the current provider, dispatches delete, and rolls back on failure', async () => {
    const calls = stubCommandFetch({ failCommands: true })
    const previousPlugins = cloneJsonValue(DBState.db.plugins)
    const previousProvider = DBState.db.currentPluginProvider
    const previousStorage = cloneJsonValue(DBState.db.pluginCustomStorage)
    setServerProjectionWriteGuardEnabled(true)

    expect(deletePlugin('plugin-a')).toBe(true)
    expect(DBState.db.plugins.map((plugin) => plugin.name)).toEqual(['plugin-b'])
    expect(DBState.db.currentPluginProvider).toBe('')

    await waitForCallCount(calls, 2)
    await flushCommandEffects()

    expect(calls).toEqual([
      {
        url: '/api/v1/bootstrap',
        method: 'GET',
        authHeader: 'plugin-command-token',
        body: null,
      },
      {
        url: '/api/v1/commands/plugins/plugin-a',
        method: 'DELETE',
        authHeader: 'plugin-command-token',
        body: {
          baseRevision: 10,
        },
      },
    ])
    expect(DBState.db.plugins).toEqual(previousPlugins)
    expect(DBState.db.currentPluginProvider).toBe(previousProvider)
    expect(DBState.db.pluginCustomStorage).toEqual(previousStorage)
  })

  it('returns false for missing plugin names without commands or projection changes', () => {
    const calls = stubCommandFetch()
    const previousPlugins = cloneJsonValue(DBState.db.plugins)
    const previousProvider = DBState.db.currentPluginProvider
    const previousStorage = cloneJsonValue(DBState.db.pluginCustomStorage)
    setServerProjectionWriteGuardEnabled(true)

    expect(setPluginArgument('missing-plugin', 'mode', 'slow')).toBe(false)
    expect(togglePluginEnabled('missing-plugin')).toBe(false)
    expect(deletePlugin('missing-plugin')).toBe(false)

    expect(calls).toHaveLength(0)
    expect(DBState.db.plugins).toEqual(previousPlugins)
    expect(DBState.db.currentPluginProvider).toBe(previousProvider)
    expect(DBState.db.pluginCustomStorage).toEqual(previousStorage)
  })

  it('failed PUT restores only the attempted key and preserves newer sibling keys', async () => {
    const calls = stubCommandFetch({ failCommands: true })
    setServerProjectionWriteGuardEnabled(true)
    writePluginStorage({
      attempted: { value: 'old' },
      sibling: { value: 'kept' },
    })
    const previous = currentPluginStorageSnapshot()

    withTrustedServerProjectionWrite(() => {
      DBState.db.pluginCustomStorage.attempted = { value: 'attempted' }
    })
    dispatchPutPluginStorage('attempted', { value: 'attempted' }, previous)
    withTrustedServerProjectionWrite(() => {
      DBState.db.pluginCustomStorage.newerSibling = { value: 'newer' }
    })

    await waitForCallCount(calls, 2)
    await flushCommandEffects()

    expect(calls[1]).toMatchObject({
      url: '/api/v1/commands/plugin-storage/attempted',
      method: 'PUT',
      body: {
        baseRevision: 10,
        value: { value: 'attempted' },
      },
    })
    expect(DBState.db.pluginCustomStorage).toEqual({
      attempted: { value: 'old' },
      sibling: { value: 'kept' },
      newerSibling: { value: 'newer' },
    })
  })

  it('failed PUT skips rollback if the same key changed again', async () => {
    const calls = stubCommandFetch({ failCommands: true })
    setServerProjectionWriteGuardEnabled(true)
    writePluginStorage({
      attempted: { value: 'old' },
      sibling: { value: 'kept' },
    })
    const previous = currentPluginStorageSnapshot()

    withTrustedServerProjectionWrite(() => {
      DBState.db.pluginCustomStorage.attempted = { value: 'attempted' }
    })
    dispatchPutPluginStorage('attempted', { value: 'attempted' }, previous)
    withTrustedServerProjectionWrite(() => {
      DBState.db.pluginCustomStorage.attempted = { value: 'newer' }
    })

    await waitForCallCount(calls, 2)
    await flushCommandEffects()

    expect(DBState.db.pluginCustomStorage).toEqual({
      attempted: { value: 'newer' },
      sibling: { value: 'kept' },
    })
  })

  it('failed same-key PUTs roll back to the original value when the newer PUT fails first', async () => {
    const { calls, commandResponses } = stubDeferredCommandFetch()
    setServerProjectionWriteGuardEnabled(true)
    writePluginStorage({
      attempted: { value: 'old' },
      sibling: { value: 'kept' },
    })

    const firstPrevious = currentPluginStorageSnapshot()
    withTrustedServerProjectionWrite(() => {
      DBState.db.pluginCustomStorage.attempted = { value: 'A' }
    })
    dispatchPutPluginStorage('attempted', { value: 'A' }, firstPrevious)

    await waitForCallCount(calls, 2)

    const secondPrevious = currentPluginStorageSnapshot()
    withTrustedServerProjectionWrite(() => {
      DBState.db.pluginCustomStorage.attempted = { value: 'B' }
    })
    dispatchPutPluginStorage('attempted', { value: 'B' }, secondPrevious)

    await waitForCallCount(calls, 3)
    expect(calls[1]).toMatchObject({
      url: '/api/v1/commands/plugin-storage/attempted',
      method: 'PUT',
      body: {
        baseRevision: 10,
        value: { value: 'A' },
      },
    })
    expect(calls[2]).toMatchObject({
      url: '/api/v1/commands/plugin-storage/attempted',
      method: 'PUT',
      body: {
        baseRevision: 10,
        value: { value: 'B' },
      },
    })

    commandResponses[1].resolve(jsonResponse({ error: 'forced newer failure' }, 500))
    await flushCommandEffects()

    expect(DBState.db.pluginCustomStorage).toEqual({
      attempted: { value: 'A' },
      sibling: { value: 'kept' },
    })

    commandResponses[0].resolve(jsonResponse({ error: 'forced older failure' }, 500))
    await flushCommandEffects()

    expect(DBState.db.pluginCustomStorage).toEqual({
      attempted: { value: 'old' },
      sibling: { value: 'kept' },
    })
  })

  it('failed same-key PUTs roll back to the original value when the older PUT fails first', async () => {
    const { calls, commandResponses } = stubDeferredCommandFetch()
    setServerProjectionWriteGuardEnabled(true)
    writePluginStorage({
      attempted: { value: 'old' },
      sibling: { value: 'kept' },
    })

    const firstPrevious = currentPluginStorageSnapshot()
    withTrustedServerProjectionWrite(() => {
      DBState.db.pluginCustomStorage.attempted = { value: 'A' }
    })
    dispatchPutPluginStorage('attempted', { value: 'A' }, firstPrevious)

    await waitForCallCount(calls, 2)

    const secondPrevious = currentPluginStorageSnapshot()
    withTrustedServerProjectionWrite(() => {
      DBState.db.pluginCustomStorage.attempted = { value: 'B' }
    })
    dispatchPutPluginStorage('attempted', { value: 'B' }, secondPrevious)

    await waitForCallCount(calls, 3)

    commandResponses[0].resolve(jsonResponse({ error: 'forced older failure' }, 500))
    await flushCommandEffects()

    expect(DBState.db.pluginCustomStorage).toEqual({
      attempted: { value: 'B' },
      sibling: { value: 'kept' },
    })

    commandResponses[1].resolve(jsonResponse({ error: 'forced newer failure' }, 500))
    await flushCommandEffects()

    expect(DBState.db.pluginCustomStorage).toEqual({
      attempted: { value: 'old' },
      sibling: { value: 'kept' },
    })
  })

  it('failed DELETE restores only the deleted key and preserves newer sibling keys', async () => {
    const calls = stubCommandFetch({ failCommands: true })
    setServerProjectionWriteGuardEnabled(true)
    writePluginStorage({
      deleted: { value: 'old' },
      sibling: { value: 'kept' },
    })
    const previous = currentPluginStorageSnapshot()

    withTrustedServerProjectionWrite(() => {
      delete DBState.db.pluginCustomStorage.deleted
    })
    dispatchDeletePluginStorage('deleted', previous)
    withTrustedServerProjectionWrite(() => {
      DBState.db.pluginCustomStorage.newerSibling = { value: 'newer' }
    })

    await waitForCallCount(calls, 2)
    await flushCommandEffects()

    expect(calls[1]).toMatchObject({
      url: '/api/v1/commands/plugin-storage/deleted',
      method: 'DELETE',
      body: {
        baseRevision: 10,
      },
    })
    expect(DBState.db.pluginCustomStorage).toEqual({
      deleted: { value: 'old' },
      sibling: { value: 'kept' },
      newerSibling: { value: 'newer' },
    })
  })

  it('failed bulk clear/replace restores only keys still matching the attempted bulk state', async () => {
    const calls = stubCommandFetch({ failCommands: true })
    setServerProjectionWriteGuardEnabled(true)
    writePluginStorage({
      restoreCleared: { value: 'old-cleared' },
      changedAfterClear: { value: 'old-changed' },
      restoreReplaced: { value: 'old-replaced' },
      changedAfterReplace: { value: 'old-replaced-again' },
    })
    const previous = currentPluginStorageSnapshot()

    withTrustedServerProjectionWrite(() => {
      DBState.db.pluginCustomStorage = {
        restoreReplaced: { value: 'bulk-replaced' },
        changedAfterReplace: { value: 'bulk-replaced-again' },
      }
    })
    dispatchBulkPluginStorage(
      {
        values: {
          restoreReplaced: { value: 'bulk-replaced' },
          changedAfterReplace: { value: 'bulk-replaced-again' },
        },
        clear: true,
      },
      previous,
    )
    withTrustedServerProjectionWrite(() => {
      DBState.db.pluginCustomStorage.changedAfterClear = { value: 'newer-same-key' }
      DBState.db.pluginCustomStorage.changedAfterReplace = { value: 'newer-replacement' }
      DBState.db.pluginCustomStorage.laterAdded = { value: 'newer-sibling' }
    })

    await waitForCallCount(calls, 2)
    await flushCommandEffects()

    expect(calls[1]).toMatchObject({
      url: '/api/v1/commands/plugin-storage/bulk',
      method: 'POST',
      body: {
        baseRevision: 10,
        values: {
          restoreReplaced: { value: 'bulk-replaced' },
          changedAfterReplace: { value: 'bulk-replaced-again' },
        },
        deleteKeys: [],
        clear: true,
      },
    })
    expect(DBState.db.pluginCustomStorage).toEqual({
      restoreReplaced: { value: 'old-replaced' },
      changedAfterReplace: { value: 'newer-replacement' },
      changedAfterClear: { value: 'newer-same-key' },
      laterAdded: { value: 'newer-sibling' },
      restoreCleared: { value: 'old-cleared' },
    })
  })
})
