import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearNanoGPTRequestCachesForTests,
  getNanoGPTModelCatalog,
  getNanoGPTModels,
  type NanoGPTCatalogFetchContext,
} from './nanogpt'
import {
  NANOGPT_MODELS_ENDPOINT,
  NANOGPT_PERSONALIZED_MODELS_ENDPOINT,
  NANOGPT_SUBSCRIPTION_MODELS_ENDPOINT,
} from './providers/nanogpt'

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
    ok: true,
    status: 200,
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
    clearNanoGPTRequestCachesForTests()
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

  it('shares a rapid same-key request and briefly reuses its successful result', async () => {
    let resolveResponse!: (response: Response) => void
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveResponse = resolve
      }),
    )

    const first = getNanoGPTModels({ apiKey: 'same-key' })
    const second = getNanoGPTModels({ apiKey: 'same-key' })
    await Promise.resolve()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    resolveResponse(mockJsonResponse({ data: [nanoModel()] }))
    const [firstModels, secondModels] = await Promise.all([first, second])
    const cachedModels = await getNanoGPTModels({ apiKey: 'same-key' })

    expect(firstModels).toEqual(secondModels)
    expect(cachedModels).toEqual(firstModels)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps changed API keys isolated from cached requests and results', async () => {
    fetchMock.mockImplementation(async (_url, init: RequestInit) => {
      const authorization = (init.headers as Record<string, string>).Authorization
      const suffix = authorization.endsWith('first-key') ? 'first' : 'second'
      return mockJsonResponse({ data: [{ ...nanoModel(), id: `nano/${suffix}`, name: suffix }] })
    })

    const firstModels = await getNanoGPTModels({ apiKey: 'first-key' })
    const secondModels = await getNanoGPTModels({ apiKey: 'second-key' })

    expect(firstModels[0].id).toBe('nano/first')
    expect(secondModels[0].id).toBe('nano/second')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer first-key',
    })
    expect((fetchMock.mock.calls[1][1] as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer second-key',
    })
  })

  it('does not retain failed requests', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network unavailable'))
    fetchMock.mockResolvedValueOnce(mockJsonResponse({ data: [nanoModel()] }))

    expect(await getNanoGPTModels({ apiKey: 'retry-key' })).toEqual([])
    expect(await getNanoGPTModels({ apiKey: 'retry-key' })).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not request the subscription catalog while subscription mode is disabled', async () => {
    fetchMock.mockResolvedValueOnce(mockJsonResponse({ data: [nanoModel()] }))

    await getNanoGPTModelCatalog('pay-as-you-go-key', false)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe(`${NANOGPT_PERSONALIZED_MODELS_ENDPOINT}?detailed=true`)
    expect(fetchMock).not.toHaveBeenCalledWith(
      `${NANOGPT_SUBSCRIPTION_MODELS_ENDPOINT}?detailed=true`,
      expect.anything(),
    )
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
