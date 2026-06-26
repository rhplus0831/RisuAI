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
    runServerCommand: vi.fn(
      async (input: { command: (baseRevision: number) => Promise<unknown>; rollback?: () => void }) => {
        try {
          const result = await input.command(1)
          if ((result as { status?: string } | undefined)?.status !== 'ok') {
            input.rollback?.()
          }
          return result
        } catch (error) {
          input.rollback?.()
          return {
            status: 'error',
            error: error instanceof Error ? error.message : String(error),
          }
        }
      },
    ),
    translateMessageCommand: vi.fn(async () => ({
      status: 'ok',
      revision: 2,
      event: {
        type: 'message.updated',
        revision: 2,
        resource: 'message',
        id: 'message-0',
      },
      chatId: 'custom-html-chat',
      messageId: 'message-0',
      translation: {
        source: 'raw',
        text: 'translated raw',
        sourceHash: 'a'.repeat(64),
        targetLanguage: 'ko',
        inputLanguage: 'en',
        translatorType: 'llm',
        settingsHash: 'b'.repeat(64),
        updatedAt: 123,
      },
    })),
    updateMessageCommand: vi.fn(async () => ({
      status: 'ok',
      revision: 3,
      event: {
        type: 'message.updated',
        revision: 3,
        resource: 'message',
        id: 'message-0',
      },
    })),
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
  runServerCommand: customHtmlMocks.runServerCommand,
  translateMessageCommand: customHtmlMocks.translateMessageCommand,
  updateMessageCommand: customHtmlMocks.updateMessageCommand,
}))

vi.mock('src/ts/util', () => ({
  capitalize: (value: string) => value.charAt(0).toUpperCase() + value.slice(1),
  getUserIcon: () => '',
  getUserName: () => 'User',
  sleep: vi.fn(async () => undefined),
}))

import Chat from './Chat.svelte'
import PopupList from '../UI/PopupList.svelte'
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
  popupStore,
  selIdState,
  selectedCharID,
} from '../../ts/stores.svelte'
import { getCurrentCharacter, getCurrentChat } from '../../ts/storage/database.svelte'
import {
  dispatchCompatibleChatUpdateScoped,
  dispatchForkChat,
  dispatchUpdateChatScoped,
  dispatchUpdateMessageScoped,
} from 'src/ts/chatCommands'
import { setActiveMessageTranslations } from 'src/ts/server/messageTranslationJobs'

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
  popupStore.children = null
  popupStore.openId = 0
  popupStore.mouseX = 0
  popupStore.mouseY = 0
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
    disableAutoPopupMessageEditor: true,
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

function mountCustomHtmlRows(
  count: number,
  role = 'char',
  props: Partial<{
    rerollIcon: boolean | 'dynamic'
    onReroll: () => void
    unReroll: () => void
    onNewReroll: () => void
    onSelectRerollCandidate: (index: number) => void
  }> = {},
) {
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
          ...props,
        },
      }) as MountedComponent,
    )
  }
}

function mountPopupList() {
  components.push(mount(PopupList, { target }) as MountedComponent)
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
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function buttonByText(text: string) {
  return Array.from(target.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
    button.textContent?.includes(text),
  )
}

async function openMessageActions() {
  target.querySelector<HTMLButtonElement>('.button-icon-menu')?.click()
  await settle()
}

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
  components = []
  parserCalls = []
  NativeDOMParser = globalThis.DOMParser
  vi.stubGlobal('DOMParser', CountingDOMParser)
  vi.clearAllMocks()
  customHtmlMocks.canUseServerCommands.mockReturnValue(false)
  customHtmlMocks.runServerCommand.mockImplementation(
    async (input: { command: (baseRevision: number) => Promise<unknown>; rollback?: () => void }) => {
      try {
        const result = await input.command(1)
        if ((result as { status?: string } | undefined)?.status !== 'ok') {
          input.rollback?.()
        }
        return result
      } catch (error) {
        input.rollback?.()
        return {
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        }
      }
    },
  )
  customHtmlMocks.translateMessageCommand.mockResolvedValue({
    status: 'ok',
    revision: 2,
    event: {
      type: 'message.updated',
      revision: 2,
      resource: 'message',
      id: 'message-0',
    },
    chatId: 'custom-html-chat',
    messageId: 'message-0',
    translation: {
      source: 'raw',
      text: 'translated raw',
      sourceHash: 'a'.repeat(64),
      targetLanguage: 'ko',
      inputLanguage: 'en',
      translatorType: 'llm' as const,
      settingsHash: 'b'.repeat(64),
      updatedAt: 123,
    },
  })
  customHtmlMocks.updateMessageCommand.mockResolvedValue({
    status: 'ok',
    revision: 3,
    event: {
      type: 'message.updated',
      revision: 3,
      resource: 'message',
      id: 'message-0',
    },
  })
  setActiveMessageTranslations([])
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
  popupStore.children = null
  popupStore.openId = 0
  popupStore.mouseX = 0
  popupStore.mouseY = 0
  setActiveMessageTranslations([])
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

describe('message action target freshness', () => {
  it('bookmarks the clicked message when the active chat switches before the prompt resolves', async () => {
    const pendingName = deferred<string>()
    customHtmlMocks.alertInput.mockReturnValueOnce(pendingName.promise)
    seedDatabase(1, null as unknown as string)
    DBState.db.enableBookmark = true
    mountPopupList()
    mountCustomHtmlRows(1)
    await settle()

    await openMessageActions()
    target.querySelector<HTMLButtonElement>('.button-icon-bookmark')?.click()
    DBState.db.characters[0].chatPage = 1
    pendingName.resolve('Pinned original')
    await settle()

    expect(DBState.db.characters[0].chats[0].bookmarks).toEqual(['message-0'])
    expect(DBState.db.characters[0].chats[0].bookmarkNames).toEqual({
      'message-0': 'Pinned original',
    })
    expect(DBState.db.characters[0].chats[1].bookmarks).toEqual([])
    expect(dispatchUpdateChatScoped).toHaveBeenCalledWith(
      'custom-html-chat',
      expect.objectContaining({
        bookmarks: ['message-0'],
        bookmarkNames: {
          'message-0': 'Pinned original',
        },
      }),
      expect.anything(),
    )
  })

  it('branches from the clicked chat when the active chat switches immediately after the click', async () => {
    seedDatabase(1, null as unknown as string)
    mountPopupList()
    mountCustomHtmlRows(1)
    await settle()

    await openMessageActions()
    buttonByText('branch')?.click()
    const otherChatIndex = DBState.db.characters[0].chats.findIndex((chat) => chat.id === 'custom-html-other-chat')
    DBState.db.characters[0].chatPage = otherChatIndex
    await settle()

    const branchedChat = DBState.db.characters[0].chats.find((chat) =>
      chat.message.some((message) => message.data.includes('{{specialcomment::branchedfrom::')),
    )
    expect(branchedChat?.name).toBe('Custom HTML Chat Branch')
    expect(branchedChat?.message[0].chatId).toBeTruthy()
    expect(branchedChat?.message[0].chatId).not.toBe('message-0')
    expect(branchedChat?.message.at(-1)?.data).toContain(
      '{{specialcomment::branchedfrom::custom-html-chat::Custom HTML Chat::message-0::}}',
    )
    expect(DBState.db.characters[0].chats.find((chat) => chat.id === 'custom-html-other-chat')?.message[0]).toEqual({
      chatId: 'other-message-0',
      data: 'other chat message',
      role: 'char',
    })
    expect(dispatchForkChat).toHaveBeenCalledWith(
      'custom-html-chat',
      expect.anything(),
      expect.objectContaining({
        chat: expect.objectContaining({
          name: 'Custom HTML Chat Branch',
        }),
      }),
    )
    const forkPayload = vi.mocked(dispatchForkChat).mock.calls.at(-1)?.[2] as
      | { chat: { message: Array<{ chatId?: string; data: string }> } }
      | undefined
    const forkedMessageIds = forkPayload?.chat.message.map((message) => message.chatId)
    expect(forkedMessageIds?.[0]).toBeTruthy()
    expect(forkedMessageIds).not.toContain('message-0')
    expect(new Set(forkedMessageIds).size).toBe(forkedMessageIds?.length)
    expect(forkPayload?.chat.message.at(-1)?.data).toContain(
      '{{specialcomment::branchedfrom::custom-html-chat::Custom HTML Chat::message-0::}}',
    )
  })

  it('disables the clicked message when the active chat switches immediately after the click', async () => {
    seedDatabase(1, null as unknown as string)
    mountPopupList()
    mountCustomHtmlRows(1)
    await settle()

    await openMessageActions()
    buttonByText('disableMessage')?.click()
    DBState.db.characters[0].chatPage = 1
    await settle()

    expect(DBState.db.characters[0].chats[0].message[0].disabled).toBe(true)
    expect(DBState.db.characters[0].chats[1].message[0].disabled).toBeUndefined()
    expect(dispatchUpdateMessageScoped).toHaveBeenCalledWith(
      'message-0',
      {
        disabled: true,
      },
      expect.anything(),
    )
  })

  it('disables messages above the clicked message when the active chat switches immediately after the click', async () => {
    seedDatabase(1, null as unknown as string)
    mountPopupList()
    mountCustomHtmlRows(1)
    await settle()

    await openMessageActions()
    buttonByText('disableAbove')?.click()
    DBState.db.characters[0].chatPage = 1
    await settle()

    expect(DBState.db.characters[0].chats[0].message[0].disabled).toBe('allBefore')
    expect(DBState.db.characters[0].chats[1].message[0].disabled).toBeUndefined()
    expect(dispatchUpdateMessageScoped).toHaveBeenCalledWith(
      'message-0',
      {
        disabled: 'allBefore',
      },
      expect.anything(),
    )
  })
})

describe('server raw translation controls', () => {
  it('keeps translate pending state separate from completed translation UI', async () => {
    const translation = {
      source: 'raw',
      text: 'translated raw',
      sourceHash: 'a'.repeat(64),
      targetLanguage: 'ko',
      inputLanguage: 'en',
      translatorType: 'llm' as const,
      settingsHash: 'b'.repeat(64),
      updatedAt: 123,
    }
    const pendingTranslation = deferred<{
      status: 'ok'
      revision: number
      event: {
        type: string
        revision: number
        resource: string
        id: string
      }
      chatId: string
      messageId: string
      translation: typeof translation
    }>()
    customHtmlMocks.canUseServerCommands.mockReturnValue(true)
    customHtmlMocks.translateMessageCommand.mockReturnValue(pendingTranslation.promise)
    seedDatabase(1, null as unknown as string)
    DBState.db.translator = 'configured'
    DBState.db.translatorType = 'llm'
    const onReroll = vi.fn()
    mountCustomHtmlRows(1, 'char', { rerollIcon: true, onReroll })
    await settle()

    let translateButton = target.querySelector<HTMLButtonElement>('.button-icon-translate')
    let editButton = target.querySelector<HTMLButtonElement>('.button-icon-edit')
    let deleteButton = target.querySelector<HTMLButtonElement>('.button-icon-remove')
    let rerollButton = target.querySelector<HTMLButtonElement>('.button-icon-reroll')
    expect(translateButton).not.toBeNull()
    translateButton?.click()
    await settle()

    translateButton = target.querySelector<HTMLButtonElement>('.button-icon-translate')
    editButton = target.querySelector<HTMLButtonElement>('.button-icon-edit')
    deleteButton = target.querySelector<HTMLButtonElement>('.button-icon-remove')
    rerollButton = target.querySelector<HTMLButtonElement>('.button-icon-reroll')
    expect(customHtmlMocks.translateMessageCommand).toHaveBeenCalledWith({
      baseRevision: 1,
      messageId: 'message-0',
    })
    expect(translateButton?.disabled).toBe(true)
    expect(translateButton?.getAttribute('aria-busy')).toBe('true')
    expect(editButton?.disabled).toBe(true)
    expect(deleteButton?.disabled).toBe(true)
    expect(rerollButton?.disabled).toBe(true)
    expect(translateButton?.className).not.toContain('text-blue-400')
    expect(target.textContent).toContain('visible message 0')
    expect(target.textContent).not.toContain('translated raw')
    expect(target.textContent).not.toContain('retranslate')
    expect(target.textContent).not.toContain('editTranslation')

    pendingTranslation.resolve({
      status: 'ok',
      revision: 2,
      event: {
        type: 'message.updated',
        revision: 2,
        resource: 'message',
        id: 'message-0',
      },
      chatId: 'custom-html-chat',
      messageId: 'message-0',
      translation,
    })
    await settle()

    translateButton = target.querySelector<HTMLButtonElement>('.button-icon-translate')
    editButton = target.querySelector<HTMLButtonElement>('.button-icon-edit')
    deleteButton = target.querySelector<HTMLButtonElement>('.button-icon-remove')
    rerollButton = target.querySelector<HTMLButtonElement>('.button-icon-reroll')
    expect(translateButton?.disabled).toBe(false)
    expect(translateButton?.getAttribute('aria-busy')).toBe('false')
    expect(editButton?.disabled).toBe(false)
    expect(deleteButton?.disabled).toBe(false)
    expect(rerollButton?.disabled).toBe(false)
    expect(translateButton?.className).toContain('text-blue-400')
    expect(DBState.db.characters[0].chats[0].message[0].translation).toEqual(translation)
    expect(target.textContent).toContain('translated raw')
    expect(target.textContent).toContain('retranslate')
    expect(target.textContent).toContain('editTranslation')
  })

  it('applies delayed translate success to the captured message after the active chat switches', async () => {
    const translation = {
      source: 'raw' as const,
      text: 'translated original chat',
      sourceHash: 'a'.repeat(64),
      targetLanguage: 'ko',
      inputLanguage: 'en',
      translatorType: 'llm' as const,
      settingsHash: 'b'.repeat(64),
      updatedAt: 321,
    }
    const pendingTranslation = deferred<{
      status: 'ok'
      revision: number
      event: {
        type: string
        revision: number
        resource: string
        id: string
      }
      chatId: string
      messageId: string
      translation: typeof translation
    }>()
    customHtmlMocks.canUseServerCommands.mockReturnValue(true)
    customHtmlMocks.translateMessageCommand.mockReturnValue(pendingTranslation.promise)
    seedDatabase(1, null as unknown as string)
    DBState.db.translator = 'configured'
    DBState.db.translatorType = 'llm'
    mountCustomHtmlRows(1)
    await settle()

    target.querySelector<HTMLButtonElement>('.button-icon-translate')?.click()
    await settle()
    DBState.db.characters[0].chatPage = 1

    pendingTranslation.resolve({
      status: 'ok',
      revision: 2,
      event: {
        type: 'message.updated',
        revision: 2,
        resource: 'message',
        id: 'message-0',
      },
      chatId: 'custom-html-chat',
      messageId: 'message-0',
      translation,
    })
    await settle()

    expect(customHtmlMocks.translateMessageCommand).toHaveBeenCalledWith({
      baseRevision: 1,
      messageId: 'message-0',
    })
    expect(DBState.db.characters[0].chats[0].message[0].translation).toEqual(translation)
    expect(DBState.db.characters[0].chats[1].message[0].translation).toBeUndefined()
    expect(target.textContent).toContain('visible message 0')
    expect(target.textContent).not.toContain('translated original chat')
  })

  it('rolls back a failed translation edit on the captured message after the active chat switches', async () => {
    const existingTranslation = {
      source: 'raw' as const,
      text: 'original raw translation',
      sourceHash: 'a'.repeat(64),
      targetLanguage: 'ko',
      inputLanguage: 'en',
      translatorType: 'llm' as const,
      settingsHash: 'b'.repeat(64),
      updatedAt: 123,
    }
    const otherTranslation = {
      ...existingTranslation,
      text: 'other chat raw translation',
      updatedAt: 456,
    }
    const pendingUpdate = deferred<never>()
    customHtmlMocks.canUseServerCommands.mockReturnValue(true)
    customHtmlMocks.updateMessageCommand.mockReturnValue(pendingUpdate.promise)
    seedDatabase(1, null as unknown as string)
    DBState.db.translator = 'configured'
    DBState.db.translatorType = 'llm'
    DBState.db.characters[0].chats[0].message[0].translation = existingTranslation
    DBState.db.characters[0].chats[1].message[0].translation = otherTranslation
    mountCustomHtmlRows(1)
    await settle()

    target.querySelector<HTMLButtonElement>('.button-icon-translate')?.click()
    await settle()
    buttonByText('editTranslation')?.click()
    await settle()

    const textarea = target.querySelector<HTMLTextAreaElement>('.message-edit-area')
    expect(textarea?.value).toBe('original raw translation')
    textarea!.value = 'attempted raw translation'
    textarea!.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()

    buttonByText('editTranslationSave')?.click()
    await settle()
    expect(customHtmlMocks.updateMessageCommand).toHaveBeenCalledWith({
      baseRevision: 1,
      messageId: 'message-0',
      patch: {
        translation: expect.objectContaining({
          text: 'attempted raw translation',
        }),
      },
    })
    expect(DBState.db.characters[0].chats[0].message[0].translation?.text).toBe('attempted raw translation')

    DBState.db.characters[0].chatPage = 1
    pendingUpdate.reject(new Error('update failed'))
    await settle()

    expect(DBState.db.characters[0].chats[0].message[0].translation).toEqual(existingTranslation)
    expect(DBState.db.characters[0].chats[1].message[0].translation).toEqual(otherTranslation)
    expect(target.querySelector('.message-edit-area')).toBeNull()
  })

  it('preserves server-active translation busy state across refresh and displays the completed translation', async () => {
    const translation = {
      source: 'raw' as const,
      text: 'translated after refresh',
      sourceHash: 'a'.repeat(64),
      targetLanguage: 'ko',
      inputLanguage: 'en',
      translatorType: 'llm' as const,
      settingsHash: 'b'.repeat(64),
      updatedAt: 456,
    }
    customHtmlMocks.canUseServerCommands.mockReturnValue(true)
    seedDatabase(1, null as unknown as string)
    DBState.db.translator = 'configured'
    DBState.db.translatorType = 'llm'
    setActiveMessageTranslations([{ chatId: 'custom-html-chat', messageId: 'message-0' }])
    mountCustomHtmlRows(1, 'char', { rerollIcon: true })
    await settle()

    let translateButton = target.querySelector<HTMLButtonElement>('.button-icon-translate')
    let editButton = target.querySelector<HTMLButtonElement>('.button-icon-edit')
    let deleteButton = target.querySelector<HTMLButtonElement>('.button-icon-remove')
    let rerollButton = target.querySelector<HTMLButtonElement>('.button-icon-reroll')
    expect(translateButton?.disabled).toBe(true)
    expect(translateButton?.getAttribute('aria-busy')).toBe('true')
    expect(editButton?.disabled).toBe(true)
    expect(deleteButton?.disabled).toBe(true)
    expect(rerollButton?.disabled).toBe(true)

    DBState.db.characters[0].chats[0].message[0].translation = translation
    setActiveMessageTranslations([])
    await settle()

    translateButton = target.querySelector<HTMLButtonElement>('.button-icon-translate')
    editButton = target.querySelector<HTMLButtonElement>('.button-icon-edit')
    deleteButton = target.querySelector<HTMLButtonElement>('.button-icon-remove')
    rerollButton = target.querySelector<HTMLButtonElement>('.button-icon-reroll')
    expect(translateButton?.disabled).toBe(false)
    expect(translateButton?.getAttribute('aria-busy')).toBe('false')
    expect(editButton?.disabled).toBe(false)
    expect(deleteButton?.disabled).toBe(false)
    expect(rerollButton?.disabled).toBe(false)
    expect(target.textContent).toContain('translated after refresh')
  })
})
