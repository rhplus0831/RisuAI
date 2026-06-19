import { describe, expect, it } from 'vitest'
import type { Database } from '../storage/database.svelte'
import { LLMFlags, LLMFormat, LLMProvider, LLMTokenizer, OpenAIParameters, type LLMModel } from './types'
import {
  buildProfileProviderCapabilityInput,
  resolveLegacyFallbackRefs,
  resolveModelProfile,
  resolveProfileRequestModel,
} from './modelProfileResolver'

function db(overrides: Partial<Database> = {}): Database {
  return {
    aiModel: 'gpt-5',
    subModel: 'gpt-5-mini',
    modelRoles: {},
    seperateModelsForAxModels: false,
    seperateModels: {},
    fallbackModels: {},
    customModels: [],
    modelTools: [],
    temperature: 50,
    frequencyPenalty: -1000,
    PresensePenalty: -1000,
    maxContext: 8192,
    maxResponse: 512,
    useStreaming: true,
    genTime: 1,
    extractJson: '',
    OaiCompAPIKeys: {},
    openrouterProvider: { order: [], only: [], ignore: [] },
    ...overrides,
  } as unknown as Database
}

function modelInfo(overrides: Partial<LLMModel>): LLMModel {
  return {
    id: 'test-model',
    name: 'Test Model',
    provider: LLMProvider.OpenAI,
    format: LLMFormat.OpenAICompatible,
    flags: [LLMFlags.hasStreaming],
    parameters: OpenAIParameters,
    tokenizer: LLMTokenizer.Unknown,
    ...overrides,
  }
}

describe('resolveModelProfile legacy role compatibility', () => {
  it('uses aiModel/subModel for chat roles and modelRoles only for non-chat roles', () => {
    const database = db({
      aiModel: 'main-model',
      subModel: 'aux-model',
      modelRoles: {
        chatMain: 'ignored-main',
        chatAux: 'ignored-aux',
        memory: 'memory-role-model',
      } as Database['modelRoles'],
    })
    const lookupModelInfo = (_database: Database, id: string) =>
      modelInfo({ id, name: id, internalID: id, flags: [LLMFlags.hasFullSystemPrompt] })

    expect(resolveModelProfile({ database, role: 'chatMain', lookupModelInfo }).modelId).toBe('main-model')
    expect(resolveModelProfile({ database, role: 'chatAux', lookupModelInfo }).modelId).toBe('aux-model')

    const memory = resolveModelProfile({ database, role: 'memory', lookupModelInfo })
    expect(memory.modelId).toBe('memory-role-model')
    expect(memory.source).toMatchObject({
      kind: 'legacy-modelRoles',
      field: 'modelRoles.memory',
      bypassesRoleResolution: false,
    })
  })

  it('uses a durable profile binding with a selected model over flat aiModel', () => {
    const database = db({
      aiModel: 'flat-main-model',
      modelProfiles: [{ id: ' durable-main ', name: ' Durable Main ', modelId: ' durable-selected-model ' }],
      modelRoleProfiles: {
        chatMain: { mode: 'profile', profileId: ' durable-main ' },
      },
    } as Partial<Database>)
    const lookupModelInfo = (_database: Database, id: string) => modelInfo({ id, name: id, internalID: id })

    const profile = resolveModelProfile({ database, role: 'chatMain', lookupModelInfo })

    expect(profile.modelId).toBe('durable-selected-model')
    expect(profile.profileId).toBe('durable-main')
    expect(profile.legacy).toBe(true)
    expect(profile.source).toMatchObject({
      kind: 'durable-profile',
      field: 'modelRoleProfiles.chatMain',
      profileId: 'durable-main',
      profileName: 'Durable Main',
      bypassesRoleResolution: false,
    })
  })

  it('lets staticModel win over a durable profile binding', () => {
    const database = db({
      aiModel: 'flat-main-model',
      openrouterKey: 'or-key',
      openrouterRequestModel: 'flat-static-wire',
      openrouterFallback: false,
      openrouterMiddleOut: false,
      openrouterProvider: { order: ['FlatProvider'], only: ['flat-only'], ignore: ['flat-ignore'] },
      modelProfiles: [
        {
          id: 'durable-main',
          name: 'Durable Main',
          modelId: 'durable-selected-model',
          providerOptions: {
            requestModel: 'durable-wire',
            openrouter: {
              fallback: true,
              middleOut: true,
              provider: { order: ['ProfileProvider'], only: ['profile-only'], ignore: ['profile-ignore'] },
            },
          },
        },
      ],
      modelRoleProfiles: {
        chatMain: { mode: 'profile', profileId: 'durable-main' },
      },
    } as Partial<Database>)

    const profile = resolveModelProfile({ database, role: 'chatMain', staticModel: 'openrouter' })

    expect(profile.modelId).toBe('openrouter')
    expect(profile.requestModel).toBe('flat-static-wire')
    expect(profile.providerOptions.openrouter).toEqual({
      fallback: false,
      middleOut: false,
      provider: { order: ['FlatProvider'], only: ['flat-only'], ignore: ['flat-ignore'] },
    })
    expect(profile.profileId).toBe('legacy:staticModel:openrouter')
    expect(profile.source).toMatchObject({
      kind: 'staticModel',
      field: 'staticModel',
      bypassesRoleResolution: true,
    })
  })

  it('falls back to legacy flat resolution for missing or incomplete durable profiles', () => {
    const lookupModelInfo = (_database: Database, id: string) => modelInfo({ id, name: id, internalID: id })

    for (const database of [
      db({
        aiModel: 'flat-main-model',
        modelProfiles: [{ id: 'durable-main', name: 'Durable Main', modelId: 'durable-selected-model' }],
        modelRoleProfiles: {
          chatMain: { mode: 'profile', profileId: 'missing-profile' },
        },
      } as Partial<Database>),
      db({
        aiModel: 'flat-main-model',
        modelProfiles: [{ id: 'durable-main', name: 'Durable Main', modelId: '   ' }],
        modelRoleProfiles: {
          chatMain: { mode: 'profile', profileId: 'durable-main' },
        },
      } as Partial<Database>),
      db({
        aiModel: 'flat-main-model',
        modelProfiles: [{ id: 'durable-main', name: 'Durable Main' }],
        modelRoleProfiles: {
          chatMain: { mode: 'profile', profileId: 'durable-main' },
        },
      } as Partial<Database>),
    ]) {
      const profile = resolveModelProfile({ database, role: 'chatMain', lookupModelInfo })

      expect(profile.modelId).toBe('flat-main-model')
      expect(profile.profileId).toBe('legacy:aiModel:flat-main-model')
      expect(profile.source).toMatchObject({ kind: 'legacy-aiModel', field: 'aiModel' })
    }
  })

  it('preserves legacy seperateModels inheritance and scriptAux fallback chain', () => {
    const database = db({
      aiModel: 'main-model',
      subModel: 'aux-model',
      seperateModelsForAxModels: true,
      seperateModels: {
        memory: 'memory-seperate-model',
        otherAx: 'other-ax-model',
        scriptMain: '',
        scriptAux: '',
      } as Database['seperateModels'],
    })
    const lookupModelInfo = (_database: Database, id: string) => modelInfo({ id, name: id, internalID: id })

    const memory = resolveModelProfile({ database, role: 'memory', lookupModelInfo })
    expect(memory.modelId).toBe('memory-seperate-model')
    expect(memory.source).toMatchObject({ kind: 'legacy-seperateModels', field: 'seperateModels.memory' })

    const scriptMain = resolveModelProfile({ database, role: 'scriptMain', lookupModelInfo })
    expect(scriptMain.modelId).toBe('main-model')
    expect(scriptMain.source).toMatchObject({ kind: 'legacy-inherit', field: 'aiModel' })

    const scriptAux = resolveModelProfile({ database, role: 'scriptAux', lookupModelInfo })
    expect(scriptAux.modelId).toBe('other-ax-model')
    expect(scriptAux.source).toMatchObject({ kind: 'legacy-seperateModels', field: 'seperateModels.otherAx' })
  })

  it('lets staticModel bypass role resolution and omit recursive fallback refs', () => {
    const database = db({
      modelRoles: { scriptAux: 'pluginmodel:::blocked' } as Database['modelRoles'],
      fallbackModels: { scriptAux: ['fallback-script-model'] } as unknown as Database['fallbackModels'],
    })

    const profile = resolveModelProfile({ database, role: 'scriptAux', staticModel: 'echo_model' })

    expect(profile.modelId).toBe('echo_model')
    expect(profile.source).toMatchObject({
      kind: 'staticModel',
      field: 'staticModel',
      bypassesRoleResolution: true,
    })
    expect(profile.fallbacks).toEqual([])
  })

  it('resolves legacy fallback refs by role and skips the legacy submodel bucket', () => {
    const database = db({
      fallbackModels: {
        model: ['main-a'],
        memory: ['memory-a', ''],
        scriptAux: ['script-a'],
        submodel: ['must-not-read'],
      } as unknown as Database['fallbackModels'],
    })

    expect(resolveLegacyFallbackRefs(database, 'memory')).toEqual([
      { kind: 'legacy-model-id', fallbackKey: 'memory', modelId: 'memory-a' },
    ])
    expect(resolveLegacyFallbackRefs(database, 'submodel')).toEqual([])
  })
})

describe('resolveModelProfile provider/runtime normalization', () => {
  it('normalizes reverse_proxy request model, options, capability input, and fallbacks', () => {
    const profile = resolveModelProfile({
      database: db({
        aiModel: 'reverse_proxy',
        customProxyRequestModel: 'proxy-model',
        customAPIFormat: LLMFormat.OpenAICompatible,
        forceReplaceUrl: 'risu::https://proxy.example.com',
        proxyKey: 'sk-proxy',
        autofillRequestUrl: true,
        reverseProxyOobaMode: true,
        additionalParams: [['header::X-Test', 'yes']],
        fallbackModels: { model: ['fallback-model'] } as unknown as Database['fallbackModels'],
      }),
    })

    expect(profile.requestModel).toBe('proxy-model')
    expect(profile.providerCapability).toEqual({ routable: true, provider: 'openai' })
    expect(profile.providerCapabilityInput).toMatchObject({
      aiModel: 'reverse_proxy',
      format: LLMFormat.OpenAICompatible,
      config: { forceReplaceUrl: 'risu::https://proxy.example.com', proxyKey: 'sk-proxy' },
    })
    expect(profile.providerOptions).toMatchObject({
      apiKey: 'sk-proxy',
      baseUrl: 'https://proxy.example.com/v1',
      extraHeaders: { 'X-Proxy-Risu': 'RisuAI' },
      additionalParams: [['header::X-Test', 'yes']],
      reverseProxy: { oobaSystemHoist: true },
    })
    expect(profile.fallbacks).toEqual([{ kind: 'legacy-model-id', fallbackKey: 'model', modelId: 'fallback-model' }])
  })

  it('normalizes xcustom rows and reuses the capability table for matching formats', () => {
    const profile = resolveModelProfile({
      database: db({
        aiModel: 'xcustom:::mistral',
        customModels: [
          {
            id: 'xcustom:::mistral',
            name: 'Custom Mistral',
            internalId: 'custom-wire-model',
            url: 'https://custom.example.com/v1/chat/completions',
            key: 'custom-key',
            format: LLMFormat.Mistral,
            tokenizer: LLMTokenizer.Mistral,
            flags: [LLMFlags.hasFirstSystemPrompt],
            params: 'header::X-Custom=yes\nbody=json::{"ok":true}',
          },
        ] as Database['customModels'],
      }),
    })

    expect(profile.modelInfo).toMatchObject({
      id: 'xcustom:::mistral',
      internalID: 'custom-wire-model',
      format: LLMFormat.Mistral,
      tokenizer: LLMTokenizer.Mistral,
    })
    expect(profile.requestModel).toBe('custom-wire-model')
    expect(profile.providerOptions).toMatchObject({
      apiKey: 'custom-key',
      baseUrl: 'https://custom.example.com/v1',
      additionalParams: [
        ['header::X-Custom', 'yes'],
        ['body', 'json::{"ok":true}'],
      ],
    })
    expect(profile.providerCapability).toEqual({ routable: true, provider: 'mistral' })
  })

  it('marks incomplete xcustom rows as capability-incomplete without hiding their dependency', () => {
    const profile = resolveModelProfile({
      database: db({
        aiModel: 'xcustom:::missing-key',
        customModels: [
          {
            id: 'xcustom:::missing-key',
            name: 'Missing Key',
            internalId: 'wire',
            url: 'https://custom.example.com/v1',
            key: '',
            format: LLMFormat.OpenAICompatible,
            tokenizer: LLMTokenizer.Unknown,
            flags: [],
            params: '',
          },
        ] as Database['customModels'],
      }),
    })

    expect(profile.providerOptions.customModel).toMatchObject({
      id: 'xcustom:::missing-key',
      url: 'https://custom.example.com/v1',
    })
    expect(profile.providerCapability).toEqual({ routable: false, reason: 'config-incomplete' })
  })

  it('normalizes OpenRouter and NanoGPT request model/provider options', () => {
    const openrouter = resolveModelProfile({
      database: db({
        aiModel: 'openrouter',
        openrouterKey: 'or-key',
        openrouterRequestModel: 'anthropic/claude-sonnet',
        openrouterFallback: true,
        openrouterMiddleOut: true,
        openrouterProvider: { order: ['Anthropic'], only: ['openrouter/only'], ignore: ['openrouter/ignore'] },
      } as Partial<Database>),
    })

    expect(openrouter.requestModel).toBe('anthropic/claude-sonnet')
    expect(openrouter.providerCapability).toEqual({ routable: true, provider: 'openrouter' })
    expect(openrouter.providerOptions).toMatchObject({
      apiKey: 'or-key',
      baseUrl: 'https://openrouter.ai/api/v1',
      openrouter: {
        fallback: true,
        middleOut: true,
        provider: { order: ['Anthropic'], only: ['openrouter/only'], ignore: ['openrouter/ignore'] },
      },
    })

    const nanogpt = resolveModelProfile({
      database: db({
        aiModel: 'nanogpt',
        nanogptKey: 'nano-key',
        nanogptRequestModel: 'nano/model',
        nanogptProvider: 'together',
        nanogptUseSubscriptionEndpoint: true,
        nanogptSubscriptionState: 'active',
      } as Partial<Database>),
    })

    expect(nanogpt.requestModel).toBe('nano/model')
    expect(nanogpt.providerCapability).toEqual({ routable: true, provider: 'nanogpt' })
    expect(nanogpt.providerOptions).toMatchObject({
      apiKey: 'nano-key',
      baseUrl: 'https://nano-gpt.com/api/subscription/v1',
      extraHeaders: { 'X-Provider': 'together' },
      nanogpt: {
        providerHint: 'together',
        useSubscriptionEndpoint: true,
        subscriptionState: 'active',
      },
    })
  })

  it.each([
    ['legacy', LLMFormat.NanoGPTLegacy],
    ['responses', LLMFormat.NanoGPTResponses],
    ['messages', LLMFormat.NanoGPTMessages],
  ])(
    'keeps %s NanoGPT-compatible formats on the base endpoint when durable subscription options are missing',
    (_label, format) => {
      const profile = resolveModelProfile({
        database: db({
          aiModel: 'flat-main-model',
          nanogptKey: 'nano-key',
          nanogptProvider: 'flat-provider',
          nanogptUseSubscriptionEndpoint: true,
          nanogptSubscriptionState: 'active',
          modelProfiles: [
            {
              id: 'nanogpt-compatible-profile',
              name: 'NanoGPT Compatible Profile',
              modelId: 'nanogpt-compatible-model',
              providerOptions: {
                nanogpt: {
                  providerHint: 'profile-provider',
                },
              },
            },
          ],
          modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'nanogpt-compatible-profile' } },
        } as Partial<Database>),
        lookupModelInfo: (_database, id) => modelInfo({ id, name: id, internalID: id, format }),
      })

      expect(profile.providerOptions).toMatchObject({
        apiKey: 'nano-key',
        baseUrl: 'https://nano-gpt.com/api/v1',
        extraHeaders: { 'X-Provider': 'profile-provider' },
        nanogpt: {
          providerHint: 'profile-provider',
          subscriptionState: 'active',
        },
      })
      expect(profile.providerOptions.nanogpt?.useSubscriptionEndpoint).toBeUndefined()
    },
  )

  it.each([
    [true, 'https://nano-gpt.com/api/subscription/v1'],
    [false, 'https://nano-gpt.com/api/v1'],
  ])(
    'applies explicit durable subscription endpoint %s for NanoGPT-compatible formats',
    (useSubscriptionEndpoint, baseUrl) => {
      const profile = resolveModelProfile({
        database: db({
          aiModel: 'flat-main-model',
          nanogptKey: 'nano-key',
          nanogptProvider: 'flat-provider',
          nanogptUseSubscriptionEndpoint: !useSubscriptionEndpoint,
          modelProfiles: [
            {
              id: 'nanogpt-compatible-profile',
              name: 'NanoGPT Compatible Profile',
              modelId: 'nanogpt-compatible-model',
              providerOptions: {
                nanogpt: {
                  useSubscriptionEndpoint,
                },
              },
            },
          ],
          modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'nanogpt-compatible-profile' } },
        } as Partial<Database>),
        lookupModelInfo: (_database, id) =>
          modelInfo({ id, name: id, internalID: id, format: LLMFormat.NanoGPTResponses }),
      })

      expect(profile.providerOptions.baseUrl).toBe(baseUrl)
      expect(profile.providerOptions.nanogpt?.useSubscriptionEndpoint).toBe(useSubscriptionEndpoint)
    },
  )

  it('prefers durable providerOptions.requestModel over flat provider request model fields', () => {
    const openrouter = resolveModelProfile({
      database: db({
        aiModel: 'flat-main-model',
        openrouterKey: 'or-key',
        openrouterRequestModel: 'flat/openrouter',
        modelProfiles: [
          {
            id: 'openrouter-profile',
            name: 'OpenRouter Profile',
            modelId: 'openrouter',
            providerOptions: { requestModel: ' profile/openrouter ' },
          },
        ],
        modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'openrouter-profile' } },
      } as Partial<Database>),
    })

    expect(openrouter.modelId).toBe('openrouter')
    expect(openrouter.requestModel).toBe('profile/openrouter')
    expect(openrouter.providerOptions).toMatchObject({
      apiKey: 'or-key',
      requestModel: 'profile/openrouter',
    })

    const nanogpt = resolveModelProfile({
      database: db({
        aiModel: 'flat-main-model',
        nanogptKey: 'nano-key',
        nanogptRequestModel: 'flat/nanogpt',
        modelProfiles: [
          {
            id: 'nanogpt-profile',
            name: 'NanoGPT Profile',
            modelId: 'nanogpt',
            providerOptions: { requestModel: 'profile/nanogpt' },
          },
        ],
        modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'nanogpt-profile' } },
      } as Partial<Database>),
    })

    expect(nanogpt.modelId).toBe('nanogpt')
    expect(nanogpt.requestModel).toBe('profile/nanogpt')
    expect(nanogpt.providerOptions).toMatchObject({
      apiKey: 'nano-key',
      requestModel: 'profile/nanogpt',
    })

    const reverseProxy = resolveModelProfile({
      database: db({
        aiModel: 'flat-main-model',
        customProxyRequestModel: 'flat-proxy-model',
        forceReplaceUrl: 'https://proxy.example.com/v1',
        proxyKey: 'proxy-key',
        modelProfiles: [
          {
            id: 'proxy-profile',
            name: 'Proxy Profile',
            modelId: 'reverse_proxy',
            providerOptions: { requestModel: 'profile-proxy-model' },
          },
        ],
        modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'proxy-profile' } },
      } as Partial<Database>),
    })

    expect(reverseProxy.modelId).toBe('reverse_proxy')
    expect(reverseProxy.requestModel).toBe('profile-proxy-model')
    expect(reverseProxy.providerOptions).toMatchObject({
      apiKey: 'proxy-key',
      baseUrl: 'https://proxy.example.com/v1',
      requestModel: 'profile-proxy-model',
    })

    const ollamaCloud = resolveModelProfile({
      database: db({
        aiModel: 'flat-main-model',
        ollamaApiKey: 'ollama-cloud-key',
        ollamaRequestFormat: LLMFormat.OpenAIResponseAPI,
        ollamaCloudModel: 'flat-cloud-model',
        modelProfiles: [
          {
            id: 'ollama-cloud-profile',
            name: 'Ollama Cloud Profile',
            modelId: 'ollama-cloud',
            providerOptions: { requestModel: 'profile-cloud-model' },
          },
        ],
        modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'ollama-cloud-profile' } },
      } as Partial<Database>),
    })

    expect(ollamaCloud.modelId).toBe('ollama-cloud')
    expect(ollamaCloud.requestModel).toBe('profile-cloud-model')
    expect(ollamaCloud.providerOptions.requestModel).toBe('profile-cloud-model')
    expect(ollamaCloud.providerOptions.ollama).toMatchObject({
      apiKey: 'ollama-cloud-key',
      cloud: true,
      model: 'profile-cloud-model',
    })

    const localOllama = resolveModelProfile({
      database: db({
        aiModel: 'flat-main-model',
        ollamaURL: 'http://localhost:11434',
        ollamaModel: 'flat-local-model',
        modelProfiles: [
          {
            id: 'ollama-local-profile',
            name: 'Ollama Local Profile',
            modelId: 'ollama-hosted',
            providerOptions: { requestModel: 'profile-local-model' },
          },
        ],
        modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'ollama-local-profile' } },
      } as Partial<Database>),
    })

    expect(localOllama.modelId).toBe('ollama-hosted')
    expect(localOllama.requestModel).toBe('profile-local-model')
    expect(localOllama.providerOptions.requestModel).toBe('profile-local-model')
    expect(localOllama.providerOptions.ollama).toMatchObject({
      cloud: false,
      model: 'profile-local-model',
      url: 'http://localhost:11434',
    })
  })

  it('prefers durable providerOptions.apiKey over flat keys only for the selected profile', () => {
    const openrouter = resolveModelProfile({
      database: db({
        aiModel: 'flat-main-model',
        openrouterKey: 'flat-openrouter-key',
        openrouterRequestModel: 'flat/openrouter',
        modelProfiles: [
          {
            id: 'openrouter-profile',
            name: 'OpenRouter Profile',
            modelId: 'openrouter',
            providerOptions: {
              apiKey: ' profile-openrouter-key ',
              requestModel: 'profile/openrouter',
            },
          },
          {
            id: 'unused-profile',
            name: 'Unused Profile',
            modelId: 'openrouter',
            providerOptions: {
              apiKey: 'must-not-borrow',
              requestModel: 'unused/openrouter',
            },
          },
        ],
        modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'openrouter-profile' } },
      } as Partial<Database>),
    })

    expect(openrouter.providerOptions.apiKey).toBe('profile-openrouter-key')
    expect(openrouter.providerCapability).toEqual({ routable: true, provider: 'openrouter' })

    const reverseProxy = resolveModelProfile({
      database: db({
        aiModel: 'flat-main-model',
        customProxyRequestModel: 'flat-proxy-model',
        customAPIFormat: LLMFormat.OpenAICompatible,
        forceReplaceUrl: 'https://proxy.example.com/v1',
        proxyKey: 'flat-proxy-key',
        modelProfiles: [
          {
            id: 'proxy-profile',
            name: 'Proxy Profile',
            modelId: 'reverse_proxy',
            providerOptions: {
              apiKey: 'profile-proxy-key',
              requestModel: 'profile-proxy-model',
              baseUrl: 'https://profile-proxy.example.com/v1',
            },
          },
        ],
        modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'proxy-profile' } },
      } as Partial<Database>),
    })

    expect(reverseProxy.providerOptions.apiKey).toBe('profile-proxy-key')
    expect(reverseProxy.providerCapabilityInput.config).toMatchObject({
      forceReplaceUrl: 'https://profile-proxy.example.com/v1',
      proxyKey: 'profile-proxy-key',
    })
    expect(reverseProxy.providerCapability).toEqual({ routable: true, provider: 'openai' })

    const keyIdentifier = resolveModelProfile({
      database: db({
        aiModel: 'flat-main-model',
        OaiCompAPIKeys: { deepseek: 'flat-deepseek-key' },
        modelProfiles: [
          {
            id: 'deepseek-profile',
            name: 'DeepSeek Profile',
            modelId: 'deepseek-chat',
            providerOptions: { apiKey: 'profile-deepseek-key' },
          },
        ],
        modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'deepseek-profile' } },
      } as Partial<Database>),
    })

    expect(keyIdentifier.providerOptions.apiKey).toBe('profile-deepseek-key')
    expect(keyIdentifier.providerCapabilityInput.config.oaiCompApiKeys).toMatchObject({
      deepseek: 'profile-deepseek-key',
    })
    expect(keyIdentifier.providerCapability).toEqual({ routable: true, provider: 'openai' })
  })

  it('falls back to flat provider keys when durable providerOptions.apiKey is blank or missing', () => {
    for (const providerOptions of [undefined, { apiKey: '   ' }]) {
      const profile = resolveModelProfile({
        database: db({
          aiModel: 'flat-main-model',
          openrouterKey: 'flat-openrouter-key',
          modelProfiles: [
            {
              id: 'openrouter-profile',
              name: 'OpenRouter Profile',
              modelId: 'openrouter',
              ...(providerOptions ? { providerOptions } : {}),
            },
          ],
          modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'openrouter-profile' } },
        } as Partial<Database>),
      })

      expect(profile.providerOptions.apiKey).toBe('flat-openrouter-key')
      expect(profile.providerCapability).toEqual({ routable: true, provider: 'openrouter' })
    }
  })

  it('does not let staticModel or legacy fallback selections borrow a selected durable profile apiKey', () => {
    const database = db({
      aiModel: 'openrouter',
      openrouterKey: 'flat-openrouter-key',
      openrouterRequestModel: 'flat/openrouter',
      modelProfiles: [
        {
          id: 'openrouter-profile',
          name: 'OpenRouter Profile',
          modelId: 'openrouter',
          providerOptions: { apiKey: 'profile-openrouter-key', requestModel: 'profile/openrouter' },
        },
      ],
      modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'openrouter-profile' } },
    } as Partial<Database>)

    const staticProfile = resolveModelProfile({ database, role: 'chatMain', staticModel: 'openrouter' })
    expect(staticProfile.source.kind).toBe('staticModel')
    expect(staticProfile.requestModel).toBe('flat/openrouter')
    expect(staticProfile.providerOptions.apiKey).toBe('flat-openrouter-key')

    const legacyProfile = resolveModelProfile({
      database: {
        ...database,
        modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'missing-profile' } },
      } as Database,
      role: 'chatMain',
    })
    expect(legacyProfile.source.kind).toBe('legacy-aiModel')
    expect(legacyProfile.providerOptions.apiKey).toBe('flat-openrouter-key')
  })

  it('uses durable reverse_proxy endpoint and flags while keeping flat proxy key', () => {
    const profile = resolveModelProfile({
      database: db({
        aiModel: 'flat-main-model',
        customAPIFormat: LLMFormat.OpenAICompatible,
        customProxyRequestModel: 'flat-proxy-model',
        forceReplaceUrl: 'https://flat-proxy.example.com/v1',
        proxyKey: 'flat-proxy-key',
        autofillRequestUrl: true,
        reverseProxyOobaMode: false,
        reverseProxyOobaArgs: { flat: true },
        modelProfiles: [
          {
            id: 'proxy-profile',
            name: 'Proxy Profile',
            modelId: 'reverse_proxy',
            providerOptions: {
              requestModel: 'profile-proxy-model',
              baseUrl: 'risu::https://profile-proxy.example.com/v1/chat/completions',
              reverseProxy: {
                autofillRequestUrl: false,
                oobaSystemHoist: true,
                oobaArgs: { profile: true },
              },
            },
          },
        ],
        modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'proxy-profile' } },
      } as Partial<Database>),
    })

    expect(profile.modelId).toBe('reverse_proxy')
    expect(profile.requestModel).toBe('profile-proxy-model')
    expect(profile.providerCapability).toEqual({ routable: true, provider: 'openai' })
    expect(profile.providerCapabilityInput).toMatchObject({
      config: { forceReplaceUrl: 'https://profile-proxy.example.com/v1', proxyKey: 'flat-proxy-key' },
    })
    expect(profile.providerOptions).toMatchObject({
      apiKey: 'flat-proxy-key',
      baseUrl: 'https://profile-proxy.example.com/v1',
      extraHeaders: { 'X-Proxy-Risu': 'RisuAI' },
      reverseProxy: {
        autofillRequestUrl: false,
        oobaSystemHoist: true,
        oobaArgs: { profile: true },
      },
    })
  })

  it('uses durable OpenRouter and NanoGPT options while keeping flat provider keys', () => {
    const openrouter = resolveModelProfile({
      database: db({
        aiModel: 'flat-main-model',
        openrouterKey: 'flat-openrouter-key',
        openrouterRequestModel: 'flat/openrouter',
        openrouterFallback: false,
        openrouterMiddleOut: false,
        openrouterProvider: { order: ['FlatProvider'], only: ['flat-only'], ignore: ['flat-ignore'] },
        modelProfiles: [
          {
            id: 'openrouter-profile',
            name: 'OpenRouter Profile',
            modelId: 'openrouter',
            providerOptions: {
              requestModel: 'profile/openrouter',
              openrouter: {
                fallback: true,
                middleOut: true,
                provider: {
                  order: ['ProfileProvider'],
                  only: ['profile-only'],
                  ignore: ['profile-ignore'],
                },
              },
            },
          },
        ],
        modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'openrouter-profile' } },
      } as Partial<Database>),
    })

    expect(openrouter.providerOptions).toMatchObject({
      apiKey: 'flat-openrouter-key',
      requestModel: 'profile/openrouter',
      openrouter: {
        fallback: true,
        middleOut: true,
        provider: {
          order: ['ProfileProvider'],
          only: ['profile-only'],
          ignore: ['profile-ignore'],
        },
      },
    })

    const nanogpt = resolveModelProfile({
      database: db({
        aiModel: 'flat-main-model',
        nanogptKey: 'flat-nano-key',
        nanogptRequestModel: 'flat/nano',
        nanogptProvider: 'flat-provider',
        nanogptUseSubscriptionEndpoint: false,
        nanogptSubscriptionState: 'inactive',
        modelProfiles: [
          {
            id: 'nanogpt-profile',
            name: 'NanoGPT Profile',
            modelId: 'nanogpt',
            providerOptions: {
              requestModel: 'profile/nano',
              nanogpt: {
                providerHint: 'profile-provider',
                useSubscriptionEndpoint: true,
                subscriptionState: 'active',
              },
            },
          },
        ],
        modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'nanogpt-profile' } },
      } as Partial<Database>),
    })

    expect(nanogpt.providerOptions).toMatchObject({
      apiKey: 'flat-nano-key',
      baseUrl: 'https://nano-gpt.com/api/subscription/v1',
      extraHeaders: { 'X-Provider': 'profile-provider' },
      requestModel: 'profile/nano',
      nanogpt: {
        providerHint: 'profile-provider',
        useSubscriptionEndpoint: true,
        subscriptionState: 'active',
      },
    })
  })

  it('uses durable Ollama options while keeping the flat Ollama API key', () => {
    const local = resolveModelProfile({
      database: db({
        aiModel: 'flat-main-model',
        ollamaApiKey: 'flat-ollama-key',
        ollamaURL: 'http://flat-ollama.example.com',
        ollamaModel: 'flat-local-model',
        ollamaModelSource: 'cloud',
        ollamaThinkingMode: 'off',
        modelProfiles: [
          {
            id: 'ollama-local-profile',
            name: 'Ollama Local Profile',
            modelId: 'ollama-hosted',
            providerOptions: {
              requestModel: 'profile-local-model',
              baseUrl: 'http://profile-base.example.com',
              ollama: {
                url: 'http://profile-ollama.example.com',
                requestFormat: LLMFormat.OpenAIResponseAPI,
                modelSource: 'local',
                thinkingMode: 'high',
              },
            },
          },
        ],
        modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'ollama-local-profile' } },
      } as Partial<Database>),
    })

    expect(local.providerCapability).toEqual({ routable: true, provider: 'ollama' })
    expect(local.providerOptions).toMatchObject({
      baseUrl: 'http://profile-ollama.example.com',
      requestModel: 'profile-local-model',
      ollama: {
        url: 'http://profile-ollama.example.com',
        requestFormat: LLMFormat.OpenAIResponseAPI,
        model: 'profile-local-model',
        modelSource: 'local',
        thinkingMode: 'high',
        cloud: false,
      },
    })
    expect(local.providerOptions.ollama?.apiKey).toBeUndefined()

    const cloud = resolveModelProfile({
      database: db({
        aiModel: 'flat-main-model',
        ollamaApiKey: 'flat-ollama-key',
        ollamaRequestFormat: LLMFormat.OpenAICompatible,
        ollamaCloudModel: 'flat-cloud-model',
        ollamaModelSource: 'local',
        ollamaThinkingMode: 'off',
        modelProfiles: [
          {
            id: 'ollama-cloud-profile',
            name: 'Ollama Cloud Profile',
            modelId: 'ollama-cloud',
            providerOptions: {
              requestModel: 'profile-cloud-model',
              ollama: {
                requestFormat: LLMFormat.Anthropic,
                modelSource: 'cloud',
                thinkingMode: 'medium',
              },
            },
          },
        ],
        modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'ollama-cloud-profile' } },
      } as Partial<Database>),
    })

    expect(cloud.modelInfo.format).toBe(LLMFormat.Anthropic)
    expect(cloud.providerCapability).toEqual({ routable: true, provider: 'anthropic' })
    expect(cloud.providerOptions).toMatchObject({
      apiKey: 'flat-ollama-key',
      baseUrl: 'https://ollama.com/v1',
      requestModel: 'profile-cloud-model',
      ollama: {
        apiKey: 'flat-ollama-key',
        requestFormat: LLMFormat.Anthropic,
        model: 'profile-cloud-model',
        modelSource: 'cloud',
        thinkingMode: 'medium',
        cloud: true,
      },
    })
  })

  it('uses durable baseUrl for Kobold and OobaLegacy profile endpoints', () => {
    const kobold = resolveModelProfile({
      database: db({
        aiModel: 'flat-main-model',
        koboldURL: 'http://flat-kobold.example.com',
        modelProfiles: [
          {
            id: 'kobold-profile',
            name: 'Kobold Profile',
            modelId: 'kobold',
            providerOptions: { baseUrl: ' http://profile-kobold.example.com ' },
          },
        ],
        modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'kobold-profile' } },
      } as Partial<Database>),
    })

    expect(kobold.providerOptions).toMatchObject({
      baseUrl: 'http://profile-kobold.example.com',
      requestModel: 'kobold',
    })

    const oobaLegacy = resolveModelProfile({
      database: db({
        aiModel: 'flat-main-model',
        textgenWebUIBlockingURL: 'http://flat-ooba.example.com/api/v1/blocking',
        mancerHeader: 'flat-ooba-key',
        modelProfiles: [
          {
            id: 'ooba-profile',
            name: 'Ooba Profile',
            modelId: 'mancer',
            providerOptions: { baseUrl: ' http://profile-ooba.example.com/api/v1/blocking ' },
          },
        ],
        modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'ooba-profile' } },
      } as Partial<Database>),
    })

    expect(oobaLegacy.providerOptions).toMatchObject({
      apiKey: 'flat-ooba-key',
      baseUrl: 'http://profile-ooba.example.com/api/v1/blocking',
      requestModel: 'mancer',
    })
  })

  it('falls back to flat request model fields when durable providerOptions.requestModel is missing or blank', () => {
    for (const providerOptions of [undefined, { requestModel: '   ' }]) {
      const profile = resolveModelProfile({
        database: db({
          aiModel: 'flat-main-model',
          openrouterKey: 'or-key',
          openrouterRequestModel: 'flat/openrouter',
          openrouterFallback: true,
          openrouterMiddleOut: true,
          openrouterProvider: { order: ['FlatProvider'], only: ['flat-only'], ignore: ['flat-ignore'] },
          modelProfiles: [
            {
              id: 'openrouter-profile',
              name: 'OpenRouter Profile',
              modelId: 'openrouter',
              ...(providerOptions ? { providerOptions } : {}),
            },
          ],
          modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'openrouter-profile' } },
        } as Partial<Database>),
      })

      expect(profile.modelId).toBe('openrouter')
      expect(profile.requestModel).toBe('flat/openrouter')
      expect(profile.providerOptions.requestModel).toBe('flat/openrouter')
      expect(profile.providerOptions.openrouter).toEqual({
        fallback: true,
        middleOut: true,
        provider: { order: ['FlatProvider'], only: ['flat-only'], ignore: ['flat-ignore'] },
      })
    }
  })

  it('normalizes Ollama cloud remapping and native Ollama dispatch options', () => {
    const cloud = resolveModelProfile({
      database: db({
        aiModel: 'ollama-cloud',
        ollamaApiKey: 'ollama-cloud-key',
        ollamaRequestFormat: LLMFormat.OpenAIResponseAPI,
        ollamaCloudModel: 'gpt-oss:20b',
        ollamaModelSource: 'cloud',
        ollamaThinkingMode: 'medium',
      } as Partial<Database>),
    })

    expect(cloud.modelInfo.format).toBe(LLMFormat.OpenAIResponseAPI)
    expect(cloud.providerCapabilityInput.format).toBe(LLMFormat.Ollama)
    expect(cloud.providerCapability).toEqual({ routable: true, provider: 'openai-responses' })
    expect(cloud.requestModel).toBe('gpt-oss:20b')
    expect(cloud.providerOptions.ollama).toMatchObject({ cloud: true, model: 'gpt-oss:20b' })

    const local = resolveModelProfile({
      database: db({
        aiModel: 'ollama-hosted',
        ollamaURL: 'http://localhost:11434',
        ollamaModel: 'llama3',
        ollamaModelSource: 'local',
        ollamaThinkingMode: 'off',
      } as Partial<Database>),
    })

    expect(local.providerCapability).toEqual({ routable: true, provider: 'ollama' })
    expect(local.requestModel).toBe('llama3')
    expect(local.providerOptions.ollama).toMatchObject({
      cloud: false,
      url: 'http://localhost:11434',
      model: 'llama3',
    })
  })

  it('normalizes Kobold endpoint into provider options', () => {
    const profile = resolveModelProfile({
      database: db({
        aiModel: 'kobold',
        koboldURL: 'http://kobold.example.com',
      } as Partial<Database>),
    })

    expect(profile.modelInfo.format).toBe(LLMFormat.Kobold)
    expect(profile.providerCapability).toEqual({ routable: true, provider: 'kobold' })
    expect(profile.providerOptions).toMatchObject({
      baseUrl: 'http://kobold.example.com',
      requestModel: 'kobold',
    })
  })

  it('normalizes OobaLegacy endpoint and API key into provider options', () => {
    const profile = resolveModelProfile({
      database: db({
        aiModel: 'mancer',
        textgenWebUIBlockingURL: 'http://ooba.example.com/api/v1/blocking',
        mancerHeader: 'mancer-profile-key',
      } as Partial<Database>),
    })

    expect(profile.modelInfo.format).toBe(LLMFormat.OobaLegacy)
    expect(profile.providerCapability).toEqual({ routable: true, provider: 'ooba-legacy' })
    expect(profile.requestModel).toBe('mancer')
    expect(profile.providerOptions).toMatchObject({
      apiKey: 'mancer-profile-key',
      baseUrl: 'http://ooba.example.com/api/v1/blocking',
      requestModel: 'mancer',
    })
  })

  it('normalizes Horde API key and strips horde prefix from the request model', () => {
    const profile = resolveModelProfile({
      database: db({
        aiModel: 'horde:::koboldcpp/Mistral-7B',
        hordeConfig: { apiKey: 'horde-profile-key', model: '', softPrompt: '' },
        instructChatTemplate: 'chatml',
      } as Partial<Database>),
    })

    expect(profile.modelInfo.format).toBe(LLMFormat.Horde)
    expect(profile.providerCapability).toEqual({ routable: true, provider: 'horde' })
    expect(profile.requestModel).toBe('koboldcpp/Mistral-7B')
    expect(profile.providerOptions).toMatchObject({
      apiKey: 'horde-profile-key',
      requestModel: 'koboldcpp/Mistral-7B',
    })
  })

  it('normalizes Bedrock credential string and request model into provider options', () => {
    const profile = resolveModelProfile({
      database: db({
        aiModel: 'anthropic.claude-sonnet-4-5-20250929-v1:0',
        claudeAPIKey: 'bedrock-access:bedrock-secret:ap-southeast-2',
      } as Partial<Database>),
    })

    expect(profile.modelInfo.format).toBe(LLMFormat.AWSBedrockClaude)
    expect(profile.providerCapability).toEqual({ routable: true, provider: 'bedrock' })
    expect(profile.requestModel).toBe('global.anthropic.claude-sonnet-4-5-20250929-v1:0')
    expect(profile.providerOptions).toMatchObject({
      apiKey: 'bedrock-access:bedrock-secret:ap-southeast-2',
      requestModel: 'global.anthropic.claude-sonnet-4-5-20250929-v1:0',
    })
  })

  it('normalizes Google AI Studio API key and strips models/ from the request model', () => {
    const profile = resolveModelProfile({
      database: db({
        aiModel: 'gemini-2.5-flash',
        google: { accessToken: 'google-profile-key', projectId: 'studio-project' },
      } as Partial<Database>),
      lookupModelInfo: (_database, id) =>
        modelInfo({
          id,
          name: 'Gemini Profile',
          internalID: 'models/gemini-profile-wire-model',
          provider: LLMProvider.GoogleCloud,
          format: LLMFormat.GoogleCloud,
          flags: [LLMFlags.hasFirstSystemPrompt],
          tokenizer: LLMTokenizer.GoogleCloud,
        }),
    })

    expect(profile.modelInfo.format).toBe(LLMFormat.GoogleCloud)
    expect(profile.providerCapability).toEqual({ routable: true, provider: 'gemini' })
    expect(profile.requestModel).toBe('gemini-profile-wire-model')
    expect(profile.providerOptions).toMatchObject({
      apiKey: 'google-profile-key',
      requestModel: 'gemini-profile-wire-model',
    })
    expect(profile.providerOptions.vertex).toBeUndefined()
  })

  it('normalizes Vertex service-account auth and strips models/ from the request model', () => {
    const profile = resolveModelProfile({
      database: db({
        aiModel: 'gemini-2.5-pro-vertex',
        google: { accessToken: 'studio-key-ignored-for-vertex', projectId: 'profile-project' },
        vertexRegion: 'us-central1',
        vertexClientEmail: 'svc@profile-project.iam.gserviceaccount.com',
        vertexPrivateKey: 'profile-private-key',
        vertexAccessToken: 'cached-token-not-a-profile-credential',
      } as Partial<Database>),
      lookupModelInfo: (_database, id) =>
        modelInfo({
          id,
          name: 'Gemini Vertex Profile',
          internalID: 'models/gemini-profile-vertex-wire-model',
          provider: LLMProvider.VertexAI,
          format: LLMFormat.VertexAIGemini,
          flags: [LLMFlags.hasFirstSystemPrompt],
          tokenizer: LLMTokenizer.GoogleCloud,
        }),
    })

    expect(profile.modelInfo.format).toBe(LLMFormat.VertexAIGemini)
    expect(profile.providerCapability).toEqual({ routable: true, provider: 'gemini' })
    expect(profile.requestModel).toBe('gemini-profile-vertex-wire-model')
    expect(profile.providerOptions.apiKey).toBeUndefined()
    expect(profile.providerOptions.vertex).toEqual({
      projectId: 'profile-project',
      region: 'us-central1',
      clientEmail: 'svc@profile-project.iam.gserviceaccount.com',
      privateKey: 'profile-private-key',
    })
    expect(buildProfileProviderCapabilityInput(profile)).toEqual(profile.providerCapabilityInput)
  })

  it('does not treat a cached Vertex access token as a profile credential', () => {
    const profile = resolveModelProfile({
      database: db({
        aiModel: 'gemini-2.5-pro-vertex',
        google: { accessToken: 'studio-key-ignored-for-vertex', projectId: 'profile-project' },
        vertexRegion: 'us-central1',
        vertexClientEmail: 'svc@profile-project.iam.gserviceaccount.com',
        vertexAccessToken: 'cached-token-not-a-profile-credential',
      } as Partial<Database>),
      lookupModelInfo: (_database, id) =>
        modelInfo({
          id,
          name: 'Gemini Vertex Profile',
          internalID: 'models/gemini-profile-vertex-wire-model',
          provider: LLMProvider.VertexAI,
          format: LLMFormat.VertexAIGemini,
          flags: [LLMFlags.hasFirstSystemPrompt],
          tokenizer: LLMTokenizer.GoogleCloud,
        }),
    })

    expect(profile.providerOptions.apiKey).toBeUndefined()
    expect(profile.providerOptions.vertex).toMatchObject({
      projectId: 'profile-project',
      region: 'us-central1',
      clientEmail: 'svc@profile-project.iam.gserviceaccount.com',
    })
    expect(profile.providerOptions.vertex?.privateKey).toBeUndefined()
    expect(profile.providerCapability).toEqual({ routable: false, reason: 'config-incomplete' })
  })

  it('normalizes OpenAI-compatible key identifier models', () => {
    const profile = resolveModelProfile({
      database: db({
        aiModel: 'deepseek-chat',
        OaiCompAPIKeys: { deepseek: 'deepseek-key' },
      } as Partial<Database>),
    })

    expect(profile.modelInfo).toMatchObject({
      id: 'deepseek-chat',
      endpoint: 'https://api.deepseek.com/beta/chat/completions',
      keyIdentifier: 'deepseek',
    })
    expect(profile.providerCapability).toEqual({ routable: true, provider: 'openai' })
    expect(profile.providerOptions).toMatchObject({
      apiKey: 'deepseek-key',
      baseUrl: 'https://api.deepseek.com/beta',
    })
  })

  it('marks unknown OpenAI-compatible ids as server-unsupported while storage remains flat', () => {
    const profile = resolveModelProfile({
      database: db({
        aiModel: 'unregistered-local-model',
        openAIKey: 'sk-server-owned',
      } as Partial<Database>),
    })

    expect(profile.modelInfo.unsupportedReason).toBe(
      'unsupported /chat provider: unknown OpenAI-compatible model "unregistered-local-model" cannot be dispatched by the server',
    )
  })

  it('lets custom flags override lookup-provided model metadata and exposes runtime options', () => {
    const profile = resolveModelProfile({
      database: db({
        aiModel: 'lookup-model',
        enableCustomFlags: true,
        customFlags: [LLMFlags.hasImageInput],
        modelTools: ['tool-a'],
        temperature: 65,
        maxResponse: 1024,
      } as Partial<Database>),
      lookupModelInfo: (_database, id) =>
        modelInfo({
          id,
          name: 'Lookup Model',
          flags: [LLMFlags.hasStreaming],
        }),
    })

    expect(profile.modelInfo.flags).toEqual([LLMFlags.hasImageInput])
    expect(profile.runtimeOptions).toMatchObject({
      temperature: 0.65,
      maxResponse: 1024,
      modelTools: ['tool-a'],
      customFlags: [LLMFlags.hasImageInput],
    })
  })

  it('exports provider capability input and request model helpers for resolved profiles', () => {
    const profile = resolveModelProfile({
      database: db({
        aiModel: 'openrouter',
        openrouterRequestModel: 'openai/gpt-5',
      } as Partial<Database>),
    })

    expect(buildProfileProviderCapabilityInput(profile)).toEqual(profile.providerCapabilityInput)
    expect(resolveProfileRequestModel(profile)).toBe('openai/gpt-5')
  })
})
