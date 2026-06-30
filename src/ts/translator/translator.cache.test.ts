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

  const llmCache = new Map<string, unknown>()
  const storage = {
    getItem: vi.fn(async (key: string) => llmCache.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: unknown) => {
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
    alertError: vi.fn(),
    requestChatData: vi.fn(),
    processScriptFull: vi.fn(async (_char: unknown, text: string) => ({ data: text })),
    applyMarkdownToNode: vi.fn(),
    llmCache,
    storage,
  }
})

vi.mock('../storage/database.svelte', () => ({
  getDatabase: (options: { snapshot?: boolean } = {}) =>
    options.snapshot ? JSON.parse(JSON.stringify(testState.db)) : testState.db,
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

import {
  LLM_TRANSLATE_CACHE_MAX_ENTRIES,
  TRANSLATE_CACHE_MAX_ENTRIES,
  __translatorTestHooks,
  getLLMCache,
  getCurrentTranslatorPreset,
  runInputTranslator,
  setLLMCache,
  translate,
  translateHTML,
} from './translator'
import { createTranslatorPreset } from './presets'

function resetDatabase() {
  Object.assign(testState.db, {
    translator: 'ko',
    translatorInputLanguage: 'ja',
    translatorType: 'google',
    aiModel: 'openai',
    subModel: 'echo_model',
    modelRoles: {},
    seperateModelsForAxModels: false,
    seperateModels: {
      memory: '',
      emotion: '',
      translate: '',
      otherAx: '',
      scriptMain: '',
      scriptAux: '',
    },
    customModels: [],
    useExperimentalGoogleTranslator: false,
    noWaitForTranslate: true,
    combineTranslation: false,
    htmlTranslation: false,
    playMessageOnTranslateEnd: false,
    inputTranslatorPrompt: '',
    translatorMaxResponse: 1000,
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

describe('input translation hook translator', () => {
  beforeEach(() => {
    resetDatabase()
    testState.requestChatData.mockReset()
  })

  it('routes input hook prompts through the translate model role', async () => {
    const signal = new AbortController().signal
    testState.db.inputTranslatorPrompt = 'Rewrite into English: {{slot::content}}'
    testState.db.translatorMaxResponse = 123
    testState.requestChatData.mockResolvedValueOnce({ type: 'success', result: 'translated hello' })

    await expect(runInputTranslator('hola', signal)).resolves.toBe('translated hello')

    expect(testState.requestChatData).toHaveBeenCalledWith(
      {
        formated: [
          {
            role: 'user',
            content: 'Rewrite into English: hola',
          },
        ],
        bias: {},
        useStreaming: false,
        noMultiGen: true,
        maxTokens: 123,
      },
      'translate',
      signal,
    )
  })
})

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
    expect(entries.some(([key]) => key.includes('"text":"entry-0"'))).toBe(true)
    expect(entries.some(([key]) => key.includes('"text":"entry-1"'))).toBe(true)
    expect(entries.some(([key]) => key.includes('"text":"entry-2"'))).toBe(false)
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
    const keys = __translatorTestHooks.getTranslateCacheEntries().map(([key]) => JSON.parse(key))
    expect(keys).toMatchObject([
      { reverse: false, text: 'shared text' },
      { reverse: true, text: 'shared text' },
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

  it('v4-L26: separates LLM translation cache entries by translator signature', async () => {
    testState.db.translatorType = 'llm'
    testState.requestChatData.mockImplementation(async () => ({
      type: 'success',
      result: `<p>llm:${testState.db.translator}</p>`,
    }))

    const first = await translateHTML('<p>shared llm body</p>', false, '', 0)
    __translatorTestHooks.clearTranslateHTMLMemo()
    testState.db.translator = 'fr'
    const second = await translateHTML('<p>shared llm body</p>', false, '', 0)
    __translatorTestHooks.clearTranslateHTMLMemo()
    testState.db.translator = 'ko'
    const firstAgain = await translateHTML('<p>shared llm body</p>', false, '', 0)

    expect(first).toBe('<p>llm:ko</p>')
    expect(second).toBe('<p>llm:fr</p>')
    expect(firstAgain).toBe(first)
    expect(testState.requestChatData).toHaveBeenCalledTimes(2)
  })

  it('phase5: keys LLM translation cache entries by the resolved translate profile', async () => {
    testState.db.translatorType = 'llm'
    let callCount = 0
    testState.requestChatData.mockImplementation(async () => {
      callCount += 1
      return {
        type: 'success',
        result: `<p>llm-profile-${callCount}</p>`,
      }
    })

    const first = await translateHTML('<p>same text and language</p>', false, '', 0)
    __translatorTestHooks.clearTranslateHTMLMemo()
    testState.db.modelRoles = { translate: 'openrouter' }
    const roleOverride = await translateHTML('<p>same text and language</p>', false, '', 0)
    __translatorTestHooks.clearTranslateHTMLMemo()
    testState.db.modelRoles = {}
    testState.db.seperateModelsForAxModels = true
    testState.db.seperateModels = {
      ...testState.db.seperateModels,
      translate: 'nanogpt',
    }
    const separateOverride = await translateHTML('<p>same text and language</p>', false, '', 0)
    __translatorTestHooks.clearTranslateHTMLMemo()
    testState.db.seperateModelsForAxModels = false
    testState.db.seperateModels = {
      ...testState.db.seperateModels,
      translate: '',
    }
    const firstAgain = await translateHTML('<p>same text and language</p>', false, '', 0)

    expect(first).toBe('<p>llm-profile-1</p>')
    expect(roleOverride).toBe('<p>llm-profile-2</p>')
    expect(separateOverride).toBe('<p>llm-profile-3</p>')
    expect(firstAgain).toBe(first)
    expect(testState.requestChatData).toHaveBeenCalledTimes(3)
  })

  it('phase5: omits obvious provider secrets from the translate profile cache signature', () => {
    Object.assign(testState.db, {
      translatorType: 'llm',
      subModel: 'reverse_proxy',
      customProxyRequestModel: 'safe-visible-request-model',
      forceReplaceUrl: 'https://secret-host.example/v1/chat/completions',
      proxyKey: 'sk-secret-profile-key',
      additionalParams: [['api_key', 'secret-param-value']],
    })

    const signature = __translatorTestHooks.getTranslateProfileCacheSignature()
    const currentKey = __translatorTestHooks.getCurrentLLMTranslationCacheKey('<p>secret-safe body</p>')
    const serializedSignature = JSON.stringify(signature)

    expect(serializedSignature).toContain('reverse_proxy')
    expect(serializedSignature).toContain('safe-visible-request-model')
    expect(serializedSignature).not.toContain('sk-secret-profile-key')
    expect(serializedSignature).not.toContain('secret-host.example')
    expect(serializedSignature).not.toContain('secret-param-value')
    expect(currentKey).toContain('reverse_proxy')
    expect(currentKey).not.toContain('sk-secret-profile-key')
    expect(currentKey).not.toContain('secret-host.example')
    expect(currentKey).not.toContain('secret-param-value')
  })

  it('v4-L26: manual LLM cache edits update the active signature entry', async () => {
    testState.db.translatorType = 'llm'
    testState.requestChatData.mockResolvedValue({
      type: 'success',
      result: '<p>generated translation</p>',
    })

    const generated = await translateHTML('<p>manual edit body</p>', false, '', 0)
    await setLLMCache('<p>manual edit body</p>', '<p>manual edited translation</p>')
    __translatorTestHooks.clearTranslateHTMLMemo()
    const edited = await translateHTML('<p>manual edit body</p>', false, '', 0)

    expect(generated).toBe('<p>generated translation</p>')
    expect(edited).toBe('<p>manual edited translation</p>')
    expect(testState.requestChatData).toHaveBeenCalledTimes(1)
    await expect(getLLMCache('<p>manual edit body</p>')).resolves.toBe('<p>manual edited translation</p>')
  })

  it('v4-L26: manual LLM cache edits do not shadow another translator signature', async () => {
    testState.db.translatorType = 'llm'
    testState.requestChatData.mockImplementation(async () => ({
      type: 'success',
      result: `<p>generated:${testState.db.translator}</p>`,
    }))

    await setLLMCache('<p>manual scoped body</p>', '<p>manual:ko</p>')
    await expect(getLLMCache('<p>manual scoped body</p>')).resolves.toBe('<p>manual:ko</p>')
    __translatorTestHooks.clearTranslateHTMLMemo()
    testState.db.translator = 'fr'
    await expect(getLLMCache('<p>manual scoped body</p>')).resolves.toBeNull()
    const translated = await translateHTML('<p>manual scoped body</p>', false, '', 0)

    expect(translated).toBe('<p>generated:fr</p>')
    expect(testState.requestChatData).toHaveBeenCalledTimes(1)
    __translatorTestHooks.clearTranslateHTMLMemo()
    testState.db.translator = 'ko'
    await expect(translateHTML('<p>manual scoped body</p>', false, '', 0)).resolves.toBe('<p>manual:ko</p>')
    expect(testState.requestChatData).toHaveBeenCalledTimes(1)
  })

  it('v4-L26: enforces deterministic LLM cache pruning', async () => {
    testState.db.translatorType = 'llm'
    testState.requestChatData.mockImplementation(async ({ formated }: { formated: { content: string }[] }) => ({
      type: 'success',
      result: `llm:${formated.at(-1)?.content ?? ''}`,
    }))

    for (let i = 0; i <= LLM_TRANSLATE_CACHE_MAX_ENTRIES; i++) {
      await translateHTML(`<p>llm-${i}</p>`, false, '', 0)
    }

    const cacheKeys = Array.from(testState.llmCache.keys()).filter(
      (key) => key !== '__risu_llm_translate_cache_index_v1__',
    )
    expect(cacheKeys).toHaveLength(LLM_TRANSLATE_CACHE_MAX_ENTRIES)
    expect(cacheKeys.some((key) => key.includes('<p>llm-0</p>'))).toBe(false)
    expect(cacheKeys.some((key) => key.includes(`<p>llm-${LLM_TRANSLATE_CACHE_MAX_ENTRIES}</p>`))).toBe(true)
    await expect(getLLMCache('<p>llm-0</p>')).resolves.toBeNull()
  })

  it('v4-L26: quota write failures keep translated output in a bounded volatile cache without alerting', async () => {
    testState.db.translatorType = 'llm'
    testState.requestChatData.mockResolvedValue({ type: 'success', result: '<p>paid result</p>' })
    testState.storage.setItem.mockRejectedValue(new DOMException('full', 'QuotaExceededError'))

    const first = await translateHTML('<p>quota body</p>', false, '', 0)
    __translatorTestHooks.clearTranslateHTMLMemo()
    const second = await translateHTML('<p>quota body</p>', false, '', 0)

    expect(first).toBe('<p>paid result</p>')
    expect(second).toBe(first)
    expect(testState.requestChatData).toHaveBeenCalledTimes(1)
    expect(testState.alertError).not.toHaveBeenCalled()
    expect(__translatorTestHooks.getLLMVolatileCacheEntries()).toHaveLength(1)
    expect(__translatorTestHooks.getLLMCacheWriteFailureKeys()).toHaveLength(1)

    testState.storage.setItem.mockReset()
    testState.storage.setItem.mockImplementation(async (key: string, value: unknown) => {
      testState.llmCache.set(key, value)
      return value
    })
    await setLLMCache('manual-key', 'manual-value')
    await expect(getLLMCache('manual-key')).resolves.toBe('manual-value')
  })

  it('v4-L30: current translator preset sync reads from a snapshot without mutating live legacy fields', () => {
    const presets = [
      createTranslatorPreset('Default', { prompt: 'default prompt', maxResponse: 128 }),
      createTranslatorPreset('Detailed', { prompt: 'detailed prompt', maxResponse: 256 }),
    ]
    Object.assign(testState.db, {
      translatorPrompt: 'legacy prompt',
      translatorMaxResponse: 1000,
      translatorPresets: presets,
      translatorPresetId: 1,
    })

    const preset = getCurrentTranslatorPreset()

    expect(preset).toMatchObject({ name: 'Detailed', prompt: 'detailed prompt', maxResponse: 256 })
    expect(testState.db.translatorPrompt).toBe('legacy prompt')
    expect(testState.db.translatorMaxResponse).toBe(1000)
    expect(testState.db.translatorPresets).toBe(presets)
  })

  it('v4-L30: current translator preset normalization reads from a snapshot without writing preset defaults to live DB', () => {
    Object.assign(testState.db, {
      translatorPrompt: 'legacy only prompt',
      translatorMaxResponse: 333,
      translatorPresets: undefined,
      translatorPresetId: 99,
    })

    const preset = getCurrentTranslatorPreset()

    expect(preset).toMatchObject({
      name: 'Default',
      prompt: 'legacy only prompt',
      maxResponse: 333,
    })
    expect(testState.db.translatorPresets).toBeUndefined()
    expect(testState.db.translatorPresetId).toBe(99)
    expect(testState.db.translatorPrompt).toBe('legacy only prompt')
    expect(testState.db.translatorMaxResponse).toBe(333)
  })
})
