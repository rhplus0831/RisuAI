import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearOpenRouterRequestCachesForTests,
  getOpenRouterModels,
  getOpenRouterProviders,
  type OpenRouterCatalogFetchContext,
} from './openrouter'

const mockDatabase = vi.hoisted(() => ({
  value: {
    openrouterKey: 'global-openrouter-key',
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

function openRouterModel(id = 'anthropic/claude-sonnet', name = 'Anthropic: Claude Sonnet') {
  return {
    id,
    name,
    context_length: 200000,
    description: 'Fast model',
    pricing: {
      prompt: '0.000001',
      completion: '0.000002',
      input_cache_read: '0.0000001',
      input_cache_write: '',
      internal_reasoning: null,
    },
  }
}

describe('getOpenRouterModels', () => {
  beforeEach(() => {
    mockDatabase.value = { openrouterKey: 'global-openrouter-key' }
    clearOpenRouterRequestCachesForTests()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses the global OpenRouter key when no catalog context is provided', async () => {
    fetchMock.mockResolvedValueOnce(mockJsonResponse({ data: [] }))

    await getOpenRouterModels()

    expect(fetchMock).toHaveBeenCalledWith('https://openrouter.ai/api/v1/models', {
      headers: {
        Authorization: 'Bearer global-openrouter-key',
        'Content-Type': 'application/json',
      },
    })
  })

  it('uses an explicit catalog key instead of the saved global key', async () => {
    fetchMock.mockResolvedValueOnce(
      mockJsonResponse({
        data: [openRouterModel()],
      }),
    )

    const models = await getOpenRouterModels({ apiKey: 'draft-openrouter-key' })

    expect(firstFetchInit().headers.Authorization).toBe('Bearer draft-openrouter-key')
    expect(models[0]).toMatchObject({
      id: 'anthropic/claude-sonnet',
      name: 'Anthropic: Claude Sonnet - $0.00125/1k',
      cleanName: 'Claude Sonnet',
      provider: 'Anthropic',
      priceDisplay: '$0.00125/1k',
      context_length: 200000,
      description: 'Fast model',
      promptPrice1M: 1,
      completionPrice1M: 2,
      cacheWritePrice1M: undefined,
      internalReasoningPrice1M: undefined,
    })
    expect(models[0].price).toBeCloseTo(0.00000125)
    expect(models[0].cacheReadPrice1M).toBeCloseTo(0.1)
  })

  it('shares rapid same-key requests and supports an explicit refresh', async () => {
    let resolveResponse!: (response: Response) => void
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveResponse = resolve
      }),
    )

    const first = getOpenRouterModels({ apiKey: 'same-key' })
    const second = getOpenRouterModels({ apiKey: 'same-key' })
    await Promise.resolve()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    resolveResponse(mockJsonResponse({ data: [openRouterModel()] }))
    await Promise.all([first, second])
    await getOpenRouterModels({ apiKey: 'same-key' })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    fetchMock.mockResolvedValueOnce(mockJsonResponse({ data: [] }))
    await getOpenRouterModels({ apiKey: 'same-key', refresh: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not share cached results across changed API keys', async () => {
    fetchMock.mockImplementation(async (_url, init: RequestInit) => {
      const authorization = (init.headers as Record<string, string>).Authorization
      const suffix = authorization.endsWith('first-key') ? 'first' : 'second'
      return mockJsonResponse({ data: [openRouterModel(`provider/${suffix}`, `Provider: ${suffix}`)] })
    })

    const firstModels = await getOpenRouterModels({ apiKey: 'first-key' })
    const secondModels = await getOpenRouterModels({ apiKey: 'second-key' })

    expect(firstModels[0].id).toBe('provider/first')
    expect(secondModels[0].id).toBe('provider/second')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer first-key',
    })
    expect((fetchMock.mock.calls[1][1] as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer second-key',
    })
  })

  it('does not cache failures', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network unavailable'))
    fetchMock.mockResolvedValueOnce(mockJsonResponse({ data: [openRouterModel()] }))

    expect(await getOpenRouterModels({ apiKey: 'retry-key' })).toEqual([])
    expect(await getOpenRouterModels({ apiKey: 'retry-key' })).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('getOpenRouterProviders', () => {
  beforeEach(() => {
    mockDatabase.value = { openrouterKey: 'global-openrouter-key' }
    clearOpenRouterRequestCachesForTests()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each<[string, OpenRouterCatalogFetchContext]>([
    ['blank', { apiKey: '' }],
    ['undefined', { apiKey: undefined }],
    ['missing', {}],
  ])(
    'treats an explicit %s catalog context as intentional instead of falling back to global',
    async (_label, context) => {
      fetchMock.mockResolvedValueOnce(
        mockJsonResponse({
          data: [
            { name: 'Zed', slug: 'zed' },
            { name: 'Alpha', slug: 'alpha' },
          ],
        }),
      )

      const providers = await getOpenRouterProviders(context)

      expect(fetchMock).toHaveBeenCalledWith('https://openrouter.ai/api/v1/providers', {
        headers: {
          Authorization: 'Bearer ',
          'Content-Type': 'application/json',
        },
      })
      expect(providers).toEqual([
        { name: 'Alpha', slug: 'alpha' },
        { name: 'Zed', slug: 'zed' },
      ])
    },
  )
})
