import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'plugin-command-token',
}))

import { clearCachedServerCommandRevision } from './server/commands'
import { setServerProjectionWriteGuardEnabled } from './server/projectionWriteGuard.svelte'
import { DBState } from './stores.svelte'
import { deletePlugin, setPluginArgument, togglePluginEnabled } from './pluginCommands'
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
})
