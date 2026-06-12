import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const moduleState = vi.hoisted(() => {
  const LLMTokenizer = {
    Unknown: 'Unknown',
    NovelList: 'NovelList',
    Claude: 'Claude',
    NovelAI: 'NovelAI',
    Mistral: 'Mistral',
    Llama: 'Llama',
    Local: 'Local',
    tiktokenO200Base: 'tiktokenO200Base',
    GoogleCloud: 'GoogleCloud',
    Gemma: 'Gemma',
    DeepSeek: 'DeepSeek',
    DeepSeekV4: 'DeepSeekV4',
    GLM4: 'GLM4',
    GLM5: 'GLM5',
    Cohere: 'Cohere',
  } as const

  return {
    db: {
      aiModel: 'google-default',
      customTokenizer: '',
      currentPluginProvider: '',
      googleClaudeTokenizing: true,
      google: { accessToken: 'test-google-key' },
      useTokenizerCaching: false,
    },
    fetchMock: vi.fn(),
    internalIDsByModel: new Map<string, string>([
      ['google-default', 'gemini-default'],
      ['google-a', 'c'],
      ['google-b', 'bc'],
    ]),
    LLMTokenizer,
  }
})

vi.mock('./storage/database.svelte', () => ({
  getCurrentCharacter: vi.fn(() => null),
  getDatabase: vi.fn(() => moduleState.db),
}))

vi.mock('./model/modellist', () => ({
  LLMTokenizer: moduleState.LLMTokenizer,
  getModelInfo: vi.fn((aiModel: string) => ({
    id: aiModel,
    internalID: moduleState.internalIDsByModel.get(aiModel) ?? aiModel,
    tokenizer: moduleState.LLMTokenizer.GoogleCloud,
  })),
}))

vi.mock('./plugins/plugins.svelte', () => ({
  pluginV2: {
    providerOptions: new Map(),
  },
}))

vi.mock('./parser/parser.svelte', () => ({
  risuChatParser: vi.fn((text: string) => text),
}))

vi.mock('./process/files/inlays', () => ({
  supportsInlayImage: vi.fn(() => false),
}))

vi.mock('./process/models/local', () => ({
  tokenizeGGUFModel: vi.fn(async () => []),
}))

vi.mock('./globalApi.svelte', () => ({
  globalFetch: vi.fn(),
}))

function tokenCountFor(text: string, modelInternalID: string): number {
  return text.length + modelInternalID.length * 100 + 1
}

function parseGoogleCloudCountRequest(input: string | URL | Request, init?: RequestInit) {
  const url = String(input)
  const modelInternalID = url.match(/\/models\/([^:]+):countTokens/)?.[1] ?? ''
  const body = JSON.parse(String(init?.body ?? '{}')) as {
    contents?: Array<{ parts?: Array<{ text?: string }> }>
  }
  return {
    modelInternalID,
    text: body.contents?.[0]?.parts?.[0]?.text ?? '',
  }
}

async function loadTokenizer() {
  return await import('./tokenizer')
}

describe('Google Cloud tokenizer cache', () => {
  beforeEach(() => {
    vi.resetModules()
    moduleState.db.aiModel = 'google-default'
    moduleState.db.useTokenizerCaching = false
    moduleState.db.googleClaudeTokenizing = true
    moduleState.fetchMock.mockReset()
    moduleState.fetchMock.mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const { modelInternalID, text } = parseGoogleCloudCountRequest(input, init)
      return {
        status: 200,
        json: async () => ({
          totalTokens: tokenCountFor(text, modelInternalID),
        }),
      }
    })
    vi.stubGlobal('fetch', moduleState.fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('L42: GoogleCloud token counts hit the bounded cache for repeated text', async () => {
    const { tokenize } = await loadTokenizer()

    await expect(tokenize('repeatable prompt')).resolves.toBe(tokenCountFor('repeatable prompt', 'gemini-default'))
    await expect(tokenize('repeatable prompt')).resolves.toBe(tokenCountFor('repeatable prompt', 'gemini-default'))

    expect(moduleState.fetchMock).toHaveBeenCalledTimes(1)
  })

  it('L42: GoogleCloud cache keys keep model and text boundaries collision-safe', async () => {
    const { tokenize } = await loadTokenizer()

    moduleState.db.aiModel = 'google-a'
    await expect(tokenize('ab')).resolves.toBe(tokenCountFor('ab', 'c'))

    moduleState.db.aiModel = 'google-b'
    await expect(tokenize('a')).resolves.toBe(tokenCountFor('a', 'bc'))

    expect(moduleState.fetchMock).toHaveBeenCalledTimes(2)
  })

  it('L42: GoogleCloud token cache evicts oldest entries and refills with the same count', async () => {
    const { GOOGLE_CLOUD_TOKENIZED_CACHE_LIMIT, tokenize } = await loadTokenizer()

    for (let i = 0; i < GOOGLE_CLOUD_TOKENIZED_CACHE_LIMIT; i += 1) {
      await tokenize(`cached-${i}`)
    }

    moduleState.fetchMock.mockClear()

    await expect(tokenize('cached-0')).resolves.toBe(tokenCountFor('cached-0', 'gemini-default'))
    expect(moduleState.fetchMock).not.toHaveBeenCalled()

    await tokenize(`cached-${GOOGLE_CLOUD_TOKENIZED_CACHE_LIMIT}`)
    expect(moduleState.fetchMock).toHaveBeenCalledTimes(1)

    moduleState.fetchMock.mockClear()

    await expect(tokenize('cached-0')).resolves.toBe(tokenCountFor('cached-0', 'gemini-default'))
    expect(moduleState.fetchMock).not.toHaveBeenCalled()

    await expect(tokenize('cached-1')).resolves.toBe(tokenCountFor('cached-1', 'gemini-default'))
    expect(moduleState.fetchMock).toHaveBeenCalledTimes(1)

    moduleState.fetchMock.mockClear()

    await expect(tokenize('cached-1')).resolves.toBe(tokenCountFor('cached-1', 'gemini-default'))
    expect(moduleState.fetchMock).not.toHaveBeenCalled()
  })
})
