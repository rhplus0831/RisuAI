import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'

const pluginImportMocks = vi.hoisted(() => ({
  alertConfirm: vi.fn(),
  alertError: vi.fn(),
  alertPluginConfirm: vi.fn(),
  selectMultipleFile: vi.fn(),
  selectSingleFile: vi.fn(),
  sleep: vi.fn(),
}))

function createUtilMock() {
  return {
    BufferToText: (data: Uint8Array) => new TextDecoder().decode(data),
    asBuffer: (data: Uint8Array | ArrayBuffer) => (data instanceof Uint8Array ? data : new Uint8Array(data)),
    base64url: vi.fn((value: string) => value),
    blobToUint8Array: vi.fn(async () => new Uint8Array()),
    checkNullish: (data: unknown) => data === undefined || data === null,
    decryptBuffer: vi.fn(async (data: Uint8Array) => data),
    encryptBuffer: vi.fn(async (data: Uint8Array) => data),
    findCharacterIndexbyId: vi.fn(() => -1),
    findCharacterbyId: vi.fn((id: string) => ({ chaId: id, name: id, chats: [], chatPage: 0 })),
    getAuthorNoteDefaultText: vi.fn(() => ''),
    getKeypairStore: vi.fn(() => null),
    getNodetextToSentence: vi.fn((text: string) => [text]),
    getPersonaPrompt: vi.fn(() => ''),
    getUserIcon: vi.fn(() => ''),
    getUserIconProtrait: vi.fn(() => ''),
    getUserName: vi.fn(() => 'User'),
    isKnownUri: vi.fn(() => false),
    jsonOutputTrimmer: vi.fn((text: string) => text),
    messageForm: vi.fn((messages: unknown[]) => messages),
    parseKeyValue: vi.fn(() => ({})),
    parseMultilangString: vi.fn((text: string) => text),
    pickHashRand: vi.fn((items: unknown[]) => items?.[0]),
    prebuiltAssetCommand: vi.fn(() => ''),
    replaceAsync: vi.fn(async (text: string) => text),
    replacePlaceholders: vi.fn((text: string) => text),
    saveKeypairStore: vi.fn(),
    selectFileByDom: vi.fn(async () => []),
    selectMultipleFile: pluginImportMocks.selectMultipleFile,
    selectSingleFile: pluginImportMocks.selectSingleFile,
    simplifySchema: vi.fn((schema: unknown) => schema),
    sleep: pluginImportMocks.sleep,
    sortableOptions: {},
    toLangName: vi.fn((code: string) => code),
    trimUntilPunctuation: vi.fn((text: string) => text),
  }
}

vi.mock('../platform', () => ({ isFastifyServer: true, isIOS: () => false }))
vi.mock('src/ts/platform', () => ({ isFastifyServer: true, isIOS: () => false }))

vi.mock('../storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'plugin-test-auth',
}))

vi.mock('../alert', () => ({
  alertConfirm: pluginImportMocks.alertConfirm,
  alertError: pluginImportMocks.alertError,
  alertPluginConfirm: pluginImportMocks.alertPluginConfirm,
}))

vi.mock('../util', () => createUtilMock())
vi.mock('src/ts/util', () => createUtilMock())

vi.mock('./apiV3/v3.svelte', () => ({
  loadV3Plugins: vi.fn(async () => undefined),
}))

vi.mock('./pluginSafety', () => ({
  checkCodeSafety: vi.fn(async () => ({ isSafe: true, errors: [] })),
}))

import { clearCachedServerCommandRevision, type CommandEvent } from '../server/commands'
import { setResourceWriteGuardEnabled, withTrustedResourceWrite } from '../server/resourceWriteGuard.svelte'
import { selectedCharID } from '../stores.svelte'
import { getDatabase, setDatabaseLite, type Database } from '../storage/database.svelte'
import { SafeLocalPluginStorage } from './pluginSafeClass'
import { loadV3Plugins } from './apiV3/v3.svelte'
import { getV2PluginAPIs, importPlugin, updatePlugin, type RisuPlugin } from './plugins.svelte'
import type { RisuModule } from '../process/modules'

interface CapturedFetch {
  url: string
  method: string
  body: unknown
}

interface SelectedFile {
  name: string
  data: Uint8Array
}

interface SelectSingleFileOptions {
  onFileSelected?: (file: File) => void
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

function createPicker() {
  const deferred = createDeferred<SelectedFile | null>()
  let options: SelectSingleFileOptions | undefined
  let selected: SelectedFile | null = null

  return {
    selectSingleFile: vi.fn((_extensions: string[], selectOptions?: SelectSingleFileOptions) => {
      options = selectOptions
      return deferred.promise
    }),
    select(value: SelectedFile | null) {
      selected = value
      if (value) {
        const data = value.data.buffer.slice(value.data.byteOffset, value.data.byteOffset + value.data.byteLength)
        options?.onFileSelected?.(new File([data as ArrayBuffer], value.name))
      }
    },
    resolve(value: SelectedFile | null = selected) {
      deferred.resolve(value)
    },
  }
}

function stubCommandFetch(options: { failCommands?: boolean; failCommandUrls?: string[] } = {}): CapturedFetch[] {
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
      if (options.failCommands || options.failCommandUrls?.includes(url)) {
        return jsonResponse({ error: 'forced command failure' }, 500)
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

function stubRemotePluginUpdateFetch(input: {
  remoteUrl: string
  remoteSource: Promise<string> | string
  commandResponse?: Promise<Response> | Response
  failCommands?: boolean
}): CapturedFetch[] {
  const calls: CapturedFetch[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(request)
      if (url === input.remoteUrl) {
        return {
          status: 200,
          text: vi.fn(async () => input.remoteSource),
        } as unknown as Response
      }
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
      if (url === '/api/v1/bootstrap') {
        return jsonResponse({ revision: 10 })
      }
      calls.push({ url, method: init.method ?? 'GET', body })
      if (input.commandResponse) {
        return input.commandResponse
      }
      if (input.failCommands) {
        return jsonResponse({ error: 'forced command failure' }, 500)
      }
      const event: CommandEvent = {
        type: 'plugin.updated',
        revision: 11,
        resource: 'plugin',
      } as CommandEvent
      return jsonResponse({ revision: 11, event })
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
      const url = String(input)
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
      calls.push({ url, method: init.method ?? 'GET', body })
      if (url === '/api/v1/bootstrap') {
        return jsonResponse({ revision: 10 })
      }
      return new Promise<Response>((resolve) => {
        commandResponses.push({ resolve })
      })
    }) as unknown as typeof fetch,
  )
  return { calls, commandResponses }
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

function pluginSource(
  name: string,
  options: {
    api?: '2.1' | '3.0'
    body?: string
    versionOfPlugin?: string
    updateURL?: string
  } = {},
): string {
  const lines = [`//@name ${name}`, `//@display-name ${name}`, `//@api ${options.api ?? '3.0'}`]
  if (options.versionOfPlugin) {
    lines.push(`//@version ${options.versionOfPlugin}`)
  }
  if (options.updateURL) {
    lines.push(`//@update-url ${options.updateURL}`)
  }
  lines.push(options.body ?? `Risuai.log("${name}")`)
  return lines.join('\n')
}

function selectedPluginFile(source: string, name = 'plugin.js'): SelectedFile {
  return {
    name,
    data: new TextEncoder().encode(source),
  }
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
  pluginImportMocks.alertConfirm.mockReset()
  pluginImportMocks.alertConfirm.mockResolvedValue(true)
  pluginImportMocks.alertError.mockReset()
  pluginImportMocks.alertPluginConfirm.mockReset()
  pluginImportMocks.alertPluginConfirm.mockResolvedValue(true)
  pluginImportMocks.selectMultipleFile.mockReset()
  pluginImportMocks.selectMultipleFile.mockResolvedValue([])
  pluginImportMocks.selectSingleFile.mockReset()
  pluginImportMocks.sleep.mockReset()
  pluginImportMocks.sleep.mockResolvedValue(undefined)
  vi.mocked(loadV3Plugins).mockClear()
  setResourceWriteGuardEnabled(false)
  setDatabaseLite({
    currentPluginProvider: 'old-provider',
    pluginCustomStorage: {},
    pluginCompatibilityMode: false,
    plugins: [seedPlugin('plugin-a')],
    modules: [seedModule('mod-a')],
    enabledModules: [],
  } as any)
})

afterEach(() => {
  setResourceWriteGuardEnabled(false)
})

describe('plugin import/update freshness', () => {
  it('drops file import after real file selection if the plugin list changes before file read completes', async () => {
    const calls = stubCommandFetch()
    const picker = createPicker()
    pluginImportMocks.selectSingleFile.mockImplementation(picker.selectSingleFile)

    const importPromise = importPlugin()
    await vi.waitFor(() => {
      expect(pluginImportMocks.selectSingleFile).toHaveBeenCalledWith(['js', 'ts'], expect.any(Object))
    })

    picker.select(selectedPluginFile(pluginSource('plugin-b')))
    getDatabase().plugins.push(seedPlugin('plugin-newer'))
    picker.resolve()

    await expect(importPromise).resolves.toBe(false)
    expect(getDatabase().plugins.map((plugin) => plugin.name)).toEqual(['plugin-a', 'plugin-newer'])
    expect(calls).toEqual([])
  })

  it('does not alert for an invalid stale plugin import', async () => {
    const picker = createPicker()
    pluginImportMocks.selectSingleFile.mockImplementation(picker.selectSingleFile)

    const importPromise = importPlugin()
    await vi.waitFor(() => {
      expect(pluginImportMocks.selectSingleFile).toHaveBeenCalledWith(['js', 'ts'], expect.any(Object))
    })

    picker.select(selectedPluginFile('not a plugin'))
    getDatabase().plugins.push(seedPlugin('plugin-newer'))
    picker.resolve()

    await expect(importPromise).resolves.toBe(false)
    expect(pluginImportMocks.alertError).not.toHaveBeenCalled()
    expect(getDatabase().plugins.map((plugin) => plugin.name)).toEqual(['plugin-a', 'plugin-newer'])
  })

  it('drops duplicate-confirm imports if plugin state changes while the confirm is open', async () => {
    const calls = stubCommandFetch()
    const confirm = createDeferred<boolean>()
    pluginImportMocks.alertConfirm.mockReturnValue(confirm.promise)
    const originalScript = getDatabase().plugins[0].script

    const importPromise = importPlugin(pluginSource('plugin-a', { body: 'Risuai.log("updated")' }))
    await vi.waitFor(() => {
      expect(pluginImportMocks.alertConfirm).toHaveBeenCalled()
    })

    getDatabase().plugins.push(seedPlugin('plugin-newer'))
    confirm.resolve(true)

    await expect(importPromise).resolves.toBe(false)
    expect(getDatabase().plugins[0].script).toBe(originalScript)
    expect(getDatabase().plugins.map((plugin) => plugin.name)).toEqual(['plugin-a', 'plugin-newer'])
    expect(calls).toEqual([])
  })

  it('rolls back a fresh server-backed plugin import and skips runtime reload when create fails', async () => {
    const calls = stubCommandFetch({ failCommands: true })

    await expect(importPlugin(pluginSource('plugin-created'))).resolves.toBe(false)

    expect(getDatabase().plugins.map((plugin) => plugin.name)).toEqual(['plugin-a'])
    expect(calls.find((call) => call.url === '/api/v1/commands/plugins')).toMatchObject({
      method: 'POST',
      body: {
        baseRevision: 10,
        plugin: expect.objectContaining({
          name: 'plugin-created',
        }),
      },
    })
    expect(loadV3Plugins).not.toHaveBeenCalled()
  })

  it('loads a fresh server-backed plugin import only after create acceptance', async () => {
    const { calls, commandResponses } = stubDeferredCommandFetch()
    const importPromise = importPlugin(pluginSource('plugin-created'))

    await vi.waitFor(() => {
      expect(calls.some((call) => call.url === '/api/v1/commands/plugins')).toBe(true)
    })
    expect(getDatabase().plugins.map((plugin) => plugin.name)).toEqual(['plugin-a', 'plugin-created'])
    expect(loadV3Plugins).not.toHaveBeenCalled()

    commandResponses[0].resolve(
      jsonResponse({
        revision: 11,
        event: {
          type: 'plugin.created',
          revision: 11,
          resource: 'plugin',
          id: 'plugin-created',
        } as CommandEvent,
      }),
    )

    await expect(importPromise).resolves.toBe(true)
    await vi.waitFor(() => {
      expect(loadV3Plugins).toHaveBeenCalledTimes(1)
    })
    expect(vi.mocked(loadV3Plugins).mock.calls[0][0].map((plugin) => plugin.name)).toEqual([
      'plugin-a',
      'plugin-created',
    ])
  })

  it('drops remote update if the original plugin row changes while fetch text is in flight', async () => {
    const remoteUrl = 'https://plugins.example/plugin-a.js'
    const remoteSource = createDeferred<string>()
    const calls = stubRemotePluginUpdateFetch({
      remoteUrl,
      remoteSource: remoteSource.promise,
    })
    getDatabase().plugins = [
      seedPlugin('plugin-a', {
        script: 'Risuai.log("old")',
        updateURL: remoteUrl,
        versionOfPlugin: '1.0.0',
      }),
    ]

    const updatePromise = updatePlugin(getDatabase().plugins[0])
    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(remoteUrl)
    })

    getDatabase().plugins[0] = seedPlugin('plugin-a', {
      script: 'Risuai.log("reinstalled")',
      updateURL: remoteUrl,
      versionOfPlugin: '1.0.0',
    })
    remoteSource.resolve(
      pluginSource('plugin-a', {
        body: 'Risuai.log("updated")',
        versionOfPlugin: '1.0.1',
        updateURL: remoteUrl,
      }),
    )

    await expect(updatePromise).resolves.toBe(false)
    expect(getDatabase().plugins[0].script).toBe('Risuai.log("reinstalled")')
    expect(calls).toEqual([])
  })

  it('rolls back a fresh remote update and skips runtime reload when update command fails', async () => {
    const remoteUrl = 'https://plugins.example/plugin-a.js'
    const updatedSource = pluginSource('plugin-a', {
      body: 'Risuai.log("updated")',
      versionOfPlugin: '1.0.1',
      updateURL: remoteUrl,
    })
    const calls = stubRemotePluginUpdateFetch({
      remoteUrl,
      remoteSource: updatedSource,
      failCommands: true,
    })
    getDatabase().plugins = [
      seedPlugin('plugin-a', {
        script: 'Risuai.log("old")',
        updateURL: remoteUrl,
        versionOfPlugin: '1.0.0',
      }),
    ]

    await expect(updatePlugin(getDatabase().plugins[0])).resolves.toBe(false)

    expect(getDatabase().plugins).toEqual([
      seedPlugin('plugin-a', {
        script: 'Risuai.log("old")',
        updateURL: remoteUrl,
        versionOfPlugin: '1.0.0',
      }),
    ])
    expect(calls.find((call) => call.url === '/api/v1/commands/plugins/plugin-a')).toMatchObject({
      method: 'PATCH',
      body: {
        baseRevision: 10,
        patch: expect.objectContaining({
          script: updatedSource,
          versionOfPlugin: '1.0.1',
          updateURL: remoteUrl,
        }),
      },
    })
    expect(loadV3Plugins).not.toHaveBeenCalled()
  })

  it('loads a fresh remote update only after update acceptance', async () => {
    const remoteUrl = 'https://plugins.example/plugin-a.js'
    const updatedSource = pluginSource('plugin-a', {
      body: 'Risuai.log("updated")',
      versionOfPlugin: '1.0.1',
      updateURL: remoteUrl,
    })
    const commandResponse = createDeferred<Response>()
    const calls = stubRemotePluginUpdateFetch({
      remoteUrl,
      remoteSource: updatedSource,
      commandResponse: commandResponse.promise,
    })
    getDatabase().plugins = [
      seedPlugin('plugin-a', {
        script: 'Risuai.log("old")',
        updateURL: remoteUrl,
        versionOfPlugin: '1.0.0',
      }),
    ]

    const updatePromise = updatePlugin(getDatabase().plugins[0])

    await vi.waitFor(() => {
      expect(calls.some((call) => call.url === '/api/v1/commands/plugins/plugin-a')).toBe(true)
    })
    expect(getDatabase().plugins[0].script).toBe(updatedSource)
    expect(loadV3Plugins).not.toHaveBeenCalled()

    commandResponse.resolve(
      jsonResponse({
        revision: 11,
        event: {
          type: 'plugin.updated',
          revision: 11,
          resource: 'plugin',
          id: 'plugin-a',
        } as CommandEvent,
      }),
    )

    await expect(updatePromise).resolves.toBe(true)
    await vi.waitFor(() => {
      expect(loadV3Plugins).toHaveBeenCalledTimes(1)
    })
    expect(vi.mocked(loadV3Plugins).mock.calls[0][0].map((plugin) => plugin.name)).toEqual(['plugin-a'])
  })

  it('dispatches the plugin patch command for a fresh remote update', async () => {
    const remoteUrl = 'https://plugins.example/plugin-a.js'
    const updatedSource = pluginSource('plugin-a', {
      body: 'Risuai.log("updated")',
      versionOfPlugin: '1.0.1',
      updateURL: remoteUrl,
    })
    const calls = stubRemotePluginUpdateFetch({
      remoteUrl,
      remoteSource: updatedSource,
    })
    getDatabase().plugins = [
      seedPlugin('plugin-a', {
        script: 'Risuai.log("old")',
        updateURL: remoteUrl,
        versionOfPlugin: '1.0.0',
      }),
    ]

    await expect(updatePlugin(getDatabase().plugins[0])).resolves.toBe(true)

    expect(getDatabase().plugins[0].script).toBe(updatedSource)
    await vi.waitFor(() => {
      expect(calls.some((call) => call.url === '/api/v1/commands/plugins/plugin-a')).toBe(true)
    })
    expect(calls.find((call) => call.url === '/api/v1/commands/plugins/plugin-a')).toMatchObject({
      method: 'PATCH',
      body: {
        baseRevision: 10,
        patch: expect.objectContaining({
          script: updatedSource,
          versionOfPlugin: '1.0.1',
          updateURL: remoteUrl,
        }),
      },
    })
  })
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
    expect(getDatabase().currentPluginProvider).toBe('provider-a')
  })

  it('setArg updates plugin realArg through a command without throwing under the resource write guard', async () => {
    const calls = stubCommandFetch()
    const apis = getV2PluginAPIs()
    setResourceWriteGuardEnabled(true)

    // Baseline: the guard is active, so a raw projection write throws.
    expect(() => {
      getDatabase().plugins[0].realArg['raw'] = 'x'
    }).toThrow(/resource database compatibility view is read-only/)

    expect(() => apis.setArg('plugin-a::myarg', 'myvalue')).not.toThrow()

    await vi.waitFor(() => {
      expect(calls.some((call) => call.url === '/api/v1/commands/plugins/plugin-a')).toBe(true)
    })
    expect(calls.find((call) => call.url === '/api/v1/commands/plugins/plugin-a')).toMatchObject({
      method: 'PATCH',
      body: { patch: { realArg: { myarg: 'myvalue' } } },
    })
    expect(getDatabase().plugins[0].realArg.myarg).toBe('myvalue')
  })

  it('setChar applies command-compatible character fields in server mode', async () => {
    const calls = stubCommandFetch()
    const apis = getV2PluginAPIs()
    selectedCharID.set(0)
    getDatabase().characters = [
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
      chaId: 'char-a',
      name: 'New name',
      desc: 'New desc',
      chats: [{ id: 'chat-a', message: [{ role: 'user', data: 'old', chatId: 'msg-a' }] }],
      globalLore: [{ key: 'old lore' }],
      customscript: 'old custom script',
      triggerscript: 'old trigger script',
      modules: ['old-module'],
    })

    expect(getDatabase().characters[0]).toEqual({
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
  })

  it('setChar failure rolls back attempted target fields without clobbering sibling edits or selection', async () => {
    const calls = stubCommandFetch({ failCommands: true })
    const apis = getV2PluginAPIs()
    selectedCharID.set(0)
    getDatabase().characters = [
      {
        chaId: 'char-a',
        name: 'Old name',
        desc: 'Old desc',
        chats: [{ id: 'chat-a', message: [] }],
      },
      {
        chaId: 'char-b',
        name: 'Sibling name',
        chats: [{ id: 'chat-b', message: [] }],
      },
    ] as any
    ;(getDatabase() as any).currentChar = 0

    apis.setChar({
      chaId: 'char-a',
      name: 'Attempted name',
      desc: 'Attempted desc',
      chats: [{ id: 'chat-a', message: [] }],
    })

    expect(getDatabase().characters[0]).toMatchObject({
      chaId: 'char-a',
      name: 'Attempted name',
      desc: 'Attempted desc',
    })

    getDatabase().characters[1].name = 'Newer sibling name'
    ;(getDatabase() as any).currentChar = 1
    selectedCharID.set(1)

    await vi.waitFor(() => {
      expect(calls.some((call) => call.url === '/api/v1/commands/characters/char-a')).toBe(true)
    })
    await vi.waitFor(() => {
      expect(getDatabase().characters[0].name).toBe('Old name')
    })

    expect(getDatabase().characters[0].desc).toBe('Old desc')
    expect(getDatabase().characters[1].name).toBe('Newer sibling name')
    expect((getDatabase() as any).currentChar).toBe(1)
    expect(get(selectedCharID)).toBe(1)
  })

  it('setChar rejects unsupported character field changes before projection mutation and command dispatch', async () => {
    const calls = stubCommandFetch()
    const apis = getV2PluginAPIs()
    selectedCharID.set(0)
    getDatabase().characters = [
      {
        chaId: 'char-a',
        name: 'Old name',
        chats: [{ id: 'chat-a', message: [{ role: 'user', data: 'old', chatId: 'msg-a' }] }],
        globalLore: [{ key: 'old lore' }],
        customscript: 'old custom script',
      },
    ] as any
    const originalCharacter = JSON.parse(JSON.stringify(getDatabase().characters[0]))

    expect(() =>
      apis.setChar({
        ...originalCharacter,
        name: 'New name',
        chats: [{ id: 'chat-a', message: [{ role: 'user', data: 'changed', chatId: 'msg-a' }] }],
        globalLore: [{ key: 'changed lore' }],
        customscript: 'changed custom script',
      }),
    ).toThrow(/setChar cannot update unsupported character fields .*chats, globalLore, customscript/)

    await new Promise((resolve) => setTimeout(resolve, 30))

    expect(getDatabase().characters[0]).toEqual(originalCharacter)
    expect(calls.some((call) => call.url.startsWith('/api/v1/commands/characters/'))).toBe(false)
  })

  it('setChar rejects excluded-only character changes before projection mutation and command dispatch', async () => {
    const calls = stubCommandFetch()
    const apis = getV2PluginAPIs()
    selectedCharID.set(0)
    getDatabase().characters = [
      {
        chaId: 'char-a',
        name: 'Old name',
        chats: [{ id: 'chat-a', message: [{ role: 'user', data: 'old', chatId: 'msg-a' }] }],
        globalLore: [{ key: 'old lore' }],
      },
    ] as any
    const originalCharacter = JSON.parse(JSON.stringify(getDatabase().characters[0]))

    expect(() =>
      apis.setChar({
        ...originalCharacter,
        chaId: 'plugin-supplied-id',
        chats: [{ id: 'chat-a', message: [{ role: 'user', data: 'changed', chatId: 'msg-a' }] }],
        globalLore: [{ key: 'changed lore' }],
      }),
    ).toThrow(/setChar cannot update unsupported character fields .*chaId, chats, globalLore/)

    await new Promise((resolve) => setTimeout(resolve, 30))

    expect(getDatabase().characters[0]).toEqual(originalCharacter)
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
    expect(getDatabase().moduleIntergration).toBe('ns-a, ns-b')
  })

  it('rolls back failed plugin DB bridge settings patches without clobbering newer plugin state', async () => {
    const advancedCommand = createDeferred<Response>()
    const captured: { url: string; method: string; body: { baseRevision?: number; [key: string]: unknown } }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input)
        if (url === '/api/v1/bootstrap') {
          return jsonResponse({ revision: 50 })
        }
        const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
        captured.push({ url, method: init.method ?? 'GET', body })
        if (url === '/api/v1/commands/settings/advanced') {
          return advancedCommand.promise
        }
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )
    setResourceWriteGuardEnabled(true)
    withTrustedResourceWrite(() => {
      getDatabase().moduleIntergration = 'old-modules'
      getDatabase().plugins = [seedPlugin('plugin-a')]
      getDatabase().currentPluginProvider = 'plugin-a'
      getDatabase().pluginCustomStorage = {
        retained: { value: 1 },
      }
    })
    const apis = getV2PluginAPIs()

    apis.setDatabaseLite({ moduleIntergration: 'attempted-modules' })

    await vi.waitFor(() => {
      expect(captured.length).toBe(1)
    })
    expect(getDatabase().moduleIntergration).toBe('attempted-modules')

    withTrustedResourceWrite(() => {
      getDatabase().plugins.push(
        seedPlugin('plugin-newer', {
          realArg: { mode: 'newer-plugin' },
        }),
      )
      getDatabase().currentPluginProvider = 'plugin-newer'
      getDatabase().pluginCustomStorage.newerStorage = { value: 'kept' }
    })
    advancedCommand.resolve(jsonResponse({ error: 'forced advanced failure' }, 500))

    await vi.waitFor(() => {
      expect(getDatabase().moduleIntergration).toBe('old-modules')
    })

    expect(captured[0]).toMatchObject({
      url: '/api/v1/commands/settings/advanced',
      method: 'PATCH',
      body: {
        baseRevision: 50,
        patch: {
          moduleIntergration: 'attempted-modules',
        },
      },
    })
    expect(getDatabase().plugins).toEqual([
      seedPlugin('plugin-a'),
      seedPlugin('plugin-newer', {
        realArg: { mode: 'newer-plugin' },
      }),
    ])
    expect(getDatabase().currentPluginProvider).toBe('plugin-newer')
    expect(getDatabase().pluginCustomStorage).toEqual({
      retained: { value: 1 },
      newerStorage: { value: 'kept' },
    })
  })

  it('keeps accepted plugin DB bridge settings groups when a later group fails', async () => {
    const advancedCommand = createDeferred<Response>()
    const captured: CapturedFetch[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input)
        if (url === '/api/v1/bootstrap') {
          return jsonResponse({ revision: 50 })
        }
        const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
        captured.push({ url, method: init.method ?? 'GET', body })
        if (url === '/api/v1/commands/settings/providers') {
          const event: CommandEvent = {
            type: 'settings.updated',
            revision: 51,
            resource: 'settings',
          } as CommandEvent
          return jsonResponse({ revision: 51, event })
        }
        if (url === '/api/v1/commands/settings/advanced') {
          return advancedCommand.promise
        }
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )
    setResourceWriteGuardEnabled(true)
    const oldCustomModels = [{ id: 'old-model', name: 'Old Model' }] as unknown as Database['customModels']
    const attemptedCustomModels = [{ id: 'attempted-model', name: 'Attempted Model' }]
    withTrustedResourceWrite(() => {
      getDatabase().customModels = oldCustomModels
      getDatabase().moduleIntergration = 'old-modules'
      getDatabase().plugins = [seedPlugin('plugin-a')]
      getDatabase().currentPluginProvider = 'plugin-a'
      getDatabase().pluginCustomStorage = {
        retained: { value: 1 },
      }
      getDatabase().modules = [seedModule('mod-a')]
    })
    const apis = getV2PluginAPIs()

    apis.setDatabaseLite({
      customModels: attemptedCustomModels,
      moduleIntergration: 'attempted-modules',
    })

    await vi.waitFor(() => {
      expect(captured).toHaveLength(2)
    })
    expect(getDatabase().customModels).toEqual(attemptedCustomModels)
    expect(getDatabase().moduleIntergration).toBe('attempted-modules')

    withTrustedResourceWrite(() => {
      getDatabase().plugins.push(
        seedPlugin('plugin-newer', {
          realArg: { mode: 'newer-plugin' },
        }),
      )
      getDatabase().currentPluginProvider = 'plugin-newer'
      getDatabase().pluginCustomStorage.newerStorage = { value: 'kept' }
      getDatabase().modules.push(seedModule('mod-newer', { description: 'newer module' }))
    })
    advancedCommand.resolve(jsonResponse({ error: 'forced advanced failure' }, 500))

    await vi.waitFor(() => {
      expect(getDatabase().moduleIntergration).toBe('old-modules')
    })

    expect(captured[0]).toMatchObject({
      url: '/api/v1/commands/settings/providers',
      method: 'PATCH',
      body: {
        baseRevision: 50,
        patch: {
          customModels: attemptedCustomModels,
        },
      },
    })
    expect(captured[1]).toMatchObject({
      url: '/api/v1/commands/settings/advanced',
      method: 'PATCH',
      body: {
        baseRevision: 51,
        patch: {
          moduleIntergration: 'attempted-modules',
        },
      },
    })
    expect(getDatabase().customModels).toEqual(attemptedCustomModels)
    expect(getDatabase().plugins).toEqual([
      seedPlugin('plugin-a'),
      seedPlugin('plugin-newer', {
        realArg: { mode: 'newer-plugin' },
      }),
    ])
    expect(getDatabase().currentPluginProvider).toBe('plugin-newer')
    expect(getDatabase().pluginCustomStorage).toEqual({
      retained: { value: 1 },
      newerStorage: { value: 'kept' },
    })
    expect(getDatabase().modules).toEqual([
      seedModule('mod-a'),
      seedModule('mod-newer', { description: 'newer module' }),
    ])
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

    getDatabase().modules = [seedModule('mod-a')]
    getDatabase().enabledModules = []
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
    // The second command reads the revision from cache after the first command
    // returns.
    expect(captured[1].body?.baseRevision).toBe(101)
  })

  it('preserves newer module edits when a plugin DB module patch fails', async () => {
    const moduleCommand = createDeferred<Response>()
    const captured: { url: string; method: string; body: { baseRevision?: number; [key: string]: unknown } }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input)
        if (url === '/api/v1/bootstrap') {
          return jsonResponse({ revision: 150 })
        }
        const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
        captured.push({ url, method: init.method ?? 'GET', body })
        if (url === '/api/v1/commands/modules/mod-a') {
          return moduleCommand.promise
        }
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )

    getDatabase().modules = [seedModule('mod-a', { description: 'old description' })]
    const apis = getV2PluginAPIs()

    apis.setDatabaseLite({
      modules: [seedModule('mod-a', { description: 'attempted description' })],
    })

    await vi.waitFor(() => {
      expect(captured.length).toBe(1)
    })
    expect(getDatabase().modules[0].description).toBe('attempted description')

    withTrustedResourceWrite(() => {
      getDatabase().modules[0] = {
        ...getDatabase().modules[0],
        description: 'newer description',
      }
    })
    moduleCommand.resolve(jsonResponse({ error: 'failed module patch' }, 500))

    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(captured[0]).toMatchObject({
      url: '/api/v1/commands/modules/mod-a',
      method: 'PATCH',
      body: {
        baseRevision: 150,
        patch: expect.objectContaining({
          description: 'attempted description',
        }),
      },
    })
    expect(getDatabase().modules[0].description).toBe('newer description')
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

    getDatabase().plugins = [seedPlugin('plugin-a'), seedPlugin('plugin-c')]
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

    getDatabase().plugins = [seedPlugin('plugin-a'), seedPlugin('plugin-b'), seedPlugin('plugin-c')]
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

    getDatabase().plugins = previousPlugins
    const apis = getV2PluginAPIs()

    apis.setDatabaseLite({
      plugins: [
        seedPlugin('plugin-a', { displayName: 'Updated A' }),
        seedPlugin('plugin-b', { displayName: 'Plugin B' }),
      ],
    })

    await vi.waitFor(() => {
      expect(getDatabase().plugins).toEqual(previousPlugins)
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

  it('rolls back failed plugin DB bridge collection effects without clobbering concurrent plugin, storage, or provider edits', async () => {
    const firstCommand = createDeferred<Response>()
    const captured: { url: string; method: string; body: { baseRevision?: number; [key: string]: unknown } }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input)
        if (url === '/api/v1/bootstrap') {
          return jsonResponse({ revision: 600 })
        }
        const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
        captured.push({ url, method: init.method ?? 'GET', body })
        if (captured.length === 1) {
          return firstCommand.promise
        }
        return jsonResponse({
          revision: 601,
          event: {
            type: 'plugin.updated',
            revision: 601,
            resource: 'plugin',
          } as unknown as CommandEvent,
        })
      }) as unknown as typeof fetch,
    )

    getDatabase().plugins = [
      seedPlugin('plugin-a'),
      seedPlugin('plugin-c', { displayName: 'Plugin C' }),
      seedPlugin('plugin-d', { script: 'Risuai.log("old d")' }),
    ]
    getDatabase().currentPluginProvider = 'plugin-a'
    getDatabase().pluginCustomStorage = {
      retained: { value: 1 },
    }
    const apis = getV2PluginAPIs()

    apis.setDatabaseLite({
      plugins: [
        seedPlugin('plugin-b', { displayName: 'Created B' }),
        seedPlugin('plugin-d', {
          script: 'Risuai.log("attempted d")',
          displayName: 'Attempted D',
        }),
        seedPlugin('plugin-a'),
      ],
    })

    await vi.waitFor(() => {
      expect(captured.length).toBe(1)
    })
    expect(getDatabase().plugins.map((plugin) => plugin.name)).toEqual(['plugin-b', 'plugin-d', 'plugin-a'])

    withTrustedResourceWrite(() => {
      const pluginDIndex = getDatabase().plugins.findIndex((plugin) => plugin.name === 'plugin-d')
      getDatabase().plugins[pluginDIndex] = {
        ...getDatabase().plugins[pluginDIndex],
        script: 'Risuai.log("newer d")',
      }
      getDatabase().currentPluginProvider = 'plugin-d'
      getDatabase().pluginCustomStorage.newerStorage = { value: 'kept' }
    })
    firstCommand.resolve(jsonResponse({ error: 'failed plugin create' }, 500))

    await vi.waitFor(() => {
      expect(getDatabase().plugins.map((plugin) => plugin.name)).toEqual(['plugin-a', 'plugin-c', 'plugin-d'])
    })

    expect(captured).toHaveLength(1)
    expect(captured[0]).toMatchObject({
      url: '/api/v1/commands/plugins',
      method: 'POST',
      body: {
        baseRevision: 600,
        plugin: expect.objectContaining({ name: 'plugin-b', displayName: 'Created B' }),
      },
    })
    expect(getDatabase().plugins).toEqual([
      seedPlugin('plugin-a'),
      seedPlugin('plugin-c', { displayName: 'Plugin C' }),
      seedPlugin('plugin-d', { script: 'Risuai.log("newer d")' }),
    ])
    expect(getDatabase().currentPluginProvider).toBe('plugin-d')
    expect(getDatabase().pluginCustomStorage).toEqual({
      retained: { value: 1 },
      newerStorage: { value: 'kept' },
    })
  })

  it('keeps successful plugin collection steps when a later create fails', async () => {
    const secondCommand = createDeferred<Response>()
    const captured: { url: string; method: string; body: { baseRevision?: number; [key: string]: unknown } }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input)
        if (url === '/api/v1/bootstrap') {
          return jsonResponse({ revision: 700 })
        }
        const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
        captured.push({ url, method: init.method ?? 'GET', body })
        if (captured.length === 1) {
          return jsonResponse({
            revision: 701,
            event: {
              type: 'plugin.updated',
              revision: 701,
              resource: 'plugin',
              id: 'plugin-d',
            } as unknown as CommandEvent,
          })
        }
        return secondCommand.promise
      }) as unknown as typeof fetch,
    )

    getDatabase().plugins = [
      seedPlugin('plugin-a'),
      seedPlugin('plugin-d', {
        script: 'Risuai.log("old d")',
        displayName: 'Old D',
      }),
    ]
    getDatabase().currentPluginProvider = 'plugin-a'
    getDatabase().pluginCustomStorage = {
      retained: { value: 1 },
    }
    const apis = getV2PluginAPIs()

    apis.setDatabaseLite({
      plugins: [
        seedPlugin('plugin-a'),
        seedPlugin('plugin-d', {
          script: 'Risuai.log("attempted d")',
          displayName: 'Attempted D',
        }),
        seedPlugin('plugin-b', { displayName: 'Created B' }),
      ],
    })

    await vi.waitFor(() => {
      expect(captured.length).toBe(2)
    })
    expect(getDatabase().plugins.map((plugin) => plugin.name)).toEqual(['plugin-a', 'plugin-d', 'plugin-b'])

    withTrustedResourceWrite(() => {
      getDatabase().currentPluginProvider = 'plugin-d'
      getDatabase().pluginCustomStorage.newerStorage = { value: 'kept' }
    })
    secondCommand.resolve(jsonResponse({ error: 'failed plugin create' }, 500))

    await vi.waitFor(() => {
      expect(getDatabase().plugins.map((plugin) => plugin.name)).toEqual(['plugin-a', 'plugin-d'])
    })

    expect(captured[0]).toMatchObject({
      url: '/api/v1/commands/plugins/plugin-d',
      method: 'PATCH',
      body: {
        baseRevision: 700,
        patch: expect.objectContaining({
          script: 'Risuai.log("attempted d")',
          displayName: 'Attempted D',
        }),
      },
    })
    expect(captured[1]).toMatchObject({
      url: '/api/v1/commands/plugins',
      method: 'POST',
      body: {
        baseRevision: 701,
        plugin: expect.objectContaining({ name: 'plugin-b', displayName: 'Created B' }),
      },
    })
    expect(getDatabase().plugins).toEqual([
      seedPlugin('plugin-a'),
      seedPlugin('plugin-d', {
        script: 'Risuai.log("attempted d")',
        displayName: 'Attempted D',
      }),
    ])
    expect(getDatabase().currentPluginProvider).toBe('plugin-d')
    expect(getDatabase().pluginCustomStorage).toEqual({
      retained: { value: 1 },
      newerStorage: { value: 'kept' },
    })
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

    getDatabase().modules = [seedModule('mod-a'), seedModule('mod-b')]
    getDatabase().enabledModules = ['mod-a']
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
    expect(getDatabase().pluginCustomStorage.customPluginKey).toEqual({ value: 1 })
  })

  it('blocks recognized resource families (in allowedDbKeys) in server mode without persisting', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const calls = stubCommandFetch()
    const apis = getV2PluginAPIs()
    getDatabase().characters = [{ chaId: 'char-a', name: 'Ada', chats: [], chatPage: 0 }] as any

    apis.setDatabaseLite({ characters: [{ chaId: 'char-b', name: 'Grace' }] })

    await new Promise((resolve) => setTimeout(resolve, 30))

    // No projection change, no plugin-storage shadow, no command dispatched.
    expect(getDatabase().characters).toEqual([{ chaId: 'char-a', name: 'Ada', chats: [], chatPage: 0 }])
    expect(getDatabase().pluginCustomStorage.characters).toBeUndefined()
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

    expect(getDatabase().pluginCustomStorage.botPresets).toBeUndefined()
    expect(getDatabase().pluginCustomStorage.loreBook).toBeUndefined()
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

    expect((getDatabase() as any).pluginV2).toBeUndefined()
    expect(getDatabase().pluginCustomStorage.pluginV2).toBeUndefined()
    expect(calls.some((call) => call.url.includes('/api/v1/commands/'))).toBe(false)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('pluginV2'))
    warn.mockRestore()
  })

  it('does not expose server-owned resource shadows through V2 getDatabase in server mode', () => {
    const apis = getV2PluginAPIs()
    getDatabase().characters = [{ chaId: 'char-a', name: 'Ada', chats: [], chatPage: 0 }] as any
    getDatabase().pluginCustomStorage = {
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
    getDatabase().characters = [
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
    getDatabase().pluginCustomStorage = {
      selected: { nested: { count: 1 }, list: ['kept'] },
      unrelated: { blob: largeBody },
    }
    const unrelatedStorageSize = JSON.stringify(getDatabase().pluginCustomStorage.unrelated).length
    const charactersSize = JSON.stringify(getDatabase().characters).length

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
    expect(stats.result).not.toBe(getDatabase().pluginCustomStorage.selected)

    stats.result.nested.count = 2
    stats.result.list.push('changed')
    expect(getDatabase().pluginCustomStorage.selected).toEqual({
      nested: { count: 1 },
      list: ['kept'],
    })
  })

  it('M8: pluginStorage.getItem preserves missing scalar and falsey results', () => {
    const apis = getV2PluginAPIs()
    getDatabase().pluginCustomStorage = {
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

    setDatabaseLite({
      currentPluginProvider: 'old-provider',
      pluginCompatibilityMode: false,
      plugins: [seedPlugin('plugin-a')],
      modules: [seedModule('mod-a')],
      enabledModules: [],
    } as any)
    expect(Object.prototype.hasOwnProperty.call(getDatabase(), 'pluginCustomStorage')).toBe(false)
    expect(apis.pluginStorage.getItem('missing')).toBeNull()
    expect(Object.prototype.hasOwnProperty.call(getDatabase(), 'pluginCustomStorage')).toBe(false)
  })

  it('M8: pluginStorage.getItem detaches array values from live plugin storage', () => {
    const apis = getV2PluginAPIs()
    getDatabase().pluginCustomStorage = {
      arrayValue: [{ label: 'live' }],
    }

    const value = apis.pluginStorage.getItem('arrayValue') as Array<{ label: string }>

    expect(value).toEqual([{ label: 'live' }])
    expect(value).not.toBe(getDatabase().pluginCustomStorage.arrayValue)
    value[0].label = 'mutated'
    value.push({ label: 'new' })
    expect(getDatabase().pluginCustomStorage.arrayValue).toEqual([{ label: 'live' }])
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
    getDatabase().pluginCompatibilityMode = true

    apis.safeLocalStorage.setItem('device', 'enabled')

    expect(apis.safeLocalStorage.getItem('device')).toBe('enabled')
    expect(() => apis.safeIdbFactory.open('device')).not.toThrow()
    expect(open).toHaveBeenCalledWith('safe_plugin_device', undefined)
  })
})
