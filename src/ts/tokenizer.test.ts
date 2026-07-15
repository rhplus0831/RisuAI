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
    requestProviderOperationMock: vi.fn(),
    providerOperationCredentialMock: vi.fn(() => ({ source: 'stored' as const })),
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

vi.mock('./server/providerOperations', () => ({
  requestProviderOperation: moduleState.requestProviderOperationMock,
  providerOperationCredential: moduleState.providerOperationCredentialMock,
}))

function tokenCountFor(text: string, modelInternalID: string): number {
  return text.length + modelInternalID.length * 100 + 1
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
    moduleState.requestProviderOperationMock.mockReset()
    moduleState.providerOperationCredentialMock.mockClear()
    moduleState.requestProviderOperationMock.mockImplementation(async (_operation, options) => {
      const input = options.input as { modelId: string; text: string }
      return { totalTokens: tokenCountFor(input.text, input.modelId) }
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('L42: GoogleCloud token counts hit the bounded cache for repeated text', async () => {
    const { tokenize } = await loadTokenizer()

    await expect(tokenize('repeatable prompt')).resolves.toBe(tokenCountFor('repeatable prompt', 'gemini-default'))
    await expect(tokenize('repeatable prompt')).resolves.toBe(tokenCountFor('repeatable prompt', 'gemini-default'))

    expect(moduleState.requestProviderOperationMock).toHaveBeenCalledTimes(1)
    expect(moduleState.requestProviderOperationMock).toHaveBeenCalledWith('google.count-tokens', {
      credential: { source: 'stored' },
      input: { modelId: 'gemini-default', text: 'repeatable prompt' },
    })
  })

  it('L42: GoogleCloud cache keys keep model and text boundaries collision-safe', async () => {
    const { tokenize } = await loadTokenizer()

    moduleState.db.aiModel = 'google-a'
    await expect(tokenize('ab')).resolves.toBe(tokenCountFor('ab', 'c'))

    moduleState.db.aiModel = 'google-b'
    await expect(tokenize('a')).resolves.toBe(tokenCountFor('a', 'bc'))

    expect(moduleState.requestProviderOperationMock).toHaveBeenCalledTimes(2)
  })

  it('L42: GoogleCloud token cache evicts oldest entries and refills with the same count', async () => {
    const { GOOGLE_CLOUD_TOKENIZED_CACHE_LIMIT, tokenize } = await loadTokenizer()

    for (let i = 0; i < GOOGLE_CLOUD_TOKENIZED_CACHE_LIMIT; i += 1) {
      await tokenize(`cached-${i}`)
    }

    moduleState.requestProviderOperationMock.mockClear()

    await expect(tokenize('cached-0')).resolves.toBe(tokenCountFor('cached-0', 'gemini-default'))
    expect(moduleState.requestProviderOperationMock).not.toHaveBeenCalled()

    await tokenize(`cached-${GOOGLE_CLOUD_TOKENIZED_CACHE_LIMIT}`)
    expect(moduleState.requestProviderOperationMock).toHaveBeenCalledTimes(1)

    moduleState.requestProviderOperationMock.mockClear()

    await expect(tokenize('cached-0')).resolves.toBe(tokenCountFor('cached-0', 'gemini-default'))
    expect(moduleState.requestProviderOperationMock).not.toHaveBeenCalled()

    await expect(tokenize('cached-1')).resolves.toBe(tokenCountFor('cached-1', 'gemini-default'))
    expect(moduleState.requestProviderOperationMock).toHaveBeenCalledTimes(1)

    moduleState.requestProviderOperationMock.mockClear()

    await expect(tokenize('cached-1')).resolves.toBe(tokenCountFor('cached-1', 'gemini-default'))
    expect(moduleState.requestProviderOperationMock).not.toHaveBeenCalled()
  })
})
