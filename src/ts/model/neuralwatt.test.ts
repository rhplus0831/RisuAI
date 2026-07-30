import { beforeEach, describe, expect, it, vi } from 'vitest'

const providerOperations = vi.hoisted(() => ({
  request: vi.fn(),
}))

vi.mock('../server/providerOperations', () => ({
  requestProviderOperation: providerOperations.request,
}))

import { clearNeuralwattRequestCacheForTests, getNeuralwattModels, toModelGridItem } from './neuralwatt'

function neuralwattModel(overrides: Record<string, unknown> = {}) {
  return {
    id: 'gemma-4-31b',
    object: 'model',
    owned_by: 'neuralwatt',
    max_model_len: 262_128,
    metadata: {
      display_name: 'Gemma 4 31B',
      description: 'Multimodal model',
      provider: 'NVIDIA',
      pricing: {
        input_per_million: 0.144,
        output_per_million: 0.42,
        cached_input_per_million: 0.036,
        pricing_tbd: false,
      },
      capabilities: {
        tools: true,
        json_mode: false,
        vision: true,
        reasoning: false,
        reasoning_effort: false,
        streaming: true,
        system_role: true,
        developer_role: false,
      },
      limits: {
        max_context_length: 262_128,
        max_output_tokens: 16_384,
        max_images: 4,
      },
      deprecated: false,
      deprecated_message: null,
    },
    ...overrides,
  }
}

describe('Neuralwatt model catalog', () => {
  beforeEach(() => {
    clearNeuralwattRequestCacheForTests()
    providerOperations.request.mockReset()
  })

  it('loads the fixed public catalog and maps documented metadata', async () => {
    providerOperations.request.mockResolvedValueOnce({ data: [neuralwattModel()] })

    const models = await getNeuralwattModels()

    expect(providerOperations.request).toHaveBeenCalledWith('neuralwatt.models', {
      credential: { source: 'none' },
    })
    expect(models).toEqual([
      expect.objectContaining({
        id: 'gemma-4-31b',
        name: 'Gemma 4 31B',
        provider: 'NVIDIA',
        contextLength: 262_128,
        maxOutputTokens: 16_384,
        inputPricePerMillion: 0.144,
        outputPricePerMillion: 0.42,
        cachedInputPricePerMillion: 0.036,
        capabilities: expect.objectContaining({ tools: true, vision: true, streaming: true }),
      }),
    ])
    expect(toModelGridItem(models[0])).toMatchObject({
      id: 'gemma-4-31b',
      displayName: 'Gemma 4 31B',
      providerName: 'NVIDIA',
      context_length: 262_128,
      prices: [
        { label: 'In', value: '$0.14' },
        { label: 'Out', value: '$0.42' },
      ],
    })
  })

  it('shows TBD pricing, preserves deprecation notices, and retries malformed responses', async () => {
    providerOperations.request.mockResolvedValueOnce({ data: null }).mockResolvedValueOnce({
      data: [
        neuralwattModel({
          id: 'preview-model',
          metadata: {
            display_name: 'Preview Model',
            description: 'Preview.',
            provider: 'Neuralwatt',
            pricing: { pricing_tbd: true },
            capabilities: {},
            limits: {},
            deprecated: true,
            deprecated_message: 'Use the successor.',
          },
        }),
      ],
    })

    await expect(getNeuralwattModels()).resolves.toEqual([])
    const models = await getNeuralwattModels()

    expect(models[0].description).toBe('Preview. Use the successor.')
    expect(toModelGridItem(models[0]).prices).toEqual([{ label: 'Price', value: 'TBD' }])
    expect(providerOperations.request).toHaveBeenCalledTimes(2)
  })

  it('shares successful public catalog results', async () => {
    providerOperations.request.mockResolvedValueOnce({ data: [neuralwattModel()] })

    await getNeuralwattModels()
    await getNeuralwattModels()

    expect(providerOperations.request).toHaveBeenCalledTimes(1)
  })
})
