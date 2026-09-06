import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const globalFetchMock = vi.hoisted(() => vi.fn())
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

import { setDatabase, type Database } from '../../../storage/database.svelte'
import { selectedCharID } from '../../../stores.svelte'
import { requestChatDataMain } from '../request'
import { getDatabase } from 'src/ts/__tests__/resourceDatabaseState'

interface PreviewPayload {
  url: string
  body: Record<string, any>
  headers: Record<string, string>
}

function db(overrides: Partial<Database> = {}): Database {
  return {
    aiModel: 'kobold',
    subModel: 'kobold',
    characters: [{ name: 'Kobold Character', chats: [], chatPage: 0 }],
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
    koboldURL: 'https://profile.kobold.example',
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
    // Kobold remains a named static compatibility format in this wire-level suite.
    staticModel: getDatabase().aiModel,
    formated: [{ role: 'user' as const, content: 'hello kobold' }],
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
  globalFetchMock.mockReset()
  resolveServerCompletionRouteMock.mockReset()
  resolveServerCompletionRouteMock.mockReturnValue({ type: 'local' })
})

afterEach(() => {
  selectedCharID.set(-1)
  vi.unstubAllGlobals()
})

describe('requestKobold profile provider options through requestChatDataMain', () => {
  it('uses profile koboldURL over conflicting flat db.koboldURL', async () => {
    setDatabase(db({ koboldURL: 'https://profile.kobold.example' }))
    switchActiveDbDuringRoute({
      koboldURL: 'https://flat.kobold.example',
    })

    const payload = await preview()

    expect(payload.url).toBe('https://profile.kobold.example/api/v1/generate')
    expect(payload.url).not.toContain('flat.kobold.example')
    expect(payload.body.max_length).toBe(96)
  })

  it('uses profile maxContext over conflicting flat db.maxContext', async () => {
    setDatabase(
      db({
        koboldURL: 'https://profile-context.kobold.example',
        maxContext: 12345,
      }),
    )
    switchActiveDbDuringRoute({
      koboldURL: 'https://flat-context.kobold.example',
      maxContext: 999,
    })

    const payload = await preview()

    expect(payload.url).toBe('https://profile-context.kobold.example/api/v1/generate')
    expect(payload.body.max_context_length).toBe(12345)
  })

  it('fails without falling back to flat db.koboldURL when profile baseUrl is missing', async () => {
    setDatabase(
      db({
        koboldURL: '',
      }),
    )
    switchActiveDbDuringRoute({
      koboldURL: 'https://flat-required.kobold.example',
    })

    const result = await requestChatDataMain(makeRequest(), 'model')

    expect(result).toEqual({
      type: 'fail',
      result: 'options.kobold.baseUrl is required',
      noRetry: true,
    })
    expect(globalFetchMock).not.toHaveBeenCalled()
  })
})
