import { describe, expect, it } from 'vitest'
import { LLMFormat } from '../../../src/ts/model/types'
import type { Database } from '../../../src/ts/storage/database.svelte'
import { resolveMemorySummaryModel } from '../src/memorySummaryModel.js'

function database(overrides: Partial<Database> = {}): Database {
  return {
    aiModel: 'gpt4o',
    subModel: 'gpt4om',
    openAIKey: 'sk-test',
    modelRoles: {},
    seperateModelsForAxModels: false,
    seperateModels: {},
    ...overrides,
  } as unknown as Database
}

describe('resolveMemorySummaryModel', () => {
  it('uses the memory role resolver while accepting legacy subModel requests', () => {
    const result = resolveMemorySummaryModel(
      database({
        modelRoles: { memory: 'gpt41-mini' } as Database['modelRoles'],
      }),
      'subModel',
    )

    expect(result).toMatchObject({
      ok: true,
      request: {
        provider: 'openai',
        model: 'gpt41-mini',
      },
    })
  })

  it('accepts the canonical memory request role', () => {
    const result = resolveMemorySummaryModel(
      database({
        seperateModelsForAxModels: true,
        seperateModels: { memory: 'gpt41-nano' } as Database['seperateModels'],
      }),
      'memory',
    )

    expect(result).toMatchObject({
      ok: true,
      request: {
        provider: 'openai',
        model: 'gpt41-nano',
      },
    })
  })

  it('resolves reverse_proxy summary requests with current global proxy options', () => {
    const result = resolveMemorySummaryModel(
      database({
        modelRoles: { memory: 'reverse_proxy' } as Database['modelRoles'],
        customAPIFormat: LLMFormat.OpenAICompatible,
        customProxyRequestModel: 'proxy-summary-model',
        forceReplaceUrl: 'risu::https://proxy.example/v1',
        proxyKey: 'proxy-secret',
        additionalParams: [['trace', 'enabled']],
        reverseProxyOobaMode: true,
      }),
      'memory',
    )

    expect(result).toEqual({
      ok: true,
      request: {
        provider: 'openai',
        model: 'proxy-summary-model',
        options: {
          openai: {
            apiKey: 'proxy-secret',
            baseUrl: 'https://proxy.example/v1',
            extraHeaders: { 'X-Proxy-Risu': 'RisuAI' },
            additionalParams: [['trace', 'enabled']],
            oobaSystemHoist: true,
          },
        },
      },
    })
  })

  it('resolves xcustom summary requests from the custom model catalog', () => {
    const result = resolveMemorySummaryModel(
      database({
        modelRoles: { memory: 'xcustom:::summary' } as Database['modelRoles'],
        customModels: [
          {
            id: 'xcustom:::summary',
            internalId: 'custom-summary-model',
            url: 'https://custom.example/v1/chat/completions',
            key: 'custom-secret',
            format: LLMFormat.OpenAICompatible,
            params: 'alpha=1\nbeta=two=2\nignored',
          },
        ],
      }),
      'memory',
    )

    expect(result).toEqual({
      ok: true,
      request: {
        provider: 'openai',
        model: 'custom-summary-model',
        options: {
          openai: {
            apiKey: 'custom-secret',
            baseUrl: 'https://custom.example/v1',
            additionalParams: [
              ['alpha', '1'],
              ['beta', 'two=2'],
            ],
          },
        },
      },
    })
  })
})
