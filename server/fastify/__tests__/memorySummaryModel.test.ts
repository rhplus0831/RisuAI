import { describe, expect, it } from 'vitest'
import { LLMFormat, LLMTokenizer } from '../../../src/ts/model/types'
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
        subModel: 'should-not-be-selected',
        modelRoles: { memory: 'gpt41-mini' } as Database['modelRoles'],
      }),
      'subModel',
    )

    expect(result).toEqual({
      ok: true,
      request: {
        provider: 'openai',
        model: 'gpt41-mini',
        options: {
          openai: {
            apiKey: 'sk-test',
          },
        },
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

  it('rejects non-memory model request aliases', () => {
    const result = resolveMemorySummaryModel(database(), 'chatMain')

    expect(result).toEqual({
      ok: false,
      error: 'server-side memory summarization currently supports only the memory/subModel API path',
    })
  })

  it('builds OpenRouter memory requests from resolved profile provider options', () => {
    const result = resolveMemorySummaryModel(
      database({
        modelRoles: { memory: 'openrouter' } as Database['modelRoles'],
        openrouterKey: 'openrouter-secret',
        openrouterRequestModel: 'anthropic/claude-3.5-sonnet',
      }),
      'memory',
    )

    expect(result).toEqual({
      ok: true,
      request: {
        provider: 'openrouter',
        model: 'anthropic/claude-3.5-sonnet',
        options: {
          openrouter: {
            apiKey: 'openrouter-secret',
          },
        },
      },
    })
  })

  it('applies opted-in flat additional parameters to an ordinary memory provider', () => {
    const result = resolveMemorySummaryModel(
      database({
        modelRoles: { memory: 'openrouter' } as Database['modelRoles'],
        openrouterKey: 'openrouter-secret',
        openrouterRequestModel: 'openai/gpt-4o-mini',
        additionalParams: [
          ['temperature', '0.2'],
          ['header::X-Global-Trace', 'memory'],
        ],
        applyAdditionalParamsToAll: true,
      }),
      'memory',
    )

    expect(result).toMatchObject({
      ok: true,
      request: {
        options: {
          openrouter: {
            additionalParams: [
              ['temperature', '0.2'],
              ['header::X-Global-Trace', 'memory'],
            ],
          },
        },
      },
    })
  })

  it('builds NanoGPT memory requests from resolved profile provider options', () => {
    const result = resolveMemorySummaryModel(
      database({
        modelRoles: { memory: 'nanogpt' } as Database['modelRoles'],
        nanogptKey: 'nanogpt-secret',
        nanogptProvider: 'provider-a',
        nanogptRequestModel: 'nano/summary-model',
        nanogptUseSubscriptionEndpoint: true,
      }),
      'memory',
    )

    expect(result).toEqual({
      ok: true,
      request: {
        provider: 'nanogpt',
        model: 'nano/summary-model',
        options: {
          nanogpt: {
            apiKey: 'nanogpt-secret',
            providerHint: 'provider-a',
            useSubscription: true,
          },
        },
      },
    })
  })

  it('rejects resolved non-OpenAI-compatible memory providers', () => {
    const result = resolveMemorySummaryModel(
      database({
        modelRoles: { memory: 'claude-3-5-sonnet-latest' } as Database['modelRoles'],
        claudeAPIKey: 'claude-secret',
      }),
      'memory',
    )

    expect(result).toEqual({
      ok: false,
      error: 'summarization memory provider is not API-backed OpenAI-compatible: anthropic',
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
            name: 'Custom Summary',
            internalId: 'custom-summary-model',
            url: 'https://custom.example/v1/chat/completions',
            key: 'custom-secret',
            format: LLMFormat.OpenAICompatible,
            tokenizer: LLMTokenizer.Unknown,
            params: 'alpha=1\nbeta=two=2\nignored',
            flags: [],
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
