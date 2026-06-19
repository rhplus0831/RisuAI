import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getNanoGPTModels, type NanoGPTCatalogFetchContext } from './nanogpt'
import { NANOGPT_MODELS_ENDPOINT, NANOGPT_PERSONALIZED_MODELS_ENDPOINT } from './providers/nanogpt'

const mockDatabase = vi.hoisted(() => ({
  value: {
    nanogptKey: 'global-nanogpt-key',
  },
}))

vi.mock('../storage/database.svelte', () => ({
  getDatabase: () => mockDatabase.value,
}))

const fetchMock = vi.fn()

function mockJsonResponse(body: unknown): Response {
  return {
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response
}

function firstFetchInit(): { headers: Record<string, string> } {
  return fetchMock.mock.calls[0][1] as { headers: Record<string, string> }
}

function nanoModel() {
  return {
    id: 'nano/model',
    name: 'Nano Model',
    owned_by: 'nano',
    context_length: 128000,
    max_output_tokens: 4096,
    description: 'Nano model description',
    capabilities: { vision: true },
    pricing: {
      prompt: '0.25',
      completion: '1.5',
    },
  }
}

describe('getNanoGPTModels', () => {
  beforeEach(() => {
    mockDatabase.value = { nanogptKey: 'global-nanogpt-key' }
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses the global NanoGPT key when no catalog context is provided', async () => {
    fetchMock.mockResolvedValueOnce(mockJsonResponse({ data: [nanoModel()] }))

    const models = await getNanoGPTModels()

    expect(fetchMock).toHaveBeenCalledWith(`${NANOGPT_PERSONALIZED_MODELS_ENDPOINT}?detailed=true`, {
      headers: {
        Authorization: 'Bearer global-nanogpt-key',
        'Content-Type': 'application/json',
      },
    })
    expect(models).toEqual([
      {
        id: 'nano/model',
        name: 'Nano Model',
        owned_by: 'nano',
        context_length: 128000,
        max_output_tokens: 4096,
        description: 'Nano model description',
        capabilities: { vision: true },
        promptPrice1M: 0.25,
        completionPrice1M: 1.5,
      },
    ])
  })

  it('uses an explicit catalog key instead of the saved global key', async () => {
    fetchMock.mockResolvedValueOnce(mockJsonResponse({ data: [] }))

    await getNanoGPTModels({ apiKey: 'draft-nanogpt-key' })

    expect(fetchMock).toHaveBeenCalledWith(`${NANOGPT_PERSONALIZED_MODELS_ENDPOINT}?detailed=true`, {
      headers: {
        Authorization: 'Bearer draft-nanogpt-key',
        'Content-Type': 'application/json',
      },
    })
  })

  it.each<[string, NanoGPTCatalogFetchContext]>([
    ['blank', { apiKey: '' }],
    ['undefined', { apiKey: undefined }],
    ['missing', {}],
  ])('treats an explicit %s catalog context as intentional public catalog access', async (_label, context) => {
    fetchMock.mockResolvedValueOnce(mockJsonResponse({ data: [] }))

    await getNanoGPTModels(context)

    expect(fetchMock.mock.calls[0][0]).toBe(`${NANOGPT_MODELS_ENDPOINT}?detailed=true`)
    expect(firstFetchInit().headers).toEqual({ 'Content-Type': 'application/json' })
  })
})
