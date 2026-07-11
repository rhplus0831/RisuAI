import { generateKeyPairSync } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LLMFlags,
  LLMFormat,
  LLMProvider,
  LLMTokenizer,
  OpenAIParameters,
  type LLMModel,
} from '../../../src/ts/model/types'
import { resolveModelProfile, type ResolvedModelProfile } from '../../../src/ts/model/modelProfileResolver'
import type { OpenAIChat } from '../../../src/ts/process/index.svelte'
import type { Database } from '../../../src/ts/storage/database.svelte'
import { _resetVertexTokenCacheForTesting } from '../src/generation/vertexAuth.js'
import { dispatchChatProvider } from '../src/prompt/chatDispatch.js'
import type { PromptRowSummary } from '../src/prompt/promptSummary.js'

interface CapturedDispatchRequest {
  url: string
  headers: Record<string, string>
  body: Record<string, unknown>
  rawBody: string
}

interface ProtocolMetric {
  metric: string
  provider?: string
  modelId?: string
  wireModel?: string
  profileId?: string
  profileSourceKind?: string
  profileProviderId?: string
  modelInfoFormat?: number
  modelInfoFlags?: number[]
  prePromptHash?: string
  prePromptRowCount?: number
  prePromptRoleSequence?: string
  prePromptRows?: PromptRowSummary[]
  postPromptHash?: string
  postPromptRowCount?: number
  postPromptRoleSequence?: string
  postPromptRows?: PromptRowSummary[]
  promptReformatted?: boolean
  promptRowCountChanged?: boolean
  promptRoleSequenceChanged?: boolean
  promptReferenceChanged?: boolean
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

function geminiModelInfo(overrides: Partial<LLMModel>): LLMModel {
  return {
    id: 'gemini-2.5-flash',
    name: 'Gemini Test Model',
    provider: LLMProvider.GoogleCloud,
    format: LLMFormat.GoogleCloud,
    flags: [LLMFlags.hasFirstSystemPrompt, LLMFlags.requiresAlternateRole, LLMFlags.mustStartWithUserInput],
    parameters: OpenAIParameters,
    tokenizer: LLMTokenizer.GoogleCloud,
    ...overrides,
  }
}

function okOpenAIResponse(text = 'profile ok'): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: text }, finish_reason: 'stop' }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function okOpenAILegacyInstructResponse(text = 'profile ok'): Response {
  return new Response(JSON.stringify({ choices: [{ text }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function okOpenAIResponsesResponse(text = 'profile ok'): Response {
  return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] }), {
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

function okGeminiResponse(text = 'profile ok'): Response {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function parseCapturedBody(rawBody: string): Record<string, unknown> {
  try {
    return JSON.parse(rawBody) as Record<string, unknown>
  } catch {
    return {}
  }
}

function captureRequest(url: string | URL | Request, init?: RequestInit): CapturedDispatchRequest {
  const rawBody = String(init?.body ?? '{}')
  return {
    url: String(url),
    headers: { ...((init?.headers as Record<string, string> | undefined) ?? {}) },
    body: parseCapturedBody(rawBody),
    rawBody,
  }
}

function captureDispatchRequests(response: Response = okOpenAIResponse()): CapturedDispatchRequest[] {
  const captured: CapturedDispatchRequest[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      captured.push(captureRequest(url, init))
      return response.clone()
    }) as unknown as typeof fetch,
  )
  return captured
}

function captureOpenAIRequests(): CapturedDispatchRequest[] {
  return captureDispatchRequests(okOpenAIResponse())
}

async function withProtocolMetrics<T>(run: (metrics: ProtocolMetric[]) => Promise<T>): Promise<T> {
  const previous = process.env.RISU_PROTOCOL_METRICS
  const metrics: ProtocolMetric[] = []
  process.env.RISU_PROTOCOL_METRICS = '1'
  const infoSpy = vi.spyOn(console, 'info').mockImplementation((message: unknown) => {
    if (typeof message !== 'string' || !message.startsWith('[protocol-metric] ')) return
    metrics.push(JSON.parse(message.slice('[protocol-metric] '.length)) as ProtocolMetric)
  })
  try {
    return await run(metrics)
  } finally {
    infoSpy.mockRestore()
    if (previous === undefined) {
      delete process.env.RISU_PROTOCOL_METRICS
    } else {
      process.env.RISU_PROTOCOL_METRICS = previous
    }
  }
}

function captureHordeRequests(text = 'profile ok'): CapturedDispatchRequest[] {
  const captured: CapturedDispatchRequest[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      captured.push(captureRequest(url, init))
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

function captureVertexRequests(text = 'profile ok'): CapturedDispatchRequest[] {
  const captured: CapturedDispatchRequest[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      captured.push(captureRequest(url, init))
      if (String(url) === 'https://oauth2.googleapis.com/token') {
        return new Response(JSON.stringify({ access_token: 'ya29.profile-token', expires_in: 3599 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return okGeminiResponse(text)
    }) as unknown as typeof fetch,
  )
  return captured
}

function generatePrivateKey(): string {
  return generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  }).privateKey
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

describe('dispatchChatProvider final wire controls', () => {
  it('sends supported runtime controls, schema, prediction, multi-generation, and logit bias', async () => {
    const database = db({
      aiModel: 'reverse_proxy',
      customProxyRequestModel: 'wire-model',
      customAPIFormat: LLMFormat.OpenAICompatible,
      forceReplaceUrl: 'https://wire.example/v1/chat/completions',
      proxyKey: 'sk-wire',
      autofillRequestUrl: true,
      newOAIHandle: true,
      gptVisionQuality: 'high',
      temperature: 73,
      top_p: 0.82,
      top_k: 40,
      min_p: 0.12,
      top_a: 0.08,
      repetition_penalty: 1.13,
      frequencyPenalty: 25,
      PresensePenalty: 35,
      generationSeed: 42,
      jsonSchemaEnabled: true,
      jsonSchema: 'interface Reply {\nanswer: string\nconfidence?: number\n}',
      strictJsonSchema: true,
      OAIPrediction: 'known prefix',
      genTime: 2,
      useStreaming: true,
    } as Partial<Database>)
    const profile = resolveModelProfile({ database })
    const captured: CapturedDispatchRequest[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        captured.push(captureRequest(url, init))
        return new Response(
          JSON.stringify({
            choices: [
              { message: { content: 'first', reasoning_content: 'thought one' } },
              { message: { content: 'second' } },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }) as unknown as typeof fetch,
    )

    const frames = await dispatchChatProvider({
      database,
      profile,
      formated: [
        { role: 'system', content: '[Start a new chat]', memo: 'NewChat', removable: true },
        {
          role: 'user',
          content: 'hello',
          memo: 'internal',
          attr: ['internal'],
          multimodals: [{ type: 'image', base64: 'data:image/png;base64,AA' }],
          thoughts: ['hidden'],
          cachePoint: true,
        },
      ],
      biases: [
        ['[[123]]', -50],
        ['avoid', -100],
      ],
      multiGeneration: true,
      signal: new AbortController().signal,
    })
    const emitted = []
    for await (const frame of frames) emitted.push(frame)

    expect(captured).toHaveLength(1)
    expect(captured[0].body).toMatchObject({
      model: 'wire-model',
      stream: false,
      max_tokens: 64,
      temperature: 0.73,
      top_p: 0.82,
      top_k: 40,
      min_p: 0.12,
      top_a: 0.08,
      repetition_penalty: 1.13,
      frequency_penalty: 0.25,
      presence_penalty: 0.35,
      seed: 42,
      n: 2,
      prediction: { type: 'content', content: 'known prefix' },
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'format',
          strict: true,
          schema: {
            $schema: 'https://json-schema.org/draft/2020-12/schema',
            type: 'object',
            additionalProperties: false,
            properties: { answer: { type: 'string' }, confidence: { type: 'number' } },
            required: ['answer'],
          },
        },
      },
      logit_bias: { '123': -50 },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: 'data:image/png;base64,AA', detail: 'high' } },
            { type: 'text', text: 'hello' },
          ],
        },
      ],
    })
    expect(JSON.stringify(captured[0].body.messages)).not.toMatch(
      /NewChat|memo|removable|attr|multimodals|thoughts|cachePoint/u,
    )
    expect(Object.keys(captured[0].body.logit_bias as Record<string, number>).length).toBeGreaterThan(1)
    expect(emitted).toEqual([
      { kind: 'token', content: '<Thoughts>\nthought one\n</Thoughts>\nfirst' },
      { kind: 'done', finishReason: 'stop', alternates: ['second'] },
    ])
  })

  it('applies the configured JSON extraction path to buffered provider output', async () => {
    const database = db({
      aiModel: 'echo_model',
      echoMessage: '```json\n{"reply":{"text":"visible"}}\n```',
      useStreaming: true,
      jsonSchemaEnabled: true,
      jsonSchema: '{"type":"object"}',
      extractJson: 'reply.text',
    } as Partial<Database>)
    const frames = await dispatchChatProvider({
      database,
      formated: [{ role: 'user', content: 'hello' }],
      signal: new AbortController().signal,
    })
    const emitted = []
    for await (const frame of frames) emitted.push(frame)

    expect(emitted).toEqual([
      { kind: 'token', content: 'visible' },
      { kind: 'done', finishReason: 'stop' },
    ])
  })
})

describe('dispatchChatProvider profile providerOptions', () => {
  it('emits metadata-only prompt reformat metrics when provider flags change rows', async () => {
    const profile = resolveModelProfile({
      database: db({
        aiModel: 'gemini-2.5-flash',
        google: { accessToken: 'profile-google-key', projectId: 'profile-project' },
      } as Partial<Database>),
      lookupModelInfo: (_database, id) =>
        geminiModelInfo({
          id,
          internalID: 'models/gemini-profile-wire-model',
          provider: LLMProvider.GoogleCloud,
          format: LLMFormat.GoogleCloud,
        }),
    })
    const database = db({
      aiModel: 'gemini-2.5-flash',
      google: { accessToken: 'profile-google-key', projectId: 'profile-project' },
    } as Partial<Database>)
    const formated: OpenAIChat[] = [
      { role: 'system', content: 'slice-2-secret-dispatch-system' },
      { role: 'user', content: 'slice-2-secret-dispatch-user-a' },
      { role: 'user', content: 'slice-2-secret-dispatch-user-b' },
    ]
    captureDispatchRequests(okGeminiResponse())

    await withProtocolMetrics(async (metrics) => {
      await dispatchWithProfile(profile, database, formated)

      const metric = metrics.find((entry) => entry.metric === 'generation_prompt_dispatch_reformat')
      expect(metric).toMatchObject({
        provider: 'gemini',
        modelId: 'gemini-2.5-flash',
        wireModel: 'gemini-profile-wire-model',
        profileId: expect.any(String),
        profileSourceKind: 'legacy-aiModel',
        modelInfoFormat: LLMFormat.GoogleCloud,
        prePromptRowCount: 3,
        prePromptRoleSequence: 'system,user,user',
        prePromptRows: expect.any(Array),
        postPromptRowCount: 2,
        postPromptRoleSequence: 'system,user',
        postPromptRows: expect.any(Array),
        promptReformatted: true,
        promptRowCountChanged: true,
        promptRoleSequenceChanged: true,
        promptReferenceChanged: true,
      })
      expect(metric?.prePromptHash).toMatch(/^[a-f0-9]{64}$/)
      expect(metric?.postPromptHash).toMatch(/^[a-f0-9]{64}$/)
      expect(metric?.prePromptHash).not.toBe(metric?.postPromptHash)
      expect(metric?.prePromptRows).toHaveLength(3)
      expect(metric?.postPromptRows).toHaveLength(2)
      expect(JSON.stringify(metrics)).not.toContain('slice-2-secret-dispatch')
    })
  })

  it('uses a selected durable profile API key for outbound OpenRouter authorization', async () => {
    const profile = resolveModelProfile({
      database: db({
        aiModel: 'gpt-5',
        openrouterKey: 'sk-flat-openrouter',
        openrouterRequestModel: 'flat/openrouter',
        modelProfiles: [
          {
            id: 'openrouter-profile',
            name: 'OpenRouter Profile',
            modelId: 'openrouter',
            providerOptions: {
              apiKey: 'sk-durable-openrouter',
              requestModel: 'profile/openrouter',
            },
          },
        ],
        modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'openrouter-profile' } },
      } as Partial<Database>),
    })
    const flatConflict = db({
      aiModel: 'openrouter',
      openrouterKey: 'sk-conflicting-openrouter',
      openrouterRequestModel: 'conflict/openrouter',
    } as Partial<Database>)
    const captured = captureOpenAIRequests()

    await dispatchWithProfile(profile, flatConflict)

    expect(captured).toHaveLength(1)
    expect(captured[0].url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(captured[0].headers.authorization).toBe('Bearer sk-durable-openrouter')
    expect(captured[0].body.model).toBe('profile/openrouter')
  })

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

  it('preserves legacy reverse_proxy autofill for converted custom-api profile mirrors', async () => {
    const database = db({
      aiModel: 'reverse_proxy',
      customAPIFormat: LLMFormat.OpenAICompatible,
      forceReplaceUrl: 'https://util.node.mephistopheles.moe/chat/risu',
      proxyKey: 'sk-flat-proxy',
      autofillRequestUrl: true,
      modelProfiles: [
        {
          id: 'converted-custom-api',
          name: 'Converted Custom API',
          providerId: 'custom-api',
          modelId: 'custom-api',
          providerOptions: {
            apiKey: 'sk-profile-proxy',
            baseUrl: 'https://util.node.mephistopheles.moe/chat/risu',
            requestModel: 'extension',
          },
        },
      ],
      modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'converted-custom-api' } },
    } as Partial<Database>)
    const profile = resolveModelProfile({ database, role: 'chatMain' })
    const captured = captureOpenAIRequests()

    await dispatchWithProfile(profile, database)

    expect(captured).toHaveLength(1)
    expect(captured[0].url).toBe('https://util.node.mephistopheles.moe/chat/risu/v1/chat/completions')
    expect(captured[0].headers.authorization).toBe('Bearer sk-profile-proxy')
    expect(captured[0].body.model).toBe('extension')
  })

  it('uses OpenAI legacy instruct profile options over conflicting flat database fields', async () => {
    const profile = resolveModelProfile({
      database: db({
        aiModel: 'reverse_proxy',
        customProxyRequestModel: 'profile-legacy-model',
        customAPIFormat: LLMFormat.OpenAILegacyInstruct,
        forceReplaceUrl: 'risu::https://profile-legacy.example.com/v1',
        proxyKey: 'sk-profile-legacy',
        autofillRequestUrl: true,
        additionalParams: [
          ['header::X-Profile', 'profile'],
          ['profileFlag', 'true'],
        ],
      } as Partial<Database>),
    })
    const flatConflict = db({
      aiModel: 'reverse_proxy',
      customProxyRequestModel: 'flat-legacy-model',
      customAPIFormat: LLMFormat.OpenAILegacyInstruct,
      forceReplaceUrl: 'https://flat-legacy.example.com/v1',
      proxyKey: 'sk-flat-legacy',
      autofillRequestUrl: true,
      additionalParams: [
        ['header::X-Flat', 'flat'],
        ['flatFlag', 'true'],
      ],
    } as Partial<Database>)
    const captured = captureDispatchRequests(okOpenAILegacyInstructResponse())

    await dispatchWithProfile(profile, flatConflict)

    expect(captured).toHaveLength(1)
    expect(captured[0].url).toBe('https://profile-legacy.example.com/v1/completions')
    expect(captured[0].headers.authorization).toBe('Bearer sk-profile-legacy')
    expect(captured[0].headers['X-Proxy-Risu']).toBe('RisuAI')
    expect(captured[0].headers['X-Profile']).toBe('profile')
    expect(captured[0].headers['X-Flat']).toBeUndefined()
    expect(captured[0].body.model).toBe('profile-legacy-model')
    expect(captured[0].body.profileFlag).toBe(true)
    expect(captured[0].body.flatFlag).toBeUndefined()
  })

  it('uses OpenAI Responses profile options over conflicting flat database fields', async () => {
    const profile = resolveModelProfile({
      database: db({
        aiModel: 'reverse_proxy',
        customProxyRequestModel: 'profile-responses-model',
        customAPIFormat: LLMFormat.OpenAIResponseAPI,
        forceReplaceUrl: 'risu::https://profile-responses.example.com/v1',
        proxyKey: 'sk-profile-responses',
        autofillRequestUrl: true,
        additionalParams: [
          ['header::X-Profile', 'profile'],
          ['profileFlag', 'true'],
        ],
      } as Partial<Database>),
    })
    const flatConflict = db({
      aiModel: 'ollama-cloud',
      ollamaApiKey: 'sk-flat-ollama',
      ollamaRequestFormat: LLMFormat.OpenAIResponseAPI,
      ollamaCloudModel: 'flat-ollama-responses',
    } as Partial<Database>)
    const captured = captureDispatchRequests(okOpenAIResponsesResponse())

    await dispatchWithProfile(profile, flatConflict)

    expect(captured).toHaveLength(1)
    expect(captured[0].url).toBe('https://profile-responses.example.com/v1/responses')
    expect(captured[0].headers.authorization).toBe('Bearer sk-profile-responses')
    expect(captured[0].headers['X-Proxy-Risu']).toBe('RisuAI')
    expect(captured[0].headers['X-Profile']).toBe('profile')
    expect(captured[0].body.model).toBe('profile-responses-model')
    expect(captured[0].body.profileFlag).toBe(true)
    expect(captured[0].body.store).toBe(false)
  })

  it('uses the profile model id for OpenAI Responses Ollama Cloud store ownership', async () => {
    const profile = resolveModelProfile({
      database: db({
        aiModel: 'ollama-cloud',
        ollamaApiKey: 'sk-profile-ollama',
        ollamaRequestFormat: LLMFormat.OpenAIResponseAPI,
        ollamaCloudModel: 'profile-ollama-responses',
        ollamaModelSource: 'cloud',
      } as Partial<Database>),
    })
    const flatConflict = db({
      aiModel: 'reverse_proxy',
      customProxyRequestModel: 'flat-responses-model',
      customAPIFormat: LLMFormat.OpenAIResponseAPI,
      forceReplaceUrl: 'https://flat-responses.example.com/v1',
      proxyKey: 'sk-flat-responses',
      additionalParams: [['header::X-Flat', 'flat']],
    } as Partial<Database>)
    const captured = captureDispatchRequests(okOpenAIResponsesResponse())

    await dispatchWithProfile(profile, flatConflict)

    expect(captured).toHaveLength(1)
    expect(captured[0].url).toBe('https://ollama.com/v1/responses')
    expect(captured[0].headers.authorization).toBe('Bearer sk-profile-ollama')
    expect(captured[0].headers['X-Flat']).toBeUndefined()
    expect(captured[0].body.model).toBe('profile-ollama-responses')
    expect(captured[0].body.store).toBeUndefined()
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
      temperature: 67,
      localStopStrings: ['STOP\\nHERE'],
      ooba: {
        top_p: 0.81,
        top_k: 73,
        typical_p: 0.92,
        repetition_penalty: 1.17,
        do_sample: false,
        seed: 42,
      } as Database['ooba'],
    } as Partial<Database>)
    const captured = captureDispatchRequests(okOobaLegacyResponse())

    await dispatchWithProfile(profile, flatConflict)

    expect(captured).toHaveLength(1)
    expect(captured[0].url).toBe('http://profile-ooba.example.com/api/v1/generate')
    expect(captured[0].headers['X-API-KEY']).toBe('profile-mancer-key')
    expect(captured[0].body).toMatchObject({
      temperature: 0.67,
      top_p: 0.81,
      top_k: 73,
      typical_p: 0.92,
      repetition_penalty: 1.17,
      do_sample: false,
      seed: 42,
      stopping_strings: ['STOP\nHERE'],
    })
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
    expect(captured[0].body.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'hello' }] }])
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
    expect(captured[0].body.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'hello' }] }])
  })

  it('uses Google AI Studio profile API key and request model over conflicting flat database fields', async () => {
    const profile = resolveModelProfile({
      database: db({
        aiModel: 'gemini-2.5-flash',
        google: { accessToken: 'profile-google-key', projectId: 'profile-project' },
      } as Partial<Database>),
      lookupModelInfo: (_database, id) =>
        geminiModelInfo({
          id,
          internalID: 'models/gemini-profile-wire-model',
          provider: LLMProvider.GoogleCloud,
          format: LLMFormat.GoogleCloud,
        }),
    })
    const flatConflict = db({
      aiModel: 'gemini-2.5-pro',
      google: { accessToken: 'flat-google-key', projectId: 'flat-project' },
    } as Partial<Database>)
    const captured = captureDispatchRequests(okGeminiResponse())

    await dispatchWithProfile(profile, flatConflict)

    expect(captured).toHaveLength(1)
    expect(captured[0].url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-profile-wire-model:generateContent?key=profile-google-key',
    )
    expect(captured[0].url).not.toContain('flat-google-key')
    expect(captured[0].body.contents).toEqual([{ role: 'user', parts: [{ text: 'hello' }] }])
  })

  it.each([
    { label: 'missing', google: undefined },
    { label: 'blank', google: { accessToken: '   ', projectId: 'profile-project' } },
  ])('does not fall back to flat DB Google key when the profile key is $label', async (testCase) => {
    const profile = resolveModelProfile({
      database: db({
        aiModel: 'gemini-2.5-flash',
        ...(testCase.google === undefined ? {} : { google: testCase.google }),
      } as Partial<Database>),
    })
    const flatConflict = db({
      aiModel: 'gemini-2.5-flash',
      google: { accessToken: 'flat-google-key', projectId: 'flat-project' },
    } as Partial<Database>)
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch)

    await expect(dispatchWithProfile(profile, flatConflict)).rejects.toThrow(
      'options.gemini.apiKey or options.gemini.vertex is required',
    )
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('uses Vertex profile service-account auth and request model over conflicting flat database fields', async () => {
    _resetVertexTokenCacheForTesting()
    const profilePrivateKey = generatePrivateKey()
    const profile = resolveModelProfile({
      database: db({
        aiModel: 'gemini-2.5-pro-vertex',
        google: { accessToken: 'studio-key-ignored-for-vertex', projectId: 'profile-project' },
        vertexRegion: 'us-central1',
        vertexClientEmail: 'svc@profile-project.iam.gserviceaccount.com',
        vertexPrivateKey: profilePrivateKey,
        vertexAccessToken: 'cached-profile-token',
      } as Partial<Database>),
      lookupModelInfo: (_database, id) =>
        geminiModelInfo({
          id,
          internalID: 'models/gemini-profile-vertex-wire-model',
          provider: LLMProvider.VertexAI,
          format: LLMFormat.VertexAIGemini,
        }),
    })
    const flatConflict = db({
      aiModel: 'gemini-2.5-flash-vertex',
      google: { accessToken: 'flat-studio-key', projectId: 'flat-project' },
      vertexRegion: 'europe-west1',
      vertexClientEmail: 'svc@flat-project.iam.gserviceaccount.com',
      vertexPrivateKey: 'not-a-valid-flat-private-key',
      vertexAccessToken: 'flat-cached-token',
    } as Partial<Database>)
    const captured = captureVertexRequests()

    await dispatchWithProfile(profile, flatConflict)

    expect(captured).toHaveLength(2)
    expect(captured[0].url).toBe('https://oauth2.googleapis.com/token')
    expect(captured[1].url).toBe(
      'https://us-central1-aiplatform.googleapis.com/v1/projects/profile-project/locations/us-central1/publishers/google/models/gemini-profile-vertex-wire-model:generateContent',
    )
    expect(captured[1].url).not.toContain('flat-project')
    expect(captured[1].url).not.toContain('europe-west1')
    expect(captured[1].headers.authorization).toBe('Bearer ya29.profile-token')

    const assertion = new URLSearchParams(captured[0].rawBody).get('assertion')
    expect(assertion).toBeTruthy()
    const jwtPayload = JSON.parse(Buffer.from(assertion!.split('.')[1], 'base64url').toString('utf8')) as {
      iss?: string
    }
    expect(jwtPayload.iss).toBe('svc@profile-project.iam.gserviceaccount.com')
  })

  it.each([
    {
      label: 'missing',
      profileDatabase: {
        aiModel: 'gemini-2.5-pro-vertex',
      } as Partial<Database>,
    },
    {
      label: 'partial',
      profileDatabase: {
        aiModel: 'gemini-2.5-pro-vertex',
        google: { accessToken: 'studio-key-ignored-for-vertex', projectId: 'profile-project' },
        vertexRegion: 'us-central1',
        vertexClientEmail: 'svc@profile-project.iam.gserviceaccount.com',
      } as Partial<Database>,
    },
  ])('does not fall back to flat DB Vertex auth when profile auth is $label', async (testCase) => {
    _resetVertexTokenCacheForTesting()
    const profile = resolveModelProfile({ database: db(testCase.profileDatabase) })
    const flatConflict = db({
      aiModel: 'gemini-2.5-pro-vertex',
      google: { accessToken: 'flat-studio-key', projectId: 'flat-project' },
      vertexRegion: 'us-central1',
      vertexClientEmail: 'svc@flat-project.iam.gserviceaccount.com',
      vertexPrivateKey: generatePrivateKey(),
      vertexAccessToken: 'flat-cached-token',
    } as Partial<Database>)
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch)

    await expect(dispatchWithProfile(profile, flatConflict)).rejects.toThrow('configuration is incomplete')
    expect(fetchSpy).not.toHaveBeenCalled()
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

  it('allows first-class Custom API profiles without an API key', async () => {
    const profile = resolveModelProfile({
      database: db({
        modelProfiles: [
          {
            id: 'custom-api-profile',
            name: 'Custom API',
            providerId: 'custom-api',
            modelId: 'custom-api',
            providerOptions: {
              baseUrl: 'https://profile-custom.example.com/v1',
              requestModel: 'profile-custom-model',
              extraHeaders: { 'X-Profile': 'custom' },
            },
          },
        ],
        modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'custom-api-profile' } },
      } as unknown as Partial<Database>),
    })
    const captured = captureOpenAIRequests()

    await dispatchWithProfile(
      profile,
      db({
        aiModel: 'reverse_proxy',
        forceReplaceUrl: 'https://flat-custom.example.com/v1',
        proxyKey: 'sk-flat-custom',
        customProxyRequestModel: 'flat-custom-model',
      } as Partial<Database>),
    )

    expect(captured).toHaveLength(1)
    expect(captured[0].url).toBe('https://profile-custom.example.com/v1/chat/completions')
    expect(captured[0].headers.authorization).toBeUndefined()
    expect(captured[0].headers['X-Profile']).toBe('custom')
    expect(captured[0].body.model).toBe('profile-custom-model')
  })

  it('uses first-class Debug Echo provider options as the echo payload', async () => {
    const profile = resolveModelProfile({
      database: db({
        modelProfiles: [
          {
            id: 'debug-echo-profile',
            name: 'Debug Echo',
            providerId: 'debug-echo',
            modelId: 'debug-echo',
            providerOptions: {
              baseUrl: 'debug://profile-base',
              requestModel: 'profile-debug-model',
            },
          },
        ],
        modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'debug-echo-profile' } },
      } as unknown as Partial<Database>),
    })
    const expectedContent = JSON.stringify(
      {
        provider: 'debug-echo',
        baseUrl: 'debug://profile-base',
        requestModel: 'profile-debug-model',
      },
      null,
      2,
    )
    const controller = new AbortController()
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')

    try {
      const frames = await dispatchChatProvider({
        database: db({
          aiModel: 'echo_model',
          echoMessage: 'flat echo should not leak',
          echoDelay: 60,
        } as Partial<Database>),
        profile,
        formated: [{ role: 'user', content: 'hello' }],
        signal: controller.signal,
      })
      expect(setTimeoutSpy).not.toHaveBeenCalled()

      const emitted = []
      for await (const frame of frames) {
        emitted.push(frame)
      }

      expect(emitted).toEqual([
        {
          kind: 'token',
          content: expectedContent,
        },
        { kind: 'done', finishReason: 'stop' },
      ])
    } finally {
      controller.abort()
      setTimeoutSpy.mockRestore()
    }
  })

  it.each([
    {
      label: 'incomplete official OpenAI profile',
      database: db({
        modelProfiles: [
          {
            id: 'openai-missing-key',
            name: 'OpenAI Missing Key',
            providerId: 'openai',
            modelId: 'gpt-5',
          },
        ],
        modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'openai-missing-key' } },
      } as unknown as Partial<Database>),
      reason: 'api-key-missing',
    },
    {
      label: 'unsupported provider id profile',
      database: db({
        modelProfiles: [
          {
            id: 'unsupported-provider',
            name: 'Unsupported Provider',
            providerId: 'not-a-provider',
            modelId: 'gpt-5',
          },
        ],
        modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'unsupported-provider' } },
      } as unknown as Partial<Database>),
      reason: 'unsupported-provider-id',
    },
  ])('rejects $label before provider fetch', async (testCase) => {
    const profile = resolveModelProfile({ database: testCase.database })
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch)

    await expect(dispatchWithProfile(profile, testCase.database)).rejects.toThrow(testCase.reason)
    expect(fetchSpy).not.toHaveBeenCalled()
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
