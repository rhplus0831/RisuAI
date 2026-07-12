import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'plugin-command-token',
}))

import { clearCachedServerCommandRevision, type PluginSnapshot } from './server/commands'
import { setResourceWriteGuardEnabled, withTrustedResourceWrite } from './server/resourceWriteGuard.svelte'
import {
  getResourceDatabase as getDatabase,
  replaceResourceDatabase as setDatabaseLite,
} from './server/resourceState.svelte'
import type { Database } from './storage/database.svelte'
import {
  currentPluginSettingsPatchRollbackSnapshot,
  currentPluginStateSnapshot,
  currentPluginStorageSnapshot,
  deletePlugin,
  dispatchCreatePlugin,
  dispatchReorderPlugins,
  dispatchSelectPluginProvider,
  dispatchBulkPluginStorage,
  dispatchDeletePluginStorage,
  dispatchDeletePlugin,
  dispatchPluginSettingsPatch,
  dispatchPutPluginStorage,
  dispatchUpdatePlugin,
  mergePendingPluginStorageResource,
  preservePendingPluginStorageInDatabase,
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

function customModelRows(rows: Array<{ id: string; name: string }>): Database['customModels'] {
  return rows as unknown as Database['customModels']
}

function dbRecord(): Record<string, unknown> {
  return getDatabase() as unknown as Record<string, unknown>
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
  setDatabaseLite({
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
  } as unknown as Database)
}

function stubCommandFetch(options: { failCommands?: boolean; failCommandUrls?: string[] } = {}): CapturedFetch[] {
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
      if (options.failCommands || options.failCommandUrls?.includes(url)) {
        return jsonResponse({ error: 'forced failure' }, 500)
      }
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

function stubDelayedBootstrapCommandFetch(): {
  calls: CapturedFetch[]
  resolveBootstrap: (response: Response) => void
} {
  const calls: CapturedFetch[] = []
  let resolveBootstrap: (response: Response) => void = () => undefined
  const bootstrapResponse = new Promise<Response>((resolve) => {
    resolveBootstrap = resolve
  })
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

      if (url === '/api/v1/bootstrap') return bootstrapResponse
      return jsonResponse({
        revision: 11,
        event: { type: 'plugin.updated', revision: 11, resource: 'plugin', id: 'plugin-a' },
      })
    }) as unknown as typeof fetch,
  )
  return { calls, resolveBootstrap }
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
  withTrustedResourceWrite(() => {
    getDatabase().pluginCustomStorage = cloneJsonValue(storage)
  })
}

beforeEach(() => {
  clearCachedServerCommandRevision()
  setResourceWriteGuardEnabled(false)
  vi.unstubAllGlobals()
  seedPluginState()
})

afterEach(() => {
  setResourceWriteGuardEnabled(false)
  vi.unstubAllGlobals()
})

describe('plugin projection command helpers', () => {
  it('updates plugin arguments, dispatches the update command, and rolls back on failure', async () => {
    const calls = stubCommandFetch({ failCommands: true })
    const previousPlugins = cloneJsonValue(getDatabase().plugins)
    const previousStorage = cloneJsonValue(getDatabase().pluginCustomStorage)
    setResourceWriteGuardEnabled(true)

    expect(() => {
      getDatabase().plugins[0].realArg.mode = 'raw'
    }).toThrow(/resource database compatibility view is read-only/)

    expect(setPluginArgument('plugin-a', 'mode', 'slow')).toBe(true)
    expect(getDatabase().plugins[0].realArg).toEqual({ mode: 'slow', token: 'abc' })

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
    expect(getDatabase().plugins).toEqual(previousPlugins)
    expect(getDatabase().currentPluginProvider).toBe('plugin-a')
    expect(getDatabase().pluginCustomStorage).toEqual(previousStorage)
  })

  it('failed setPluginArgument preserves newer storage keys and sibling plugin edits', async () => {
    const calls = stubCommandFetch({ failCommands: true })
    setResourceWriteGuardEnabled(true)

    expect(setPluginArgument('plugin-a', 'mode', 'slow')).toBe(true)
    withTrustedResourceWrite(() => {
      getDatabase().plugins[1] = {
        ...getDatabase().plugins[1],
        realArg: { mode: 'newer-sibling-edit' },
        enabled: true,
      }
      getDatabase().pluginCustomStorage.newerStorage = { value: 'kept' }
    })

    await waitForCallCount(calls, 2)
    await flushCommandEffects()

    expect(getDatabase().plugins).toEqual([
      seedPlugin('plugin-a', {
        arguments: { mode: ['fast', 'slow'] },
        realArg: { mode: 'fast', token: 'abc' },
        enabled: true,
      }),
      seedPlugin('plugin-b', {
        realArg: { mode: 'newer-sibling-edit' },
        enabled: true,
      }),
    ])
    expect(getDatabase().currentPluginProvider).toBe('plugin-a')
    expect(getDatabase().pluginCustomStorage).toEqual({
      retained: { value: 1 },
      newerStorage: { value: 'kept' },
    })
  })

  it('serialized same-argument failures preserve the newer queued edit before rolling back', async () => {
    const { calls, commandResponses } = stubDeferredCommandFetch()
    setResourceWriteGuardEnabled(true)

    expect(setPluginArgument('plugin-a', 'mode', 'first')).toBe(true)
    await waitForCallCount(calls, 2)

    expect(setPluginArgument('plugin-a', 'mode', 'second')).toBe(true)
    expect(calls).toHaveLength(2)

    expect(calls[1]).toMatchObject({
      url: '/api/v1/commands/plugins/plugin-a',
      method: 'PATCH',
      body: {
        baseRevision: 10,
        patch: {
          realArg: { mode: 'first', token: 'abc' },
        },
      },
    })
    commandResponses[0].resolve(jsonResponse({ error: 'forced older failure' }, 500))
    await waitForCallCount(calls, 3)
    await flushCommandEffects()

    expect(getDatabase().plugins[0].realArg).toEqual({ mode: 'second', token: 'abc' })
    expect(calls[2]).toMatchObject({
      url: '/api/v1/commands/plugins/plugin-a',
      method: 'PATCH',
      body: {
        baseRevision: 10,
        patch: {
          realArg: { mode: 'second', token: 'abc' },
        },
      },
    })

    commandResponses[1].resolve(jsonResponse({ error: 'forced newer failure' }, 500))
    await flushCommandEffects()

    expect(getDatabase().plugins[0].realArg).toEqual({ mode: 'fast', token: 'abc' })
  })

  it('toggles enabled state, dispatches the enable command, and rolls back on failure', async () => {
    const calls = stubCommandFetch({ failCommands: true })
    const previousPlugins = cloneJsonValue(getDatabase().plugins)
    const previousStorage = cloneJsonValue(getDatabase().pluginCustomStorage)
    setResourceWriteGuardEnabled(true)

    expect(togglePluginEnabled('plugin-a')).toBe(true)
    expect(getDatabase().plugins[0].enabled).toBe(false)

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
    expect(getDatabase().plugins).toEqual(previousPlugins)
    expect(getDatabase().currentPluginProvider).toBe('plugin-a')
    expect(getDatabase().pluginCustomStorage).toEqual(previousStorage)
  })

  it('failed togglePluginEnabled rolls back only enabled and preserves newer same-row fields', async () => {
    const calls = stubCommandFetch({ failCommands: true })
    setResourceWriteGuardEnabled(true)

    expect(togglePluginEnabled('plugin-a')).toBe(true)
    withTrustedResourceWrite(() => {
      getDatabase().plugins[0] = {
        ...getDatabase().plugins[0],
        script: 'Risuai.log("newer same-row edit")',
        realArg: { mode: 'newer-mode', token: 'newer-token' },
      }
      getDatabase().pluginCustomStorage.newerStorage = { value: 'kept' }
    })

    await waitForCallCount(calls, 2)
    await flushCommandEffects()

    expect(getDatabase().plugins[0]).toEqual(
      seedPlugin('plugin-a', {
        script: 'Risuai.log("newer same-row edit")',
        arguments: { mode: ['fast', 'slow'] },
        realArg: { mode: 'newer-mode', token: 'newer-token' },
        enabled: true,
      }),
    )
    expect(getDatabase().plugins[1]).toEqual(
      seedPlugin('plugin-b', {
        realArg: { mode: 'standby' },
        enabled: false,
      }),
    )
    expect(getDatabase().currentPluginProvider).toBe('plugin-a')
    expect(getDatabase().pluginCustomStorage).toEqual({
      retained: { value: 1 },
      newerStorage: { value: 'kept' },
    })
  })

  it('deletes plugins, clears the current provider, dispatches delete, and rolls back on failure', async () => {
    const calls = stubCommandFetch({ failCommands: true })
    const previousPlugins = cloneJsonValue(getDatabase().plugins)
    const previousProvider = getDatabase().currentPluginProvider
    const previousStorage = cloneJsonValue(getDatabase().pluginCustomStorage)
    setResourceWriteGuardEnabled(true)

    expect(deletePlugin('plugin-a')).toBe(true)
    expect(getDatabase().plugins.map((plugin) => plugin.name)).toEqual(['plugin-b'])
    expect(getDatabase().currentPluginProvider).toBe('')

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
    expect(getDatabase().plugins).toEqual(previousPlugins)
    expect(getDatabase().currentPluginProvider).toBe(previousProvider)
    expect(getDatabase().pluginCustomStorage).toEqual(previousStorage)
  })

  it('failed active-provider deletePlugin restores only the missing plugin and preserves newer siblings and provider', async () => {
    const calls = stubCommandFetch({ failCommands: true })
    setResourceWriteGuardEnabled(true)

    expect(deletePlugin('plugin-a')).toBe(true)
    withTrustedResourceWrite(() => {
      getDatabase().plugins.push(
        seedPlugin('plugin-c', {
          realArg: { mode: 'newer-plugin' },
          enabled: true,
        }),
      )
      getDatabase().currentPluginProvider = 'plugin-b'
      getDatabase().pluginCustomStorage.newerStorage = { value: 'kept' }
    })

    await waitForCallCount(calls, 2)
    await flushCommandEffects()

    expect(getDatabase().plugins).toEqual([
      seedPlugin('plugin-a', {
        arguments: { mode: ['fast', 'slow'] },
        realArg: { mode: 'fast', token: 'abc' },
        enabled: true,
      }),
      seedPlugin('plugin-b', {
        realArg: { mode: 'standby' },
        enabled: false,
      }),
      seedPlugin('plugin-c', {
        realArg: { mode: 'newer-plugin' },
        enabled: true,
      }),
    ])
    expect(getDatabase().currentPluginProvider).toBe('plugin-b')
    expect(getDatabase().pluginCustomStorage).toEqual({
      retained: { value: 1 },
      newerStorage: { value: 'kept' },
    })
  })

  it('failed dispatchSelectPluginProvider skips rollback after newer provider selection and preserves plugins and storage', async () => {
    const calls = stubCommandFetch({ failCommands: true })
    const previous = currentPluginStateSnapshot()
    setResourceWriteGuardEnabled(true)

    withTrustedResourceWrite(() => {
      getDatabase().currentPluginProvider = 'plugin-b'
    })
    dispatchSelectPluginProvider('plugin-b', previous)

    withTrustedResourceWrite(() => {
      getDatabase().currentPluginProvider = 'plugin-c'
      getDatabase().plugins.push(
        seedPlugin('plugin-c', {
          realArg: { mode: 'newer-plugin' },
          enabled: true,
        }),
      )
      getDatabase().pluginCustomStorage.newerStorage = { value: 'kept' }
    })
    const expectedPlugins = cloneJsonValue(getDatabase().plugins)
    const expectedStorage = cloneJsonValue(getDatabase().pluginCustomStorage)

    await waitForCallCount(calls, 2)
    await flushCommandEffects()

    expect(calls[1]).toMatchObject({
      url: '/api/v1/commands/plugins/provider',
      method: 'POST',
      body: {
        baseRevision: 10,
        provider: 'plugin-b',
      },
    })
    expect(getDatabase().currentPluginProvider).toBe('plugin-c')
    expect(getDatabase().plugins).toEqual(expectedPlugins)
    expect(getDatabase().pluginCustomStorage).toEqual(expectedStorage)
  })

  it('failed dispatchCreatePlugin removes only the attempted new plugin and preserves newer siblings, provider, and storage', async () => {
    const calls = stubCommandFetch({ failCommands: true })
    setResourceWriteGuardEnabled(true)
    const previous = currentPluginStateSnapshot()
    const attemptedPlugin = seedPlugin('plugin-created', {
      displayName: 'Attempted Create',
      realArg: { mode: 'created' },
    })

    withTrustedResourceWrite(() => {
      getDatabase().plugins.push(attemptedPlugin)
    })
    dispatchCreatePlugin(attemptedPlugin, previous)
    withTrustedResourceWrite(() => {
      getDatabase().plugins.push(
        seedPlugin('plugin-newer', {
          realArg: { mode: 'newer' },
        }),
      )
      getDatabase().currentPluginProvider = 'plugin-newer'
      getDatabase().pluginCustomStorage.newerStorage = { value: 'kept' }
    })

    await waitForCallCount(calls, 2)
    await flushCommandEffects()

    expect(calls[1]).toMatchObject({
      url: '/api/v1/commands/plugins',
      method: 'POST',
      body: {
        baseRevision: 10,
        plugin: expect.objectContaining({
          name: 'plugin-created',
          displayName: 'Attempted Create',
        }),
      },
    })
    expect(getDatabase().plugins).toEqual([
      seedPlugin('plugin-a', {
        arguments: { mode: ['fast', 'slow'] },
        realArg: { mode: 'fast', token: 'abc' },
        enabled: true,
      }),
      seedPlugin('plugin-b', {
        realArg: { mode: 'standby' },
        enabled: false,
      }),
      seedPlugin('plugin-newer', {
        realArg: { mode: 'newer' },
      }),
    ])
    expect(getDatabase().currentPluginProvider).toBe('plugin-newer')
    expect(getDatabase().pluginCustomStorage).toEqual({
      retained: { value: 1 },
      newerStorage: { value: 'kept' },
    })
  })

  it('dispatchCreatePlugin sends the original attempted plugin after delayed bootstrap', async () => {
    const { calls, resolveBootstrap } = stubDelayedBootstrapCommandFetch()
    setResourceWriteGuardEnabled(true)
    const previous = currentPluginStateSnapshot()
    const attemptedPlugin = seedPlugin('plugin-created', {
      displayName: 'Attempted Create',
      arguments: { mode: ['fast', 'slow'] },
      realArg: { mode: 'created' },
    })

    withTrustedResourceWrite(() => {
      getDatabase().plugins.push(attemptedPlugin)
    })
    dispatchCreatePlugin(attemptedPlugin, previous)
    await waitForCallCount(calls, 1)

    attemptedPlugin.displayName = 'Mutated Create'
    attemptedPlugin.arguments.mode = ['mutated']
    attemptedPlugin.realArg.mode = 'mutated'
    resolveBootstrap(jsonResponse({ revision: 10 }))
    await waitForCallCount(calls, 2)

    expect(calls[1]).toMatchObject({
      url: '/api/v1/commands/plugins',
      method: 'POST',
      body: {
        baseRevision: 10,
        plugin: expect.objectContaining({
          name: 'plugin-created',
          displayName: 'Attempted Create',
          arguments: { mode: ['fast', 'slow'] },
          realArg: { mode: 'created' },
        }),
      },
    })
  })

  it('failed create followed by queued failed update removes the never-persisted plugin', async () => {
    const { calls, commandResponses } = stubDeferredCommandFetch()
    setResourceWriteGuardEnabled(true)
    const createPrevious = currentPluginStateSnapshot()
    const attemptedPlugin = seedPlugin('plugin-created', {
      displayName: 'Attempted Create',
      realArg: { mode: 'created' },
    })

    withTrustedResourceWrite(() => {
      getDatabase().plugins.push(attemptedPlugin)
    })
    dispatchCreatePlugin(attemptedPlugin, createPrevious)
    await waitForCallCount(calls, 2)

    const updatePrevious = currentPluginStateSnapshot()
    withTrustedResourceWrite(() => {
      const index = getDatabase().plugins.findIndex((plugin) => plugin.name === 'plugin-created')
      getDatabase().plugins[index] = {
        ...getDatabase().plugins[index],
        displayName: 'Updated Create',
        realArg: { mode: 'updated' },
      }
    })
    dispatchUpdatePlugin(
      'plugin-created',
      {
        displayName: 'Updated Create',
        realArg: { mode: 'updated' },
      },
      updatePrevious,
    )
    expect(calls).toHaveLength(2)

    commandResponses[0].resolve(jsonResponse({ error: 'forced create failure' }, 500))
    await waitForCallCount(calls, 3)
    await flushCommandEffects()

    expect(getDatabase().plugins.find((plugin) => plugin.name === 'plugin-created')).toEqual(
      seedPlugin('plugin-created', {
        displayName: 'Updated Create',
        realArg: { mode: 'updated' },
      }),
    )

    commandResponses[1].resolve(jsonResponse({ error: 'forced update failure' }, 500))
    await flushCommandEffects()

    expect(getDatabase().plugins.map((plugin) => plugin.name)).toEqual(['plugin-a', 'plugin-b'])
  })

  it('failed full plugin update restores only fields still equal to attempted values', async () => {
    const calls = stubCommandFetch({ failCommands: true })
    setResourceWriteGuardEnabled(true)
    const previous = currentPluginStateSnapshot()
    const attemptedPlugin = seedPlugin('plugin-a', {
      script: 'Risuai.log("attempted full update")',
      displayName: 'Attempted A',
      arguments: { mode: ['fast', 'slow'], tone: 'string' },
      realArg: { mode: 'slow', token: 'abc', tone: 'formal' },
      enabled: false,
    })

    withTrustedResourceWrite(() => {
      getDatabase().plugins[0] = attemptedPlugin
    })
    dispatchUpdatePlugin('plugin-a', attemptedPlugin as unknown as PluginSnapshot, previous)
    withTrustedResourceWrite(() => {
      getDatabase().plugins[0] = {
        ...getDatabase().plugins[0],
        script: 'Risuai.log("newer same-row script")',
      }
      getDatabase().currentPluginProvider = 'plugin-b'
      getDatabase().pluginCustomStorage.newerStorage = { value: 'kept' }
    })

    await waitForCallCount(calls, 2)
    await flushCommandEffects()

    expect(calls[1]).toMatchObject({
      url: '/api/v1/commands/plugins/plugin-a',
      method: 'PATCH',
      body: {
        baseRevision: 10,
        patch: expect.objectContaining({
          script: 'Risuai.log("attempted full update")',
          displayName: 'Attempted A',
          realArg: { mode: 'slow', token: 'abc', tone: 'formal' },
          enabled: false,
        }),
      },
    })
    expect(calls[1].body).toEqual(
      expect.objectContaining({
        patch: expect.not.objectContaining({ name: 'plugin-a' }),
      }),
    )
    expect(getDatabase().plugins[0]).toEqual(
      seedPlugin('plugin-a', {
        script: 'Risuai.log("newer same-row script")',
        arguments: { mode: ['fast', 'slow'] },
        realArg: { mode: 'fast', token: 'abc' },
        enabled: true,
      }),
    )
    expect(getDatabase().plugins[1]).toEqual(
      seedPlugin('plugin-b', {
        realArg: { mode: 'standby' },
        enabled: false,
      }),
    )
    expect(getDatabase().currentPluginProvider).toBe('plugin-b')
    expect(getDatabase().pluginCustomStorage).toEqual({
      retained: { value: 1 },
      newerStorage: { value: 'kept' },
    })
  })

  it('dispatchUpdatePlugin sends the original nested patch after delayed bootstrap', async () => {
    const { calls, resolveBootstrap } = stubDelayedBootstrapCommandFetch()
    setResourceWriteGuardEnabled(true)
    const previous = currentPluginStateSnapshot()
    const patch = {
      arguments: { mode: ['fast', 'slow'] },
      realArg: { mode: 'attempted', token: 'abc' },
    }

    withTrustedResourceWrite(() => {
      getDatabase().plugins[0] = {
        ...getDatabase().plugins[0],
        ...patch,
      }
    })
    dispatchUpdatePlugin('plugin-a', patch, previous)
    await waitForCallCount(calls, 1)

    patch.arguments.mode.push('mutated')
    patch.realArg.mode = 'mutated'
    resolveBootstrap(jsonResponse({ revision: 10 }))
    await waitForCallCount(calls, 2)

    expect(calls[1]).toMatchObject({
      url: '/api/v1/commands/plugins/plugin-a',
      method: 'PATCH',
      body: {
        baseRevision: 10,
        patch: {
          arguments: { mode: ['fast', 'slow'] },
          realArg: { mode: 'attempted', token: 'abc' },
        },
      },
    })
  })

  it('failed delete followed by queued failed same-name create restores the original plugin', async () => {
    const { calls, commandResponses } = stubDeferredCommandFetch()
    setResourceWriteGuardEnabled(true)
    const originalPlugins = cloneJsonValue(getDatabase().plugins)
    const deletePrevious = currentPluginStateSnapshot()

    withTrustedResourceWrite(() => {
      getDatabase().plugins = getDatabase().plugins.filter((plugin) => plugin.name !== 'plugin-a')
      getDatabase().currentPluginProvider = ''
    })
    dispatchDeletePlugin('plugin-a', deletePrevious)
    await waitForCallCount(calls, 2)

    const createPrevious = currentPluginStateSnapshot()
    const newPlugin = seedPlugin('plugin-a', {
      displayName: 'Replacement A',
      realArg: { mode: 'replacement' },
    })
    withTrustedResourceWrite(() => {
      getDatabase().plugins.push(newPlugin)
    })
    dispatchCreatePlugin(newPlugin, createPrevious)
    expect(calls).toHaveLength(2)

    commandResponses[0].resolve(jsonResponse({ error: 'forced delete failure' }, 500))
    await waitForCallCount(calls, 3)
    await flushCommandEffects()

    expect(getDatabase().plugins.find((plugin) => plugin.name === 'plugin-a')).toEqual(newPlugin)
    expect(getDatabase().currentPluginProvider).toBe('')

    commandResponses[1].resolve(jsonResponse({ error: 'forced create failure' }, 500))
    await flushCommandEffects()

    expect(getDatabase().plugins).toEqual(originalPlugins)
    expect(getDatabase().currentPluginProvider).toBe('plugin-a')
  })

  it('failed dispatchReorderPlugins preserves a newer reorder and uses the captured attempted order', async () => {
    const calls = stubCommandFetch({ failCommands: true })
    setResourceWriteGuardEnabled(true)
    withTrustedResourceWrite(() => {
      getDatabase().plugins = [seedPlugin('plugin-a'), seedPlugin('plugin-b'), seedPlugin('plugin-c')]
    })
    const previous = currentPluginStateSnapshot()

    withTrustedResourceWrite(() => {
      getDatabase().plugins = [seedPlugin('plugin-c'), seedPlugin('plugin-b'), seedPlugin('plugin-a')]
    })
    dispatchReorderPlugins(previous)
    withTrustedResourceWrite(() => {
      getDatabase().plugins = [seedPlugin('plugin-b'), seedPlugin('plugin-c'), seedPlugin('plugin-a')]
      getDatabase().currentPluginProvider = 'plugin-c'
      getDatabase().pluginCustomStorage.newerStorage = { value: 'kept' }
    })

    await waitForCallCount(calls, 2)
    await flushCommandEffects()

    expect(calls[1]).toMatchObject({
      url: '/api/v1/commands/plugins/reorder',
      method: 'POST',
      body: {
        baseRevision: 10,
        pluginIds: ['plugin-c', 'plugin-b', 'plugin-a'],
      },
    })
    expect(getDatabase().plugins.map((plugin) => plugin.name)).toEqual(['plugin-b', 'plugin-c', 'plugin-a'])
    expect(getDatabase().currentPluginProvider).toBe('plugin-c')
    expect(getDatabase().pluginCustomStorage).toEqual({
      retained: { value: 1 },
      newerStorage: { value: 'kept' },
    })
  })

  it('returns false for missing plugin names without commands or projection changes', () => {
    const calls = stubCommandFetch()
    const previousPlugins = cloneJsonValue(getDatabase().plugins)
    const previousProvider = getDatabase().currentPluginProvider
    const previousStorage = cloneJsonValue(getDatabase().pluginCustomStorage)
    setResourceWriteGuardEnabled(true)

    expect(setPluginArgument('missing-plugin', 'mode', 'slow')).toBe(false)
    expect(togglePluginEnabled('missing-plugin')).toBe(false)
    expect(deletePlugin('missing-plugin')).toBe(false)

    expect(calls).toHaveLength(0)
    expect(getDatabase().plugins).toEqual(previousPlugins)
    expect(getDatabase().currentPluginProvider).toBe(previousProvider)
    expect(getDatabase().pluginCustomStorage).toEqual(previousStorage)
  })

  it('failed settings patch restores only attempted settings keys and preserves newer plugin state', async () => {
    const calls = stubCommandFetch({ failCommands: true })
    setResourceWriteGuardEnabled(true)
    withTrustedResourceWrite(() => {
      getDatabase().moduleIntergration = 'old-modules'
      getDatabase().pluginDevelopMode = false
    })
    const patch = {
      moduleIntergration: 'attempted-modules',
      pluginDevelopMode: true,
    }
    const rollbackSnapshot = currentPluginSettingsPatchRollbackSnapshot(patch)

    withTrustedResourceWrite(() => {
      getDatabase().moduleIntergration = patch.moduleIntergration
      getDatabase().pluginDevelopMode = patch.pluginDevelopMode
    })
    dispatchPluginSettingsPatch(patch, rollbackSnapshot)
    withTrustedResourceWrite(() => {
      getDatabase().plugins.push(
        seedPlugin('plugin-c', {
          realArg: { mode: 'newer-plugin' },
          enabled: true,
        }),
      )
      getDatabase().currentPluginProvider = 'plugin-c'
      getDatabase().pluginCustomStorage.newerStorage = { value: 'kept' }
    })

    await waitForCallCount(calls, 2)
    await flushCommandEffects()

    expect(calls[1]).toMatchObject({
      url: '/api/v1/commands/settings/advanced',
      method: 'PATCH',
      body: {
        baseRevision: 10,
        patch,
      },
    })
    expect(getDatabase().moduleIntergration).toBe('old-modules')
    expect(getDatabase().pluginDevelopMode).toBe(false)
    expect(getDatabase().plugins).toEqual([
      seedPlugin('plugin-a', {
        arguments: { mode: ['fast', 'slow'] },
        realArg: { mode: 'fast', token: 'abc' },
        enabled: true,
      }),
      seedPlugin('plugin-b', {
        realArg: { mode: 'standby' },
        enabled: false,
      }),
      seedPlugin('plugin-c', {
        realArg: { mode: 'newer-plugin' },
        enabled: true,
      }),
    ])
    expect(getDatabase().currentPluginProvider).toBe('plugin-c')
    expect(getDatabase().pluginCustomStorage).toEqual({
      retained: { value: 1 },
      newerStorage: { value: 'kept' },
    })
  })

  it('failed later settings group preserves an accepted earlier settings group', async () => {
    const calls = stubCommandFetch({ failCommandUrls: ['/api/v1/commands/settings/advanced'] })
    setResourceWriteGuardEnabled(true)
    const oldCustomModels = customModelRows([{ id: 'old-model', name: 'Old Model' }])
    const attemptedCustomModels = customModelRows([{ id: 'attempted-model', name: 'Attempted Model' }])
    withTrustedResourceWrite(() => {
      getDatabase().customModels = oldCustomModels
      getDatabase().moduleIntergration = 'old-modules'
    })
    const patch = {
      customModels: attemptedCustomModels,
      moduleIntergration: 'attempted-modules',
    }
    const rollbackSnapshot = currentPluginSettingsPatchRollbackSnapshot(patch)

    withTrustedResourceWrite(() => {
      getDatabase().customModels = cloneJsonValue(patch.customModels)
      getDatabase().moduleIntergration = patch.moduleIntergration
    })
    dispatchPluginSettingsPatch(patch, rollbackSnapshot)

    await waitForCallCount(calls, 3)
    await flushCommandEffects()

    expect(calls[1]).toMatchObject({
      url: '/api/v1/commands/settings/providers',
      method: 'PATCH',
      body: {
        baseRevision: 10,
        patch: {
          customModels: attemptedCustomModels,
        },
      },
    })
    expect(calls[2]).toMatchObject({
      url: '/api/v1/commands/settings/advanced',
      method: 'PATCH',
      body: {
        baseRevision: 11,
        patch: {
          moduleIntergration: 'attempted-modules',
        },
      },
    })
    expect(getDatabase().customModels).toEqual(attemptedCustomModels)
    expect(getDatabase().moduleIntergration).toBe('old-modules')
  })

  it('failed first settings group rolls back later unaccepted attempted settings keys', async () => {
    const calls = stubCommandFetch({ failCommandUrls: ['/api/v1/commands/settings/providers'] })
    setResourceWriteGuardEnabled(true)
    const oldCustomModels = customModelRows([{ id: 'old-model', name: 'Old Model' }])
    const attemptedCustomModels = customModelRows([{ id: 'attempted-model', name: 'Attempted Model' }])
    withTrustedResourceWrite(() => {
      getDatabase().customModels = oldCustomModels
      getDatabase().moduleIntergration = 'old-modules'
    })
    const patch = {
      customModels: attemptedCustomModels,
      moduleIntergration: 'attempted-modules',
    }
    const rollbackSnapshot = currentPluginSettingsPatchRollbackSnapshot(patch)

    withTrustedResourceWrite(() => {
      getDatabase().customModels = cloneJsonValue(patch.customModels)
      getDatabase().moduleIntergration = patch.moduleIntergration
    })
    dispatchPluginSettingsPatch(patch, rollbackSnapshot)

    await waitForCallCount(calls, 2)
    await flushCommandEffects()

    expect(calls[1]).toMatchObject({
      url: '/api/v1/commands/settings/providers',
      method: 'PATCH',
      body: {
        baseRevision: 10,
        patch: {
          customModels: attemptedCustomModels,
        },
      },
    })
    expect(calls.some((call) => call.url === '/api/v1/commands/settings/advanced')).toBe(false)
    expect(getDatabase().customModels).toEqual(oldCustomModels)
    expect(getDatabase().moduleIntergration).toBe('old-modules')
  })

  it('failed settings patch skips rollback when the same settings key changed again', async () => {
    const calls = stubCommandFetch({ failCommands: true })
    setResourceWriteGuardEnabled(true)
    withTrustedResourceWrite(() => {
      getDatabase().moduleIntergration = 'old-modules'
    })
    const patch = {
      moduleIntergration: 'attempted-modules',
    }
    const rollbackSnapshot = currentPluginSettingsPatchRollbackSnapshot(patch)

    withTrustedResourceWrite(() => {
      getDatabase().moduleIntergration = patch.moduleIntergration
    })
    dispatchPluginSettingsPatch(patch, rollbackSnapshot)
    withTrustedResourceWrite(() => {
      getDatabase().moduleIntergration = 'newer-modules'
    })

    await waitForCallCount(calls, 2)
    await flushCommandEffects()

    expect(getDatabase().moduleIntergration).toBe('newer-modules')
  })

  it('failed settings patch ignores unsupported and undefined keys for command dispatch and rollback', async () => {
    const calls = stubCommandFetch({ failCommands: true })
    setResourceWriteGuardEnabled(true)
    withTrustedResourceWrite(() => {
      getDatabase().moduleIntergration = 'old-modules'
      dbRecord().notServerBackedSetting = 'old-unsupported'
      dbRecord().maxContext = 4096
    })
    const patch = {
      moduleIntergration: 'attempted-modules',
      notServerBackedSetting: 'attempted-unsupported',
      maxContext: undefined,
    }
    const rollbackSnapshot = currentPluginSettingsPatchRollbackSnapshot(patch)

    withTrustedResourceWrite(() => {
      getDatabase().moduleIntergration = patch.moduleIntergration
      dbRecord().notServerBackedSetting = patch.notServerBackedSetting
      dbRecord().maxContext = undefined
    })
    dispatchPluginSettingsPatch(patch, rollbackSnapshot)

    await waitForCallCount(calls, 2)
    await flushCommandEffects()

    expect(calls[1]).toMatchObject({
      url: '/api/v1/commands/settings/advanced',
      method: 'PATCH',
      body: {
        baseRevision: 10,
        patch: {
          moduleIntergration: 'attempted-modules',
        },
      },
    })
    expect(getDatabase().moduleIntergration).toBe('old-modules')
    expect(dbRecord().notServerBackedSetting).toBe('attempted-unsupported')
    expect(dbRecord().maxContext).toBeUndefined()
  })

  it('failed PUT restores only the attempted key and preserves newer sibling keys', async () => {
    const calls = stubCommandFetch({ failCommands: true })
    setResourceWriteGuardEnabled(true)
    writePluginStorage({
      attempted: { value: 'old' },
      sibling: { value: 'kept' },
    })
    const previous = currentPluginStorageSnapshot()

    withTrustedResourceWrite(() => {
      getDatabase().pluginCustomStorage.attempted = { value: 'attempted' }
    })
    dispatchPutPluginStorage('attempted', { value: 'attempted' }, previous)
    withTrustedResourceWrite(() => {
      getDatabase().pluginCustomStorage.newerSibling = { value: 'newer' }
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
    expect(getDatabase().pluginCustomStorage).toEqual({
      attempted: { value: 'old' },
      sibling: { value: 'kept' },
      newerSibling: { value: 'newer' },
    })
  })

  it('overlays pending storage intent until successful command reconciliation settles', async () => {
    const { calls, commandResponses } = stubDeferredCommandFetch()
    setResourceWriteGuardEnabled(true)
    writePluginStorage({ attempted: { value: 'old' }, localSibling: true })
    const previous = currentPluginStorageSnapshot()

    withTrustedResourceWrite(() => {
      getDatabase().pluginCustomStorage.attempted = { value: 'newer local' }
    })
    dispatchPutPluginStorage('attempted', { value: 'newer local' }, previous)
    await waitForCallCount(calls, 2)

    expect(
      mergePendingPluginStorageResource({
        attempted: { value: 'older projection' },
        serverSibling: true,
      }),
    ).toEqual({
      attempted: { value: 'newer local' },
      serverSibling: true,
    })
    const projectedDatabase = {
      pluginCustomStorage: { attempted: { value: 'older full projection' } },
      language: 'en',
    }
    expect(preservePendingPluginStorageInDatabase(projectedDatabase)).toBe(projectedDatabase)
    expect(projectedDatabase.pluginCustomStorage).toEqual({ attempted: { value: 'newer local' } })

    commandResponses[0].resolve(
      jsonResponse({
        revision: 11,
        event: { type: 'pluginStorage.updated', revision: 11, resource: 'pluginStorage', id: 'attempted' },
      }),
    )
    await flushCommandEffects()

    expect(mergePendingPluginStorageResource({ attempted: { value: 'server final' } })).toEqual({
      attempted: { value: 'server final' },
    })
  })

  it('keeps a pending delete absent from an older whole-map projection', async () => {
    const { calls, commandResponses } = stubDeferredCommandFetch()
    setResourceWriteGuardEnabled(true)
    writePluginStorage({ deleted: { value: 'old' }, sibling: true })
    const previous = currentPluginStorageSnapshot()

    withTrustedResourceWrite(() => {
      delete getDatabase().pluginCustomStorage.deleted
    })
    dispatchDeletePluginStorage('deleted', previous)
    await waitForCallCount(calls, 2)

    expect(mergePendingPluginStorageResource({ deleted: { value: 'stale' }, sibling: true })).toEqual({
      sibling: true,
    })

    commandResponses[0].resolve(jsonResponse({ error: 'forced failure' }, 500))
    await flushCommandEffects()
    expect(getDatabase().pluginCustomStorage.deleted).toEqual({ value: 'old' })
  })

  it('failed PUT skips rollback if the same key changed again', async () => {
    const calls = stubCommandFetch({ failCommands: true })
    setResourceWriteGuardEnabled(true)
    writePluginStorage({
      attempted: { value: 'old' },
      sibling: { value: 'kept' },
    })
    const previous = currentPluginStorageSnapshot()

    withTrustedResourceWrite(() => {
      getDatabase().pluginCustomStorage.attempted = { value: 'attempted' }
    })
    dispatchPutPluginStorage('attempted', { value: 'attempted' }, previous)
    withTrustedResourceWrite(() => {
      getDatabase().pluginCustomStorage.attempted = { value: 'newer' }
    })

    await waitForCallCount(calls, 2)
    await flushCommandEffects()

    expect(getDatabase().pluginCustomStorage).toEqual({
      attempted: { value: 'newer' },
      sibling: { value: 'kept' },
    })
  })

  it('serialized failed same-key PUTs preserve the queued value before rolling back to the original', async () => {
    const { calls, commandResponses } = stubDeferredCommandFetch()
    setResourceWriteGuardEnabled(true)
    writePluginStorage({
      attempted: { value: 'old' },
      sibling: { value: 'kept' },
    })

    const firstPrevious = currentPluginStorageSnapshot()
    withTrustedResourceWrite(() => {
      getDatabase().pluginCustomStorage.attempted = { value: 'A' }
    })
    dispatchPutPluginStorage('attempted', { value: 'A' }, firstPrevious)

    await waitForCallCount(calls, 2)

    const secondPrevious = currentPluginStorageSnapshot()
    withTrustedResourceWrite(() => {
      getDatabase().pluginCustomStorage.attempted = { value: 'B' }
    })
    dispatchPutPluginStorage('attempted', { value: 'B' }, secondPrevious)

    expect(calls).toHaveLength(2)
    expect(calls[1]).toMatchObject({
      url: '/api/v1/commands/plugin-storage/attempted',
      method: 'PUT',
      body: {
        baseRevision: 10,
        value: { value: 'A' },
      },
    })
    commandResponses[0].resolve(jsonResponse({ error: 'forced older failure' }, 500))
    await waitForCallCount(calls, 3)
    await flushCommandEffects()

    expect(getDatabase().pluginCustomStorage).toEqual({
      attempted: { value: 'B' },
      sibling: { value: 'kept' },
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

    expect(getDatabase().pluginCustomStorage).toEqual({
      attempted: { value: 'old' },
      sibling: { value: 'kept' },
    })
  })

  it('a failed queued PUT rolls back to the value accepted by the preceding PUT', async () => {
    const { calls, commandResponses } = stubDeferredCommandFetch()
    setResourceWriteGuardEnabled(true)
    writePluginStorage({
      attempted: { value: 'old' },
      sibling: { value: 'kept' },
    })

    const firstPrevious = currentPluginStorageSnapshot()
    withTrustedResourceWrite(() => {
      getDatabase().pluginCustomStorage.attempted = { value: 'A' }
    })
    dispatchPutPluginStorage('attempted', { value: 'A' }, firstPrevious)

    await waitForCallCount(calls, 2)

    const secondPrevious = currentPluginStorageSnapshot()
    withTrustedResourceWrite(() => {
      getDatabase().pluginCustomStorage.attempted = { value: 'B' }
    })
    dispatchPutPluginStorage('attempted', { value: 'B' }, secondPrevious)

    expect(calls).toHaveLength(2)

    commandResponses[0].resolve(
      jsonResponse({
        revision: 11,
        event: { type: 'pluginStorage.updated', revision: 11, resource: 'pluginStorage', id: 'attempted' },
      }),
    )
    await waitForCallCount(calls, 3)
    await flushCommandEffects()

    expect(getDatabase().pluginCustomStorage).toEqual({
      attempted: { value: 'B' },
      sibling: { value: 'kept' },
    })

    expect(calls[2]).toMatchObject({
      body: {
        baseRevision: 11,
        value: { value: 'B' },
      },
    })

    commandResponses[1].resolve(jsonResponse({ error: 'forced newer failure' }, 500))
    await flushCommandEffects()

    expect(getDatabase().pluginCustomStorage).toEqual({
      attempted: { value: 'A' },
      sibling: { value: 'kept' },
    })
  })

  it('failed DELETE restores only the deleted key and preserves newer sibling keys', async () => {
    const calls = stubCommandFetch({ failCommands: true })
    setResourceWriteGuardEnabled(true)
    writePluginStorage({
      deleted: { value: 'old' },
      sibling: { value: 'kept' },
    })
    const previous = currentPluginStorageSnapshot()

    withTrustedResourceWrite(() => {
      delete getDatabase().pluginCustomStorage.deleted
    })
    dispatchDeletePluginStorage('deleted', previous)
    withTrustedResourceWrite(() => {
      getDatabase().pluginCustomStorage.newerSibling = { value: 'newer' }
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
    expect(getDatabase().pluginCustomStorage).toEqual({
      deleted: { value: 'old' },
      sibling: { value: 'kept' },
      newerSibling: { value: 'newer' },
    })
  })

  it('failed bulk clear/replace restores only keys still matching the attempted bulk state', async () => {
    const calls = stubCommandFetch({ failCommands: true })
    setResourceWriteGuardEnabled(true)
    writePluginStorage({
      restoreCleared: { value: 'old-cleared' },
      changedAfterClear: { value: 'old-changed' },
      restoreReplaced: { value: 'old-replaced' },
      changedAfterReplace: { value: 'old-replaced-again' },
    })
    const previous = currentPluginStorageSnapshot()

    withTrustedResourceWrite(() => {
      getDatabase().pluginCustomStorage = {
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
    withTrustedResourceWrite(() => {
      getDatabase().pluginCustomStorage.changedAfterClear = { value: 'newer-same-key' }
      getDatabase().pluginCustomStorage.changedAfterReplace = { value: 'newer-replacement' }
      getDatabase().pluginCustomStorage.laterAdded = { value: 'newer-sibling' }
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
    expect(getDatabase().pluginCustomStorage).toEqual({
      restoreReplaced: { value: 'old-replaced' },
      changedAfterReplace: { value: 'newer-replacement' },
      changedAfterClear: { value: 'newer-same-key' },
      laterAdded: { value: 'newer-sibling' },
      restoreCleared: { value: 'old-cleared' },
    })
  })
})
