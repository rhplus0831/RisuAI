import { flushSync, mount, tick, unmount } from 'svelte'
import { get } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '../../ts/storage/database.svelte'

const chatParserMocks = vi.hoisted(() => ({
  alertClear: vi.fn(),
  alertConfirm: vi.fn(async () => false),
  alertInput: vi.fn(async () => ''),
  alertNormal: vi.fn(),
  alertRequestData: vi.fn(),
  alertWait: vi.fn(),
  canUseServerCommands: vi.fn(() => false),
  getLLMCache: vi.fn(async () => null),
  ParseMarkdown: vi.fn(async (html: string) => html),
  risuChatParser: vi.fn((message: string, arg?: { cbsConditions?: unknown; chara?: unknown; chatID?: unknown }) => {
    return `parsed:${message}:${JSON.stringify(arg?.cbsConditions ?? {})}`
  }),
  runLuaButtonTrigger: vi.fn(async () => undefined),
  runTrigger: vi.fn(async () => undefined),
  sayTTS: vi.fn(),
  setLLMCache: vi.fn(async () => undefined),
}))

vi.mock('./ChatBody.svelte', async () => {
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

vi.mock('src/ts/globalApi.svelte', () => ({
  aiLawApplies: () => false,
  changeChatTo: vi.fn(),
  createChatCopyName: (name: string, suffix: string) => `${name} ${suffix}`,
  foldChatToMessage: vi.fn(),
  getFileSrc: vi.fn(async () => ''),
}))

vi.mock('src/ts/gui/longtouch', () => ({
  longpress: () => undefined,
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
  runTrigger: chatParserMocks.runTrigger,
}))

vi.mock('src/ts/process/tts', () => ({
  sayTTS: chatParserMocks.sayTTS,
}))

vi.mock('../../ts/alert', () => ({
  alertClear: chatParserMocks.alertClear,
  alertConfirm: chatParserMocks.alertConfirm,
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
  dispatchDeleteMessageScoped: vi.fn(),
  dispatchForkChat: vi.fn(),
  dispatchReplaceMessagesScoped: vi.fn(),
  dispatchTruncateMessagesScoped: vi.fn(),
  dispatchUpdateChatScoped: vi.fn(),
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
  getUserIcon: () => '',
  getUserName: () => 'User',
  sleep: vi.fn(async () => undefined),
}))

import ChatParserDependenciesHarness, { type ParserDependencyRow } from './Chat.parserDependenciesHarness.svelte'
import {
  DBState,
  HideIconStore,
  ReloadChatPointer,
  ReloadGUIPointer,
  SizeStore,
  selIdState,
  selectedCharID,
} from '../../ts/stores.svelte'
import {
  setServerProjectionWriteGuardEnabled,
  withTrustedServerProjectionWrite,
} from '../../ts/server/projectionWriteGuard.svelte'

type MountedComponent = Parameters<typeof unmount>[0]
type ChatHarnessApi = MountedComponent & {
  updateMessage(index: number, data: string): void
  updateName(index: number, name: string): void
  updateParserIndex(index: number, parserIdx: number): void
  updateRole(index: number, role: string): void
}

const previousDb = DBState.db
const previousSelectedChar = get(selectedCharID)
const previousReloadGui = get(ReloadGUIPointer)
const previousReloadChat = get(ReloadChatPointer)

let target: HTMLElement
let component: ChatHarnessApi | undefined

function makeRows(count: number): ParserDependencyRow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `row-${index}`,
    data: `visible message ${index}`,
    name: index % 2 === 0 ? `Parser Bot ${index}` : 'User',
    role: index % 2 === 0 ? 'char' : 'user',
  }))
}

function seedDatabase(rows: ParserDependencyRow[]) {
  selectedCharID.set(0)
  selIdState.selId = 0
  ReloadGUIPointer.set(0)
  ReloadChatPointer.set({})
  HideIconStore.set(false)
  SizeStore.set({ w: 900, h: 700 })
  DBState.db = {
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
  } as unknown as Database
  setServerProjectionWriteGuardEnabled(true)
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
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  setServerProjectionWriteGuardEnabled(false)
  DBState.db = previousDb
  selectedCharID.set(previousSelectedChar)
  selIdState.selId = previousSelectedChar
  ReloadGUIPointer.set(previousReloadGui)
  ReloadChatPointer.set(previousReloadChat)
  target.remove()
  document.body.innerHTML = ''
})

describe('Chat parser dependencies', () => {
  it('does not re-run every visible row parser on unrelated guarded projection writes', async () => {
    const rows = makeRows(4)
    seedDatabase(rows)
    mountHarness(rows)
    await settle()

    expect(chatParserMocks.risuChatParser.mock.calls.map((call) => call[0])).toEqual(rows.map((row) => row.data))
    const callsAfterMount = chatParserMocks.risuChatParser.mock.calls.length

    withTrustedServerProjectionWrite(() => {
      DBState.db.characters[0].chats[0].note = 'unrelated guarded projection write'
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
})
