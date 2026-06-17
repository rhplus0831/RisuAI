import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppendCurrentChatUserMessageResult } from 'src/ts/chatCommands'

const loadPageMocks = vi.hoisted(() => ({
  abortActiveGeneration: vi.fn(),
  alertError: vi.fn(),
  alertNormal: vi.fn(),
  alertWait: vi.fn(),
  appendCurrentChatEmptyCharMessage: vi.fn(),
  appendCurrentChatUserMessageForSend: vi.fn(
    async (): Promise<AppendCurrentChatUserMessageResult> => ({ status: 'ok', messageId: 'message-a' }),
  ),
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
  stopTTS: vi.fn(),
}))

vi.mock('src/ts/chatCommands', () => ({
  appendCurrentChatEmptyCharMessage: loadPageMocks.appendCurrentChatEmptyCharMessage,
  appendCurrentChatUserMessageForSend: loadPageMocks.appendCurrentChatUserMessageForSend,
  cloneJsonValue: <T>(value: T) => JSON.parse(JSON.stringify(value)) as T,
  currentChatScopedSnapshot: vi.fn(() => ({ before: 'chat-scoped' })),
  currentChatStateSnapshot: vi.fn(() => ({ before: 'chat-state' })),
  dispatchReplaceMessagesScoped: vi.fn(),
  dispatchSaveChatGenerationSettings: vi.fn(() => true),
  dispatchUpdateChat: vi.fn(),
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

vi.mock('src/ts/server/projectionWriteGuard.svelte', () => ({
  withTrustedServerProjectionWrite: (callback: () => void) => callback(),
}))

vi.mock('src/ts/server/chatMessageHydration.svelte', () => ({
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
import {
  additionalChatMenu,
  additionalFloatingActionButtons,
  DBState,
  PlaygroundStore,
  ScrollToMessageStore,
  selectedCharID,
} from 'src/ts/stores.svelte'
import { presetTemplate, type Database } from 'src/ts/storage/database.svelte'
import {
  createActiveChatGenerationSettingsIncompleteMessage,
  resolveActiveChatGenerationSettings,
} from 'src/ts/activeChatGenerationSettings'
import { translate } from '../../ts/translator/translator'

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

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
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

function findClickableByText(text: string): HTMLElement | undefined {
  return Array.from(target.querySelectorAll<HTMLElement>('button, div')).find(
    (element) => element.textContent?.trim() === text,
  )
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

  it('blocks a prefilled incomplete-chat send without clearing the composer or appending', async () => {
    seedDatabase([1])
    DBState.db.personas = [
      {
        id: 'persona-a',
        name: 'Persona Alpha',
        icon: '',
        largePortrait: false,
        personaPrompt: '',
      },
    ]
    DBState.db.modelPresets = [{ id: 'model-preset-a', name: 'Model Preset Alpha' }] as any
    DBState.db.promptPresets = [
      {
        ...presetTemplate,
        id: 'preset-a',
        name: 'Preset Alpha',
        jailbreak: 'Jailbreak',
        customPromptTemplateToggle: 'mood=Mood=select=Calm,Spicy\nflag=Flag\nnote=Note=text',
      },
    ]
    DBState.db.characters[0].chats[0].generationSettings = {
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
    const originalHistory = JSON.parse(JSON.stringify(DBState.db.characters[0].chats[0].message))
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
    expect(DBState.db.characters[0].chats[0].message).toEqual(originalHistory)
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
    )
    expect(textarea.value).toBe('Retry with file')
    expect(target.textContent).toContain('Missing file')
    expect(loadPageMocks.sendChat).not.toHaveBeenCalled()
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
    )

    textarea.value = 'Newer draft typed while append waits'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()
    append.resolve({ status: 'ok', messageId: 'delayed-message' })

    await waitFor(() => expect(loadPageMocks.sendChat).toHaveBeenCalledTimes(1))
    expect(textarea.value).toBe('Newer draft typed while append waits')
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
      }),
    )
    expect(textarea.value).toBe('Newer draft typed during continue')
  })

  it('does not let a stale auto-translate result overwrite newer source or target fields', async () => {
    seedDatabase([1])
    DBState.db.useAutoTranslateInput = true
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

    expect(secondTextarea.value).toBe('First chat draft')
    expect(secondTextarea.value).not.toContain('other-chat.txt')
    expect(target.textContent).not.toContain('Missing file')
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
})
