import { describe, expect, it } from 'vitest'
import {
  SERVER_IMAGE_GENERATION_PROVIDERS,
  isImageGenerationRequest,
  isServerImageGenerationProvider,
} from '@risuai/protocol/image-generation-operation'

describe('image-generation operation protocol', () => {
  it('publishes and validates the complete provider taxonomy', () => {
    expect(SERVER_IMAGE_GENERATION_PROVIDERS).toEqual([
      'novelai',
      'dalle',
      'stability',
      'fal',
      'imagen',
      'openai-compat',
      'wavespeed',
      'kei',
    ])
    for (const provider of SERVER_IMAGE_GENERATION_PROVIDERS) {
      expect(isServerImageGenerationProvider(provider)).toBe(true)
    }
    expect(isServerImageGenerationProvider('automatic1111')).toBe(false)
  })

  it.each([
    {
      provider: 'novelai',
      credential: { source: 'stored' },
      payload: { input: 'forest', parameters: { width: 1024 } },
    },
    { provider: 'dalle', credential: { source: 'provided', apiKey: 'draft' }, prompt: 'forest', quality: 'hd' },
    {
      provider: 'stability',
      credential: { source: 'stored' },
      prompt: 'forest',
      negativePrompt: '',
      model: 'core',
      style: 'anime',
    },
    {
      provider: 'fal',
      credential: { source: 'stored' },
      prompt: 'forest',
      model: 'fal-ai/flux-lora',
      width: 1024,
      height: 1024,
      lora: { path: 'owner/lora', scale: 1 },
    },
    {
      provider: 'imagen',
      credential: { source: 'stored' },
      prompt: 'forest',
      model: 'imagen-4.0-generate-001',
      imageSize: '2K',
      aspectRatio: '16:9',
      personGeneration: 'allow_adult',
    },
    { provider: 'openai-compat', credential: { source: 'none' }, prompt: 'forest' },
    {
      provider: 'wavespeed',
      credential: { source: 'stored' },
      prompt: 'forest',
      model: 'owner/model',
      images: ['base64'],
      loras: [{ path: 'owner/lora', scale: 1 }],
    },
    { provider: 'kei', credential: { source: 'stored' }, prompt: 'forest' },
  ] as const)('accepts the $provider request envelope', (request) => {
    expect(isImageGenerationRequest(request)).toBe(true)
  })

  it('rejects provider-field cross-pairings and unknown request fields', () => {
    expect(
      isImageGenerationRequest({
        provider: 'dalle',
        credential: { source: 'stored' },
        prompt: 'forest',
        model: 'core',
        quality: 'hd',
      }),
    ).toBe(false)
    expect(
      isImageGenerationRequest({
        provider: 'kei',
        credential: { source: 'stored' },
        prompt: 'forest',
        url: 'https://attacker.example',
      }),
    ).toBe(false)
  })

  it('rejects malformed credentials and nested LoRA/image shapes', () => {
    expect(
      isImageGenerationRequest({
        provider: 'kei',
        credential: { source: 'stored', apiKey: 'unexpected' },
        prompt: 'forest',
      }),
    ).toBe(false)
    expect(
      isImageGenerationRequest({
        provider: 'fal',
        credential: { source: 'stored' },
        prompt: 'forest',
        model: 'fal-ai/flux-lora',
        width: 1024,
        height: 1024,
        lora: { path: 'owner/lora', scale: 1, url: 'https://attacker.example' },
      }),
    ).toBe(false)
    expect(
      isImageGenerationRequest({
        provider: 'wavespeed',
        credential: { source: 'stored' },
        prompt: 'forest',
        model: 'owner/model',
        images: [1],
      }),
    ).toBe(false)
  })

  it('keeps the NovelAI payload structurally opaque while requiring an object', () => {
    expect(
      isImageGenerationRequest({
        provider: 'novelai',
        credential: { source: 'stored' },
        payload: { future: { nested: ['shape'] } },
      }),
    ).toBe(true)
    expect(
      isImageGenerationRequest({ provider: 'novelai', credential: { source: 'stored' }, payload: ['not-an-object'] }),
    ).toBe(false)
  })
})
