// Regression coverage for lazy bootstrap character shells. A shell is a valid
// intermediate projection state, so the chat screen must render it without
// evaluating greeting fields until the selected character is hydrated. The
// hydrated control case proves the greeting still paints after hydration.

import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const shellMocks = vi.hoisted(() => ({
  abortActiveGeneration: vi.fn(),
  alertError: vi.fn(),
  alertNormal: vi.fn(),
  alertWait: vi.fn(),
  appendCurrentChatEmptyCharMessage: vi.fn(),
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
  hydrateActiveChat: vi.fn(async () => undefined),
  hydrateActiveChatFully: vi.fn(async () => undefined),
  hydrateActiveChatWindow: vi.fn(async () => undefined),
  hydrationFailed: false,
  currentRouteSubscribers: new Set<(value: unknown) => void>(),
  currentRouteValue: {
    kind: 'character',
    path: '/character/character-0/chat-0',
    chaId: 'character-0',
    chatId: 'chat-0',
  } as unknown,
  setCurrentRoute(value: unknown) {
    shellMocks.currentRouteValue = value
    shellMocks.currentRouteSubscribers.forEach((run) => run(value))
  },
  toCanvas: vi.fn(),
}))

vi.mock('./Chat.svelte', async () => {
  // A faithful stub that READS altGreeting/totalPages/currentPage the way the
  // real Chat.svelte does (Svelte 5 props are lazy — a stub that ignores them
  // would never trigger the unguarded parent expression). See the stub file.
  const mock = await import('./DefaultChatScreen.shellGreetingStub.svelte')
  return { default: mock.default }
})

vi.mock('./Suggestion.svelte', async () => {
  const mock = await import('./DefaultChatScreen.testChat.svelte')
  return { default: mock.default }
})

vi.mock('../../lang', () => ({
  language: new Proxy({}, { get: (_t, property) => String(property) }),
}))

vi.mock('../../ts/characters', () => ({ getCharImage: shellMocks.getCharImage }))
vi.mock('src/ts/characters', () => ({ getCharImage: shellMocks.getCharImage }))

vi.mock('../../ts/util', async (importActual) => {
  const actual = await importActual<typeof import('../../ts/util')>()
  return { ...actual, sleep: shellMocks.sleep }
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

vi.mock('../../ts/process/scripts', () => ({ resetScriptCache: vi.fn() }))
vi.mock('src/ts/process/scripts', () => ({ resetScriptCache: vi.fn() }))

vi.mock('../../ts/alert', () => ({
  alertError: shellMocks.alertError,
  alertNormal: shellMocks.alertNormal,
  alertWait: shellMocks.alertWait,
}))

vi.mock('src/ts/process/index.svelte', async () => {
  const { writable } = await import('svelte/store')
  return {
    abortActiveGeneration: shellMocks.abortActiveGeneration,
    chatProcessStage: writable(0),
    clearActiveGenerationAbortController: shellMocks.clearActiveGenerationAbortController,
    createActiveGenerationAbortController: shellMocks.createActiveGenerationAbortController,
    doingChat: writable(false),
    sendChat: shellMocks.sendChat,
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

vi.mock('src/ts/process/command', () => ({ processMultiCommand: shellMocks.processMultiCommand }))
vi.mock('src/ts/process/files/multisend', () => ({ postChatFile: shellMocks.postChatFile }))
vi.mock('src/ts/process/files/inlays', () => ({ getInlayAsset: shellMocks.getInlayAsset }))
vi.mock('src/ts/process/sendChatCompletion', () => ({
  applySuccessfulSendChatEffects: shellMocks.applySuccessfulSendChatEffects,
}))
vi.mock('src/ts/process/coldstorage.svelte', () => ({
  coldStorageHeader: 'cold-storage:',
  preLoadChat: vi.fn(async () => undefined),
}))
vi.mock('src/ts/process/tts', () => ({ stopTTS: vi.fn() }))

vi.mock('src/ts/chatCommands', () => ({
  appendCurrentChatEmptyCharMessage: shellMocks.appendCurrentChatEmptyCharMessage,
  appendCurrentChatUserMessageForSend: shellMocks.appendCurrentChatUserMessageForSend,
  cloneJsonValue: <T>(value: T) => JSON.parse(JSON.stringify(value)) as T,
  currentChatScopedSnapshot: vi.fn(() => ({ before: 'chat-scoped' })),
  currentChatStateSnapshot: vi.fn(() => ({ before: 'chat-state' })),
  dispatchReplaceMessagesScoped: vi.fn(),
  dispatchSaveChatGenerationSettings: vi.fn(() => true),
  dispatchUpdateChat: vi.fn(),
}))

vi.mock('src/ts/activeChatGenerationSettings', async (importActual) => {
  const actual = await importActual<typeof import('src/ts/activeChatGenerationSettings')>()
  return { ...actual, guardActiveChatGenerationSettingsForSend: shellMocks.guardActiveChatGenerationSettingsForSend }
})

vi.mock('src/ts/server/settingsBridge.svelte', () => ({ applyServerBackedSetting: vi.fn() }))
vi.mock('src/ts/server/resourceWriteGuard.svelte', () => ({
  withTrustedResourceWrite: (callback: () => void) => callback(),
}))
vi.mock('src/ts/server/chatMessageHydration.svelte', () => ({
  applyServerChatMessagesResource: vi.fn(),
  hasChatMessageHydrationFailed: () => shellMocks.hydrationFailed,
  hydrateActiveChat: shellMocks.hydrateActiveChat,
  hydrateActiveChatFully: shellMocks.hydrateActiveChatFully,
  hydrateActiveChatWindow: shellMocks.hydrateActiveChatWindow,
  isChatMessageHydrationPending: () => false,
}))

vi.mock('src/ts/router', () => ({
  currentRoute: {
    subscribe(run: (value: unknown) => void) {
      run(shellMocks.currentRouteValue)
      shellMocks.currentRouteSubscribers.add(run)
      return () => {
        shellMocks.currentRouteSubscribers.delete(run)
      }
    },
  },
}))

vi.mock('src/ts/globalApi.svelte', () => ({
  aiLawApplies: () => false,
  chatFoldedState: shellMocks.chatFoldedState,
  chatFoldedStateMessageIndex: shellMocks.chatFoldedStateMessageIndex,
  downloadFile: shellMocks.downloadFile,
  saveAsset: vi.fn(async () => ''),
}))

vi.mock('html-to-image', () => ({ toCanvas: shellMocks.toCanvas }))

import DefaultChatScreen from './DefaultChatScreen.svelte'
import { PlaygroundStore, ScrollToMessageStore, selectedCharID } from 'src/ts/stores.svelte'
import { getResourceDatabase, replaceResourceDatabase } from 'src/ts/server/resourceState.svelte'
import { isServerCharacterShell, SERVER_CHARACTER_SHELL_MARKER, type Database } from 'src/ts/storage/database.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let target: HTMLElement
let component: MountedComponent | undefined

// A faithful bootstrap shell as the server character resource ships it for an inactive
// character: marker set, chat metadata kept with empty messages, but
// alternateGreetings/firstMessage stripped (NOT in BOOTSTRAP_CHARACTER_SHELL_FIELDS).
function makeBootstrapShellCharacter() {
  return {
    [SERVER_CHARACTER_SHELL_MARKER]: true,
    chaId: 'character-0',
    name: 'Shell Character',
    type: 'character',
    image: '',
    chatPage: 0,
    chatFolders: [],
    creatorNotes: '',
    tags: [],
    largePortrait: false,
    viewScreen: 'none',
    ttsMode: 'none',
    removedQuotes: false,
    chats: [
      {
        id: 'chat-0',
        name: 'Chat 0',
        note: '',
        fmIndex: -1,
        localLore: [],
        message: [],
        bookmarks: [],
        bookmarkNames: {},
      },
    ],
    // NOTE: no `alternateGreetings`, no `firstMessage` — stripped on a shell.
  }
}

// The same character after hydration completes (the full character resource row
// on character-row hydration): alternateGreetings/firstMessage present.
function makeHydratedCharacter() {
  return {
    ...makeBootstrapShellCharacter(),
    [SERVER_CHARACTER_SHELL_MARKER]: undefined,
    firstMessage: 'Greeting from a hydrated character',
    alternateGreetings: [],
  }
}

function seedDatabase(character: Record<string, unknown>) {
  selectedCharID.set(0)
  shellMocks.setCurrentRoute({
    kind: 'character',
    path: '/character/character-0/chat-0',
    chaId: 'character-0',
    chatId: 'chat-0',
  })
  PlaygroundStore.set(0)
  ScrollToMessageStore.value = -1
  replaceResourceDatabase({
    aiModel: '',
    alwaysScrollToNewMessage: false,
    autoScrollToNewMessage: false,
    characters: [character],
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

function tryMount(): unknown {
  try {
    component = mount(DefaultChatScreen, { target })
    return null
  } catch (error) {
    return error
  }
}

function greetingBubble(): HTMLElement | null {
  return target.querySelector<HTMLElement>('.risu-chat[data-chat-index="-1"]')
}

beforeEach(() => {
  shellMocks.hydrateActiveChat.mockClear()
  shellMocks.hydrationFailed = false
  target = document.createElement('div')
  document.body.appendChild(target)
})

afterEach(() => {
  if (component) {
    try {
      unmount(component)
    } catch {}
    component = undefined
  }
  target.remove()
  document.body.innerHTML = ''
  selectedCharID.set(-1)
  replaceResourceDatabase({} as never)
})

describe('UIA-001 / BOOT-1: bootstrap shell greeting render (DOM oracle, Tier 1)', () => {
  it('paints the greeting bubble once the character is hydrated (correct-store control)', async () => {
    seedDatabase(makeHydratedCharacter())
    const error = tryMount()
    await tick()

    expect(error, 'hydrated character must not throw on render').toBeNull()
    const bubble = greetingBubble()
    expect(bubble, 'greeting bubble for a hydrated character').toBeTruthy()
    expect(bubble!.textContent).toContain('Greeting from a hydrated character')
  })

  // A correct bootstrap shell renders no greeting until hydration fills the
  // greeting fields, and it must not crash while those fields are absent.
  it('renders a bootstrap shell without crashing on alternateGreetings.length', async () => {
    seedDatabase(makeBootstrapShellCharacter())

    // The store is in its CORRECT lazy-shell state (not a wrong value): this is
    // what makes the divergence in-scope rather than a logic bug.
    expect(isServerCharacterShell(getResourceDatabase().characters[0])).toBe(true)
    expect(
      (getResourceDatabase().characters[0] as unknown as Record<string, unknown>).alternateGreetings,
    ).toBeUndefined()

    const error = tryMount()
    await tick()

    // The render must not throw on the correct shell state...
    expect(error, `shell render threw: ${String(error)}`).toBeNull()
    // ...and the greeting bubble must be suppressed until hydration lands (no
    // complete-but-empty greeting painted for a shell).
    expect(greetingBubble(), 'greeting bubble must be absent for an un-hydrated shell').toBeNull()
  })
})

describe('chat history hydration failure', () => {
  it('replaces the empty transcript with an actionable retry state', async () => {
    shellMocks.hydrationFailed = true
    seedDatabase(makeHydratedCharacter())

    const error = tryMount()
    await tick()

    expect(error).toBeNull()
    const failure = target.querySelector<HTMLElement>('[data-testid="chat-hydration-error"]')
    expect(failure?.textContent).toContain('chatDataLoadFailed')
    expect(failure?.textContent).toContain('retry')

    failure?.querySelector<HTMLButtonElement>('button')?.click()
    await tick()

    expect(shellMocks.hydrateActiveChat).toHaveBeenCalledWith({ force: true })
  })
})
