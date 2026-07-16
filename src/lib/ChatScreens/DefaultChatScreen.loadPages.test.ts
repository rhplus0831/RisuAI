import { mount, tick, unmount } from 'svelte'
import { get } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActiveChatTarget, AppendCurrentChatUserMessageResult } from 'src/ts/chatCommands'

const loadPageMocks = vi.hoisted(() => ({
  abortActiveGeneration: vi.fn(),
  alertError: vi.fn(),
  alertNormal: vi.fn(),
  beginAlertWait: vi.fn(() => Symbol('screenshot-wait')),
  clearAlertWait: vi.fn(() => true),
  appendCurrentChatEmptyCharMessage: vi.fn(),
  appendCurrentChatUserMessageForSend: vi.fn(
    async (): Promise<AppendCurrentChatUserMessageResult> => ({ status: 'ok', messageId: 'message-a' }),
  ),
  applySuccessfulSendChatEffects: vi.fn(() => true),
  captureActiveChatTarget: vi.fn((): ActiveChatTarget | null => null),
  chatFoldedState: { data: null as null | Record<string, string> },
  chatFoldedStateMessageIndex: { index: -1 },
  clearActiveGenerationAbortController: vi.fn(),
  createActiveGenerationAbortController: vi.fn(() => ({ signal: new AbortController().signal })),
  downloadFile: vi.fn(async () => undefined),
  getCharImage: vi.fn(() => ''),
  getInlayAsset: vi.fn(async () => null),
  postChatFile: vi.fn(async () => []),
  processMultiCommand: vi.fn(async () => false),
  sendChat: vi.fn(async () => true),
  sleep: vi.fn(async () => undefined),
  stopTTS: vi.fn(),
  guardActiveChatGenerationSettingsForSend: vi.fn(() => ({ status: 'ok' })),
  hydrateActiveChatFully: vi.fn(async () => undefined),
  hydrateActiveChatWindow: vi.fn(async () => undefined),
  isActiveChatTargetFresh: vi.fn((_target: ActiveChatTarget | null | undefined) => false),
  currentRouteSubscribers: new Set<(value: unknown) => void>(),
  currentRouteValue: {
    kind: 'character',
    path: '/character/character-0/chat-0',
    chaId: 'character-0',
    chatId: 'chat-0',
  } as unknown,
  setCurrentRoute(value: unknown) {
    loadPageMocks.currentRouteValue = value
    loadPageMocks.currentRouteSubscribers.forEach((run) => run(value))
  },
  toCanvas: vi.fn(),
  updateAlertWait: vi.fn(() => true),
}))

vi.mock('./Chat.svelte', async () => {
  const mock = await import('./DefaultChatScreen.testChat.svelte')
  return { default: mock.default }
})

vi.mock('./Suggestion.svelte', async () => {
  const mock = await import('./DefaultChatScreen.testChat.svelte')
  return { default: mock.default }
})

vi.mock('../../lang', () => ({
  language: new Proxy(
    {},
    {
      get: (_target, property) => String(property),
    },
  ),
}))

vi.mock('../../ts/characters', () => ({
  getCharImage: loadPageMocks.getCharImage,
}))

vi.mock('src/ts/characters', () => ({
  getCharImage: loadPageMocks.getCharImage,
}))

vi.mock('../../ts/util', async (importActual) => {
  const actual = await importActual<typeof import('../../ts/util')>()
  return {
    ...actual,
    sleep: loadPageMocks.sleep,
  }
})

vi.mock('../../ts/translator/translator', () => ({
  isExpTranslator: () => false,
  runInputTranslator: vi.fn(async (message: string) => message),
  translate: vi.fn(async (message: string) => message),
}))

vi.mock('../../ts/process/modules', () => ({
  getModuleAssets: () => [],
  getModuleLorebooks: () => [],
  getModuleRegexScripts: () => [],
  getModules: () => [],
  getModuleTriggers: () => [],
  moduleUpdate: vi.fn(),
}))

vi.mock('src/ts/process/modules', () => ({
  getModuleAssets: () => [],
  getModuleLorebooks: () => [],
  getModuleRegexScripts: () => [],
  getModules: () => [],
  getModuleTriggers: () => [],
  moduleUpdate: vi.fn(),
}))

vi.mock('../../ts/process/scripts', () => ({
  resetScriptCache: vi.fn(),
}))

vi.mock('src/ts/process/scripts', () => ({
  resetScriptCache: vi.fn(),
}))

vi.mock('../../ts/alert', () => ({
  alertError: loadPageMocks.alertError,
  alertNormal: loadPageMocks.alertNormal,
  beginAlertWait: loadPageMocks.beginAlertWait,
  clearAlertWait: loadPageMocks.clearAlertWait,
  updateAlertWait: loadPageMocks.updateAlertWait,
}))

vi.mock('src/ts/process/index.svelte', async () => {
  const { writable } = await import('svelte/store')
  return {
    abortActiveGeneration: loadPageMocks.abortActiveGeneration,
    activeGenerationTarget: writable(null),
    chatProcessStage: writable(0),
    clearActiveGenerationAbortController: loadPageMocks.clearActiveGenerationAbortController,
    createActiveGenerationAbortController: loadPageMocks.createActiveGenerationAbortController,
    doingChat: writable(false),
    sendChat: loadPageMocks.sendChat,
  }
})

vi.mock('src/ts/process/rerollNavigation.svelte', () => ({
  clearRerollBuffer: vi.fn(),
  markRerollChar: vi.fn(),
  newReroll: vi.fn(async () => undefined),
  recordGeneratedReroll: vi.fn(),
  reroll: vi.fn(async () => undefined),
  resetRerollOnCharChange: vi.fn(),
  selectRerollCandidate: vi.fn(async () => undefined),
  unReroll: vi.fn(async () => undefined),
}))

vi.mock('src/ts/process/command', () => ({
  processMultiCommand: loadPageMocks.processMultiCommand,
}))

vi.mock('src/ts/process/files/multisend', () => ({
  postChatFile: loadPageMocks.postChatFile,
}))

vi.mock('src/ts/process/files/inlays', () => ({
  getInlayAsset: loadPageMocks.getInlayAsset,
}))

vi.mock('src/ts/process/sendChatCompletion', () => ({
  applySuccessfulSendChatEffects: loadPageMocks.applySuccessfulSendChatEffects,
}))

vi.mock('src/ts/process/coldstorage.svelte', () => ({
  coldStorageHeader: 'cold-storage:',
  preLoadChat: vi.fn(async () => undefined),
}))

vi.mock('src/ts/process/tts', () => ({
  stopTTS: loadPageMocks.stopTTS,
}))

vi.mock('src/ts/chatCommands', () => ({
  appendCurrentChatEmptyCharMessage: loadPageMocks.appendCurrentChatEmptyCharMessage,
  appendCurrentChatUserMessageForSend: loadPageMocks.appendCurrentChatUserMessageForSend,
  captureActiveChatTarget: loadPageMocks.captureActiveChatTarget,
  cloneJsonValue: <T>(value: T) => JSON.parse(JSON.stringify(value)) as T,
  currentChatScopedSnapshot: vi.fn(() => ({ before: 'chat-scoped' })),
  currentChatStateSnapshot: vi.fn(() => ({ before: 'chat-state' })),
  dispatchDeleteMessageScoped: vi.fn(),
  dispatchReplaceMessagesScoped: vi.fn(),
  dispatchSaveChatGenerationSettings: vi.fn(() => true),
  dispatchUpdateChat: vi.fn(),
  isActiveChatTargetFresh: loadPageMocks.isActiveChatTargetFresh,
}))

vi.mock('src/ts/activeChatGenerationSettings', async (importActual) => {
  const actual = await importActual<typeof import('src/ts/activeChatGenerationSettings')>()
  return {
    ...actual,
    guardActiveChatGenerationSettingsForSend: loadPageMocks.guardActiveChatGenerationSettingsForSend,
  }
})

vi.mock('src/ts/server/settingsBridge.svelte', () => ({
  applyServerBackedSetting: vi.fn(),
}))

vi.mock('src/ts/server/resourceWriteGuard.svelte', () => ({
  withTrustedResourceWrite: (callback: () => void) => callback(),
}))

vi.mock('src/ts/server/chatMessageHydration.svelte', () => ({
  applyServerChatMessagesResource: vi.fn(),
  hasChatMessageHydrationFailed: () => false,
  hydrateActiveChat: vi.fn(async () => undefined),
  hydrateActiveChatFully: loadPageMocks.hydrateActiveChatFully,
  hydrateActiveChatWindow: loadPageMocks.hydrateActiveChatWindow,
  isChatMessageHydrationPending: () => false,
}))

vi.mock('src/ts/router', () => ({
  currentRoute: {
    subscribe(run: (value: unknown) => void) {
      run(loadPageMocks.currentRouteValue)
      loadPageMocks.currentRouteSubscribers.add(run)
      return () => {
        loadPageMocks.currentRouteSubscribers.delete(run)
      }
    },
  },
}))

vi.mock('src/ts/globalApi.svelte', () => ({
  aiLawApplies: () => false,
  chatFoldedState: loadPageMocks.chatFoldedState,
  chatFoldedStateMessageIndex: loadPageMocks.chatFoldedStateMessageIndex,
  downloadFile: loadPageMocks.downloadFile,
  saveAsset: vi.fn(async () => ''),
}))

vi.mock('html-to-image', () => ({
  toCanvas: loadPageMocks.toCanvas,
}))

import DefaultChatScreen from './DefaultChatScreen.svelte'
import { clearDefaultChatComposerDrafts } from './DefaultChatScreen.composerDrafts'
import * as rerollNavigation from 'src/ts/process/rerollNavigation.svelte'
import { getResourceDatabase, replaceResourceDatabase } from 'src/ts/server/resourceState.svelte'
import {
  additionalChatMenu,
  additionalFloatingActionButtons,
  PlaygroundStore,
  ScrollToMessageStore,
  selectedCharID,
} from 'src/ts/stores.svelte'
import { presetTemplate, type Database } from 'src/ts/storage/database.svelte'
import {
  createActiveChatGenerationSettingsIncompleteMessage,
  resolveActiveChatGenerationSettings,
} from 'src/ts/activeChatGenerationSettings'
import { currentChatScopedSnapshot, dispatchDeleteMessageScoped } from 'src/ts/chatCommands'
import { runInputTranslator, translate } from '../../ts/translator/translator'

type MountedComponent = Parameters<typeof unmount>[0]

let target: HTMLElement
let component: MountedComponent | undefined
let originalScrollIntoView: Element['scrollIntoView'] | undefined
let consoleErrorSpy: ReturnType<typeof vi.spyOn>

function makeMessages(prefix: string, count: number) {
  return Array.from({ length: count }, (_, index) => ({
    chatId: `${prefix}-message-${index}`,
    role: index % 2 === 0 ? ('user' as const) : ('char' as const),
    data: `${prefix} message ${index}`,
  }))
}

function makeCharacter(index: number, messageCount: number) {
  return {
    chaId: `character-${index}`,
    name: `Character ${index}`,
    image: '',
    chatPage: 0,
    chats: [
      {
        id: `chat-${index}`,
        name: `Chat ${index}`,
        message: makeMessages(`chat-${index}`, messageCount),
        bookmarks: [],
        bookmarkNames: {},
        fmIndex: -1,
        localLore: [],
      },
    ],
    type: 'character',
    firstMessage: `Greeting ${index}`,
    alternateGreetings: [],
    creatorNotes: '',
    removedQuotes: false,
    largePortrait: false,
    viewScreen: 'none',
    ttsMode: 'none',
  }
}

function captureActiveChatTargetForTest(): ActiveChatTarget | null {
  const selectedChar = get(selectedCharID)
  const character = getResourceDatabase().characters?.[selectedChar]
  const chatPage = character?.chatPage ?? 0
  const chat = character?.chats?.[chatPage]
  if (!character || !chat) return null

  return {
    selectedCharID: selectedChar,
    chatPage,
    characterId: character.chaId,
    chatId: chat.id,
  }
}

function isActiveChatTargetFreshForTest(target: ActiveChatTarget | null | undefined): boolean {
  if (!target) return false

  const selectedChar = get(selectedCharID)
  const character = getResourceDatabase().characters?.[selectedChar]
  const chatPage = character?.chatPage ?? 0
  const chat = character?.chats?.[chatPage]
  if (!character || !chat) return false

  if (target.characterId !== undefined || character.chaId !== undefined) {
    if (target.characterId !== character.chaId) return false
  } else if (target.selectedCharID !== selectedChar) {
    return false
  }

  if (target.chatId !== undefined || chat.id !== undefined) {
    return target.chatId === chat.id
  }

  return target.chatPage === chatPage
}

function seedDatabase(messageCounts: number[]) {
  selectedCharID.set(0)
  loadPageMocks.setCurrentRoute({
    kind: 'character',
    path: '/character/character-0/chat-0',
    chaId: 'character-0',
    chatId: 'chat-0',
  })
  PlaygroundStore.set(0)
  ScrollToMessageStore.value = -1
  loadPageMocks.chatFoldedState.data = null
  loadPageMocks.chatFoldedStateMessageIndex.index = -1
  additionalChatMenu.splice(0, additionalChatMenu.length)
  additionalFloatingActionButtons.splice(0, additionalFloatingActionButtons.length)

  replaceResourceDatabase({
    aiModel: '',
    alwaysScrollToNewMessage: false,
    autoScrollToNewMessage: false,
    characters: messageCounts.map((count, index) => makeCharacter(index, count)),
    chatDisplayTailCount: 30,
    enableRisuaiProTools: false,
    fixedChatTextarea: false,
    hypaV3: false,
    newMessageButtonStyle: 'bottom-center',
    personas: [{ name: 'User', icon: '', largePortrait: false, personaPrompt: '' }],
    playMessage: false,
    selectedPersona: 0,
    showMenuChatList: false,
    showMenuHypaMemoryModal: false,
    sideMenuRerollButton: false,
    subModel: '',
    translator: '',
    useAutoSuggestions: false,
    useAutoTranslateInput: false,
    useChatSticker: false,
    useSayNothing: false,
    username: 'User',
  } as unknown as Database)
}

function mountScreen() {
  component = mount(DefaultChatScreen, { target })
}

async function settle() {
  for (let i = 0; i < 8; i += 1) {
    await tick()
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

async function waitFor(assertion: () => void) {
  let lastError: unknown
  for (let i = 0; i < 80; i += 1) {
    try {
      assertion()
      return
    } catch (error) {
      lastError = error
      await settle()
    }
  }
  throw lastError
}

function messageRowIndexes() {
  return Array.from(target.querySelectorAll<HTMLElement>('.risu-chat[data-chat-index]'))
    .map((element) => Number(element.dataset.chatIndex))
    .filter((index) => index >= 0)
}

function createCanvas(width = 120, height = 12) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
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

function expectedActiveTarget(characterIndex: number) {
  return expect.objectContaining({
    selectedCharID: characterIndex,
    chatPage: 0,
    characterId: `character-${characterIndex}`,
    chatId: `chat-${characterIndex}`,
  })
}

function switchToCharacterChat(characterIndex: number) {
  selectedCharID.set(characterIndex)
  loadPageMocks.setCurrentRoute({
    kind: 'character',
    path: `/character/character-${characterIndex}/chat-${characterIndex}`,
    chaId: `character-${characterIndex}`,
    chatId: `chat-${characterIndex}`,
  })
}

async function clickScreenshotMenuItem() {
  const menuButton = target.querySelector<HTMLElement>('[data-testid="default-chat-menu-button"]')
  expect(menuButton).toBeTruthy()
  menuButton!.click()
  await tick()

  const screenshotButton = target.querySelector<HTMLElement>('[data-testid="default-chat-screenshot-button"]')
  expect(screenshotButton).toBeTruthy()
  screenshotButton!.click()
}

async function clickPostFileMenuItem() {
  const menuButton = target.querySelector<HTMLButtonElement>('[data-testid="default-chat-menu-button"]')
  expect(menuButton).toBeTruthy()
  menuButton!.click()
  await tick()
  const postFileMenuItem = findClickableByText('postFile')
  expect(postFileMenuItem).toBeTruthy()
  postFileMenuItem!.click()
}

async function clickContinueMenuItem() {
  const menuButton = target.querySelector<HTMLButtonElement>('[data-testid="default-chat-menu-button"]')
  expect(menuButton).toBeTruthy()
  menuButton!.click()
  await tick()
  const continueMenuItem = findClickableByText('continueResponse')
  expect(continueMenuItem).toBeTruthy()
  continueMenuItem!.click()
}

async function clickSideMenuRerollItem() {
  const menuButton = target.querySelector<HTMLButtonElement>('[data-testid="default-chat-menu-button"]')
  expect(menuButton).toBeTruthy()
  menuButton!.click()
  await tick()
  const rerollMenuItem = findClickableByText('reroll')
  expect(rerollMenuItem).toBeTruthy()
  rerollMenuItem!.click()
}

function findClickableByText(text: string): HTMLElement | undefined {
  return Array.from(target.querySelectorAll<HTMLElement>('button, div')).find(
    (element) => element.textContent?.trim() === text,
  )
}

beforeEach(() => {
  clearDefaultChatComposerDrafts()
  target = document.createElement('div')
  document.body.appendChild(target)
  originalScrollIntoView = Element.prototype.scrollIntoView
  Element.prototype.scrollIntoView = vi.fn()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    fillRect: vi.fn(),
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AA==')
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  vi.clearAllMocks()
  loadPageMocks.captureActiveChatTarget.mockImplementation(captureActiveChatTargetForTest)
  loadPageMocks.isActiveChatTargetFresh.mockImplementation(isActiveChatTargetFreshForTest)
  vi.mocked(runInputTranslator).mockImplementation(async (message: string) => message)
  vi.mocked(translate).mockImplementation(async (message: string) => message)
  loadPageMocks.toCanvas.mockReset()
  loadPageMocks.toCanvas.mockImplementation(async () => createCanvas())
  loadPageMocks.hydrateActiveChatFully.mockClear()
  loadPageMocks.hydrateActiveChatWindow.mockClear()
  loadPageMocks.guardActiveChatGenerationSettingsForSend.mockReturnValue({ status: 'ok' })
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  vi.unstubAllGlobals()
  Element.prototype.scrollIntoView = originalScrollIntoView as Element['scrollIntoView']
  vi.restoreAllMocks()
  selectedCharID.set(-1)
  ScrollToMessageStore.value = -1
  loadPageMocks.chatFoldedState.data = null
  loadPageMocks.chatFoldedStateMessageIndex.index = -1
  replaceResourceDatabase({} as Database)
  document.documentElement.style.removeProperty('--risu-theme-bgcolor')
  target.remove()
  document.body.innerHTML = ''
  clearDefaultChatComposerDrafts()
})

describe('DefaultChatScreen overflow menu accessibility', () => {
  it('exposes a named menu of native buttons and focuses the first enabled item', async () => {
    seedDatabase([2])
    mountScreen()

    await waitFor(() => {
      expect(target.querySelector('[data-testid="default-chat-menu-button"]')).toBeTruthy()
    })

    const menuButton = target.querySelector<HTMLButtonElement>('[data-testid="default-chat-menu-button"]')!
    menuButton.focus()
    menuButton.click()
    await settle()

    const menu = target.querySelector<HTMLElement>('[data-testid="default-chat-overflow-menu"]')
    expect(menu).toBeTruthy()
    expect(menu?.getAttribute('role')).toBe('menu')
    expect(menu?.getAttribute('aria-label')).toBe('menu')
    expect(menuButton.getAttribute('aria-haspopup')).toBe('menu')
    expect(menuButton.getAttribute('aria-controls')).toBe(menu?.id)
    expect(menuButton.getAttribute('aria-expanded')).toBe('true')
    expect(menu?.classList).toContain('overflow-y-auto')
    expect(menu?.classList).toContain('overscroll-contain')
    expect(menu?.className).toContain('max-h-[calc(100dvh-5rem)]')
    expect(menu?.className).toContain('max-w-[calc(100vw-1rem)]')

    const items = Array.from(menu!.querySelectorAll<HTMLButtonElement>('[data-default-chat-menu-item]'))
    expect(items.length).toBeGreaterThan(0)
    expect(items.every((item) => item.tagName === 'BUTTON')).toBe(true)
    expect(items.every((item) => item.textContent?.trim())).toBe(true)
    expect(items.every((item) => item.getAttribute('role')?.startsWith('menuitem'))).toBe(true)
    expect(document.activeElement).toBe(items[0])
  })

  it('supports arrow, Home, and End navigation and restores opener focus on Escape', async () => {
    seedDatabase([2])
    mountScreen()

    await waitFor(() => {
      expect(target.querySelector('[data-testid="default-chat-menu-button"]')).toBeTruthy()
    })

    const menuButton = target.querySelector<HTMLButtonElement>('[data-testid="default-chat-menu-button"]')!
    menuButton.click()
    await settle()

    const enabledItems = Array.from(
      target.querySelectorAll<HTMLButtonElement>('[data-default-chat-menu-item]:not(:disabled)'),
    )
    expect(enabledItems.length).toBeGreaterThan(2)
    expect(document.activeElement).toBe(enabledItems[0])

    enabledItems[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    expect(document.activeElement).toBe(enabledItems[1])

    enabledItems[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
    expect(document.activeElement).toBe(enabledItems.at(-1))

    enabledItems.at(-1)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
    expect(document.activeElement).toBe(enabledItems[0])

    enabledItems[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
    expect(document.activeElement).toBe(enabledItems.at(-1))

    enabledItems.at(-1)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settle()

    expect(target.querySelector('[data-testid="default-chat-overflow-menu"]')).toBeNull()
    expect(menuButton.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(menuButton)
  })

  it('skips the unavailable continue action when placing initial focus', async () => {
    seedDatabase([1])
    mountScreen()

    await waitFor(() => {
      expect(target.querySelector('[data-testid="default-chat-menu-button"]')).toBeTruthy()
    })

    target.querySelector<HTMLButtonElement>('[data-testid="default-chat-menu-button"]')!.click()
    await settle()

    const continueItem = findClickableByText('continueResponse') as HTMLButtonElement | undefined
    const firstEnabledItem = target.querySelector<HTMLButtonElement>('[data-default-chat-menu-item]:not(:disabled)')
    expect(continueItem).toBeInstanceOf(HTMLButtonElement)
    expect(continueItem?.disabled).toBe(true)
    expect(firstEnabledItem).toBeTruthy()
    expect(document.activeElement).toBe(firstEnabledItem)
  })
})

describe('DefaultChatScreen floating action accessibility', () => {
  it('uses the localized new-message name for the icon-only floating control', async () => {
    seedDatabase([1])
    getResourceDatabase().autoScrollToNewMessage = true
    getResourceDatabase().newMessageButtonStyle = 'floating-circle'
    mountScreen()

    await waitFor(() => {
      expect(target.querySelector('.chat-message-container')).toBeTruthy()
    })
    const latestRow = target.querySelector<HTMLElement>('.chat-message-container')!
    latestRow.getBoundingClientRect = () => ({
      top: 1_000,
      bottom: 1_100,
      left: 0,
      right: 100,
      width: 100,
      height: 100,
      x: 0,
      y: 1_000,
      toJSON() {},
    })

    getResourceDatabase().characters[0].chats[0].message.push({
      chatId: 'new-message',
      role: 'char',
      data: 'New response',
    })

    await waitFor(() => {
      expect(target.querySelector('button[aria-label="newMessage"]')).toBeTruthy()
    })

    const newMessageButton = target.querySelector<HTMLButtonElement>('button[aria-label="newMessage"]')!
    expect(newMessageButton.type).toBe('button')
    expect(newMessageButton.title).toBe('newMessage')
  })

  it('names attachment removal for the selected attachment', async () => {
    seedDatabase([1])
    loadPageMocks.postChatFile.mockResolvedValueOnce([{ type: 'asset', data: 'asset-a' }])
    mountScreen()

    await waitFor(() => {
      expect(target.querySelector('[data-testid="default-chat-menu-button"]')).toBeTruthy()
    })
    await clickPostFileMenuItem()

    await waitFor(() => {
      expect(target.querySelector('button[aria-label="remove: asset-a"]')).toBeTruthy()
    })
    const removeButton = target.querySelector<HTMLButtonElement>('button[aria-label="remove: asset-a"]')!
    expect(removeButton.type).toBe('button')

    removeButton.click()
    await tick()

    expect(target.querySelector('button[aria-label="remove: asset-a"]')).toBeNull()
  })

  it('uses each plugin action name for its floating button', async () => {
    seedDatabase([1])
    const callback = vi.fn()
    additionalFloatingActionButtons.push({
      id: 'plugin-action-a',
      name: 'Open plugin action',
      icon: '',
      iconType: 'none',
      callback,
    })
    mountScreen()

    await waitFor(() => {
      expect(target.querySelector('button[aria-label="Open plugin action"]')).toBeTruthy()
    })
    const pluginButton = target.querySelector<HTMLButtonElement>('button[aria-label="Open plugin action"]')!
    expect(pluginButton.type).toBe('button')

    pluginButton.click()

    expect(callback).toHaveBeenCalledTimes(1)
  })
})

describe('DefaultChatScreen transcript window state', () => {
  it('renders one native Load More control instead of nested buttons', async () => {
    seedDatabase([20])
    loadPageMocks.chatFoldedStateMessageIndex.index = 10
    mountScreen()

    await waitFor(() => {
      const loadMoreButtons = Array.from(target.querySelectorAll<HTMLButtonElement>('button')).filter(
        (button) => button.textContent?.trim() === 'loadMore',
      )
      expect(loadMoreButtons).toHaveLength(1)
    })
    expect(target.querySelector('button button')).toBeNull()
  })

  it('offers the Stop TTS action for every active synthesis mode', async () => {
    seedDatabase([2])
    getResourceDatabase().characters[0].ttsMode = 'gptsovits'
    mountScreen()

    await waitFor(() => {
      expect(target.querySelector('[data-testid="default-chat-menu-button"]')).toBeTruthy()
    })
    target.querySelector<HTMLButtonElement>('[data-testid="default-chat-menu-button"]')!.click()
    await tick()

    const stop = findClickableByText('ttsStop')
    expect(stop).toBeTruthy()
    stop!.click()
    expect(loadPageMocks.stopTTS).toHaveBeenCalledTimes(1)
  })

  it('uses the configured display tail count for the initial chat window', async () => {
    seedDatabase([80])
    getResourceDatabase().chatDisplayTailCount = 12

    mountScreen()

    await waitFor(() => {
      const indexes = messageRowIndexes()
      expect(indexes).toHaveLength(12)
      expect(indexes).toContain(79)
      expect(indexes).toContain(68)
      expect(indexes).not.toContain(67)
    })
  })

  it('expands the current chat window enough for a deep jump target', async () => {
    seedDatabase([120])
    mountScreen()
    await waitFor(() => expect(messageRowIndexes()).toHaveLength(30))

    ScrollToMessageStore.value = 8

    await waitFor(() => {
      const indexes = messageRowIndexes()
      expect(indexes).toContain(8)
      expect(indexes).toContain(3)
      expect(indexes).toContain(119)
      expect(indexes).not.toContain(2)
    })
  })

  it('resets the bounded window when the active chat identity changes after a deep jump', async () => {
    seedDatabase([200, 150])
    mountScreen()
    await waitFor(() => expect(messageRowIndexes()).toHaveLength(30))

    ScrollToMessageStore.value = 5
    await waitFor(() => {
      const indexes = messageRowIndexes()
      expect(indexes).toHaveLength(200)
      expect(indexes).toContain(5)
    })

    selectedCharID.set(1)
    loadPageMocks.setCurrentRoute({
      kind: 'character',
      path: '/character/character-1/chat-1',
      chaId: 'character-1',
      chatId: 'chat-1',
    })

    await waitFor(() => {
      const indexes = messageRowIndexes()
      expect(indexes).toHaveLength(30)
      expect(indexes).toContain(149)
      expect(indexes).toContain(120)
      expect(indexes).not.toContain(5)
      expect(indexes).not.toContain(0)
    })
  })

  it('shows a choose-chat empty state when a character route has no chat id', async () => {
    seedDatabase([12])
    loadPageMocks.setCurrentRoute({
      kind: 'character',
      path: '/character/character-0',
      chaId: 'character-0',
    })

    mountScreen()

    await waitFor(() => {
      expect(target.querySelector('[data-risu-chat-empty-state]')).toBeTruthy()
      expect(target.querySelector('[data-testid="default-chat-composer"]')).toBeNull()
      expect(messageRowIndexes()).toEqual([])
    })
  })

  it('restores the bounded window after successful screenshot expansion', async () => {
    seedDatabase([80])
    mountScreen()
    await waitFor(() => expect(messageRowIndexes()).toHaveLength(30))
    const observedMountedRows: number[] = []
    loadPageMocks.toCanvas.mockImplementation(async () => {
      observedMountedRows.push(messageRowIndexes().length)
      return createCanvas()
    })

    await clickScreenshotMenuItem()

    await waitFor(() => expect(loadPageMocks.downloadFile).toHaveBeenCalledTimes(1))
    expect(observedMountedRows.some((count) => count >= 80)).toBe(true)
    expect(messageRowIndexes()).toHaveLength(30)
    expect(messageRowIndexes()).not.toContain(0)
    expect(loadPageMocks.alertNormal).toHaveBeenCalledWith('screenshotSaved')
  })

  it('restores the bounded window when screenshot capture fails', async () => {
    seedDatabase([80])
    mountScreen()
    await waitFor(() => expect(messageRowIndexes()).toHaveLength(30))
    const observedMountedRows: number[] = []
    loadPageMocks.toCanvas.mockImplementation(async () => {
      observedMountedRows.push(messageRowIndexes().length)
      throw new Error('capture failed')
    })

    await clickScreenshotMenuItem()

    await waitFor(() => expect(loadPageMocks.alertError).toHaveBeenCalledTimes(1))
    expect(observedMountedRows.some((count) => count >= 80)).toBe(true)
    expect(messageRowIndexes()).toHaveLength(30)
    expect(messageRowIndexes()).not.toContain(0)
    expect(loadPageMocks.downloadFile).not.toHaveBeenCalled()
    expect(consoleErrorSpy).toHaveBeenCalled()
  })

  it('aborts a screenshot when the active chat changes during hydration', async () => {
    seedDatabase([80, 70])
    const hydration = createDeferred<void>()
    loadPageMocks.hydrateActiveChatFully.mockReturnValueOnce(hydration.promise)
    mountScreen()
    await waitFor(() => expect(messageRowIndexes()).toHaveLength(30))

    await clickScreenshotMenuItem()
    await waitFor(() => expect(loadPageMocks.hydrateActiveChatFully).toHaveBeenCalledTimes(1))

    switchToCharacterChat(1)
    await waitFor(() => {
      const indexes = messageRowIndexes()
      expect(indexes).toHaveLength(30)
      expect(indexes).toContain(69)
      expect(indexes).not.toContain(39)
    })

    hydration.resolve()
    await settle()

    expect(loadPageMocks.toCanvas).not.toHaveBeenCalled()
    expect(loadPageMocks.downloadFile).not.toHaveBeenCalled()
    expect(loadPageMocks.alertNormal).not.toHaveBeenCalled()
    expect(loadPageMocks.alertError).not.toHaveBeenCalled()
    expect(messageRowIndexes()).toHaveLength(30)
    expect(messageRowIndexes()).not.toContain(39)
  })

  it('aborts a screenshot when the active chat changes during row capture', async () => {
    seedDatabase([80])
    const character = getResourceDatabase().characters[0]
    character.chats.push({
      ...character.chats[0],
      id: 'alternate-chat',
      name: 'Alternate chat',
      message: makeMessages('alternate-chat', 70),
      bookmarks: [],
      bookmarkNames: {},
      localLore: [],
    })
    const rowCapture = createDeferred<HTMLCanvasElement>()
    loadPageMocks.toCanvas.mockReturnValueOnce(rowCapture.promise)
    mountScreen()
    await waitFor(() => expect(messageRowIndexes()).toHaveLength(30))

    await clickScreenshotMenuItem()
    await waitFor(() => expect(loadPageMocks.toCanvas).toHaveBeenCalledTimes(1))
    const waitHandle = loadPageMocks.beginAlertWait.mock.results[0]?.value

    character.chatPage = 1
    loadPageMocks.setCurrentRoute({
      kind: 'character',
      path: '/character/character-0/alternate-chat',
      chaId: 'character-0',
      chatId: 'alternate-chat',
    })
    await waitFor(() => {
      const indexes = messageRowIndexes()
      expect(indexes).toHaveLength(30)
      expect(indexes).toContain(69)
      expect(indexes).not.toContain(39)
    })

    rowCapture.resolve(createCanvas())
    await settle()

    expect(loadPageMocks.toCanvas).toHaveBeenCalledTimes(1)
    expect(loadPageMocks.downloadFile).not.toHaveBeenCalled()
    expect(loadPageMocks.alertNormal).not.toHaveBeenCalled()
    expect(loadPageMocks.alertError).not.toHaveBeenCalled()
    expect(loadPageMocks.clearAlertWait).toHaveBeenCalledWith(waitHandle)
    expect(messageRowIndexes()).toHaveLength(30)
    expect(messageRowIndexes()).not.toContain(39)
  })

  it('paints the resolved theme color behind transparent screenshot rows', async () => {
    seedDatabase([2])
    document.documentElement.style.setProperty('--risu-theme-bgcolor', 'rgb(12, 34, 56)')
    const mergedContext = {
      fillStyle: '',
      fillRect: vi.fn(),
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(mergedContext)
    mountScreen()
    await waitFor(() => expect(messageRowIndexes()).toHaveLength(2))

    await clickScreenshotMenuItem()

    await waitFor(() => expect(loadPageMocks.downloadFile).toHaveBeenCalledTimes(1))
    expect(mergedContext.fillStyle).toBe('rgb(12, 34, 56)')
    expect(mergedContext.fillRect).toHaveBeenCalled()
  })

  it('blocks a prefilled incomplete-chat send without clearing the composer or appending', async () => {
    seedDatabase([1])
    getResourceDatabase().personas = [
      {
        id: 'persona-a',
        name: 'Persona Alpha',
        icon: '',
        largePortrait: false,
        personaPrompt: '',
      },
    ]
    getResourceDatabase().modelPresets = [{ id: 'model-preset-a', name: 'Model Preset Alpha' }] as any
    getResourceDatabase().promptPresets = [
      {
        ...presetTemplate,
        id: 'preset-a',
        name: 'Preset Alpha',
        jailbreak: 'Jailbreak',
        customPromptTemplateToggle: 'mood=Mood=select=Calm,Spicy\nflag=Flag\nnote=Note=text',
      },
    ]
    getResourceDatabase().characters[0].chats[0].generationSettings = {
      configured: false,
      personaId: 'persona-a',
      modelPresetId: 'model-preset-a',
      promptPresetId: 'preset-a',
      jailbreakToggle: true,
      sidebarToggles: {
        mood: '1',
        flag: '1',
        note: 'imported-note',
      },
    }
    const originalHistory = JSON.parse(JSON.stringify(getResourceDatabase().characters[0].chats[0].message))
    loadPageMocks.guardActiveChatGenerationSettingsForSend.mockImplementation(() => {
      const state = resolveActiveChatGenerationSettings()
      if (state.readiness.ready) {
        return { status: 'ok', state }
      }
      return {
        status: 'error',
        error: createActiveChatGenerationSettingsIncompleteMessage(state),
        state,
      }
    })
    mountScreen()

    expect(resolveActiveChatGenerationSettings().missingLabels).toEqual(['Configuration confirmation'])

    await waitFor(() => {
      expect(target.querySelector('[data-testid="default-chat-composer"]')).toBeTruthy()
    })
    const textarea = target.querySelector<HTMLTextAreaElement>('[data-testid="default-chat-composer"]')!
    textarea.value = 'Keep this draft'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()
    loadPageMocks.hydrateActiveChatFully.mockClear()
    loadPageMocks.appendCurrentChatUserMessageForSend.mockClear()
    loadPageMocks.sendChat.mockClear()

    const sendButton = target.querySelector<HTMLButtonElement>('[data-testid="default-chat-send-button"]')
    expect(sendButton).toBeTruthy()
    sendButton!.click()

    await waitFor(() => {
      expect(loadPageMocks.alertError).toHaveBeenCalledTimes(1)
    })
    const [guardError] = loadPageMocks.alertError.mock.calls[0] ?? []
    expect(guardError).toContain('Chat generation settings are incomplete')
    expect(guardError).toContain('Configuration confirmation')
    expect(textarea.value).toBe('Keep this draft')
    expect(getResourceDatabase().characters[0].chats[0].message).toEqual(originalHistory)
    expect(loadPageMocks.hydrateActiveChatFully).not.toHaveBeenCalled()
    expect(loadPageMocks.processMultiCommand).not.toHaveBeenCalled()
    expect(loadPageMocks.appendCurrentChatUserMessageForSend).not.toHaveBeenCalled()
    expect(loadPageMocks.sendChat).not.toHaveBeenCalled()
  })

  it('restores composer text and selected files when appending the user message fails', async () => {
    seedDatabase([1])
    loadPageMocks.postChatFile.mockResolvedValueOnce([{ type: 'asset', data: 'asset-a' }])
    loadPageMocks.appendCurrentChatUserMessageForSend.mockResolvedValueOnce({
      status: 'error',
      error: 'append failed',
    })
    mountScreen()

    await waitFor(() => {
      expect(target.querySelector('[data-testid="default-chat-composer"]')).toBeTruthy()
    })
    const textarea = target.querySelector<HTMLTextAreaElement>('[data-testid="default-chat-composer"]')!
    textarea.value = 'Retry with file'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()

    const menuButton = target.querySelector<HTMLButtonElement>('[data-testid="default-chat-menu-button"]')
    expect(menuButton).toBeTruthy()
    menuButton!.click()
    await tick()
    const postFileMenuItem = findClickableByText('postFile')
    expect(postFileMenuItem).toBeTruthy()
    postFileMenuItem!.click()

    await waitFor(() => {
      expect(target.textContent).toContain('Missing file')
    })

    const sendButton = target.querySelector<HTMLButtonElement>('[data-testid="default-chat-send-button"]')
    expect(sendButton).toBeTruthy()
    sendButton!.click()

    await waitFor(() => {
      expect(loadPageMocks.alertError).toHaveBeenCalledWith('append failed')
    })

    expect(loadPageMocks.appendCurrentChatUserMessageForSend).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'user',
        data: 'Retry with file{{inlayed::asset-a}}',
      }),
      expect.objectContaining({
        expectedTarget: expectedActiveTarget(0),
      }),
    )
    expect(textarea.value).toBe('Retry with file')
    expect(target.textContent).toContain('Missing file')
    expect(loadPageMocks.sendChat).not.toHaveBeenCalled()
  })

  it('clears the composer, notifies the user, and stops generation when a plain send is durably queued', async () => {
    seedDatabase([1])
    loadPageMocks.appendCurrentChatUserMessageForSend.mockResolvedValueOnce({
      status: 'queued',
      messageId: 'queued-message',
    })
    mountScreen()

    await waitFor(() => {
      expect(target.querySelector('[data-testid="default-chat-composer"]')).toBeTruthy()
    })
    const textarea = target.querySelector<HTMLTextAreaElement>('[data-testid="default-chat-composer"]')!
    textarea.value = 'Keep durably'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()

    target.querySelector<HTMLButtonElement>('[data-testid="default-chat-send-button"]')!.click()

    await waitFor(() => {
      expect(loadPageMocks.alertNormal).toHaveBeenCalledWith('pendingChatMessageQueued')
    })
    expect(textarea.value).toBe('')
    expect(loadPageMocks.alertError).not.toHaveBeenCalled()
    expect(loadPageMocks.sendChat).not.toHaveBeenCalled()
    expect(loadPageMocks.applySuccessfulSendChatEffects).not.toHaveBeenCalled()
  })

  it('translates hook-enabled input into a user message without starting generation', async () => {
    seedDatabase([1])
    getResourceDatabase().characters[0].useInputTranslationHook = true
    vi.mocked(runInputTranslator).mockResolvedValueOnce('Translated draft')
    mountScreen()

    await waitFor(() => {
      expect(target.querySelector('[data-testid="default-chat-composer"]')).toBeTruthy()
    })
    const textarea = target.querySelector<HTMLTextAreaElement>('[data-testid="default-chat-composer"]')!
    textarea.value = '원문'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()

    const sendButton = target.querySelector<HTMLButtonElement>('[data-testid="default-chat-send-button"]')
    expect(sendButton).toBeTruthy()
    sendButton!.click()

    await waitFor(() => {
      expect(loadPageMocks.appendCurrentChatUserMessageForSend).toHaveBeenCalledTimes(1)
    })

    expect(runInputTranslator).toHaveBeenCalledWith('원문', expect.any(Object))
    expect(loadPageMocks.appendCurrentChatUserMessageForSend).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'user',
        data: 'Translated draft',
      }),
      expect.objectContaining({
        expectedTarget: expectedActiveTarget(0),
      }),
    )
    expect(textarea.value).toBe('')
    expect(loadPageMocks.sendChat).not.toHaveBeenCalled()
  })

  it('clears translated input and stops before generation when its append is durably queued', async () => {
    seedDatabase([1])
    getResourceDatabase().characters[0].useInputTranslationHook = true
    vi.mocked(runInputTranslator).mockResolvedValueOnce('Translated queued draft')
    loadPageMocks.appendCurrentChatUserMessageForSend.mockResolvedValueOnce({
      status: 'queued',
      messageId: 'translated-queued-message',
    })
    mountScreen()

    await waitFor(() => {
      expect(target.querySelector('[data-testid="default-chat-composer"]')).toBeTruthy()
    })
    const textarea = target.querySelector<HTMLTextAreaElement>('[data-testid="default-chat-composer"]')!
    textarea.value = '대기할 원문'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()

    target.querySelector<HTMLButtonElement>('[data-testid="default-chat-send-button"]')!.click()

    await waitFor(() => {
      expect(loadPageMocks.alertNormal).toHaveBeenCalledWith('pendingChatMessageQueued')
    })
    expect(loadPageMocks.appendCurrentChatUserMessageForSend).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'user', data: 'Translated queued draft' }),
      expect.objectContaining({ expectedTarget: expectedActiveTarget(0) }),
    )
    expect(textarea.value).toBe('')
    expect(target.querySelector('[data-testid="default-chat-input-translation-rollback"]')).toBeNull()
    expect(loadPageMocks.alertError).not.toHaveBeenCalled()
    expect(loadPageMocks.sendChat).not.toHaveBeenCalled()
  })

  it('restores original hook input and removes the translated message from the rollback button', async () => {
    seedDatabase([1])
    getResourceDatabase().characters[0].useInputTranslationHook = true
    vi.mocked(runInputTranslator).mockResolvedValueOnce('Translated draft')
    loadPageMocks.appendCurrentChatUserMessageForSend.mockResolvedValueOnce({
      status: 'ok',
      messageId: 'translated-message',
    })
    mountScreen()

    await waitFor(() => {
      expect(target.querySelector('[data-testid="default-chat-composer"]')).toBeTruthy()
    })
    const textarea = target.querySelector<HTMLTextAreaElement>('[data-testid="default-chat-composer"]')!
    textarea.value = '원문'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()

    const sendButton = target.querySelector<HTMLButtonElement>('[data-testid="default-chat-send-button"]')
    expect(sendButton).toBeTruthy()
    sendButton!.click()

    let rollbackButton: HTMLButtonElement | null = null
    await waitFor(() => {
      rollbackButton = target.querySelector<HTMLButtonElement>(
        '[data-testid="default-chat-input-translation-rollback"]',
      )
      expect(rollbackButton).toBeTruthy()
    })
    expect(textarea.value).toBe('')

    rollbackButton!.click()
    await tick()

    expect(textarea.value).toBe('원문')
    expect(currentChatScopedSnapshot).toHaveBeenCalledTimes(1)
    expect(dispatchDeleteMessageScoped).toHaveBeenCalledWith('translated-message', { before: 'chat-scoped' })
    expect(target.querySelector('[data-testid="default-chat-input-translation-rollback"]')).toBeNull()
    expect(loadPageMocks.sendChat).not.toHaveBeenCalled()
  })

  it('clears stored original hook input when generation starts', async () => {
    seedDatabase([1])
    getResourceDatabase().characters[0].useInputTranslationHook = true
    vi.mocked(runInputTranslator).mockResolvedValueOnce('Translated draft')
    const send = createDeferred<boolean>()
    loadPageMocks.sendChat.mockReturnValueOnce(send.promise)
    loadPageMocks.appendCurrentChatUserMessageForSend.mockResolvedValueOnce({
      status: 'ok',
      messageId: 'translated-message',
    })
    mountScreen()

    await waitFor(() => {
      expect(target.querySelector('[data-testid="default-chat-composer"]')).toBeTruthy()
    })
    const textarea = target.querySelector<HTMLTextAreaElement>('[data-testid="default-chat-composer"]')!
    textarea.value = '원문'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()

    const sendButton = target.querySelector<HTMLButtonElement>('[data-testid="default-chat-send-button"]')
    expect(sendButton).toBeTruthy()
    sendButton!.click()

    await waitFor(() => {
      expect(target.querySelector('[data-testid="default-chat-input-translation-rollback"]')).toBeTruthy()
    })
    expect(loadPageMocks.sendChat).not.toHaveBeenCalled()

    const confirmedSendButton = target.querySelector<HTMLButtonElement>('[data-testid="default-chat-send-button"]')
    expect(confirmedSendButton).toBeTruthy()
    confirmedSendButton!.click()

    await waitFor(() => {
      expect(loadPageMocks.sendChat).toHaveBeenCalledTimes(1)
      expect(target.querySelector('[data-testid="default-chat-input-translation-rollback"]')).toBeNull()
    })
    send.resolve(true)
    await settle()
  })

  it('shrinks the composer back after sending a tall draft', async () => {
    seedDatabase([1])
    mountScreen()

    await waitFor(() => {
      expect(target.querySelector('[data-testid="default-chat-composer"]')).toBeTruthy()
    })
    const textarea = target.querySelector<HTMLTextAreaElement>('[data-testid="default-chat-composer"]')!
    Object.defineProperty(textarea, 'scrollHeight', {
      configurable: true,
      get: () => (textarea.value === '' ? 44 : 180),
    })

    textarea.value = 'A long draft that wraps enough to make the composer tall.'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await waitFor(() => {
      expect(textarea.style.height).toBe('180px')
    })

    const sendButton = target.querySelector<HTMLButtonElement>('[data-testid="default-chat-send-button"]')
    expect(sendButton).toBeTruthy()
    sendButton!.click()

    await waitFor(() => {
      expect(loadPageMocks.sendChat).toHaveBeenCalledTimes(1)
      expect(textarea.value).toBe('')
      expect(textarea.style.height).toBe('44px')
    })
  })

  it('does not clear newer typed composer text when a delayed append succeeds', async () => {
    seedDatabase([1])
    const append = createDeferred<AppendCurrentChatUserMessageResult>()
    loadPageMocks.appendCurrentChatUserMessageForSend.mockReturnValueOnce(append.promise)
    mountScreen()

    await waitFor(() => {
      expect(target.querySelector('[data-testid="default-chat-composer"]')).toBeTruthy()
    })
    const textarea = target.querySelector<HTMLTextAreaElement>('[data-testid="default-chat-composer"]')!
    textarea.value = 'Send the captured draft'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()

    const sendButton = target.querySelector<HTMLButtonElement>('[data-testid="default-chat-send-button"]')
    expect(sendButton).toBeTruthy()
    sendButton!.click()

    await waitFor(() => expect(loadPageMocks.appendCurrentChatUserMessageForSend).toHaveBeenCalledTimes(1))
    expect(loadPageMocks.appendCurrentChatUserMessageForSend).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'user',
        data: 'Send the captured draft',
      }),
      expect.objectContaining({
        expectedTarget: expectedActiveTarget(0),
      }),
    )

    textarea.value = 'Newer draft typed while append waits'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()
    append.resolve({ status: 'ok', messageId: 'delayed-message' })

    await waitFor(() => expect(loadPageMocks.sendChat).toHaveBeenCalledTimes(1))
    expect(textarea.value).toBe('Newer draft typed while append waits')
  })

  it('silently aborts a delayed append result after the active chat changes', async () => {
    seedDatabase([1, 1])
    const append = createDeferred<AppendCurrentChatUserMessageResult>()
    loadPageMocks.appendCurrentChatUserMessageForSend.mockReturnValueOnce(append.promise)
    mountScreen()

    await waitFor(() => {
      expect(target.querySelector('[data-testid="default-chat-composer"]')).toBeTruthy()
    })
    const firstTextarea = target.querySelector<HTMLTextAreaElement>('[data-testid="default-chat-composer"]')!
    firstTextarea.value = 'First chat message'
    firstTextarea.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()

    const sendButton = target.querySelector<HTMLButtonElement>('[data-testid="default-chat-send-button"]')
    expect(sendButton).toBeTruthy()
    sendButton!.click()

    await waitFor(() => expect(loadPageMocks.appendCurrentChatUserMessageForSend).toHaveBeenCalledTimes(1))
    expect(loadPageMocks.appendCurrentChatUserMessageForSend).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'user',
        data: 'First chat message',
      }),
      expect.objectContaining({
        expectedTarget: expectedActiveTarget(0),
      }),
    )

    switchToCharacterChat(1)
    await settle()
    const secondTextarea = target.querySelector<HTMLTextAreaElement>('[data-testid="default-chat-composer"]')!
    secondTextarea.value = 'Second chat draft'
    secondTextarea.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()

    append.resolve({ status: 'ok', messageId: 'delayed-message' })
    await settle()

    expect(loadPageMocks.sendChat).not.toHaveBeenCalled()
    expect(loadPageMocks.alertError).not.toHaveBeenCalled()
    expect(secondTextarea.value).toBe('Second chat draft')
  })

  it('does not restore old text or files over a newer draft when a delayed append fails', async () => {
    seedDatabase([1])
    loadPageMocks.postChatFile.mockResolvedValueOnce([{ type: 'asset', data: 'asset-a' }])
    const append = createDeferred<AppendCurrentChatUserMessageResult>()
    loadPageMocks.appendCurrentChatUserMessageForSend.mockReturnValueOnce(append.promise)
    mountScreen()

    await waitFor(() => {
      expect(target.querySelector('[data-testid="default-chat-composer"]')).toBeTruthy()
    })
    const textarea = target.querySelector<HTMLTextAreaElement>('[data-testid="default-chat-composer"]')!
    textarea.value = 'Old draft with file'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()

    await clickPostFileMenuItem()

    await waitFor(() => {
      expect(target.textContent).toContain('Missing file')
    })

    const sendButton = target.querySelector<HTMLButtonElement>('[data-testid="default-chat-send-button"]')
    expect(sendButton).toBeTruthy()
    sendButton!.click()

    await waitFor(() => expect(loadPageMocks.appendCurrentChatUserMessageForSend).toHaveBeenCalledTimes(1))
    expect(loadPageMocks.appendCurrentChatUserMessageForSend).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'user',
        data: 'Old draft with file{{inlayed::asset-a}}',
      }),
      expect.objectContaining({
        expectedTarget: expectedActiveTarget(0),
      }),
    )

    const removeFileButton = target.querySelector<HTMLButtonElement>('.relative > button')
    expect(removeFileButton).toBeTruthy()
    removeFileButton!.click()
    textarea.value = 'Newer draft after removing file'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()

    append.resolve({ status: 'error', error: 'append failed' })

    await waitFor(() => {
      expect(loadPageMocks.alertError).toHaveBeenCalledWith('append failed')
    })

    expect(textarea.value).toBe('Newer draft after removing file')
    expect(target.textContent).not.toContain('Missing file')
    expect(loadPageMocks.sendChat).not.toHaveBeenCalled()
  })

  it('skips successful send effects when send resolves after the active chat changes', async () => {
    seedDatabase([1, 1])
    const send = createDeferred<boolean>()
    loadPageMocks.sendChat.mockReturnValueOnce(send.promise)
    mountScreen()

    await waitFor(() => {
      expect(target.querySelector('[data-testid="default-chat-composer"]')).toBeTruthy()
    })
    const firstTextarea = target.querySelector<HTMLTextAreaElement>('[data-testid="default-chat-composer"]')!
    firstTextarea.value = 'Generate from first chat'
    firstTextarea.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()

    const sendButton = target.querySelector<HTMLButtonElement>('[data-testid="default-chat-send-button"]')
    expect(sendButton).toBeTruthy()
    sendButton!.click()

    await waitFor(() => expect(loadPageMocks.sendChat).toHaveBeenCalledTimes(1))
    expect(loadPageMocks.appendCurrentChatUserMessageForSend).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'user',
        data: 'Generate from first chat',
      }),
      expect.objectContaining({
        expectedTarget: expectedActiveTarget(0),
      }),
    )
    expect(loadPageMocks.sendChat).toHaveBeenCalledWith(
      -1,
      expect.objectContaining({
        expectedTarget: expectedActiveTarget(0),
      }),
    )

    switchToCharacterChat(1)
    await settle()
    const secondTextarea = target.querySelector<HTMLTextAreaElement>('[data-testid="default-chat-composer"]')!
    secondTextarea.value = 'Visible second chat draft'
    secondTextarea.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()

    send.resolve(true)
    await settle()

    expect(loadPageMocks.applySuccessfulSendChatEffects).not.toHaveBeenCalled()
    expect(loadPageMocks.alertError).not.toHaveBeenCalled()
    expect(secondTextarea.value).toBe('Visible second chat draft')
  })

  it('does not clear newer typed text when continue waits for hydration', async () => {
    seedDatabase([2])
    const hydration = createDeferred<void>()
    loadPageMocks.hydrateActiveChatFully.mockReturnValueOnce(hydration.promise)
    mountScreen()

    await waitFor(() => {
      expect(target.querySelector('[data-testid="default-chat-composer"]')).toBeTruthy()
    })
    const textarea = target.querySelector<HTMLTextAreaElement>('[data-testid="default-chat-composer"]')!

    await clickContinueMenuItem()
    await waitFor(() => expect(loadPageMocks.hydrateActiveChatFully).toHaveBeenCalledTimes(1))

    textarea.value = 'Newer draft typed during continue'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()
    hydration.resolve()

    await waitFor(() => expect(loadPageMocks.sendChat).toHaveBeenCalledTimes(1))
    expect(loadPageMocks.sendChat).toHaveBeenCalledWith(
      -1,
      expect.objectContaining({
        continue: true,
        expectedTarget: expectedActiveTarget(0),
      }),
    )
    expect(textarea.value).toBe('Newer draft typed during continue')
  })

  it('preserves the existing draft, translation, and files when continuing a response', async () => {
    seedDatabase([2])
    getResourceDatabase().useAutoTranslateInput = true
    loadPageMocks.postChatFile.mockResolvedValueOnce([{ type: 'asset', data: 'asset-a' }])
    mountScreen()

    await waitFor(() => {
      expect(target.querySelector('[data-testid="default-chat-composer"]')).toBeTruthy()
      expect(target.querySelector('#messageInputTranslate')).toBeTruthy()
    })
    const textarea = target.querySelector<HTMLTextAreaElement>('[data-testid="default-chat-composer"]')!
    const translation = target.querySelector<HTMLTextAreaElement>('#messageInputTranslate')!
    translation.value = 'Translated unsent draft'
    translation.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()
    textarea.value = '/draft that must not execute'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()

    await clickPostFileMenuItem()
    await waitFor(() => expect(target.textContent).toContain('Missing file'))
    const sourceBeforeContinue = textarea.value
    const translationBeforeContinue = translation.value
    expect(sourceBeforeContinue).not.toBe('')
    expect(translationBeforeContinue).not.toBe('')
    loadPageMocks.processMultiCommand.mockClear()
    loadPageMocks.appendCurrentChatUserMessageForSend.mockClear()

    const continueMenuItem = findClickableByText('continueResponse')
    expect(continueMenuItem).toBeTruthy()
    continueMenuItem!.click()
    await waitFor(() => expect(loadPageMocks.sendChat).toHaveBeenCalledTimes(1))

    expect(textarea.value).toBe(sourceBeforeContinue)
    expect(translation.value).toBe(translationBeforeContinue)
    expect(target.textContent).toContain('Missing file')
    expect(loadPageMocks.processMultiCommand).not.toHaveBeenCalled()
    expect(loadPageMocks.appendCurrentChatUserMessageForSend).not.toHaveBeenCalled()
    expect(loadPageMocks.sendChat).toHaveBeenCalledWith(
      -1,
      expect.objectContaining({
        continue: true,
        expectedTarget: expectedActiveTarget(0),
      }),
    )
  })

  it('does not call reroll navigation when the active chat changes during reroll hydration', async () => {
    seedDatabase([2, 2])
    getResourceDatabase().sideMenuRerollButton = true
    const hydration = createDeferred<void>()
    loadPageMocks.hydrateActiveChatFully.mockReturnValueOnce(hydration.promise)
    mountScreen()

    await waitFor(() => {
      expect(target.querySelector('[data-testid="default-chat-composer"]')).toBeTruthy()
    })

    await clickSideMenuRerollItem()
    await waitFor(() => expect(loadPageMocks.hydrateActiveChatFully).toHaveBeenCalledTimes(1))

    selectedCharID.set(1)
    loadPageMocks.setCurrentRoute({
      kind: 'character',
      path: '/character/character-1/chat-1',
      chaId: 'character-1',
      chatId: 'chat-1',
    })
    await settle()
    hydration.resolve()
    await settle()

    expect(rerollNavigation.reroll).not.toHaveBeenCalled()
  })

  it('does not let a stale auto-translate result overwrite newer source or target fields', async () => {
    seedDatabase([1])
    getResourceDatabase().useAutoTranslateInput = true
    const firstTranslation = createDeferred<string>()
    const pendingTranslation = new Promise<string>(() => undefined)
    const translateMock = vi.mocked(translate)
    translateMock.mockImplementationOnce(() => firstTranslation.promise)
    translateMock.mockImplementation(() => pendingTranslation)
    mountScreen()

    await waitFor(() => {
      expect(target.querySelector('[data-testid="default-chat-composer"]')).toBeTruthy()
      expect(target.querySelector('#messageInputTranslate')).toBeTruthy()
    })
    const textarea = target.querySelector<HTMLTextAreaElement>('[data-testid="default-chat-composer"]')!
    const translateTextarea = target.querySelector<HTMLTextAreaElement>('#messageInputTranslate')!

    textarea.value = 'Original source'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await waitFor(() => expect(translateMock).toHaveBeenCalledWith('Original source', false))

    translateTextarea.value = 'Manual target'
    translateTextarea.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()
    textarea.value = 'Newer source'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()

    firstTranslation.resolve('Stale translated source')
    await settle()

    expect(textarea.value).toBe('Newer source')
    expect(translateTextarea.value).toBe('Manual target')
  })

  it('ignores a delayed menu file result after composer text changes', async () => {
    seedDatabase([1])
    const upload =
      createDeferred<Array<{ type: 'asset'; data: string } | { type: 'text'; name: string; data: string }>>()
    loadPageMocks.postChatFile.mockReturnValueOnce(upload.promise)
    mountScreen()

    await waitFor(() => {
      expect(target.querySelector('[data-testid="default-chat-composer"]')).toBeTruthy()
    })
    const textarea = target.querySelector<HTMLTextAreaElement>('[data-testid="default-chat-composer"]')!
    textarea.value = 'Draft before file'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()

    await clickPostFileMenuItem()
    await waitFor(() => expect(loadPageMocks.postChatFile).toHaveBeenCalledWith('Draft before file'))

    textarea.value = 'Newer draft'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()
    upload.resolve([
      { type: 'asset', data: 'stale-asset' },
      { type: 'text', name: 'stale.txt', data: 'stale-text' },
    ])
    await settle()

    expect(textarea.value).toBe('Newer draft')
    expect(textarea.value).not.toContain('stale.txt')
    expect(target.textContent).not.toContain('Missing file')
  })

  it('ignores a delayed menu file result after the active chat changes', async () => {
    seedDatabase([1, 1])
    const upload =
      createDeferred<Array<{ type: 'asset'; data: string } | { type: 'text'; name: string; data: string }>>()
    loadPageMocks.postChatFile.mockReturnValueOnce(upload.promise)
    mountScreen()

    await waitFor(() => {
      expect(target.querySelector('[data-testid="default-chat-composer"]')).toBeTruthy()
    })
    const firstTextarea = target.querySelector<HTMLTextAreaElement>('[data-testid="default-chat-composer"]')!
    firstTextarea.value = 'First chat draft'
    firstTextarea.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()

    await clickPostFileMenuItem()
    await waitFor(() => expect(loadPageMocks.postChatFile).toHaveBeenCalledWith('First chat draft'))

    selectedCharID.set(1)
    loadPageMocks.setCurrentRoute({
      kind: 'character',
      path: '/character/character-1/chat-1',
      chaId: 'character-1',
      chatId: 'chat-1',
    })
    await settle()
    const secondTextarea = target.querySelector<HTMLTextAreaElement>('[data-testid="default-chat-composer"]')!
    upload.resolve([
      { type: 'asset', data: 'other-chat-asset' },
      { type: 'text', name: 'other-chat.txt', data: 'other-chat-text' },
    ])
    await settle()

    expect(secondTextarea.value).toBe('')
    expect(secondTextarea.value).not.toContain('other-chat.txt')
    expect(target.textContent).not.toContain('Missing file')
  })

  it('keeps composer drafts scoped to their chat', async () => {
    seedDatabase([1, 1])
    mountScreen()

    await waitFor(() => {
      expect(target.querySelector('[data-testid="default-chat-composer"]')).toBeTruthy()
    })
    const firstTextarea = target.querySelector<HTMLTextAreaElement>('[data-testid="default-chat-composer"]')!
    firstTextarea.value = 'First chat draft'
    firstTextarea.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()

    switchToCharacterChat(1)
    await waitFor(() => {
      expect(target.querySelector<HTMLTextAreaElement>('[data-testid="default-chat-composer"]')?.value).toBe('')
    })
    const secondTextarea = target.querySelector<HTMLTextAreaElement>('[data-testid="default-chat-composer"]')!
    secondTextarea.value = 'Second chat draft'
    secondTextarea.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()

    switchToCharacterChat(0)
    await waitFor(() => {
      expect(target.querySelector<HTMLTextAreaElement>('[data-testid="default-chat-composer"]')?.value).toBe(
        'First chat draft',
      )
    })

    switchToCharacterChat(1)
    await waitFor(() => {
      expect(target.querySelector<HTMLTextAreaElement>('[data-testid="default-chat-composer"]')?.value).toBe(
        'Second chat draft',
      )
    })
  })

  it('restores composer text and selected files after the screen remounts', async () => {
    seedDatabase([1])
    loadPageMocks.postChatFile.mockResolvedValueOnce([{ type: 'asset', data: 'asset-a' }])
    mountScreen()

    await waitFor(() => {
      expect(target.querySelector('[data-testid="default-chat-composer"]')).toBeTruthy()
    })
    const textarea = target.querySelector<HTMLTextAreaElement>('[data-testid="default-chat-composer"]')!
    textarea.value = 'Draft that survives a full-screen route'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await clickPostFileMenuItem()

    await waitFor(() => {
      expect(target.querySelector('button[aria-label="remove: asset-a"]')).toBeTruthy()
    })

    unmount(component!)
    component = undefined
    mountScreen()

    await waitFor(() => {
      expect(target.querySelector<HTMLTextAreaElement>('[data-testid="default-chat-composer"]')?.value).toBe(
        'Draft that survives a full-screen route',
      )
      expect(target.querySelector('button[aria-label="remove: asset-a"]')).toBeTruthy()
    })
  })

  it('ignores a delayed pasted image result after composer text changes', async () => {
    seedDatabase([1])
    const upload =
      createDeferred<Array<{ type: 'asset'; data: string } | { type: 'text'; name: string; data: string }>>()
    loadPageMocks.postChatFile.mockReturnValueOnce(upload.promise)
    const imageBytes = new Uint8Array([1, 2, 3])
    class MockFileReader {
      onload: ((event: ProgressEvent<FileReader>) => void) | null = null
      onerror: (() => void) | null = null
      error: Error | null = null

      readAsArrayBuffer() {
        setTimeout(() => {
          this.onload?.({
            target: { result: imageBytes.buffer },
          } as ProgressEvent<FileReader>)
        }, 0)
      }
    }
    vi.stubGlobal('FileReader', MockFileReader as unknown as typeof FileReader)
    mountScreen()

    await waitFor(() => {
      expect(target.querySelector('[data-testid="default-chat-composer"]')).toBeTruthy()
    })
    const textarea = target.querySelector<HTMLTextAreaElement>('[data-testid="default-chat-composer"]')!
    textarea.value = 'Paste before file'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()

    const pastedFile = new File([imageBytes], 'pasted.png', { type: 'image/png' })
    const pasteEvent = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
    Object.defineProperty(pasteEvent, 'clipboardData', {
      value: {
        items: [
          {
            kind: 'file',
            type: 'image/png',
            getAsFile: () => pastedFile,
          },
        ],
      },
    })
    textarea.dispatchEvent(pasteEvent)
    await waitFor(() =>
      expect(loadPageMocks.postChatFile).toHaveBeenCalledWith({
        name: 'pasted.png',
        data: imageBytes,
      }),
    )

    textarea.value = 'Newer paste draft'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()
    upload.resolve([
      { type: 'asset', data: 'pasted-stale-asset' },
      { type: 'text', name: 'pasted-stale.txt', data: 'pasted-stale-text' },
    ])
    await settle()

    expect(pasteEvent.defaultPrevented).toBe(true)
    expect(textarea.value).toBe('Newer paste draft')
    expect(textarea.value).not.toContain('pasted-stale.txt')
    expect(target.textContent).not.toContain('Missing file')
  })

  it('reports a pasted image upload failure while the composer is still current', async () => {
    seedDatabase([1])
    const uploadError = new Error('pasted image upload failed')
    loadPageMocks.postChatFile.mockRejectedValueOnce(uploadError)
    const imageBytes = new Uint8Array([7, 8, 9])
    class MockFileReader {
      onload: ((event: ProgressEvent<FileReader>) => void) | null = null
      onerror: (() => void) | null = null
      error: Error | null = null

      readAsArrayBuffer() {
        queueMicrotask(() => {
          this.onload?.({
            target: { result: imageBytes.buffer },
          } as ProgressEvent<FileReader>)
        })
      }
    }
    vi.stubGlobal('FileReader', MockFileReader as unknown as typeof FileReader)
    mountScreen()

    await waitFor(() => {
      expect(target.querySelector('[data-testid="default-chat-composer"]')).toBeTruthy()
    })
    const textarea = target.querySelector<HTMLTextAreaElement>('[data-testid="default-chat-composer"]')!
    textarea.value = 'Keep this draft'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()

    const pastedFile = new File([imageBytes], 'broken.png', { type: 'image/png' })
    const pasteEvent = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
    Object.defineProperty(pasteEvent, 'clipboardData', {
      value: {
        items: [
          {
            kind: 'file',
            type: 'image/png',
            getAsFile: () => pastedFile,
          },
        ],
      },
    })
    textarea.dispatchEvent(pasteEvent)

    await waitFor(() => expect(loadPageMocks.alertError).toHaveBeenCalledWith(uploadError))
    expect(pasteEvent.defaultPrevented).toBe(true)
    expect(textarea.value).toBe('Keep this draft')
  })

  it('reports a menu attachment upload failure while the composer is still current', async () => {
    seedDatabase([1])
    const uploadError = new Error('menu attachment upload failed')
    loadPageMocks.postChatFile.mockRejectedValueOnce(uploadError)
    mountScreen()

    await waitFor(() => {
      expect(target.querySelector('[data-testid="default-chat-composer"]')).toBeTruthy()
    })
    const textarea = target.querySelector<HTMLTextAreaElement>('[data-testid="default-chat-composer"]')!
    textarea.value = 'Keep this menu draft'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()

    await clickPostFileMenuItem()

    await waitFor(() => expect(loadPageMocks.alertError).toHaveBeenCalledWith(uploadError))
    expect(loadPageMocks.postChatFile).toHaveBeenCalledWith('Keep this menu draft')
    expect(textarea.value).toBe('Keep this menu draft')
  })
})
