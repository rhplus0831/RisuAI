import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const testState = vi.hoisted(() => {
  function makeStore<T>(initial: T) {
    let value = initial
    const subscribers = new Set<(value: T) => void>()
    return {
      subscribe(callback: (value: T) => void) {
        callback(value)
        subscribers.add(callback)
        return () => subscribers.delete(callback)
      },
      set(next: T) {
        value = next
        for (const callback of subscribers) {
          callback(value)
        }
      },
      update(updater: (value: T) => T) {
        this.set(updater(value))
      },
    }
  }

  const llmCache = new Map<string, string>()
  const storage = {
    getItem: vi.fn(async (key: string) => llmCache.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      llmCache.set(key, value)
      return value
    }),
    clear: vi.fn(async () => {
      llmCache.clear()
    }),
    iterate: vi.fn(async (callback: (value: string, key: string) => void) => {
      for (const [key, value] of llmCache.entries()) {
        callback(value, key)
      }
    }),
  }

  return {
    db: {} as any,
    doingChat: makeStore(false),
    selectedCharID: makeStore(0),
    globalFetch: vi.fn(),
    alertError: vi.fn(),
    requestChatData: vi.fn(async () => {
      throw new Error('requestChatData should not run in cached translator tests')
    }),
    processScriptFull: vi.fn(async (_char: unknown, text: string) => ({ data: text })),
    applyMarkdownToNode: vi.fn(),
    llmCache,
    storage,
  }
})

vi.mock('../storage/database.svelte', () => ({
  getDatabase: () => testState.db,
}))

vi.mock('../stores.svelte', () => ({
  selectedCharID: testState.selectedCharID,
}))

vi.mock('../process/index.svelte', () => ({
  doingChat: testState.doingChat,
}))

vi.mock('../globalApi.svelte', () => ({
  globalFetch: testState.globalFetch,
}))

vi.mock('../alert', () => ({
  alertError: testState.alertError,
}))

vi.mock('../process/request/request', () => ({
  requestChatData: testState.requestChatData,
}))

vi.mock('../parser/parser.svelte', () => ({
  applyMarkdownToNode: testState.applyMarkdownToNode,
}))

vi.mock('../process/modules', () => ({
  getModuleRegexScripts: () => [],
}))

vi.mock('../util', () => ({
  getNodetextToSentence: (node: { textContent?: string | null }) => node.textContent ?? '',
  sleep: vi.fn(async () => {}),
}))

vi.mock('../process/scripts', () => ({
  processScriptFull: testState.processScriptFull,
}))

vi.mock('localforage', () => ({
  default: {
    createInstance: () => testState.storage,
  },
}))

vi.mock('../../etc/send.mp3', () => ({
  default: 'send.mp3',
}))

import { __translatorTestHooks, setLLMCache, translateHTML } from './translator'

function resetDatabase() {
  Object.assign(testState.db, {
    translator: 'ko',
    translatorInputLanguage: 'ja',
    translatorType: 'google',
    aiModel: 'openai',
    useExperimentalGoogleTranslator: false,
    noWaitForTranslate: true,
    combineTranslation: false,
    htmlTranslation: false,
    playMessageOnTranslateEnd: false,
    deeplOptions: { freeApi: true, key: '' },
    deeplXOptions: { url: '', token: '' },
    characters: [
      {
        type: 'character',
        chaId: 'char-a',
        chatPage: 0,
        chats: [{ id: 'chat-a', message: [] }],
        customscript: [],
        virtualscript: null,
        emotionImages: [],
      },
    ],
  })
}

function stubGoogleFetch() {
  const fetchMock = vi.fn(async (input: string | URL) => {
    const url = new URL(String(input))
    const text = url.searchParams.get('q') ?? ''
    const target = url.searchParams.get('tl') ?? ''
    return {
      json: async () => [[[`translated:${target}:${text}`]]],
    }
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('translateHTML streaming guards', () => {
  beforeEach(() => {
    resetDatabase()
    testState.selectedCharID.set(0)
    testState.doingChat.set(false)
    testState.llmCache.clear()
    __translatorTestHooks.clearTranslateCache()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('M16: skips Google auto-translate work while a message is streaming', async () => {
    testState.doingChat.set(true)
    const html = '<p>streaming frame</p>'
    const fetchMock = vi.fn()
    const domParserMock = vi.fn(function () {
      throw new Error('DOMParser should not run during streaming Google translation')
    })
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})

    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('DOMParser', domParserMock)

    await expect(translateHTML(html, false, '', 0)).resolves.toBe(html)
    expect(domParserMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(consoleLog).not.toHaveBeenCalled()
  })

  it('M16: default HTML translation no longer logs source HTML or chunks', async () => {
    const fetchMock = stubGoogleFetch()
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})

    const translated = await translateHTML('<p>Hello</p><p>Again</p>', false, '', 0)

    expect(translated).toContain('translated:ko:Hello')
    expect(translated).toContain('translated:ko:Again')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(consoleLog).not.toHaveBeenCalled()
  })

  it('M16: preserves cached LLM translations during streaming', async () => {
    testState.db.translatorType = 'llm'
    testState.doingChat.set(true)
    await setLLMCache('<p>Hello</p>', '<p>Cached result</p>')
    const fetchMock = vi.fn()
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.stubGlobal('fetch', fetchMock)

    const translated = await translateHTML('<p>Hello</p>', false, '', 0)

    expect(translated).toBe('<p>Cached result</p>')
    expect(testState.requestChatData).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(consoleLog).not.toHaveBeenCalled()
  })
})
