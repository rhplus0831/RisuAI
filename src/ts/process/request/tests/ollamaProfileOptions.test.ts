import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const globalFetchMock = vi.hoisted(() => vi.fn())
const fetchMock = vi.hoisted(() => vi.fn())
const resolveServerCompletionRouteMock = vi.hoisted(() => vi.fn())

vi.mock('src/ts/globalApi.svelte', async (importActual) => {
  const actual = await importActual<typeof import('../../../globalApi.svelte')>()
  return {
    ...actual,
    globalFetch: globalFetchMock,
  }
})

vi.mock('../serverCompletion', async (importActual) => {
  const actual = await importActual<typeof import('../serverCompletion')>()
  return {
    ...actual,
    resolveServerCompletionRoute: resolveServerCompletionRouteMock,
  }
})

vi.mock('../../modules', async (importActual) => {
  const actual = await importActual<typeof import('../../modules')>()
  return { ...actual, moduleUpdate: () => {}, getModuleToggles: () => '', getModuleTriggers: () => [] }
})

import { LLMFormat } from '../../../model/types'
import { setDatabase, type Database } from '../../../storage/database.svelte'
import { selectedCharID } from '../../../stores.svelte'
import { requestChatDataMain } from '../request'

interface PreviewPayload {
  url: string
  model: string
  source: string
  stream: boolean
  think?: boolean | 'low' | 'medium' | 'high'
  headers: Record<string, string>
}

function db(overrides: Partial<Database> = {}): Database {
  return {
    aiModel: 'ollama-hosted',
    subModel: 'ollama-hosted',
    characters: [{ name: 'Ollama Character', chats: [], chatPage: 0 }],
    modelRoles: {},
    seperateModelsForAxModels: false,
    seperateModels: {},
    fallbackModels: {},
    customModels: [],
    modelTools: [],
    temperature: 50,
    top_p: 0.9,
    top_k: 40,
    top_a: 0,
    repetition_penalty: 1.05,
    frequencyPenalty: -1000,
    PresensePenalty: -1000,
    maxContext: 4096,
    maxResponse: 512,
    useStreaming: false,
    genTime: 1,
    extractJson: '',
    ollamaURL: 'https://profile.ollama.example',
    ollamaModel: 'profile-local-model',
    ollamaModelSource: 'local',
    ollamaInputMode: 'manual',
    ollamaRequestFormat: LLMFormat.Ollama,
    ollamaApiKey: 'sk-profile-ollama',
    ollamaModelName: 'Profile Local Model',
    ollamaCloudModel: 'profile-cloud-model',
    ollamaCloudModelName: 'Profile Cloud Model',
    ollamaThinkingMode: 'high',
    OaiCompAPIKeys: {},
    openrouterProvider: { order: [], only: [], ignore: [] },
    localNetworkMode: false,
    gptVisionQuality: 'auto',
    newOAIHandle: false,
    instructChatTemplate: 'chatml',
    JinjaTemplate: '',
    username: 'Profile User',
    ...overrides,
  } as unknown as Database
}

function makeRequest() {
  return {
    formated: [{ role: 'user' as const, content: 'hello ollama' }],
    bias: {},
    maxTokens: 96,
    previewBody: true,
    useStreaming: false,
    tools: [],
  }
}

function switchActiveDbDuringRoute(overrides: Partial<Database>): void {
  resolveServerCompletionRouteMock.mockImplementation(() => {
    setDatabase(db(overrides))
    return { type: 'local' }
  })
}

async function preview(): Promise<PreviewPayload> {
  const result = await requestChatDataMain(makeRequest(), 'model')
  expect(result.type).toBe('success')
  if (typeof result.result !== 'string') throw new Error('Expected preview body string')
  return JSON.parse(result.result) as PreviewPayload
}

beforeEach(() => {
  selectedCharID.set(0)
  vi.stubGlobal('safeStructuredClone', (value: unknown) =>
    value === undefined ? undefined : JSON.parse(JSON.stringify(value)),
  )
  vi.stubGlobal('fetch', fetchMock)
  globalFetchMock.mockReset()
  fetchMock.mockReset()
  resolveServerCompletionRouteMock.mockReset()
  resolveServerCompletionRouteMock.mockReturnValue({ type: 'local' })
})

afterEach(() => {
  selectedCharID.set(-1)
  vi.unstubAllGlobals()
})

describe('requestOllama profile provider options through requestChatDataMain', () => {
  it('uses local native Ollama profile URL, model, source, and thinking mode over conflicting flat fields', async () => {
    setDatabase(
      db({
        aiModel: 'ollama-hosted',
        ollamaURL: 'https://profile.ollama.example',
        ollamaModel: 'profile-local-model',
        ollamaModelSource: 'local',
        ollamaThinkingMode: 'high',
      }),
    )
    switchActiveDbDuringRoute({
      ollamaURL: 'https://flat.ollama.example',
      ollamaModel: 'flat-local-model',
      ollamaModelSource: 'cloud',
      ollamaThinkingMode: 'off',
    })

    const payload = await preview()

    expect(payload.url).toBe('https://profile.ollama.example/api/chat')
    expect(payload.model).toBe('profile-local-model')
    expect(payload.source).toBe('local')
    expect(payload.think).toBe('high')
    expect(payload.headers).toEqual({})
  })

  it('uses cloud native Ollama profile model, API key, source, and thinking mode over conflicting flat fields', async () => {
    setDatabase(
      db({
        aiModel: 'ollama-cloud',
        subModel: 'ollama-cloud',
        ollamaApiKey: 'sk-profile-cloud',
        ollamaRequestFormat: LLMFormat.Ollama,
        ollamaCloudModel: 'profile-cloud-model',
        ollamaModelSource: 'cloud',
        ollamaThinkingMode: 'medium',
      }),
    )
    switchActiveDbDuringRoute({
      aiModel: 'ollama-cloud',
      subModel: 'ollama-cloud',
      ollamaApiKey: 'sk-flat-cloud',
      ollamaRequestFormat: LLMFormat.OpenAICompatible,
      ollamaCloudModel: 'flat-cloud-model',
      ollamaModelSource: 'local',
      ollamaThinkingMode: 'off',
    })

    const payload = await preview()

    expect(payload.url).toBe('https://ollama.com/api/chat')
    expect(payload.model).toBe('profile-cloud-model')
    expect(payload.source).toBe('cloud')
    expect(payload.think).toBe('medium')
    expect(payload.headers.Authorization).toBe('Bearer sk-profile-cloud')
  })

  it('fails without falling back to flat db.ollamaURL when profile local URL is missing', async () => {
    setDatabase(
      db({
        aiModel: 'ollama-hosted',
        ollamaURL: '',
        ollamaModel: 'profile-missing-url-model',
      }),
    )
    switchActiveDbDuringRoute({
      ollamaURL: 'https://flat-required.ollama.example',
      ollamaModel: 'flat-required-model',
    })

    const result = await requestChatDataMain(makeRequest(), 'model')

    expect(result).toEqual({
      type: 'fail',
      result: 'options.ollama.baseUrl is required',
      noRetry: true,
    })
    expect(globalFetchMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
