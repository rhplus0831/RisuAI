import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../platform', () => ({ isFastifyServer: true }))

vi.mock('../storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'plugin-test-auth',
}))

vi.mock('./apiV3/v3.svelte', () => ({
  loadV3Plugins: vi.fn(async () => undefined),
}))

vi.mock('./pluginSafety', () => ({
  checkCodeSafety: vi.fn(async () => ({ isSafe: true, errors: [] })),
}))

import { clearCachedServerCommandRevision, type CommandEvent } from '../server/commands'
import { setServerProjectionWriteGuardEnabled } from '../server/projectionWriteGuard.svelte'
import { DBState } from '../stores.svelte'
import { SafeLocalPluginStorage } from './pluginSafeClass'
import { getV2PluginAPIs, type RisuPlugin } from './plugins.svelte'
import type { RisuModule } from '../process/modules'

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

function stubCommandFetch(): CapturedFetch[] {
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
      const event: CommandEvent = {
        type: 'plugin.compat.updated',
        revision: 11,
        resource: 'plugin',
      } as CommandEvent
      return jsonResponse({ revision: 11, event })
    }) as unknown as typeof fetch,
  )
  return calls
}

function seedPlugin(name: string): RisuPlugin {
  return {
    name,
    script: 'Risuai.log("plugin")',
    arguments: {},
    realArg: {},
    version: '3.0',
    customLink: [],
    argMeta: {},
    enabled: true,
  }
}

function seedModule(id: string, patch: Partial<RisuModule> = {}): RisuModule {
  return {
    id,
    name: id,
    description: '',
    ...patch,
  } as RisuModule
}

beforeEach(() => {
  clearCachedServerCommandRevision()
  vi.unstubAllGlobals()
  setServerProjectionWriteGuardEnabled(false)
  DBState.db = {
    currentPluginProvider: 'old-provider',
    pluginCustomStorage: {},
    pluginCompatibilityMode: false,
    plugins: [seedPlugin('plugin-a')],
    modules: [seedModule('mod-a')],
    enabledModules: [],
  } as any
})

afterEach(() => {
  setServerProjectionWriteGuardEnabled(false)
})

describe('plugin database command bridge', () => {
  it('routes plugin provider database writes through the provider command', async () => {
    const calls = stubCommandFetch()
    const apis = getV2PluginAPIs()

    apis.setDatabaseLite({ currentPluginProvider: 'provider-a' })

    await vi.waitFor(() => {
      expect(calls.some((call) => call.url === '/api/v1/commands/plugins/provider')).toBe(true)
    })
    expect(calls.find((call) => call.url === '/api/v1/commands/plugins/provider')).toMatchObject({
      method: 'POST',
      body: {
        baseRevision: 10,
        provider: 'provider-a',
      },
    })
    expect(calls.some((call) => call.url.includes('/api/v1/commands/plugin-storage'))).toBe(false)
    expect(DBState.db.currentPluginProvider).toBe('provider-a')
  })

  it('setArg updates plugin realArg through a command without throwing under the projection guard', async () => {
    const calls = stubCommandFetch()
    const apis = getV2PluginAPIs()
    setServerProjectionWriteGuardEnabled(true)

    // Baseline: the guard is active, so a raw projection write throws.
    expect(() => {
      DBState.db.plugins[0].realArg['raw'] = 'x'
    }).toThrow(/read-only server projection/)

    expect(() => apis.setArg('plugin-a::myarg', 'myvalue')).not.toThrow()

    await vi.waitFor(() => {
      expect(calls.some((call) => call.url === '/api/v1/commands/plugins/plugin-a')).toBe(true)
    })
    expect(calls.find((call) => call.url === '/api/v1/commands/plugins/plugin-a')).toMatchObject({
      method: 'PATCH',
      body: { patch: { realArg: { myarg: 'myvalue' } } },
    })
    expect(DBState.db.plugins[0].realArg.myarg).toBe('myvalue')
  })

  it('routes plugin module-integration database writes through settings commands', async () => {
    const calls = stubCommandFetch()
    const apis = getV2PluginAPIs()

    apis.setDatabaseLite({ moduleIntergration: 'ns-a, ns-b' })

    await vi.waitFor(() => {
      expect(calls.some((call) => call.url === '/api/v1/commands/settings/advanced')).toBe(true)
    })
    expect(calls.find((call) => call.url === '/api/v1/commands/settings/advanced')).toMatchObject({
      method: 'PATCH',
      body: {
        baseRevision: 10,
        patch: {
          moduleIntergration: 'ns-a, ns-b',
        },
      },
    })
    expect(DBState.db.moduleIntergration).toBe('ns-a, ns-b')
  })

  it('routes plugin custom model and advanced database writes through settings commands', async () => {
    const calls = stubCommandFetch()
    const apis = getV2PluginAPIs()

    apis.setDatabaseLite({
      customModels: [{ id: 'xcustom:::a', name: 'Model A', key: 'secret' }],
      banCharacterset: ['Latn'],
      allowAllExtentionFiles: true,
      auxModelUnderModelSettings: true,
      pluginDevelopMode: true,
    })

    await vi.waitFor(() => {
      expect(calls.some((call) => call.url === '/api/v1/commands/settings/providers')).toBe(true)
      expect(calls.some((call) => call.url === '/api/v1/commands/settings/advanced')).toBe(true)
    })
    expect(calls.find((call) => call.url === '/api/v1/commands/settings/providers')).toMatchObject({
      method: 'PATCH',
      body: {
        baseRevision: 10,
        patch: {
          customModels: [{ id: 'xcustom:::a', name: 'Model A', key: 'secret' }],
        },
      },
    })
    expect(calls.find((call) => call.url === '/api/v1/commands/settings/advanced')).toMatchObject({
      method: 'PATCH',
      body: {
        baseRevision: 11,
        patch: {
          banCharacterset: ['Latn'],
          allowAllExtentionFiles: true,
          auxModelUnderModelSettings: true,
          pluginDevelopMode: true,
        },
      },
    })
    expect(calls.some((call) => call.url.includes('/api/v1/commands/plugin-storage'))).toBe(false)
  })

  it('routes plugin module database writes through module commands', async () => {
    const calls = stubCommandFetch()
    const apis = getV2PluginAPIs()

    apis.setDatabaseLite({
      modules: [
        seedModule('mod-a', { description: 'updated' }),
        seedModule('mod-b', { description: 'new module' }),
      ],
      enabledModules: ['mod-b'],
    })

    await vi.waitFor(() => {
      expect(calls.some((call) => call.url === '/api/v1/commands/modules/mod-a')).toBe(true)
      expect(calls.some((call) => call.url === '/api/v1/commands/modules')).toBe(true)
      expect(calls.some((call) => call.url === '/api/v1/commands/modules/enable')).toBe(true)
    })
    // The module patch dispatchers route through runOptimisticCommandSequence.
    // Within one sequencer, each command awaits the previous response, so
    // baseRevision is read from cache after each result, not from the bootstrap.
    expect(calls.find((call) => call.url === '/api/v1/commands/modules/mod-a')).toMatchObject({
      method: 'PATCH',
      body: {
        baseRevision: expect.any(Number),
        patch: expect.objectContaining({ description: 'updated' }),
      },
    })
    expect(calls.find((call) => call.url === '/api/v1/commands/modules')).toMatchObject({
      method: 'POST',
      body: {
        baseRevision: expect.any(Number),
        module: expect.objectContaining({ id: 'mod-b', description: 'new module' }),
      },
    })
    expect(calls.find((call) => call.url === '/api/v1/commands/modules/enable')).toMatchObject({
      method: 'POST',
      body: {
        baseRevision: expect.any(Number),
        moduleId: 'mod-b',
        enabled: true,
      },
    })
  })

  it('serializes module collection patch commands against advancing revisions', async () => {
    // dispatchModuleCollectionPatch fans out update/create/delete/reorder calls
    // against one optimistic snapshot. The sequencer must thread each returned
    // revision into the next command.
    let nextRevision = 100
    const captured: { url: string; body: { baseRevision?: number } }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input)
        if (url === '/api/v1/bootstrap') {
          return jsonResponse({ revision: nextRevision })
        }
        const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
        captured.push({ url, body })
        nextRevision += 1
        return jsonResponse({
          revision: nextRevision,
          event: {
            type: 'module.updated',
            revision: nextRevision,
            resource: 'module',
          } as unknown as CommandEvent,
        })
      }) as unknown as typeof fetch,
    )

    DBState.db.modules = [seedModule('mod-a')]
    DBState.db.enabledModules = []
    const apis = getV2PluginAPIs()

    // Only patch `modules` (not enabledModules) so the assertion sees a
    // single sequencer drain in deterministic order.
    apis.setDatabaseLite({
      modules: [
        seedModule('mod-a', { description: 'updated' }),
        seedModule('mod-b', { description: 'new module' }),
      ],
    })

    await vi.waitFor(() => {
      expect(captured.length).toBe(2)
    })
    expect(captured[0].url).toBe('/api/v1/commands/modules/mod-a')
    expect(captured[0].body?.baseRevision).toBe(100)
    expect(captured[1].url).toBe('/api/v1/commands/modules')
    // Pre-fix: 100 (parallel race on shared cache). Post-fix: 101 (read
    // from cache after the first command returns).
    expect(captured[1].body?.baseRevision).toBe(101)
  })

  it('serializes enabled-modules diff commands against advancing revisions', async () => {
    // dispatchEnabledModulesPatch fans out N enable/disable calls against one
    // optimistic snapshot. The sequencer must thread each returned revision into
    // the next command.
    let nextRevision = 200
    const captured: { url: string; body: { baseRevision?: number } }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input)
        if (url === '/api/v1/bootstrap') {
          return jsonResponse({ revision: nextRevision })
        }
        const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
        captured.push({ url, body })
        nextRevision += 1
        return jsonResponse({
          revision: nextRevision,
          event: {
            type: 'module.enabled',
            revision: nextRevision,
            resource: 'module',
          } as unknown as CommandEvent,
        })
      }) as unknown as typeof fetch,
    )

    DBState.db.modules = [seedModule('mod-a'), seedModule('mod-b')]
    DBState.db.enabledModules = ['mod-a']
    const apis = getV2PluginAPIs()

    apis.setDatabaseLite({
      enabledModules: ['mod-b'],
    })

    await vi.waitFor(() => {
      expect(captured.length).toBe(2)
    })
    expect(captured.every((c) => c.url === '/api/v1/commands/modules/enable')).toBe(true)
    expect(captured[0].body?.baseRevision).toBe(200)
    // Second enable command reads the cached revision returned by the first.
    expect(captured[1].body?.baseRevision).toBe(201)
  })

  it('keeps unknown plugin database keys on plugin storage commands', async () => {
    const calls = stubCommandFetch()
    const apis = getV2PluginAPIs()

    apis.setDatabaseLite({ customPluginKey: { value: 1 } })

    await vi.waitFor(() => {
      expect(calls.some((call) => call.url === '/api/v1/commands/plugin-storage/bulk')).toBe(true)
    })
    expect(calls.find((call) => call.url === '/api/v1/commands/plugin-storage/bulk')).toMatchObject(
      {
        method: 'POST',
        body: {
          baseRevision: 10,
          values: { customPluginKey: { value: 1 } },
        },
      },
    )
    expect(DBState.db.pluginCustomStorage.customPluginKey).toEqual({ value: 1 })
  })

  it('blocks recognized resource families (in allowedDbKeys) in server mode without persisting', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const calls = stubCommandFetch()
    const apis = getV2PluginAPIs()
    DBState.db.characters = [{ chaId: 'char-a', name: 'Ada' }] as any

    apis.setDatabaseLite({ characters: [{ chaId: 'char-b', name: 'Grace' }] })

    await new Promise((resolve) => setTimeout(resolve, 30))

    // No projection change, no plugin-storage shadow, no command dispatched.
    expect(DBState.db.characters).toEqual([{ chaId: 'char-a', name: 'Ada' }])
    expect(DBState.db.pluginCustomStorage.characters).toBeUndefined()
    expect(calls.some((call) => call.url.includes('/api/v1/commands/'))).toBe(false)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('characters'))
    warn.mockRestore()
  })

  it('blocks omitted documented keys (not in allowedDbKeys) instead of shadowing plugin storage', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const calls = stubCommandFetch()
    const apis = getV2PluginAPIs()

    apis.setDatabaseLite({
      botPresets: [{ id: 'preset-a' }],
      loreBook: [{ id: 'lore-a', data: [] }],
    })

    await new Promise((resolve) => setTimeout(resolve, 30))

    expect(DBState.db.pluginCustomStorage.botPresets).toBeUndefined()
    expect(DBState.db.pluginCustomStorage.loreBook).toBeUndefined()
    expect(calls.some((call) => call.url.includes('/api/v1/commands/plugin-storage'))).toBe(false)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('botPresets'))
    warn.mockRestore()
  })

  it('blocks pluginV2 database writes in server mode instead of dropping or shadowing them', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const calls = stubCommandFetch()
    const apis = getV2PluginAPIs()

    apis.setDatabaseLite({ pluginV2: [{ name: 'legacy-v2' }] })

    await new Promise((resolve) => setTimeout(resolve, 30))

    expect((DBState.db as any).pluginV2).toBeUndefined()
    expect(DBState.db.pluginCustomStorage.pluginV2).toBeUndefined()
    expect(calls.some((call) => call.url.includes('/api/v1/commands/'))).toBe(false)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('pluginV2'))
    warn.mockRestore()
  })

  it('does not expose server-owned resource shadows through V2 getDatabase in server mode', () => {
    const apis = getV2PluginAPIs()
    DBState.db.characters = [{ chaId: 'char-a', name: 'Ada' }] as any
    DBState.db.pluginCustomStorage = {
      characters: [{ chaId: 'shadow-char', name: 'Shadow' }],
      pluginV2: [{ name: 'shadow-v2' }],
      botPresets: [{ id: 'shadow-preset' }],
      customPluginKey: 'visible',
    }

    const safeDb = apis.getDatabase() as any

    expect(safeDb.characters).toEqual([{ chaId: 'char-a', name: 'Ada' }])
    expect(safeDb.pluginV2).toBeUndefined()
    expect(safeDb.botPresets).toBeUndefined()
    expect(safeDb.customPluginKey).toBe('visible')
    expect(Object.keys(safeDb)).toContain('customPluginKey')
    expect(Object.keys(safeDb)).not.toContain('pluginV2')
    expect(Object.keys(safeDb)).not.toContain('botPresets')
  })

  it('disables device-local plugin storage APIs by default in server mode', async () => {
    const apis = getV2PluginAPIs()
    const localPluginStorage = new SafeLocalPluginStorage()

    expect(() => apis.safeLocalStorage.getItem('device')).toThrow(
      /Device-local plugin storage is disabled/,
    )
    expect(() => apis.safeIdbFactory.open('device')).toThrow(
      /Device-local plugin storage is disabled/,
    )
    await expect(localPluginStorage.getItem('device')).rejects.toThrow(
      /Device-local plugin storage is disabled/,
    )
  })

  it('restores device-local plugin storage APIs when compatibility mode is enabled', () => {
    const apis = getV2PluginAPIs()
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      get length() {
        return values.size
      },
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => values.set(key, value)),
      removeItem: vi.fn((key: string) => values.delete(key)),
      key: vi.fn((index: number) => Array.from(values.keys())[index] ?? null),
    })
    const open = vi.fn(() => ({}) as IDBOpenDBRequest)
    vi.stubGlobal('indexedDB', {
      open,
      cmp: vi.fn(() => 0),
    })
    DBState.db.pluginCompatibilityMode = true

    apis.safeLocalStorage.setItem('device', 'enabled')

    expect(apis.safeLocalStorage.getItem('device')).toBe('enabled')
    expect(() => apis.safeIdbFactory.open('device')).not.toThrow()
    expect(open).toHaveBeenCalledWith('safe_plugin_device', undefined)
  })

})
