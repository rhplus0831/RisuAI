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
    removeItem: vi.fn(async (key: string) => {
      llmCache.delete(key)
    }),
    clear: vi.fn(async () => {
      llmCache.clear()
    }),
    iterate: vi.fn(async (callback: (value: unknown, key: string) => void) => {
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
    requestProviderOperation: vi.fn(),
    providerOperationCredential: vi.fn((secret: string) =>
      secret === '__RISU_SECRET_MASKED__'
        ? { source: 'stored' }
        : secret
          ? { source: 'provided', apiKey: secret }
          : { source: 'none' },
    ),
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
  getCurrentChat: () => {
    const character = testState.db.characters?.[0]
    return character?.chats?.[character.chatPage]
  },
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

vi.mock('../server/providerOperations', () => ({
  requestProviderOperation: testState.requestProviderOperation,
  providerOperationCredential: testState.providerOperationCredential,
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
  getNodetextToSentence: (node: {
    childNodes?: NodeListOf<ChildNode>
    innerHTML?: string
    textContent?: string | null
  }) => {
    if (typeof node.innerHTML === 'string') {
      return node.innerHTML.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
    }
    if (!node.childNodes) {
      return node.textContent ?? ''
    }
    const walk = (child: ChildNode): string => {
      if (child.nodeName.toLowerCase() === 'br') {
        return '\n'
      }
      if (child.childNodes.length > 0) {
        return Array.from(child.childNodes)
          .map((nested) => walk(nested))
          .join('')
      }
      return child.textContent ?? ''
    }
    return Array.from(node.childNodes)
      .map((child) => walk(child))
      .join('')
  },
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

import { DEEPLX_DELIMITER_FALLBACK_MAX_SEGMENTS, __translatorTestHooks, setLLMCache, translateHTML } from './translator'

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
    globalscript: [],
    presetRegex: [],
    promptPresets: [],
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

  it('v4-L24: memoizes translated HTML output until the explicit signature changes', async () => {
    const fetchMock = stubGoogleFetch()
    const OriginalDOMParser = DOMParser
    const parseSpy = vi.fn()
    class SpyDOMParser extends OriginalDOMParser {
      parseFromString(string: string, type: DOMParserSupportedType) {
        parseSpy(string, type)
        return super.parseFromString(string, type)
      }
    }
    vi.stubGlobal('DOMParser', SpyDOMParser)

    const first = await translateHTML('<p>Hello</p>', false, '', 0)
    const second = await translateHTML('<p>Hello</p>', false, '', 0)
    testState.db.translator = 'fr'
    const targetChanged = await translateHTML('<p>Hello</p>', false, '', 0)
    const beforeRegenerateParseCount = parseSpy.mock.calls.length
    const regenerated = await translateHTML('<p>Hello</p>', false, '', 0, true)

    expect(first).toContain('translated:ko:Hello')
    expect(second).toBe(first)
    expect(targetChanged).toContain('translated:fr:Hello')
    expect(regenerated).toBe(targetChanged)
    expect(parseSpy).toHaveBeenCalledTimes(beforeRegenerateParseCount + 1)
    expect(parseSpy).toHaveBeenCalledTimes(3)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(__translatorTestHooks.getTranslateHTMLMemoEntries()).toHaveLength(2)
  })

  it('v4-L24: keys translated HTML memo by the active chat selected prompt regex', async () => {
    const fetchMock = stubGoogleFetch()
    testState.db.presetRegex = [
      {
        id: 'global-regex',
        type: 'editdisplay',
        in: 'GLOBAL',
        out: 'global one',
      },
    ]
    testState.db.promptPresets = [
      {
        id: 'chat-preset',
        presetRegex: [
          {
            id: 'chat-regex',
            type: 'editdisplay',
            in: 'CHAT',
            out: 'chat one',
          },
        ],
      },
    ]
    testState.db.characters[0].chats[0].generationSettings = {
      promptPresetId: 'chat-preset',
    }

    const first = await translateHTML('<p>Hello</p>', false, 'char-a', 0)
    const second = await translateHTML('<p>Hello</p>', false, 'char-a', 0)
    testState.db.presetRegex[0].out = 'global two'
    const globalChanged = await translateHTML('<p>Hello</p>', false, 'char-a', 0)
    expect(__translatorTestHooks.getTranslateHTMLMemoEntries()).toHaveLength(1)
    testState.db.promptPresets[0].presetRegex[0].out = 'chat two'
    const selectedPromptChanged = await translateHTML('<p>Hello</p>', false, 'char-a', 0)

    expect(second).toBe(first)
    expect(globalChanged).toBe(first)
    expect(selectedPromptChanged).toBe(first)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(__translatorTestHooks.getTranslateHTMLMemoEntries()).toHaveLength(2)
  })

  it('v4-L29: combineTranslation processes a multi-line paragraph as one display unit', async () => {
    testState.db.combineTranslation = true
    const fetchMock = stubGoogleFetch()
    testState.processScriptFull.mockImplementation(async (_char: unknown, text: string) => ({
      data: `display:${text}`,
    }))

    const translated = await translateHTML('<p>Line one<br>Line two<br>Line three</p>', false, '', 0)

    expect(translated).toContain('display:translated:ko:Line one')
    expect(translated).toContain('Line two')
    expect(translated).toContain('Line three')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(testState.processScriptFull).toHaveBeenCalledTimes(1)
    expect(testState.processScriptFull.mock.calls[0][1]).toBe('translated:ko:Line one\nLine two\nLine three')
  })

  it('v4-L25: reuses edit-translation regexes and reports invalid patterns once per script version', async () => {
    const fetchMock = stubGoogleFetch()
    testState.db.characters[0].customscript = [
      {
        id: 'edittrans-valid',
        comment: '',
        in: 'Hello',
        out: 'Hi',
        type: 'edittrans',
        flag: '',
        ableFlag: false,
      },
    ]

    const first = await translateHTML('<p>Hello one</p>', false, 'char-a', 0)
    const second = await translateHTML('<p>Hello two</p>', false, 'char-a', 0)

    expect(first).toContain('translated:ko:Hi one')
    expect(second).toContain('translated:ko:Hi two')
    expect(__translatorTestHooks.getEdittransRegexCacheSize()).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    testState.db.characters[0].customscript = [
      {
        id: 'edittrans-invalid',
        comment: '',
        in: '(',
        out: 'ignored',
        type: 'edittrans',
        flag: '',
        ableFlag: false,
      },
    ]
    await expect(translateHTML('<p>Invalid one</p>', false, 'char-a', 0)).rejects.toThrow()
    await expect(translateHTML('<p>Invalid two</p>', false, 'char-a', 0)).resolves.toContain(
      'translated:ko:Invalid two',
    )
    expect(__translatorTestHooks.getInvalidEdittransRegexCacheSize()).toBe(1)
  })

  it('applies global edit-translation regexes', async () => {
    const fetchMock = stubGoogleFetch()
    testState.db.globalscript = [
      {
        id: 'global-edittrans',
        comment: '',
        in: 'Hello',
        out: 'Global hello',
        type: 'edittrans',
        flag: '',
        ableFlag: false,
      },
    ]

    const translated = await translateHTML('<p>Hello world</p>', false, 'char-a', 0)

    expect(translated).toContain('translated:ko:Global hello world')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('v4-L27: caps deeplX delimiter-mismatch one-by-one fallback fanout', async () => {
    testState.db.translatorType = 'deeplX'
    testState.db.deeplXOptions.token = '__RISU_SECRET_MASKED__'
    testState.requestProviderOperation.mockImplementation(
      async (_operation: string, options: { input: { text: string } }) => ({
        data: options.input.text.includes('■') ? 'bulk mismatch' : `deeplx:${options.input.text}`,
      }),
    )
    const count = DEEPLX_DELIMITER_FALLBACK_MAX_SEGMENTS + 2
    const html = Array.from({ length: count }, (_value, index) => `<p>deepl-${index}-${'x'.repeat(700)}</p>`).join('')

    const translated = await translateHTML(html, false, '', 0)

    expect(testState.requestProviderOperation).toHaveBeenCalledTimes(2 + DEEPLX_DELIMITER_FALLBACK_MAX_SEGMENTS)
    expect(testState.requestProviderOperation).toHaveBeenCalledWith(
      'deeplx.translate',
      expect.objectContaining({ credential: { source: 'stored' } }),
    )
    expect(translated).toContain('deeplx:deepl-0')
    expect(translated).toContain(`deepl-${count - 1}`)
  })

  it('rejects instead of hanging when a queued DeepLX batch fails', async () => {
    testState.db.translatorType = 'deeplX'
    testState.requestProviderOperation.mockRejectedValue(new Error('deeplx unavailable'))
    const html = Array.from({ length: 9 }, (_value, index) => `<p>batch-${index}-${'x'.repeat(700)}</p>`).join('')

    await expect(translateHTML(html, false, '', 0)).rejects.toThrow('deeplx unavailable')
  })
})
