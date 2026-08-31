import { beforeEach, describe, expect, it, vi } from 'vitest'

const requestMocks = vi.hoisted(() => ({
  globalFetch: vi.fn(),
  resolveServerCompletionRoute: vi.fn(),
  strongBan: vi.fn(),
  tokenizeNum: vi.fn(),
}))

vi.mock('src/ts/globalApi.svelte', () => {
  class AppendableBuffer {
    buffer = new Uint8Array()
    append = vi.fn()
  }

  return {
    AppendableBuffer,
    addFetchLog: vi.fn(),
    downloadFile: vi.fn(),
    fetchNative: vi.fn(),
    forageStorage: {
      getItem: vi.fn(),
      keys: vi.fn(async () => []),
      removeItem: vi.fn(),
      setItem: vi.fn(),
    },
    globalFetch: requestMocks.globalFetch,
    openURL: vi.fn(),
    readImage: vi.fn(),
    saveAsset: vi.fn(),
    saveAssets: vi.fn(async () => []),
    textifyReadableStream: vi.fn(),
  }
})

vi.mock('src/ts/tokenizer', () => ({
  strongBan: requestMocks.strongBan,
  tokenizeNum: requestMocks.tokenizeNum,
}))

vi.mock('../serverCompletion', async (importActual) => {
  const actual = await importActual<typeof import('../serverCompletion')>()
  return { ...actual, resolveServerCompletionRoute: requestMocks.resolveServerCompletionRoute }
})

vi.mock('../../modules', async (importActual) => {
  const actual = await importActual<typeof import('../../modules')>()
  return {
    ...actual,
    getModuleMcps: () => [],
    getModuleToggles: () => '',
    getModuleTriggers: () => [],
    moduleUpdate: () => {},
  }
})

import { LLMFlags, LLMFormat, LLMProvider, LLMTokenizer, OpenAIParameters, type LLMModel } from '../../../model/types'
import { setDatabase, type Database } from '../../../storage/database.svelte'
import { requestOpenAI } from '../openAI/requests'
import { requestChatDataMain, type RequestDataArgumentExtended } from '../request'

function database(overrides: Partial<Database> = {}): Database {
  return {
    aiModel: 'gpt-5',
    subModel: 'gpt-5-mini',
    modelRoles: {},
    characters: [],
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
    additionalParams: [],
    OaiCompAPIKeys: {},
    openrouterProvider: { order: [], only: [], ignore: [] },
    localNetworkMode: false,
    gptVisionQuality: 'auto',
    newOAIHandle: false,
    NAIappendName: false,
    NAIadventure: false,
    NAIsettings: {
      topK: 40,
      topP: 0.9,
      topA: 0,
      tailFreeSampling: 1,
      repetitionPenalty: 1,
      repetitionPenaltyRange: 0,
      repetitionPenaltySlope: 0,
      repostitionPenaltyPresence: 0,
      seperator: '\\n',
      frequencyPenalty: 0,
      presencePenalty: 0,
      typicalp: 1,
      starter: '⁂',
    },
    novelai: { token: 'novel-token' },
    ...overrides,
  } as unknown as Database
}

function openAiModel(): LLMModel {
  return {
    id: 'gpt-5',
    name: 'GPT-5',
    provider: LLMProvider.OpenAI,
    format: LLMFormat.OpenAICompatible,
    flags: [LLMFlags.hasFullSystemPrompt],
    parameters: OpenAIParameters,
    tokenizer: LLMTokenizer.tiktokenO200Base,
  }
}

beforeEach(() => {
  requestMocks.globalFetch.mockReset()
  requestMocks.resolveServerCompletionRoute.mockReset().mockReturnValue({ type: 'local' })
  requestMocks.strongBan.mockReset().mockResolvedValue({ 91: -100 })
  requestMocks.tokenizeNum
    .mockReset()
    .mockImplementation(async (text: string) => (text === 'novel-bias' ? [41, 42] : [11, 12]))
})

describe('request tokenizer snapshot propagation', () => {
  it('uses the explicit request database for OpenAI ordinary bias and strong-ban tokenization', async () => {
    const snapshot = database()
    setDatabase(database({ aiModel: 'echo_model' }))
    const result = await requestOpenAI({
      database: snapshot,
      formated: [{ role: 'user', content: 'hello' }],
      bias: {},
      biasString: [
        ['blocked', -101],
        ['weighted', 7],
      ],
      aiModel: 'gpt-5',
      maxTokens: 64,
      useStreaming: false,
      previewBody: true,
      mode: 'model',
      modelInfo: openAiModel(),
    } as RequestDataArgumentExtended)

    expect(requestMocks.strongBan).toHaveBeenCalledWith('blocked', {}, snapshot)
    expect(requestMocks.tokenizeNum).toHaveBeenCalledWith('weighted', snapshot)
    expect(result.type).toBe('success')
    if (typeof result.result !== 'string') throw new Error('Expected preview body')
    expect(JSON.parse(result.result).body.logit_bias).toEqual({ 11: 7, 12: 7, 91: -100 })
  })

  it('uses the explicit request database for NovelAI bias tokenization', async () => {
    const snapshot = database({ aiModel: 'novelai_kayra' })
    setDatabase(snapshot)
    requestMocks.globalFetch.mockResolvedValue({
      ok: true,
      data: { output: 'novel response' },
      headers: {},
      status: 200,
    })

    const result = await requestChatDataMain(
      {
        database: snapshot,
        formated: [{ role: 'user', content: 'hello' }],
        bias: {},
        biasString: [['novel-bias', 4]],
        staticModel: 'novelai_kayra',
        tools: [],
      },
      'model',
    )

    expect(result).toEqual({ type: 'success', result: 'novel response' })
    expect(requestMocks.tokenizeNum).toHaveBeenCalledWith('novel-bias', snapshot)
    expect(requestMocks.globalFetch.mock.calls[0][1].body.parameters.logit_bias_exp).toEqual([
      {
        sequence: [41, 42],
        bias: 4,
        ensure_sequence_finish: false,
        generate_once: true,
      },
    ])
  })
})
