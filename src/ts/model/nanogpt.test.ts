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
  clearNanoGPTRequestCachesForTests,
  getNanoGPTBalance,
  getNanoGPTModelCatalog,
  getNanoGPTModelProviders,
  getNanoGPTModels,
  getNanoGPTSubscription,
  type NanoGPTCatalogFetchContext,
} from './nanogpt'

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

describe('NanoGPT provider operations', () => {
  beforeEach(() => {
    clearNanoGPTRequestCachesForTests()
    providerOperations.credential.mockClear()
    providerOperations.request.mockReset()
  })

  it('uses an explicit NanoGPT catalog credential and maps catalog models', async () => {
    providerOperations.request.mockResolvedValueOnce({ data: [nanoModel()] })

    const models = await getNanoGPTModels({ apiKey: 'global-nanogpt-key' })

    expect(providerOperations.credential).toHaveBeenCalledWith('global-nanogpt-key', { profileId: undefined })
    expect(providerOperations.request).toHaveBeenCalledWith('nanogpt.models', {
      credential: expect.objectContaining({ apiKey: 'global-nanogpt-key' }),
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

  it('uses an explicit model-profile context instead of the saved global key', async () => {
    providerOperations.request.mockResolvedValue({ data: [] })

    await getNanoGPTModels({ apiKey: '__RISU_SECRET_MASKED__', profileId: 'profile-a' })
    await getNanoGPTModels({ apiKey: '__RISU_SECRET_MASKED__', profileId: 'profile-a' })

    expect(providerOperations.credential).toHaveBeenCalledWith('__RISU_SECRET_MASKED__', { profileId: 'profile-a' })
    expect(providerOperations.request).toHaveBeenCalledTimes(2)
  })

  it('shares a rapid same-context request and briefly reuses its successful result', async () => {
    let resolveResponse!: (response: { data: unknown[] }) => void
    providerOperations.request.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveResponse = resolve
      }),
    )

    const first = getNanoGPTModels({ apiKey: 'same-key', profileId: 'same-profile' })
    const second = getNanoGPTModels({ apiKey: 'same-key', profileId: 'same-profile' })
    await Promise.resolve()

    expect(providerOperations.request).toHaveBeenCalledTimes(1)
    resolveResponse({ data: [nanoModel()] })
    const [firstModels, secondModels] = await Promise.all([first, second])
    const cachedModels = await getNanoGPTModels({ apiKey: 'same-key', profileId: 'same-profile' })

    expect(firstModels).toEqual(secondModels)
    expect(cachedModels).toEqual(firstModels)
    expect(providerOperations.request).toHaveBeenCalledTimes(1)
  })

  it('keeps changed API keys isolated from cached requests and results', async () => {
    providerOperations.request.mockImplementation(async (_operation, options) => {
      const key = options.credential.apiKey as string
      const suffix = key.endsWith('first-key') ? 'first' : 'second'
      return { data: [{ ...nanoModel(), id: `nano/${suffix}`, name: suffix }] }
    })

    const firstModels = await getNanoGPTModels({ apiKey: 'first-key' })
    const secondModels = await getNanoGPTModels({ apiKey: 'second-key' })

    expect(firstModels[0].id).toBe('nano/first')
    expect(secondModels[0].id).toBe('nano/second')
    expect(providerOperations.request).toHaveBeenCalledTimes(2)
  })

  it('does not retain failed requests', async () => {
    providerOperations.request.mockRejectedValueOnce(new Error('network unavailable'))
    providerOperations.request.mockResolvedValueOnce({ data: [nanoModel()] })

    expect(await getNanoGPTModels({ apiKey: 'retry-key' })).toEqual([])
    expect(await getNanoGPTModels({ apiKey: 'retry-key' })).toHaveLength(1)
    expect(providerOperations.request).toHaveBeenCalledTimes(2)
  })

  it('uses the pay-as-you-go operation while subscription mode is disabled', async () => {
    providerOperations.request.mockResolvedValueOnce({ data: [nanoModel()] })

    await getNanoGPTModelCatalog('pay-as-you-go-key', false)

    expect(providerOperations.request).toHaveBeenCalledOnce()
    expect(providerOperations.request).toHaveBeenCalledWith('nanogpt.models', expect.anything())
  })

  it.each<[string, NanoGPTCatalogFetchContext]>([
    ['blank', { apiKey: '' }],
    ['undefined', { apiKey: undefined }],
    ['missing', {}],
  ])('treats an explicit %s context as intentional public catalog access', async (_label, context) => {
    providerOperations.request.mockResolvedValueOnce({ data: [] })

    await getNanoGPTModels(context)

    expect(providerOperations.credential).toHaveBeenCalledWith('', { profileId: undefined })
    expect(providerOperations.request).toHaveBeenCalledWith('nanogpt.models', {
      credential: expect.objectContaining({ source: 'none' }),
    })
  })

  it('routes account and provider-detail requests through their fixed operations', async () => {
    providerOperations.request
      .mockResolvedValueOnce({ usd_balance: '1', nano_balance: '2', nanoDepositAddress: 'nano-address' })
      .mockResolvedValueOnce({ active: true, state: 'active' })
      .mockResolvedValueOnce({ providers: [], canonicalId: 'model-a' })

    await expect(getNanoGPTBalance('account-key')).resolves.toMatchObject({ usd_balance: '1' })
    await expect(getNanoGPTSubscription('account-key')).resolves.toMatchObject({ state: 'active' })
    await expect(getNanoGPTModelProviders('account-key', 'owner/model')).resolves.toMatchObject({
      canonicalId: 'model-a',
    })

    expect(providerOperations.request.mock.calls.map(([operation]) => operation)).toEqual([
      'nanogpt.balance',
      'nanogpt.subscription',
      'nanogpt.model-providers',
    ])
    expect(providerOperations.request).toHaveBeenLastCalledWith('nanogpt.model-providers', {
      credential: expect.objectContaining({ apiKey: 'account-key' }),
      input: { modelId: 'owner/model' },
    })
  })
})
