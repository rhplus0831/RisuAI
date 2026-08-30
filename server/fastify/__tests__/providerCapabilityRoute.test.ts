import { describe, expect, it } from 'vitest'
import { LLMFormat } from '@risuai/shared-core/model-types'
import type { FastifyDatabase as Database } from '../src/prompt/serverTypes.js'
import { resolveModelProfile } from '../../../src/ts/model/modelProfileResolver'
import { resolveChatProviderRoute } from '../src/prompt/chatDispatch.js'

// Proves the server /chat dispatcher wires the shared capability table
// consistently with the browser completion path; the unknown-id guard stays
// server-only, and the reverse_proxy + ooba case dispatches instead of hard-failing.

function db(overrides: Partial<Database> = {}): Database {
  return { aiModel: 'echo_model', ...overrides } as unknown as Database
}

interface DurableRouteFixture {
  profile: {
    providerId?: string
    modelId: string
    providerOptions?: Record<string, unknown>
  }
  credential?: {
    id: string
    name: string
    type: 'apiKey'
    apiKey: string
  }
}

function durableDatabase({ profile, credential }: DurableRouteFixture): Database {
  return db({
    providerCredentials: credential ? [credential] : [],
    modelProfiles: [{ id: 'profile-chat', name: 'Chat', ...profile }],
    modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'profile-chat' } },
  })
}

function resolveDurableRoute(fixture: DurableRouteFixture) {
  const database = durableDatabase(fixture)
  return resolveChatProviderRoute(database, resolveModelProfile({ database }))
}

function resolveStaticCompatibilityRoute(aiModel: string, overrides: Partial<Database> = {}) {
  const database = db({ aiModel, ...overrides })
  return resolveChatProviderRoute(database, resolveModelProfile({ database, staticModel: aiModel }))
}

describe('resolveChatProviderRoute — routable', () => {
  it('routes echo and anthropic', () => {
    expect(
      resolveDurableRoute({
        profile: { providerId: 'debug-echo', modelId: 'debug-echo' },
      }),
    ).toEqual({
      routable: true,
      provider: 'echo',
    })
    expect(
      resolveDurableRoute({
        profile: {
          providerId: 'anthropic',
          modelId: 'claude-3-5-sonnet-20241022',
          providerOptions: { credentialId: 'credential-anthropic' },
        },
        credential: {
          id: 'credential-anthropic',
          name: 'Anthropic',
          type: 'apiKey',
          apiKey: 'sk-anthropic',
        },
      }),
    ).toEqual({
      routable: true,
      provider: 'anthropic',
    })
  })

  it.each(['gpt-5.5', 'gpt-5.5-2026-04-23'])('routes the registered OpenAI model %s', (aiModel) => {
    expect(
      resolveDurableRoute({
        profile: {
          providerId: 'openai',
          modelId: aiModel,
          providerOptions: { credentialId: 'credential-openai' },
        },
        credential: {
          id: 'credential-openai',
          name: 'OpenAI',
          type: 'apiKey',
          apiKey: 'sk-openai',
        },
      }),
    ).toEqual({ routable: true, provider: 'openai' })
  })

  it('routes Claude Opus 4.8 through the Anthropic adapter', () => {
    expect(
      resolveDurableRoute({
        profile: {
          providerId: 'anthropic',
          modelId: 'claude-opus-4-8',
          providerOptions: { credentialId: 'credential-anthropic' },
        },
        credential: {
          id: 'credential-anthropic',
          name: 'Anthropic',
          type: 'apiKey',
          apiKey: 'sk-anthropic',
        },
      }),
    ).toEqual({ routable: true, provider: 'anthropic' })
  })

  it.each(['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite'])(
    'routes the registered Google model %s through the Gemini adapter',
    (aiModel) => {
      const database = durableDatabase({
        profile: {
          providerId: 'google',
          modelId: aiModel,
          providerOptions: { credentialId: 'credential-google' },
        },
        credential: {
          id: 'credential-google',
          name: 'Google AI Studio',
          type: 'apiKey',
          apiKey: 'studio-key',
        },
      })
      const profile = resolveModelProfile({ database })
      expect(profile.modelInfo.parameters).toContain('reasoning_effort')
      expect(resolveChatProviderRoute(database, profile)).toEqual({ routable: true, provider: 'gemini' })
    },
  )

  it('routes a configured durable Custom API profile under OpenAICompatible', () => {
    expect(
      resolveDurableRoute({
        profile: {
          providerId: 'custom-api',
          modelId: 'custom-api',
          providerOptions: {
            credentialId: 'credential-proxy',
            requestModel: 'proxy-model',
            baseUrl: 'https://proxy.example.com/v1',
          },
        },
        credential: {
          id: 'credential-proxy',
          name: 'Custom API',
          type: 'apiKey',
          apiKey: 'sk-proxy',
        },
      }),
    ).toEqual({ routable: true, provider: 'openai' })
  })

  it('routes the static reverse_proxy + reverseProxyOobaMode compatibility seam to openai', () => {
    // Previously this hard-failed with "Ooba OpenAI-compatible reverse proxy must
    // use local dispatch". The shared table no longer gates on the ooba flag and
    // the openai adapter applies oobaSystemHoist itself, so it now dispatches —
    // matching the browser completion path.
    expect(
      resolveStaticCompatibilityRoute('reverse_proxy', {
        customProxyRequestModel: 'ooba-model',
        customAPIFormat: LLMFormat.OpenAICompatible,
        reverseProxyOobaMode: true,
        forceReplaceUrl: 'https://proxy.example.com/v1',
        proxyKey: 'sk-proxy',
      } as Partial<Database>),
    ).toEqual({ routable: true, provider: 'openai' })
  })

  it('routes ollama-cloud by ollamaRequestFormat (with an API key)', () => {
    const route = (requestFormat: LLMFormat) =>
      resolveDurableRoute({
        profile: {
          providerId: 'ollama',
          modelId: 'ollama-cloud',
          providerOptions: {
            credentialId: 'credential-ollama',
            requestModel: 'cloud-model',
            ollama: { requestFormat },
          },
        },
        credential: {
          id: 'credential-ollama',
          name: 'Ollama Cloud',
          type: 'apiKey',
          apiKey: 'k',
        },
      })

    expect(route(LLMFormat.Ollama)).toEqual({ routable: true, provider: 'ollama' })
    expect(route(LLMFormat.OpenAICompatible)).toEqual({ routable: true, provider: 'openai' })
    expect(route(LLMFormat.Anthropic)).toEqual({ routable: true, provider: 'anthropic' })
  })

  it('can route directly from a resolved profile capability verdict', () => {
    const database = durableDatabase({
      profile: {
        providerId: 'ollama',
        modelId: 'ollama-cloud',
        providerOptions: {
          credentialId: 'credential-ollama',
          requestModel: 'cloud-model',
          ollama: { requestFormat: LLMFormat.OpenAIResponseAPI },
        },
      },
      credential: {
        id: 'credential-ollama',
        name: 'Ollama Cloud',
        type: 'apiKey',
        apiKey: 'k',
      },
    })
    const profile = resolveModelProfile({ database })
    expect(profile.providerCapability).toEqual({ routable: true, provider: 'openai-responses' })
    expect(resolveChatProviderRoute(database, profile)).toEqual({
      routable: true,
      provider: 'openai-responses',
    })
  })
})

describe('resolveChatProviderRoute — unsupported (specific messages preserved)', () => {
  it.each([
    ['novelai', 'unsupported /chat provider: NovelAI text generation must use local dispatch'],
    ['novellist', 'unsupported /chat provider: NovelList must use local dispatch'],
    ['custom', 'unsupported /chat provider: plugin providers must use local dispatch'],
    ['pluginmodel:::provider-a', 'unsupported /chat provider: plugin providers must use local dispatch'],
    ['hf:::Xenova/opt-350m', 'unsupported /chat provider: local WebLLM models must use local dispatch'],
  ])('classifies %s as unsupported with its specific reason', (aiModel, reason) => {
    expect(resolveStaticCompatibilityRoute(aiModel)).toEqual({ routable: false, reason })
  })

  it('keeps the server-only unknown-OpenAI-compatible-id guard', () => {
    const route = resolveStaticCompatibilityRoute('unregistered-local-model')
    expect(route.routable).toBe(false)
    expect(route).toEqual({
      routable: false,
      reason:
        'unsupported /chat provider: unknown OpenAI-compatible model "unregistered-local-model" cannot be dispatched by the server',
    })
  })

  it('keeps the unknown-id guard when the route helper receives a resolved profile', () => {
    const database = db({ openAIKey: 'sk-server-owned' })
    const route = resolveChatProviderRoute(
      database,
      resolveModelProfile({ database, staticModel: 'unregistered-local-model' }),
    )
    expect(route).toEqual({
      routable: false,
      reason:
        'unsupported /chat provider: unknown OpenAI-compatible model "unregistered-local-model" cannot be dispatched by the server',
    })
  })

  it('classifies ollama-cloud without an API key as unsupported (matches the browser gate)', () => {
    expect(
      resolveDurableRoute({
        profile: {
          providerId: 'ollama',
          modelId: 'ollama-cloud',
          providerOptions: {
            requestModel: 'cloud-model',
            ollama: { requestFormat: LLMFormat.OpenAICompatible },
          },
        },
      }).routable,
    ).toBe(false)
  })
})
