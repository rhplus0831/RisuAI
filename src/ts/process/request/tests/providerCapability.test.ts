import { describe, expect, it } from 'vitest'
import { LLMFormat } from '../../../model/types'
import { formatToServerProvider, resolveProviderCapability, type ProviderCapabilityInput } from '../providerCapability'

// The shared capability table is the single source of truth for the server
// provider-routing decision (closeout decision #5). Both the browser completion
// classifier and the server /chat dispatcher call it, so this matrix is the
// parity proof: there is only one classifier. The per-consumer wiring (and the
// reverse_proxy + ooba flip on each side) is proven in serverCompletion.test.ts
// and the server providerCapabilityRoute.test.ts.

function input(overrides: Partial<ProviderCapabilityInput> = {}): ProviderCapabilityInput {
  return {
    format: LLMFormat.OpenAICompatible,
    aiModel: 'gpt-4o',
    ...overrides,
    config: { ...overrides.config },
  }
}

const REVERSE_PROXY_CONFIG = {
  forceReplaceUrl: 'https://proxy.example.com/v1',
  proxyKey: 'sk-proxy',
}

describe('formatToServerProvider', () => {
  it.each([
    [LLMFormat.Echo, 'echo'],
    [LLMFormat.OpenAICompatible, 'openai'],
    [LLMFormat.NanoGPT, 'nanogpt'],
    [LLMFormat.Anthropic, 'anthropic'],
    [LLMFormat.AnthropicLegacy, 'anthropic'],
    [LLMFormat.NanoGPTMessages, 'anthropic'],
    [LLMFormat.Mistral, 'mistral'],
    [LLMFormat.Cohere, 'cohere'],
    [LLMFormat.GoogleCloud, 'gemini'],
    [LLMFormat.VertexAIGemini, 'gemini'],
    [LLMFormat.OpenAILegacyInstruct, 'openai-legacy-instruct'],
    [LLMFormat.NanoGPTLegacy, 'openai-legacy-instruct'],
    [LLMFormat.OpenAIResponseAPI, 'openai-responses'],
    [LLMFormat.NanoGPTResponses, 'openai-responses'],
    [LLMFormat.Ollama, 'ollama'],
    [LLMFormat.AWSBedrockClaude, 'bedrock'],
    [LLMFormat.Horde, 'horde'],
    [LLMFormat.Kobold, 'kobold'],
    [LLMFormat.OobaLegacy, 'ooba-legacy'],
  ])('maps format %i to %s', (format, provider) => {
    expect(formatToServerProvider(format as LLMFormat)).toBe(provider)
  })

  it.each([LLMFormat.NovelAI, LLMFormat.NovelList, LLMFormat.Ooba, LLMFormat.Plugin, LLMFormat.WebLLM])(
    'returns null for browser-only format %i',
    (format) => {
      expect(formatToServerProvider(format as LLMFormat)).toBeNull()
    },
  )
})

describe('resolveProviderCapability — routable providers', () => {
  it('routes echo', () => {
    expect(resolveProviderCapability(input({ format: LLMFormat.Echo, aiModel: 'echo_model' }))).toEqual({
      routable: true,
      provider: 'echo',
    })
  })

  it('routes vanilla OpenAI', () => {
    expect(resolveProviderCapability(input())).toEqual({ routable: true, provider: 'openai' })
  })

  it('routes openrouter (no key gate at classify time)', () => {
    expect(resolveProviderCapability(input({ aiModel: 'openrouter' }))).toEqual({
      routable: true,
      provider: 'openrouter',
    })
  })

  it('routes nanogpt / kobold / ooba-legacy without a config gate', () => {
    expect(resolveProviderCapability(input({ format: LLMFormat.NanoGPT, aiModel: 'nanogpt' }))).toEqual({
      routable: true,
      provider: 'nanogpt',
    })
    expect(resolveProviderCapability(input({ format: LLMFormat.Kobold, aiModel: 'kobold' }))).toEqual({
      routable: true,
      provider: 'kobold',
    })
    expect(resolveProviderCapability(input({ format: LLMFormat.OobaLegacy, aiModel: 'mancer' }))).toEqual({
      routable: true,
      provider: 'ooba-legacy',
    })
  })

  it('routes vanilla anthropic / mistral / cohere', () => {
    expect(resolveProviderCapability(input({ format: LLMFormat.Anthropic, aiModel: 'claude-3-5-sonnet' }))).toEqual({
      routable: true,
      provider: 'anthropic',
    })
    expect(resolveProviderCapability(input({ format: LLMFormat.Mistral, aiModel: 'mistral-large' }))).toEqual({
      routable: true,
      provider: 'mistral',
    })
    expect(resolveProviderCapability(input({ format: LLMFormat.Cohere, aiModel: 'cohere-command-r' }))).toEqual({
      routable: true,
      provider: 'cohere',
    })
  })

  it('routes Google AI Studio gemini and Vertex gemini (with creds)', () => {
    expect(resolveProviderCapability(input({ format: LLMFormat.GoogleCloud, aiModel: 'gemini-2.5-flash' }))).toEqual({
      routable: true,
      provider: 'gemini',
    })
    expect(
      resolveProviderCapability(
        input({
          format: LLMFormat.VertexAIGemini,
          aiModel: 'gemini-2.5-pro-vertex',
          config: {
            googleProjectId: 'p',
            vertexRegion: 'us-central1',
            vertexClientEmail: 'svc@p.iam',
            vertexPrivateKey: 'pk',
          },
        }),
      ),
    ).toEqual({ routable: true, provider: 'gemini' })
  })

  it('routes bedrock with parseable credentials + internalID', () => {
    expect(
      resolveProviderCapability(
        input({
          format: LLMFormat.AWSBedrockClaude,
          aiModel: 'anthropic.claude-3-5-sonnet',
          internalID: 'claude-3-5-sonnet',
          config: { claudeAPIKey: 'AKIA:secret:us-east-1' },
        }),
      ),
    ).toEqual({ routable: true, provider: 'bedrock' })
  })

  it('routes horde with a chosen instruct template', () => {
    expect(
      resolveProviderCapability(
        input({
          format: LLMFormat.Horde,
          aiModel: 'horde:::koboldcpp/x',
          config: { instructChatTemplate: 'chatml' },
        }),
      ),
    ).toEqual({ routable: true, provider: 'horde' })
  })

  it('routes openai-legacy-instruct and openai-responses', () => {
    expect(
      resolveProviderCapability(input({ format: LLMFormat.OpenAILegacyInstruct, aiModel: 'gpt-3.5-turbo-instruct' })),
    ).toEqual({ routable: true, provider: 'openai-legacy-instruct' })
    expect(
      resolveProviderCapability(input({ format: LLMFormat.OpenAIResponseAPI, aiModel: 'gpt-5-response-api' })),
    ).toEqual({ routable: true, provider: 'openai-responses' })
  })

  it('routes a configured reverse_proxy (the reverse_proxy + ooba shape — no ooba gate)', () => {
    // The ooba flag never reaches the table; a reverse_proxy with a URL + key is
    // routable, and the openai adapter applies oobaSystemHoist itself. This is
    // the decision-#5 ooba flip at the table level.
    expect(resolveProviderCapability(input({ aiModel: 'reverse_proxy', config: REVERSE_PROXY_CONFIG }))).toEqual({
      routable: true,
      provider: 'openai',
    })
  })

  it('routes reverse_proxy under non-OpenAI formats by their dispatcher', () => {
    expect(
      resolveProviderCapability(
        input({
          format: LLMFormat.Anthropic,
          aiModel: 'reverse_proxy',
          config: REVERSE_PROXY_CONFIG,
        }),
      ),
    ).toEqual({ routable: true, provider: 'anthropic' })
    expect(
      resolveProviderCapability(
        input({
          format: LLMFormat.Mistral,
          aiModel: 'reverse_proxy',
          config: REVERSE_PROXY_CONFIG,
        }),
      ),
    ).toEqual({ routable: true, provider: 'mistral' })
  })

  it('routes an xcustom entry whose stored format matches', () => {
    expect(
      resolveProviderCapability(
        input({
          aiModel: 'xcustom:::a',
          config: {
            customModels: [
              {
                id: 'xcustom:::a',
                url: 'https://x/v1',
                key: 'k',
                format: LLMFormat.OpenAICompatible,
              },
            ],
          },
        }),
      ),
    ).toEqual({ routable: true, provider: 'openai' })
  })

  it('routes a keyIdentifier model (DeepSeek-style) with key + endpoint', () => {
    expect(
      resolveProviderCapability(
        input({
          aiModel: 'deepseek-chat',
          keyIdentifier: 'deepseek',
          endpoint: 'https://api.deepseek.com/beta/chat/completions',
          config: { oaiCompApiKeys: { deepseek: 'sk-ds' } },
        }),
      ),
    ).toEqual({ routable: true, provider: 'openai' })
  })

  it('routes ollama native (ollamaURL set) and ollama-cloud by request format', () => {
    expect(
      resolveProviderCapability(
        input({
          format: LLMFormat.Ollama,
          aiModel: 'ollama-hosted',
          config: { ollamaURL: 'http://localhost:11434' },
        }),
      ),
    ).toEqual({ routable: true, provider: 'ollama' })
    expect(
      resolveProviderCapability(
        input({
          format: LLMFormat.Ollama,
          aiModel: 'ollama-cloud',
          config: { ollamaApiKey: 'k', ollamaRequestFormat: LLMFormat.OpenAICompatible },
        }),
      ),
    ).toEqual({ routable: true, provider: 'openai' })
    expect(
      resolveProviderCapability(
        input({
          format: LLMFormat.Ollama,
          aiModel: 'ollama-cloud',
          config: { ollamaApiKey: 'k', ollamaRequestFormat: LLMFormat.Anthropic },
        }),
      ),
    ).toEqual({ routable: true, provider: 'anthropic' })
  })
})

describe('resolveProviderCapability — unsupported categories', () => {
  it.each([
    [LLMFormat.NovelAI, 'novelai'],
    [LLMFormat.NovelList, 'novellist'],
    [LLMFormat.Ooba, 'ooba'],
    [LLMFormat.Plugin, 'plugin'],
    [LLMFormat.WebLLM, 'webllm'],
  ])('classifies browser-only format %i as %s', (format, reason) => {
    expect(resolveProviderCapability(input({ format: format as LLMFormat }))).toEqual({
      routable: false,
      reason,
    })
  })

  it('classifies an incomplete reverse_proxy as config-incomplete', () => {
    expect(resolveProviderCapability(input({ aiModel: 'reverse_proxy', config: { proxyKey: 'sk' } }))).toEqual({
      routable: false,
      reason: 'config-incomplete',
    })
    expect(
      resolveProviderCapability(input({ aiModel: 'reverse_proxy', config: { forceReplaceUrl: 'https://p/v1' } })),
    ).toEqual({ routable: false, reason: 'config-incomplete' })
  })

  it('classifies a reverse_proxy whose non-OpenAI format lacks creds as config-incomplete', () => {
    expect(
      resolveProviderCapability(input({ format: LLMFormat.Anthropic, aiModel: 'reverse_proxy', config: {} })),
    ).toEqual({ routable: false, reason: 'config-incomplete' })
  })

  it('classifies an xcustom format mismatch / missing url|key as config-incomplete', () => {
    expect(
      resolveProviderCapability(
        input({
          aiModel: 'xcustom:::a',
          config: {
            customModels: [{ id: 'xcustom:::a', url: 'https://x', key: 'k', format: LLMFormat.Anthropic }],
          },
        }),
      ),
    ).toEqual({ routable: false, reason: 'config-incomplete' })
    expect(
      resolveProviderCapability(
        input({
          aiModel: 'xcustom:::a',
          config: {
            customModels: [{ id: 'xcustom:::a', url: 'https://x', format: LLMFormat.OpenAICompatible }],
          },
        }),
      ),
    ).toEqual({ routable: false, reason: 'config-incomplete' })
  })

  it('classifies a keyIdentifier model without its key, and an endpoint without a keyIdentifier', () => {
    expect(
      resolveProviderCapability(
        input({
          aiModel: 'deepseek-chat',
          keyIdentifier: 'deepseek',
          endpoint: 'https://api.deepseek.com',
          config: {},
        }),
      ),
    ).toEqual({ routable: false, reason: 'config-incomplete' })
    expect(resolveProviderCapability(input({ aiModel: 'self-hosted', endpoint: 'https://host/v1' }))).toEqual({
      routable: false,
      reason: 'config-incomplete',
    })
  })

  it('classifies vertex gemini without full creds, bedrock without creds, horde without a template', () => {
    expect(
      resolveProviderCapability(
        input({
          format: LLMFormat.VertexAIGemini,
          aiModel: 'gemini-2.5-pro-vertex',
          config: { googleProjectId: 'p' },
        }),
      ),
    ).toEqual({ routable: false, reason: 'config-incomplete' })
    expect(
      resolveProviderCapability(input({ format: LLMFormat.AWSBedrockClaude, aiModel: 'anthropic.claude', config: {} })),
    ).toEqual({ routable: false, reason: 'config-incomplete' })
    expect(resolveProviderCapability(input({ format: LLMFormat.Horde, aiModel: 'horde:::x', config: {} }))).toEqual({
      routable: false,
      reason: 'config-incomplete',
    })
    expect(
      resolveProviderCapability(
        input({
          format: LLMFormat.Horde,
          aiModel: 'horde:::x',
          config: { instructChatTemplate: 'jinja' },
        }),
      ),
    ).toEqual({ routable: false, reason: 'config-incomplete' })
  })

  it('classifies ollama without a URL and ollama-cloud without an API key', () => {
    expect(
      resolveProviderCapability(input({ format: LLMFormat.Ollama, aiModel: 'ollama-hosted', config: {} })),
    ).toEqual({ routable: false, reason: 'config-incomplete' })
    expect(
      resolveProviderCapability(
        input({
          format: LLMFormat.Ollama,
          aiModel: 'ollama-cloud',
          config: { ollamaRequestFormat: LLMFormat.OpenAICompatible },
        }),
      ),
    ).toEqual({ routable: false, reason: 'config-incomplete' })
  })
})
