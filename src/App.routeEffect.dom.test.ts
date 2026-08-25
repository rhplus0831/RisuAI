import { mount, tick, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppRoute } from './ts/router'
import type { Database, character } from './ts/storage/database.svelte'
import { RISU_APP_INTERNAL_DRAG_TYPE, RISU_SIDEBAR_DRAG_TYPE } from './ts/dragTypes'
import {
  beginStartupAttempt,
  configureStartupObserverShell,
  recordStartupCapabilityFailure,
  recordStartupMilestone,
  resetStartupReadinessForTests,
  revokeStartupWriterCapabilities,
} from './ts/startupReadiness'

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
        return Promise.resolve(true)
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
      retryCurrentRouteApplication: vi.fn(),
      setCharacterSidebarViewMode: (view: 'chat' | 'character') => appRouteDomMocks.state.setSidebarViewMode(view),
      syncRouteFromState: vi.fn(),
    }
  }

  return appRouteDomMocks.state.exports
}

vi.mock('./ts/router', createRouteMock)
vi.mock('src/ts/router', createRouteMock)

vi.mock('./ts/server/routeResourceLoader', async () => {
  const { writable } = await import('svelte/store')
  return { routeResourceLoadState: writable({ error: null, routeKey: routePath, status: 'ready' }) }
})

vi.mock('./lang', () => ({
  language: {
    Chat: 'Chat',
    character: 'Character',
    grid: 'Grid',
    home: 'Home',
    menu: 'Menu',
    pluginRuntime: {
      failed: 'Plugins could not start. The rest of the app is still available.',
      retry: 'Retry plugins',
      retrying: 'Retrying plugins…',
    },
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
    pluginRuntime: {
      failed: 'Plugins could not start. The rest of the app is still available.',
      retry: 'Retry plugins',
      retrying: 'Retrying plugins…',
    },
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
vi.mock('./lib/ObserverShell.svelte', async () => ({
  default: (await import('./App.routeEffect.dom.ObserverShellMarker.svelte')).default,
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
  irisStore,
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
import {
  peekObserverRouteIntent,
  recordObserverRouteIntent,
  resetObserverRouteIntentForTests,
} from './ts/observerRouteIntent'

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

  resetStartupReadinessForTests()
  for (const milestone of ['entry', 'shell-mounted', 'observer-ready', 'writer-ready'] as const) {
    recordStartupMilestone(milestone)
  }
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
  LoadingStatusState.text = ''
  QuickSettings.open = false
  popupStore.children = null
  easyPanelStore.open = false
  popUpEditorStore.open = false
  loadoutModalStore.open = false
  irisStore.open = false
  customSideBarConfigDialogStore.open = false
  resetObserverRouteIntentForTests()
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
    resetStartupReadinessForTests()
    resetObserverRouteIntentForTests()
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
    await vi.waitFor(() => {
      expect(target.querySelector('[data-testid="char-config"]')).not.toBeNull()
    })

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
    await vi.waitFor(() => {
      expect(target.querySelector('[data-testid="char-config"]')).not.toBeNull()
    })

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

  it('does not reapply the current route when unrelated startup coordinator metadata changes', async () => {
    const characterTab = target.querySelector<HTMLButtonElement>('[data-risu-sidebar-tab="character"]')
    expect(characterTab).not.toBeNull()
    characterTab?.click()
    await tick()
    await vi.waitFor(() => {
      expect(target.querySelector('[data-testid="char-config"]')).not.toBeNull()
    })

    expect(appRouteDomMocks.state.applyRouteCalls).toBe(1)
    expect(get(botMakerMode)).toBe(true)

    const attemptId = beginStartupAttempt()
    recordStartupCapabilityFailure(attemptId, 'plugin-initialization-failed', 'plugins-ready')
    await tick()
    await Promise.resolve()

    expect(appRouteDomMocks.state.applyRouteCalls).toBe(1)
    expect(get(botMakerMode)).toBe(true)
    expect(target.querySelector('[data-risu-sidebar-panel="character"]')).not.toBeNull()
  })

  it('keeps the shell mounted and shows a localized plugin retry status', async () => {
    const attemptId = beginStartupAttempt()
    recordStartupCapabilityFailure(attemptId, 'plugin-initialization-failed', 'plugins-ready')
    await tick()

    expect(target.querySelector('[data-plugin-runtime-status]')).not.toBeNull()
    expect(target.textContent).toContain('Plugins could not start')
    expect(target.querySelector('button')?.textContent).toContain('Retry plugins')
    expect(target.querySelector('[data-testid="app-marker"]')).not.toBeNull()
  })

  it('keeps the coherent shell readable while persistence-capable route application is revoked', async () => {
    if (component) {
      unmount(component)
      component = undefined
    }
    appRouteDomMocks.state.applyRouteCalls = 0
    revokeStartupWriterCapabilities()

    await mountApp()

    expect(target.querySelector('[role="status"]')).toBeNull()
    expect(target.querySelector('[data-testid="side-chat-list"]')).not.toBeNull()
    expect(appRouteDomMocks.state.applyRouteCalls).toBe(0)
  })

  it('renders the dedicated observer view without applying persistence-capable routes', async () => {
    if (component) {
      unmount(component)
      component = undefined
    }
    appRouteDomMocks.state.applyRouteCalls = 0
    vi.mocked(appRouteDomMocks.state.exports?.applyRouteToStores as (...args: any[]) => Promise<boolean>).mockClear()
    resetStartupReadinessForTests()
    configureStartupObserverShell(true)
    for (const milestone of ['entry', 'shell-mounted', 'observer-ready'] as const) {
      recordStartupMilestone(milestone)
    }
    openPresetList.set(true)

    await mountApp()

    expect(target.querySelector('[data-testid="observer-shell-marker"]')).not.toBeNull()
    expect(target.querySelector('[data-testid="side-chat-list"]')).toBeNull()
    expect(target.querySelector('[data-testid="preset-list"]')).toBeNull()
    expect(appRouteDomMocks.state.applyRouteCalls).toBe(0)

    const dropEvent = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(dropEvent, 'dataTransfer', {
      value: { files: [{ name: 'blocked.charx' }], types: ['Files'] },
    })
    target.querySelector('main')?.dispatchEvent(dropEvent)

    expect(dropEvent.defaultPrevented).toBe(true)
    expect(appRouteDomMocks.importCharacterProcess).not.toHaveBeenCalled()

    const olderIntent = recordObserverRouteIntent({ kind: 'home', path: '/' })
    const latestRoute: AppRoute = {
      kind: 'character',
      path: '/character/char-a/chat-a',
      chaId: 'char-a',
      chatId: 'chat-a',
    }
    const latestIntent = recordObserverRouteIntent(latestRoute)
    expect(latestIntent.sequence).toBeGreaterThan(olderIntent.sequence)
    appRouteDomMocks.state.exports?.currentRoute.set(latestRoute)
    recordStartupMilestone('writer-ready')

    await vi.waitFor(() => expect(appRouteDomMocks.state.applyRouteCalls).toBe(1))
    expect(appRouteDomMocks.state.exports?.applyRouteToStores).toHaveBeenCalledOnce()
    expect(appRouteDomMocks.state.exports?.applyRouteToStores).toHaveBeenCalledWith(latestRoute)
    await vi.waitFor(() => expect(peekObserverRouteIntent()).toBeNull())
  })

  it('returns immediately to the authenticated observer shell after writer capability is revoked', async () => {
    if (component) {
      unmount(component)
      component = undefined
    }
    resetStartupReadinessForTests()
    configureStartupObserverShell(true)
    for (const milestone of ['entry', 'shell-mounted', 'observer-ready', 'writer-ready'] as const) {
      recordStartupMilestone(milestone)
    }
    appRouteDomMocks.state.applyRouteCalls = 0
    await mountApp()

    expect(target.querySelector('[data-testid="app-marker"]')).not.toBeNull()
    expect(getResourceDatabase().characters[0]?.chaId).toBe('char-a')

    revokeStartupWriterCapabilities()
    await tick()

    expect(target.querySelector('[data-testid="observer-shell-marker"]')).not.toBeNull()
    expect(target.querySelector('[data-testid="side-chat-list"]')).toBeNull()
    expect(getResourceDatabase().characters[0]?.chaId).toBe('char-a')
    expect(get(selectedCharID)).toBe(0)
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

    await vi.waitFor(() => {
      expect(target.querySelector('[data-testid="grid-close"]')).not.toBeNull()
    })
    const closeButton = target.querySelector<HTMLButtonElement>('[data-testid="grid-close"]')
    closeButton?.click()

    expect(appRouteDomMocks.closeGridRoute).toHaveBeenCalledOnce()
  })

  it('marks in-app drags without overriding a child reorder target', () => {
    const main = target.querySelector('main')
    expect(main).not.toBeNull()

    const setData = vi.fn()
    const dragStartEvent = new Event('dragstart', { bubbles: true, cancelable: true })
    Object.defineProperty(dragStartEvent, 'dataTransfer', { value: { setData } })
    main?.dispatchEvent(dragStartEvent)
    expect(setData).toHaveBeenCalledWith(RISU_APP_INTERNAL_DRAG_TYPE, 'true')

    const dataTransfer = {
      dropEffect: 'move',
      types: [RISU_SIDEBAR_DRAG_TYPE],
    }
    const childDropTarget = document.createElement('div')
    childDropTarget.addEventListener('dragover', (event) => {
      event.preventDefault()
      dataTransfer.dropEffect = 'move'
    })
    main?.append(childDropTarget)
    const dragOverEvent = new Event('dragover', { bubbles: true, cancelable: true })
    Object.defineProperty(dragOverEvent, 'dataTransfer', { value: dataTransfer })

    childDropTarget.dispatchEvent(dragOverEvent)

    expect(dataTransfer.dropEffect).toBe('move')
    expect(dragOverEvent.defaultPrevented).toBe(true)

    const dropEvent = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(dropEvent, 'dataTransfer', {
      value: { files: [{ name: 'ignored.charx' }], types: [RISU_APP_INTERNAL_DRAG_TYPE] },
    })
    main?.dispatchEvent(dropEvent)

    expect(dropEvent.defaultPrevented).toBe(true)
    expect(appRouteDomMocks.importCharacterProcess).not.toHaveBeenCalled()
  })

  it('advertises copy for external file drags', () => {
    const main = target.querySelector('main')
    expect(main).not.toBeNull()

    const dataTransfer = { dropEffect: 'none', types: ['Files'] }
    const dragOverEvent = new Event('dragover', { bubbles: true, cancelable: true })
    Object.defineProperty(dragOverEvent, 'dataTransfer', { value: dataTransfer })
    main?.dispatchEvent(dragOverEvent)

    expect(dragOverEvent.defaultPrevented).toBe(true)
    expect(dataTransfer.dropEffect).toBe('copy')
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
