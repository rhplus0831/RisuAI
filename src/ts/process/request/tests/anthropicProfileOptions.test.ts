import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fetchNativeMock = vi.hoisted(() => vi.fn())
const globalFetchMock = vi.hoisted(() => vi.fn())

vi.mock('src/ts/globalApi.svelte', async (importActual) => {
  const actual = await importActual<typeof import('../../../globalApi.svelte')>()
  return {
    ...actual,
    fetchNative: fetchNativeMock,
    globalFetch: globalFetchMock,
  }
})

vi.mock('../../modules', async (importActual) => {
  const actual = await importActual<typeof import('../../modules')>()
  return { ...actual, moduleUpdate: () => {}, getModuleToggles: () => '', getModuleTriggers: () => [] }
})

import { resolveModelProfile, type ResolvedModelProfile } from '../../../model/modelProfileResolver'
import { ClaudeParameters, LLMFlags, LLMFormat, LLMProvider, LLMTokenizer, type LLMModel } from '../../../model/types'
import { getDatabase, setDatabase, type Database } from '../../../storage/database.svelte'
import { requestClaude } from '../anthropic'
import type { RequestDataArgumentExtended } from '../request'

interface PreviewPayload {
  url: string
  body: Record<string, any>
  headers: Record<string, string>
}

function db(overrides: Partial<Database> = {}): Database {
  return {
    aiModel: 'claude-sonnet-4-5-20250929',
    subModel: 'claude-sonnet-4-5-20250929',
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
    autofillRequestUrl: true,
    claudeBatching: false,
    claudeRetrivalCaching: false,
    claude1HourCaching: false,
    usePlainFetch: false,
    thinkingType: 'off',
    ...overrides,
  } as unknown as Database
}

function modelInfo(overrides: Partial<LLMModel>): LLMModel {
  return {
    id: 'claude-legacy',
    name: 'Claude Legacy',
    internalID: 'claude-legacy-wire',
    provider: LLMProvider.Anthropic,
    format: LLMFormat.Anthropic,
    flags: [LLMFlags.hasFirstSystemPrompt],
    parameters: ClaudeParameters,
    tokenizer: LLMTokenizer.Claude,
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

async function preview(arg: RequestDataArgumentExtended): Promise<PreviewPayload> {
  const result = await requestClaude(arg)
  expect(result.type).toBe('success')
  if (typeof result.result !== 'string') throw new Error('Expected preview body string')
  return JSON.parse(result.result) as PreviewPayload
}

function utf8BoundarySplitResponse(body: string, splitCharacters: string[]): Response {
  const encoder = new TextEncoder()
  const bytes = encoder.encode(body)
  const splitOffsets = splitCharacters.map((character) => {
    const characterIndex = body.indexOf(character)
    if (characterIndex === -1) throw new Error(`Missing split character: ${character}`)
    return encoder.encode(body.slice(0, characterIndex)).byteLength + 1
  })
  const chunks = splitOffsets.map((offset, index) => bytes.slice(index === 0 ? 0 : splitOffsets[index - 1], offset))
  chunks.push(bytes.slice(splitOffsets.at(-1) ?? 0))

  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk)
        controller.close()
      },
    }),
    { status: 200 },
  )
}

beforeEach(() => {
  fetchNativeMock.mockReset()
  globalFetchMock.mockReset()
  vi.stubGlobal('fetch', globalFetchMock)
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('requestClaude profile provider options', () => {
  it('uses profile-owned adaptive thinking over conflicting flat settings', async () => {
    const resolved = resolveModelProfile({
      database: db({
        aiModel: 'claude-sonnet-4-5-20250929',
        thinkingType: 'adaptive',
        adaptiveThinkingEffort: 'medium',
      } as Partial<Database>),
    })
    const profile: ResolvedModelProfile = {
      ...resolved,
      runtimeOptions: {
        ...resolved.runtimeOptions,
        thinkingType: 'adaptive',
        adaptiveThinkingEffort: 'medium',
      },
      modelInfo: {
        ...resolved.modelInfo,
        flags: [...resolved.modelInfo.flags, LLMFlags.claudeAdaptiveThinking],
      },
    }
    setDatabase(db({ thinkingType: 'off', adaptiveThinkingEffort: 'low' } as Partial<Database>))

    const payload = await preview(makeArg(profile))

    expect(payload.body.thinking).toEqual({ type: 'adaptive', display: 'summarized' })
    expect(payload.body.output_config).toEqual({ effort: 'medium' })
  })

  it('retains flat adaptive thinking for callers without a resolved profile', async () => {
    setDatabase(db({ thinkingType: 'adaptive', adaptiveThinkingEffort: 'low' } as Partial<Database>))

    const payload = await preview({
      formated: [{ role: 'user', content: 'hello' }],
      bias: {},
      biasString: [],
      aiModel: 'claude-sonnet-4-5-20250929',
      maxTokens: 64,
      useStreaming: false,
      previewBody: true,
      mode: 'model',
      modelInfo: modelInfo({ flags: [LLMFlags.claudeAdaptiveThinking] }),
    } as RequestDataArgumentExtended)

    expect(payload.body.thinking).toEqual({ type: 'adaptive', display: 'summarized' })
    expect(payload.body.output_config).toEqual({ effort: 'low' })
  })

  it('uses reverse_proxy profile URL, key, request model, additional params, and risu header over flat DB and arg conflicts', async () => {
    const profile = resolveModelProfile({
      database: db({
        aiModel: 'reverse_proxy',
        customAPIFormat: LLMFormat.Anthropic,
        forceReplaceUrl: 'risu::https://profile.proxy.example/v1',
        proxyKey: 'sk-profile-proxy',
        customProxyRequestModel: 'profile-claude-model',
        additionalParams: [
          ['profile_param', '"from-profile"'],
          ['header::X-Profile-Param', 'profile-header'],
        ],
      } as Partial<Database>),
    })
    setDatabase(
      db({
        aiModel: 'reverse_proxy',
        customAPIFormat: LLMFormat.Anthropic,
        forceReplaceUrl: 'https://flat.proxy.example/v1',
        proxyKey: 'sk-flat-proxy',
        customProxyRequestModel: 'flat-claude-model',
        additionalParams: [
          ['flat_param', '"from-flat"'],
          ['header::X-Flat-Param', 'flat-header'],
        ],
      } as Partial<Database>),
    )

    const payload = await preview(
      makeArg(profile, {
        customURL: getDatabase().forceReplaceUrl,
        key: 'sk-flat-arg-proxy',
      }),
    )

    expect(payload.url).toBe('https://profile.proxy.example/v1/messages')
    expect(payload.headers['x-api-key']).toBe('sk-profile-proxy')
    expect(payload.headers.Authorization).toBeUndefined()
    expect(payload.headers['X-Proxy-Risu']).toBe('RisuAI')
    expect(payload.headers['X-Profile-Param']).toBe('profile-header')
    expect(payload.headers['X-Flat-Param']).toBeUndefined()
    expect(payload.body.model).toBe('profile-claude-model')
    expect(payload.body.profile_param).toBe('from-profile')
    expect(payload.body.flat_param).toBeUndefined()
  })

  it('uses Bedrock profile credentials and prefixed request model over flat DB conflicts', async () => {
    const profile = resolveModelProfile({
      database: db({
        aiModel: 'anthropic.claude-sonnet-4-5-20250929-v1:0',
        claudeAPIKey: 'PROFILEACCESS:PROFILESECRET:ap-southeast-2',
      } as Partial<Database>),
    })
    setDatabase(
      db({
        aiModel: 'anthropic.claude-sonnet-4-5-20250929-v1:0',
        claudeAPIKey: 'FLATACCESS:FLATSECRET:us-east-1',
      } as Partial<Database>),
    )

    const payload = await preview(makeArg(profile))
    const authorization = payload.headers.Authorization ?? payload.headers.authorization ?? ''

    expect(payload.url).toContain('https://bedrock-runtime.ap-southeast-2.amazonaws.com/model/')
    expect(payload.url).toContain('/model/global.anthropic.claude-sonnet-4-5-20250929-v1:0/invoke')
    expect(payload.url).not.toContain('us.global.')
    expect(payload.url).not.toContain('global.global.')
    expect(authorization).toContain('Credential=PROFILEACCESS/')
    expect(authorization).toContain('/ap-southeast-2/bedrock/aws4_request')
    expect(authorization).not.toContain('FLATACCESS')
    expect(payload.body.model).toBeUndefined()
    expect(payload.body.anthropic_version).toBe('bedrock-2023-05-31')
  })

  it('uses Ollama Cloud Anthropic profile URL, key, and request model over flat DB and arg conflicts', async () => {
    const profile = resolveModelProfile({
      database: db({
        aiModel: 'ollama-cloud',
        ollamaApiKey: 'sk-profile-ollama',
        ollamaRequestFormat: LLMFormat.Anthropic,
        ollamaCloudModel: 'profile-ollama-claude',
        ollamaModelSource: 'cloud',
      } as Partial<Database>),
    })
    setDatabase(
      db({
        aiModel: 'ollama-cloud',
        ollamaApiKey: 'sk-flat-ollama',
        ollamaRequestFormat: LLMFormat.Anthropic,
        ollamaCloudModel: 'flat-ollama-claude',
        ollamaModelSource: 'cloud',
        claudeAPIKey: 'sk-flat-claude',
      } as Partial<Database>),
    )

    const payload = await preview(
      makeArg(profile, {
        customURL: 'https://flat.ollama.example/v1/messages',
        key: 'sk-flat-arg-ollama',
        modelInfo: modelInfo({
          id: 'ollama-cloud',
          internalID: 'flat-ollama-wire',
          provider: LLMProvider.Ollama,
          format: LLMFormat.Anthropic,
        }),
      }),
    )

    expect(payload.url).toBe('https://ollama.com/v1/messages')
    expect(payload.headers.Authorization).toBe('Bearer sk-profile-ollama')
    expect(payload.headers['x-api-key']).toBeUndefined()
    expect(payload.body.model).toBe('profile-ollama-claude')
  })

  it('keeps no-resolvedProfile reverse_proxy legacy URL, key, model, and additional param fallbacks', async () => {
    setDatabase(
      db({
        aiModel: 'reverse_proxy',
        customAPIFormat: LLMFormat.Anthropic,
        forceReplaceUrl: 'https://legacy.proxy.example/v1',
        proxyKey: 'sk-legacy-db-proxy',
        customProxyRequestModel: 'legacy-db-claude-model',
        additionalParams: [
          ['legacy_param', '"from-legacy"'],
          ['header::X-Legacy-Param', 'legacy-header'],
        ],
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
      customURL: getDatabase().forceReplaceUrl,
      key: 'sk-legacy-arg-proxy',
      modelInfo: modelInfo({
        id: 'reverse_proxy',
        internalID: 'legacy-arg-claude-model',
        provider: LLMProvider.AsIs,
      }),
    } as RequestDataArgumentExtended)

    expect(payload.url).toBe('https://legacy.proxy.example/v1/messages')
    expect(payload.headers['x-api-key']).toBe('sk-legacy-arg-proxy')
    expect(payload.headers['X-Legacy-Param']).toBe('legacy-header')
    expect(payload.body.model).toBe('legacy-arg-claude-model')
    expect(payload.body.legacy_param).toBe('from-legacy')
  })

  it('preserves multibyte text split across Anthropic SSE byte chunks', async () => {
    const expected = '한字😀'
    const sse = `data: ${JSON.stringify({
      type: 'content_block_delta',
      delta: { type: 'text_delta', text: expected },
    })}\n\n`
    const streamResponse = () => utf8BoundarySplitResponse(sse, ['한', '字', '😀'])
    fetchNativeMock.mockImplementation(streamResponse)
    globalFetchMock.mockImplementation(streamResponse)
    setDatabase(
      db({
        aiModel: 'reverse_proxy',
        customAPIFormat: LLMFormat.Anthropic,
        forceReplaceUrl: 'https://stream.proxy.example/v1/messages',
        proxyKey: 'stream-key',
        useStreaming: true,
      } as Partial<Database>),
    )

    const result = await requestClaude({
      formated: [{ role: 'user', content: 'hello' }],
      bias: {},
      biasString: [],
      aiModel: 'reverse_proxy',
      maxTokens: 64,
      useStreaming: true,
      mode: 'model',
      customURL: getDatabase().forceReplaceUrl,
      key: 'stream-key',
      modelInfo: modelInfo({
        id: 'reverse_proxy',
        internalID: 'claude-stream-model',
        provider: LLMProvider.AsIs,
      }),
    } as RequestDataArgumentExtended)

    expect(result.type).toBe('streaming')
    if (result.type !== 'streaming') throw new Error('Expected a streaming response')

    let streamed = ''
    for await (const chunk of result.result) streamed = chunk['0'] ?? streamed

    expect(streamed).toBe(expected)
    expect(streamed).not.toContain('\uFFFD')
  })
})
