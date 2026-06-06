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
    requestChatData: vi.fn(),
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

import { TRANSLATE_CACHE_MAX_ENTRIES, __translatorTestHooks, translate } from './translator'

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
        chats: [
          { id: 'chat-a', message: [] },
          { id: 'chat-b', message: [] },
        ],
        customscript: [],
        virtualscript: null,
        emotionImages: [],
      },
    ],
  })
}

function stubGoogleFetch() {
  const seen = new Map<string, number>()
  const fetchMock = vi.fn(async (input: string | URL) => {
    const url = new URL(String(input))
    const text = url.searchParams.get('q') ?? ''
    const target = url.searchParams.get('tl') ?? ''
    const key = `${target}:${text}`
    const count = (seen.get(key) ?? 0) + 1
    seen.set(key, count)
    return {
      json: async () => [[[`translated:${key}:${count}`]]],
    }
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('auto-translate cache', () => {
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

  it('M15: dedupes repeated and concurrent translation lookups', async () => {
    const fetchMock = stubGoogleFetch()

    const [first, second] = await Promise.all([
      translate('same pending line', false),
      translate('same pending line', false),
    ])
    const third = await translate('same pending line', false)

    expect(first).toBe('translated:ko:same pending line:1')
    expect(second).toBe(first)
    expect(third).toBe(first)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(__translatorTestHooks.getTranslateCacheEntries()).toHaveLength(1)
  })

  it('M15: reuses cached translations, refreshes hits, and deterministically evicts the oldest cold entry', async () => {
    const fetchMock = stubGoogleFetch()

    for (let i = 0; i < TRANSLATE_CACHE_MAX_ENTRIES; i++) {
      await translate(`entry-${i}`, false)
    }

    await translate('entry-0', false)
    await translate(`entry-${TRANSLATE_CACHE_MAX_ENTRIES}`, false)
    await translate('entry-1', false)
    await translate('entry-0', false)

    expect(fetchMock).toHaveBeenCalledTimes(TRANSLATE_CACHE_MAX_ENTRIES + 2)
    const entries = __translatorTestHooks.getTranslateCacheEntries()
    expect(entries).toHaveLength(TRANSLATE_CACHE_MAX_ENTRIES)
    expect(entries.some(([key]) => key.endsWith(':entry-0'))).toBe(true)
    expect(entries.some(([key]) => key.endsWith(':entry-1'))).toBe(true)
    expect(entries.some(([key]) => key.endsWith(':entry-2'))).toBe(false)
  })

  it('M15: keeps forward and reverse translation cache keys separate', async () => {
    const fetchMock = stubGoogleFetch()

    const forward = await translate('shared text', false)
    const reverse = await translate('shared text', true)
    const forwardHit = await translate('shared text', false)
    const reverseHit = await translate('shared text', true)

    expect(forward).toBe('translated:ko:shared text:1')
    expect(reverse).toBe('translated:en:shared text:1')
    expect(forwardHit).toBe(forward)
    expect(reverseHit).toBe(reverse)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(__translatorTestHooks.getTranslateCacheEntries().map(([key]) => key)).toEqual([
      '0:shared text',
      '1:shared text',
    ])
  })

  it('M15: clears the auto-translate cache when the active chat changes', async () => {
    const fetchMock = stubGoogleFetch()

    const first = await translate('scoped text', false)
    const firstHit = await translate('scoped text', false)
    testState.db.characters[0].chatPage = 1
    const secondChat = await translate('scoped text', false)
    testState.db.characters[0].chatPage = 0
    const firstChatAgain = await translate('scoped text', false)

    expect(first).toBe('translated:ko:scoped text:1')
    expect(firstHit).toBe(first)
    expect(secondChat).toBe('translated:ko:scoped text:2')
    expect(firstChatAgain).toBe('translated:ko:scoped text:3')
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(__translatorTestHooks.getTranslateCacheEntries()).toHaveLength(1)
  })
})
