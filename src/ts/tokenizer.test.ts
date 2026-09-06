import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FASTIFY_TOKENIZER_OPTIONS } from './model/tokenizerOptions'
import type { Database } from './storage/databaseTypes'

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

  const db = {
    aiModel: 'google-default',
    customTokenizer: '',
    currentPluginProvider: '',
    googleClaudeTokenizing: true,
    google: { accessToken: 'test-google-key' },
    modelProfiles: [{ id: 'default-profile', name: 'Default', modelId: 'google-default' }] as Array<
      Record<string, unknown>
    >,
    modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'default-profile' } } as Record<string, unknown>,
    modelRuntimeDefaults: {} as Record<string, unknown>,
    useTokenizerCaching: false,
  }

  return {
    db,
    getDatabaseMock: vi.fn(() => db),
    settingsResourceState: {
      value: {} as Record<string, unknown>,
      status: 'idle' as 'idle' | 'loading' | 'ready' | 'error',
      error: null as string | null,
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
  getDatabase: moduleState.getDatabaseMock,
}))

vi.mock('./server/resourceState.svelte', () => ({
  settingsResourceState: moduleState.settingsResourceState,
}))

vi.mock('./model/modellist', () => ({
  LLMTokenizer: moduleState.LLMTokenizer,
  getModelInfo: vi.fn((aiModel: string) => ({
    id: aiModel,
    name: aiModel,
    internalID: moduleState.internalIDsByModel.get(aiModel) ?? aiModel,
    provider: 2,
    format: 5,
    flags: [],
    parameters: [],
    tokenizer: moduleState.LLMTokenizer.GoogleCloud,
  })),
}))

vi.mock('./plugins/plugins.svelte', () => ({
  isPluginRuntimeReady: () => true,
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
    moduleState.db.modelProfiles = [{ id: 'default-profile', name: 'Default', modelId: 'google-default' }]
    moduleState.db.modelRoleProfiles = { chatMain: { mode: 'profile', profileId: 'default-profile' } }
    moduleState.db.modelRuntimeDefaults = {}
    moduleState.getDatabaseMock.mockClear()
    moduleState.settingsResourceState.value = moduleState.db
    moduleState.settingsResourceState.status = 'ready'
    moduleState.settingsResourceState.error = null
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

  it('GoogleCloud token counts hit the bounded cache for repeated text', async () => {
    const { tokenize } = await loadTokenizer()

    await expect(tokenize('repeatable prompt')).resolves.toBe(tokenCountFor('repeatable prompt', 'gemini-default'))
    await expect(tokenize('repeatable prompt')).resolves.toBe(tokenCountFor('repeatable prompt', 'gemini-default'))

    expect(moduleState.requestProviderOperationMock).toHaveBeenCalledTimes(1)
    expect(moduleState.requestProviderOperationMock).toHaveBeenCalledWith('google.count-tokens', {
      credential: { source: 'stored' },
      input: { modelId: 'gemini-default', text: 'repeatable prompt' },
    })
  })

  it('GoogleCloud cache keys keep model and text boundaries collision-safe', async () => {
    const { tokenize } = await loadTokenizer()

    moduleState.db.modelProfiles = [{ id: 'profile-a', name: 'Profile A', modelId: 'google-a' }]
    moduleState.db.modelRoleProfiles = { chatMain: { mode: 'profile', profileId: 'profile-a' } }
    await expect(tokenize('ab')).resolves.toBe(tokenCountFor('ab', 'c'))

    moduleState.db.modelProfiles = [{ id: 'profile-b', name: 'Profile B', modelId: 'google-b' }]
    moduleState.db.modelRoleProfiles = { chatMain: { mode: 'profile', profileId: 'profile-b' } }
    await expect(tokenize('a')).resolves.toBe(tokenCountFor('a', 'bc'))

    expect(moduleState.requestProviderOperationMock).toHaveBeenCalledTimes(2)
  })

  it('uses the selected durable profile model instead of the conflicting flat model', async () => {
    const { tokenize } = await loadTokenizer()
    moduleState.db.aiModel = 'google-default'
    moduleState.db.useTokenizerCaching = true
    moduleState.db.modelProfiles = [
      { id: 'profile-a', name: 'Profile A', modelId: 'google-a' },
      { id: 'profile-b', name: 'Profile B', modelId: 'google-b' },
    ]
    moduleState.db.modelRoleProfiles = { chatMain: { mode: 'profile', profileId: 'profile-a' } }

    await expect(tokenize('same prompt')).resolves.toBe(tokenCountFor('same prompt', 'c'))

    moduleState.db.modelRoleProfiles = { chatMain: { mode: 'profile', profileId: 'profile-b' } }
    await expect(tokenize('same prompt')).resolves.toBe(tokenCountFor('same prompt', 'bc'))

    expect(moduleState.requestProviderOperationMock).toHaveBeenCalledTimes(2)
    expect(moduleState.requestProviderOperationMock.mock.calls.map(([, options]) => options.input.modelId)).toEqual([
      'c',
      'bc',
    ])
  })

  it('uses the ready settings owner without reading the aggregate database', async () => {
    const { tokenize } = await loadTokenizer()
    moduleState.settingsResourceState.value = {
      ...moduleState.db,
      modelProfiles: [{ id: 'owner-profile', name: 'Owner', modelId: 'google-a' }],
      modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'owner-profile' } },
    }
    moduleState.settingsResourceState.status = 'ready'

    await expect(tokenize('owner prompt')).resolves.toBe(tokenCountFor('owner prompt', 'c'))

    expect(moduleState.getDatabaseMock).not.toHaveBeenCalled()
    expect(moduleState.requestProviderOperationMock).toHaveBeenCalledWith('google.count-tokens', {
      credential: { source: 'stored' },
      input: { modelId: 'c', text: 'owner prompt' },
    })
  })

  it('fails closed when the settings owner is in error', async () => {
    const { tokenize } = await loadTokenizer()
    moduleState.settingsResourceState.status = 'error'
    moduleState.settingsResourceState.error = 'settings unavailable'

    await expect(tokenize('stale prompt')).rejects.toThrow('Tokenizer settings owner unavailable')
    expect(moduleState.getDatabaseMock).not.toHaveBeenCalled()
    expect(moduleState.requestProviderOperationMock).not.toHaveBeenCalled()
  })

  it('fails closed while the settings owner is loading', async () => {
    const { tokenize } = await loadTokenizer()
    moduleState.settingsResourceState.status = 'loading'

    await expect(tokenize('loading prompt')).rejects.toThrow('Tokenizer settings owner unavailable')
    expect(moduleState.getDatabaseMock).not.toHaveBeenCalled()
    expect(moduleState.requestProviderOperationMock).not.toHaveBeenCalled()
  })

  it('keeps an explicit captured settings snapshot usable after owner state changes', async () => {
    const { tokenize } = await loadTokenizer()
    const database = {
      ...moduleState.db,
      modelProfiles: [{ id: 'captured-profile', name: 'Captured', modelId: 'google-b' }],
      modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'captured-profile' } },
    }
    moduleState.settingsResourceState.status = 'error'
    moduleState.settingsResourceState.error = 'newer refresh failed'

    await expect(tokenize('captured prompt', database as unknown as Database)).resolves.toBe(
      tokenCountFor('captured prompt', 'bc'),
    )
    expect(moduleState.getDatabaseMock).not.toHaveBeenCalled()
  })

  it('GoogleCloud token cache evicts oldest entries and refills with the same count', async () => {
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

describe('server-backed tokenizer choices', () => {
  it('exposes every portable tokenizer identity Fastify prompt budgeting supports', () => {
    expect(FASTIFY_TOKENIZER_OPTIONS.map((option) => option.value)).toEqual([
      'tik',
      'cl100k_base',
      'o200k_base',
      'mistral',
      'llama',
      'novelai',
      'claude',
      'novellist',
      'llama3',
      'gemma',
      'cohere',
      'deepseek',
      'deepseek-v4',
      'glm4',
      'glm5',
    ])
  })
})
