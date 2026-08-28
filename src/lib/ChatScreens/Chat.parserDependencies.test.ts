import { flushSync, mount, tick, unmount } from 'svelte'
import { get } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '../../ts/storage/database.svelte'

const chatParserMocks = vi.hoisted(() => ({
  alertClear: vi.fn(),
  alertConfirm: vi.fn(async () => false),
  alertError: vi.fn(),
  alertInput: vi.fn(async () => ''),
  alertNormal: vi.fn(),
  alertRequestData: vi.fn(),
  alertWait: vi.fn(),
  canUseServerCommands: vi.fn(() => false),
  getDatabase: vi.fn(),
  getLLMCache: vi.fn(async () => null),
  ParseMarkdown: vi.fn(async (html: string) => html),
  risuChatParser: vi.fn((message: string, arg?: { cbsConditions?: unknown; chara?: unknown; chatID?: unknown }) => {
    return `parsed:${message}:${JSON.stringify(arg?.cbsConditions ?? {})}`
  }),
  clearManualTriggerAbortController: vi.fn(),
  createManualTriggerAbortController: vi.fn(() => new AbortController()),
  runLuaButtonTrigger: vi.fn(async () => undefined),
  runTrigger: vi.fn(async () => undefined),
  sayTTS: vi.fn(),
  setLLMCache: vi.fn(async () => undefined),
}))

const languageMocks = vi.hoisted(() => {
  const partialEdit = {
    cancelShortcut: 'Cancel',
    deleteButtonTooltip: 'Delete',
    deleteConfirmMessage: 'Delete this section?',
    deleteModalTitle: 'Delete',
    deleteNo: 'No',
    deleteYes: 'Yes',
    editButtonTooltip: 'Edit',
    editModalTitle: 'Edit',
    lineNumber: (line: number) => `Line ${line}`,
    matchFailedMessage: 'No match found.',
    matchFailedTitle: 'No match',
    matchesFound: 'matches',
    matchFound: (method: string) => `Matched by ${method}`,
    save: 'Save',
    saveShortcut: 'Save',
    selectDeleteMatch: 'Select delete match',
    selectMatch: 'Select match',
  }

  const language = new Proxy<Record<string, any>>(
    {},
    {
      get: (_target, property) => (property === 'partialEdit' ? partialEdit : String(property)),
    },
  )

  return { language }
})

vi.mock('./ChatBody.svelte', async () => {
  const mock = await import('./DefaultChatScreen.testChat.svelte')
  return { default: mock.default }
})

vi.mock('../../lang', () => ({
  language: languageMocks.language,
}))

vi.mock('src/lang', () => ({
  language: languageMocks.language,
}))

vi.mock('src/ts/globalApi.svelte', () => ({
  aiLawApplies: () => false,
  changeChatTo: vi.fn(),
  createChatCopyName: (name: string, suffix: string) => `${name} ${suffix}`,
  foldChatToMessage: vi.fn(),
  getFileSrc: vi.fn(async () => ''),
}))

vi.mock('src/ts/gui/longtouch', () => ({
  longpress: (node: HTMLElement, callback: (event: MouseEvent) => void) => {
    const handleTestLongPress = (event: Event) => callback(event as MouseEvent)
    node.addEventListener('test-longpress', handleTestLongPress)
    return {
      destroy: () => node.removeEventListener('test-longpress', handleTestLongPress),
    }
  },
}))

vi.mock('src/ts/model/modellist', () => ({
  getModelInfo: () => ({ shortName: 'mock-model' }),
}))

vi.mock('src/ts/process/modules', () => ({
  getModuleAssets: () => [],
  getModuleLorebooks: () => [],
  getModuleRegexScripts: () => [],
  getModules: () => [],
  getModuleTriggers: () => [],
  moduleUpdate: vi.fn(),
}))

vi.mock('../../ts/process/modules', () => ({
  getModuleAssets: () => [],
  getModuleLorebooks: () => [],
  getModuleRegexScripts: () => [],
  getModules: () => [],
  getModuleTriggers: () => [],
  moduleUpdate: vi.fn(),
}))

vi.mock('src/ts/process/scriptings', () => ({
  runLuaButtonTrigger: chatParserMocks.runLuaButtonTrigger,
}))

vi.mock('src/ts/process/scripts', () => ({
  resetScriptCache: vi.fn(),
  risuChatParser: chatParserMocks.risuChatParser,
}))

vi.mock('../../ts/process/scripts', () => ({
  resetScriptCache: vi.fn(),
  risuChatParser: chatParserMocks.risuChatParser,
}))

vi.mock('src/ts/process/triggers', () => ({
  clearManualTriggerAbortController: chatParserMocks.clearManualTriggerAbortController,
  createManualTriggerAbortController: chatParserMocks.createManualTriggerAbortController,
  runTrigger: chatParserMocks.runTrigger,
}))

vi.mock('src/ts/process/tts', () => ({
  sayTTS: chatParserMocks.sayTTS,
}))

vi.mock('../../ts/alert', () => ({
  alertClear: chatParserMocks.alertClear,
  alertConfirm: chatParserMocks.alertConfirm,
  alertError: chatParserMocks.alertError,
  alertInput: chatParserMocks.alertInput,
  alertNormal: chatParserMocks.alertNormal,
  alertRequestData: chatParserMocks.alertRequestData,
  alertWait: chatParserMocks.alertWait,
}))

vi.mock('../../ts/parser/parser.svelte', () => ({
  ParseMarkdown: chatParserMocks.ParseMarkdown,
}))

vi.mock('../../ts/storage/database.svelte', () => ({
  getCurrentCharacter: vi.fn(() => null),
  getCurrentChat: vi.fn(() => null),
  getDatabase: chatParserMocks.getDatabase,
  reapplyPendingPresetProjections: () => {},
  setCurrentChat: vi.fn(),
}))

vi.mock('../../ts/translator/translator', () => ({
  getLLMCache: chatParserMocks.getLLMCache,
  setLLMCache: chatParserMocks.setLLMCache,
}))

vi.mock('src/ts/chatCommands', () => ({
  cloneJsonValue: <T>(value: T) => JSON.parse(JSON.stringify(value)) as T,
  currentChatScopedSnapshot: vi.fn(() => ({})),
  currentChatStateSnapshot: vi.fn(() => ({})),
  dispatchCompatibleChatUpdateScoped: vi.fn(),
  dispatchDeleteMessageScoped: vi.fn(),
  dispatchForkChat: vi.fn(),
  dispatchReplaceMessagesScoped: vi.fn(),
  dispatchTruncateMessagesScoped: vi.fn(),
  dispatchUpdateChatScopedWithOutcome: vi.fn(),
  dispatchUpdateMessageScoped: vi.fn(),
  ensureMessageId: vi.fn((message: { chatId?: string }) => {
    message.chatId ??= 'generated-message-id'
    return message.chatId
  }),
}))

vi.mock('src/ts/server/commands', () => ({
  canUseServerCommands: chatParserMocks.canUseServerCommands,
}))

vi.mock('src/ts/util', () => ({
  capitalize: (value: string) => value.charAt(0).toUpperCase() + value.slice(1),
  sleep: vi.fn(async () => undefined),
}))

vi.mock('src/ts/utilState', () => ({
  getPersonaPrompt: () => '',
  getUserDisplayName: () => 'User',
  getUserIcon: () => '',
  getUserName: () => 'User',
}))

import ChatParserDependenciesHarness, { type ParserDependencyRow } from './Chat.parserDependenciesHarness.svelte'
import { getResourceDatabase, replaceResourceDatabase } from '../../ts/server/resourceState.svelte'
import {
  HideIconStore,
  ReloadChatPointer,
  ReloadGUIPointer,
  SizeStore,
  VariableReloadGUIPointer,
  selIdState,
  selectedCharID,
} from '../../ts/stores.svelte'
import { setResourceWriteGuardEnabled, withTrustedResourceWrite } from '../../ts/server/resourceWriteGuard.svelte'
import { dispatchDeleteMessageScoped, dispatchUpdateMessageScoped } from 'src/ts/chatCommands'

chatParserMocks.getDatabase.mockImplementation(() => getResourceDatabase())

type MountedComponent = Parameters<typeof unmount>[0]
type ChatHarnessApi = MountedComponent & {
  updateMessage(index: number, data: string): void
  updateName(index: number, name: string): void
  updateParserIndex(index: number, parserIdx: number): void
  updateRole(index: number, role: string): void
}

const previousDb = getResourceDatabase({ snapshot: true })
const previousSelectedChar = get(selectedCharID)
const previousReloadGui = get(ReloadGUIPointer)
const previousReloadChat = get(ReloadChatPointer)
const previousVariableReloadGui = get(VariableReloadGUIPointer)

let target: HTMLElement
let component: ChatHarnessApi | undefined

class VisibleIntersectionObserver implements IntersectionObserver {
  readonly root: Element | Document | null = null
  readonly rootMargin = '300px'
  readonly thresholds: ReadonlyArray<number> = [0]

  constructor(private readonly callback: IntersectionObserverCallback) {}

  observe(target: Element) {
    const rect = target.getBoundingClientRect()
    this.callback(
      [
        {
          boundingClientRect: rect,
          intersectionRatio: 1,
          intersectionRect: rect,
          isIntersecting: true,
          rootBounds: null,
          target,
          time: 0,
        } as IntersectionObserverEntry,
      ],
      this,
    )
  }

  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] {
    return []
  }
}

function domRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect
}

function setRect(element: HTMLElement, left: number, top: number, width: number, height: number) {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => domRect(left, top, width, height),
  })
}

function makeRows(count: number): ParserDependencyRow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `row-${index}`,
    data: `visible message ${index}`,
    name: index % 2 === 0 ? `Parser Bot ${index}` : 'User',
    role: index % 2 === 0 ? 'char' : 'user',
  }))
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve
  })
  return { promise, resolve }
}

function seedDatabase(rows: ParserDependencyRow[]) {
  selectedCharID.set(0)
  selIdState.selId = 0
  ReloadGUIPointer.set(0)
  ReloadChatPointer.set({})
  VariableReloadGUIPointer.set(0)
  HideIconStore.set(false)
  SizeStore.set({ w: 900, h: 700 })
  replaceResourceDatabase({
    askRemoval: false,
    characters: [
      {
        chaId: 'parser-dependency-character',
        chatPage: 0,
        chats: [
          {
            id: 'parser-dependency-chat',
            name: 'Parser Dependency Chat',
            message: rows.map((row, index) => ({
              chatId: row.id,
              data: row.data,
              role: row.role,
            })),
            note: '',
            bookmarks: [],
            bookmarkNames: {},
            localLore: [],
          },
        ],
        image: '',
        largePortrait: false,
        name: 'Parser Bot',
        ttsMode: 'none',
        type: 'character',
      },
    ],
    clickToEdit: false,
    createFolderOnBranch: false,
    disableAutoPopupMessageEditor: true,
    enableBlockPartialEdit: false,
    enableBookmark: false,
    enableDragPartialEdit: false,
    guiHTML: '',
    iconsize: 100,
    instantRemove: false,
    lineHeight: 1.25,
    memoryLimitThickness: 1,
    requestInfoInsideChat: false,
    roundIcons: false,
    showFirstMessagePages: false,
    swipe: false,
    theme: '',
    translator: '',
    translatorType: 'none',
    useChatCopy: false,
    zoomsize: 100,
  } as unknown as Database)
  setResourceWriteGuardEnabled(true)
}

async function settle() {
  flushSync()
  for (let i = 0; i < 6; i += 1) {
    await tick()
    await Promise.resolve()
  }
}

function mountHarness(rows: ParserDependencyRow[]) {
  component = mount(ChatParserDependenciesHarness, {
    target,
    props: { initialRows: rows },
  }) as ChatHarnessApi
}

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
  vi.clearAllMocks()
  chatParserMocks.risuChatParser.mockImplementation(
    (message: string, arg?: { cbsConditions?: unknown; chara?: unknown; chatID?: unknown }) => {
      return `parsed:${message}:${JSON.stringify(arg?.cbsConditions ?? {})}`
    },
  )
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  setResourceWriteGuardEnabled(false)
  replaceResourceDatabase(previousDb)
  selectedCharID.set(previousSelectedChar)
  selIdState.selId = previousSelectedChar
  ReloadGUIPointer.set(previousReloadGui)
  ReloadChatPointer.set(previousReloadChat)
  VariableReloadGUIPointer.set(previousVariableReloadGui)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  target.remove()
  document.body.innerHTML = ''
})

describe('Chat parser dependencies', () => {
  it('keeps the generation loading track at the full message content width', async () => {
    const rows: ParserDependencyRow[] = [
      {
        id: 'loading-row',
        data: 'previous response',
        generationStage: 3,
        isGenerationLoading: true,
        name: 'Parser Bot',
        role: 'char',
      },
    ]
    seedDatabase(rows)
    mountHarness(rows)
    await settle()

    const loading = target.querySelector<HTMLElement>('.chat-generation-loading')
    expect(loading?.classList).toContain('w-full')
    expect(loading?.querySelector('.chat-generation-loading-track')).toBeTruthy()
    expect(target.textContent).not.toContain('previous response')
  })

  it('does not re-run every visible row parser on unrelated guarded projection writes', async () => {
    const rows = makeRows(4)
    seedDatabase(rows)
    mountHarness(rows)
    await settle()

    expect(chatParserMocks.risuChatParser.mock.calls.map((call) => call[0])).toEqual(rows.map((row) => row.data))
    const callsAfterMount = chatParserMocks.risuChatParser.mock.calls.length

    withTrustedResourceWrite(() => {
      getResourceDatabase().characters[0].chats[0].note = 'unrelated guarded projection write'
    })
    await settle()

    expect(chatParserMocks.risuChatParser).toHaveBeenCalledTimes(callsAfterMount)
  })

  it('re-runs only changed row props and still honors explicit reload invalidation', async () => {
    const rows = makeRows(4)
    seedDatabase(rows)
    mountHarness(rows)
    await settle()
    chatParserMocks.risuChatParser.mockClear()

    component?.updateMessage(2, 'visible message 2 changed')
    await settle()

    expect(chatParserMocks.risuChatParser.mock.calls.map((call) => call[0])).toEqual(['visible message 2 changed'])

    chatParserMocks.risuChatParser.mockClear()
    component?.updateRole(1, 'char')
    await settle()

    expect(chatParserMocks.risuChatParser).toHaveBeenCalledTimes(1)
    expect(chatParserMocks.risuChatParser.mock.calls[0][0]).toBe('visible message 1')
    expect(chatParserMocks.risuChatParser.mock.calls[0][1]?.cbsConditions).toEqual({
      firstmsg: false,
      chatRole: 'char',
    })

    chatParserMocks.risuChatParser.mockClear()
    component?.updateName(0, 'Renamed Parser Bot')
    await settle()

    expect(chatParserMocks.risuChatParser).toHaveBeenCalledTimes(1)
    expect(chatParserMocks.risuChatParser.mock.calls[0][0]).toBe('visible message 0')
    expect(chatParserMocks.risuChatParser.mock.calls[0][1]?.chara).toBe('Renamed Parser Bot')
    expect(chatParserMocks.risuChatParser.mock.calls[0][1]?.chatID).toBe(0)

    chatParserMocks.risuChatParser.mockClear()
    component?.updateParserIndex(3, 99)
    await settle()

    expect(chatParserMocks.risuChatParser).toHaveBeenCalledTimes(1)
    expect(chatParserMocks.risuChatParser.mock.calls[0][0]).toBe('visible message 3')
    expect(chatParserMocks.risuChatParser.mock.calls[0][1]?.chara).toBe('User')
    expect(chatParserMocks.risuChatParser.mock.calls[0][1]?.chatID).toBe(99)

    chatParserMocks.risuChatParser.mockClear()
    ReloadGUIPointer.update((value) => value + 1)
    await settle()

    expect(chatParserMocks.risuChatParser.mock.calls.map((call) => call[0])).toEqual([
      'visible message 0',
      'visible message 1',
      'visible message 2 changed',
      'visible message 3',
    ])
  })

  it('re-runs only synthetic greeting display parsing on variable-only reload', async () => {
    const rows = makeRows(4)
    seedDatabase(rows)
    mountHarness(rows)
    await settle()

    component?.updateParserIndex(0, -1)
    await settle()
    chatParserMocks.risuChatParser.mockClear()

    VariableReloadGUIPointer.update((value) => value + 1)
    await settle()

    expect(chatParserMocks.risuChatParser.mock.calls.map((call) => call[0])).toEqual(['visible message 0'])
    expect(chatParserMocks.risuChatParser.mock.calls[0][1]?.cbsConditions).toEqual({
      firstmsg: true,
      chatRole: 'char',
    })
  })

  it('re-runs only synthetic greeting display parsing when the active chat changes', async () => {
    const rows = makeRows(4)
    seedDatabase(rows)
    withTrustedResourceWrite(() => {
      getResourceDatabase().characters[0].chats.push({
        id: 'parser-dependency-other-chat',
        name: 'Other Parser Dependency Chat',
        message: [],
        note: '',
        bookmarks: [],
        bookmarkNames: {},
        localLore: [],
      })
    })
    mountHarness(rows)
    await settle()

    component?.updateParserIndex(0, -1)
    await settle()
    chatParserMocks.risuChatParser.mockClear()

    withTrustedResourceWrite(() => {
      getResourceDatabase().characters[0].chatPage = 1
    })
    await settle()

    expect(chatParserMocks.risuChatParser.mock.calls.map((call) => call[0])).toEqual(['visible message 0'])
    expect(chatParserMocks.risuChatParser.mock.calls[0][1]?.chatID).toBe(-1)
  })

  it('re-runs display parsing for the targeted reload chat index', async () => {
    const rows = makeRows(4)
    seedDatabase(rows)
    mountHarness(rows)
    await settle()

    component?.updateParserIndex(0, -1)
    await settle()
    chatParserMocks.risuChatParser.mockClear()

    ReloadChatPointer.update((value) => ({
      ...value,
      [-1]: (value[-1] ?? 0) + 1,
    }))
    await settle()

    expect(chatParserMocks.risuChatParser.mock.calls.map((call) => call[0])).toEqual(['visible message 0'])
    expect(chatParserMocks.risuChatParser.mock.calls[0][1]?.chatID).toBe(-1)
  })

  it('does not dispatch a message update when edit mode closes without changes', async () => {
    const rows = makeRows(1)
    seedDatabase(rows)
    chatParserMocks.canUseServerCommands.mockReturnValue(true)
    mountHarness(rows)
    await settle()

    target.querySelector<HTMLButtonElement>('.button-icon-edit')?.click()
    await settle()

    const textarea = target.querySelector<HTMLTextAreaElement>('.message-edit-area')
    expect(textarea?.value).toBe('visible message 0')

    vi.mocked(dispatchUpdateMessageScoped).mockClear()
    target.querySelector<HTMLButtonElement>('.button-icon-edit')?.click()
    await settle()

    expect(dispatchUpdateMessageScoped).not.toHaveBeenCalled()
    expect(getResourceDatabase().characters[0].chats[0].message[0].data).toBe('visible message 0')
  })

  it('dispatches a message update when edited text actually changes', async () => {
    const rows = makeRows(1)
    seedDatabase(rows)
    chatParserMocks.canUseServerCommands.mockReturnValue(true)
    mountHarness(rows)
    await settle()

    target.querySelector<HTMLButtonElement>('.button-icon-edit')?.click()
    await settle()

    const textarea = target.querySelector<HTMLTextAreaElement>('.message-edit-area')
    expect(textarea).not.toBeNull()
    textarea!.value = 'changed message'
    textarea!.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()

    vi.mocked(dispatchUpdateMessageScoped).mockClear()
    target.querySelector<HTMLButtonElement>('.button-icon-edit')?.click()
    await settle()

    expect(dispatchUpdateMessageScoped).toHaveBeenCalledWith('row-0', { data: 'changed message' }, {})
    expect(getResourceDatabase().characters[0].chats[0].message[0].data).toBe('visible message 0')
  })

  it('saves an inline message edit when long press closes the editor', async () => {
    const rows = makeRows(1)
    seedDatabase(rows)
    chatParserMocks.canUseServerCommands.mockReturnValue(true)
    mountHarness(rows)
    await settle()

    target.querySelector<HTMLButtonElement>('.button-icon-edit')?.click()
    await settle()

    const textarea = target.querySelector<HTMLTextAreaElement>('.message-edit-area')
    expect(textarea).not.toBeNull()
    textarea!.value = 'long-press edit'
    textarea!.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()

    vi.mocked(dispatchUpdateMessageScoped).mockClear()
    textarea!.dispatchEvent(new MouseEvent('test-longpress', { bubbles: true }))
    await settle()

    expect(target.querySelector('.message-edit-area')).toBeNull()
    expect(dispatchUpdateMessageScoped).toHaveBeenCalledWith('row-0', { data: 'long-press edit' }, {})
  })

  it('keeps interactive message content out of click-to-edit mode', async () => {
    const rows = makeRows(1)
    seedDatabase(rows)
    withTrustedResourceWrite(() => {
      getResourceDatabase().clickToEdit = true
    })
    mountHarness(rows)
    await settle()

    const messageBody = target.querySelector<HTMLElement>('.chattext')
    expect(messageBody).not.toBeNull()
    const interactiveButton = document.createElement('button')
    interactiveButton.type = 'button'
    interactiveButton.textContent = 'message action'
    messageBody!.appendChild(interactiveButton)

    interactiveButton.click()
    await settle()
    expect(target.querySelector('.message-edit-area')).toBeNull()

    target.querySelector<HTMLElement>('.chattext .risu-chat')?.click()
    await settle()
    expect(target.querySelector('.message-edit-area')).not.toBeNull()
  })

  it('deletes the confirmed message by stable id after the live transcript shifts', async () => {
    const rows = makeRows(3)
    const confirmation = deferred<boolean>()
    seedDatabase(rows)
    chatParserMocks.canUseServerCommands.mockReturnValue(true)
    chatParserMocks.alertConfirm.mockReturnValueOnce(confirmation.promise)
    withTrustedResourceWrite(() => {
      getResourceDatabase().askRemoval = true
    })
    mountHarness(rows)
    await settle()

    const removeButtons = target.querySelectorAll<HTMLButtonElement>('.button-icon-remove')
    removeButtons[1]?.click()
    await settle()
    expect(chatParserMocks.alertConfirm).toHaveBeenCalledWith(languageMocks.language.removeChat)

    withTrustedResourceWrite(() => {
      getResourceDatabase().characters[0].chats[0].message.unshift({
        chatId: 'newer-row',
        data: 'newer message',
        role: 'user',
      })
    })
    confirmation.resolve(true)
    await settle()

    expect(dispatchDeleteMessageScoped).toHaveBeenCalledWith('row-1', {})
    expect(dispatchDeleteMessageScoped).not.toHaveBeenCalledWith('row-0', expect.anything())
  })

  it('surfaces a failed transcript-row deletion', async () => {
    const rows = makeRows(1)
    seedDatabase(rows)
    chatParserMocks.canUseServerCommands.mockReturnValue(true)
    vi.mocked(dispatchDeleteMessageScoped).mockResolvedValueOnce({
      status: 'failed',
      error: 'delete rejected',
    })
    mountHarness(rows)
    await settle()

    target.querySelector<HTMLButtonElement>('.button-icon-remove')?.click()
    await settle()

    expect(chatParserMocks.alertError).toHaveBeenCalledWith(languageMocks.language.messageMutationFailed)
    expect(target.textContent).toContain(languageMocks.language.messageMutationFailed)
  })

  it('surfaces a queued transcript-row deletion while its settlement is pending', async () => {
    const rows = makeRows(1)
    const settlement = deferred<{ status: 'accepted' }>()
    seedDatabase(rows)
    chatParserMocks.canUseServerCommands.mockReturnValue(true)
    vi.mocked(dispatchDeleteMessageScoped).mockResolvedValueOnce({
      status: 'queued',
      mutationId: 'queued-delete',
      settlement: settlement.promise,
    })
    mountHarness(rows)
    await settle()

    target.querySelector<HTMLButtonElement>('.button-icon-remove')?.click()
    await settle()

    expect(chatParserMocks.alertNormal).toHaveBeenCalledWith(languageMocks.language.messageMutationQueued)
    expect(target.textContent).toContain(languageMocks.language.messageMutationQueued)

    settlement.resolve({ status: 'accepted' })
    await settle()
    expect(target.textContent).not.toContain(languageMocks.language.messageMutationQueued)
  })

  it('keeps the same deletion target across the instant-remove confirmation', async () => {
    const rows = makeRows(3)
    const instantConfirmation = deferred<boolean>()
    seedDatabase(rows)
    chatParserMocks.canUseServerCommands.mockReturnValue(true)
    chatParserMocks.alertConfirm.mockResolvedValueOnce(true).mockReturnValueOnce(instantConfirmation.promise)
    withTrustedResourceWrite(() => {
      getResourceDatabase().askRemoval = true
      getResourceDatabase().instantRemove = true
    })
    mountHarness(rows)
    await settle()

    const removeButtons = target.querySelectorAll<HTMLButtonElement>('.button-icon-remove')
    removeButtons[1]?.click()
    await settle()
    expect(chatParserMocks.alertConfirm).toHaveBeenCalledTimes(2)

    withTrustedResourceWrite(() => {
      getResourceDatabase().characters[0].chats[0].message.splice(0, 1)
    })
    instantConfirmation.resolve(true)
    await settle()

    expect(dispatchDeleteMessageScoped).toHaveBeenCalledWith('row-1', {})
    expect(dispatchDeleteMessageScoped).not.toHaveBeenCalledWith('row-2', expect.anything())
  })

  it('does not delete a replacement row when the confirmed message disappeared', async () => {
    const rows = makeRows(3)
    const confirmation = deferred<boolean>()
    seedDatabase(rows)
    chatParserMocks.canUseServerCommands.mockReturnValue(true)
    chatParserMocks.alertConfirm.mockReturnValueOnce(confirmation.promise)
    withTrustedResourceWrite(() => {
      getResourceDatabase().askRemoval = true
    })
    mountHarness(rows)
    await settle()

    const removeButtons = target.querySelectorAll<HTMLButtonElement>('.button-icon-remove')
    removeButtons[1]?.click()
    await settle()

    withTrustedResourceWrite(() => {
      getResourceDatabase().characters[0].chats[0].message.splice(1, 1)
    })
    confirmation.resolve(true)
    await settle()

    expect(dispatchDeleteMessageScoped).not.toHaveBeenCalled()
  })

  it('drops partial edit saves when the live source data changed while the modal was open', async () => {
    vi.stubGlobal('IntersectionObserver', VisibleIntersectionObserver)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(1)
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    })

    const rows = makeRows(1)
    chatParserMocks.risuChatParser.mockImplementation((message: string) => message)
    seedDatabase(rows)
    withTrustedResourceWrite(() => {
      getResourceDatabase().enableBlockPartialEdit = true
    })
    mountHarness(rows)
    await settle()

    const bodyRoot = target.querySelector<HTMLElement>('.chattext')
    const block = target.querySelector<HTMLElement>('.chattext .risu-chat')
    expect(bodyRoot).not.toBeNull()
    expect(block).not.toBeNull()
    setRect(bodyRoot!, 20, 80, 260, 60)
    setRect(block!, 20, 80, 260, 60)
    vi.spyOn(document, 'elementFromPoint').mockImplementation((x: number, y: number) => {
      const rect = block!.getBoundingClientRect()
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return block
      }
      return null
    })

    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 40, clientY: 100, bubbles: true }))
    await settle()
    document.querySelector<HTMLButtonElement>('.partial-edit-btn-edit')?.click()
    await settle()

    const textarea = document.querySelector<HTMLTextAreaElement>('.partial-edit-textarea')
    expect(textarea).not.toBeNull()
    textarea!.value = 'stale replacement'
    textarea!.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()

    vi.mocked(dispatchUpdateMessageScoped).mockClear()
    withTrustedResourceWrite(() => {
      getResourceDatabase().characters[0].chats[0].message[0].data = 'newer live data'
    })

    document.querySelector<HTMLButtonElement>('.partial-edit-save-btn')?.click()
    await settle()

    expect(dispatchUpdateMessageScoped).not.toHaveBeenCalled()
    expect(getResourceDatabase().characters[0].chats[0].message[0].data).toBe('newer live data')
  })

  function stubPartialEditEnvironment() {
    vi.stubGlobal('IntersectionObserver', VisibleIntersectionObserver)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(1)
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    })
  }

  function makeRawTranslation(text: string) {
    return {
      source: 'raw' as const,
      text,
      sourceHash: 'source-hash',
      targetLanguage: 'ko',
      inputLanguage: 'en',
      translatorType: 'google' as const,
      settingsHash: 'settings-hash',
      updatedAt: 1,
    }
  }

  async function openPartialEditOnFirstBlock() {
    const bodyRoot = target.querySelector<HTMLElement>('.chattext')
    const block = target.querySelector<HTMLElement>('.chattext .risu-chat')
    expect(bodyRoot).not.toBeNull()
    expect(block).not.toBeNull()
    setRect(bodyRoot!, 20, 80, 260, 60)
    setRect(block!, 20, 80, 260, 60)
    vi.spyOn(document, 'elementFromPoint').mockImplementation((x: number, y: number) => {
      const rect = block!.getBoundingClientRect()
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return block
      }
      return null
    })

    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 40, clientY: 100, bubbles: true }))
    await settle()
    document.querySelector<HTMLButtonElement>('.partial-edit-btn-edit')?.click()
    await settle()

    const textarea = document.querySelector<HTMLTextAreaElement>('.partial-edit-textarea')
    expect(textarea).not.toBeNull()
    return { block: block!, textarea: textarea! }
  }

  it('routes translation-view partial edits to the persisted translation and keeps the original', async () => {
    stubPartialEditEnvironment()

    const rows = makeRows(1)
    chatParserMocks.risuChatParser.mockImplementation((message: string) => message)
    seedDatabase(rows)
    withTrustedResourceWrite(() => {
      const db = getResourceDatabase()
      db.enableBlockPartialEdit = true
      db.translator = 'ko'
      db.translatorType = 'google'
      db.characters[0].chats[0].autoTranslate = true
      db.characters[0].chats[0].message[0].translation = makeRawTranslation('translated body line')
    })
    mountHarness(rows)
    await settle()

    const { block, textarea } = await openPartialEditOnFirstBlock()
    expect(block.textContent).toContain('translated body line')
    expect(textarea.value).toBe('translated body line')

    textarea.value = 'polished translation line'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()

    vi.mocked(dispatchUpdateMessageScoped).mockClear()
    document.querySelector<HTMLButtonElement>('.partial-edit-save-btn')?.click()
    await settle()

    const liveMessage = getResourceDatabase().characters[0].chats[0].message[0]
    expect(liveMessage.data).toBe('visible message 0')
    expect(liveMessage.translation?.text).toBe('polished translation line')

    const call = vi.mocked(dispatchUpdateMessageScoped).mock.calls.at(-1)
    expect(call?.[0]).toBe('row-0')
    expect(call?.[1]).toMatchObject({
      translation: { source: 'raw', text: 'polished translation line' },
    })
    expect(call?.[1]).not.toHaveProperty('data')
  })

  it('invalidates a stale translation when an original-layer partial edit saves', async () => {
    stubPartialEditEnvironment()
    chatParserMocks.canUseServerCommands.mockReturnValue(true)

    const rows = makeRows(1)
    chatParserMocks.risuChatParser.mockImplementation((message: string) => message)
    seedDatabase(rows)
    withTrustedResourceWrite(() => {
      const db = getResourceDatabase()
      db.enableBlockPartialEdit = true
      db.characters[0].chats[0].message[0].translation = makeRawTranslation('translated body line')
    })
    mountHarness(rows)
    await settle()

    const { block, textarea } = await openPartialEditOnFirstBlock()
    expect(block.textContent).toContain('visible message 0')
    expect(textarea.value).toBe('visible message 0')

    textarea.value = 'visible edited 0'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()

    vi.mocked(dispatchUpdateMessageScoped).mockClear()
    document.querySelector<HTMLButtonElement>('.partial-edit-save-btn')?.click()
    await settle()

    // A source edit must invalidate the raw translation just like the full
    // message editor; otherwise the old translation remains visibly attached
    // to content with a different source hash.
    const call = vi.mocked(dispatchUpdateMessageScoped).mock.calls.at(-1)
    expect(call?.[0]).toBe('row-0')
    expect(call?.[1]).toEqual({ data: 'visible edited 0', translation: null })
  })
})
