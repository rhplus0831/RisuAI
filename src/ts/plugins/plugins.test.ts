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
import { DBState, selectedCharID } from '../stores.svelte'
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

function seedPlugin(name: string, patch: Partial<RisuPlugin> = {}): RisuPlugin {
  return {
    name,
    script: 'Risuai.log("plugin")',
    arguments: {},
    realArg: {},
    version: '3.0',
    customLink: [],
    argMeta: {},
    enabled: true,
    ...patch,
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

interface PluginStorageCloneStats<T> {
  result: T
  jsonStringifyCount: number
  structuredCloneCount: number
  totalCloneCount: number
  maxClonedSize: number
}

function withPluginStorageCloneStats<T>(fn: () => T): PluginStorageCloneStats<T> {
  const originalStringify = JSON.stringify
  const originalStructuredClone = globalThis.structuredClone
  let jsonStringifyCount = 0
  let structuredCloneCount = 0
  let maxClonedSize = 0

  const measure = (value: unknown): number => {
    try {
      return (originalStringify as (input: unknown) => string)(value)?.length ?? 0
    } catch {
      return 0
    }
  }

  const trackedStringify = function trackedStringify(
    this: unknown,
    value: unknown,
    replacer?: unknown,
    space?: unknown,
  ) {
    jsonStringifyCount += 1
    const out = (originalStringify as (...args: unknown[]) => string).call(this, value, replacer, space)
    if (typeof out === 'string' && out.length > maxClonedSize) maxClonedSize = out.length
    return out
  } as unknown as typeof JSON.stringify

  const trackedStructuredClone = function trackedStructuredClone<V>(value: V): V {
    structuredCloneCount += 1
    const size = measure(value)
    if (size > maxClonedSize) maxClonedSize = size
    return (originalStructuredClone as (input: V) => V)(value)
  } as typeof structuredClone

  JSON.stringify = trackedStringify
  globalThis.structuredClone = trackedStructuredClone
  try {
    const result = fn()
    return {
      result,
      jsonStringifyCount,
      structuredCloneCount,
      totalCloneCount: jsonStringifyCount + structuredCloneCount,
      maxClonedSize,
    }
  } finally {
    JSON.stringify = originalStringify
    globalThis.structuredClone = originalStructuredClone
  }
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

  it('setChar applies only command-compatible character fields in server mode', async () => {
    const calls = stubCommandFetch()
    const apis = getV2PluginAPIs()
    selectedCharID.set(0)
    DBState.db.characters = [
      {
        chaId: 'char-a',
        name: 'Old name',
        desc: 'Old desc',
        chats: [{ id: 'chat-a', message: [{ role: 'user', data: 'old', chatId: 'msg-a' }] }],
        globalLore: [{ key: 'old lore' }],
        customscript: 'old custom script',
        triggerscript: 'old trigger script',
        modules: ['old-module'],
      },
    ] as any

    apis.setChar({
      chaId: 'plugin-supplied-id',
      name: 'New name',
      desc: 'New desc',
      chats: [{ id: 'chat-a', message: [{ role: 'user', data: 'changed', chatId: 'msg-a' }] }],
      globalLore: [{ key: 'changed lore' }],
      customscript: 'changed custom script',
      triggerscript: 'changed trigger script',
      modules: ['changed-module'],
    })

    expect(DBState.db.characters[0]).toEqual({
      chaId: 'char-a',
      name: 'New name',
      desc: 'New desc',
      chats: [{ id: 'chat-a', message: [{ role: 'user', data: 'old', chatId: 'msg-a' }] }],
      globalLore: [{ key: 'old lore' }],
      customscript: 'old custom script',
      triggerscript: 'old trigger script',
      modules: ['old-module'],
    })
    await vi.waitFor(() => {
      expect(calls.some((call) => call.url === '/api/v1/commands/characters/char-a')).toBe(true)
    })
    const update = calls.find((call) => call.url === '/api/v1/commands/characters/char-a')
    expect(update).toMatchObject({
      method: 'PATCH',
      body: {
        baseRevision: 10,
        patch: {
          name: 'New name',
          desc: 'New desc',
        },
      },
    })
    const patch = (update?.body as any)?.patch
    expect(patch).not.toHaveProperty('chaId')
    expect(patch).not.toHaveProperty('chats')
    expect(patch).not.toHaveProperty('globalLore')
    expect(patch).not.toHaveProperty('customscript')
    expect(patch).not.toHaveProperty('triggerscript')
    expect(patch).not.toHaveProperty('modules')
    expect(calls.some((call) => call.url === '/api/v1/commands/characters/plugin-supplied-id')).toBe(false)
  })

  it('setChar skips projection mutation and command dispatch for excluded-only character changes', async () => {
    const calls = stubCommandFetch()
    const apis = getV2PluginAPIs()
    selectedCharID.set(0)
    DBState.db.characters = [
      {
        chaId: 'char-a',
        name: 'Old name',
        chats: [{ id: 'chat-a', message: [{ role: 'user', data: 'old', chatId: 'msg-a' }] }],
        globalLore: [{ key: 'old lore' }],
      },
    ] as any
    const originalCharacter = JSON.parse(JSON.stringify(DBState.db.characters[0]))

    apis.setChar({
      ...originalCharacter,
      chaId: 'plugin-supplied-id',
      chats: [{ id: 'chat-a', message: [{ role: 'user', data: 'changed', chatId: 'msg-a' }] }],
      globalLore: [{ key: 'changed lore' }],
    })

    await new Promise((resolve) => setTimeout(resolve, 30))

    expect(DBState.db.characters[0]).toEqual(originalCharacter)
    expect(calls.some((call) => call.url.startsWith('/api/v1/commands/characters/'))).toBe(false)
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
      modules: [seedModule('mod-a', { description: 'updated' }), seedModule('mod-b', { description: 'new module' })],
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
      modules: [seedModule('mod-a', { description: 'updated' }), seedModule('mod-b', { description: 'new module' })],
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

  it('serializes plugin collection create/update/delete commands against advancing revisions', async () => {
    let nextRevision = 300
    const captured: { url: string; method: string; body: { baseRevision?: number; [key: string]: unknown } }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input)
        if (url === '/api/v1/bootstrap') {
          return jsonResponse({ revision: nextRevision })
        }
        const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
        captured.push({ url, method: init.method ?? 'GET', body })
        nextRevision += 1
        return jsonResponse({
          revision: nextRevision,
          event: {
            type: 'plugin.updated',
            revision: nextRevision,
            resource: 'plugin',
          } as unknown as CommandEvent,
        })
      }) as unknown as typeof fetch,
    )

    DBState.db.plugins = [seedPlugin('plugin-a'), seedPlugin('plugin-c')]
    const apis = getV2PluginAPIs()

    apis.setDatabaseLite({
      plugins: [
        seedPlugin('plugin-a', { displayName: 'Updated A' }),
        seedPlugin('plugin-b', { displayName: 'Plugin B' }),
      ],
    })

    await vi.waitFor(() => {
      expect(captured.length).toBe(3)
    })
    expect(captured[0]).toMatchObject({
      url: '/api/v1/commands/plugins/plugin-a',
      method: 'PATCH',
      body: {
        baseRevision: 300,
        patch: expect.objectContaining({ displayName: 'Updated A' }),
      },
    })
    expect(captured[0].body.patch).not.toHaveProperty('name')
    expect(captured[1]).toMatchObject({
      url: '/api/v1/commands/plugins',
      method: 'POST',
      body: {
        baseRevision: 301,
        plugin: expect.objectContaining({ name: 'plugin-b', displayName: 'Plugin B' }),
      },
    })
    expect(captured[2]).toMatchObject({
      url: '/api/v1/commands/plugins/plugin-c',
      method: 'DELETE',
      body: {
        baseRevision: 302,
      },
    })
    expect(captured.some((call) => call.url === '/api/v1/commands/plugins/reorder')).toBe(false)
  })

  it('serializes plugin collection reorder commands against advancing revisions', async () => {
    let nextRevision = 400
    const captured: { url: string; method: string; body: { baseRevision?: number; [key: string]: unknown } }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input)
        if (url === '/api/v1/bootstrap') {
          return jsonResponse({ revision: nextRevision })
        }
        const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
        captured.push({ url, method: init.method ?? 'GET', body })
        nextRevision += 1
        return jsonResponse({
          revision: nextRevision,
          event: {
            type: 'plugin.updated',
            revision: nextRevision,
            resource: 'plugin',
          } as unknown as CommandEvent,
        })
      }) as unknown as typeof fetch,
    )

    DBState.db.plugins = [seedPlugin('plugin-a'), seedPlugin('plugin-b'), seedPlugin('plugin-c')]
    const apis = getV2PluginAPIs()

    apis.setDatabaseLite({
      plugins: [seedPlugin('plugin-c', { displayName: 'Updated C' }), seedPlugin('plugin-b')],
    })

    await vi.waitFor(() => {
      expect(captured.length).toBe(3)
    })
    expect(captured[0]).toMatchObject({
      url: '/api/v1/commands/plugins/plugin-c',
      method: 'PATCH',
      body: {
        baseRevision: 400,
        patch: expect.objectContaining({ displayName: 'Updated C' }),
      },
    })
    expect(captured[1]).toMatchObject({
      url: '/api/v1/commands/plugins/plugin-a',
      method: 'DELETE',
      body: {
        baseRevision: 401,
      },
    })
    expect(captured[2]).toMatchObject({
      url: '/api/v1/commands/plugins/reorder',
      method: 'POST',
      body: {
        baseRevision: 402,
        pluginIds: ['plugin-c', 'plugin-b'],
      },
    })
  })

  it('rolls back plugin collection replacement when a sequenced command fails and skips later commands', async () => {
    const previousPlugins = [seedPlugin('plugin-a'), seedPlugin('plugin-c')]
    const captured: { url: string; method: string; body: { baseRevision?: number; [key: string]: unknown } }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input)
        if (url === '/api/v1/bootstrap') {
          return jsonResponse({ revision: 500 })
        }
        const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
        captured.push({ url, method: init.method ?? 'GET', body })
        if (captured.length === 1) {
          return jsonResponse({ error: 'failed plugin update' }, 500)
        }
        return jsonResponse({
          revision: 501,
          event: {
            type: 'plugin.updated',
            revision: 501,
            resource: 'plugin',
          } as unknown as CommandEvent,
        })
      }) as unknown as typeof fetch,
    )

    DBState.db.plugins = previousPlugins
    const apis = getV2PluginAPIs()

    apis.setDatabaseLite({
      plugins: [
        seedPlugin('plugin-a', { displayName: 'Updated A' }),
        seedPlugin('plugin-b', { displayName: 'Plugin B' }),
      ],
    })

    await vi.waitFor(() => {
      expect(DBState.db.plugins).toEqual(previousPlugins)
    })
    expect(captured).toHaveLength(1)
    expect(captured[0]).toMatchObject({
      url: '/api/v1/commands/plugins/plugin-a',
      method: 'PATCH',
      body: {
        baseRevision: 500,
      },
    })
    expect(captured.some((call) => call.url === '/api/v1/commands/plugins')).toBe(false)
    expect(captured.some((call) => call.url === '/api/v1/commands/plugins/plugin-c')).toBe(false)
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
    expect(calls.find((call) => call.url === '/api/v1/commands/plugin-storage/bulk')).toMatchObject({
      method: 'POST',
      body: {
        baseRevision: 10,
        values: { customPluginKey: { value: 1 } },
      },
    })
    expect(DBState.db.pluginCustomStorage.customPluginKey).toEqual({ value: 1 })
  })

  it('blocks recognized resource families (in allowedDbKeys) in server mode without persisting', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const calls = stubCommandFetch()
    const apis = getV2PluginAPIs()
    DBState.db.characters = [{ chaId: 'char-a', name: 'Ada', chats: [], chatPage: 0 }] as any

    apis.setDatabaseLite({ characters: [{ chaId: 'char-b', name: 'Grace' }] })

    await new Promise((resolve) => setTimeout(resolve, 30))

    // No projection change, no plugin-storage shadow, no command dispatched.
    expect(DBState.db.characters).toEqual([{ chaId: 'char-a', name: 'Ada', chats: [], chatPage: 0 }])
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
    DBState.db.characters = [{ chaId: 'char-a', name: 'Ada', chats: [], chatPage: 0 }] as any
    DBState.db.pluginCustomStorage = {
      characters: [{ chaId: 'shadow-char', name: 'Shadow' }],
      pluginV2: [{ name: 'shadow-v2' }],
      botPresets: [{ id: 'shadow-preset' }],
      customPluginKey: 'visible',
    }

    const safeDb = apis.getDatabase() as any

    expect(safeDb.characters).toEqual([{ chaId: 'char-a', name: 'Ada', chats: [], chatPage: 0 }])
    expect(safeDb.pluginV2).toBeUndefined()
    expect(safeDb.botPresets).toBeUndefined()
    expect(safeDb.customPluginKey).toBe('visible')
    expect(Object.keys(safeDb)).toContain('customPluginKey')
    expect(Object.keys(safeDb)).not.toContain('pluginV2')
    expect(Object.keys(safeDb)).not.toContain('botPresets')
  })

  it('M8: pluginStorage.getItem clones only the selected key without a whole-DB snapshot', () => {
    const apis = getV2PluginAPIs()
    const largeBody = 'x'.repeat(80_000)
    DBState.db.characters = [
      {
        chaId: 'char-a',
        chats: [
          {
            id: 'chat-a',
            message: [{ role: 'user', data: largeBody, chatId: 'msg-a' }],
          },
        ],
      },
    ] as any
    DBState.db.pluginCustomStorage = {
      selected: { nested: { count: 1 }, list: ['kept'] },
      unrelated: { blob: largeBody },
    }
    const unrelatedStorageSize = JSON.stringify(DBState.db.pluginCustomStorage.unrelated).length
    const charactersSize = JSON.stringify(DBState.db.characters).length

    const stats = withPluginStorageCloneStats(
      () =>
        apis.pluginStorage.getItem('selected') as {
          nested: { count: number }
          list: string[]
        },
    )

    expect(stats.structuredCloneCount).toBe(1)
    expect(stats.totalCloneCount).toBe(1)
    expect(stats.maxClonedSize).toBeLessThan(unrelatedStorageSize)
    expect(stats.maxClonedSize).toBeLessThan(charactersSize)
    expect(stats.result).toEqual({ nested: { count: 1 }, list: ['kept'] })
    expect(stats.result).not.toBe(DBState.db.pluginCustomStorage.selected)

    stats.result.nested.count = 2
    stats.result.list.push('changed')
    expect(DBState.db.pluginCustomStorage.selected).toEqual({
      nested: { count: 1 },
      list: ['kept'],
    })
  })

  it('M8: pluginStorage.getItem preserves missing scalar and falsey results', () => {
    const apis = getV2PluginAPIs()
    DBState.db.pluginCustomStorage = {
      empty: '',
      zero: 0,
      disabled: false,
      text: 'stored',
      nullValue: null,
    }

    expect(apis.pluginStorage.getItem('empty')).toBe('')
    expect(apis.pluginStorage.getItem('zero')).toBe(0)
    expect(apis.pluginStorage.getItem('disabled')).toBe(false)
    expect(apis.pluginStorage.getItem('text')).toBe('stored')
    expect(apis.pluginStorage.getItem('nullValue')).toBeNull()
    expect(apis.pluginStorage.getItem('missing')).toBeNull()

    DBState.db = {
      currentPluginProvider: 'old-provider',
      pluginCompatibilityMode: false,
      plugins: [seedPlugin('plugin-a')],
      modules: [seedModule('mod-a')],
      enabledModules: [],
    } as any
    expect(Object.prototype.hasOwnProperty.call(DBState.db, 'pluginCustomStorage')).toBe(false)
    expect(apis.pluginStorage.getItem('missing')).toBeNull()
    expect(Object.prototype.hasOwnProperty.call(DBState.db, 'pluginCustomStorage')).toBe(false)
  })

  it('M8: pluginStorage.getItem detaches array values from live plugin storage', () => {
    const apis = getV2PluginAPIs()
    DBState.db.pluginCustomStorage = {
      arrayValue: [{ label: 'live' }],
    }

    const value = apis.pluginStorage.getItem('arrayValue') as Array<{ label: string }>

    expect(value).toEqual([{ label: 'live' }])
    expect(value).not.toBe(DBState.db.pluginCustomStorage.arrayValue)
    value[0].label = 'mutated'
    value.push({ label: 'new' })
    expect(DBState.db.pluginCustomStorage.arrayValue).toEqual([{ label: 'live' }])
  })

  it('disables device-local plugin storage APIs by default in server mode', async () => {
    const apis = getV2PluginAPIs()
    const localPluginStorage = new SafeLocalPluginStorage()

    expect(() => apis.safeLocalStorage.getItem('device')).toThrow(/Device-local plugin storage is disabled/)
    expect(() => apis.safeIdbFactory.open('device')).toThrow(/Device-local plugin storage is disabled/)
    await expect(localPluginStorage.getItem('device')).rejects.toThrow(/Device-local plugin storage is disabled/)
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
