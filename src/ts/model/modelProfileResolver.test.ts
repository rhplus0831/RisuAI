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
