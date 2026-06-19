import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../modules', async (importActual) => {
  const actual = await importActual<typeof import('../../modules')>()
  return { ...actual, moduleUpdate: () => {}, getModuleToggles: () => '', getModuleTriggers: () => [] }
})

import { resolveModelProfile, type ResolvedModelProfile } from '../../../model/modelProfileResolver'
import { LLMFlags, LLMFormat, LLMProvider, LLMTokenizer, OpenAIParameters, type LLMModel } from '../../../model/types'
import { getDatabase, setDatabase, type Database } from '../../../storage/database.svelte'
import { requestOpenAILegacyInstruct, requestOpenAIResponseAPI } from '../openAI/requests'
import type { RequestDataArgumentExtended } from '../request'

interface PreviewPayload {
  url: string
  body: Record<string, any>
  headers: Record<string, string>
}

function db(overrides: Partial<Database> = {}): Database {
  return {
    aiModel: 'gpt-5-response-api',
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
    format: LLMFormat.OpenAIResponseAPI,
    flags: [LLMFlags.hasFullSystemPrompt],
    parameters: OpenAIParameters,
    tokenizer: LLMTokenizer.Unknown,
    ...overrides,
  }
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

async function previewResponse(arg: RequestDataArgumentExtended): Promise<PreviewPayload> {
  const result = await requestOpenAIResponseAPI(arg)
  expect(result.type).toBe('success')
  return JSON.parse(result.result) as PreviewPayload
}

async function previewLegacy(arg: RequestDataArgumentExtended): Promise<PreviewPayload> {
  const result = await requestOpenAILegacyInstruct(arg)
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

describe('requestOpenAIResponseAPI profile provider options', () => {
  it('uses reverse_proxy profile URL, key, request model, additional params, and risu header over flat DB conflicts', async () => {
    const profile = resolveModelProfile({
      database: db({
        aiModel: 'reverse_proxy',
        customAPIFormat: LLMFormat.OpenAIResponseAPI,
        forceReplaceUrl: 'risu::https://profile.proxy.example/v1',
        proxyKey: 'sk-profile-proxy',
        customProxyRequestModel: 'profile-responses-model',
        additionalParams: [
          ['profile_param', '"from-profile"'],
          ['header::X-Profile-Param', 'profile-header'],
        ],
      } as Partial<Database>),
    })
    setDatabase(
      db({
        aiModel: 'reverse_proxy',
        customAPIFormat: LLMFormat.OpenAIResponseAPI,
        forceReplaceUrl: 'risu::https://flat.proxy.example/v1',
        proxyKey: 'sk-flat-proxy',
        customProxyRequestModel: 'flat-responses-model',
        additionalParams: [
          ['flat_param', '"from-flat"'],
          ['header::X-Flat-Param', 'flat-header'],
        ],
      } as Partial<Database>),
    )

    const payload = await previewResponse(
      makeArg(profile, {
        customURL: getDatabase().forceReplaceUrl,
        key: 'sk-flat-arg-proxy',
      }),
    )

    expect(payload.url).toBe('https://profile.proxy.example/v1/responses')
    expect(payload.headers.Authorization).toBe('Bearer sk-profile-proxy')
    expect(payload.headers['X-Proxy-Risu']).toBe('RisuAI')
    expect(payload.headers['X-Profile-Param']).toBe('profile-header')
    expect(payload.headers['X-Flat-Param']).toBeUndefined()
    expect(payload.body.model).toBe('profile-responses-model')
    expect(payload.body.profile_param).toBe('from-profile')
    expect(payload.body.flat_param).toBeUndefined()
  })

  it('uses ollama-cloud profile API key, request model, and Responses base URL over flat conflicts', async () => {
    const profile = resolveModelProfile({
      database: db({
        aiModel: 'ollama-cloud',
        ollamaApiKey: 'sk-profile-ollama',
        ollamaRequestFormat: LLMFormat.OpenAIResponseAPI,
        ollamaCloudModel: 'profile-ollama-responses',
        ollamaModelSource: 'cloud',
      } as Partial<Database>),
    })
    setDatabase(
      db({
        aiModel: 'ollama-cloud',
        ollamaApiKey: 'sk-flat-ollama',
        ollamaRequestFormat: LLMFormat.OpenAIResponseAPI,
        ollamaCloudModel: 'flat-ollama-responses',
        ollamaModelSource: 'cloud',
      } as Partial<Database>),
    )

    const payload = await previewResponse(
      makeArg(profile, {
        customURL: 'https://flat.ollama.example/v1/responses',
        key: 'sk-flat-arg-ollama',
        modelInfo: modelInfo({
          id: 'ollama-cloud',
          internalID: 'flat-ollama-wire',
          provider: LLMProvider.Ollama,
          format: LLMFormat.OpenAIResponseAPI,
        }),
      }),
    )

    expect(payload.url).toBe('https://ollama.com/v1/responses')
    expect(payload.headers.Authorization).toBe('Bearer sk-profile-ollama')
    expect(payload.body.model).toBe('profile-ollama-responses')
    expect(payload.body.store).toBeUndefined()
  })
})

describe('requestOpenAILegacyInstruct profile provider options', () => {
  it('uses NanoGPTLegacy profile key, request model, provider header, and completions URL over flat conflicts', async () => {
    const nanoLegacyInfo = modelInfo({
      id: 'nanogpt-legacy-profile',
      name: 'NanoGPT Legacy Profile',
      provider: LLMProvider.NanoGPT,
      format: LLMFormat.NanoGPTLegacy,
    })
    const profile = resolveModelProfile({
      database: db({
        aiModel: nanoLegacyInfo.id,
        nanogptKey: 'sk-profile-nano',
        nanogptRequestModel: 'profile/nano-legacy-model',
        nanogptProvider: 'profile-provider',
      } as Partial<Database>),
      lookupModelInfo: () => nanoLegacyInfo,
    })
    setDatabase(
      db({
        aiModel: nanoLegacyInfo.id,
        nanogptKey: 'sk-flat-nano',
        nanogptRequestModel: 'flat/nano-legacy-model',
        nanogptProvider: 'flat-provider',
        openAIKey: 'sk-flat-openai',
      } as Partial<Database>),
    )

    const payload = await previewLegacy(
      makeArg(profile, {
        key: 'sk-flat-arg-nano',
      }),
    )

    expect(payload.url).toBe('https://nano-gpt.com/api/v1/completions')
    expect(payload.headers.Authorization).toBe('Bearer sk-profile-nano')
    expect(payload.headers['X-Provider']).toBe('profile-provider')
    expect(payload.body.model).toBe('profile/nano-legacy-model')
  })

  it('keeps no-resolvedProfile legacy instruct URL, key, and hard-coded model fallback behavior', async () => {
    setDatabase(
      db({
        aiModel: 'legacy-instruct',
        openAIKey: 'sk-db-openai',
      } as Partial<Database>),
    )

    const payload = await previewLegacy({
      formated: [
        { role: 'system', content: 'legacy system' },
        { role: 'user', content: 'hello' },
      ],
      bias: {},
      biasString: [],
      aiModel: 'legacy-instruct',
      maxTokens: 64,
      useStreaming: false,
      previewBody: true,
      mode: 'model',
      customURL: 'https://legacy.example/v1/completions',
      key: 'sk-arg-openai',
      modelInfo: modelInfo({
        id: 'legacy-instruct',
        internalID: 'flat-legacy-wire',
        format: LLMFormat.OpenAILegacyInstruct,
      }),
    } as RequestDataArgumentExtended)

    expect(payload.url).toBe('https://legacy.example/v1/completions')
    expect(payload.headers.Authorization).toBe('Bearer sk-arg-openai')
    expect(payload.body.model).toBe('gpt-3.5-turbo-instruct')
  })
})
