import { afterEach, describe, expect, it, vi } from 'vitest'
import { LLMFormat } from '../../../src/ts/model/types'
import { resolveModelProfile, type ResolvedModelProfile } from '../../../src/ts/model/modelProfileResolver'
import type { OpenAIChat } from '../../../src/ts/process/index.svelte'
import type { Database } from '../../../src/ts/storage/database.svelte'
import { dispatchChatProvider } from '../src/prompt/chatDispatch.js'

interface CapturedOpenAIRequest {
  url: string
  headers: Record<string, string>
  body: Record<string, unknown>
}

function db(overrides: Partial<Database> = {}): Database {
  return {
    aiModel: 'gpt-5',
    subModel: 'gpt-5-mini',
    modelRoles: {},
    fallbackModels: {},
    customModels: [],
    modelTools: [],
    OaiCompAPIKeys: {},
    maxResponse: 64,
    temperature: 50,
    useStreaming: false,
    ...overrides,
  } as unknown as Database
}

function okOpenAIResponse(text = 'profile ok'): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: text }, finish_reason: 'stop' }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function captureOpenAIRequests(): CapturedOpenAIRequest[] {
  const captured: CapturedOpenAIRequest[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      captured.push({
        url: String(url),
        headers: { ...((init?.headers as Record<string, string> | undefined) ?? {}) },
        body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
      })
      return okOpenAIResponse()
    }) as unknown as typeof fetch,
  )
  return captured
}

async function dispatchWithProfile(
  profile: ResolvedModelProfile,
  database: Database,
  formated: OpenAIChat[] = [{ role: 'user', content: 'hello' }],
): Promise<void> {
  const frames = await dispatchChatProvider({
    database,
    profile,
    formated,
    signal: new AbortController().signal,
  })
  const emitted = []
  for await (const frame of frames) {
    emitted.push(frame)
  }
  expect(emitted).toEqual([
    { kind: 'token', content: 'profile ok' },
    { kind: 'done', finishReason: 'stop' },
  ])
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('dispatchChatProvider profile providerOptions', () => {
  it('uses reverse_proxy profile options over conflicting flat database fields', async () => {
    const profile = resolveModelProfile({
      database: db({
        aiModel: 'reverse_proxy',
        customProxyRequestModel: 'profile-proxy-model',
        customAPIFormat: LLMFormat.OpenAICompatible,
        forceReplaceUrl: 'risu::https://profile-proxy.example.com',
        proxyKey: 'sk-profile-proxy',
        autofillRequestUrl: true,
        reverseProxyOobaMode: true,
        additionalParams: [
          ['header::X-Profile', 'profile'],
          ['profileFlag', 'true'],
        ],
      } as Partial<Database>),
    })
    const flatConflict = db({
      aiModel: 'reverse_proxy',
      customProxyRequestModel: 'flat-proxy-model',
      customAPIFormat: LLMFormat.OpenAICompatible,
      forceReplaceUrl: 'https://flat-proxy.example.com/v1',
      proxyKey: 'sk-flat-proxy',
      autofillRequestUrl: true,
      reverseProxyOobaMode: false,
      additionalParams: [
        ['header::X-Flat', 'flat'],
        ['flatFlag', 'true'],
      ],
    } as Partial<Database>)
    const captured = captureOpenAIRequests()

    await dispatchWithProfile(profile, flatConflict, [
      { role: 'system', content: 'profile system 1' },
      { role: 'user', content: 'hello' },
      { role: 'system', content: 'profile system 2' },
    ])

    expect(captured).toHaveLength(1)
    expect(captured[0].url).toBe('https://profile-proxy.example.com/v1/chat/completions')
    expect(captured[0].headers.authorization).toBe('Bearer sk-profile-proxy')
    expect(captured[0].headers['X-Proxy-Risu']).toBe('RisuAI')
    expect(captured[0].headers['X-Profile']).toBe('profile')
    expect(captured[0].headers['X-Flat']).toBeUndefined()
    expect(captured[0].body.model).toBe('profile-proxy-model')
    expect(captured[0].body.profileFlag).toBe(true)
    expect(captured[0].body.flatFlag).toBeUndefined()
    expect(captured[0].body.messages).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'system', content: 'profile system 1\nprofile system 2' },
    ])
  })

  it.each([
    {
      label: 'OpenRouter',
      profileDatabase: db({
        aiModel: 'openrouter',
        openrouterKey: 'sk-profile-openrouter',
        openrouterRequestModel: 'profile/provider-model',
      } as Partial<Database>),
      flatConflict: db({
        aiModel: 'openrouter',
        openrouterKey: 'sk-flat-openrouter',
        openrouterRequestModel: 'flat/provider-model',
      } as Partial<Database>),
      expectedUrl: 'https://openrouter.ai/api/v1/chat/completions',
      expectedAuthorization: 'Bearer sk-profile-openrouter',
      expectedModel: 'profile/provider-model',
      expectedHeader: ['X-Title', 'RisuAI'] as const,
    },
    {
      label: 'NanoGPT',
      profileDatabase: db({
        aiModel: 'nanogpt',
        nanogptKey: 'sk-profile-nano',
        nanogptRequestModel: 'profile/nano-model',
        nanogptProvider: 'profile-provider',
        nanogptUseSubscriptionEndpoint: true,
      } as Partial<Database>),
      flatConflict: db({
        aiModel: 'nanogpt',
        nanogptKey: 'sk-flat-nano',
        nanogptRequestModel: 'flat/nano-model',
        nanogptProvider: 'flat-provider',
        nanogptUseSubscriptionEndpoint: false,
      } as Partial<Database>),
      expectedUrl: 'https://nano-gpt.com/api/subscription/v1/chat/completions',
      expectedAuthorization: 'Bearer sk-profile-nano',
      expectedModel: 'profile/nano-model',
      expectedHeader: ['X-Provider', 'profile-provider'] as const,
    },
  ])('uses $label profile options over conflicting flat fields', async (testCase) => {
    const profile = resolveModelProfile({ database: testCase.profileDatabase })
    const captured = captureOpenAIRequests()

    await dispatchWithProfile(profile, testCase.flatConflict)

    expect(captured).toHaveLength(1)
    expect(captured[0].url).toBe(testCase.expectedUrl)
    expect(captured[0].headers.authorization).toBe(testCase.expectedAuthorization)
    expect(captured[0].headers[testCase.expectedHeader[0]]).toBe(testCase.expectedHeader[1])
    expect(captured[0].body.model).toBe(testCase.expectedModel)
  })

  it.each([
    {
      label: 'xcustom OpenAI-compatible',
      profileDatabase: db({
        aiModel: 'xcustom:::profile-openai',
        customModels: [
          {
            id: 'xcustom:::profile-openai',
            name: 'Profile Custom',
            internalId: 'profile-xcustom-model',
            url: 'https://profile-custom.example.com/v1/chat/completions',
            key: 'sk-profile-xcustom',
            format: LLMFormat.OpenAICompatible,
            tokenizer: 0,
            flags: [],
            params: 'header::X-Profile=profile\nprofileFlag=true',
          },
        ] as Database['customModels'],
      } as Partial<Database>),
      flatConflict: db({
        aiModel: 'xcustom:::profile-openai',
        customModels: [
          {
            id: 'xcustom:::profile-openai',
            name: 'Flat Custom',
            internalId: 'flat-xcustom-model',
            url: 'https://flat-custom.example.com/v1/chat/completions',
            key: 'sk-flat-xcustom',
            format: LLMFormat.OpenAICompatible,
            tokenizer: 0,
            flags: [],
            params: 'header::X-Flat=flat\nflatFlag=true',
          },
        ] as Database['customModels'],
      } as Partial<Database>),
      expectedUrl: 'https://profile-custom.example.com/v1/chat/completions',
      expectedAuthorization: 'Bearer sk-profile-xcustom',
      expectedModel: 'profile-xcustom-model',
      expectedHeader: ['X-Profile', 'profile'] as const,
      expectedBodyField: ['profileFlag', true] as const,
      absentHeader: 'X-Flat',
      absentBodyField: 'flatFlag',
    },
    {
      label: 'key-identifier OpenAI-compatible',
      profileDatabase: db({
        aiModel: 'deepseek-chat',
        OaiCompAPIKeys: { deepseek: 'sk-profile-deepseek' },
      } as Partial<Database>),
      flatConflict: db({
        aiModel: 'deepseek-chat',
        OaiCompAPIKeys: { deepseek: 'sk-flat-deepseek' },
      } as Partial<Database>),
      expectedUrl: 'https://api.deepseek.com/beta/chat/completions',
      expectedAuthorization: 'Bearer sk-profile-deepseek',
      expectedModel: 'deepseek-chat',
    },
    {
      label: 'ollama-cloud OpenAI-compatible',
      profileDatabase: db({
        aiModel: 'ollama-cloud',
        ollamaApiKey: 'sk-profile-ollama',
        ollamaRequestFormat: LLMFormat.OpenAICompatible,
        ollamaCloudModel: 'profile-ollama-cloud-model',
      } as Partial<Database>),
      flatConflict: db({
        aiModel: 'ollama-cloud',
        ollamaApiKey: 'sk-flat-ollama',
        ollamaRequestFormat: LLMFormat.OpenAICompatible,
        ollamaCloudModel: 'flat-ollama-cloud-model',
      } as Partial<Database>),
      expectedUrl: 'https://ollama.com/v1/chat/completions',
      expectedAuthorization: 'Bearer sk-profile-ollama',
      expectedModel: 'profile-ollama-cloud-model',
    },
  ])('uses $label profile options on the OpenAI branch', async (testCase) => {
    const profile = resolveModelProfile({ database: testCase.profileDatabase })
    const captured = captureOpenAIRequests()

    await dispatchWithProfile(profile, testCase.flatConflict)

    expect(captured).toHaveLength(1)
    expect(captured[0].url).toBe(testCase.expectedUrl)
    expect(captured[0].headers.authorization).toBe(testCase.expectedAuthorization)
    expect(captured[0].body.model).toBe(testCase.expectedModel)
    if (testCase.expectedHeader) {
      expect(captured[0].headers[testCase.expectedHeader[0]]).toBe(testCase.expectedHeader[1])
    }
    if (testCase.expectedBodyField) {
      expect(captured[0].body[testCase.expectedBodyField[0]]).toBe(testCase.expectedBodyField[1])
    }
    if (testCase.absentHeader) {
      expect(captured[0].headers[testCase.absentHeader]).toBeUndefined()
    }
    if (testCase.absentBodyField) {
      expect(captured[0].body[testCase.absentBodyField]).toBeUndefined()
    }
  })

  it('preserves the NanoGPT missing-key error and does not fall back to flat DB keys', async () => {
    const profile = resolveModelProfile({
      database: db({
        aiModel: 'nanogpt',
        nanogptRequestModel: 'profile/nano-model',
      } as Partial<Database>),
    })
    const flatConflict = db({
      aiModel: 'nanogpt',
      nanogptKey: 'sk-flat-nano',
      nanogptRequestModel: 'flat/nano-model',
    } as Partial<Database>)
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch)

    await expect(dispatchWithProfile(profile, flatConflict)).rejects.toThrow('options.nanogpt.apiKey is required')
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
