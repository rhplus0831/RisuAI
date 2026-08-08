import { mount, tick, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppRoute } from './ts/router'
import type { Database, character } from './ts/storage/database.svelte'

const routePath = '/character/char-a/chat-a'
const characterRoute: AppRoute = {
  kind: 'character',
  path: routePath,
  chaId: 'char-a',
  chatId: 'chat-a',
}

const appRouteDomMocks = vi.hoisted(() => {
  type RouteMockExports = Record<string, unknown> & {
    currentRoute: ReturnType<typeof writable>
  }

  const state = {
    applyingRoute: false,
    applyRouteCalls: 0,
    exports: undefined as RouteMockExports | undefined,
    pendingRouteApplication: false,
    readResource: () => {},
    resetSidebarTab: () => {},
    setSidebarViewMode: (_view: 'chat' | 'character') => {},
  }

  return {
    alertError: vi.fn(),
    alertNormal: vi.fn(),
    changeChar: vi.fn(),
    checkCharOrder: vi.fn(),
    closeGridRoute: vi.fn(),
    getCharImage: vi.fn(() => ''),
    importCharacterProcess: vi.fn(),
    importPreset: vi.fn(),
    openGridRoute: vi.fn(),
    state,
  }
})

async function createRouteMock() {
  if (!appRouteDomMocks.state.exports) {
    const { writable } = await import('svelte/store')
    appRouteDomMocks.state.exports = {
      applyRouteToStores: vi.fn((route: AppRoute) => {
        appRouteDomMocks.state.readResource()
        appRouteDomMocks.state.applyRouteCalls += 1
        if (appRouteDomMocks.state.applyRouteCalls > 1) {
          appRouteDomMocks.state.resetSidebarTab()
        }
        return Promise.resolve(route)
      }),
      closeGridRoute: appRouteDomMocks.closeGridRoute,
      consumeStateDrivenRouteUpdate: () => false,
      currentRoute: writable(characterRoute),
      hasPendingRouteApplication: () => appRouteDomMocks.state.pendingRouteApplication,
      installRouter: vi.fn(),
      isApplyingRouteToStores: () => appRouteDomMocks.state.applyingRoute,
      navigate: vi.fn(),
      openGridRoute: appRouteDomMocks.openGridRoute,
      parseRoute: vi.fn(() => characterRoute),
      setCharacterSidebarViewMode: (view: 'chat' | 'character') => appRouteDomMocks.state.setSidebarViewMode(view),
      syncRouteFromState: vi.fn(),
    }
  }

  return appRouteDomMocks.state.exports
}

vi.mock('./ts/router', createRouteMock)
vi.mock('src/ts/router', createRouteMock)

vi.mock('./lang', () => ({
  language: {
    Chat: 'Chat',
    character: 'Character',
    grid: 'Grid',
    home: 'Home',
    menu: 'Menu',
    playground: { playground: 'Playground' },
    settings: 'Settings',
    successImport: 'Imported',
  },
}))

vi.mock('src/lang', () => ({
  language: {
    Chat: 'Chat',
    character: 'Character',
    grid: 'Grid',
    home: 'Home',
    menu: 'Menu',
    playground: { playground: 'Playground' },
    settings: 'Settings',
    successImport: 'Imported',
  },
}))

vi.mock('./ts/alert', () => ({
  alertError: appRouteDomMocks.alertError,
  alertNormal: appRouteDomMocks.alertNormal,
  alertSelect: vi.fn(async () => '0'),
  alertInput: vi.fn(async () => ''),
}))

vi.mock('src/ts/alert', () => ({
  alertError: appRouteDomMocks.alertError,
  alertNormal: appRouteDomMocks.alertNormal,
  alertSelect: vi.fn(async () => '0'),
  alertInput: vi.fn(async () => ''),
}))

vi.mock('./ts/characterCards', () => ({
  showRealmInfoStore: writable(null),
  importCharacterProcess: appRouteDomMocks.importCharacterProcess,
}))

async function createDatabaseMock() {
  const { getResourceDatabase } = await import('./ts/server/resourceState.svelte')
  return {
    getDatabase: getResourceDatabase,
    importPreset: appRouteDomMocks.importPreset,
    setDatabase: vi.fn(),
  }
}

vi.mock('./ts/storage/database.svelte', createDatabaseMock)
vi.mock('src/ts/storage/database.svelte', createDatabaseMock)

vi.mock('./ts/globalApi.svelte', () => ({
  checkCharOrder: appRouteDomMocks.checkCharOrder,
  getFileSrc: vi.fn(async () => ''),
  saveAsset: vi.fn(async () => ''),
}))

vi.mock('src/ts/globalApi.svelte', () => ({
  checkCharOrder: appRouteDomMocks.checkCharOrder,
  getFileSrc: vi.fn(async () => ''),
  saveAsset: vi.fn(async () => ''),
}))

vi.mock('./ts/characters', () => ({
  addCharacter: vi.fn(),
  changeChar: appRouteDomMocks.changeChar,
  getCharImage: appRouteDomMocks.getCharImage,
}))

vi.mock('src/ts/characters', () => ({
  addCharacter: vi.fn(),
  changeChar: appRouteDomMocks.changeChar,
  getCharImage: appRouteDomMocks.getCharImage,
}))

vi.mock('src/ts/util', async (importActual) => {
  const actual = await importActual<typeof import('src/ts/util')>()
  return {
    ...actual,
    selectSingleFile: vi.fn(),
  }
})

vi.mock('src/ts/characterCommands', () => ({
  currentCharacterStateSnapshot: vi.fn(() => null),
  dispatchReorderCharacters: vi.fn(),
}))

vi.mock('src/ts/process/modules', () => ({
  getModuleAssets: () => [],
  getModuleLorebooks: () => [],
  getModuleRegexScripts: () => [],
  getModules: () => [],
  getModuleTriggers: () => [],
  moduleUpdate: vi.fn(),
}))

vi.mock('./lib/ChatScreens/ChatScreen.svelte', async () => ({
  default: (await import('./App.routeEffect.dom.AppMarker.svelte')).default,
}))
vi.mock('./lib/Others/AlertComp.svelte', async () => ({
  default: (await import('./App.routeEffect.dom.AppMarker.svelte')).default,
}))
vi.mock('./lib/UI/Realm/RealmPopUp.svelte', async () => ({
  default: (await import('./App.routeEffect.dom.AppMarker.svelte')).default,
}))
vi.mock('./lib/Others/GridCatalog.svelte', async () => ({
  default: (await import('./App.routeEffect.dom.GridMarker.svelte')).default,
}))
vi.mock('./lib/Others/BookmarkList.svelte', async () => ({
  default: (await import('./App.routeEffect.dom.AppMarker.svelte')).default,
}))
vi.mock('./lib/Setting/Settings.svelte', async () => ({
  default: (await import('./App.routeEffect.dom.AppMarker.svelte')).default,
}))
vi.mock('./lib/Others/SavePopupIcon.svelte', async () => ({
  default: (await import('./App.routeEffect.dom.AppMarker.svelte')).default,
}))
vi.mock('./lib/Setting/botpreset.svelte', async () => ({
  default: (await import('./App.routeEffect.dom.AppMarker.svelte')).default,
}))
vi.mock('./lib/Setting/listedPersona.svelte', async () => ({
  default: (await import('./App.routeEffect.dom.AppMarker.svelte')).default,
}))
vi.mock('./lib/Setting/Pages/CustomGUISettingMenu.svelte', async () => ({
  default: (await import('./App.routeEffect.dom.AppMarker.svelte')).default,
}))
vi.mock('./lib/Others/HypaV3Modal.svelte', async () => ({
  default: (await import('./App.routeEffect.dom.AppMarker.svelte')).default,
}))
vi.mock('./lib/Others/HypaV3Progress.svelte', async () => ({
  default: (await import('./App.routeEffect.dom.AppMarker.svelte')).default,
}))
vi.mock('./lib/UI/PopupList.svelte', async () => ({
  default: (await import('./App.routeEffect.dom.AppMarker.svelte')).default,
}))
vi.mock('./lib/Others/ProTools/EasyPanel.svelte', async () => ({
  default: (await import('./App.routeEffect.dom.AppMarker.svelte')).default,
}))
vi.mock('./lib/Others/PopupEditor.svelte', async () => ({
  default: (await import('./App.routeEffect.dom.AppMarker.svelte')).default,
}))
vi.mock('./lib/Others/LoadoutModal.svelte', async () => ({
  default: (await import('./App.routeEffect.dom.AppMarker.svelte')).default,
}))
vi.mock('./lib/Others/IrisModal.svelte', async () => ({
  default: (await import('./App.routeEffect.dom.AppMarker.svelte')).default,
}))
vi.mock('./lib/Others/Legal.svelte', async () => ({
  default: (await import('./App.routeEffect.dom.AppMarker.svelte')).default,
}))
vi.mock('./lib/Others/CustomSidebarConfig.svelte', async () => ({
  default: (await import('./App.routeEffect.dom.AppMarker.svelte')).default,
}))
vi.mock('./lib/SideBars/CharConfig.svelte', async () => ({
  default: (await import('./App.routeEffect.dom.CharConfigMarker.svelte')).default,
}))
vi.mock('./lib/SideBars/SideChatList.svelte', async () => ({
  default: (await import('./App.routeEffect.dom.SideChatListMarker.svelte')).default,
}))
vi.mock('src/lib/SideBars/CharConfig.svelte', async () => ({
  default: (await import('./App.routeEffect.dom.CharConfigMarker.svelte')).default,
}))
vi.mock('src/lib/SideBars/SideChatList.svelte', async () => ({
  default: (await import('./App.routeEffect.dom.SideChatListMarker.svelte')).default,
}))
vi.mock('src/lib/SideBars/DevTool.svelte', async () => ({
  default: (await import('./App.routeEffect.dom.AppMarker.svelte')).default,
}))
vi.mock('src/lib/Others/QuickSettingsGUI.svelte', async () => ({
  default: (await import('./App.routeEffect.dom.AppMarker.svelte')).default,
}))
vi.mock('src/lib/Others/PluginDefinedIcon.svelte', async () => ({
  default: (await import('./App.routeEffect.dom.AppMarker.svelte')).default,
}))

import {
  CustomGUISettingMenuStore,
  DynamicGUI,
  LoadingStatusState,
  PlaygroundStore,
  QuickSettings,
  SettingsMenuIndex,
  alertStore,
  bookmarkListOpen,
  botMakerMode,
  customSideBarConfigDialogStore,
  easyPanelStore,
  hypaV3ModalOpen,
  hypaV3ProgressStore,
  irisStore,
  loadedStore,
  loadoutModalStore,
  openPersonaList,
  openPresetList,
  popUpEditorStore,
  popupStore,
  selectedCharID,
  settingsOpen,
  sideBarClosing,
  sideBarStore,
} from './ts/stores.svelte'
import { getResourceDatabase, replaceResourceDatabase } from './ts/server/resourceState.svelte'

const { default: App } = await import('./App.svelte')

type MountedComponent = Parameters<typeof unmount>[0]

let target: HTMLElement
let component: MountedComponent | undefined

function makeCharacter(): character {
  return {
    alternateGreetings: [],
    bias: [],
    chaId: 'char-a',
    characterVersion: '',
    chatFolders: [],
    chatPage: 0,
    chats: [
      {
        id: 'chat-a',
        localLore: [],
        message: [],
        modules: [],
        name: 'Chat A',
        note: '',
      },
    ],
    creator: '',
    creatorNotes: '',
    customscript: [],
    desc: '',
    emotionImages: [],
    exampleMessage: '',
    firstMessage: '',
    firstMsgIndex: 0,
    globalLore: [],
    image: '',
    name: 'Character A',
    notes: '',
    personality: '',
    postHistoryInstructions: '',
    scenario: '',
    sdData: [],
    systemPrompt: '',
    tags: [],
    triggerscript: [],
    utilityBot: false,
    viewScreen: 'none',
  } as character
}

function seedStores() {
  const character = makeCharacter()
  replaceResourceDatabase({
    backgroundHTML: '',
    characterOrder: ['char-a'],
    characters: [character],
    customSidebarItems: [],
    enableDevTools: false,
    enabledModules: [],
    hamburgerButtonBottom: false,
    hideChatIcon: false,
    keepSessionAlive: 'off',
    menuSideBar: false,
    moduleIntergration: '',
    modules: [],
    plugins: [],
    roundIcons: false,
    showFolderName: true,
    showMenuChatList: false,
  } as unknown as Database)

  loadedStore.set(true)
  selectedCharID.set(0)
  sideBarStore.set(true)
  DynamicGUI.set(false)
  settingsOpen.set(false)
  PlaygroundStore.set(0)
  botMakerMode.set(false)
  sideBarClosing.set(false)
  CustomGUISettingMenuStore.set(false)
  SettingsMenuIndex.set(-1)
  openPresetList.set(false)
  openPersonaList.set(false)
  bookmarkListOpen.set(false)
  alertStore.set({ type: 'none', msg: 'n' })
  hypaV3ModalOpen.set(false)
  hypaV3ProgressStore.set({ open: false, miniMsg: '', msg: '', subMsg: '' })
  LoadingStatusState.text = ''
  QuickSettings.open = false
  popupStore.children = null
  easyPanelStore.open = false
  popUpEditorStore.open = false
  loadoutModalStore.open = false
  irisStore.open = false
  customSideBarConfigDialogStore.open = false
}

async function mountApp() {
  component = mount(App, { target })
  await tick()
  await tick()
}

describe('App route/refreeze mounted DOM behavior', () => {
  beforeEach(async () => {
    target = document.createElement('div')
    document.body.appendChild(target)
    window.history.replaceState(null, '', routePath)
    appRouteDomMocks.state.applyRouteCalls = 0
    appRouteDomMocks.state.applyingRoute = false
    appRouteDomMocks.state.pendingRouteApplication = false
    appRouteDomMocks.state.readResource = () => {
      void getResourceDatabase().characters?.[0]?.chatPage
    }
    appRouteDomMocks.state.resetSidebarTab = () => {
      botMakerMode.set(false)
    }
    appRouteDomMocks.state.setSidebarViewMode = (view) => {
      botMakerMode.set(view === 'character')
    }
    if (appRouteDomMocks.state.exports) {
      appRouteDomMocks.state.exports.currentRoute.set(characterRoute)
    }
    seedStores()
    await mountApp()
  })

  afterEach(() => {
    if (component) {
      unmount(component)
      component = undefined
    }
    replaceResourceDatabase({} as Database)
    target.remove()
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  it('keeps the Character sidebar tab visible across a server resource refresh', async () => {
    expect(appRouteDomMocks.state.applyRouteCalls).toBe(1)
    expect(target.querySelector('[data-testid="side-chat-list"]')).not.toBeNull()

    const characterTab = target.querySelector<HTMLButtonElement>('[data-risu-sidebar-tab="character"]')
    expect(characterTab).not.toBeNull()
    characterTab?.click()
    await tick()

    expect(get(botMakerMode)).toBe(true)
    expect(target.querySelector('[data-risu-sidebar-panel="character"]')).not.toBeNull()
    expect(target.querySelector('[data-testid="char-config"]')).not.toBeNull()
    expect(target.querySelector('[data-risu-sidebar-panel="chat"]')).toBeNull()
    expect(target.querySelector('[data-testid="side-chat-list"]')).toBeNull()

    const database = getResourceDatabase({ snapshot: true })
    replaceResourceDatabase({
      ...database,
      characterOrder: [...database.characterOrder],
    })
    await tick()
    await tick()

    expect(target.querySelector('[data-risu-sidebar-panel="character"]')).not.toBeNull()
    expect(target.querySelector('[data-testid="char-config"]')).not.toBeNull()
    expect(target.querySelector('[data-risu-sidebar-panel="chat"]')).toBeNull()
    expect(target.querySelector('[data-testid="side-chat-list"]')).toBeNull()
    expect(get(botMakerMode)).toBe(true)
    expect(getResourceDatabase().characters[0].chatPage).toBe(0)
    expect(getResourceDatabase().characters[0].chats[getResourceDatabase().characters[0].chatPage]?.id).toBe('chat-a')
    expect(get(selectedCharID)).toBe(0)
    expect(window.location.pathname).toBe(routePath)
    expect(appRouteDomMocks.state.applyRouteCalls).toBe(1)
  })

  it('retains state-to-route subscriptions while a route application owns the stores', async () => {
    const router = appRouteDomMocks.state.exports
    if (!router) throw new Error('Router mock was not initialized')
    const syncRouteFromState = vi.mocked(router.syncRouteFromState as (...args: any[]) => void)
    syncRouteFromState.mockClear()

    appRouteDomMocks.state.applyingRoute = true
    appRouteDomMocks.state.pendingRouteApplication = true
    router.currentRoute.set({
      kind: 'settings',
      path: '/settings/model',
      section: 'model',
      index: 17,
    })
    await tick()

    expect(syncRouteFromState).not.toHaveBeenCalled()

    appRouteDomMocks.state.applyingRoute = false
    appRouteDomMocks.state.pendingRouteApplication = false
    settingsOpen.set(true)
    SettingsMenuIndex.set(17)
    await tick()

    expect(syncRouteFromState).toHaveBeenCalledTimes(1)
    expect(syncRouteFromState).toHaveBeenCalledWith(
      expect.objectContaining({
        currentRouteKind: 'settings',
        settingsMenuIndex: 17,
        settingsOpen: true,
      }),
    )
  })

  it('routes both desktop and responsive grid buttons through the grid history helper', async () => {
    const desktopMenu = target.querySelector<HTMLButtonElement>('button[aria-label="Menu"]')
    expect(desktopMenu).not.toBeNull()
    desktopMenu?.click()
    await tick()

    const desktopGrid = target.querySelector<HTMLButtonElement>('button[aria-label="Grid"]')
    expect(desktopGrid).not.toBeNull()
    desktopGrid?.click()

    expect(appRouteDomMocks.openGridRoute).toHaveBeenCalledTimes(1)

    DynamicGUI.set(true)
    await tick()
    await Promise.resolve()

    const responsiveSidebar = target.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]')
    const responsiveMenu = responsiveSidebar?.querySelector<HTMLButtonElement>('button[aria-label="Menu"]')
    expect(responsiveMenu).not.toBeNull()
    responsiveMenu?.click()
    await tick()

    const responsiveGrid = responsiveSidebar?.querySelector<HTMLButtonElement>('button[aria-label="Grid"]')
    expect(responsiveGrid).not.toBeNull()
    responsiveGrid?.click()

    expect(appRouteDomMocks.openGridRoute).toHaveBeenCalledTimes(2)
  })

  it('routes the grid close control through the grid history helper', async () => {
    const router = appRouteDomMocks.state.exports
    if (!router) throw new Error('Router mock was not initialized')

    router.currentRoute.set({ kind: 'grid', path: '/grid' })
    await tick()

    const closeButton = target.querySelector<HTMLButtonElement>('[data-testid="grid-close"]')
    expect(closeButton).not.toBeNull()
    closeButton?.click()

    expect(appRouteDomMocks.closeGridRoute).toHaveBeenCalledOnce()
  })

  it('does not override the negotiated operation for an internal drag', () => {
    const main = target.querySelector('main')
    expect(main).not.toBeNull()

    const dataTransfer = {
      dropEffect: 'move',
      types: ['application/x-risu-internal'],
    }
    const dragOverEvent = new Event('dragover', { bubbles: true, cancelable: true })
    Object.defineProperty(dragOverEvent, 'dataTransfer', { value: dataTransfer })

    main?.dispatchEvent(dragOverEvent)

    expect(dataTransfer.dropEffect).toBe('move')
    expect(dragOverEvent.defaultPrevented).toBe(false)
  })

  it('contains and restores focus while the responsive sidebar is open and closes it with Escape', async () => {
    const opener = document.createElement('button')
    opener.textContent = 'Open navigation'
    document.body.insertBefore(opener, target)
    opener.focus()

    DynamicGUI.set(true)
    await tick()
    await Promise.resolve()

    const dialog = target.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]')
    expect(get(DynamicGUI)).toBe(true)
    expect(get(sideBarStore)).toBe(true)
    expect(dialog, target.innerHTML).toBeTruthy()
    expect(dialog?.getAttribute('aria-label')).toBe('Menu')
    expect(opener.inert).toBe(true)
    expect(dialog?.contains(document.activeElement)).toBe(true)

    opener.focus()
    expect(dialog?.contains(document.activeElement)).toBe(true)

    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    dialog?.dispatchEvent(escape)
    await tick()

    expect(escape.defaultPrevented).toBe(true)
    expect(get(sideBarClosing)).toBe(true)
    dialog?.querySelector<HTMLElement>('.setting-area')?.dispatchEvent(new Event('animationend', { bubbles: true }))
    await tick()
    await Promise.resolve()

    expect(target.querySelector('[role="dialog"][aria-modal="true"]')).toBeNull()
    expect(get(sideBarStore)).toBe(false)
    expect(opener.inert).toBe(false)
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('does not report a failed dropped preset import as successful', async () => {
    let resolveImport!: (imported: 'failed') => void
    const importResult = new Promise<'failed'>((resolve) => {
      resolveImport = resolve
    })
    appRouteDomMocks.importPreset.mockReturnValueOnce(importResult)
    appRouteDomMocks.alertNormal.mockClear()

    const droppedFile = {
      name: 'broken.risup',
      arrayBuffer: vi.fn(async () => new Uint8Array([1, 2, 3]).buffer),
    }
    const dropEvent = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(dropEvent, 'dataTransfer', {
      value: {
        files: [droppedFile],
        types: [],
      },
    })

    const main = target.querySelector('main')
    expect(main).not.toBeNull()
    main?.dispatchEvent(dropEvent)

    await vi.waitFor(() => {
      expect(appRouteDomMocks.importPreset).toHaveBeenCalledWith({
        name: 'broken.risup',
        data: new Uint8Array([1, 2, 3]),
      })
    })
    resolveImport('failed')
    await importResult
    await tick()

    expect(appRouteDomMocks.alertNormal).not.toHaveBeenCalled()
  })

  it('replaces a rejected dropped character import with an error', async () => {
    const importError = new Error('Corrupt character archive')
    appRouteDomMocks.importCharacterProcess.mockRejectedValueOnce(importError)

    const droppedFile = {
      name: 'broken.charx',
      arrayBuffer: vi.fn(),
    }
    const dropEvent = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(dropEvent, 'dataTransfer', {
      value: {
        files: [droppedFile],
        types: [],
      },
    })

    const main = target.querySelector('main')
    expect(main).not.toBeNull()
    main?.dispatchEvent(dropEvent)

    await vi.waitFor(() => expect(appRouteDomMocks.alertError).toHaveBeenCalledWith(importError))
    expect(appRouteDomMocks.checkCharOrder).not.toHaveBeenCalled()
  })
})
