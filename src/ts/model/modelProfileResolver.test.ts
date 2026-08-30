import { describe, expect, it } from 'vitest'
import { MASKED_PROVIDER_SECRET } from '../providerSecretMask'
import type { Database } from '../storage/database.svelte'
import { LLMFlags, LLMFormat, LLMProvider, LLMTokenizer, OpenAIParameters, type LLMModel } from './types'
import {
  buildProfileProviderCapabilityInput,
  resolveLegacyFallbackRefs,
  resolveModelProfile,
  resolveModelProfileByProfileId,
  resolveModelProfileTokenizerSelection,
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
    expect(profile.fallbacks).toEqual([])
  })

  it('inherits durable profile bindings from fixed source roles while resolving as the child role', () => {
    const database = db({
      aiModel: 'flat-main-model',
      subModel: 'flat-aux-model',
      fallbackModels: { memory: ['legacy-memory-fallback'] } as unknown as Database['fallbackModels'],
      providerCredentials: [
        { id: 'credential-aux', name: 'Aux', type: 'apiKey', apiKey: 'aux-profile-key' },
        { id: 'credential-main', name: 'Main', type: 'apiKey', apiKey: 'main-profile-key' },
      ],
      modelProfiles: [
        {
          id: 'durable-aux',
          name: 'Durable Aux',
          modelId: 'openrouter',
          providerOptions: {
            credentialId: 'credential-aux',
            requestModel: 'aux/wire',
            openrouter: {
              fallback: false,
              middleOut: true,
              provider: { order: ['ProfileProvider'], only: ['profile-only'], ignore: ['profile-ignore'] },
            },
          },
          runtimeOptions: {
            maxResponse: 256,
            useStreaming: false,
            modelTools: ['tool-a'],
          },
          fallbacks: [{ mode: 'profile', profileId: 'durable-fallback' }],
        },
        {
          id: 'durable-main',
          name: 'Durable Main',
          modelId: 'gpt-5',
          providerOptions: {
            credentialId: 'credential-main',
            requestModel: 'main/wire',
          },
        },
        { id: 'durable-fallback', name: 'Durable Fallback', modelId: 'gpt-5-mini' },
      ],
      modelRoleProfiles: {
        chatAux: { mode: 'profile', profileId: 'durable-aux' },
        memory: { mode: 'inherit' },
        chatMain: { mode: 'profile', profileId: 'durable-main' },
        scriptMain: { mode: 'inherit' },
      },
    } as Partial<Database>)

    const memory = resolveModelProfile({ database, role: 'memory' })

    expect(memory.role).toBe('memory')
    expect(memory.legacyMode).toBe('memory')
    expect(memory.modelId).toBe('openrouter')
    expect(memory.profileId).toBe('durable-aux')
    expect(memory.requestModel).toBe('aux/wire')
    expect(memory.providerOptions).toMatchObject({
      apiKey: 'aux-profile-key',
      openrouter: {
        fallback: false,
        middleOut: true,
        provider: { order: ['ProfileProvider'], only: ['profile-only'], ignore: ['profile-ignore'] },
      },
    })
    expect(memory.runtimeOptions).toMatchObject({
      maxResponse: 256,
      useStreaming: false,
      modelTools: ['tool-a'],
    })
    expect(memory.fallbacks).toEqual([{ kind: 'profile-id', profileId: 'durable-fallback' }])
    expect(memory.source).toMatchObject({
      kind: 'durable-profile',
      role: 'memory',
      legacyMode: 'memory',
      field: 'modelRoleProfiles.memory -> modelRoleProfiles.chatAux',
      profileId: 'durable-aux',
      profileName: 'Durable Aux',
      bypassesRoleResolution: false,
    })

    const scriptMain = resolveModelProfile({ database, role: 'scriptMain' })

    expect(scriptMain.role).toBe('scriptMain')
    expect(scriptMain.legacyMode).toBe('scriptMain')
    expect(scriptMain.modelId).toBe('gpt-5')
    expect(scriptMain.profileId).toBe('durable-main')
    expect(scriptMain.requestModel).toBe('main/wire')
    expect(scriptMain.providerOptions.apiKey).toBe('main-profile-key')
    expect(scriptMain.source).toMatchObject({
      role: 'scriptMain',
      legacyMode: 'scriptMain',
      field: 'modelRoleProfiles.scriptMain -> modelRoleProfiles.chatMain',
      profileId: 'durable-main',
    })
  })

  it('falls back to child legacy resolution when inherited source bindings are legacy or absent', () => {
    const lookupModelInfo = (_database: Database, id: string) => modelInfo({ id, name: id, internalID: id })

    for (const database of [
      db({
        subModel: 'flat-aux-model',
        modelRoles: { memory: 'memory-role-model' } as Database['modelRoles'],
        modelRoleProfiles: {
          chatAux: { mode: 'legacy' },
          memory: { mode: 'inherit' },
        },
      } as unknown as Partial<Database>),
      db({
        subModel: 'flat-aux-model',
        modelRoles: { memory: 'memory-role-model' } as Database['modelRoles'],
        modelRoleProfiles: {
          chatAux: { mode: 'inherit' },
          memory: { mode: 'inherit' },
        },
      } as unknown as Partial<Database>),
    ]) {
      const profile = resolveModelProfile({ database, role: 'memory', lookupModelInfo })

      expect(profile.modelId).toBe('memory-role-model')
      expect(profile.profileId).toBe('legacy:modelRoles.memory:memory-role-model')
      expect(profile.source).toMatchObject({
        kind: 'legacy-modelRoles',
        role: 'memory',
        field: 'modelRoles.memory',
      })
    }
  })

  it('surfaces incomplete state when an inherited source profile binding is broken', () => {
    const lookupModelInfo = (_database: Database, id: string) => modelInfo({ id, name: id, internalID: id })

    const missing = resolveModelProfile({
      database: db({
        subModel: 'flat-aux-model',
        modelRoles: { memory: 'memory-role-model' } as Database['modelRoles'],
        modelRoleProfiles: {
          chatAux: { mode: 'profile', profileId: 'missing-profile' },
          memory: { mode: 'inherit' },
        },
      } as Partial<Database>),
      role: 'memory',
      lookupModelInfo,
    })

    expect(missing.modelId).toBe('')
    expect(missing.profileId).toBe('missing-profile')
    expect(missing.status).toMatchObject({
      bucket: 'incomplete',
      reasons: ['profile-not-found'],
    })
    expect(missing.source).toMatchObject({
      kind: 'durable-profile',
      role: 'memory',
      field: 'modelRoleProfiles.memory -> modelRoleProfiles.chatAux',
      profileId: 'missing-profile',
    })

    const modelMissing = resolveModelProfile({
      database: db({
        subModel: 'flat-aux-model',
        modelRoles: { memory: 'memory-role-model' } as Database['modelRoles'],
        modelProfiles: [{ id: 'durable-aux', name: 'Durable Aux' }],
        modelRoleProfiles: {
          chatAux: { mode: 'profile', profileId: 'durable-aux' },
          memory: { mode: 'inherit' },
        },
      } as Partial<Database>),
      role: 'memory',
      lookupModelInfo,
    })

    expect(modelMissing.modelId).toBe('')
    expect(modelMissing.profileId).toBe('durable-aux')
    expect(modelMissing.status).toMatchObject({
      bucket: 'incomplete',
      reasons: ['profile-model-missing'],
    })
  })

  it('emits durable profile-id fallback refs from a selected durable profile', () => {
    const database = db({
      fallbackModels: { model: ['legacy-fallback'] } as unknown as Database['fallbackModels'],
      modelProfiles: [
        {
          id: 'durable-main',
          name: 'Durable Main',
          modelId: 'gpt-5',
          fallbacks: [
            { mode: 'profile', profileId: 'durable-fallback-a' },
            { mode: 'profile', profileId: 'durable-fallback-b' },
          ],
        },
        { id: 'durable-fallback-a', name: 'Durable Fallback A', modelId: 'gpt-5-mini' },
        { id: 'durable-fallback-b', name: 'Durable Fallback B', modelId: 'gpt-5-nano' },
      ],
      modelRoleProfiles: {
        chatMain: { mode: 'profile', profileId: 'durable-main' },
      },
    } as Partial<Database>)

    const profile = resolveModelProfile({ database, role: 'chatMain' })

    expect(profile.fallbacks).toEqual([
      { kind: 'profile-id', profileId: 'durable-fallback-a' },
      { kind: 'profile-id', profileId: 'durable-fallback-b' },
    ])
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

  it('marks missing or model-less explicit durable profiles incomplete', () => {
    const lookupModelInfo = (_database: Database, id: string) => modelInfo({ id, name: id, internalID: id })

    const missing = resolveModelProfile({
      database: db({
        aiModel: 'flat-main-model',
        modelProfiles: [{ id: 'durable-main', name: 'Durable Main', modelId: 'durable-selected-model' }],
        modelRoleProfiles: {
          chatMain: { mode: 'profile', profileId: 'missing-profile' },
        },
      } as Partial<Database>),
      role: 'chatMain',
      lookupModelInfo,
    })

    expect(missing.modelId).toBe('')
    expect(missing.profileId).toBe('missing-profile')
    expect(missing.source).toMatchObject({ kind: 'durable-profile', field: 'modelRoleProfiles.chatMain' })
    expect(missing.status).toMatchObject({ bucket: 'incomplete', reasons: ['profile-not-found'] })

    for (const modelProfiles of [
      [{ id: 'durable-main', name: 'Durable Main', modelId: '   ' }],
      [{ id: 'durable-main', name: 'Durable Main' }],
    ]) {
      const profile = resolveModelProfile({
        database: db({
          aiModel: 'flat-main-model',
          modelProfiles,
          modelRoleProfiles: {
            chatMain: { mode: 'profile', profileId: 'durable-main' },
          },
        } as Partial<Database>),
        role: 'chatMain',
        lookupModelInfo,
      })

      expect(profile.modelId).toBe('')
      expect(profile.profileId).toBe('durable-main')
      expect(profile.source).toMatchObject({ kind: 'durable-profile', field: 'modelRoleProfiles.chatMain' })
      expect(profile.status).toMatchObject({ bucket: 'incomplete', reasons: ['profile-model-missing'] })
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

  it('resolves a direct durable fallback profile without recursive fallback refs', () => {
    const database = db({
      providerCredentials: [{ id: 'credential-fallback', name: 'Fallback', type: 'apiKey', apiKey: 'fallback-key' }],
      modelProfiles: [
        {
          id: 'fallback-profile',
          name: 'Fallback Profile',
          modelId: 'openrouter',
          providerOptions: {
            requestModel: 'fallback/wire',
            credentialId: 'credential-fallback',
          },
          runtimeOptions: {
            maxResponse: 128,
          },
          fallbacks: [{ mode: 'profile', profileId: 'must-not-expand' }],
        },
      ],
    } as Partial<Database>)

    const profile = resolveModelProfileByProfileId({
      database,
      role: 'memory',
      profileId: 'fallback-profile',
    })

    expect(profile).toMatchObject({
      modelId: 'openrouter',
      requestModel: 'fallback/wire',
      providerOptions: { apiKey: 'fallback-key' },
      runtimeOptions: { maxResponse: 128 },
      source: {
        kind: 'durable-profile',
        field: 'fallbackProfileId',
        profileId: 'fallback-profile',
        bypassesRoleResolution: true,
      },
      fallbacks: [],
    })
    expect(resolveModelProfileByProfileId({ database, role: 'memory', profileId: 'missing' })).toBeNull()
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

  it('prefers dereferenced profile credentials over flat keys only for the selected profile', () => {
    const openrouter = resolveModelProfile({
      database: db({
        aiModel: 'flat-main-model',
        openrouterKey: 'flat-openrouter-key',
        openrouterRequestModel: 'flat/openrouter',
        providerCredentials: [
          { id: 'credential-openrouter', name: 'OpenRouter', type: 'apiKey', apiKey: ' profile-openrouter-key ' },
          { id: 'credential-unused', name: 'Unused', type: 'apiKey', apiKey: 'must-not-borrow' },
        ],
        modelProfiles: [
          {
            id: 'openrouter-profile',
            name: 'OpenRouter Profile',
            modelId: 'openrouter',
            providerOptions: {
              credentialId: 'credential-openrouter',
              requestModel: 'profile/openrouter',
            },
          },
          {
            id: 'unused-profile',
            name: 'Unused Profile',
            modelId: 'openrouter',
            providerOptions: {
              credentialId: 'credential-unused',
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
        providerCredentials: [{ id: 'credential-proxy', name: 'Proxy', type: 'apiKey', apiKey: 'profile-proxy-key' }],
        modelProfiles: [
          {
            id: 'proxy-profile',
            name: 'Proxy Profile',
            modelId: 'reverse_proxy',
            providerOptions: {
              credentialId: 'credential-proxy',
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
        providerCredentials: [
          { id: 'credential-deepseek', name: 'DeepSeek', type: 'apiKey', apiKey: 'profile-deepseek-key' },
        ],
        modelProfiles: [
          {
            id: 'deepseek-profile',
            name: 'DeepSeek Profile',
            modelId: 'deepseek-chat',
            providerOptions: { credentialId: 'credential-deepseek' },
          },
        ],
        modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'deepseek-profile' } },
      } as unknown as Partial<Database>),
    })

    expect(keyIdentifier.providerOptions.apiKey).toBe('profile-deepseek-key')
    expect(keyIdentifier.providerCapabilityInput.config.oaiCompApiKeys).toMatchObject({
      deepseek: 'profile-deepseek-key',
    })
    expect(keyIdentifier.providerCapability).toEqual({ routable: true, provider: 'openai' })
  })

  it('falls back to flat provider keys when a durable profile credential reference is blank or missing', () => {
    for (const providerOptions of [undefined, { credentialId: '   ' }]) {
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

  it('does not let staticModel or broken durable selections borrow a selected durable profile apiKey', () => {
    const database = db({
      aiModel: 'openrouter',
      openrouterKey: 'flat-openrouter-key',
      openrouterRequestModel: 'flat/openrouter',
      providerCredentials: [
        { id: 'credential-openrouter', name: 'OpenRouter', type: 'apiKey', apiKey: 'profile-openrouter-key' },
      ],
      modelProfiles: [
        {
          id: 'openrouter-profile',
          name: 'OpenRouter Profile',
          modelId: 'openrouter',
          providerOptions: { credentialId: 'credential-openrouter', requestModel: 'profile/openrouter' },
        },
      ],
      modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'openrouter-profile' } },
    } as Partial<Database>)

    const staticProfile = resolveModelProfile({ database, role: 'chatMain', staticModel: 'openrouter' })
    expect(staticProfile.source.kind).toBe('staticModel')
    expect(staticProfile.requestModel).toBe('flat/openrouter')
    expect(staticProfile.providerOptions.apiKey).toBe('flat-openrouter-key')

    const brokenProfile = resolveModelProfile({
      database: {
        ...database,
        modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'missing-profile' } },
      } as Database,
      role: 'chatMain',
    })
    expect(brokenProfile.source.kind).toBe('durable-profile')
    expect(brokenProfile.status).toMatchObject({ bucket: 'incomplete', reasons: ['profile-not-found'] })
    expect(brokenProfile.providerOptions.apiKey).toBeUndefined()
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
      } as unknown as Partial<Database>),
    })

    expect(profile.modelId).toBe('reverse_proxy')
    expect(profile.requestModel).toBe('profile-proxy-model')
    expect(profile.providerCapability).toEqual({ routable: true, provider: 'openai' })
    expect(profile.providerCapabilityInput).toMatchObject({
      config: {
        forceReplaceUrl: 'https://profile-proxy.example.com/v1/chat/completions',
        proxyKey: 'flat-proxy-key',
      },
    })
    expect(profile.providerOptions).toMatchObject({
      apiKey: 'flat-proxy-key',
      baseUrl: 'https://profile-proxy.example.com/v1/chat/completions',
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

  it('dereferences a packed Bedrock credential string and normalizes its request model', () => {
    const profile = resolveModelProfile({
      database: db({
        providerCredentials: [
          {
            id: 'credential-bedrock',
            name: 'Bedrock',
            type: 'apiKey',
            apiKey: 'bedrock-access:bedrock-secret:ap-southeast-2',
          },
        ],
        modelProfiles: [
          {
            id: 'bedrock-profile',
            name: 'Bedrock Profile',
            modelId: 'anthropic.claude-sonnet-4-5-20250929-v1:0',
            providerOptions: { credentialId: 'credential-bedrock' },
          },
        ],
        modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'bedrock-profile' } },
      } as Partial<Database>),
    })

    expect(profile.modelInfo.format).toBe(LLMFormat.AWSBedrockClaude)
    expect(profile.modelInfo.flags).toContain(LLMFlags.claudeThinking)
    expect(profile.modelInfo.parameters).toContain('thinking_tokens')
    expect(profile.providerCapability).toEqual({ routable: true, provider: 'bedrock' })
    expect(profile.requestModel).toBe('anthropic.claude-sonnet-4-5-20250929-v1:0')
    expect(profile.providerOptions).toMatchObject({
      apiKey: 'bedrock-access:bedrock-secret:ap-southeast-2',
      requestModel: 'anthropic.claude-sonnet-4-5-20250929-v1:0',
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

  it('prefers selected durable runtime options field-by-field over flat runtime settings', () => {
    const database = db({
      aiModel: 'flat-main-model',
      maxContext: 8192,
      maxResponse: 512,
      temperature: 40,
      top_p: 0.95,
      frequencyPenalty: -50,
      useStreaming: true,
      halfStreaming: false,
      genTime: 1,
      extractJson: 'flat-json',
      jsonSchemaEnabled: false,
      jsonSchema: 'flat-schema',
      modelTools: ['flat-tool'],
      customFlags: [LLMFlags.hasStreaming],
      customTokenizer: 'flat-tokenizer',
      modelProfiles: [
        {
          id: 'durable-main',
          name: 'Durable Main',
          modelId: 'durable-selected-model',
          runtimeOptions: {
            maxContext: 32768,
            maxResponse: 2048,
            temperature: 75,
            topP: 0.8,
            frequencyPenalty: 25,
            useStreaming: false,
            halfStreaming: true,
            genTime: 3,
            extractJson: ' profile-json ',
            jsonSchema: '   ',
            jsonSchemaEnabled: true,
            modelTools: [' profile-tool ', ''],
            customFlags: [LLMFlags.hasImageInput],
            customTokenizer: ' profile-tokenizer ',
          },
        },
        {
          id: 'unused-profile',
          name: 'Unused Profile',
          modelId: 'durable-selected-model',
          runtimeOptions: {
            maxContext: 999,
            modelTools: ['must-not-borrow'],
          },
        },
      ],
      modelRoleProfiles: {
        chatMain: { mode: 'profile', profileId: 'durable-main' },
      },
    } as Partial<Database>)

    const profile = resolveModelProfile({
      database,
      role: 'chatMain',
      lookupModelInfo: (_database, id) => modelInfo({ id, name: id, internalID: id }),
    })

    expect(profile.runtimeOptions).toMatchObject({
      maxContext: 32768,
      maxResponse: 2048,
      temperature: 0.75,
      rawTemperature: 75,
      topP: 0.8,
      frequencyPenalty: 0.25,
      useStreaming: false,
      halfStreaming: true,
      genTime: 3,
      extractJson: 'profile-json',
      jsonSchema: '',
      jsonSchemaEnabled: true,
      modelTools: ['profile-tool'],
      customFlags: [LLMFlags.hasImageInput],
      customTokenizer: 'profile-tokenizer',
    })
    expect(profile.runtimeOptions.modelTools).not.toBe(
      (database.modelProfiles?.[0] as { runtimeOptions?: { modelTools?: string[] } }).runtimeOptions?.modelTools,
    )
    expect(profile.runtimeOptions.customFlags).not.toBe(
      (database.modelProfiles?.[0] as { runtimeOptions?: { customFlags?: LLMFlags[] } }).runtimeOptions?.customFlags,
    )
  })

  it('uses flat runtime settings for static models and profile defaults for broken durable selections', () => {
    const database = db({
      aiModel: 'flat-main-model',
      maxContext: 8192,
      maxResponse: 512,
      temperature: 55,
      top_p: 0.91,
      frequencyPenalty: 10,
      useStreaming: true,
      genTime: 2,
      extractJson: 'flat-json',
      jsonSchemaEnabled: false,
      modelTools: ['flat-tool'],
      customFlags: [LLMFlags.hasStreaming],
      customTokenizer: 'flat-tokenizer',
      modelProfiles: [
        {
          id: 'durable-main',
          name: 'Durable Main',
          modelId: 'openrouter',
          runtimeOptions: {
            maxContext: 32768,
            temperature: 90,
            modelTools: ['profile-tool'],
            customFlags: [LLMFlags.hasImageInput],
          },
        },
      ],
      modelRoleProfiles: {
        chatMain: { mode: 'profile', profileId: 'durable-main' },
      },
    } as Partial<Database>)

    const staticProfile = resolveModelProfile({
      database,
      role: 'chatMain',
      staticModel: 'openrouter',
      lookupModelInfo: (_database, id) => modelInfo({ id, name: id, internalID: id }),
    })
    expect(staticProfile.source.kind).toBe('staticModel')
    expect(staticProfile.runtimeOptions).toMatchObject({
      maxContext: 8192,
      maxResponse: 512,
      temperature: 0.55,
      rawTemperature: 55,
      topP: 0.91,
      frequencyPenalty: 0.1,
      useStreaming: true,
      genTime: 2,
      extractJson: 'flat-json',
      jsonSchemaEnabled: false,
      modelTools: ['flat-tool'],
      customFlags: [LLMFlags.hasStreaming],
      customTokenizer: 'flat-tokenizer',
    })

    const brokenProfile = resolveModelProfile({
      database: {
        ...database,
        modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'missing-profile' } },
      } as Database,
      role: 'chatMain',
      lookupModelInfo: (_database, id) => modelInfo({ id, name: id, internalID: id }),
    })
    expect(brokenProfile.source.kind).toBe('durable-profile')
    expect(brokenProfile.status).toMatchObject({ bucket: 'incomplete', reasons: ['profile-not-found'] })
    expect(brokenProfile.runtimeOptions).toMatchObject({
      maxContext: 4000,
      maxResponse: 500,
      temperature: 0.8,
      rawTemperature: 80,
      topP: 1,
      topK: 0,
      frequencyPenalty: 0.7,
      presencePenalty: 0.7,
      useStreaming: false,
      genTime: 1,
      modelTools: [],
      customFlags: [],
    })
  })

  it('applies profile runtime precedence as hard defaults, modelRuntimeDefaults, then profile runtimeOptions', () => {
    const profile = resolveModelProfile({
      database: db({
        maxContext: 999,
        maxResponse: 888,
        temperature: 10,
        modelTools: ['flat-tool'],
        modelRuntimeDefaults: {
          maxContext: 12000,
          maxResponse: 700,
          temperature: 35,
          topP: 0.7,
          useStreaming: true,
          stripCoT: true,
          modelTools: ['default-tool'],
        },
        modelProfiles: [
          {
            id: 'durable-main',
            name: 'Durable Main',
            modelId: 'gpt-5',
            runtimeOptions: {
              maxResponse: 2048,
              topP: 0.5,
              stripCoT: false,
              modelTools: ['profile-tool'],
            },
          },
        ],
        modelRoleProfiles: {
          chatMain: { mode: 'profile', profileId: 'durable-main' },
        },
      } as Partial<Database>),
      role: 'chatMain',
    })

    expect(profile.runtimeOptions).toMatchObject({
      maxContext: 12000,
      maxResponse: 2048,
      temperature: 0.35,
      rawTemperature: 35,
      topP: 0.5,
      useStreaming: true,
      stripCoT: false,
      modelTools: ['profile-tool'],
    })
  })

  it('resolves tokenizer selection from profile-local, provider-local, then global durable configuration', () => {
    const database = db({
      customTokenizer: 'flat-tokenizer',
      modelRuntimeDefaults: { customTokenizer: ' default-tokenizer ' },
      modelProfiles: [
        {
          id: 'runtime-tokenizer',
          name: 'Runtime tokenizer',
          modelId: 'openrouter',
          runtimeOptions: { customTokenizer: ' profile-tokenizer ' },
          providerOptions: { customApi: { tokenizer: LLMTokenizer.tiktokenO200Base } },
        },
        {
          id: 'provider-tokenizer',
          name: 'Provider tokenizer',
          modelId: 'openrouter',
          providerOptions: { customApi: { tokenizer: LLMTokenizer.tiktokenO200Base } },
        },
        {
          id: 'default-tokenizer',
          name: 'Default tokenizer',
          modelId: 'openrouter',
        },
      ],
    } as Partial<Database>)

    const runtime = resolveModelProfileByProfileId({
      database,
      role: 'chatMain',
      profileId: 'runtime-tokenizer',
    })!
    const provider = resolveModelProfileByProfileId({
      database,
      role: 'chatMain',
      profileId: 'provider-tokenizer',
    })!
    const fallback = resolveModelProfileByProfileId({
      database,
      role: 'chatMain',
      profileId: 'default-tokenizer',
    })!

    expect(resolveModelProfileTokenizerSelection(database, runtime)).toBe('profile-tokenizer')
    expect(resolveModelProfileTokenizerSelection(database, provider)).toBe(String(LLMTokenizer.tiktokenO200Base))
    expect(resolveModelProfileTokenizerSelection(database, fallback)).toBe('default-tokenizer')
  })

  it('inherits Strip CoT from runtime defaults unless a profile explicitly overrides it', () => {
    const database = db({
      modelRuntimeDefaults: { stripCoT: true },
      modelProfiles: [
        { id: 'inherited', name: 'Inherited', modelId: 'gpt-5' },
        {
          id: 'disabled',
          name: 'Disabled',
          modelId: 'gpt-5',
          runtimeOptions: { stripCoT: false },
        },
      ],
    } as Partial<Database>)

    expect(
      resolveModelProfileByProfileId({ database, role: 'chatMain', profileId: 'inherited' })?.runtimeOptions.stripCoT,
    ).toBe(true)
    expect(
      resolveModelProfileByProfileId({ database, role: 'chatMain', profileId: 'disabled' })?.runtimeOptions.stripCoT,
    ).toBe(false)
  })

  it('classifies first-class OpenAI profiles from profile-local fields without borrowing global keys', () => {
    const ready = resolveModelProfile({
      database: db({
        openAIKey: 'flat-openai-key',
        providerCredentials: [
          { id: 'credential-openai', name: 'OpenAI', type: 'apiKey', apiKey: 'profile-openai-key' },
        ],
        modelProfiles: [
          {
            id: 'openai-profile',
            name: 'OpenAI Profile',
            providerId: 'openai',
            modelId: 'gpt-5',
            providerOptions: { credentialId: 'credential-openai' },
          },
        ],
        modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'openai-profile' } },
      } as Partial<Database>),
      role: 'chatMain',
    })

    expect(ready.status).toMatchObject({
      bucket: 'ready',
      providerId: 'openai',
      providerIdSource: 'explicit',
    })
    expect(ready.providerOptions.apiKey).toBe('profile-openai-key')
    expect(ready.modelInfo.unsupportedReason).toBeUndefined()

    const projected = resolveModelProfile({
      database: db({
        providerCredentials: [
          { id: 'credential-openai', name: 'OpenAI', type: 'apiKey', apiKey: MASKED_PROVIDER_SECRET },
        ],
        modelProfiles: [
          {
            id: 'openai-profile',
            name: 'OpenAI Profile',
            providerId: 'openai',
            modelId: 'gpt-5',
            providerOptions: { credentialId: 'credential-openai' },
          },
        ],
        modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'openai-profile' } },
      } as Partial<Database>),
      role: 'chatMain',
    })

    expect(projected.status).toMatchObject({
      bucket: 'ready',
      providerId: 'openai',
      providerIdSource: 'explicit',
    })
    expect(projected.providerOptions.apiKey).toBe(MASKED_PROVIDER_SECRET)

    const missingKey = resolveModelProfile({
      database: db({
        openAIKey: 'flat-openai-key',
        modelProfiles: [
          {
            id: 'openai-profile',
            name: 'OpenAI Profile',
            providerId: 'openai',
            modelId: 'gpt-5',
          },
        ],
        modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'openai-profile' } },
      } as Partial<Database>),
      role: 'chatMain',
    })

    expect(missingKey.providerOptions.apiKey).toBeUndefined()
    expect(missingKey.status).toMatchObject({
      bucket: 'incomplete',
      providerId: 'openai',
      reasons: ['api-key-missing'],
    })

    const danglingCredential = resolveModelProfile({
      database: db({
        modelProfiles: [
          {
            id: 'openai-profile',
            name: 'OpenAI Profile',
            providerId: 'openai',
            modelId: 'gpt-5',
            providerOptions: { credentialId: 'missing-credential' },
          },
        ],
        modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'openai-profile' } },
      } as Partial<Database>),
      role: 'chatMain',
    })

    expect(danglingCredential.status).toMatchObject({
      bucket: 'incomplete',
      providerId: 'openai',
      reasons: ['credential-missing', 'api-key-missing'],
    })
  })

  it('resolves first-class LLM Gateway profiles to the fixed managed endpoint', () => {
    const profile = resolveModelProfile({
      database: db({
        providerCredentials: [{ id: 'credential-gateway', name: 'LLM Gateway', type: 'apiKey', apiKey: 'gateway-key' }],
        modelProfiles: [
          {
            id: 'gateway-profile',
            name: 'LLM Gateway Profile',
            providerId: 'llmgateway',
            modelId: 'anthropic/claude-sonnet-4.5',
            providerOptions: {
              credentialId: 'credential-gateway',
              baseUrl: 'https://attacker.example/v1',
              llmGateway: {
                reasoningEffort: 'max',
                verbosity: 'high',
                serviceTier: 'priority',
                routing: 'throughput',
              },
            },
          },
        ],
        modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'gateway-profile' } },
      } as Partial<Database>),
      role: 'chatMain',
    })

    expect(profile.status).toMatchObject({
      bucket: 'ready',
      providerId: 'llmgateway',
      providerIdSource: 'explicit',
    })
    expect(profile.providerCapability).toEqual({ routable: true, provider: 'openai' })
    expect(profile.providerOptions).toMatchObject({
      apiKey: 'gateway-key',
      baseUrl: 'https://api.llmgateway.io/v1',
      requestModel: 'anthropic/claude-sonnet-4.5',
      llmGateway: {
        reasoningEffort: 'max',
        verbosity: 'high',
        serviceTier: 'priority',
        routing: 'throughput',
      },
    })
    expect(profile.modelInfo.flags).toContain(LLMFlags.hasImageInput)
  })

  it('resolves first-class Neuralwatt profiles to the fixed managed endpoint', () => {
    const profile = resolveModelProfile({
      database: db({
        providerCredentials: [
          { id: 'credential-neuralwatt', name: 'Neuralwatt', type: 'apiKey', apiKey: 'neuralwatt-key' },
        ],
        modelProfiles: [
          {
            id: 'neuralwatt-profile',
            name: 'Neuralwatt Profile',
            providerId: 'neuralwatt',
            modelId: 'gemma-4-31b',
            providerOptions: {
              credentialId: 'credential-neuralwatt',
              baseUrl: 'https://attacker.example/v1',
            },
          },
        ],
        modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'neuralwatt-profile' } },
      } as Partial<Database>),
      role: 'chatMain',
    })

    expect(profile.status).toMatchObject({
      bucket: 'ready',
      providerId: 'neuralwatt',
      providerIdSource: 'explicit',
    })
    expect(profile.providerCapability).toEqual({ routable: true, provider: 'openai' })
    expect(profile.providerOptions).toMatchObject({
      apiKey: 'neuralwatt-key',
      baseUrl: 'https://api.neuralwatt.com/v1',
      requestModel: 'gemma-4-31b',
    })
    expect(profile.modelInfo.flags).toContain(LLMFlags.hasImageInput)
  })

  it('classifies inferred, compatibility, unsupported, Vertex, and Custom API profile statuses', () => {
    const inferredOpenAI = resolveModelProfile({
      database: db({
        providerCredentials: [
          { id: 'credential-openai', name: 'OpenAI', type: 'apiKey', apiKey: 'profile-openai-key' },
        ],
        modelProfiles: [
          {
            id: 'inferred-openai',
            name: 'Inferred OpenAI',
            modelId: 'gpt-5',
            providerOptions: { credentialId: 'credential-openai' },
          },
        ],
        modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'inferred-openai' } },
      } as Partial<Database>),
      role: 'chatMain',
    })

    expect(inferredOpenAI.status).toMatchObject({
      bucket: 'ready',
      providerId: 'openai',
      providerIdSource: 'inferred',
      reasons: ['inferred-provider-id'],
    })

    const compatibility = resolveModelProfile({
      database: db({
        openrouterKey: 'openrouter-key',
        modelProfiles: [
          {
            id: 'compat-profile',
            name: 'Compatibility Profile',
            modelId: 'openrouter',
          },
        ],
        modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'compat-profile' } },
      } as Partial<Database>),
      role: 'chatMain',
    })

    expect(compatibility.providerCapability).toEqual({ routable: true, provider: 'openrouter' })
    expect(compatibility.status).toMatchObject({
      bucket: 'compatibility',
      reasons: ['missing-provider-id'],
    })

    const unsupported = resolveModelProfile({
      database: db({
        modelProfiles: [
          {
            id: 'unsupported-profile',
            name: 'Unsupported Profile',
            providerId: 'mistral',
            modelId: 'mistral-large',
          },
        ],
        modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'unsupported-profile' } },
      } as Partial<Database>),
      role: 'chatMain',
    })

    expect(unsupported.status).toMatchObject({
      bucket: 'unsupported',
      reasons: ['unsupported-provider-id'],
      unsupportedProviderId: 'mistral',
    })

    const vertex = resolveModelProfile({
      database: db({
        google: { accessToken: 'flat-google-key', projectId: 'flat-project' },
        vertexRegion: 'global-region',
        vertexClientEmail: 'global-client@example.com',
        vertexPrivateKey: 'global-private-key',
        modelProfiles: [
          {
            id: 'vertex-profile',
            name: 'Vertex Profile',
            providerId: 'vertex',
            modelId: 'gemini-2.5-pro-vertex',
            providerOptions: {
              credentialId: 'missing-vertex-credential',
              vertex: {
                projectId: 'profile-project',
                region: 'profile-region',
              },
            },
          },
        ],
        modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'vertex-profile' } },
      } as Partial<Database>),
      role: 'chatMain',
    })

    expect(vertex.providerOptions.vertex).toEqual({
      projectId: 'profile-project',
      region: 'profile-region',
      clientEmail: undefined,
      privateKey: undefined,
    })
    expect(vertex.status).toMatchObject({
      bucket: 'incomplete',
      providerId: 'vertex',
      reasons: ['credential-missing', 'vertex-client-email-missing', 'vertex-private-key-missing'],
    })

    const readyVertex = resolveModelProfile({
      database: db({
        providerCredentials: [
          {
            id: 'credential-vertex',
            name: 'Vertex',
            type: 'vertexServiceAccount',
            vertex: {
              clientEmail: 'profile-client@example.com',
              privateKey: 'profile-private-key',
            },
          },
        ],
        modelProfiles: [
          {
            id: 'vertex-profile',
            name: 'Vertex Profile',
            providerId: 'vertex',
            modelId: 'gemini-2.5-pro-vertex',
            providerOptions: {
              credentialId: 'credential-vertex',
              vertex: { projectId: 'profile-project', region: 'profile-region' },
            },
          },
        ],
        modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'vertex-profile' } },
      } as Partial<Database>),
      role: 'chatMain',
    })

    expect(readyVertex.providerOptions.vertex).toEqual({
      projectId: 'profile-project',
      region: 'profile-region',
      clientEmail: 'profile-client@example.com',
      privateKey: 'profile-private-key',
    })
    expect(readyVertex.status.bucket).toBe('ready')

    const customApi = resolveModelProfile({
      database: db({
        proxyKey: 'flat-proxy-key',
        modelProfiles: [
          {
            id: 'custom-api-profile',
            name: 'Custom API Profile',
            providerId: 'custom-api',
            modelId: 'custom-api',
            providerOptions: {
              baseUrl: 'http://localhost:1234/v1',
              requestModel: 'local-model',
            },
          },
        ],
        modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'custom-api-profile' } },
      } as Partial<Database>),
      role: 'chatMain',
    })

    expect(customApi.status).toMatchObject({
      bucket: 'ready',
      providerId: 'custom-api',
    })
    expect(customApi.providerOptions).toMatchObject({
      baseUrl: 'http://localhost:1234/v1',
      requestModel: 'local-model',
    })
    expect(customApi.providerOptions.apiKey).toBeUndefined()

    const debugEcho = resolveModelProfile({
      database: db({
        modelProfiles: [
          {
            id: 'debug-echo-profile',
            name: 'Debug Echo Profile',
            providerId: 'debug-echo',
            modelId: 'debug-echo',
            providerOptions: {
              baseUrl: 'debug://base',
              requestModel: 'debug-wire-model',
            },
          },
        ],
        modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'debug-echo-profile' } },
      } as Partial<Database>),
      role: 'chatMain',
    })

    expect(debugEcho.status).toMatchObject({
      bucket: 'ready',
      providerId: 'debug-echo',
    })
    expect(debugEcho.providerCapability).toEqual({ routable: true, provider: 'echo' })
    expect(debugEcho.providerOptions).toMatchObject({
      baseUrl: 'debug://base',
      requestModel: 'debug-wire-model',
    })
  })
})
