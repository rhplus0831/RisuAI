import { beforeEach, describe, expect, it, vi } from 'vitest'

const providerOperations = vi.hoisted(() => ({
  credential: vi.fn((apiKey: string | null | undefined, options?: { profileId?: string | null }) => {
    if (apiKey === '__RISU_SECRET_MASKED__') {
      return options?.profileId ? { source: 'model-profile', profileId: options.profileId } : { source: 'stored' }
    }
    return apiKey ? { source: 'provided', apiKey } : { source: 'none' }
  }),
  request: vi.fn(),
}))

vi.mock('../server/providerOperations', () => ({
  providerOperationCredential: providerOperations.credential,
  requestProviderOperation: providerOperations.request,
}))

import {
  clearOpenRouterRequestCachesForTests,
  getFreeOpenRouterModels,
  getOpenRouterModels,
  getOpenRouterProviders,
  type OpenRouterCatalogFetchContext,
} from './openrouter'

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

describe('OpenRouter provider operations', () => {
  beforeEach(() => {
    clearOpenRouterRequestCachesForTests()
    providerOperations.credential.mockClear()
    providerOperations.request.mockReset()
  })

  it('uses an explicit OpenRouter catalog credential', async () => {
    providerOperations.request.mockResolvedValueOnce({ data: [] })

    await getOpenRouterModels({ apiKey: 'global-openrouter-key' })

    expect(providerOperations.credential).toHaveBeenCalledWith('global-openrouter-key', { profileId: undefined })
    expect(providerOperations.request).toHaveBeenCalledWith('openrouter.models', {
      credential: expect.objectContaining({ apiKey: 'global-openrouter-key' }),
    })
  })

  it('uses an explicit catalog credential and maps model pricing', async () => {
    providerOperations.request.mockResolvedValueOnce({ data: [openRouterModel()] })

    const models = await getOpenRouterModels({ apiKey: 'draft-openrouter-key' })

    expect(providerOperations.request).toHaveBeenCalledWith('openrouter.models', {
      credential: expect.objectContaining({ apiKey: 'draft-openrouter-key' }),
    })
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

  it('routes a masked model-profile credential with its profile id', async () => {
    providerOperations.request.mockResolvedValue({ data: [] })

    await getOpenRouterModels({ apiKey: '__RISU_SECRET_MASKED__', profileId: 'profile-a' })
    await getOpenRouterModels({ apiKey: '__RISU_SECRET_MASKED__', profileId: 'profile-a' })

    expect(providerOperations.credential).toHaveBeenCalledWith('__RISU_SECRET_MASKED__', { profileId: 'profile-a' })
    expect(providerOperations.request).toHaveBeenCalledTimes(2)
  })

  it('shares rapid same-context requests and supports an explicit refresh', async () => {
    let resolveResponse!: (response: { data: unknown[] }) => void
    providerOperations.request.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveResponse = resolve
      }),
    )

    const first = getOpenRouterModels({ apiKey: 'same-key', profileId: 'same-profile' })
    const second = getOpenRouterModels({ apiKey: 'same-key', profileId: 'same-profile' })
    await Promise.resolve()

    expect(providerOperations.request).toHaveBeenCalledTimes(1)
    resolveResponse({ data: [openRouterModel()] })
    await Promise.all([first, second])
    await getOpenRouterModels({ apiKey: 'same-key', profileId: 'same-profile' })
    expect(providerOperations.request).toHaveBeenCalledTimes(1)

    providerOperations.request.mockResolvedValueOnce({ data: [] })
    await getOpenRouterModels({ apiKey: 'same-key', profileId: 'same-profile', refresh: true })
    expect(providerOperations.request).toHaveBeenCalledTimes(2)
  })

  it('does not share cached results across changed API keys', async () => {
    providerOperations.request.mockImplementation(async (_operation, options) => {
      const key = options.credential.apiKey as string
      const suffix = key.endsWith('first-key') ? 'first' : 'second'
      return { data: [openRouterModel(`provider/${suffix}`, `Provider: ${suffix}`)] }
    })

    const firstModels = await getOpenRouterModels({ apiKey: 'first-key' })
    const secondModels = await getOpenRouterModels({ apiKey: 'second-key' })

    expect(firstModels[0].id).toBe('provider/first')
    expect(secondModels[0].id).toBe('provider/second')
    expect(providerOperations.request).toHaveBeenCalledTimes(2)
  })

  it('does not cache failures and returns an empty id for an empty free catalog', async () => {
    providerOperations.request.mockRejectedValueOnce(new Error('network unavailable'))
    providerOperations.request.mockResolvedValueOnce({ data: [openRouterModel()] })

    expect(await getOpenRouterModels({ apiKey: 'retry-key' })).toEqual([])
    expect(await getOpenRouterModels({ apiKey: 'retry-key' })).toHaveLength(1)
    expect(providerOperations.request).toHaveBeenCalledTimes(2)

    providerOperations.request.mockResolvedValueOnce({ data: [] })
    await expect(getFreeOpenRouterModels({ apiKey: 'empty-catalog-key' })).resolves.toBe('')
  })

  it.each<[string, OpenRouterCatalogFetchContext]>([
    ['blank', { apiKey: '' }],
    ['undefined', { apiKey: undefined }],
    ['missing', {}],
  ])('treats an explicit %s catalog context as intentional public access', async (_label, context) => {
    providerOperations.request.mockResolvedValueOnce({
      data: [
        { name: 'Zed', slug: 'zed' },
        { name: 'Alpha', slug: 'alpha' },
      ],
    })

    const providers = await getOpenRouterProviders(context)

    expect(providerOperations.credential).toHaveBeenCalledWith('', { profileId: undefined })
    expect(providerOperations.request).toHaveBeenCalledWith('openrouter.providers', {
      credential: expect.objectContaining({ source: 'none' }),
    })
    expect(providers).toEqual([
      { name: 'Alpha', slug: 'alpha' },
      { name: 'Zed', slug: 'zed' },
    ])
  })
})
