import { flushSync, mount, tick, unmount } from 'svelte'
import { get } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '../../ts/storage/database.svelte'
import { parseBranchComment } from './branchComment'

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
    alertError: vi.fn(),
    alertInput: vi.fn(async () => ''),
    alertNormal: vi.fn(),
    alertRequestData: vi.fn(),
    alertWait: vi.fn(),
    canUseServerCommands: vi.fn(() => false),
    changeChatTo: vi.fn(),
    foldChatToMessage: vi.fn(),
    getDatabase: vi.fn(),
    getServerCommandBaseRevision: vi.fn(async () => 1),
    hydrateChatMessages: vi.fn(async (_chatId: string, _options?: { strict?: boolean; force?: boolean }) => undefined),
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
    translateMessageCommand: vi.fn(async (input: { baseRevision: number; messageId: string; jobId: string }) => ({
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
      jobId: input.jobId,
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
    getFileSrc: vi.fn(async () => ''),
    ParseMarkdown: vi.fn(async (html: string) => html),
    risuChatParser: vi.fn(
      (message: string, arg?: { cbsConditions?: { firstmsg?: boolean; chatRole?: string | null } }) => {
        if (message === templates.throwing) {
          throw new Error('template parse failed')
        }

        if (message.startsWith('{{specialcomment')) {
          return message
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
    sleep: vi.fn(async () => undefined),
    navigate: vi.fn(),
    rollbackServerBackedChatRowMetadata: vi.fn(),
    syncServerBackedChatMetadataBaselines: vi.fn(),
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
      get: (_target, property) =>
        property === 'playground'
          ? { translationRunFailed: (detail: string) => `Translation failed: ${detail}` }
          : String(property),
    },
  ),
}))

vi.mock('src/ts/globalApi.svelte', () => ({
  aiLawApplies: () => false,
  changeChatTo: customHtmlMocks.changeChatTo,
  createChatCopyName: (name: string, suffix: string) => `${name} ${suffix}`,
  foldChatToMessage: customHtmlMocks.foldChatToMessage,
  getFileSrc: customHtmlMocks.getFileSrc,
}))

vi.mock('src/ts/router', async (importActual) => {
  const actual = await importActual<typeof import('src/ts/router')>()
  return {
    ...actual,
    navigate: customHtmlMocks.navigate,
  }
})

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
  alertError: customHtmlMocks.alertError,
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
  getDatabase: customHtmlMocks.getDatabase,
  reapplyPendingPresetProjections: () => {},
  setCurrentChat: vi.fn(),
}))

vi.mock('../../ts/translator/translator', () => ({
  getLLMCache: customHtmlMocks.getLLMCache,
  setLLMCache: customHtmlMocks.setLLMCache,
}))

vi.mock('src/ts/chatCommands', () => ({
  cloneJsonValue: <T>(value: T) => JSON.parse(JSON.stringify(value)) as T,
  currentChatScopedSnapshot: vi.fn(() => {
    const character = customHtmlMocks.getDatabase().characters[0]
    const chat = character.chats[character.chatPage]
    return {
      selectedCharID: 0,
      characterId: character.chaId,
      chatId: chat.id,
      chat: JSON.parse(JSON.stringify(chat)),
    }
  }),
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
  getServerCommandBaseRevision: customHtmlMocks.getServerCommandBaseRevision,
  runServerCommand: customHtmlMocks.runServerCommand,
  translateMessageCommand: customHtmlMocks.translateMessageCommand,
  updateMessageCommand: customHtmlMocks.updateMessageCommand,
}))

vi.mock('src/ts/server/chatBridge.svelte', () => ({
  rollbackServerBackedChatRowMetadata: customHtmlMocks.rollbackServerBackedChatRowMetadata,
  syncServerBackedChatMetadataBaselines: customHtmlMocks.syncServerBackedChatMetadataBaselines,
}))

vi.mock('src/ts/server/chatMessageHydration.svelte', () => ({
  applyServerChatMessagesResource: vi.fn(() => true),
  hydrateActiveChat: vi.fn(async () => undefined),
  hydrateChatMessages: customHtmlMocks.hydrateChatMessages,
  resetChatHydration: vi.fn(),
}))

vi.mock('src/ts/util', () => ({
  capitalize: (value: string) => value.charAt(0).toUpperCase() + value.slice(1),
  getUserIcon: () => '',
  getUserName: () => 'User',
  sleep: customHtmlMocks.sleep,
}))

import Chat from './Chat.svelte'
import PopupList from '../UI/PopupList.svelte'
import {
  clearCustomHtmlTemplateMemo,
  getCustomHtmlTemplateMemoSize,
  renderCustomHtmlTemplate,
} from './ChatCustomHtmlTemplate'
import {
  CurrentTriggerIdStore,
  HideIconStore,
  ReloadChatPointer,
  ReloadGUIPointer,
  SizeStore,
  VariableReloadGUIPointer,
  popUpEditorStore,
  popupStore,
  selIdState,
  selectedCharID,
} from '../../ts/stores.svelte'
import { getCurrentCharacter, getCurrentChat } from '../../ts/storage/database.svelte'
import { getResourceDatabase, replaceResourceDatabase } from '../../ts/server/resourceState.svelte'
import {
  dispatchCompatibleChatUpdateScoped,
  dispatchForkChat,
  dispatchReplaceMessagesScoped,
  dispatchTruncateMessagesScoped,
  dispatchUpdateChatScoped,
  dispatchUpdateMessageScoped,
} from 'src/ts/chatCommands'
import {
  activeMessageTranslations,
  clearMessageTranslationJob,
  setActiveMessageTranslations,
} from 'src/ts/server/messageTranslationJobs'

const testDatabaseState = {
  get db() {
    return getResourceDatabase()
  },
  set db(value: Database) {
    replaceResourceDatabase(value)
  },
}

customHtmlMocks.getDatabase.mockImplementation(() => testDatabaseState.db)

type MountedComponent = Parameters<typeof unmount>[0]

const previousDb = getResourceDatabase({ snapshot: true })
const previousSelectedChar = get(selectedCharID)
const previousReloadGui = get(ReloadGUIPointer)
const previousReloadChat = get(ReloadChatPointer)
const previousVariableReloadGui = get(VariableReloadGUIPointer)

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
  VariableReloadGUIPointer.set(0)
  popupStore.children = null
  popupStore.openId = 0
  popupStore.mouseX = 0
  popupStore.mouseY = 0
  popUpEditorStore.open = false
  popUpEditorStore.value = ''
  popUpEditorStore.mode = 'default'
  popUpEditorStore.language = 'markdown'
  HideIconStore.set(false)
  SizeStore.set({ w: 900, h: 700 })
  testDatabaseState.db = {
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
    message: string
    isComment: boolean
    rerollIcon: boolean | 'dynamic'
    onReroll: () => void
    unReroll: () => void
    onNewReroll: () => void
    onSelectRerollCandidate: (index: number) => void
  }> = {},
  startIndex = 0,
) {
  for (let offset = 0; offset < count; offset += 1) {
    const index = startIndex + offset
    components.push(
      mount(Chat, {
        target,
        props: {
          message: `visible message ${index}`,
          name: 'Template Bot',
          isLastMemory: false,
          idx: index,
          role,
          totalLength: Math.max(count, startIndex + count),
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
  customHtmlMocks.changeChatTo.mockImplementation((idOrIndex: string | number) => {
    const character = testDatabaseState.db.characters[0]
    const chatIndex =
      typeof idOrIndex === 'number' ? idOrIndex : character.chats.findIndex((chat) => chat.id === idOrIndex)
    if (chatIndex >= 0) {
      character.chatPage = chatIndex
    }
  })
  customHtmlMocks.sleep.mockResolvedValue(undefined)
  customHtmlMocks.getFileSrc.mockResolvedValue('')
  customHtmlMocks.canUseServerCommands.mockReturnValue(false)
  vi.mocked(dispatchUpdateMessageScoped).mockReturnValue(null)
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
  customHtmlMocks.translateMessageCommand.mockImplementation(
    async (input: { baseRevision: number; messageId: string; jobId: string }) => ({
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
      jobId: input.jobId,
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
    }),
  )
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
  for (const job of get(activeMessageTranslations)) clearMessageTranslationJob(job.jobId)
  setActiveMessageTranslations([])
  clearCustomHtmlTemplateMemo()
  vi.mocked(getCurrentCharacter).mockImplementation(() => testDatabaseState.db.characters?.[selIdState.selId] ?? null)
  vi.mocked(getCurrentChat).mockImplementation(() => {
    const character = testDatabaseState.db.characters?.[selIdState.selId]
    return character?.chats?.[character.chatPage] ?? null
  })
})

afterEach(() => {
  for (const component of components) {
    unmount(component)
  }
  components = []
  clearCustomHtmlTemplateMemo()
  for (const job of get(activeMessageTranslations)) clearMessageTranslationJob(job.jobId)
  setActiveMessageTranslations([])
  vi.unstubAllGlobals()
  testDatabaseState.db = previousDb
  selectedCharID.set(previousSelectedChar)
  selIdState.selId = previousSelectedChar
  ReloadGUIPointer.set(previousReloadGui)
  ReloadChatPointer.set(previousReloadChat)
  VariableReloadGUIPointer.set(previousVariableReloadGui)
  popupStore.children = null
  popupStore.openId = 0
  popupStore.mouseX = 0
  popupStore.mouseY = 0
  popUpEditorStore.open = false
  popUpEditorStore.value = ''
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

    testDatabaseState.db.guiHTML = customHtmlMocks.templates.changed
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

  it('re-parses the customHTML template when variable or active-chat scope changes', async () => {
    seedDatabase(2)
    mountCustomHtmlRows(2)
    await settle()
    customHtmlMocks.risuChatParser.mockClear()
    parserCalls = []

    VariableReloadGUIPointer.update((value) => value + 1)
    await settle()

    expect(templateCalls(customHtmlMocks.templates.base)).toHaveLength(1)
    expect(parserCalls).toHaveLength(1)

    customHtmlMocks.risuChatParser.mockClear()
    parserCalls = []
    testDatabaseState.db.characters[0].chatPage = 1
    await settle()

    expect(templateCalls(customHtmlMocks.templates.base)).toHaveLength(1)
    expect(parserCalls).toHaveLength(1)
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
  it('hydrates the full transcript before running and persisting a manual trigger', async () => {
    seedDatabase(31, customHtmlMocks.templates.triggerButton)
    const chat = testDatabaseState.db.characters[0].chats[0]
    chat.message[0] = {
      role: 'char',
      data: '',
      isComment: true,
      disabled: true,
      __risuServerUnloadedMessage: true,
    } as unknown as (typeof chat.message)[number]
    chat.message[1] = {
      role: 'char',
      data: '',
      isComment: true,
      disabled: true,
      __risuServerUnloadedMessage: true,
    } as unknown as (typeof chat.message)[number]
    customHtmlMocks.canUseServerCommands.mockReturnValue(true)
    customHtmlMocks.hydrateChatMessages.mockImplementationOnce(async () => {
      chat.message[0] = { chatId: 'message-0', data: 'hydrated head 0', role: 'user' }
      chat.message[1] = { chatId: 'message-1', data: 'hydrated head 1', role: 'char' }
    })
    customHtmlMocks.runTrigger.mockImplementationOnce(async (_char, _mode, arg) => {
      expect(arg.chat.message[0].data).toBe('hydrated head 0')
      expect(arg.chat.message[1].data).toBe('hydrated head 1')
      return {
        chat: {
          ...arg.chat,
          message: arg.chat.message.map((message: { data: string }, index: number) =>
            index < 2 ? { ...message, data: `trigger edit ${index}` } : message,
          ),
        },
      }
    })
    mountCustomHtmlRows(1, 'char', {}, 30)
    await settle()

    target.querySelector<HTMLButtonElement>('.manual-trigger-button')?.click()
    await settle()

    expect(customHtmlMocks.hydrateChatMessages).toHaveBeenCalledWith('custom-html-chat', { strict: true })
    expect(customHtmlMocks.runTrigger).toHaveBeenCalledTimes(1)
    const appliedMessages = testDatabaseState.db.characters[0].chats[0].message
    expect(appliedMessages[0].data).toBe('trigger edit 0')
    expect(appliedMessages[1].data).toBe('trigger edit 1')
    expect(dispatchCompatibleChatUpdateScoped).toHaveBeenCalledTimes(1)
  })

  it('does not let an older trigger cleanup clear a newer manual trigger identity', async () => {
    seedDatabase(1, customHtmlMocks.templates.triggerButton)
    mountCustomHtmlRows(1)
    await settle()

    const secondTrigger = deferred<void>()
    let invocation = 0
    customHtmlMocks.runTrigger.mockImplementation(async (_char, _mode, arg) => {
      invocation += 1
      CurrentTriggerIdStore.set(arg.triggerId ?? null)
      if (invocation === 2) await secondTrigger.promise
      return undefined
    })
    CurrentTriggerIdStore.set(null)
    vi.useFakeTimers()

    try {
      const button = target.querySelector<HTMLButtonElement>('.manual-trigger-button')
      button?.click()
      await settle()
      expect(invocation).toBe(1)
      expect(get(CurrentTriggerIdStore)).toBe('trigger-id')

      button?.click()
      await settle()
      expect(invocation).toBe(2)

      await vi.advanceTimersByTimeAsync(100)
      await settle()
      expect(get(CurrentTriggerIdStore)).toBe('trigger-id')

      secondTrigger.resolve()
      await settle()
      await vi.advanceTimersByTimeAsync(100)
      await settle()
      expect(get(CurrentTriggerIdStore)).toBeNull()
    } finally {
      vi.useRealTimers()
      CurrentTriggerIdStore.set(null)
    }
  })

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

    testDatabaseState.db.characters[0].chatPage = 1
    result.resolve()
    await settle()

    expect(testDatabaseState.db.characters[0].chats[0].message[0].data).toBe('visible message 0')
    expect(testDatabaseState.db.characters[0].chats[1].message[0].data).toBe('other chat message')
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

    testDatabaseState.db.characters[0].chatPage = 1
    result.resolve()
    await settle()

    expect(testDatabaseState.db.characters[0].chats[0].message[0].data).toBe('visible message 0')
    expect(testDatabaseState.db.characters[0].chats[1].message[0].data).toBe('other chat message')
    expect(dispatchCompatibleChatUpdateScoped).not.toHaveBeenCalled()
  })

  it('bumps the variable-only reload epoch after an applied risu-btn scriptstate change', async () => {
    seedDatabase(1, customHtmlMocks.templates.luaButton)
    mountCustomHtmlRows(1)
    await settle()

    customHtmlMocks.runLuaButtonTrigger.mockImplementation(async (_char, _event, options) => ({
      chat: {
        ...options.chat,
        scriptstate: {
          ...(options.chat.scriptstate ?? {}),
          $choice: 'applied',
        },
      },
    }))
    const previousVariableEpoch = get(VariableReloadGUIPointer)

    target.querySelector<HTMLButtonElement>('.lua-trigger-button')?.click()
    await settle()

    expect(testDatabaseState.db.characters[0].chats[0].scriptstate?.$choice).toBe('applied')
    expect(get(VariableReloadGUIPointer)).toBe(previousVariableEpoch + 1)
    expect(dispatchCompatibleChatUpdateScoped).toHaveBeenCalled()
  })
})

describe('message popup editor target freshness', () => {
  it('does not write a delayed edit into the newly active chat', async () => {
    const pendingEditorWait = deferred<void>()
    customHtmlMocks.sleep.mockReturnValueOnce(pendingEditorWait.promise)
    seedDatabase(1, null as unknown as string)
    testDatabaseState.db.disableAutoPopupMessageEditor = false
    mountCustomHtmlRows(1)
    await settle()

    target.querySelector<HTMLButtonElement>('.button-icon-edit')?.click()
    await settle()

    expect(popUpEditorStore.open).toBe(true)
    expect(popUpEditorStore.value).toBe('visible message 0')

    popUpEditorStore.value = 'stale edit from original chat'
    testDatabaseState.db.characters[0].chatPage = 1
    popUpEditorStore.open = false
    pendingEditorWait.resolve()
    await settle()

    expect(testDatabaseState.db.characters[0].chats[0].message[0].data).toBe('visible message 0')
    expect(testDatabaseState.db.characters[0].chats[1].message[0].data).toBe('other chat message')
    expect(dispatchUpdateMessageScoped).not.toHaveBeenCalled()
  })
})

describe('message action target freshness', () => {
  it('settles rich copy and replaces the blocking alert when copied images cannot decode', async () => {
    const clipboard = {
      write: vi.fn(async () => undefined),
      writeText: vi.fn(async () => undefined),
    }
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(window.navigator, 'clipboard')
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: clipboard,
    })
    const imageDecodeErrors = vi.fn()

    class BrokenImage {
      crossOrigin = ''
      height = 0
      onerror: (() => void) | null = null
      onload: (() => void) | null = null
      width = 0

      set src(_value: string) {
        imageDecodeErrors()
        this.onerror?.()
      }
    }

    class DataUrlFileReader {
      onerror: (() => void) | null = null
      onload: (() => void) | null = null
      result: string | null = null

      readAsDataURL() {
        this.result = 'data:image/png;base64,Y29ycnVwdA=='
        this.onload?.()
      }
    }

    vi.stubGlobal('ClipboardItem', class ClipboardItem {})
    vi.stubGlobal('FileReader', DataUrlFileReader)
    vi.stubGlobal('Image', BrokenImage)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        blob: async () => new Blob(['corrupt image bytes'], { type: 'image/png' }),
        ok: true,
      })),
    )

    try {
      seedDatabase(1, null as unknown as string)
      testDatabaseState.db.useChatCopy = true
      testDatabaseState.db.characters[0].image = 'corrupt-avatar'
      customHtmlMocks.getFileSrc.mockResolvedValue('https://example.test/corrupt-avatar.png')
      customHtmlMocks.ParseMarkdown.mockResolvedValueOnce('<img src="https://example.test/corrupt.png">')
      mountCustomHtmlRows(1)
      await settle()

      target.querySelector<HTMLButtonElement>('.button-icon-copy')?.click()

      await vi.waitFor(() => expect(customHtmlMocks.alertNormal).toHaveBeenCalledWith('copied'))
      expect(customHtmlMocks.alertWait).toHaveBeenCalledWith('loading')
      expect(imageDecodeErrors).toHaveBeenCalledTimes(2)
      expect(clipboard.write).toHaveBeenCalledOnce()
      expect(clipboard.writeText).not.toHaveBeenCalled()
      expect(customHtmlMocks.alertWait.mock.invocationCallOrder[0]).toBeLessThan(
        customHtmlMocks.alertNormal.mock.invocationCallOrder[0],
      )
    } finally {
      if (clipboardDescriptor) {
        Object.defineProperty(window.navigator, 'clipboard', clipboardDescriptor)
      } else {
        Reflect.deleteProperty(window.navigator, 'clipboard')
      }
    }
  })

  it('clears rich-copy loading and runs the plain-text fallback only once', async () => {
    const clipboard = {
      write: vi.fn(async () => {
        throw new Error('rich clipboard unavailable')
      }),
      writeText: vi.fn(async () => undefined),
    }
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(window.navigator, 'clipboard')
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: clipboard,
    })
    vi.stubGlobal('ClipboardItem', class ClipboardItem {})

    try {
      seedDatabase(1, null as unknown as string)
      testDatabaseState.db.useChatCopy = true
      mountCustomHtmlRows(1)
      await settle()

      target.querySelector<HTMLButtonElement>('.button-icon-copy')?.click()

      await vi.waitFor(() => expect(clipboard.writeText).toHaveBeenCalledOnce())
      expect(customHtmlMocks.alertWait).toHaveBeenCalledWith('loading')
      expect(customHtmlMocks.alertClear).toHaveBeenCalledOnce()
      expect(clipboard.write).toHaveBeenCalledOnce()
    } finally {
      if (clipboardDescriptor) {
        Object.defineProperty(window.navigator, 'clipboard', clipboardDescriptor)
      } else {
        Reflect.deleteProperty(window.navigator, 'clipboard')
      }
    }
  })

  it('does not expose transcript-only actions for the synthetic greeting', async () => {
    seedDatabase(0, null as unknown as string)
    testDatabaseState.db.enableBookmark = true
    testDatabaseState.db.useChatCopy = true
    SizeStore.set({ w: 320, h: 700 })
    mountPopupList()
    components.push(
      mount(Chat, {
        target,
        props: {
          message: 'Character greeting',
          name: 'Template Bot',
          isLastMemory: false,
          idx: -1,
          role: 'char',
          totalLength: 0,
          firstMessage: true,
          img: '',
          rerollIcon: false,
          disabled: false,
        },
      }) as MountedComponent,
    )
    await settle()

    await openMessageActions()

    expect(buttonByText('copy')).toBeTruthy()
    expect(buttonByText('bookmark')).toBeUndefined()
    expect(buttonByText('branch')).toBeUndefined()
    expect(buttonByText('disableMessage')).toBeUndefined()
    expect(buttonByText('disableAbove')).toBeUndefined()
  })

  it('paints a bookmark before the server command completes', async () => {
    customHtmlMocks.canUseServerCommands.mockReturnValue(true)
    customHtmlMocks.alertInput.mockResolvedValueOnce('Pinned now')
    seedDatabase(1, null as unknown as string)
    testDatabaseState.db.enableBookmark = true
    mountPopupList()
    mountCustomHtmlRows(1)
    await settle()

    await openMessageActions()
    const bookmarkButton = target.querySelector<HTMLButtonElement>('.button-icon-bookmark')
    bookmarkButton?.click()
    await settle()

    expect(testDatabaseState.db.characters[0].chats[0].bookmarks).toEqual(['message-0'])
    expect(testDatabaseState.db.characters[0].chats[0].bookmarkNames).toEqual({
      'message-0': 'Pinned now',
    })
    popupStore.openId = 0
    await openMessageActions()
    expect(target.querySelector('.button-icon-bookmark')?.classList.contains('text-yellow-400')).toBe(true)
    expect(customHtmlMocks.syncServerBackedChatMetadataBaselines).toHaveBeenCalledOnce()
    expect(dispatchUpdateChatScoped).toHaveBeenCalled()
  })

  it('bookmarks the clicked message when the active chat switches before the prompt resolves', async () => {
    const pendingName = deferred<string>()
    customHtmlMocks.alertInput.mockReturnValueOnce(pendingName.promise)
    customHtmlMocks.canUseServerCommands.mockReturnValue(true)
    seedDatabase(1, null as unknown as string)
    testDatabaseState.db.enableBookmark = true
    mountPopupList()
    mountCustomHtmlRows(1)
    await settle()

    await openMessageActions()
    target.querySelector<HTMLButtonElement>('.button-icon-bookmark')?.click()
    testDatabaseState.db.characters[0].chatPage = 1
    pendingName.resolve('Pinned original')
    await settle()

    expect(testDatabaseState.db.characters[0].chats[0].bookmarks).toEqual(['message-0'])
    expect(testDatabaseState.db.characters[0].chats[0].bookmarkNames).toEqual({
      'message-0': 'Pinned original',
    })
    expect(testDatabaseState.db.characters[0].chats[1].bookmarks).toEqual([])
    expect(customHtmlMocks.syncServerBackedChatMetadataBaselines).toHaveBeenCalledOnce()
    expect(dispatchUpdateChatScoped).toHaveBeenCalledWith(
      'custom-html-chat',
      expect.objectContaining({
        bookmarks: ['message-0'],
        bookmarkNames: {
          'message-0': 'Pinned original',
        },
      }),
      expect.anything(),
      customHtmlMocks.rollbackServerBackedChatRowMetadata,
    )
  })

  it('selects a new branch and navigates to its canonical route', async () => {
    seedDatabase(1, null as unknown as string)
    mountPopupList()
    mountCustomHtmlRows(1)
    await settle()

    await openMessageActions()
    buttonByText('branch')?.click()
    await settle()

    const character = testDatabaseState.db.characters[0]
    const branchedChat = character.chats.find((chat) =>
      chat.message.some((message) => message.data.includes('{{specialcomment::branchedfrom::')),
    )
    expect(branchedChat?.id).toBeTruthy()
    expect(customHtmlMocks.changeChatTo).toHaveBeenCalledWith(0)
    expect(character.chats[character.chatPage].id).toBe(branchedChat?.id)
    expect(customHtmlMocks.navigate).toHaveBeenCalledWith(`/character/custom-html-character/${branchedChat?.id}`)
  })

  it('hydrates unloaded history before dispatching a server-backed branch', async () => {
    seedDatabase(3, null as unknown as string)
    customHtmlMocks.canUseServerCommands.mockReturnValue(true)
    const chat = testDatabaseState.db.characters[0].chats[0]
    chat.message = [
      { role: 'char', data: '', isComment: true, disabled: true, __risuServerUnloadedMessage: true },
      { role: 'char', data: '', isComment: true, disabled: true, __risuServerUnloadedMessage: true },
      { chatId: 'message-2', data: 'visible message 2', role: 'char' },
    ] as typeof chat.message
    customHtmlMocks.hydrateChatMessages.mockImplementationOnce(async () => {
      chat.message = [
        { chatId: 'message-0', data: 'loaded message 0', role: 'user' },
        { chatId: 'message-1', data: 'loaded message 1', role: 'char' },
        { chatId: 'message-2', data: 'visible message 2', role: 'char' },
      ]
    })
    mountPopupList()
    mountCustomHtmlRows(1, 'char', {}, 2)
    await settle()

    target.querySelector<HTMLButtonElement>('.button-icon-menu')?.click()
    await settle()
    buttonByText('branch')?.click()
    await settle()

    expect(customHtmlMocks.hydrateChatMessages).toHaveBeenCalledWith('custom-html-chat', { strict: true })
    const forkPayload = vi.mocked(dispatchForkChat).mock.calls.at(-1)?.[2] as
      | Parameters<typeof dispatchForkChat>[2]
      | undefined
    expect(forkPayload?.chat.message.slice(0, 3).map((item) => item.data)).toEqual([
      'loaded message 0',
      'loaded message 1',
      'visible message 2',
    ])
    expect(
      forkPayload?.chat.message.some(
        (item) => (item as unknown as Record<string, unknown>).__risuServerUnloadedMessage === true,
      ),
    ).toBe(false)
  })

  it('hydrates an unloaded predecessor before truncating at the visible boundary', async () => {
    seedDatabase(3, null as unknown as string)
    customHtmlMocks.canUseServerCommands.mockReturnValue(true)
    const chat = testDatabaseState.db.characters[0].chats[0]
    chat.message = [
      { role: 'char', data: '', isComment: true, disabled: true, __risuServerUnloadedMessage: true },
      { role: 'char', data: '', isComment: true, disabled: true, __risuServerUnloadedMessage: true },
      { chatId: 'message-2', data: 'visible message 2', role: 'char' },
    ] as typeof chat.message
    customHtmlMocks.hydrateChatMessages.mockImplementationOnce(async () => {
      chat.message = [
        { chatId: 'message-0', data: 'loaded message 0', role: 'user' },
        { chatId: 'message-1', data: 'loaded message 1', role: 'char' },
        { chatId: 'message-2', data: 'visible message 2', role: 'char' },
      ]
    })
    mountPopupList()
    mountCustomHtmlRows(1, 'char', {}, 2)
    await settle()

    target.querySelector<HTMLButtonElement>('.button-icon-menu')?.click()
    await settle()
    const removeButton = target.querySelector<HTMLButtonElement>('.button-icon-remove')
    expect(removeButton).toBeTruthy()
    removeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))
    await settle()

    expect(customHtmlMocks.hydrateChatMessages).toHaveBeenCalledWith('custom-html-chat', { strict: true })
    expect(dispatchTruncateMessagesScoped).toHaveBeenCalledWith('custom-html-chat', 'message-1', expect.anything())
    expect(dispatchReplaceMessagesScoped).not.toHaveBeenCalled()
  })

  it('selects a legacy branch source whose name contains delimiters and navigates to its canonical route', async () => {
    seedDatabase(1, null as unknown as string)
    const marker = '{{specialcomment::branchedfrom::custom-html-chat::Custom::HTML Chat::message-0::}}'
    const character = testDatabaseState.db.characters[0]
    character.chatPage = 1
    character.chats[1].message[0].data = marker

    mountCustomHtmlRows(1, 'char', { message: marker, isComment: true })
    await settle()

    buttonByText('branchedText')?.click()
    await settle()

    expect(customHtmlMocks.changeChatTo).toHaveBeenCalledWith('custom-html-chat')
    expect(character.chats[character.chatPage].id).toBe('custom-html-chat')
    expect(customHtmlMocks.foldChatToMessage).toHaveBeenCalledWith('message-0')
    expect(customHtmlMocks.navigate).toHaveBeenCalledWith('/character/custom-html-character/custom-html-chat')
  })

  it('hydrates a nonresident branch source before folding to its origin message', async () => {
    seedDatabase(1, null as unknown as string)
    customHtmlMocks.canUseServerCommands.mockReturnValue(true)
    const marker = '{{specialcomment::branchedfrom::custom-html-chat::Custom HTML Chat::message-0::}}'
    const character = testDatabaseState.db.characters[0]
    const sourceChat = character.chats[0]
    sourceChat.message = [
      { role: 'char', data: '', isComment: true, disabled: true, __risuServerUnloadedMessage: true },
      { chatId: 'message-tail', data: 'resident tail', role: 'char' },
    ] as typeof sourceChat.message
    character.chatPage = 1
    character.chats[1].message[0].data = marker
    const hydration = deferred<void>()
    customHtmlMocks.hydrateChatMessages.mockImplementationOnce(async () => {
      await hydration.promise
      sourceChat.message = [
        { chatId: 'message-0', data: 'loaded branch origin', role: 'user' },
        { chatId: 'message-tail', data: 'resident tail', role: 'char' },
      ]
    })

    mountCustomHtmlRows(1, 'char', { message: marker, isComment: true })
    await settle()

    buttonByText('branchedText')?.click()
    await settle()

    expect(customHtmlMocks.hydrateChatMessages).toHaveBeenCalledWith('custom-html-chat', { strict: true })
    expect(customHtmlMocks.changeChatTo).not.toHaveBeenCalled()
    expect(customHtmlMocks.foldChatToMessage).not.toHaveBeenCalled()

    hydration.resolve()
    await settle()

    expect(customHtmlMocks.changeChatTo).toHaveBeenCalledWith('custom-html-chat')
    expect(customHtmlMocks.foldChatToMessage).toHaveBeenCalledWith('message-0')
    expect(customHtmlMocks.navigate).toHaveBeenCalledWith('/character/custom-html-character/custom-html-chat')
  })

  it('branches from the clicked chat when the active chat switches immediately after the click', async () => {
    seedDatabase(1, null as unknown as string)
    const sourceChat = testDatabaseState.db.characters[0].chats[0]
    sourceChat.message[0].generationInfo = { generationId: 'message-0' }
    sourceChat.bookmarks = ['message-0', 'removed-tail']
    sourceChat.bookmarkNames = { 'message-0': 'Opening', 'removed-tail': 'Removed' }
    sourceChat.hypaV3Data = {
      summaries: [{ chatMemos: ['message-0', 'removed-tail'] }],
    } as (typeof sourceChat)['hypaV3Data']
    mountPopupList()
    mountCustomHtmlRows(1)
    await settle()

    await openMessageActions()
    buttonByText('branch')?.click()
    const otherChatIndex = testDatabaseState.db.characters[0].chats.findIndex(
      (chat) => chat.id === 'custom-html-other-chat',
    )
    testDatabaseState.db.characters[0].chatPage = otherChatIndex
    await settle()

    const branchedChat = testDatabaseState.db.characters[0].chats.find((chat) =>
      chat.message.some((message) => message.data.includes('{{specialcomment::branchedfrom::')),
    )
    expect(branchedChat?.name).toBe('Custom HTML Chat Branch')
    expect(branchedChat?.message[0].chatId).toBeTruthy()
    expect(branchedChat?.message[0].chatId).not.toBe('message-0')
    expect(branchedChat?.message.at(-1)?.data).toMatch(/^\{\{specialcomment::branchedfrom::json-v1::/)
    expect(parseBranchComment(branchedChat?.message.at(-1)?.data ?? '')).toEqual({
      sourceChatId: 'custom-html-chat',
      sourceChatName: 'Custom HTML Chat',
      sourceMessageId: 'message-0',
    })
    expect(
      testDatabaseState.db.characters[0].chats.find((chat) => chat.id === 'custom-html-other-chat')?.message[0],
    ).toEqual({
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
      | {
          chat: {
            message: Array<{ chatId?: string; data: string; generationInfo?: { generationId?: string } }>
            bookmarks?: string[]
            bookmarkNames?: Record<string, string>
            hypaV3Data?: { summaries?: Array<{ chatMemos?: string[] }> }
          }
        }
      | undefined
    const forkedMessageIds = forkPayload?.chat.message.map((message) => message.chatId)
    expect(forkedMessageIds?.[0]).toBeTruthy()
    expect(forkedMessageIds).not.toContain('message-0')
    expect(new Set(forkedMessageIds).size).toBe(forkedMessageIds?.length)
    expect(forkPayload?.chat.bookmarks).toEqual([forkedMessageIds?.[0]])
    expect(forkPayload?.chat.bookmarkNames).toEqual({ [forkedMessageIds?.[0] ?? '']: 'Opening' })
    expect(forkPayload?.chat.message[0].generationInfo?.generationId).toBe(forkedMessageIds?.[0])
    expect(forkPayload?.chat.hypaV3Data?.summaries?.[0]?.chatMemos).toEqual([forkedMessageIds?.[0]])
    expect(sourceChat.bookmarks).toEqual(['message-0', 'removed-tail'])
    expect(parseBranchComment(forkPayload?.chat.message.at(-1)?.data ?? '')).toEqual({
      sourceChatId: 'custom-html-chat',
      sourceChatName: 'Custom HTML Chat',
      sourceMessageId: 'message-0',
    })
  })

  it('disables the clicked message when the active chat switches immediately after the click', async () => {
    seedDatabase(1, null as unknown as string)
    mountPopupList()
    mountCustomHtmlRows(1)
    await settle()

    await openMessageActions()
    buttonByText('disableMessage')?.click()
    testDatabaseState.db.characters[0].chatPage = 1
    await settle()

    expect(testDatabaseState.db.characters[0].chats[0].message[0].disabled).toBe(true)
    expect(testDatabaseState.db.characters[0].chats[1].message[0].disabled).toBeUndefined()
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
    testDatabaseState.db.characters[0].chatPage = 1
    await settle()

    expect(testDatabaseState.db.characters[0].chats[0].message[0].disabled).toBe('allBefore')
    expect(testDatabaseState.db.characters[0].chats[1].message[0].disabled).toBeUndefined()
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
  it('clears a cached raw translation when the source message is edited', async () => {
    const translation = {
      source: 'raw' as const,
      text: 'obsolete translated text',
      sourceHash: 'a'.repeat(64),
      targetLanguage: 'ko',
      inputLanguage: 'en',
      translatorType: 'llm' as const,
      settingsHash: 'b'.repeat(64),
      updatedAt: 123,
    }
    customHtmlMocks.canUseServerCommands.mockReturnValue(true)
    seedDatabase(1, null as unknown as string)
    testDatabaseState.db.translator = 'configured'
    testDatabaseState.db.translatorType = 'llm'
    testDatabaseState.db.characters[0].chats[0].message[0].translation = translation
    vi.mocked(dispatchUpdateMessageScoped).mockImplementationOnce(async (_messageId, patch) => {
      Object.assign(testDatabaseState.db.characters[0].chats[0].message[0], patch)
      return {
        status: 'ok',
        revision: 2,
        event: { type: 'message.updated', revision: 2, resource: 'message', id: 'message-0' },
      }
    })
    mountCustomHtmlRows(1)
    await settle()

    target.querySelector<HTMLButtonElement>('.button-icon-translate')?.click()
    await settle()
    expect(target.textContent).toContain('obsolete translated text')

    target.querySelector<HTMLButtonElement>('.button-icon-edit')?.click()
    await settle()
    const textarea = target.querySelector<HTMLTextAreaElement>('.message-edit-area')
    expect(textarea?.value).toBe('visible message 0')
    textarea!.value = 'edited source text'
    textarea!.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()
    target.querySelector<HTMLButtonElement>('.button-icon-edit')?.click()
    await settle()

    expect(dispatchUpdateMessageScoped).toHaveBeenCalledWith(
      'message-0',
      { data: 'edited source text', translation: null },
      expect.anything(),
    )
    expect(testDatabaseState.db.characters[0].chats[0].message[0].translation).toBeNull()
    expect(target.textContent).toContain('edited source text')
    expect(target.textContent).not.toContain('obsolete translated text')

    customHtmlMocks.translateMessageCommand.mockClear()
    target.querySelector<HTMLButtonElement>('.button-icon-translate')?.click()
    await settle()
    expect(customHtmlMocks.translateMessageCommand).toHaveBeenCalledOnce()
  })

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
      jobId: string
      translation: typeof translation
    }>()
    customHtmlMocks.canUseServerCommands.mockReturnValue(true)
    customHtmlMocks.translateMessageCommand.mockReturnValue(pendingTranslation.promise)
    seedDatabase(1, null as unknown as string)
    testDatabaseState.db.translator = 'configured'
    testDatabaseState.db.translatorType = 'llm'
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
    const translationRequest = customHtmlMocks.translateMessageCommand.mock.calls[0][0]
    expect(customHtmlMocks.translateMessageCommand).toHaveBeenCalledWith({
      baseRevision: 1,
      messageId: 'message-0',
      jobId: expect.any(String),
    })
    expect(customHtmlMocks.runServerCommand).not.toHaveBeenCalled()
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
      jobId: translationRequest.jobId,
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
    expect(testDatabaseState.db.characters[0].chats[0].message[0].translation).toEqual(translation)
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
      jobId: string
      translation: typeof translation
    }>()
    customHtmlMocks.canUseServerCommands.mockReturnValue(true)
    customHtmlMocks.translateMessageCommand.mockReturnValue(pendingTranslation.promise)
    seedDatabase(1, null as unknown as string)
    testDatabaseState.db.translator = 'configured'
    testDatabaseState.db.translatorType = 'llm'
    mountCustomHtmlRows(1)
    await settle()

    target.querySelector<HTMLButtonElement>('.button-icon-translate')?.click()
    await settle()
    const translationRequest = customHtmlMocks.translateMessageCommand.mock.calls[0][0]
    testDatabaseState.db.characters[0].chatPage = 1

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
      jobId: translationRequest.jobId,
      translation,
    })
    await settle()

    expect(customHtmlMocks.translateMessageCommand).toHaveBeenCalledWith({
      baseRevision: 1,
      messageId: 'message-0',
      jobId: expect.any(String),
    })
    expect(testDatabaseState.db.characters[0].chats[0].message[0].translation).toEqual(translation)
    expect(testDatabaseState.db.characters[0].chats[1].message[0].translation).toBeUndefined()
    expect(target.textContent).toContain('visible message 0')
    expect(target.textContent).not.toContain('translated original chat')
  })

  it('routes a failed translation edit through the durable captured-message dispatcher', async () => {
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
    const pendingUpdate = deferred<{ status: 'error'; error: string }>()
    customHtmlMocks.canUseServerCommands.mockReturnValue(true)
    seedDatabase(1, null as unknown as string)
    testDatabaseState.db.translator = 'configured'
    testDatabaseState.db.translatorType = 'llm'
    testDatabaseState.db.characters[0].chats[0].message[0].translation = existingTranslation
    testDatabaseState.db.characters[0].chats[1].message[0].translation = otherTranslation
    vi.mocked(dispatchUpdateMessageScoped).mockImplementationOnce(async (_messageId, _patch, previous) => {
      const result = await pendingUpdate.promise
      testDatabaseState.db.characters[0].chats[0].message[0].translation = previous.chat.message[0].translation
      return result
    })
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
    expect(dispatchUpdateMessageScoped).toHaveBeenCalledWith(
      'message-0',
      {
        translation: expect.objectContaining({
          text: 'attempted raw translation',
        }),
      },
      expect.objectContaining({
        characterId: 'custom-html-character',
        chatId: 'custom-html-chat',
        chat: expect.objectContaining({ id: 'custom-html-chat' }),
      }),
      { optimisticPatchAlreadyApplied: true },
    )
    expect(testDatabaseState.db.characters[0].chats[0].message[0].translation?.text).toBe('attempted raw translation')

    testDatabaseState.db.characters[0].chatPage = 1
    pendingUpdate.resolve({ status: 'error', error: 'update failed' })
    await settle()

    expect(testDatabaseState.db.characters[0].chats[0].message[0].translation).toEqual(existingTranslation)
    expect(testDatabaseState.db.characters[0].chats[1].message[0].translation).toEqual(otherTranslation)
    expect(target.querySelector('.message-edit-area')).toBeNull()
  })

  it('does not let an older translation save reopen a newer completed edit', async () => {
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
    const firstSave = deferred<Awaited<NonNullable<ReturnType<typeof dispatchUpdateMessageScoped>>>>()
    const secondSave = deferred<Awaited<NonNullable<ReturnType<typeof dispatchUpdateMessageScoped>>>>()
    customHtmlMocks.canUseServerCommands.mockReturnValue(true)
    seedDatabase(1, null as unknown as string)
    testDatabaseState.db.translator = 'configured'
    testDatabaseState.db.translatorType = 'llm'
    testDatabaseState.db.characters[0].chats[0].message[0].translation = existingTranslation
    vi.mocked(dispatchUpdateMessageScoped)
      .mockImplementationOnce(() => firstSave.promise)
      .mockImplementationOnce(() => secondSave.promise)
    mountCustomHtmlRows(1)
    await settle()

    target.querySelector<HTMLButtonElement>('.button-icon-translate')?.click()
    await settle()
    buttonByText('editTranslation')?.click()
    await settle()
    let textarea = target.querySelector<HTMLTextAreaElement>('.message-edit-area')
    textarea!.value = 'translation A'
    textarea!.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()
    buttonByText('editTranslationSave')?.click()
    await settle()

    buttonByText('editTranslation')?.click()
    await settle()
    textarea = target.querySelector<HTMLTextAreaElement>('.message-edit-area')
    textarea!.value = 'translation B'
    textarea!.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()
    buttonByText('editTranslationSave')?.click()
    await settle()

    expect(testDatabaseState.db.characters[0].chats[0].message[0].translation?.text).toBe('translation B')
    expect(target.querySelector('.message-edit-area')).toBeNull()

    firstSave.resolve({
      status: 'ok',
      revision: 1,
      event: { type: 'message.updated', revision: 1, resource: 'message', id: 'message-0' },
    })
    await settle()
    expect(target.querySelector('.message-edit-area')).toBeNull()
    expect(testDatabaseState.db.characters[0].chats[0].message[0].translation?.text).toBe('translation B')

    secondSave.resolve({
      status: 'ok',
      revision: 2,
      event: { type: 'message.updated', revision: 2, resource: 'message', id: 'message-0' },
    })
    await settle()
    expect(target.querySelector('.message-edit-area')).toBeNull()
    expect(popUpEditorStore.open).toBe(false)
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
    testDatabaseState.db.translator = 'configured'
    testDatabaseState.db.translatorType = 'llm'
    setActiveMessageTranslations([
      {
        chatId: 'custom-html-chat',
        messageId: 'message-0',
        jobId: 'translation-running',
        status: 'running',
      },
    ])
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

    testDatabaseState.db.characters[0].chats[0].message[0].translation = translation
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

  it('shows the retained failure when a detached translation finishes after refresh', async () => {
    customHtmlMocks.canUseServerCommands.mockReturnValue(true)
    seedDatabase(1, null as unknown as string)
    testDatabaseState.db.translator = 'configured'
    testDatabaseState.db.translatorType = 'llm'
    setActiveMessageTranslations([
      {
        chatId: 'custom-html-chat',
        messageId: 'message-0',
        jobId: 'translation-failed',
        status: 'failed',
        error: 'provider rejected the request',
        completedAt: 456,
      },
    ])

    mountCustomHtmlRows(1, 'char', { rerollIcon: true })
    await settle()

    expect(target.textContent).toContain('Translation failed: provider rejected the request')
    expect(target.querySelector<HTMLButtonElement>('.button-icon-translate')?.disabled).toBe(false)
    expect(get(activeMessageTranslations)).toEqual([])
  })

  it('force-rehydrates a retained successful translation after refresh', async () => {
    const translation = {
      source: 'raw' as const,
      text: 'translated after terminal reattach',
      sourceHash: 'a'.repeat(64),
      targetLanguage: 'ko',
      inputLanguage: 'en',
      translatorType: 'llm' as const,
      settingsHash: 'b'.repeat(64),
      updatedAt: 789,
    }
    customHtmlMocks.canUseServerCommands.mockReturnValue(true)
    seedDatabase(1, null as unknown as string)
    testDatabaseState.db.translator = 'configured'
    testDatabaseState.db.translatorType = 'llm'
    customHtmlMocks.hydrateChatMessages.mockImplementationOnce(async () => {
      testDatabaseState.db.characters[0].chats[0].message[0].translation = translation
    })
    setActiveMessageTranslations([
      {
        chatId: 'custom-html-chat',
        messageId: 'message-0',
        jobId: 'translation-succeeded',
        status: 'succeeded',
        completedAt: 789,
      },
    ])

    mountCustomHtmlRows(1, 'char', { rerollIcon: true })
    await settle()

    expect(customHtmlMocks.hydrateChatMessages).toHaveBeenCalledWith('custom-html-chat', {
      force: true,
      strict: true,
    })
    expect(target.textContent).toContain('translated after terminal reattach')
    expect(get(activeMessageTranslations)).toEqual([])
  })

  it('retries a stale successful-translation hydration before clearing the job', async () => {
    const firstHydration = deferred<void>()
    const translation = {
      source: 'raw' as const,
      text: 'translated after hydration retry',
      sourceHash: 'a'.repeat(64),
      targetLanguage: 'ko',
      inputLanguage: 'en',
      translatorType: 'llm' as const,
      settingsHash: 'b'.repeat(64),
      updatedAt: 790,
    }
    customHtmlMocks.canUseServerCommands.mockReturnValue(true)
    seedDatabase(1, null as unknown as string)
    testDatabaseState.db.translator = 'configured'
    testDatabaseState.db.translatorType = 'llm'
    customHtmlMocks.hydrateChatMessages
      .mockImplementationOnce(() => firstHydration.promise)
      .mockImplementationOnce(async () => {
        testDatabaseState.db.characters[0].chats[0].message[0].translation = translation
      })
    setActiveMessageTranslations([
      {
        chatId: 'custom-html-chat',
        messageId: 'message-0',
        jobId: 'translation-retry',
        status: 'succeeded',
        completedAt: 790,
      },
    ])

    mountCustomHtmlRows(1, 'char', { rerollIcon: true })
    await settle()

    expect(customHtmlMocks.hydrateChatMessages).toHaveBeenCalledTimes(1)
    expect(get(activeMessageTranslations)).toEqual([
      expect.objectContaining({ jobId: 'translation-retry', status: 'succeeded' }),
    ])

    firstHydration.reject(new Error('Chat hydration incomplete for: custom-html-chat'))
    await settle()

    expect(customHtmlMocks.hydrateChatMessages).toHaveBeenCalledTimes(2)
    expect(customHtmlMocks.hydrateChatMessages).toHaveBeenNthCalledWith(2, 'custom-html-chat', {
      force: true,
      strict: true,
    })
    expect(target.textContent).toContain('translated after hydration retry')
    expect(target.textContent).not.toContain('Translation failed:')
    expect(get(activeMessageTranslations)).toEqual([])
  })

  it('does not clear a successful translation job after its row loses ownership', async () => {
    const hydration = deferred<void>()
    customHtmlMocks.canUseServerCommands.mockReturnValue(true)
    seedDatabase(1, null as unknown as string)
    testDatabaseState.db.translator = 'configured'
    testDatabaseState.db.translatorType = 'llm'
    customHtmlMocks.hydrateChatMessages.mockImplementationOnce(() => hydration.promise)
    setActiveMessageTranslations([
      {
        chatId: 'custom-html-chat',
        messageId: 'message-0',
        jobId: 'translation-old-chat',
        status: 'succeeded',
        completedAt: 791,
      },
    ])

    mountCustomHtmlRows(1, 'char', { rerollIcon: true })
    await settle()
    testDatabaseState.db.characters[0].chatPage = 1
    await settle()
    hydration.resolve()
    await settle()

    expect(customHtmlMocks.hydrateChatMessages).toHaveBeenCalledTimes(1)
    expect(get(activeMessageTranslations)).toEqual([
      expect.objectContaining({ jobId: 'translation-old-chat', status: 'succeeded' }),
    ])
    expect(target.textContent).not.toContain('Translation failed:')
  })
})
