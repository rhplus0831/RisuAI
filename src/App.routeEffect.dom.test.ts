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
    applyRouteCalls: 0,
    exports: undefined as RouteMockExports | undefined,
    readProjection: () => {},
    resetSidebarTab: () => {},
  }

  return {
    alertError: vi.fn(),
    alertNormal: vi.fn(),
    changeChar: vi.fn(),
    checkCharOrder: vi.fn(),
    getCharImage: vi.fn(() => ''),
    importCharacterProcess: vi.fn(),
    importPreset: vi.fn(),
    state,
  }
})

async function createRouteMock() {
  if (!appRouteDomMocks.state.exports) {
    const { writable } = await import('svelte/store')
    appRouteDomMocks.state.exports = {
      applyRouteToStores: vi.fn((route: AppRoute) => {
        appRouteDomMocks.state.readProjection()
        appRouteDomMocks.state.applyRouteCalls += 1
        if (appRouteDomMocks.state.applyRouteCalls > 1) {
          appRouteDomMocks.state.resetSidebarTab()
        }
        return Promise.resolve(route)
      }),
      characterRoutePath: (characterId: string, chatId?: string) =>
        chatId ? `/character/${characterId}/${chatId}` : `/character/${characterId}`,
      consumeStateDrivenRouteUpdate: () => false,
      currentRoute: writable(characterRoute),
      hasPendingRouteApplication: () => false,
      installRouter: vi.fn(),
      isApplyingRouteToStores: () => false,
      navigate: vi.fn(),
      parseRoute: vi.fn(() => characterRoute),
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
    home: 'Home',
    playground: { playground: 'Playground' },
    settings: 'Settings',
    successImport: 'Imported',
  },
}))

vi.mock('src/lang', () => ({
  language: {
    Chat: 'Chat',
    character: 'Character',
    home: 'Home',
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

vi.mock('./ts/storage/database.svelte', () => ({
  getDatabase: () => ({}),
  importPreset: appRouteDomMocks.importPreset,
  setDatabase: vi.fn(),
}))

vi.mock('src/ts/storage/database.svelte', () => ({
  getDatabase: () => ({}),
  importPreset: appRouteDomMocks.importPreset,
  setDatabase: vi.fn(),
}))

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
  default: (await import('./App.routeEffect.dom.AppMarker.svelte')).default,
}))
vi.mock('./lib/Others/BookmarkList.svelte', async () => ({
  default: (await import('./App.routeEffect.dom.AppMarker.svelte')).default,
}))
vi.mock('./lib/Setting/Settings.svelte', async () => ({
  default: (await import('./App.routeEffect.dom.AppMarker.svelte')).default,
}))
vi.mock('./lib/UI/Realm/RealmFrame.svelte', async () => ({
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
vi.mock('./lib/Others/PluginAlertModal.svelte', async () => ({
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
  DBState,
  DynamicGUI,
  LoadingStatusState,
  PlaygroundStore,
  QuickSettings,
  SettingsMenuIndex,
  ShowRealmFrameStore,
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
import {
  setServerProjectionWriteGuardEnabled,
  withTrustedServerProjectionWrite,
} from './ts/server/projectionWriteGuard.svelte'

vi.stubEnv('VITE_RISU_LEGAL_CONFIGURED', 'true')
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
  DBState.db = {
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
  } as unknown as Database

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
  ShowRealmFrameStore.set('')
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
    appRouteDomMocks.state.readProjection = () => {
      void DBState.db.characters?.[0]?.chatPage
    }
    appRouteDomMocks.state.resetSidebarTab = () => {
      botMakerMode.set(false)
    }
    if (appRouteDomMocks.state.exports) {
      appRouteDomMocks.state.exports.currentRoute.set(characterRoute)
    }
    seedStores()
    setServerProjectionWriteGuardEnabled(true)
    await mountApp()
  })

  afterEach(() => {
    if (component) {
      unmount(component)
      component = undefined
    }
    setServerProjectionWriteGuardEnabled(false)
    DBState.db = {} as Database
    target.remove()
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  it('keeps the Character sidebar tab visible across a server projection refreeze', async () => {
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

    withTrustedServerProjectionWrite(() => {
      DBState.db.characterOrder = [...DBState.db.characterOrder]
    })
    await tick()
    await tick()

    expect(target.querySelector('[data-risu-sidebar-panel="character"]')).not.toBeNull()
    expect(target.querySelector('[data-testid="char-config"]')).not.toBeNull()
    expect(target.querySelector('[data-risu-sidebar-panel="chat"]')).toBeNull()
    expect(target.querySelector('[data-testid="side-chat-list"]')).toBeNull()
    expect(get(botMakerMode)).toBe(true)
    expect(DBState.db.characters[0].chatPage).toBe(0)
    expect(DBState.db.characters[0].chats[DBState.db.characters[0].chatPage]?.id).toBe('chat-a')
    expect(get(selectedCharID)).toBe(0)
    expect(window.location.pathname).toBe(routePath)
    expect(appRouteDomMocks.state.applyRouteCalls).toBe(1)
  })
})
