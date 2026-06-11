import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const loadPageMocks = vi.hoisted(() => ({
  abortActiveGeneration: vi.fn(),
  alertError: vi.fn(),
  alertNormal: vi.fn(),
  alertWait: vi.fn(),
  appendCurrentChatUserMessageForSend: vi.fn(async () => ({ status: 'ok' })),
  applySuccessfulSendChatEffects: vi.fn(() => true),
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
  guardActiveChatGenerationSettingsForSend: vi.fn(() => ({ status: 'ok' })),
  hydrateActiveChatFully: vi.fn(async () => undefined),
  hydrateActiveChatWindow: vi.fn(async () => undefined),
  toCanvas: vi.fn(),
}))

vi.mock('./Chat.svelte', async () => {
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
  alertWait: loadPageMocks.alertWait,
}))

vi.mock('src/ts/process/index.svelte', async () => {
  const { writable } = await import('svelte/store')
  return {
    abortActiveGeneration: loadPageMocks.abortActiveGeneration,
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
  recordGeneratedReroll: vi.fn(),
  reroll: vi.fn(async () => undefined),
  resetRerollOnCharChange: vi.fn(),
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
  stopTTS: vi.fn(),
}))

vi.mock('src/ts/chatCommands', () => ({
  appendCurrentChatUserMessageForSend: loadPageMocks.appendCurrentChatUserMessageForSend,
  cloneJsonValue: <T>(value: T) => JSON.parse(JSON.stringify(value)) as T,
  currentChatScopedSnapshot: vi.fn(() => ({ before: 'chat-scoped' })),
  currentChatStateSnapshot: vi.fn(() => ({ before: 'chat-state' })),
  dispatchReplaceMessagesScoped: vi.fn(),
  dispatchUpdateChat: vi.fn(),
}))

vi.mock('src/ts/activeChatGenerationSettings', () => ({
  guardActiveChatGenerationSettingsForSend: loadPageMocks.guardActiveChatGenerationSettingsForSend,
}))

vi.mock('src/ts/server/settingsBridge.svelte', () => ({
  applyServerBackedSetting: vi.fn(),
}))

vi.mock('src/ts/server/projectionWriteGuard.svelte', () => ({
  withTrustedServerProjectionWrite: (callback: () => void) => callback(),
}))

vi.mock('src/ts/server/chatMessageHydration.svelte', () => ({
  hydrateActiveChatFully: loadPageMocks.hydrateActiveChatFully,
  hydrateActiveChatWindow: loadPageMocks.hydrateActiveChatWindow,
  isChatMessageHydrationPending: () => false,
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
import {
  additionalChatMenu,
  additionalFloatingActionButtons,
  DBState,
  PlaygroundStore,
  ScrollToMessageStore,
  selectedCharID,
} from 'src/ts/stores.svelte'
import type { Database } from 'src/ts/storage/database.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let target: HTMLElement
let component: MountedComponent | undefined
let originalScrollIntoView: Element['scrollIntoView'] | undefined
let consoleErrorSpy: ReturnType<typeof vi.spyOn>

function makeMessages(prefix: string, count: number) {
  return Array.from({ length: count }, (_, index) => ({
    chatId: `${prefix}-message-${index}`,
    role: index % 2 === 0 ? 'user' : 'char',
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

function seedDatabase(messageCounts: number[]) {
  selectedCharID.set(0)
  PlaygroundStore.set(0)
  ScrollToMessageStore.value = -1
  loadPageMocks.chatFoldedState.data = null
  loadPageMocks.chatFoldedStateMessageIndex.index = -1
  additionalChatMenu.splice(0, additionalChatMenu.length)
  additionalFloatingActionButtons.splice(0, additionalFloatingActionButtons.length)

  DBState.db = {
    aiModel: '',
    alwaysScrollToNewMessage: false,
    autoScrollToNewMessage: false,
    characters: messageCounts.map((count, index) => makeCharacter(index, count)),
    chatDisplayTailCount: 30,
    enableRisuaiProTools: false,
    fixedChatTextarea: false,
    hypaV3: false,
    newMessageButtonStyle: 'bottom-center',
    personas: [{ name: 'User', icon: '', largePortrait: false }],
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
  } as unknown as Database
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

async function clickScreenshotMenuItem() {
  const menuButton = target.querySelector<HTMLElement>('[data-testid="default-chat-menu-button"]')
  expect(menuButton).toBeTruthy()
  menuButton!.click()
  await tick()

  const screenshotButton = target.querySelector<HTMLElement>(
    '[data-testid="default-chat-screenshot-button"]',
  )
  expect(screenshotButton).toBeTruthy()
  screenshotButton!.click()
}

beforeEach(() => {
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
  Element.prototype.scrollIntoView = originalScrollIntoView as Element['scrollIntoView']
  vi.restoreAllMocks()
  selectedCharID.set(-1)
  ScrollToMessageStore.value = -1
  loadPageMocks.chatFoldedState.data = null
  loadPageMocks.chatFoldedStateMessageIndex.index = -1
  DBState.db = {} as Database
  target.remove()
  document.body.innerHTML = ''
})

describe('DefaultChatScreen transcript window state', () => {
  it('uses the configured display tail count for the initial chat window', async () => {
    seedDatabase([80])
    DBState.db.chatDisplayTailCount = 12

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

    await waitFor(() => {
      const indexes = messageRowIndexes()
      expect(indexes).toHaveLength(30)
      expect(indexes).toContain(149)
      expect(indexes).toContain(120)
      expect(indexes).not.toContain(5)
      expect(indexes).not.toContain(0)
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

  it('blocks an incomplete-chat send without clearing the composer or appending', async () => {
    seedDatabase([1])
    const originalHistory = JSON.parse(JSON.stringify(DBState.db.characters[0].chats[0].message))
    loadPageMocks.guardActiveChatGenerationSettingsForSend.mockReturnValue({
      status: 'error',
      error: 'Chat generation settings are incomplete. Missing: Persona.',
    })
    mountScreen()

    await waitFor(() => {
      expect(target.querySelector('[data-testid="default-chat-composer"]')).toBeTruthy()
    })
    const textarea = target.querySelector<HTMLTextAreaElement>(
      '[data-testid="default-chat-composer"]',
    )!
    textarea.value = 'Keep this draft'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()
    loadPageMocks.hydrateActiveChatFully.mockClear()
    loadPageMocks.appendCurrentChatUserMessageForSend.mockClear()
    loadPageMocks.sendChat.mockClear()

    const sendButton = target.querySelector<HTMLButtonElement>(
      '[data-testid="default-chat-send-button"]',
    )
    expect(sendButton).toBeTruthy()
    sendButton!.click()

    await waitFor(() => {
      expect(loadPageMocks.alertError).toHaveBeenCalledWith(
        'Chat generation settings are incomplete. Missing: Persona.',
      )
    })
    expect(textarea.value).toBe('Keep this draft')
    expect(DBState.db.characters[0].chats[0].message).toEqual(originalHistory)
    expect(loadPageMocks.hydrateActiveChatFully).not.toHaveBeenCalled()
    expect(loadPageMocks.processMultiCommand).not.toHaveBeenCalled()
    expect(loadPageMocks.appendCurrentChatUserMessageForSend).not.toHaveBeenCalled()
    expect(loadPageMocks.sendChat).not.toHaveBeenCalled()
  })
})
