import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fetchNativeMock = vi.hoisted(() => vi.fn())
const globalFetchMock = vi.hoisted(() => vi.fn())

vi.mock('src/ts/platform', async (importActual) => {
  const actual = await importActual<typeof import('../../../platform')>()
  return {
    ...actual,
    isFastifyServer: true,
  }
})

vi.mock('src/ts/globalApi.svelte', async (importActual) => {
  const actual = await importActual<typeof import('../../../globalApi.svelte')>()
  return {
    ...actual,
    fetchNative: fetchNativeMock,
    textifyReadableStream: vi.fn(),
  }
})

vi.mock('../../modules', async (importActual) => {
  const actual = await importActual<typeof import('../../modules')>()
  return { ...actual, moduleUpdate: () => {}, getModuleToggles: () => '' }
})

import { resolveModelProfile, type ResolvedModelProfile } from '../../../model/modelProfileResolver'
import { LLMFlags, LLMFormat, LLMProvider, LLMTokenizer, type LLMModel } from '../../../model/types'
import { setDatabase, type Database } from '../../../storage/database.svelte'
import type { RequestDataArgumentExtended } from '../request'
import { requestGoogleCloudVertex } from '../google'
import { getDatabase } from 'src/ts/__tests__/resourceDatabaseState'

const originalWindowCrypto = window.crypto

function installCryptoStub(): void {
  const cryptoStub = {
    randomUUID: () => '00000000-0000-4000-8000-000000000000',
    subtle: {
      importKey: vi.fn(async () => ({ key: 'stub' })),
      sign: vi.fn(async () => new Uint8Array([1, 2, 3]).buffer),
    },
  } as unknown as Crypto
  vi.stubGlobal('crypto', cryptoStub)
  Object.defineProperty(window, 'crypto', {
    value: cryptoStub,
    configurable: true,
  })
}

function restoreWindowCrypto(): void {
  Object.defineProperty(window, 'crypto', {
    value: originalWindowCrypto,
    configurable: true,
  })
}

interface CapturedFetchCall {
  url: string
  init?: { headers?: Record<string, string>; body?: BodyInit }
}

function okTokenResponse(token: string): Response {
  return new Response(JSON.stringify({ access_token: token }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function okGeminiResponse(text: string): Response {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
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

function collectFetchCalls(): CapturedFetchCall[] {
  return [...globalFetchMock.mock.calls, ...fetchNativeMock.mock.calls].map(([url, init]) => ({
    url: String(url),
    init: init as CapturedFetchCall['init'],
  }))
}

function findFetchCall(pattern: string): CapturedFetchCall | undefined {
  return collectFetchCalls().find((call) => call.url.includes(pattern))
}

function decodeJwtPayload(segment: string): { iss?: string } {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
  return JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as { iss?: string }
}

function mockGeminiFetches(text: string): void {
  fetchNativeMock.mockImplementation(async () => okGeminiResponse(text))
  globalFetchMock.mockImplementation(async () => okGeminiResponse(text))
}

function mockVertexFetches(token: string, text: string): void {
  fetchNativeMock.mockImplementation(async () => okGeminiResponse(text))
  globalFetchMock.mockImplementation(async (url: string | URL | Request) =>
    String(url) === 'https://oauth2.googleapis.com/token' ? okTokenResponse(token) : okGeminiResponse(text),
  )
}

function seedDb(overrides: Partial<Database> = {}): void {
  const base = {
    aiModel: 'gemini-1.5-pro',
    subModel: 'gemini-1.5-pro',
    characters: [],
    maxContext: 4000,
    maxResponse: 32,
    botPresetsId: 0,
    statics: { messages: 0 } as unknown as Database['statics'],
    promptInfoInsideChat: false,
    google: {
      accessToken: '',
      projectId: 'vertex-project',
    },
    vertexRegion: 'us-central1',
    vertexClientEmail: 'svc@vertex-project.iam.gserviceaccount.com',
    vertexPrivateKey: '-----BEGIN PRIVATE KEY-----AQID-----END PRIVATE KEY-----',
    vertexAccessToken: 'old-projection-token',
    vertexAccessTokenExpires: 0,
  } as unknown as Database
  setDatabase({
    ...base,
    ...overrides,
    google: {
      ...(base.google ?? {}),
      ...(overrides.google ?? {}),
    },
  } as unknown as Database)
}

function geminiModelInfo(overrides: Partial<LLMModel> = {}): LLMModel {
  return {
    id: 'gemini-1.5-pro',
    name: 'Gemini',
    internalID: 'gemini-1.5-pro',
    provider: LLMProvider.GoogleCloud,
    format: LLMFormat.GoogleCloud,
    flags: [],
    parameters: [],
    tokenizer: LLMTokenizer.GoogleCloud,
    recommended: false,
    ...overrides,
  }
}

function makeVertexArg(): RequestDataArgumentExtended {
  return {
    database: getDatabase(),
    bias: {},
    formated: [{ role: 'user', content: 'hello' }],
    aiModel: 'gemini-1.5-pro',
    maxTokens: 32,
    useStreaming: false,
    modelInfo: geminiModelInfo({
      provider: LLMProvider.VertexAI,
      format: LLMFormat.VertexAIGemini,
    }) as RequestDataArgumentExtended['modelInfo'],
  } as RequestDataArgumentExtended
}

function makeProfileArg(profile: ResolvedModelProfile, modelInfo: Partial<LLMModel> = {}): RequestDataArgumentExtended {
  return {
    database: getDatabase(),
    bias: {},
    formated: [{ role: 'user', content: 'hello' }],
    aiModel: profile.modelId,
    maxTokens: 32,
    useStreaming: false,
    modelInfo: geminiModelInfo(modelInfo) as RequestDataArgumentExtended['modelInfo'],
    resolvedProfile: profile,
  } as RequestDataArgumentExtended
}

beforeEach(() => {
  installCryptoStub()
  seedDb()
  fetchNativeMock.mockReset()
  globalFetchMock.mockReset()
  mockVertexFetches('fresh-token', 'server vertex ok')
  vi.stubGlobal('fetch', globalFetchMock)
})

afterEach(() => {
  restoreWindowCrypto()
  vi.unstubAllGlobals()
})

describe('requestGoogleCloudVertex in Fastify mode', () => {
  it('uses a refreshed Vertex bearer without writing it into the server projection', async () => {
    const result = await requestGoogleCloudVertex(makeVertexArg())

    expect(result).toMatchObject({ type: 'success', result: 'server vertex ok' })
    expect(findFetchCall('https://oauth2.googleapis.com/token')).toBeTruthy()
    expect(
      findFetchCall('/publishers/google/models/gemini-1.5-pro:generateContent')?.init?.headers?.Authorization,
    ).toBe('Bearer fresh-token')

    const db = getDatabase()
    expect(db.vertexAccessToken).toBe('old-projection-token')
    expect(db.vertexAccessTokenExpires).toBe(0)
  })

  it.each([
    {
      model: 'gemini-3.6-flash',
      reasoningEffort: -1,
      flags: [LLMFlags.geminiThinking],
      expectedLevel: 'minimal',
    },
    {
      model: 'gemini-3.1-pro-preview',
      reasoningEffort: -1,
      flags: [LLMFlags.geminiThinking, LLMFlags.geminiThinkingNoMinimal],
      expectedLevel: 'low',
    },
    {
      model: 'gemini-3-flash-preview',
      reasoningEffort: 1,
      flags: [LLMFlags.geminiThinking],
      expectedLevel: 'medium',
    },
  ])('maps $model reasoning effort to thinkingLevel $expectedLevel', async (testCase) => {
    seedDb({
      aiModel: testCase.model,
      reasoningEffort: testCase.reasoningEffort,
      google: { accessToken: 'studio-key', projectId: 'studio-project' },
    } as Partial<Database>)

    const result = await requestGoogleCloudVertex({
      database: getDatabase(),
      bias: {},
      formated: [{ role: 'user', content: 'hello' }],
      aiModel: testCase.model,
      key: 'studio-key',
      maxTokens: 32,
      useStreaming: false,
      previewBody: true,
      mode: 'model',
      modelInfo: geminiModelInfo({
        id: testCase.model,
        internalID: testCase.model,
        flags: testCase.flags,
        parameters: ['reasoning_effort'],
      }) as RequestDataArgumentExtended['modelInfo'],
    } as RequestDataArgumentExtended)

    expect(result.type).toBe('success')
    if (result.type !== 'success' || typeof result.result !== 'string') throw new Error('Expected preview payload')
    const payload = JSON.parse(result.result) as { body: { generation_config: Record<string, unknown> } }
    expect(payload.body.generation_config.thinkingConfig).toEqual({
      thinkingLevel: testCase.expectedLevel,
      includeThoughts: true,
    })
    expect(payload.body.generation_config).not.toHaveProperty('thinkingBudget')
  })

  it('keeps Gemini 2.5 thinking tokens as a wrapped thinkingBudget', async () => {
    seedDb({
      aiModel: 'gemini-2.5-flash',
      thinkingTokens: 256,
      google: { accessToken: 'studio-key', projectId: 'studio-project' },
    } as Partial<Database>)

    const result = await requestGoogleCloudVertex({
      database: getDatabase(),
      bias: {},
      formated: [{ role: 'user', content: 'hello' }],
      aiModel: 'gemini-2.5-flash',
      key: 'studio-key',
      maxTokens: 32,
      useStreaming: false,
      previewBody: true,
      mode: 'model',
      modelInfo: geminiModelInfo({
        id: 'gemini-2.5-flash',
        internalID: 'gemini-2.5-flash',
        flags: [LLMFlags.geminiThinking],
        parameters: ['thinking_tokens'],
      }) as RequestDataArgumentExtended['modelInfo'],
    } as RequestDataArgumentExtended)

    expect(result.type).toBe('success')
    if (result.type !== 'success' || typeof result.result !== 'string') throw new Error('Expected preview payload')
    const payload = JSON.parse(result.result) as { body: { generation_config: Record<string, unknown> } }
    expect(payload.body.generation_config.thinkingConfig).toEqual({
      thinkingBudget: 256,
      includeThoughts: true,
    })
    expect(payload.body.generation_config).not.toHaveProperty('thinkingBudget')
  })

  it.each(['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.6-flash'])(
    'routes %s through the global Vertex endpoint',
    async (model) => {
      seedDb({ aiModel: model, vertexRegion: 'us-central1' } as Partial<Database>)

      const result = await requestGoogleCloudVertex({
        ...makeVertexArg(),
        aiModel: model,
        previewBody: true,
        modelInfo: geminiModelInfo({
          id: model,
          internalID: model,
          provider: LLMProvider.VertexAI,
          format: LLMFormat.VertexAIGemini,
        }) as RequestDataArgumentExtended['modelInfo'],
      } as RequestDataArgumentExtended)

      expect(result.type).toBe('success')
      if (result.type !== 'success' || typeof result.result !== 'string') throw new Error('Expected preview payload')
      const payload = JSON.parse(result.result) as { url: string }
      expect(payload.url).toContain('https://aiplatform.googleapis.com/v1/projects/vertex-project/locations/global/')
    },
  )

  it('uses Google AI Studio profile API key and stripped request model over conflicting flat values', async () => {
    seedDb({
      aiModel: 'gemini-flat-model',
      google: { accessToken: 'flat-google-key', projectId: 'flat-project' },
    } as Partial<Database>)
    mockGeminiFetches('profile studio ok')

    const profile = resolveModelProfile({
      database: {
        ...getDatabase(),
        aiModel: 'gemini-profile-model',
        google: { accessToken: 'profile-google-key', projectId: 'profile-project' },
        providerCredentials: [
          { id: 'google-profile-credential', name: 'Google profile', type: 'apiKey', apiKey: 'profile-google-key' },
        ],
        modelProfiles: [
          {
            id: 'google-profile',
            name: 'Google profile',
            modelId: 'gemini-profile-model',
            providerOptions: {
              credentialId: 'google-profile-credential',
              requestModel: 'gemini-profile-wire-model',
            },
          },
        ],
        modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'google-profile' } },
      } as Database,
      lookupModelInfo: (_database, id) =>
        geminiModelInfo({
          id,
          internalID: 'models/gemini-profile-wire-model',
          provider: LLMProvider.GoogleCloud,
          format: LLMFormat.GoogleCloud,
        }),
    })

    const result = await requestGoogleCloudVertex(
      makeProfileArg(profile, {
        id: 'gemini-flat-model',
        internalID: 'models/flat-wire-model',
        provider: LLMProvider.GoogleCloud,
        format: LLMFormat.GoogleCloud,
      }),
    )

    expect(result).toMatchObject({ type: 'success', result: 'profile studio ok' })
    const request = findFetchCall('/models/gemini-profile-wire-model:generateContent')
    expect(request?.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-profile-wire-model:generateContent?key=profile-google-key',
    )
    expect(request?.url).not.toContain('flat-google-key')
    expect(request?.url).not.toContain('models/models')
    expect(request?.url).not.toContain('flat-wire-model')
  })

  it('uses Vertex profile project, region, service account, private key, and stripped request model over flat values', async () => {
    seedDb({
      aiModel: 'gemini-flat-vertex',
      google: { accessToken: 'flat-studio-key', projectId: 'flat-project' },
      vertexRegion: 'europe-west1',
      vertexClientEmail: 'svc@flat-project.iam.gserviceaccount.com',
      vertexPrivateKey: 'not-a-valid-flat-private-key',
      vertexAccessToken: 'flat-cached-token',
      vertexAccessTokenExpires: Date.now() + 60_000,
    } as Partial<Database>)
    mockVertexFetches('profile-token', 'profile vertex ok')

    const profile = resolveModelProfile({
      database: {
        ...getDatabase(),
        aiModel: 'gemini-profile-vertex',
        google: { accessToken: 'studio-key-ignored-for-vertex', projectId: 'profile-project' },
        vertexRegion: 'us-central1',
        vertexClientEmail: 'svc@profile-project.iam.gserviceaccount.com',
        vertexPrivateKey: '-----BEGIN PRIVATE KEY-----AQID-----END PRIVATE KEY-----',
        vertexAccessToken: 'profile-cached-token-not-a-credential',
        providerCredentials: [
          {
            id: 'vertex-profile-credential',
            name: 'Vertex profile',
            type: 'vertexServiceAccount',
            vertex: {
              clientEmail: 'svc@profile-project.iam.gserviceaccount.com',
              privateKey: '-----BEGIN PRIVATE KEY-----AQID-----END PRIVATE KEY-----',
            },
          },
        ],
        modelProfiles: [
          {
            id: 'vertex-profile',
            name: 'Vertex profile',
            modelId: 'gemini-profile-vertex',
            providerOptions: {
              credentialId: 'vertex-profile-credential',
              requestModel: 'gemini-profile-vertex-wire-model',
              vertex: { projectId: 'profile-project', region: 'us-central1' },
            },
          },
        ],
        modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'vertex-profile' } },
      } as Database,
      lookupModelInfo: (_database, id) =>
        geminiModelInfo({
          id,
          internalID: 'models/gemini-profile-vertex-wire-model',
          provider: LLMProvider.VertexAI,
          format: LLMFormat.VertexAIGemini,
        }),
    })

    const result = await requestGoogleCloudVertex(
      makeProfileArg(profile, {
        id: 'gemini-flat-vertex',
        internalID: 'models/flat-vertex-wire-model',
        provider: LLMProvider.VertexAI,
        format: LLMFormat.VertexAIGemini,
      }),
    )

    expect(result).toMatchObject({ type: 'success', result: 'profile vertex ok' })
    const tokenRequest = findFetchCall('https://oauth2.googleapis.com/token')
    expect(tokenRequest).toBeTruthy()

    const request = findFetchCall('/publishers/google/models/gemini-profile-vertex-wire-model:generateContent')
    expect(request?.url).toBe(
      'https://us-central1-aiplatform.googleapis.com/v1/projects/profile-project/locations/us-central1/publishers/google/models/gemini-profile-vertex-wire-model:generateContent',
    )
    expect(request?.url).not.toContain('flat-project')
    expect(request?.url).not.toContain('europe-west1')
    expect(request?.url).not.toContain('flat-vertex-wire-model')
    expect(request?.init?.headers?.Authorization).toBe('Bearer profile-token')
    expect(request?.init?.headers?.Authorization).not.toBe('Bearer flat-cached-token')

    const assertion = new URLSearchParams(String(tokenRequest?.init?.body ?? '')).get('assertion')
    expect(assertion).toBeTruthy()
    const jwtPayload = decodeJwtPayload(assertion!.split('.')[1])
    expect(jwtPayload.iss).toBe('svc@profile-project.iam.gserviceaccount.com')
  })

  it('preserves multibyte text split across Gemini SSE byte chunks', async () => {
    const expected = '한字😀'
    const sse = `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: expected }] } }] })}\n\n`
    const streamResponse = () => utf8BoundarySplitResponse(sse, ['한', '字', '😀'])
    fetchNativeMock.mockImplementation(streamResponse)
    globalFetchMock.mockImplementation(streamResponse)

    const result = await requestGoogleCloudVertex({
      ...makeVertexArg(),
      aiModel: 'gemini-1.5-pro',
      key: 'studio-key',
      useStreaming: true,
      modelInfo: geminiModelInfo({
        provider: LLMProvider.GoogleCloud,
        format: LLMFormat.GoogleCloud,
      }) as RequestDataArgumentExtended['modelInfo'],
    })

    expect(result.type).toBe('streaming')
    if (result.type !== 'streaming') throw new Error('Expected a streaming response')

    const streamedChunks: string[] = []
    for await (const chunk of result.result) streamedChunks.push(chunk['0'] ?? '')
    const streamed = streamedChunks.at(-1) ?? ''

    expect(streamedChunks).toContain(expected)
    expect(streamed).toBe(expected)
    expect(streamed).not.toContain('\uFFFD')
  })
})
