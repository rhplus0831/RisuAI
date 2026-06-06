import { mount, tick, unmount } from 'svelte'
import { get } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { character, Database } from '../../ts/storage/database.svelte'
import {
  DBState,
  ReloadChatPointer,
  ReloadGUIPointer,
  VariableReloadGUIPointer,
  selectedCharID,
} from '../../ts/stores.svelte'

vi.mock('../../ts/process/modules', async (importActual) => {
  const actual = await importActual<typeof import('../../ts/process/modules')>()
  return {
    ...actual,
    getModuleAssets: () => [],
    getModuleLorebooks: () => [],
    getModuleRegexScripts: () => [],
    getModuleTriggers: () => [],
    getModules: () => [],
    moduleUpdate: () => {},
  }
})

vi.mock('../../ts/process/scriptings', async (importActual) => {
  const actual = await importActual<typeof import('../../ts/process/scriptings')>()
  return {
    ...actual,
    runLuaEditTrigger: vi.fn(async (_char: unknown, _mode: unknown, data: string) => data),
  }
})

vi.mock('../../ts/process/triggers', async (importActual) => {
  const actual = await importActual<typeof import('../../ts/process/triggers')>()
  return {
    ...actual,
    runTrigger: vi.fn(async () => undefined),
  }
})

const translateHTMLMock = vi.hoisted(() => ({
  calls: [] as unknown[][],
  implementation: async (...args: unknown[]) => String(args[0] ?? ''),
}))

vi.mock('../../ts/translator/translator', async (importActual) => {
  const actual = await importActual<typeof import('../../ts/translator/translator')>()
  return {
    ...actual,
    translateHTML: async (...args: unknown[]) => {
      translateHTMLMock.calls.push(args)
      return translateHTMLMock.implementation(...args)
    },
  }
})

const previousDb = DBState.db
const previousSelectedChar = get(selectedCharID)
const previousReloadGui = get(ReloadGUIPointer)
const previousVariableReloadGui = get(VariableReloadGUIPointer)
const previousReloadChat = get(ReloadChatPointer)
const explicitRetranslateCacheKey = '<p>explicit source body</p>'

function makeCharacter(): character {
  return {
    type: 'character',
    chaId: 'chat-body-parse-memo-char',
    name: 'Parse Memo Character',
    image: '',
    firstMessage: '',
    desc: '',
    notes: '',
    chats: [
      {
        id: 'chat-body-parse-memo-chat',
        name: 'Parse Memo Chat',
        message: [],
        note: '',
        localLore: [],
        scriptstate: {},
        fmIndex: -1,
        bookmarks: [],
        bookmarkNames: {},
      },
    ],
    chatFolders: [],
    chatPage: 0,
    viewScreen: 'none',
    bias: [],
    emotionImages: [],
    globalLore: [],
    sdData: [],
    customscript: [],
    triggerscript: [],
    utilityBot: false,
    exampleMessage: '',
    creatorNotes: '',
    systemPrompt: '',
    postHistoryInstructions: '',
    alternateGreetings: [],
    tags: [],
    creator: '',
    characterVersion: '',
    personality: '',
    scenario: '',
    firstMsgIndex: -1,
    replaceGlobalNote: '',
    additionalText: '',
    additionalAssets: [],
    virtualscript: '',
    defaultVariables: '',
  } as unknown as character
}

function seedDb(overrides: Partial<Database> = {}) {
  const char = makeCharacter()
  selectedCharID.set(0)
  ReloadChatPointer.set({})
  ReloadGUIPointer.set(0)
  VariableReloadGUIPointer.set(0)
  DBState.db = {
    characters: [char],
    characterOrder: [char.chaId],
    currentChar: 0,
    presetRegex: [],
    globalscript: [],
    modules: [],
    enabledModules: [],
    moduleIntergration: '',
    templateDefaultVariables: '',
    globalChatVariables: {},
    username: 'Parse Memo User',
    userIcon: '',
    translator: '',
    translatorInputLanguage: 'en',
    translatorType: 'none',
    autoTranslate: false,
    autoTranslateCachedOnly: false,
    translateBeforeHTMLFormatting: false,
    legacyTranslation: false,
    showTranslationLoading: false,
    newImageHandlingBeta: false,
    customQuotes: false,
    customQuotesData: ['"', '"', "'", "'"],
    blockquoteStyling: false,
    unformatQuotes: false,
    hideAllImages: false,
    dynamicAssets: false,
    dynamicAssetsEditDisplay: false,
    assetWidth: -1,
    assetMaxDifference: 3,
    legacyMediaFindings: false,
    returnCSSError: false,
    ...overrides,
  } as unknown as Database
  return char
}

async function settleRenderWork() {
  for (let i = 0; i < 8; i += 1) {
    await tick()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

async function waitForText(target: HTMLElement, expectedText: string) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await settleRenderWork()
    if ((target.textContent ?? '').includes(expectedText)) {
      return
    }
  }
  throw new Error(`Expected rendered text "${expectedText}", got "${target.textContent ?? ''}"`)
}

async function loadChatBodyWithParseSpy() {
  const parserModule = await import('../../ts/parser/parser.svelte')
  const parseSpy = vi.spyOn(parserModule, 'ParseMarkdown')
  const memoModule = await import('./ChatBodyParseMemo')
  memoModule.clearChatBodyParseMemo()
  const { default: ChatBody } = await import('./ChatBody.svelte')
  return { ChatBody, memoModule, parseSpy }
}

beforeEach(() => {
  translateHTMLMock.calls = []
  translateHTMLMock.implementation = async (...args: unknown[]) => String(args[0] ?? '')
})

function mountChatBody(
  ChatBody: Awaited<ReturnType<typeof loadChatBodyWithParseSpy>>['ChatBody'],
  target: HTMLElement,
  props: {
    msgDisplay: string
    character: string
    translated?: boolean
    retranslate?: boolean
  },
) {
  return mount(ChatBody, {
    target,
    props: {
      character: props.character,
      firstMessage: false,
      idx: 0,
      msgDisplay: props.msgDisplay,
      name: 'Parse Memo Character',
      role: 'char',
      translated: props.translated ?? false,
      translating: false,
      retranslate: props.retranslate ?? false,
      modelShortName: '',
    },
  })
}

afterEach(async () => {
  const memoModule = await import('./ChatBodyParseMemo')
  memoModule.clearChatBodyParseMemo()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  const translatorModule = await import('../../ts/translator/translator')
  await translatorModule.LLMCacheStorage.removeItem(explicitRetranslateCacheKey)
  document.body.innerHTML = ''
  DBState.db = previousDb
  selectedCharID.set(previousSelectedChar)
  ReloadChatPointer.set(previousReloadChat)
  ReloadGUIPointer.set(previousReloadGui)
  VariableReloadGUIPointer.set(previousVariableReloadGui)
})

describe('ChatBody content-keyed parse memo', () => {
  it('L40: unchanged ChatBody remount performs zero additional ParseMarkdown calls', async () => {
    const char = seedDb()
    const target = document.createElement('div')
    document.body.appendChild(target)
    const { ChatBody, parseSpy } = await loadChatBodyWithParseSpy()

    let component = mountChatBody(ChatBody, target, {
      character: char.chaId,
      msgDisplay: 'unchanged remount memo body',
    })
    await waitForText(target, 'unchanged remount memo body')
    expect(parseSpy.mock.calls.length).toBeGreaterThan(0)

    unmount(component)
    target.innerHTML = ''
    const callsBeforeRemount = parseSpy.mock.calls.length
    component = mountChatBody(ChatBody, target, {
      character: char.chaId,
      msgDisplay: 'unchanged remount memo body',
    })
    await waitForText(target, 'unchanged remount memo body')

    expect(parseSpy.mock.calls.length - callsBeforeRemount).toBe(0)
    unmount(component)
  })

  it('L40: changed ChatBody content misses the parse memo and renders the new body', async () => {
    const char = seedDb()
    const target = document.createElement('div')
    document.body.appendChild(target)
    const { ChatBody, parseSpy } = await loadChatBodyWithParseSpy()

    let component = mountChatBody(ChatBody, target, {
      character: char.chaId,
      msgDisplay: 'initial memo body',
    })
    await waitForText(target, 'initial memo body')
    unmount(component)
    target.innerHTML = ''

    const callsBeforeChange = parseSpy.mock.calls.length
    component = mountChatBody(ChatBody, target, {
      character: char.chaId,
      msgDisplay: 'changed memo body',
    })
    await waitForText(target, 'changed memo body')

    expect(parseSpy.mock.calls.length - callsBeforeChange).toBe(1)
    expect(parseSpy.mock.calls.at(-1)?.[0]).toBe('changed memo body')
    unmount(component)
  })

  it('M17/L40: cached-only LLM detection shares in-flight parse work and hits the resolved memo', async () => {
    const char = seedDb({
      autoTranslate: true,
      autoTranslateCachedOnly: true,
      translatorType: 'llm',
      translateBeforeHTMLFormatting: false,
      legacyTranslation: false,
      translator: 'ja',
    } as Partial<Database>)
    const parserModule = await import('../../ts/parser/parser.svelte')
    const parseSpy = vi
      .spyOn(parserModule, 'ParseMarkdown')
      .mockImplementation(async (data, _charArg, mode) => `parsed:${mode}:${data}`)
    const translatorModule = await import('../../ts/translator/translator')
    const getLLMCacheSpy = vi
      .spyOn(translatorModule, 'getLLMCache')
      .mockImplementation(async (text) => (text.includes('cached body') ? 'hit' : null))
    const memoModule = await import('./ChatBodyParseMemo')
    memoModule.clearChatBodyParseMemo()

    const input = {
      data: 'cached body',
      charArg: char.chaId,
      chatID: 0,
      cbsConditions: { firstmsg: false, chatRole: 'char' },
      fallbackMode: 'notrim' as const,
    }
    const first = memoModule.getChatBodyCachedOnlyLlmDecision(input)
    const second = memoModule.getChatBodyCachedOnlyLlmDecision(input)

    await expect(first).resolves.toBe(true)
    await expect(second).resolves.toBe(true)
    expect(parseSpy).toHaveBeenCalledTimes(1)
    expect(getLLMCacheSpy).toHaveBeenCalledTimes(1)

    await expect(memoModule.getChatBodyCachedOnlyLlmDecision(input)).resolves.toBe(true)
    expect(parseSpy).toHaveBeenCalledTimes(1)
    expect(getLLMCacheSpy).toHaveBeenCalledTimes(1)

    await expect(
      memoModule.getChatBodyCachedOnlyLlmDecision({
        ...input,
        data: 'uncached changed body',
      }),
    ).resolves.toBe(false)
    expect(parseSpy).toHaveBeenCalledTimes(2)
    expect(getLLMCacheSpy).toHaveBeenCalledTimes(2)
  })

  it('M17: LLM cache import and clear invalidate cached-only decisions', async () => {
    const char = seedDb({
      autoTranslate: true,
      autoTranslateCachedOnly: true,
      translatorType: 'llm',
      translateBeforeHTMLFormatting: false,
      legacyTranslation: false,
      translator: 'ja',
    } as Partial<Database>)
    const parserModule = await import('../../ts/parser/parser.svelte')
    vi.spyOn(parserModule, 'ParseMarkdown').mockImplementation(
      async (data, _charArg, mode) => `parsed:${mode}:${data}`,
    )
    const translatorModule = await import('../../ts/translator/translator')
    const setItemSpy = vi
      .spyOn(translatorModule.LLMCacheStorage, 'setItem')
      .mockImplementation(async <T>(_key: string, value: T) => value)
    const clearSpy = vi
      .spyOn(translatorModule.LLMCacheStorage, 'clear')
      .mockResolvedValue(undefined)
    const getLLMCacheSpy = vi
      .spyOn(translatorModule, 'getLLMCache')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('hit')
      .mockResolvedValueOnce(null)
    const memoModule = await import('./ChatBodyParseMemo')
    memoModule.clearChatBodyParseMemo()

    const input = {
      data: 'epoch cached body',
      charArg: char.chaId,
      chatID: 0,
      cbsConditions: { firstmsg: false, chatRole: 'char' },
      fallbackMode: 'notrim' as const,
    }
    await expect(memoModule.getChatBodyCachedOnlyLlmDecision(input)).resolves.toBe(false)
    await expect(memoModule.getChatBodyCachedOnlyLlmDecision(input)).resolves.toBe(false)
    expect(getLLMCacheSpy).toHaveBeenCalledTimes(1)

    const importEpochBefore = translatorModule.getLLMCacheMutationEpoch()
    await expect(
      translatorModule.importLLMCacheFromJSON({
        'parsed:pretranslate:epoch cached body': 'translated epoch body',
      }),
    ).resolves.toEqual({ count: 1, failed: 0 })
    expect(translatorModule.getLLMCacheMutationEpoch()).toBe(importEpochBefore + 1)

    await expect(memoModule.getChatBodyCachedOnlyLlmDecision(input)).resolves.toBe(true)
    expect(getLLMCacheSpy).toHaveBeenCalledTimes(2)
    expect(setItemSpy).toHaveBeenCalledWith(
      'parsed:pretranslate:epoch cached body',
      'translated epoch body',
    )

    const clearEpochBefore = translatorModule.getLLMCacheMutationEpoch()
    await translatorModule.clearLLMCache()
    expect(translatorModule.getLLMCacheMutationEpoch()).toBe(clearEpochBefore + 1)

    await expect(memoModule.getChatBodyCachedOnlyLlmDecision(input)).resolves.toBe(false)
    expect(getLLMCacheSpy).toHaveBeenCalledTimes(3)
    expect(clearSpy).toHaveBeenCalledTimes(1)
  })

  it('M17: explicit retranslate still calls translateHTML with regenerate enabled', async () => {
    const char = seedDb({
      autoTranslate: true,
      autoTranslateCachedOnly: true,
      translatorType: 'llm',
      translateBeforeHTMLFormatting: false,
      legacyTranslation: false,
      translator: 'ja',
    } as Partial<Database>)
    const parserModule = await import('../../ts/parser/parser.svelte')
    vi.spyOn(parserModule, 'ParseMarkdown').mockImplementation(async (data) => `<p>${data}</p>`)
    const translatorModule = await import('../../ts/translator/translator')
    await translatorModule.LLMCacheStorage.setItem(explicitRetranslateCacheKey, 'cached hit')
    translateHTMLMock.implementation = async () => 'explicit translated body'
    const memoModule = await import('./ChatBodyParseMemo')
    memoModule.clearChatBodyParseMemo()
    const { default: ChatBody } = await import('./ChatBody.svelte')
    const target = document.createElement('div')
    document.body.appendChild(target)

    const component = mountChatBody(ChatBody, target, {
      character: char.chaId,
      msgDisplay: 'explicit source body',
      translated: true,
      retranslate: true,
    })
    await waitForText(target, 'explicit translated body')

    expect(translateHTMLMock.calls).toContainEqual([
      '<p>explicit source body</p>',
      false,
      char.chaId,
      0,
      true,
    ])
    unmount(component)
  })
})
