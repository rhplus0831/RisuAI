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
    setArg: vi.fn(),
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
  DBState: mockDbState,
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
  DBState: mockDbState,
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
  patchServerBackedSettings: vi.fn(),
}))

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
  prepareCompatibleCharacterUpdateScoped: vi.fn(() => ({ factories: [], rollback: vi.fn() })),
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
    'folderId',
    'lastDate',
    'bookmarks',
    'bookmarkNames',
    'modules',
  ]),
  prepareCompatibleChatUpdateScoped: vi.fn(() => ({ factories: [], rollback: vi.fn() })),
  runOptimisticCommandSequence: vi.fn(),
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
    fetchLogConsent: '{}',
    getFullDatabaseConsent: '{}',
    mainDomAccessConsent: '{}',
    replacerPermissionConsent: '{}',
    providerPermissionConsent: '{}',
    sendChatConsent: '{}',
  },
}))

vi.mock('src/ts/globalApi.svelte', () => ({
  checkCharOrder: vi.fn(),
  getFetchLogs: () => [],
}))

vi.mock('src/ts/gui/colorscheme', () => ({
  changeColorScheme: vi.fn(),
  updateColorScheme: vi.fn(),
  updateTextThemeAndCSS: vi.fn(),
}))

vi.mock('src/ts/process/mcp/pluginmcp', () => ({
  registerMCPModule: vi.fn(),
  unregisterMCPModule: vi.fn(),
}))

vi.mock('src/ts/translator/translator', () => ({
  getLLMCache: vi.fn(),
  searchLLMCache: vi.fn(),
}))

vi.mock('src/ts/parser/parser.svelte', () => ({
  hasher: vi.fn(async () => 'hash'),
}))

vi.mock('localforage', () => ({
  default: {
    createInstance: () => ({
      getItem: vi.fn(async () => null),
      setItem: vi.fn(async () => undefined),
    }),
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

vi.mock('src/ts/server/projectionWriteGuard.svelte', () => ({
  withTrustedServerProjectionWrite: (fn: () => void) => fn(),
}))

import { customProviderStore, pluginV2 } from '../plugins.svelte'
import { prepareCompatibleCharacterUpdateScoped } from 'src/ts/characterCommands'
import {
  appendCurrentChatUserMessageForSend,
  prepareCompatibleChatUpdateScoped,
  runOptimisticCommandSequence,
} from 'src/ts/chatCommands'
import { sendChat as processSendChat } from 'src/ts/process/index.svelte'
import {
  __v3PluginLifecycleTestHooks,
  customV3ProviderMetaStore,
  executePluginV3,
  getV3PluginInstance,
  loadV3Plugins,
} from './v3.svelte'

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

function messageCalls(spy: { mock: { calls: unknown[][] } }) {
  return spy.mock.calls.filter((call) => call[0] === 'message')
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
  vi.mocked(runOptimisticCommandSequence).mockClear()
  vi.mocked(appendCurrentChatUserMessageForSend).mockReset()
  vi.mocked(processSendChat).mockReset()
  await __v3PluginLifecycleTestHooks.reset()
})

afterEach(async () => {
  await __v3PluginLifecycleTestHooks.reset()
  vi.restoreAllMocks()
})

describe('V3 character command bridge', () => {
  it('setCharacterToIndex applies the shared compatible optimistic row in server mode', () => {
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
    const factories = [vi.fn()]
    const rollback = vi.fn()
    mockDbState.db.characters = {
      0: existingCharacter,
    }
    vi.mocked(prepareCompatibleCharacterUpdateScoped).mockReturnValueOnce({
      characterId: 'char-a',
      patch: { name: 'New name' },
      optimisticCharacter,
      factories,
      rollback,
    } as any)
    const api = __v3PluginLifecycleTestHooks.createApi(seedV3Plugin('plugin-a')) as any
    const pluginCharacter = {
      chaId: 'char-a',
      name: 'New name',
      chats: existingCharacter.chats,
      globalLore: existingCharacter.globalLore,
    }

    api.setCharacterToIndex(0, pluginCharacter)

    expect(prepareCompatibleCharacterUpdateScoped).toHaveBeenCalledWith(
      expect.objectContaining({ chaId: 'char-a' }),
      pluginCharacter,
      expect.anything(),
    )
    expect(mockDbState.db.characters[0]).toBe(optimisticCharacter)
    expect(mockDbState.db.characters[0]).not.toBe(pluginCharacter)
    expect(runOptimisticCommandSequence).toHaveBeenCalledWith(factories, rollback)
  })

  it('setCharacterToIndex rejects unsupported character fields before projection mutation', () => {
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

    expect(() => api.setCharacterToIndex(0, pluginCharacter)).toThrow(
      /setCharacterToIndex cannot update unsupported character fields .*chats, globalLore/,
    )

    expect(mockDbState.db.characters[0]).toBe(existingCharacter)
    expect(prepareCompatibleCharacterUpdateScoped).not.toHaveBeenCalled()
    expect(runOptimisticCommandSequence).not.toHaveBeenCalled()
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

  it('setChatToIndex rejects unsupported chat fields before projection mutation', () => {
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

    expect(() => api.setChatToIndex(0, 0, pluginChat)).toThrow(
      /setChatToIndex cannot update unsupported chat fields .*localLore, generationSettings/,
    )

    expect(mockDbState.db.characters[0].chats[0]).toBe(existingChat)
    expect(prepareCompatibleChatUpdateScoped).not.toHaveBeenCalled()
    expect(runOptimisticCommandSequence).not.toHaveBeenCalled()
  })

  it('setChatToIndex rejects unsupported scriptstate value changes before projection mutation', () => {
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

    expect(() => api.setChatToIndex(0, 0, pluginChat)).toThrow(
      /setChatToIndex cannot update unsupported chat fields .*scriptstate.count/,
    )

    expect(mockDbState.db.characters[0].chats[0]).toBe(existingChat)
    expect(prepareCompatibleChatUpdateScoped).not.toHaveBeenCalled()
    expect(runOptimisticCommandSequence).not.toHaveBeenCalled()
  })

  it('setChatToIndex still dispatches supported chat changes in server mode', () => {
    mockServerCommands.canUse = true
    const existingChat = {
      id: 'chat-a',
      name: 'Old chat',
      message: [{ role: 'user', data: 'old', chatId: 'msg-a' }],
      scriptstate: { count: 1 },
      localLore: [{ key: 'old lore' }],
    }
    const factories = [vi.fn()]
    const rollback = vi.fn()
    mockDbState.db.characters = {
      0: {
        chaId: 'char-a',
        chats: [existingChat],
      },
    }
    vi.mocked(prepareCompatibleChatUpdateScoped).mockReturnValueOnce({ factories, rollback })
    const api = __v3PluginLifecycleTestHooks.createApi(seedV3Plugin('plugin-a')) as any
    const pluginChat = {
      ...existingChat,
      name: 'New chat',
      message: [{ role: 'char', data: 'new', chatId: 'msg-b' }],
      scriptstate: { count: 2 },
      localLore: existingChat.localLore,
    }

    api.setChatToIndex(0, 0, pluginChat)

    expect(mockDbState.db.characters[0].chats[0]).toBe(pluginChat)
    expect(prepareCompatibleChatUpdateScoped).toHaveBeenCalledWith(existingChat, pluginChat, {
      selectedCharID: 'char-a',
      characterId: 'char-a',
      chatId: 'chat-a',
      chat: existingChat,
    })
    expect(runOptimisticCommandSequence).toHaveBeenCalledWith(factories, rollback)
  })
})

describe('V3 plugin lifecycle cleanup', () => {
  it('M7/v4-L37: loadV3Plugins unloads every existing V3 instance from a snapshot', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const removeSpy = vi.spyOn(window, 'removeEventListener')

    await executePluginV3(seedV3Plugin('plugin-a'))
    await executePluginV3(seedV3Plugin('plugin-b'))

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

    await executePluginV3(seedV3Plugin('plugin-a'))
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
