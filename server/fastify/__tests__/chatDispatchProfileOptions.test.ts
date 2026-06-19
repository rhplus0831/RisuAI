import { afterEach, describe, expect, it, vi } from 'vitest'
import { LLMFormat } from '../../../src/ts/model/types'
import { resolveModelProfile, type ResolvedModelProfile } from '../../../src/ts/model/modelProfileResolver'
import type { OpenAIChat } from '../../../src/ts/process/index.svelte'
import type { Database } from '../../../src/ts/storage/database.svelte'
import { dispatchChatProvider } from '../src/prompt/chatDispatch.js'

interface CapturedDispatchRequest {
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

function okAnthropicResponse(text = 'profile ok'): Response {
  return new Response(JSON.stringify({ content: [{ type: 'text', text }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function okCohereResponse(text = 'profile ok'): Response {
  return new Response(JSON.stringify({ text }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function okOllamaResponse(text = 'profile ok'): Response {
  return new Response(JSON.stringify({ message: { role: 'assistant', content: text }, done: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function okKoboldResponse(text = 'profile ok'): Response {
  return new Response(JSON.stringify({ results: [{ text }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function okOobaLegacyResponse(text = 'profile ok'): Response {
  return new Response(JSON.stringify({ results: [{ text }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function okBedrockResponse(text = 'profile ok'): Response {
  return new Response(JSON.stringify({ content: [{ type: 'text', text }], stop_reason: 'end_turn' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function captureDispatchRequests(response: Response = okOpenAIResponse()): CapturedDispatchRequest[] {
  const captured: CapturedDispatchRequest[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      captured.push({
        url: String(url),
        headers: { ...((init?.headers as Record<string, string> | undefined) ?? {}) },
        body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
      })
      return response.clone()
    }) as unknown as typeof fetch,
  )
  return captured
}

function captureOpenAIRequests(): CapturedDispatchRequest[] {
  return captureDispatchRequests(okOpenAIResponse())
}

function captureHordeRequests(text = 'profile ok'): CapturedDispatchRequest[] {
  const captured: CapturedDispatchRequest[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      captured.push({
        url: String(url),
        headers: { ...((init?.headers as Record<string, string> | undefined) ?? {}) },
        body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
      })
      if (String(url).endsWith('/generate/text/async')) {
        return new Response(JSON.stringify({ id: 'profile-horde-job' }), {
          status: 202,
          headers: { 'content-type': 'application/json' },
        })
      }
      if (String(url).endsWith('/generate/text/status/profile-horde-job')) {
        return new Response(JSON.stringify({ done: true, generations: [{ text }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      throw new Error(`unexpected Horde URL: ${String(url)}`)
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

async function dispatchHordeWithProfile(
  profile: ResolvedModelProfile,
  database: Database,
  formated: OpenAIChat[] = [{ role: 'user', content: 'hello' }],
): Promise<void> {
  vi.useFakeTimers()
  const frames = await dispatchChatProvider({
    database,
    profile,
    formated,
    signal: new AbortController().signal,
  })
  const emittedPromise = (async () => {
    const emitted = []
    for await (const frame of frames) {
      emitted.push(frame)
    }
    return emitted
  })()
  await vi.advanceTimersByTimeAsync(0)
  await vi.advanceTimersByTimeAsync(2000)
  await expect(emittedPromise).resolves.toEqual([
    { kind: 'token', content: 'profile ok' },
    { kind: 'done', finishReason: 'stop' },
  ])
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
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

  it('uses Anthropic xcustom profile options over conflicting flat database fields', async () => {
    const profile = resolveModelProfile({
      database: db({
        aiModel: 'xcustom:::profile-anthropic',
        customModels: [
          {
            id: 'xcustom:::profile-anthropic',
            name: 'Profile Anthropic',
            internalId: 'profile-claude-model',
            url: 'https://profile-anthropic.example.com/v1/messages',
            key: 'sk-profile-anthropic',
            format: LLMFormat.Anthropic,
            tokenizer: 0,
            flags: [],
            params: 'header::anthropic-beta=profile-beta\nprofileFlag=true',
          },
        ] as Database['customModels'],
      } as Partial<Database>),
    })
    const flatConflict = db({
      aiModel: 'xcustom:::profile-anthropic',
      customModels: [
        {
          id: 'xcustom:::profile-anthropic',
          name: 'Flat Anthropic',
          internalId: 'flat-claude-model',
          url: 'https://flat-anthropic.example.com/v1/messages',
          key: 'sk-flat-anthropic',
          format: LLMFormat.Anthropic,
          tokenizer: 0,
          flags: [],
          params: 'header::X-Flat=flat\nflatFlag=true',
        },
      ] as Database['customModels'],
    } as Partial<Database>)
    const captured = captureDispatchRequests(okAnthropicResponse())

    await dispatchWithProfile(profile, flatConflict)

    expect(captured).toHaveLength(1)
    expect(captured[0].url).toBe('https://profile-anthropic.example.com/v1/messages')
    expect(captured[0].headers['x-api-key']).toBe('sk-profile-anthropic')
    expect(captured[0].headers['anthropic-beta']).toBe('profile-beta')
    expect(captured[0].headers['X-Flat']).toBeUndefined()
    expect(captured[0].body.model).toBe('profile-claude-model')
    expect(captured[0].body.profileFlag).toBe(true)
    expect(captured[0].body.flatFlag).toBeUndefined()
  })

  it('uses Mistral reverse_proxy profile options over conflicting flat database fields', async () => {
    const profile = resolveModelProfile({
      database: db({
        aiModel: 'reverse_proxy',
        customProxyRequestModel: 'profile-mistral-model',
        customAPIFormat: LLMFormat.Mistral,
        forceReplaceUrl: 'risu::https://profile-mistral.example.com',
        proxyKey: 'sk-profile-mistral',
        autofillRequestUrl: true,
        additionalParams: [
          ['header::X-Profile', 'profile'],
          ['profileFlag', 'true'],
        ],
      } as Partial<Database>),
    })
    const flatConflict = db({
      aiModel: 'reverse_proxy',
      customProxyRequestModel: 'flat-mistral-model',
      customAPIFormat: LLMFormat.Mistral,
      forceReplaceUrl: 'https://flat-mistral.example.com/v1',
      proxyKey: 'sk-flat-mistral',
      autofillRequestUrl: true,
      additionalParams: [
        ['header::X-Flat', 'flat'],
        ['flatFlag', 'true'],
      ],
    } as Partial<Database>)
    const captured = captureDispatchRequests(okOpenAIResponse())

    await dispatchWithProfile(profile, flatConflict)

    expect(captured).toHaveLength(1)
    expect(captured[0].url).toBe('https://profile-mistral.example.com/v1/chat/completions')
    expect(captured[0].headers.authorization).toBe('Bearer sk-profile-mistral')
    expect(captured[0].headers['X-Proxy-Risu']).toBe('RisuAI')
    expect(captured[0].headers['X-Profile']).toBe('profile')
    expect(captured[0].headers['X-Flat']).toBeUndefined()
    expect(captured[0].body.model).toBe('profile-mistral-model')
    expect(captured[0].body.profileFlag).toBe(true)
    expect(captured[0].body.flatFlag).toBeUndefined()
  })

  it('uses Cohere reverse_proxy profile options over conflicting flat database fields', async () => {
    const profile = resolveModelProfile({
      database: db({
        aiModel: 'reverse_proxy',
        customProxyRequestModel: 'profile-cohere-model',
        customAPIFormat: LLMFormat.Cohere,
        forceReplaceUrl: 'risu::https://profile-cohere.example.com',
        proxyKey: 'sk-profile-cohere',
        autofillRequestUrl: true,
        additionalParams: [
          ['header::X-Profile', 'profile'],
          ['profileFlag', 'true'],
        ],
      } as Partial<Database>),
    })
    const flatConflict = db({
      aiModel: 'reverse_proxy',
      customProxyRequestModel: 'flat-cohere-model',
      customAPIFormat: LLMFormat.Cohere,
      forceReplaceUrl: 'https://flat-cohere.example.com/v1',
      proxyKey: 'sk-flat-cohere',
      autofillRequestUrl: true,
      additionalParams: [
        ['header::X-Flat', 'flat'],
        ['flatFlag', 'true'],
      ],
    } as Partial<Database>)
    const captured = captureDispatchRequests(okCohereResponse())

    await dispatchWithProfile(profile, flatConflict)

    expect(captured).toHaveLength(1)
    expect(captured[0].url).toBe('https://profile-cohere.example.com/v1/chat')
    expect(captured[0].headers.authorization).toBe('Bearer sk-profile-cohere')
    expect(captured[0].headers['X-Proxy-Risu']).toBe('RisuAI')
    expect(captured[0].headers['X-Profile']).toBe('profile')
    expect(captured[0].headers['X-Flat']).toBeUndefined()
    expect(captured[0].body.model).toBe('profile-cohere-model')
    expect(captured[0].body.profileFlag).toBe(true)
    expect(captured[0].body.flatFlag).toBeUndefined()
  })

  it('uses native Ollama profile URL and model over conflicting flat database fields', async () => {
    const profile = resolveModelProfile({
      database: db({
        aiModel: 'ollama-hosted',
        ollamaURL: 'http://profile-ollama.example.com',
        ollamaModel: 'profile-llama',
      } as Partial<Database>),
    })
    const flatConflict = db({
      aiModel: 'ollama-hosted',
      ollamaURL: 'http://flat-ollama.example.com',
      ollamaModel: 'flat-llama',
    } as Partial<Database>)
    const captured = captureDispatchRequests(okOllamaResponse())

    await dispatchWithProfile(profile, flatConflict)

    expect(captured).toHaveLength(1)
    expect(captured[0].url).toBe('http://profile-ollama.example.com/api/chat')
    expect(captured[0].body.model).toBe('profile-llama')
  })

  it('uses Kobold profile URL over conflicting flat database fields', async () => {
    const profile = resolveModelProfile({
      database: db({
        aiModel: 'kobold',
        koboldURL: 'http://profile-kobold.example.com',
      } as Partial<Database>),
    })
    const flatConflict = db({
      aiModel: 'kobold',
      koboldURL: 'http://flat-kobold.example.com',
    } as Partial<Database>)
    const captured = captureDispatchRequests(okKoboldResponse())

    await dispatchWithProfile(profile, flatConflict)

    expect(captured).toHaveLength(1)
    expect(captured[0].url).toBe('http://profile-kobold.example.com/api/v1/generate')
  })

  it('uses OobaLegacy profile URL and API key over conflicting flat database fields', async () => {
    const profile = resolveModelProfile({
      database: db({
        aiModel: 'mancer',
        textgenWebUIBlockingURL: 'http://profile-ooba.example.com/api/v1/blocking',
        mancerHeader: 'profile-mancer-key',
      } as Partial<Database>),
    })
    const flatConflict = db({
      aiModel: 'mancer',
      textgenWebUIBlockingURL: 'http://flat-ooba.example.com/api/v1/blocking',
      mancerHeader: 'flat-mancer-key',
    } as Partial<Database>)
    const captured = captureDispatchRequests(okOobaLegacyResponse())

    await dispatchWithProfile(profile, flatConflict)

    expect(captured).toHaveLength(1)
    expect(captured[0].url).toBe('http://profile-ooba.example.com/api/v1/generate')
    expect(captured[0].headers['X-API-KEY']).toBe('profile-mancer-key')
  })

  it('uses Bedrock profile credentials and request model over conflicting flat database fields', async () => {
    const profile = resolveModelProfile({
      database: db({
        aiModel: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
        claudeAPIKey: 'PROFILEAKIA:profile-secret:ap-southeast-2',
      } as Partial<Database>),
    })
    const flatConflict = db({
      aiModel: 'anthropic.claude-sonnet-4-5-20250929-v1:0',
      claudeAPIKey: 'FLATAKIA:flat-secret:us-east-1',
    } as Partial<Database>)
    const captured = captureDispatchRequests(okBedrockResponse())

    await dispatchWithProfile(profile, flatConflict, [
      { role: 'system', content: 'profile system 1' },
      { role: 'system', content: 'profile system 2' },
      { role: 'user', content: 'hello' },
    ])

    expect(captured).toHaveLength(1)
    expect(captured[0].url).toBe(
      'https://bedrock-runtime.ap-southeast-2.amazonaws.com/model/us.anthropic.claude-3-5-sonnet-20241022-v2%3A0/invoke',
    )
    expect(captured[0].headers.Authorization).toContain('Credential=PROFILEAKIA/')
    expect(captured[0].headers.Authorization).toContain('/ap-southeast-2/bedrock/aws4_request')
    expect(captured[0].headers.Authorization).not.toContain('FLATAKIA')
    expect(captured[0].headers.Authorization).not.toContain('/us-east-1/bedrock/aws4_request')
    expect(captured[0].body.anthropic_version).toBe('bedrock-2023-05-31')
    expect(captured[0].body.system).toBe('profile system 1\n\nprofile system 2')
    expect(captured[0].body.messages).toEqual([{ role: 'user', content: 'hello' }])
    expect(captured[0].body.model).toBeUndefined()
  })

  it('uses the global Bedrock request-model prefix for newer profile models', async () => {
    const profile = resolveModelProfile({
      database: db({
        aiModel: 'anthropic.claude-sonnet-4-5-20250929-v1:0',
        claudeAPIKey: 'PROFILEAKIA:profile-secret:eu-central-1',
      } as Partial<Database>),
    })
    const flatConflict = db({
      aiModel: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
      claudeAPIKey: 'FLATAKIA:flat-secret:us-west-2',
    } as Partial<Database>)
    const captured = captureDispatchRequests(okBedrockResponse())

    await dispatchWithProfile(profile, flatConflict)

    expect(captured).toHaveLength(1)
    expect(captured[0].url).toBe(
      'https://bedrock-runtime.eu-central-1.amazonaws.com/model/global.anthropic.claude-sonnet-4-5-20250929-v1%3A0/invoke',
    )
    expect(captured[0].headers.Authorization).toContain('/eu-central-1/bedrock/aws4_request')
    expect(captured[0].body.messages).toEqual([{ role: 'user', content: 'hello' }])
  })

  it('uses Horde profile API key and request model over conflicting flat database fields', async () => {
    const profile = resolveModelProfile({
      database: db({
        aiModel: 'horde:::profile-horde-model',
        hordeConfig: { apiKey: 'profile-horde-key', model: '', softPrompt: '' },
        instructChatTemplate: 'chatml',
      } as Partial<Database>),
    })
    const flatConflict = db({
      aiModel: 'horde:::flat-horde-model',
      hordeConfig: { apiKey: 'flat-horde-key', model: '', softPrompt: '' },
      instructChatTemplate: 'gpt2',
    } as Partial<Database>)
    const captured = captureHordeRequests()

    await dispatchHordeWithProfile(profile, flatConflict)

    expect(captured.length).toBeGreaterThanOrEqual(2)
    expect(captured[0].url).toBe('https://stablehorde.net/api/v2/generate/text/async')
    expect(captured[0].headers.apikey).toBe('profile-horde-key')
    expect(captured[1].headers.apikey).toBe('profile-horde-key')
    expect(captured[0].body.models).toEqual([
      'profile-horde-model',
      'profile-horde-model',
      ' profile-horde-model',
      'profile-horde-model ',
    ])
  })

  it('uses the anonymous Horde key when the profile key is blank despite a flat DB key', async () => {
    const profile = resolveModelProfile({
      database: db({
        aiModel: 'horde:::profile-horde-model',
        hordeConfig: { apiKey: '   ', model: '', softPrompt: '' },
        instructChatTemplate: 'chatml',
      } as Partial<Database>),
    })
    const flatConflict = db({
      aiModel: 'horde:::flat-horde-model',
      hordeConfig: { apiKey: 'flat-horde-key', model: '', softPrompt: '' },
      instructChatTemplate: 'gpt2',
    } as Partial<Database>)
    const captured = captureHordeRequests()

    await dispatchHordeWithProfile(profile, flatConflict)

    expect(captured.length).toBeGreaterThanOrEqual(2)
    expect(captured[0].headers.apikey).toBe('0000000000')
    expect(captured[1].headers.apikey).toBe('0000000000')
    expect(captured[0].body.models).toEqual([
      'profile-horde-model',
      'profile-horde-model',
      ' profile-horde-model',
      'profile-horde-model ',
    ])
  })

  it('omits the OobaLegacy API key when the profile key is blank despite a flat DB key', async () => {
    const profile = resolveModelProfile({
      database: db({
        aiModel: 'mancer',
        textgenWebUIBlockingURL: 'http://profile-ooba.example.com/api/v1/blocking',
        mancerHeader: '   ',
      } as Partial<Database>),
    })
    const flatConflict = db({
      aiModel: 'mancer',
      textgenWebUIBlockingURL: 'http://flat-ooba.example.com/api/v1/blocking',
      mancerHeader: 'flat-mancer-key',
    } as Partial<Database>)
    const captured = captureDispatchRequests(okOobaLegacyResponse())

    await dispatchWithProfile(profile, flatConflict)

    expect(captured).toHaveLength(1)
    expect(captured[0].url).toBe('http://profile-ooba.example.com/api/v1/generate')
    expect(captured[0].headers['X-API-KEY']).toBeUndefined()
  })

  it.each([
    { label: 'missing', claudeAPIKey: undefined },
    { label: 'blank', claudeAPIKey: '   ' },
  ])('does not fall back to flat DB Bedrock credentials when the profile key is $label', async (testCase) => {
    const profileDatabase: Partial<Database> = {
      aiModel: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
    }
    if (testCase.claudeAPIKey !== undefined) {
      profileDatabase.claudeAPIKey = testCase.claudeAPIKey
    }
    const profile = resolveModelProfile({ database: db(profileDatabase) })
    const flatConflict = db({
      aiModel: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
      claudeAPIKey: 'FLATAKIA:flat-secret:us-east-1',
    } as Partial<Database>)
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch)

    await expect(dispatchWithProfile(profile, flatConflict)).rejects.toThrow('configuration is incomplete')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('rejects malformed Bedrock profile credentials before fetch', async () => {
    const profile = resolveModelProfile({
      database: db({
        aiModel: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
        claudeAPIKey: 'PROFILEAKIA:profile-secret:ap-southeast-2:extra',
      } as Partial<Database>),
    })
    const flatConflict = db({
      aiModel: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
      claudeAPIKey: 'FLATAKIA:flat-secret:us-east-1',
    } as Partial<Database>)
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch)

    await expect(dispatchWithProfile(profile, flatConflict)).rejects.toThrow(
      'The key assigned to this request is invalid.',
    )
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('preserves the native Ollama missing-URL error and does not fall back to flat DB URL', async () => {
    const profile = resolveModelProfile({
      database: db({
        aiModel: 'ollama-hosted',
        ollamaModel: 'profile-llama',
      } as Partial<Database>),
    })
    const flatConflict = db({
      aiModel: 'ollama-hosted',
      ollamaURL: 'http://flat-ollama.example.com',
      ollamaModel: 'flat-llama',
    } as Partial<Database>)
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch)

    await expect(dispatchWithProfile(profile, flatConflict)).rejects.toThrow('options.ollama.baseUrl is required')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('preserves the Kobold missing-URL error and does not fall back to flat DB URL', async () => {
    const profile = resolveModelProfile({
      database: db({
        aiModel: 'kobold',
      } as Partial<Database>),
    })
    const flatConflict = db({
      aiModel: 'kobold',
      koboldURL: 'http://flat-kobold.example.com',
    } as Partial<Database>)
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch)

    await expect(dispatchWithProfile(profile, flatConflict)).rejects.toThrow('options.kobold.baseUrl is required')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('preserves the OobaLegacy missing-URL error and does not fall back to flat DB URL', async () => {
    const profile = resolveModelProfile({
      database: db({
        aiModel: 'mancer',
      } as Partial<Database>),
    })
    const flatConflict = db({
      aiModel: 'mancer',
      textgenWebUIBlockingURL: 'http://flat-ooba.example.com/api/v1/blocking',
      mancerHeader: 'flat-mancer-key',
    } as Partial<Database>)
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch)

    await expect(dispatchWithProfile(profile, flatConflict)).rejects.toThrow(
      'options["ooba-legacy"].baseUrl is required',
    )
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('derives Cohere safety mode from the profile model id instead of flat aiModel', async () => {
    const profile = resolveModelProfile({
      database: db({
        aiModel: 'cohere-command-r-03-2024',
        cohereAPIKey: 'sk-profile-cohere',
      } as Partial<Database>),
    })
    const flatConflict = db({
      aiModel: 'cohere-command-r',
      cohereAPIKey: 'sk-flat-cohere',
    } as Partial<Database>)
    const captured = captureDispatchRequests(okCohereResponse())

    await dispatchWithProfile(profile, flatConflict)

    expect(captured).toHaveLength(1)
    expect(captured[0].headers.authorization).toBe('Bearer sk-profile-cohere')
    expect(captured[0].body.model).toBe('cohere-command-r-03-2024')
    expect(captured[0].body.safety_mode).toBeUndefined()
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

  it.each([
    {
      label: 'Anthropic',
      profileDatabase: db({
        aiModel: 'claude-3-5-sonnet-20241022',
      } as Partial<Database>),
      flatConflict: db({
        aiModel: 'claude-3-5-sonnet-20241022',
        claudeAPIKey: 'sk-flat-anthropic',
      } as Partial<Database>),
      error: 'options.anthropic.apiKey is required',
    },
    {
      label: 'Mistral',
      profileDatabase: db({
        aiModel: 'mistral-large-latest',
      } as Partial<Database>),
      flatConflict: db({
        aiModel: 'mistral-large-latest',
        mistralKey: 'sk-flat-mistral',
      } as Partial<Database>),
      error: 'options.mistral.apiKey is required',
    },
    {
      label: 'Cohere',
      profileDatabase: db({
        aiModel: 'cohere-command-r',
      } as Partial<Database>),
      flatConflict: db({
        aiModel: 'cohere-command-r',
        cohereAPIKey: 'sk-flat-cohere',
      } as Partial<Database>),
      error: 'options.cohere.apiKey is required',
    },
  ])('preserves the $label missing-key error and does not fall back to flat DB keys', async (testCase) => {
    const profile = resolveModelProfile({ database: testCase.profileDatabase })
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch)

    await expect(dispatchWithProfile(profile, testCase.flatConflict)).rejects.toThrow(testCase.error)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
