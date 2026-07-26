import { beforeEach, describe, expect, it, vi } from 'vitest'

const providerOperations = vi.hoisted(() => ({
  request: vi.fn(),
}))

vi.mock('../server/providerOperations', () => ({
  requestProviderOperation: providerOperations.request,
}))

import { clearLLMGatewayRequestCacheForTests, getLLMGatewayModels, toModelGridItem } from './llmgateway'

function gatewayModel(overrides: Record<string, unknown> = {}) {
  return {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    family: 'openai',
    description: 'Fast text model',
    context_length: 128_000,
    architecture: {
      input_modalities: ['text', 'image'],
      output_modalities: ['text'],
    },
    pricing: {
      prompt: '0.15e-6',
      completion: '0.6e-6',
    },
    ...overrides,
  }
}

describe('LLM Gateway model catalog', () => {
  beforeEach(() => {
    clearLLMGatewayRequestCacheForTests()
    providerOperations.request.mockReset()
  })

  it('loads the fixed public catalog, maps pricing, and filters non-text output models', async () => {
    providerOperations.request.mockResolvedValueOnce({
      data: [gatewayModel(), gatewayModel({ id: 'image-model', architecture: { output_modalities: ['image'] } })],
    })

    const models = await getLLMGatewayModels()

    expect(providerOperations.request).toHaveBeenCalledWith('llmgateway.models', {
      credential: { source: 'none' },
    })
    expect(models).toEqual([
      expect.objectContaining({
        id: 'gpt-4o-mini',
        name: 'GPT-4o Mini',
        family: 'openai',
        context_length: 128_000,
        promptPrice1M: 0.15,
        completionPrice1M: 0.6,
      }),
    ])
    expect(toModelGridItem(models[0])).toMatchObject({
      id: 'gpt-4o-mini',
      displayName: 'GPT-4o Mini',
      providerName: 'openai',
      prices: [
        { label: 'In', value: '$0.15' },
        { label: 'Out', value: '$0.60' },
      ],
    })
  })

  it('shares successful public catalog results but retries malformed responses', async () => {
    providerOperations.request.mockResolvedValueOnce({ data: [gatewayModel()] })

    await getLLMGatewayModels()
    await getLLMGatewayModels()
    expect(providerOperations.request).toHaveBeenCalledTimes(1)

    clearLLMGatewayRequestCacheForTests()
    providerOperations.request.mockResolvedValueOnce({ data: null }).mockResolvedValueOnce({ data: [gatewayModel()] })
    await expect(getLLMGatewayModels()).resolves.toEqual([])
    await expect(getLLMGatewayModels()).resolves.toHaveLength(1)
    expect(providerOperations.request).toHaveBeenCalledTimes(3)
  })
})
