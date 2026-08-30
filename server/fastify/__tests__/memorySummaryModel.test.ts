import { describe, expect, it } from 'vitest'
import type { FastifyDatabase as Database } from '../src/prompt/serverTypes.js'
import { resolveMemorySummaryModel } from '../src/memorySummaryModel.js'

interface MemoryProfileFixture {
  providerId?: string
  modelId: string
  providerOptions?: Record<string, unknown>
}

function database(
  profile: MemoryProfileFixture = {
    providerId: 'openai',
    modelId: 'gpt41-mini',
    providerOptions: { credentialId: 'credential-memory', requestModel: 'gpt41-mini' },
  },
  overrides: Partial<Database> = {},
): Database {
  return {
    providerCredentials: [
      {
        id: 'credential-memory',
        name: 'Memory',
        type: 'apiKey',
        apiKey: 'sk-test',
      },
    ],
    modelProfiles: [{ id: 'profile-memory', name: 'Memory', ...profile }],
    modelRoleProfiles: { memory: { mode: 'profile', profileId: 'profile-memory' } },
    ...overrides,
  } as unknown as Database
}

describe('resolveMemorySummaryModel', () => {
  it('uses the durable memory role resolver while accepting the legacy subModel request alias', () => {
    const result = resolveMemorySummaryModel(database(), 'subModel')

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
        providerId: 'openai',
        modelId: 'gpt41-nano',
        providerOptions: { credentialId: 'credential-memory', requestModel: 'gpt41-nano' },
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
      database(
        {
          modelId: 'openrouter',
          providerOptions: {
            credentialId: 'credential-memory',
            requestModel: 'anthropic/claude-3.5-sonnet',
          },
        },
        {
          providerCredentials: [
            {
              id: 'credential-memory',
              name: 'OpenRouter',
              type: 'apiKey',
              apiKey: 'openrouter-secret',
            },
          ],
        },
      ),
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
      database(
        {
          modelId: 'openrouter',
          providerOptions: {
            credentialId: 'credential-memory',
            requestModel: 'openai/gpt-4o-mini',
          },
        },
        {
          providerCredentials: [
            {
              id: 'credential-memory',
              name: 'OpenRouter',
              type: 'apiKey',
              apiKey: 'openrouter-secret',
            },
          ],
          additionalParams: [
            ['temperature', '0.2'],
            ['header::X-Global-Trace', 'memory'],
          ],
          applyAdditionalParamsToAll: true,
        },
      ),
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
      database(
        {
          modelId: 'nanogpt',
          providerOptions: {
            credentialId: 'credential-memory',
            requestModel: 'nano/summary-model',
            nanogpt: {
              providerHint: 'provider-a',
              useSubscriptionEndpoint: true,
            },
          },
        },
        {
          providerCredentials: [
            {
              id: 'credential-memory',
              name: 'NanoGPT',
              type: 'apiKey',
              apiKey: 'nanogpt-secret',
            },
          ],
        },
      ),
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
      database(
        {
          providerId: 'anthropic',
          modelId: 'claude-3-5-sonnet-latest',
          providerOptions: { credentialId: 'credential-memory' },
        },
        {
          providerCredentials: [
            {
              id: 'credential-memory',
              name: 'Anthropic',
              type: 'apiKey',
              apiKey: 'claude-secret',
            },
          ],
        },
      ),
      'memory',
    )

    expect(result).toEqual({
      ok: false,
      error: 'summarization memory provider is not API-backed OpenAI-compatible: anthropic',
    })
  })

  it('resolves reverse_proxy summary requests from durable profile options', () => {
    const result = resolveMemorySummaryModel(
      database(
        {
          modelId: 'reverse_proxy',
          providerOptions: {
            credentialId: 'credential-memory',
            requestModel: 'proxy-summary-model',
            baseUrl: 'risu::https://proxy.example/v1',
            additionalParams: [['trace', 'enabled']],
            reverseProxy: { oobaSystemHoist: true },
          },
        },
        {
          providerCredentials: [
            {
              id: 'credential-memory',
              name: 'Reverse Proxy',
              type: 'apiKey',
              apiKey: 'proxy-secret',
            },
          ],
        },
      ),
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

  it('resolves first-class custom API summary requests from durable profile options', () => {
    const result = resolveMemorySummaryModel(
      database(
        {
          providerId: 'custom-api',
          modelId: 'custom-api',
          providerOptions: {
            credentialId: 'credential-memory',
            requestModel: 'custom-summary-model',
            baseUrl: 'https://custom.example/v1',
            additionalParams: [
              ['alpha', '1'],
              ['beta', 'two=2'],
            ],
          },
        },
        {
          providerCredentials: [
            {
              id: 'credential-memory',
              name: 'Custom API',
              type: 'apiKey',
              apiKey: 'custom-secret',
            },
          ],
        },
      ),
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
