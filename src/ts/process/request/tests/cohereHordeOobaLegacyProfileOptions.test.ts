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
  body: Record<string, any>
  headers: Record<string, string>
}

function oobaSettings(overrides: Partial<Database['ooba']> = {}): Database['ooba'] {
  return {
    max_new_tokens: 180,
    do_sample: true,
    temperature: 0.7,
    top_p: 0.9,
    typical_p: 1,
    repetition_penalty: 1.15,
    encoder_repetition_penalty: 1,
    top_k: 20,
    min_length: 0,
    no_repeat_ngram_size: 0,
    num_beams: 1,
    penalty_alpha: 0,
    length_penalty: 1,
    early_stopping: false,
    seed: -1,
    add_bos_token: true,
    truncation_length: 4096,
    ban_eos_token: false,
    skip_special_tokens: true,
    top_a: 0,
    tfs: 1,
    epsilon_cutoff: 0,
    eta_cutoff: 0,
    formating: {
      header:
        'Below is an instruction that describes a task. Write a response that appropriately completes the request.',
      systemPrefix: '### Instruction:',
      userPrefix: '### Input:',
      assistantPrefix: '### Response:',
      seperator: '',
      useName: false,
    },
    ...overrides,
  } as Database['ooba']
}

function db(overrides: Partial<Database> = {}): Database {
  return {
    aiModel: 'cohere-command-r',
    subModel: 'cohere-command-r',
    characters: [{ name: 'Profile Character', chats: [], chatPage: 0 }],
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
    min_p: 0,
    repetition_penalty: 1.05,
    frequencyPenalty: -1000,
    PresensePenalty: -1000,
    maxContext: 4096,
    maxResponse: 512,
    useStreaming: false,
    genTime: 1,
    extractJson: '',
    cohereAPIKey: 'sk-profile-cohere',
    forceReplaceUrl: '',
    proxyKey: '',
    customProxyRequestModel: '',
    customAPIFormat: LLMFormat.OpenAICompatible,
    autofillRequestUrl: true,
    reverseProxyOobaMode: false,
    reverseProxyOobaArgs: {},
    additionalParams: [],
    textgenWebUIStreamURL: 'wss://profile.ooba.example/api/v1/stream',
    textgenWebUIBlockingURL: 'https://profile.ooba.example/api/v1/generate',
    mancerHeader: '',
    ooba: oobaSettings(),
    hordeConfig: { apiKey: '', model: '', softPrompt: '' },
    OaiCompAPIKeys: {},
    openrouterProvider: { order: [], only: [], ignore: [] },
    localNetworkMode: false,
    gptVisionQuality: 'auto',
    newOAIHandle: false,
    instructChatTemplate: 'chatml',
    JinjaTemplate: '',
    username: 'Profile User',
    systemContentReplacement: '',
    systemRoleReplacement: 'system',
    ...overrides,
  } as unknown as Database
}

function makeRequest(overrides: Record<string, unknown> = {}) {
  return {
    formated: [
      { role: 'system' as const, content: 'profile system' },
      { role: 'user' as const, content: 'hello profile' },
    ],
    bias: {},
    useStreaming: false,
    tools: [],
    ...overrides,
  }
}

function switchActiveDbDuringRoute(overrides: Partial<Database>): void {
  resolveServerCompletionRouteMock.mockImplementation(() => {
    setDatabase(db(overrides))
    return { type: 'local' }
  })
}

async function preview(overrides: Record<string, unknown> = {}): Promise<PreviewPayload> {
  const result = await requestChatDataMain(makeRequest({ previewBody: true, ...overrides }), 'model')
  expect(result.type).toBe('success')
  if (typeof result.result !== 'string') throw new Error('Expected preview body string')
  return JSON.parse(result.result) as PreviewPayload
}

function installHordeFetchMock(): void {
  fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
    const url = input.toString()
    if (url === 'https://stablehorde.net/api/v2/generate/text/async') {
      return new Response(JSON.stringify({ id: 'horde-job', kudos: 0, message: '' }), { status: 202 })
    }
    if (url === 'https://stablehorde.net/api/v2/generate/text/status/horde-job') {
      return new Response(
        JSON.stringify({
          is_possible: true,
          done: true,
          generations: [{ text: 'Horde answer' }],
        }),
        { status: 200 },
      )
    }
    throw new Error(`Unexpected Horde fetch URL: ${url}`)
  })
}

async function runHordeRequest() {
  const resultPromise = requestChatDataMain(makeRequest(), 'model')
  expect(fetchMock).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(0)
  await vi.advanceTimersByTimeAsync(2000)
  return resultPromise
}

beforeEach(() => {
  selectedCharID.set(0)
  vi.stubGlobal('safeStructuredClone', (value: unknown) =>
    value === undefined ? undefined : JSON.parse(JSON.stringify(value)),
  )
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(console, 'log').mockImplementation(() => {})
  globalFetchMock.mockReset()
  fetchMock.mockReset()
  resolveServerCompletionRouteMock.mockReset()
  resolveServerCompletionRouteMock.mockReturnValue({ type: 'local' })
})

afterEach(() => {
  selectedCharID.set(-1)
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('requestCohere profile provider options through requestChatDataMain', () => {
  it('uses reverse_proxy profile URL, key, model, headers, and additional params over flat conflicts', async () => {
    setDatabase(
      db({
        aiModel: 'reverse_proxy',
        subModel: 'reverse_proxy',
        customAPIFormat: LLMFormat.Cohere,
        forceReplaceUrl: 'risu::https://profile.cohere.example/v1',
        proxyKey: 'sk-profile-proxy-cohere',
        customProxyRequestModel: 'profile-cohere-model',
        additionalParams: [
          ['profile_param', '"from-profile"'],
          ['header::X-Profile-Param', 'profile-header'],
        ],
      } as Partial<Database>),
    )
    switchActiveDbDuringRoute({
      aiModel: 'reverse_proxy',
      subModel: 'reverse_proxy',
      customAPIFormat: LLMFormat.Cohere,
      forceReplaceUrl: 'risu::https://flat.cohere.example/v1',
      proxyKey: 'sk-flat-proxy-cohere',
      customProxyRequestModel: 'flat-cohere-model',
      cohereAPIKey: 'sk-flat-cohere',
      additionalParams: [
        ['flat_param', '"from-flat"'],
        ['header::X-Flat-Param', 'flat-header'],
      ],
    })

    const payload = await preview()

    expect(payload.url).toBe('https://profile.cohere.example/v1/chat')
    expect(payload.headers.Authorization).toBe('Bearer sk-profile-proxy-cohere')
    expect(payload.headers['X-Proxy-Risu']).toBe('RisuAI')
    expect(payload.headers['X-Profile-Param']).toBe('profile-header')
    expect(payload.headers['X-Flat-Param']).toBeUndefined()
    expect(payload.body.model).toBe('profile-cohere-model')
    expect(payload.body.profile_param).toBe('from-profile')
    expect(payload.body.flat_param).toBeUndefined()
  })

  it('derives newer Command R safety mode from the profile model id instead of flat aiModel', async () => {
    setDatabase(
      db({
        aiModel: 'cohere-command-r-03-2024',
        subModel: 'cohere-command-r-03-2024',
        cohereAPIKey: 'sk-profile-command-r',
      }),
    )
    switchActiveDbDuringRoute({
      aiModel: 'cohere-command-r',
      subModel: 'cohere-command-r',
      cohereAPIKey: 'sk-flat-command-r',
    })

    const payload = await preview()

    expect(payload.url).toBe('https://api.cohere.com/v1/chat')
    expect(payload.headers.Authorization).toBe('Bearer sk-profile-command-r')
    expect(payload.body.model).toBe('cohere-command-r-03-2024')
    expect(payload.body.safety_mode).toBeUndefined()
  })
})

describe('requestOobaLegacy profile provider options through requestChatDataMain', () => {
  it('uses profile URL, key, and runtime fields over flat conflicts', async () => {
    setDatabase(
      db({
        aiModel: 'mancer',
        subModel: 'mancer',
        textgenWebUIBlockingURL: 'https://profile.ooba.example/root/api/v1/blocking',
        textgenWebUIStreamURL: 'wss://profile.ooba.example/root/api/v1/stream',
        mancerHeader: 'sk-profile-mancer',
        maxResponse: 222,
        maxContext: 3333,
        temperature: 66,
      }),
    )
    switchActiveDbDuringRoute({
      aiModel: 'mancer',
      subModel: 'mancer',
      textgenWebUIBlockingURL: 'https://flat.ooba.example/api/v1/generate',
      textgenWebUIStreamURL: 'wss://flat.ooba.example/api/v1/stream',
      mancerHeader: 'sk-flat-mancer',
      maxResponse: 999,
      maxContext: 111,
      temperature: 10,
    })

    const payload = await preview()

    expect(payload.url).toBe('https://profile.ooba.example/root/api/v1/generate')
    expect(payload.headers['X-API-KEY']).toBe('sk-profile-mancer')
    expect(payload.body.max_new_tokens).toBe(222)
    expect(payload.body.truncation_length).toBe(3333)
    expect(payload.body.temperature).toBe(0.66)
  })

  it('fails without falling back or fetching when the profile URL is missing', async () => {
    setDatabase(
      db({
        aiModel: 'mancer',
        subModel: 'mancer',
        textgenWebUIBlockingURL: '',
        mancerHeader: 'sk-profile-mancer',
      }),
    )
    switchActiveDbDuringRoute({
      aiModel: 'mancer',
      subModel: 'mancer',
      textgenWebUIBlockingURL: 'https://flat.ooba.example/api/v1/generate',
      mancerHeader: 'sk-flat-mancer',
    })

    const result = await requestChatDataMain(makeRequest({ previewBody: true }), 'model')

    expect(result).toEqual({
      type: 'fail',
      result: 'options["ooba-legacy"].baseUrl is required',
      noRetry: true,
    })
    expect(globalFetchMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('omits X-API-KEY for a blank profile key despite a flat key conflict', async () => {
    setDatabase(
      db({
        aiModel: 'mancer',
        subModel: 'mancer',
        textgenWebUIBlockingURL: 'https://profile-blank-key.ooba.example',
        mancerHeader: '',
      }),
    )
    switchActiveDbDuringRoute({
      aiModel: 'mancer',
      subModel: 'mancer',
      textgenWebUIBlockingURL: 'https://flat-blank-key.ooba.example/api/v1/generate',
      mancerHeader: 'sk-flat-mancer',
    })

    const payload = await preview()

    expect(payload.url).toBe('https://profile-blank-key.ooba.example/api/v1/generate')
    expect(payload.headers['X-API-KEY']).toBeUndefined()
  })
})

describe('requestHorde profile provider options through requestChatDataMain', () => {
  it('uses profile request model and API key over flat conflicts', async () => {
    setDatabase(
      db({
        aiModel: 'horde:::profile/model',
        subModel: 'horde:::profile/model',
        hordeConfig: { apiKey: 'sk-profile-horde', model: '', softPrompt: '' },
        maxResponse: 300,
        maxContext: 2000,
        temperature: 70,
        top_k: 55,
        top_p: 0.91,
      }),
    )
    switchActiveDbDuringRoute({
      aiModel: 'horde:::flat/model',
      subModel: 'horde:::flat/model',
      hordeConfig: { apiKey: 'sk-flat-horde', model: '', softPrompt: '' },
      maxResponse: 999,
      maxContext: 111,
      temperature: 10,
      top_k: 1,
      top_p: 0.1,
    })
    installHordeFetchMock()
    vi.useFakeTimers()

    const result = await runHordeRequest()

    expect(result.type).toBe('success')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const submitBody = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    const submitHeaders = fetchMock.mock.calls[0][1].headers as Record<string, string>
    expect(submitHeaders.apikey).toBe('sk-profile-horde')
    expect(submitBody.models).toEqual(['profile/model', 'profile/model', ' profile/model', 'profile/model '])
    expect(submitBody.models).not.toContain('flat/model')
    expect(submitBody.params.max_context_length).toBe(2100)
    expect(submitBody.params.max_length).toBe(300)
    expect(submitBody.params.temperature).toBe(0.7)
    expect(submitBody.params.top_k).toBe(55)
    expect(submitBody.params.top_p).toBe(0.91)
  })

  it('uses anonymous 0000000000 for a blank profile key despite a flat key conflict', async () => {
    setDatabase(
      db({
        aiModel: 'horde:::blank-key/model',
        subModel: 'horde:::blank-key/model',
        hordeConfig: { apiKey: '', model: '', softPrompt: '' },
      }),
    )
    switchActiveDbDuringRoute({
      aiModel: 'horde:::flat-blank-key/model',
      subModel: 'horde:::flat-blank-key/model',
      hordeConfig: { apiKey: 'sk-flat-horde', model: '', softPrompt: '' },
    })
    installHordeFetchMock()
    vi.useFakeTimers()

    const result = await runHordeRequest()

    expect(result.type).toBe('success')
    const submitHeaders = fetchMock.mock.calls[0][1].headers as Record<string, string>
    expect(submitHeaders.apikey).toBe('0000000000')
  })
})
