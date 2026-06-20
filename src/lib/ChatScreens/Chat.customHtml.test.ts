import { flushSync, mount, tick, unmount } from 'svelte'
import { get } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '../../ts/storage/database.svelte'

const customHtmlMocks = vi.hoisted(() => {
  const templates = {
    base: 'base-template',
    changed: 'changed-template',
    luaButton: 'lua-button-template',
    triggerButton: 'trigger-button-template',
    throwing: 'throw-template',
  }

  return {
    templates,
    alertClear: vi.fn(),
    alertConfirm: vi.fn(async () => false),
    alertInput: vi.fn(async () => ''),
    alertNormal: vi.fn(),
    alertRequestData: vi.fn(),
    alertWait: vi.fn(),
    canUseServerCommands: vi.fn(() => false),
    getLLMCache: vi.fn(async () => null),
    ParseMarkdown: vi.fn(async (html: string) => html),
    risuChatParser: vi.fn(
      (message: string, arg?: { cbsConditions?: { firstmsg?: boolean; chatRole?: string | null } }) => {
        if (message === templates.throwing) {
          throw new Error('template parse failed')
        }

        if (message === templates.triggerButton) {
          return '<button class="manual-trigger-button" risu-trigger="manual-trigger" risu-id="trigger-id">Run trigger</button>'
        }

        if (message === templates.luaButton) {
          return '<button class="lua-trigger-button" risu-btn="lua-event" risu-id="lua-id">Run Lua</button>'
        }

        if (message === templates.base || message === templates.changed) {
          const cbsConditions = arg?.cbsConditions ?? {}
          return `<div class="custom-html-template" data-role="${cbsConditions.chatRole ?? ''}"><span>${message}|first=${String(cbsConditions.firstmsg ?? false)}|role=${cbsConditions.chatRole ?? 'null'}</span></div>`
        }

        return `parsed-message:${message}`
      },
    ),
    clearManualTriggerAbortController: vi.fn(),
    createManualTriggerAbortController: vi.fn(() => new AbortController()),
    runLuaButtonTrigger: vi.fn<(...args: any[]) => Promise<any>>(async () => undefined),
    runTrigger: vi.fn<(...args: any[]) => Promise<any>>(async () => undefined),
    sayTTS: vi.fn(),
    setLLMCache: vi.fn(async () => undefined),
  }
})

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
  runLuaButtonTrigger: customHtmlMocks.runLuaButtonTrigger,
}))

vi.mock('src/ts/process/scripts', () => ({
  resetScriptCache: vi.fn(),
  risuChatParser: customHtmlMocks.risuChatParser,
}))

vi.mock('../../ts/process/scripts', () => ({
  resetScriptCache: vi.fn(),
  risuChatParser: customHtmlMocks.risuChatParser,
}))

vi.mock('src/ts/process/triggers', () => ({
  clearManualTriggerAbortController: customHtmlMocks.clearManualTriggerAbortController,
  createManualTriggerAbortController: customHtmlMocks.createManualTriggerAbortController,
  runTrigger: customHtmlMocks.runTrigger,
}))

vi.mock('src/ts/process/tts', () => ({
  sayTTS: customHtmlMocks.sayTTS,
}))

vi.mock('../../ts/alert', () => ({
  alertClear: customHtmlMocks.alertClear,
  alertConfirm: customHtmlMocks.alertConfirm,
  alertInput: customHtmlMocks.alertInput,
  alertNormal: customHtmlMocks.alertNormal,
  alertRequestData: customHtmlMocks.alertRequestData,
  alertWait: customHtmlMocks.alertWait,
}))

vi.mock('../../ts/parser/parser.svelte', () => ({
  ParseMarkdown: customHtmlMocks.ParseMarkdown,
}))

vi.mock('../../ts/storage/database.svelte', () => ({
  getCurrentCharacter: vi.fn(),
  getCurrentChat: vi.fn(),
  setCurrentChat: vi.fn(),
}))

vi.mock('../../ts/translator/translator', () => ({
  getLLMCache: customHtmlMocks.getLLMCache,
  setLLMCache: customHtmlMocks.setLLMCache,
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
  dispatchUpdateChatScoped: vi.fn(),
  dispatchUpdateMessageScoped: vi.fn(),
  ensureMessageId: vi.fn((message: { chatId?: string }) => {
    message.chatId ??= 'generated-message-id'
    return message.chatId
  }),
}))

vi.mock('src/ts/server/commands', () => ({
  canUseServerCommands: customHtmlMocks.canUseServerCommands,
}))

vi.mock('src/ts/util', () => ({
  capitalize: (value: string) => value.charAt(0).toUpperCase() + value.slice(1),
  getUserIcon: () => '',
  getUserName: () => 'User',
  sleep: vi.fn(async () => undefined),
}))

import Chat from './Chat.svelte'
import {
  clearCustomHtmlTemplateMemo,
  getCustomHtmlTemplateMemoSize,
  renderCustomHtmlTemplate,
} from './ChatCustomHtmlTemplate'
import {
  DBState,
  HideIconStore,
  ReloadChatPointer,
  ReloadGUIPointer,
  SizeStore,
  selIdState,
  selectedCharID,
} from '../../ts/stores.svelte'
import { getCurrentCharacter, getCurrentChat } from '../../ts/storage/database.svelte'
import { dispatchCompatibleChatUpdateScoped } from 'src/ts/chatCommands'

type MountedComponent = Parameters<typeof unmount>[0]

const previousDb = DBState.db
const previousSelectedChar = get(selectedCharID)
const previousReloadGui = get(ReloadGUIPointer)
const previousReloadChat = get(ReloadChatPointer)

let target: HTMLElement
let components: MountedComponent[] = []
let parserCalls: Array<[string, DOMParserSupportedType]>
let NativeDOMParser: typeof DOMParser

class CountingDOMParser {
  parseFromString(markup: string, type: DOMParserSupportedType) {
    parserCalls.push([markup, type])
    return new NativeDOMParser().parseFromString(markup, type)
  }
}

function templateCalls(template: string) {
  return customHtmlMocks.risuChatParser.mock.calls.filter((call) => call[0] === template)
}

function seedDatabase(messageCount: number, guiHTML = customHtmlMocks.templates.base) {
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
        chaId: 'custom-html-character',
        chatPage: 0,
        chats: [
          {
            id: 'custom-html-chat',
            name: 'Custom HTML Chat',
            message: Array.from({ length: messageCount }, (_, index) => ({
              chatId: `message-${index}`,
              data: `visible message ${index}`,
              role: 'char',
            })),
            note: '',
            bookmarks: [],
            bookmarkNames: {},
            localLore: [],
          },
          {
            id: 'custom-html-other-chat',
            name: 'Other Chat',
            message: [
              {
                chatId: 'other-message-0',
                data: 'other chat message',
                role: 'char',
              },
            ],
            note: '',
            bookmarks: [],
            bookmarkNames: {},
            localLore: [],
          },
        ],
        image: '',
        largePortrait: false,
        name: 'Template Bot',
        ttsMode: 'none',
        type: 'character',
      },
    ],
    clickToEdit: false,
    createFolderOnBranch: false,
    enableBlockPartialEdit: false,
    enableBookmark: false,
    enableDragPartialEdit: false,
    guiHTML,
    iconsize: 100,
    instantRemove: false,
    lineHeight: 1.25,
    memoryLimitThickness: 1,
    requestInfoInsideChat: false,
    roundIcons: false,
    showFirstMessagePages: false,
    swipe: false,
    theme: 'customHTML',
    translator: '',
    translatorType: 'none',
    useChatCopy: false,
    zoomsize: 100,
  } as unknown as Database
}

function mountCustomHtmlRows(count: number, role = 'char') {
  for (let index = 0; index < count; index += 1) {
    components.push(
      mount(Chat, {
        target,
        props: {
          message: `visible message ${index}`,
          name: 'Template Bot',
          isLastMemory: false,
          idx: index,
          role,
          totalLength: count,
          firstMessage: false,
          img: '',
          rerollIcon: false,
          disabled: false,
        },
      }) as MountedComponent,
    )
  }
}

async function settle() {
  flushSync()
  for (let i = 0; i < 6; i += 1) {
    await tick()
    await Promise.resolve()
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
  components = []
  parserCalls = []
  NativeDOMParser = globalThis.DOMParser
  vi.stubGlobal('DOMParser', CountingDOMParser)
  vi.clearAllMocks()
  clearCustomHtmlTemplateMemo()
  vi.mocked(getCurrentCharacter).mockImplementation(() => DBState.db.characters?.[selIdState.selId] ?? null)
  vi.mocked(getCurrentChat).mockImplementation(() => {
    const character = DBState.db.characters?.[selIdState.selId]
    return character?.chats?.[character.chatPage] ?? null
  })
})

afterEach(() => {
  for (const component of components) {
    unmount(component)
  }
  components = []
  clearCustomHtmlTemplateMemo()
  vi.unstubAllGlobals()
  DBState.db = previousDb
  selectedCharID.set(previousSelectedChar)
  selIdState.selId = previousSelectedChar
  ReloadGUIPointer.set(previousReloadGui)
  ReloadChatPointer.set(previousReloadChat)
  target.remove()
  document.body.innerHTML = ''
})

describe('customHTML template memo', () => {
  it('L31: repeated customHTML rows share one parsed template per template version', async () => {
    seedDatabase(4)
    mountCustomHtmlRows(4)
    await settle()

    expect(templateCalls(customHtmlMocks.templates.base)).toHaveLength(1)
    expect(parserCalls).toHaveLength(1)
    expect(target.querySelectorAll('.custom-html-template')).toHaveLength(4)
    expect(target.textContent).toContain('base-template|first=false|role=char')

    customHtmlMocks.risuChatParser.mockClear()
    parserCalls = []
    ReloadGUIPointer.update((value) => value + 1)
    await settle()

    expect(templateCalls(customHtmlMocks.templates.base)).toHaveLength(0)
    expect(parserCalls).toHaveLength(0)
  })

  it('L31: guiHTML changes and cbs-condition changes invalidate the customHTML template memo', async () => {
    seedDatabase(2)
    mountCustomHtmlRows(2)
    await settle()
    customHtmlMocks.risuChatParser.mockClear()
    parserCalls = []

    DBState.db.guiHTML = customHtmlMocks.templates.changed
    await settle()

    expect(templateCalls(customHtmlMocks.templates.changed)).toHaveLength(1)
    expect(parserCalls).toHaveLength(1)
    expect(target.textContent).toContain('changed-template|first=false|role=char')

    customHtmlMocks.risuChatParser.mockClear()
    parserCalls = []
    mountCustomHtmlRows(1, 'user')
    await settle()

    expect(templateCalls(customHtmlMocks.templates.changed)).toHaveLength(1)
    expect(parserCalls).toHaveLength(1)
    expect(target.textContent).toContain('changed-template|first=false|role=user')
  })

  it('falls back to the standard message layout when customHTML has no template', async () => {
    seedDatabase(1, null as unknown as string)
    mountCustomHtmlRows(1)
    await settle()

    expect(target.querySelector('.custom-html-template')).toBeNull()
    expect(target.textContent).toContain('Template Bot')
    expect(target.textContent).toContain('parsed-message:visible message 0')
  })

  it('L31: parse failures return an empty placeholder without poisoning the memo', () => {
    const body = renderCustomHtmlTemplate(customHtmlMocks.templates.throwing, {
      firstmsg: false,
      chatRole: 'char',
    })

    expect(body.tagName).toBe('DIV')
    expect(body.childNodes).toHaveLength(0)
    expect(getCustomHtmlTemplateMemoSize()).toBe(0)
  })
})

describe('customHTML rendered button trigger freshness', () => {
  it('drops a stale risu-trigger result after the active chat switches', async () => {
    seedDatabase(1, customHtmlMocks.templates.triggerButton)
    mountCustomHtmlRows(1)
    await settle()

    const result = deferred<void>()
    customHtmlMocks.runTrigger.mockImplementation(async (_char, _mode, arg) => {
      await result.promise
      return {
        chat: {
          ...arg.chat,
          message: [{ chatId: 'message-0', data: 'stale trigger result', role: 'char' }],
        },
      }
    })

    target.querySelector<HTMLButtonElement>('.manual-trigger-button')?.click()
    await tick()

    DBState.db.characters[0].chatPage = 1
    result.resolve()
    await settle()

    expect(DBState.db.characters[0].chats[0].message[0].data).toBe('visible message 0')
    expect(DBState.db.characters[0].chats[1].message[0].data).toBe('other chat message')
    expect(dispatchCompatibleChatUpdateScoped).not.toHaveBeenCalled()
  })

  it('drops a stale risu-btn result after the active chat switches', async () => {
    seedDatabase(1, customHtmlMocks.templates.luaButton)
    mountCustomHtmlRows(1)
    await settle()

    const result = deferred<void>()
    customHtmlMocks.runLuaButtonTrigger.mockImplementation(async (_char, _event, options) => {
      await result.promise
      return {
        chat: {
          ...options.chat,
          message: [{ chatId: 'message-0', data: 'stale lua result', role: 'char' }],
        },
      }
    })

    target.querySelector<HTMLButtonElement>('.lua-trigger-button')?.click()
    await tick()

    DBState.db.characters[0].chatPage = 1
    result.resolve()
    await settle()

    expect(DBState.db.characters[0].chats[0].message[0].data).toBe('visible message 0')
    expect(DBState.db.characters[0].chats[1].message[0].data).toBe('other chat message')
    expect(dispatchCompatibleChatUpdateScoped).not.toHaveBeenCalled()
  })
})
