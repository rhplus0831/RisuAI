import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../modules', async (importActual) => {
  const actual = await importActual<typeof import('../../modules')>()
  return { ...actual, moduleUpdate: () => {}, getModuleToggles: () => '', getModuleTriggers: () => [] }
})

import { resolveModelProfile, type ResolvedModelProfile } from '../../../model/modelProfileResolver'
import { LLMFlags, LLMFormat, LLMProvider, LLMTokenizer, OpenAIParameters, type LLMModel } from '../../../model/types'
import { getDatabase, setDatabase, type Database } from '../../../storage/database.svelte'
import { requestOpenAI } from '../openAI/requests'
import type { RequestDataArgumentExtended } from '../request'

interface PreviewPayload {
  url: string
  body: Record<string, any>
  headers: Record<string, string>
}

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
    useStreaming: false,
    genTime: 1,
    extractJson: '',
    OaiCompAPIKeys: {},
    openrouterProvider: { order: [], only: [], ignore: [] },
    localNetworkMode: false,
    gptVisionQuality: 'auto',
    newOAIHandle: false,
    ...overrides,
  } as unknown as Database
}

function modelInfo(overrides: Partial<LLMModel>): LLMModel {
  return {
    id: 'test-model',
    name: 'Test Model',
    provider: LLMProvider.OpenAI,
    format: LLMFormat.OpenAICompatible,
    flags: [LLMFlags.hasFullSystemPrompt],
    parameters: OpenAIParameters,
    tokenizer: LLMTokenizer.Unknown,
    ...overrides,
  }
}

function customModel(overrides: Partial<Database['customModels'][number]>): Database['customModels'][number] {
  return {
    id: 'xcustom:::profile',
    name: 'Custom Profile',
    internalId: 'profile-custom-wire',
    url: 'https://profile.custom.example/v1/chat/completions',
    key: 'sk-profile-custom',
    format: LLMFormat.OpenAICompatible,
    tokenizer: LLMTokenizer.Unknown,
    flags: [LLMFlags.hasFullSystemPrompt],
    params: '',
    ...overrides,
  } as Database['customModels'][number]
}

function makeArg(
  profile: ResolvedModelProfile,
  overrides: Partial<RequestDataArgumentExtended> = {},
): RequestDataArgumentExtended {
  return {
    formated: [
      { role: 'system', content: 'profile system' },
      { role: 'user', content: 'hello' },
    ],
    bias: {},
    biasString: [],
    aiModel: profile.modelId,
    maxTokens: 64,
    useStreaming: false,
    previewBody: true,
    mode: 'model',
    modelInfo: profile.modelInfo,
    resolvedProfile: profile,
    ...overrides,
  } as RequestDataArgumentExtended
}

async function preview(arg: RequestDataArgumentExtended): Promise<PreviewPayload> {
  const result = await requestOpenAI(arg)
  expect(result.type).toBe('success')
  return JSON.parse(result.result) as PreviewPayload
}

beforeEach(() => {
  vi.stubGlobal('safeStructuredClone', (value: unknown) =>
    value === undefined ? undefined : JSON.parse(JSON.stringify(value)),
  )
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('requestOpenAI profile provider options', () => {
  it('uses reverse_proxy profile URL, key, request model, additional params, Ooba hoist, and Ooba args over flat DB conflicts', async () => {
    const profile = resolveModelProfile({
      database: db({
        aiModel: 'reverse_proxy',
        forceReplaceUrl: 'risu::https://profile.proxy.example/v1',
        proxyKey: 'sk-profile-proxy',
        customProxyRequestModel: 'profile-proxy-model',
        additionalParams: [
          ['profile_param', '"from-profile"'],
          ['header::X-Profile-Param', 'profile-header'],
        ],
        reverseProxyOobaMode: true,
        reverseProxyOobaArgs: { profile_ooba_arg: 7 },
        genTime: 4,
      } as Partial<Database>),
    })
    setDatabase(
      db({
        aiModel: 'reverse_proxy',
        forceReplaceUrl: 'risu::https://flat.proxy.example/v1',
        proxyKey: 'sk-flat-proxy',
        proxyRequestModel: 'flat-proxy-wrapper',
        customProxyRequestModel: 'flat-proxy-model',
        additionalParams: [
          ['flat_param', '"from-flat"'],
          ['header::X-Flat-Param', 'flat-header'],
        ],
        reverseProxyOobaMode: false,
        reverseProxyOobaArgs: { flat_ooba_arg: 9 },
        genTime: 9,
      } as Partial<Database>),
    )

    const payload = await preview(makeArg(profile, { multiGen: true }))

    expect(payload.url).toBe('https://profile.proxy.example/v1/chat/completions')
    expect(payload.headers.Authorization).toBe('Bearer sk-profile-proxy')
    expect(payload.headers['X-Proxy-Risu']).toBe('RisuAI')
    expect(payload.headers['X-Profile-Param']).toBe('profile-header')
    expect(payload.headers['X-Flat-Param']).toBeUndefined()
    expect(payload.body.model).toBe('profile-proxy-model')
    expect(payload.body.profile_param).toBe('from-profile')
    expect(payload.body.flat_param).toBeUndefined()
    expect(payload.body.profile_ooba_arg).toBe(7)
    expect(payload.body.flat_ooba_arg).toBeUndefined()
    expect(payload.body.n).toBe(4)
    expect(payload.body.messages.at(-1)).toMatchObject({ role: 'system', content: 'profile system' })
  })

  it('uses xcustom profile URL, key, internal id, and params over flat custom model conflicts', async () => {
    const modelId = 'xcustom:::profile-openai'
    const profile = resolveModelProfile({
      database: db({
        aiModel: modelId,
        customModels: [
          customModel({
            id: modelId,
            internalId: 'profile-custom-wire',
            url: 'https://profile.custom.example/v1/chat/completions',
            key: 'sk-profile-custom',
            params: 'profile_param="custom-profile"\nheader::X-Custom-Profile=profile-header',
          }),
        ] as Database['customModels'],
      }),
    })
    setDatabase(
      db({
        aiModel: modelId,
        customModels: [
          customModel({
            id: modelId,
            internalId: 'flat-custom-wire',
            url: 'https://flat.custom.example/v1/chat/completions',
            key: 'sk-flat-custom',
            params: 'flat_param="custom-flat"\nheader::X-Custom-Flat=flat-header',
          }),
        ] as Database['customModels'],
      }),
    )

    const payload = await preview(
      makeArg(profile, {
        modelInfo: modelInfo({
          id: modelId,
          internalID: 'flat-arg-custom-wire',
          format: LLMFormat.OpenAICompatible,
        }),
      }),
    )

    expect(payload.url).toBe('https://profile.custom.example/v1/chat/completions')
    expect(payload.headers.Authorization).toBe('Bearer sk-profile-custom')
    expect(payload.headers['X-Custom-Profile']).toBe('profile-header')
    expect(payload.headers['X-Custom-Flat']).toBeUndefined()
    expect(payload.body.model).toBe('profile-custom-wire')
    expect(payload.body.profile_param).toBe('custom-profile')
    expect(payload.body.flat_param).toBeUndefined()
  })

  it('uses OpenRouter profile key, request model, route, transforms, and provider filters over flat conflicts', async () => {
    const profile = resolveModelProfile({
      database: db({
        aiModel: 'openrouter',
        openrouterKey: 'sk-profile-openrouter',
        openrouterRequestModel: 'profile/provider-model',
        openrouterFallback: true,
        openrouterMiddleOut: true,
        openrouterProvider: {
          order: ['ProfileProvider'],
          only: ['profile-only'],
          ignore: ['profile-ignore'],
        },
      } as Partial<Database>),
    })
    setDatabase(
      db({
        aiModel: 'openrouter',
        openrouterKey: 'sk-flat-openrouter',
        openrouterRequestModel: 'flat/provider-model',
        openrouterFallback: false,
        openrouterMiddleOut: false,
        openrouterProvider: {
          order: ['FlatProvider'],
          only: ['flat-only'],
          ignore: ['flat-ignore'],
        },
      } as Partial<Database>),
    )

    const payload = await preview(makeArg(profile))

    expect(payload.url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(payload.headers.Authorization).toBe('Bearer sk-profile-openrouter')
    expect(payload.headers['X-Title']).toBe('RisuAI')
    expect(payload.headers['HTTP-Referer']).toBe('https://risuai.xyz')
    expect(payload.body.model).toBe('profile/provider-model')
    expect(payload.body.route).toBe('fallback')
    expect(payload.body.transforms).toEqual(['middle-out'])
    expect(payload.body.provider).toEqual({
      order: ['ProfileProvider'],
      only: ['profile-only'],
      ignore: ['profile-ignore'],
    })
  })

  it('uses NanoGPT profile key, request model, provider header, and subscription endpoint over flat conflicts', async () => {
    const profile = resolveModelProfile({
      database: db({
        aiModel: 'nanogpt',
        nanogptKey: 'sk-profile-nano',
        nanogptRequestModel: 'profile/nano-model',
        nanogptProvider: 'profile-provider',
        nanogptUseSubscriptionEndpoint: true,
        nanogptSubscriptionState: 'active',
      } as Partial<Database>),
    })
    setDatabase(
      db({
        aiModel: 'nanogpt',
        nanogptKey: 'sk-flat-nano',
        nanogptRequestModel: 'flat/nano-model',
        nanogptProvider: 'flat-provider',
        nanogptUseSubscriptionEndpoint: false,
      } as Partial<Database>),
    )

    const payload = await preview(makeArg(profile))

    expect(payload.url).toBe('https://nano-gpt.com/api/subscription/v1/chat/completions')
    expect(payload.headers.Authorization).toBe('Bearer sk-profile-nano')
    expect(payload.headers['X-Provider']).toBe('profile-provider')
    expect(payload.body.model).toBe('profile/nano-model')
  })

  it('uses key-identifier profile key and base URL over conflicting flat OaiCompAPIKeys', async () => {
    const keyedInfo = modelInfo({
      id: 'profile-keyed-model',
      name: 'Profile Keyed Model',
      provider: LLMProvider.DeepSeek,
      endpoint: 'https://profile.keyed.example/v1/chat/completions',
      keyIdentifier: 'deepseek',
    })
    const profile = resolveModelProfile({
      database: db({
        aiModel: 'profile-keyed-model',
        OaiCompAPIKeys: { deepseek: 'sk-profile-keyed' },
      } as Partial<Database>),
      lookupModelInfo: () => keyedInfo,
    })
    setDatabase(
      db({
        aiModel: 'gpt-5',
        OaiCompAPIKeys: { deepseek: 'sk-flat-keyed' },
      } as Partial<Database>),
    )

    const payload = await preview(
      makeArg(profile, {
        modelInfo: modelInfo({
          id: 'profile-keyed-model',
          internalID: 'flat-keyed-wire',
          provider: LLMProvider.DeepSeek,
          endpoint: 'https://flat.keyed.example/v1/chat/completions',
          keyIdentifier: 'deepseek',
        }),
      }),
    )

    expect(payload.url).toBe('https://profile.keyed.example/v1/chat/completions')
    expect(payload.headers.Authorization).toBe('Bearer sk-profile-keyed')
    expect(payload.body.model).toBe('profile-keyed-model')
  })

  it('uses ollama-cloud profile API key, request model, and base URL over flat conflicts', async () => {
    const profile = resolveModelProfile({
      database: db({
        aiModel: 'ollama-cloud',
        ollamaApiKey: 'sk-profile-ollama',
        ollamaRequestFormat: LLMFormat.OpenAICompatible,
        ollamaCloudModel: 'profile-ollama-model',
        ollamaModelSource: 'cloud',
      } as Partial<Database>),
    })
    setDatabase(
      db({
        aiModel: 'ollama-cloud',
        ollamaApiKey: 'sk-flat-ollama',
        ollamaRequestFormat: LLMFormat.OpenAICompatible,
        ollamaCloudModel: 'flat-ollama-model',
        ollamaModelSource: 'cloud',
      } as Partial<Database>),
    )

    const payload = await preview(
      makeArg(profile, {
        customURL: 'https://flat.ollama.example/v1/chat/completions',
        key: 'sk-flat-arg-ollama',
        modelInfo: modelInfo({
          id: 'ollama-cloud',
          internalID: 'flat-ollama-wire',
          provider: LLMProvider.Ollama,
          format: LLMFormat.OpenAICompatible,
        }),
      }),
    )

    expect(payload.url).toBe('https://ollama.com/v1/chat/completions')
    expect(payload.headers.Authorization).toBe('Bearer sk-profile-ollama')
    expect(payload.body.model).toBe('profile-ollama-model')
  })

  it('keeps no-resolvedProfile reverse_proxy legacy flat DB fallback behavior', async () => {
    setDatabase(
      db({
        aiModel: 'reverse_proxy',
        forceReplaceUrl: 'risu::https://legacy.proxy.example/v1',
        proxyKey: 'sk-legacy-proxy',
        customProxyRequestModel: 'legacy-proxy-model',
        additionalParams: [
          ['legacy_param', '"from-legacy"'],
          ['header::X-Legacy-Param', 'legacy-header'],
        ],
        reverseProxyOobaMode: true,
        reverseProxyOobaArgs: { legacy_ooba_arg: 3 },
        genTime: 6,
      } as Partial<Database>),
    )

    const payload = await preview({
      formated: [
        { role: 'system', content: 'legacy system' },
        { role: 'user', content: 'hello' },
      ],
      bias: {},
      biasString: [],
      aiModel: 'reverse_proxy',
      maxTokens: 64,
      useStreaming: false,
      previewBody: true,
      mode: 'model',
      multiGen: true,
      customURL: getDatabase().forceReplaceUrl,
      modelInfo: modelInfo({ id: 'reverse_proxy' }),
    } as RequestDataArgumentExtended)

    expect(payload.url).toBe('https://legacy.proxy.example/v1/chat/completions')
    expect(payload.headers.Authorization).toBe('Bearer sk-legacy-proxy')
    expect(payload.headers['X-Proxy-Risu']).toBe('RisuAI')
    expect(payload.headers['X-Legacy-Param']).toBe('legacy-header')
    expect(payload.body.model).toBe('legacy-proxy-model')
    expect(payload.body.legacy_param).toBe('from-legacy')
    expect(payload.body.legacy_ooba_arg).toBe(3)
    expect(payload.body.n).toBe(6)
    expect(payload.body.messages.at(-1)).toMatchObject({ role: 'system', content: 'legacy system' })
  })
})
