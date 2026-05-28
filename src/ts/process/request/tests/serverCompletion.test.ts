import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const platformState = vi.hoisted(() => ({ isFastifyServer: true }))

vi.mock('../../../platform', async (importActual) => {
  const actual = await importActual<typeof import('../../../platform')>()
  return {
    ...actual,
    get isFastifyServer() {
      return platformState.isFastifyServer
    },
  }
})

vi.mock('../../../storage/nodeStorage', () => ({
  getNodeServerProxyAuth: async () => 'test-auth-token',
}))

vi.mock('../../modules', async (importActual) => {
  const actual = await importActual<typeof import('../../modules')>()
  return { ...actual, moduleUpdate: () => {}, getModuleToggles: () => '' }
})

import { LLMFormat } from '../../../model/types'
import { setDatabase, type Database } from '../../../storage/database.svelte'
import { DBState, selectedCharID } from '../../../stores.svelte'
import type { RequestDataArgumentExtended } from '../request'
import {
  extractAnthropicSystem,
  formatToServerProvider,
  getServerCompletionProvider,
  requestServerCompletion,
  resolveServerCompletionRoute,
} from '../serverCompletion'

function seedDb(overrides: Partial<Database> = {}): void {
  const seed = {
    aiModel: 'echo_model',
    subModel: 'echo_model',
    characters: [],
    maxContext: 4000,
    botPresetsId: 0,
    statics: { messages: 0 } as unknown as Database['statics'],
    promptInfoInsideChat: false,
    echoMessage: 'Echo Message',
    echoDelay: 0,
    ...overrides,
  } as unknown as Database
  setDatabase(seed)
  if (overrides.echoMessage !== undefined) {
    DBState.db.echoMessage = overrides.echoMessage
  }
  if (overrides.echoDelay !== undefined) {
    DBState.db.echoDelay = overrides.echoDelay
  }
}

function makeTarg(
  overrides: Partial<RequestDataArgumentExtended> = {},
): RequestDataArgumentExtended {
  return {
    bias: {},
    formated: [{ role: 'user', content: 'hi' }],
    aiModel: 'echo_model',
    modelInfo: {
      id: 'echo_model',
      name: 'Echo',
      internalID: 'echo_model',
      provider: 0 as never,
      format: LLMFormat.Echo,
      flags: [],
      parameters: [],
      tokenizer: 0 as never,
      recommended: false,
    } as unknown as RequestDataArgumentExtended['modelInfo'],
    useStreaming: false,
    ...overrides,
  } as RequestDataArgumentExtended
}

beforeEach(() => {
  platformState.isFastifyServer = true
  seedDb()
  // `vi.unstubAllGlobals()` in our afterEach also strips the
  // safeStructuredClone polyfill that vitest.setup.ts installs. Reapply
  // it before each test so chatTemplate.ts (used by the horde adapter
  // path) doesn't ReferenceError.
  ;(globalThis as Record<string, unknown>).safeStructuredClone = (v: unknown) =>
    JSON.parse(JSON.stringify(v))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('formatToServerProvider', () => {
  it('maps Echo to "echo"', () => {
    expect(formatToServerProvider(LLMFormat.Echo)).toBe('echo')
  })

  it('maps OpenAICompatible to "openai"', () => {
    expect(formatToServerProvider(LLMFormat.OpenAICompatible)).toBe('openai')
  })

  it('maps Mistral to "mistral"', () => {
    expect(formatToServerProvider(LLMFormat.Mistral)).toBe('mistral')
  })

  it('maps Cohere to "cohere"', () => {
    expect(formatToServerProvider(LLMFormat.Cohere)).toBe('cohere')
  })

  it('maps GoogleCloud (vanilla Google AI) to "gemini"', () => {
    expect(formatToServerProvider(LLMFormat.GoogleCloud)).toBe('gemini')
  })

  it('maps VertexAIGemini to "gemini" (the dispatcher branches on options.gemini.vertex)', () => {
    expect(formatToServerProvider(LLMFormat.VertexAIGemini)).toBe('gemini')
  })

  it('maps Horde to "horde"', () => {
    expect(formatToServerProvider(LLMFormat.Horde)).toBe('horde')
  })

  it('maps OpenAILegacyInstruct + NanoGPTLegacy to "openai-legacy-instruct"', () => {
    expect(formatToServerProvider(LLMFormat.OpenAILegacyInstruct)).toBe('openai-legacy-instruct')
    expect(formatToServerProvider(LLMFormat.NanoGPTLegacy)).toBe('openai-legacy-instruct')
  })

  it('maps AnthropicLegacy + NanoGPTMessages to "anthropic" (wire shape unchanged)', () => {
    expect(formatToServerProvider(LLMFormat.AnthropicLegacy)).toBe('anthropic')
    expect(formatToServerProvider(LLMFormat.NanoGPTMessages)).toBe('anthropic')
  })

  it('maps OpenAIResponseAPI + NanoGPTResponses to "openai-responses"', () => {
    expect(formatToServerProvider(LLMFormat.OpenAIResponseAPI)).toBe('openai-responses')
    expect(formatToServerProvider(LLMFormat.NanoGPTResponses)).toBe('openai-responses')
  })

  it('maps AWSBedrockClaude to "bedrock" (auth is SigV4 via options.bedrock.credentials)', () => {
    expect(formatToServerProvider(LLMFormat.AWSBedrockClaude)).toBe('bedrock')
  })
})

describe('getServerCompletionProvider', () => {
  it('returns the provider when every gate passes', () => {
    const r = getServerCompletionProvider(makeTarg())
    expect(r).toBe('echo')
  })

  it('returns null when isFastifyServer is false', () => {
    platformState.isFastifyServer = false
    const r = getServerCompletionProvider(makeTarg())
    expect(r).toBeNull()
  })

  it('returns null when previewBody is true', () => {
    const r = getServerCompletionProvider(makeTarg({ previewBody: true }))
    expect(r).toBeNull()
  })

  it('reports previewBody as unsupported in Fastify mode instead of falling back locally', () => {
    const r = resolveServerCompletionRoute(makeTarg({ previewBody: true }))
    expect(r).toEqual({
      type: 'unsupported',
      reason:
        'Provider preview bodies are not supported in Fastify server mode because browser-side provider dispatch is disabled.',
    })
  })

  it('returns null for a format with no server implementation yet', () => {
    // NovelAI / NovelList stay deferred per
    // docs/archive/fastify/other/design/novelai-novellist-stringlize.md; both should
    // return null from formatToServerProvider (and therefore from
    // getServerCompletionProvider) until Phase 7 lands.
    const r = getServerCompletionProvider(
      makeTarg({
        modelInfo: {
          id: 'kayra-v1',
          format: LLMFormat.NovelAI,
        } as unknown as RequestDataArgumentExtended['modelInfo'],
      }),
    )
    expect(r).toBeNull()
  })

  it('reports formats with no server implementation as unsupported in Fastify mode', () => {
    const r = resolveServerCompletionRoute(
      makeTarg({
        aiModel: 'kayra-v1',
        modelInfo: {
          id: 'kayra-v1',
          format: LLMFormat.NovelAI,
        } as unknown as RequestDataArgumentExtended['modelInfo'],
      }),
    )
    expect(r).toMatchObject({
      type: 'unsupported',
      reason:
        'Generation for kayra-v1 is not supported in Fastify server mode. Select a server-routed provider or change this model before retrying.',
    })
  })

  it('maps a vanilla OpenAI model to "openai"', () => {
    const r = getServerCompletionProvider(
      makeTarg({
        aiModel: 'gpt-4o',
        modelInfo: {
          id: 'gpt-4o',
          format: LLMFormat.OpenAICompatible,
        } as unknown as RequestDataArgumentExtended['modelInfo'],
      }),
    )
    expect(r).toBe('openai')
  })

  it('routes reverse_proxy under OpenAICompatible to provider "openai" when db.forceReplaceUrl and db.proxyKey are set', () => {
    seedDb({
      forceReplaceUrl: 'https://proxy.example.com/v1',
      proxyKey: 'sk-proxy',
    } as unknown as Partial<Database>)
    const r = getServerCompletionProvider(
      makeTarg({
        aiModel: 'reverse_proxy',
        modelInfo: {
          id: 'reverse_proxy',
          format: LLMFormat.OpenAICompatible,
        } as unknown as RequestDataArgumentExtended['modelInfo'],
      }),
    )
    expect(r).toBe('openai')
  })

  it('refuses reverse_proxy when db.forceReplaceUrl is empty', () => {
    seedDb({
      forceReplaceUrl: '',
      proxyKey: 'sk-proxy',
    } as unknown as Partial<Database>)
    const r = getServerCompletionProvider(
      makeTarg({
        aiModel: 'reverse_proxy',
        modelInfo: {
          id: 'reverse_proxy',
          format: LLMFormat.OpenAICompatible,
        } as unknown as RequestDataArgumentExtended['modelInfo'],
      }),
    )
    expect(r).toBeNull()
  })

  it('refuses reverse_proxy when db.proxyKey is empty', () => {
    seedDb({
      forceReplaceUrl: 'https://proxy.example.com/v1',
      proxyKey: '',
    } as unknown as Partial<Database>)
    const r = getServerCompletionProvider(
      makeTarg({
        aiModel: 'reverse_proxy',
        modelInfo: {
          id: 'reverse_proxy',
          format: LLMFormat.OpenAICompatible,
        } as unknown as RequestDataArgumentExtended['modelInfo'],
      }),
    )
    expect(r).toBeNull()
  })

  it('refuses xcustom::: models when no db.customModels entry matches', () => {
    seedDb({ customModels: [] } as unknown as Partial<Database>)
    const r = getServerCompletionProvider(
      makeTarg({
        aiModel: 'xcustom:::missing',
        modelInfo: {
          id: 'xcustom:::missing',
          format: LLMFormat.OpenAICompatible,
        } as unknown as RequestDataArgumentExtended['modelInfo'],
      }),
    )
    expect(r).toBeNull()
  })

  it('refuses xcustom::: models whose db.customModels entry lacks url or key', () => {
    seedDb({
      customModels: [
        {
          id: 'xcustom:::no-key',
          internalId: 'gpt-test',
          url: 'https://example.com/v1/chat/completions',
          key: '',
          format: LLMFormat.OpenAICompatible,
          params: '',
        },
      ],
    } as unknown as Partial<Database>)
    const r = getServerCompletionProvider(
      makeTarg({
        aiModel: 'xcustom:::no-key',
        modelInfo: {
          id: 'xcustom:::no-key',
          format: LLMFormat.OpenAICompatible,
        } as unknown as RequestDataArgumentExtended['modelInfo'],
      }),
    )
    expect(r).toBeNull()
  })

  it('routes xcustom::: OpenAICompatible models to provider "openai" when the db.customModels entry is valid', () => {
    seedDb({
      customModels: [
        {
          id: 'xcustom:::my-model',
          internalId: 'gpt-test',
          url: 'https://example.com/v1/chat/completions',
          key: 'sk-xcustom',
          format: LLMFormat.OpenAICompatible,
          params: '',
        },
      ],
    } as unknown as Partial<Database>)
    const r = getServerCompletionProvider(
      makeTarg({
        aiModel: 'xcustom:::my-model',
        modelInfo: {
          id: 'xcustom:::my-model',
          format: LLMFormat.OpenAICompatible,
        } as unknown as RequestDataArgumentExtended['modelInfo'],
      }),
    )
    expect(r).toBe('openai')
  })

  it('refuses xcustom::: entries whose format is not OpenAICompatible (other formats need their own slices)', () => {
    seedDb({
      customModels: [
        {
          id: 'xcustom:::anthropic-clone',
          internalId: 'claude-fake',
          url: 'https://example.com/anthropic',
          key: 'sk-x',
          format: LLMFormat.Anthropic,
          params: '',
        },
      ],
    } as unknown as Partial<Database>)
    const r = getServerCompletionProvider(
      makeTarg({
        aiModel: 'xcustom:::anthropic-clone',
        modelInfo: {
          id: 'xcustom:::anthropic-clone',
          format: LLMFormat.OpenAICompatible,
        } as unknown as RequestDataArgumentExtended['modelInfo'],
      }),
    )
    expect(r).toBeNull()
  })

  it('routes the openrouter alias to provider "openrouter"', () => {
    const r = getServerCompletionProvider(
      makeTarg({
        aiModel: 'openrouter',
        modelInfo: {
          id: 'openrouter',
          format: LLMFormat.OpenAICompatible,
        } as unknown as RequestDataArgumentExtended['modelInfo'],
      }),
    )
    expect(r).toBe('openrouter')
  })

  it('routes AWSBedrockClaude to provider "bedrock" when db.claudeAPIKey parses as accessKey:secret:region', () => {
    seedDb({
      claudeAPIKey: 'AKIAIOSFODNN7EXAMPLE:wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY:us-east-1',
    } as unknown as Partial<Database>)
    const r = getServerCompletionProvider(
      makeTarg({
        aiModel: 'claude-3-5-sonnet-bedrock',
        modelInfo: {
          id: 'claude-3-5-sonnet-bedrock',
          internalID: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
          format: LLMFormat.AWSBedrockClaude,
        } as unknown as RequestDataArgumentExtended['modelInfo'],
      }),
    )
    expect(r).toBe('bedrock')
  })

  it('refuses AWSBedrockClaude when db.claudeAPIKey is missing a colon-separated part', () => {
    seedDb({ claudeAPIKey: 'AKIA:secret' } as unknown as Partial<Database>)
    const r = getServerCompletionProvider(
      makeTarg({
        aiModel: 'claude-3-5-sonnet-bedrock',
        modelInfo: {
          id: 'claude-3-5-sonnet-bedrock',
          internalID: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
          format: LLMFormat.AWSBedrockClaude,
        } as unknown as RequestDataArgumentExtended['modelInfo'],
      }),
    )
    expect(r).toBeNull()
  })

  it('refuses AWSBedrockClaude when modelInfo.internalID is missing', () => {
    seedDb({
      claudeAPIKey: 'AKIA:secret:us-east-1',
    } as unknown as Partial<Database>)
    const r = getServerCompletionProvider(
      makeTarg({
        aiModel: 'claude-3-5-sonnet-bedrock',
        modelInfo: {
          id: 'claude-3-5-sonnet-bedrock',
          format: LLMFormat.AWSBedrockClaude,
        } as unknown as RequestDataArgumentExtended['modelInfo'],
      }),
    )
    expect(r).toBeNull()
  })

  it('routes a Horde model to provider "horde" when aiModel starts with horde::: and instructChatTemplate is set', () => {
    seedDb({
      instructChatTemplate: 'chatml',
      hordeConfig: { apiKey: 'k', model: '', softPrompt: '' },
    } as unknown as Partial<Database>)
    const r = getServerCompletionProvider(
      makeTarg({
        aiModel: 'horde:::koboldcpp/Mistral-7B',
        modelInfo: {
          id: 'horde:::koboldcpp/Mistral-7B',
          format: LLMFormat.Horde,
        } as unknown as RequestDataArgumentExtended['modelInfo'],
      }),
    )
    expect(r).toBe('horde')
  })

  it('refuses Horde when db.instructChatTemplate is empty (Phase 7 work)', () => {
    seedDb({
      instructChatTemplate: '',
      hordeConfig: { apiKey: '', model: '', softPrompt: '' },
    } as unknown as Partial<Database>)
    const r = getServerCompletionProvider(
      makeTarg({
        aiModel: 'horde:::koboldcpp/Mistral-7B',
        modelInfo: {
          id: 'horde:::koboldcpp/Mistral-7B',
          format: LLMFormat.Horde,
        } as unknown as RequestDataArgumentExtended['modelInfo'],
      }),
    )
    expect(r).toBeNull()
  })

  it('refuses Horde when aiModel lacks the horde::: prefix', () => {
    seedDb({
      instructChatTemplate: 'chatml',
    } as unknown as Partial<Database>)
    const r = getServerCompletionProvider(
      makeTarg({
        aiModel: 'not-horde-prefixed',
        modelInfo: {
          id: 'not-horde-prefixed',
          format: LLMFormat.Horde,
        } as unknown as RequestDataArgumentExtended['modelInfo'],
      }),
    )
    expect(r).toBeNull()
  })

  it('routes a vanilla Anthropic-format model to provider "anthropic"', () => {
    const r = getServerCompletionProvider(
      makeTarg({
        aiModel: 'claude-3-5-sonnet-20241022',
        modelInfo: {
          id: 'claude-3-5-sonnet-20241022',
          format: LLMFormat.Anthropic,
        } as unknown as RequestDataArgumentExtended['modelInfo'],
      }),
    )
    expect(r).toBe('anthropic')
  })

  it('routes reverse_proxy under Anthropic to provider "anthropic" when db.forceReplaceUrl and db.proxyKey are set', () => {
    seedDb({
      forceReplaceUrl: 'https://proxy.example.com/v1/messages',
      proxyKey: 'sk-proxy',
    } as unknown as Partial<Database>)
    const r = getServerCompletionProvider(
      makeTarg({
        aiModel: 'reverse_proxy',
        modelInfo: {
          id: 'reverse_proxy',
          format: LLMFormat.Anthropic,
        } as unknown as RequestDataArgumentExtended['modelInfo'],
      }),
    )
    expect(r).toBe('anthropic')
  })

  it('refuses reverse_proxy under Anthropic when db.forceReplaceUrl is empty', () => {
    seedDb({
      forceReplaceUrl: '',
      proxyKey: 'sk-proxy',
    } as unknown as Partial<Database>)
    const r = getServerCompletionProvider(
      makeTarg({
        aiModel: 'reverse_proxy',
        modelInfo: {
          id: 'reverse_proxy',
          format: LLMFormat.Anthropic,
        } as unknown as RequestDataArgumentExtended['modelInfo'],
      }),
    )
    expect(r).toBeNull()
  })

  it('routes xcustom::: under Anthropic to provider "anthropic" when entry.format is Anthropic', () => {
    seedDb({
      customModels: [
        {
          id: 'xcustom:::anthropic-clone',
          internalId: 'claude-fake',
          url: 'https://example.com/v1/messages',
          key: 'sk-x',
          format: LLMFormat.Anthropic,
          params: '',
        },
      ],
    } as unknown as Partial<Database>)
    const r = getServerCompletionProvider(
      makeTarg({
        aiModel: 'xcustom:::anthropic-clone',
        modelInfo: {
          // request.ts mutates modelInfo.format to the customModels entry's
          // format before the adapter runs; mirror that here.
          id: 'xcustom:::anthropic-clone',
          format: LLMFormat.Anthropic,
        } as unknown as RequestDataArgumentExtended['modelInfo'],
      }),
    )
    expect(r).toBe('anthropic')
  })

  it('refuses xcustom::: under Anthropic when the customModels entry format mismatches', () => {
    seedDb({
      customModels: [
        {
          id: 'xcustom:::mismatch',
          internalId: 'foo',
          url: 'https://example.com/v1/messages',
          key: 'sk-x',
          // Entry says Mistral but outer modelInfo says Anthropic — pipeline
          // mismatch; refuse.
          format: LLMFormat.Mistral,
          params: '',
        },
      ],
    } as unknown as Partial<Database>)
    const r = getServerCompletionProvider(
      makeTarg({
        aiModel: 'xcustom:::mismatch',
        modelInfo: {
          id: 'xcustom:::mismatch',
          format: LLMFormat.Anthropic,
        } as unknown as RequestDataArgumentExtended['modelInfo'],
      }),
    )
    expect(r).toBeNull()
  })

  it('routes a vanilla Mistral-format model to provider "mistral"', () => {
    const r = getServerCompletionProvider(
      makeTarg({
        aiModel: 'mistral-large-latest',
        modelInfo: {
          id: 'mistral-large-latest',
          format: LLMFormat.Mistral,
        } as unknown as RequestDataArgumentExtended['modelInfo'],
      }),
    )
    expect(r).toBe('mistral')
  })

  it('routes reverse_proxy under Mistral to provider "mistral" when db.forceReplaceUrl and db.proxyKey are set', () => {
    seedDb({
      forceReplaceUrl: 'https://proxy.example.com/v1/chat/completions',
      proxyKey: 'sk-proxy',
    } as unknown as Partial<Database>)
    const r = getServerCompletionProvider(
      makeTarg({
        aiModel: 'reverse_proxy',
        modelInfo: {
          id: 'reverse_proxy',
          format: LLMFormat.Mistral,
        } as unknown as RequestDataArgumentExtended['modelInfo'],
      }),
    )
    expect(r).toBe('mistral')
  })

  it('refuses reverse_proxy under Mistral when db.proxyKey is empty', () => {
    seedDb({
      forceReplaceUrl: 'https://proxy.example.com/v1/chat/completions',
      proxyKey: '',
    } as unknown as Partial<Database>)
    const r = getServerCompletionProvider(
      makeTarg({
        aiModel: 'reverse_proxy',
        modelInfo: {
          id: 'reverse_proxy',
          format: LLMFormat.Mistral,
        } as unknown as RequestDataArgumentExtended['modelInfo'],
      }),
    )
    expect(r).toBeNull()
  })

  it('routes xcustom::: under Mistral to provider "mistral" when entry.format is Mistral', () => {
    seedDb({
      customModels: [
        {
          id: 'xcustom:::mistral-clone',
          internalId: 'mistral-fake',
          url: 'https://example.com/v1/chat/completions',
          key: 'sk-x',
          format: LLMFormat.Mistral,
          params: '',
        },
      ],
    } as unknown as Partial<Database>)
    const r = getServerCompletionProvider(
      makeTarg({
        aiModel: 'xcustom:::mistral-clone',
        modelInfo: {
          // request.ts mutates modelInfo.format to the customModels entry's
          // format before the adapter runs; mirror that here.
          id: 'xcustom:::mistral-clone',
          format: LLMFormat.Mistral,
        } as unknown as RequestDataArgumentExtended['modelInfo'],
      }),
    )
    expect(r).toBe('mistral')
  })

  it('refuses xcustom::: under Mistral when the customModels entry format mismatches', () => {
    seedDb({
      customModels: [
        {
          id: 'xcustom:::mistral-mismatch',
          internalId: 'mistral-fake',
          url: 'https://example.com/v1/chat/completions',
          key: 'sk-x',
          // Entry says OpenAICompatible but outer modelInfo says Mistral —
          // pipeline mismatch; refuse.
          format: LLMFormat.OpenAICompatible,
          params: '',
        },
      ],
    } as unknown as Partial<Database>)
    const r = getServerCompletionProvider(
      makeTarg({
        aiModel: 'xcustom:::mistral-mismatch',
        modelInfo: {
          id: 'xcustom:::mistral-mismatch',
          format: LLMFormat.Mistral,
        } as unknown as RequestDataArgumentExtended['modelInfo'],
      }),
    )
    expect(r).toBeNull()
  })

  it('routes a vanilla Cohere-format model to provider "cohere"', () => {
    const r = getServerCompletionProvider(
      makeTarg({
        aiModel: 'cohere-command-r-plus-04-2024',
        modelInfo: {
          id: 'cohere-command-r-plus-04-2024',
          format: LLMFormat.Cohere,
        } as unknown as RequestDataArgumentExtended['modelInfo'],
      }),
    )
    expect(r).toBe('cohere')
  })

  it('refuses Cohere-format models with an endpoint override', () => {
    const r = getServerCompletionProvider(
      makeTarg({
        aiModel: 'cohere-command-r-plus-04-2024',
        modelInfo: {
          id: 'cohere-command-r-plus-04-2024',
          format: LLMFormat.Cohere,
          endpoint: 'https://self-hosted-cohere.example.com/v1/chat',
        } as unknown as RequestDataArgumentExtended['modelInfo'],
      }),
    )
    expect(r).toBeNull()
  })

  it('routes reverse_proxy under Cohere to provider "cohere" when db.forceReplaceUrl and db.proxyKey are set', () => {
    seedDb({
      forceReplaceUrl: 'https://proxy.example.com/v1/chat',
      proxyKey: 'sk-proxy',
    } as unknown as Partial<Database>)
    const r = getServerCompletionProvider(
      makeTarg({
        aiModel: 'reverse_proxy',
        modelInfo: {
          id: 'reverse_proxy',
          format: LLMFormat.Cohere,
        } as unknown as RequestDataArgumentExtended['modelInfo'],
      }),
    )
    expect(r).toBe('cohere')
  })

  it('refuses reverse_proxy under Cohere when db.proxyKey is empty', () => {
    seedDb({
      forceReplaceUrl: 'https://proxy.example.com/v1/chat',
      proxyKey: '',
    } as unknown as Partial<Database>)
    const r = getServerCompletionProvider(
      makeTarg({
        aiModel: 'reverse_proxy',
        modelInfo: {
          id: 'reverse_proxy',
          format: LLMFormat.Cohere,
        } as unknown as RequestDataArgumentExtended['modelInfo'],
      }),
    )
    expect(r).toBeNull()
  })

  it('routes xcustom::: under Cohere to provider "cohere" when entry.format is Cohere', () => {
    seedDb({
      customModels: [
        {
          id: 'xcustom:::cohere-clone',
          internalId: 'command-fake',
          url: 'https://example.com/v1/chat',
          key: 'sk-x',
          format: LLMFormat.Cohere,
          params: '',
        },
      ],
    } as unknown as Partial<Database>)
    const r = getServerCompletionProvider(
      makeTarg({
        aiModel: 'xcustom:::cohere-clone',
        modelInfo: {
          id: 'xcustom:::cohere-clone',
          format: LLMFormat.Cohere,
        } as unknown as RequestDataArgumentExtended['modelInfo'],
      }),
    )
    expect(r).toBe('cohere')
  })

  it('refuses Mistral-format models with an endpoint override', () => {
    const r = getServerCompletionProvider(
      makeTarg({
        aiModel: 'mistral-large-latest',
        modelInfo: {
          id: 'mistral-large-latest',
          format: LLMFormat.Mistral,
          endpoint: 'https://self-hosted-mistral.example.com/v1/chat/completions',
        } as unknown as RequestDataArgumentExtended['modelInfo'],
      }),
    )
    expect(r).toBeNull()
  })

  it('routes reverse_proxy under OpenAIResponseAPI to provider "openai-responses" when db.forceReplaceUrl and db.proxyKey are set', () => {
    seedDb({
      forceReplaceUrl: 'https://proxy.example.com/v1/responses',
      proxyKey: 'sk-proxy',
    } as unknown as Partial<Database>)
    const r = getServerCompletionProvider(
      makeTarg({
        aiModel: 'reverse_proxy',
        modelInfo: {
          id: 'reverse_proxy',
          format: LLMFormat.OpenAIResponseAPI,
        } as unknown as RequestDataArgumentExtended['modelInfo'],
      }),
    )
    expect(r).toBe('openai-responses')
  })

  it('refuses reverse_proxy under OpenAIResponseAPI when db.proxyKey is empty', () => {
    seedDb({
      forceReplaceUrl: 'https://proxy.example.com/v1/responses',
      proxyKey: '',
    } as unknown as Partial<Database>)
    const r = getServerCompletionProvider(
      makeTarg({
        aiModel: 'reverse_proxy',
        modelInfo: {
          id: 'reverse_proxy',
          format: LLMFormat.OpenAIResponseAPI,
        } as unknown as RequestDataArgumentExtended['modelInfo'],
      }),
    )
    expect(r).toBeNull()
  })

  it('routes reverse_proxy under OpenAILegacyInstruct to provider "openai-legacy-instruct" when db.forceReplaceUrl and db.proxyKey are set', () => {
    seedDb({
      forceReplaceUrl: 'https://proxy.example.com/v1/completions',
      proxyKey: 'sk-proxy',
    } as unknown as Partial<Database>)
    const r = getServerCompletionProvider(
      makeTarg({
        aiModel: 'reverse_proxy',
        modelInfo: {
          id: 'reverse_proxy',
          format: LLMFormat.OpenAILegacyInstruct,
        } as unknown as RequestDataArgumentExtended['modelInfo'],
      }),
    )
    expect(r).toBe('openai-legacy-instruct')
  })

  it('refuses reverse_proxy under OpenAILegacyInstruct when db.proxyKey is empty', () => {
    seedDb({
      forceReplaceUrl: 'https://proxy.example.com/v1/completions',
      proxyKey: '',
    } as unknown as Partial<Database>)
    const r = getServerCompletionProvider(
      makeTarg({
        aiModel: 'reverse_proxy',
        modelInfo: {
          id: 'reverse_proxy',
          format: LLMFormat.OpenAILegacyInstruct,
        } as unknown as RequestDataArgumentExtended['modelInfo'],
      }),
    )
    expect(r).toBeNull()
  })

  it('routes xcustom::: under OpenAILegacyInstruct to provider "openai-legacy-instruct" when entry.format matches', () => {
    seedDb({
      customModels: [
        {
          id: 'xcustom:::legacy-clone',
          internalId: 'gpt-fake-instruct',
          url: 'https://example.com/v1/completions',
          key: 'sk-x',
          format: LLMFormat.OpenAILegacyInstruct,
          params: '',
        },
      ],
    } as unknown as Partial<Database>)
    const r = getServerCompletionProvider(
      makeTarg({
        aiModel: 'xcustom:::legacy-clone',
        modelInfo: {
          id: 'xcustom:::legacy-clone',
          format: LLMFormat.OpenAILegacyInstruct,
        } as unknown as RequestDataArgumentExtended['modelInfo'],
      }),
    )
    expect(r).toBe('openai-legacy-instruct')
  })

  it('routes xcustom::: under OpenAIResponseAPI to provider "openai-responses" when entry.format matches', () => {
    seedDb({
      customModels: [
        {
          id: 'xcustom:::resp-clone',
          internalId: 'gpt-fake-responses',
          url: 'https://example.com/v1/responses',
          key: 'sk-x',
          format: LLMFormat.OpenAIResponseAPI,
          params: '',
        },
      ],
    } as unknown as Partial<Database>)
    const r = getServerCompletionProvider(
      makeTarg({
        aiModel: 'xcustom:::resp-clone',
        modelInfo: {
          id: 'xcustom:::resp-clone',
          format: LLMFormat.OpenAIResponseAPI,
        } as unknown as RequestDataArgumentExtended['modelInfo'],
      }),
    )
    expect(r).toBe('openai-responses')
  })

  it('routes a NanoGPT-format model to provider "nanogpt"', () => {
    const r = getServerCompletionProvider(
      makeTarg({
        aiModel: 'nanogpt',
        modelInfo: {
          id: 'nanogpt',
          format: LLMFormat.NanoGPT,
        } as unknown as RequestDataArgumentExtended['modelInfo'],
      }),
    )
    expect(r).toBe('nanogpt')
  })

  it('routes a DeepSeek-style keyIdentifier model into provider "openai" when key + endpoint are set', () => {
    seedDb({
      OaiCompAPIKeys: { deepseek: 'ds-fixture' },
    } as unknown as Partial<Database>)
    const r = getServerCompletionProvider(
      makeTarg({
        aiModel: 'deepseek-chat',
        modelInfo: {
          id: 'deepseek-chat',
          format: LLMFormat.OpenAICompatible,
          endpoint: 'https://api.deepseek.com/beta/chat/completions',
          keyIdentifier: 'deepseek',
        } as unknown as RequestDataArgumentExtended['modelInfo'],
      }),
    )
    expect(r).toBe('openai')
  })

  it('refuses a keyIdentifier model when db.OaiCompAPIKeys lacks the lookup key', () => {
    seedDb({ OaiCompAPIKeys: {} } as unknown as Partial<Database>)
    const r = getServerCompletionProvider(
      makeTarg({
        aiModel: 'deepseek-chat',
        modelInfo: {
          id: 'deepseek-chat',
          format: LLMFormat.OpenAICompatible,
          endpoint: 'https://api.deepseek.com/beta/chat/completions',
          keyIdentifier: 'deepseek',
        } as unknown as RequestDataArgumentExtended['modelInfo'],
      }),
    )
    expect(r).toBeNull()
  })

  it('refuses a keyIdentifier model without a hardcoded endpoint (no baseUrl to derive)', () => {
    seedDb({
      OaiCompAPIKeys: { deepseek: 'ds' },
    } as unknown as Partial<Database>)
    const r = getServerCompletionProvider(
      makeTarg({
        aiModel: 'deepseek-chat',
        modelInfo: {
          id: 'deepseek-chat',
          format: LLMFormat.OpenAICompatible,
          keyIdentifier: 'deepseek',
        } as unknown as RequestDataArgumentExtended['modelInfo'],
      }),
    )
    expect(r).toBeNull()
  })

  it('routes a vanilla GoogleCloud-format model to provider "gemini"', () => {
    const r = getServerCompletionProvider(
      makeTarg({
        aiModel: 'dynamic_google_gemini-2.5-flash',
        modelInfo: {
          id: 'dynamic_google_gemini-2.5-flash',
          internalID: 'gemini-2.5-flash',
          format: LLMFormat.GoogleCloud,
        } as unknown as RequestDataArgumentExtended['modelInfo'],
      }),
    )
    expect(r).toBe('gemini')
  })

  it('routes VertexAIGemini to provider "gemini" when projectId + region + clientEmail + privateKey are populated', () => {
    seedDb({
      google: { projectId: 'my-project', accessToken: '' },
      vertexRegion: 'us-central1',
      vertexClientEmail: 'svc@my-project.iam.gserviceaccount.com',
      vertexPrivateKey: '-----BEGIN PRIVATE KEY-----\nABCD\n-----END PRIVATE KEY-----',
    } as unknown as Partial<Database>)
    const r = getServerCompletionProvider(
      makeTarg({
        aiModel: 'gemini-2.5-pro',
        modelInfo: {
          id: 'gemini-2.5-pro',
          internalID: 'gemini-2.5-pro',
          format: LLMFormat.VertexAIGemini,
        } as unknown as RequestDataArgumentExtended['modelInfo'],
      }),
    )
    expect(r).toBe('gemini')
  })

  it('refuses VertexAIGemini when projectId is empty', () => {
    seedDb({
      google: { projectId: '', accessToken: '' },
      vertexRegion: 'us-central1',
      vertexClientEmail: 'svc@my-project.iam.gserviceaccount.com',
      vertexPrivateKey: '-----BEGIN PRIVATE KEY-----\nABCD\n-----END PRIVATE KEY-----',
    } as unknown as Partial<Database>)
    const r = getServerCompletionProvider(
      makeTarg({
        aiModel: 'gemini-2.5-pro',
        modelInfo: {
          id: 'gemini-2.5-pro',
          format: LLMFormat.VertexAIGemini,
        } as unknown as RequestDataArgumentExtended['modelInfo'],
      }),
    )
    expect(r).toBeNull()
  })

  it('refuses VertexAIGemini when privateKey is empty', () => {
    seedDb({
      google: { projectId: 'my-project', accessToken: '' },
      vertexRegion: 'us-central1',
      vertexClientEmail: 'svc@my-project.iam.gserviceaccount.com',
      vertexPrivateKey: '',
    } as unknown as Partial<Database>)
    const r = getServerCompletionProvider(
      makeTarg({
        aiModel: 'gemini-2.5-pro',
        modelInfo: {
          id: 'gemini-2.5-pro',
          format: LLMFormat.VertexAIGemini,
        } as unknown as RequestDataArgumentExtended['modelInfo'],
      }),
    )
    expect(r).toBeNull()
  })

  it('refuses reverse_proxy under GoogleCloud', () => {
    const r = getServerCompletionProvider(
      makeTarg({
        aiModel: 'reverse_proxy',
        modelInfo: {
          id: 'reverse_proxy',
          format: LLMFormat.GoogleCloud,
        } as unknown as RequestDataArgumentExtended['modelInfo'],
      }),
    )
    expect(r).toBeNull()
  })

  it('routes ollama-cloud + ollamaRequestFormat=OpenAICompatible into provider "openai"', () => {
    seedDb({
      ollamaApiKey: 'oc',
      ollamaRequestFormat: LLMFormat.OpenAICompatible,
    } as unknown as Partial<Database>)
    const r = getServerCompletionProvider(
      makeTarg({
        aiModel: 'ollama-cloud',
        modelInfo: {
          id: 'ollama-cloud',
          format: LLMFormat.Ollama,
        } as unknown as RequestDataArgumentExtended['modelInfo'],
      }),
    )
    expect(r).toBe('openai')
  })

  it('routes ollama-cloud + ollamaRequestFormat=Anthropic into provider "anthropic"', () => {
    seedDb({
      ollamaApiKey: 'oc',
      ollamaRequestFormat: LLMFormat.Anthropic,
    } as unknown as Partial<Database>)
    const r = getServerCompletionProvider(
      makeTarg({
        aiModel: 'ollama-cloud',
        modelInfo: {
          id: 'ollama-cloud',
          format: LLMFormat.Ollama,
        } as unknown as RequestDataArgumentExtended['modelInfo'],
      }),
    )
    expect(r).toBe('anthropic')
  })

  it('refuses ollama-cloud when ollamaApiKey is missing', () => {
    seedDb({
      ollamaRequestFormat: LLMFormat.OpenAICompatible,
    } as unknown as Partial<Database>)
    const r = getServerCompletionProvider(
      makeTarg({
        aiModel: 'ollama-cloud',
        modelInfo: {
          id: 'ollama-cloud',
          format: LLMFormat.Ollama,
        } as unknown as RequestDataArgumentExtended['modelInfo'],
      }),
    )
    expect(r).toBeNull()
  })

  it('routes ollama-hosted (native /api/chat) to provider "ollama" when db.ollamaURL is set', () => {
    seedDb({
      ollamaURL: 'http://localhost:11434',
    } as unknown as Partial<Database>)
    const r = getServerCompletionProvider(
      makeTarg({
        aiModel: 'ollama-hosted',
        modelInfo: {
          id: 'ollama-hosted',
          format: LLMFormat.Ollama,
        } as unknown as RequestDataArgumentExtended['modelInfo'],
      }),
    )
    expect(r).toBe('ollama')
  })

  it('refuses ollama-hosted when db.ollamaURL is empty (no host to talk to)', () => {
    seedDb({ ollamaURL: '' } as unknown as Partial<Database>)
    const r = getServerCompletionProvider(
      makeTarg({
        aiModel: 'ollama-hosted',
        modelInfo: {
          id: 'ollama-hosted',
          format: LLMFormat.Ollama,
        } as unknown as RequestDataArgumentExtended['modelInfo'],
      }),
    )
    expect(r).toBeNull()
  })

  it('refuses an endpoint-only model (no keyIdentifier auth path defined)', () => {
    const r = getServerCompletionProvider(
      makeTarg({
        aiModel: 'foo',
        modelInfo: {
          id: 'foo',
          format: LLMFormat.OpenAICompatible,
          endpoint: 'https://special.example.com/v1/chat/completions',
        } as unknown as RequestDataArgumentExtended['modelInfo'],
      }),
    )
    expect(r).toBeNull()
  })
})

describe('buildProviderOptions (via requestServerCompletion request body)', () => {
  it('emits options.openai with apiKey / maxTokens / temperature for openai', async () => {
    seedDb({ openAIKey: 'sk-from-db' } as unknown as Partial<Database>)
    let captured: { init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = { init }
      return new Response(JSON.stringify({ type: 'success', result: 'pong' }), {
        status: 200,
      })
    })

    const targ = makeTarg({
      aiModel: 'gpt-4o',
      modelInfo: {
        id: 'gpt-4o',
        format: LLMFormat.OpenAICompatible,
      } as unknown as RequestDataArgumentExtended['modelInfo'],
      maxTokens: 256,
      temperature: 0.4,
    })
    await requestServerCompletion(targ, 'openai', null)
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.provider).toBe('openai')
    expect(sent.model).toBe('gpt-4o')
    expect(sent.options.openai).toEqual({
      apiKey: 'sk-from-db',
      maxTokens: 256,
      temperature: 0.4,
    })
  })

  it('emits options.openai.apiKey from db.OaiCompAPIKeys[keyIdentifier] + baseUrl stripped of /chat/completions for DeepSeek', async () => {
    seedDb({
      openAIKey: 'sk-not-used',
      OaiCompAPIKeys: { deepseek: 'ds-fixture-key' },
    } as unknown as Partial<Database>)
    let captured: { init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = { init }
      return new Response(JSON.stringify({ type: 'success', result: 'x' }), { status: 200 })
    })

    const targ = makeTarg({
      aiModel: 'deepseek-chat',
      modelInfo: {
        id: 'deepseek-chat',
        format: LLMFormat.OpenAICompatible,
        endpoint: 'https://api.deepseek.com/beta/chat/completions',
        keyIdentifier: 'deepseek',
      } as unknown as RequestDataArgumentExtended['modelInfo'],
      maxTokens: 128,
    })
    await requestServerCompletion(targ, 'openai', null)
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.options.openai).toEqual({
      apiKey: 'ds-fixture-key',
      baseUrl: 'https://api.deepseek.com/beta',
      maxTokens: 128,
    })
    // The wire-level model field is the original modelInfo.id, unchanged.
    expect(sent.model).toBe('deepseek-chat')
  })

  it('routes reverse_proxy through provider "openai" with proxyKey + autofilled baseUrl + db.additionalParams + ooba hoist', async () => {
    seedDb({
      proxyKey: 'sk-proxy',
      forceReplaceUrl: 'https://proxy.example.com/v1',
      customProxyRequestModel: 'gpt-on-proxy',
      autofillRequestUrl: true,
      reverseProxyOobaMode: true,
      additionalParams: [
        ['header::X-Custom', 'rp-hello'],
        ['extra.knob', '1'],
      ],
    } as unknown as Partial<Database>)
    let captured: { init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = { init }
      return new Response(JSON.stringify({ type: 'success', result: 'x' }), { status: 200 })
    })

    const targ = makeTarg({
      aiModel: 'reverse_proxy',
      modelInfo: {
        id: 'reverse_proxy',
        format: LLMFormat.OpenAICompatible,
      } as unknown as RequestDataArgumentExtended['modelInfo'],
      maxTokens: 256,
    })
    await requestServerCompletion(targ, 'openai', null)
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.provider).toBe('openai')
    expect(sent.model).toBe('gpt-on-proxy')
    expect(sent.options.openai.apiKey).toBe('sk-proxy')
    expect(sent.options.openai.baseUrl).toBe('https://proxy.example.com/v1')
    expect(sent.options.openai.additionalParams).toEqual([
      ['header::X-Custom', 'rp-hello'],
      ['extra.knob', '1'],
    ])
    expect(sent.options.openai.oobaSystemHoist).toBe(true)
    expect(sent.options.openai.extraHeaders).toBeUndefined()
  })

  it('lifts the risu:: prefix off forceReplaceUrl and forwards X-Proxy-Risu header', async () => {
    seedDb({
      proxyKey: 'sk-proxy',
      forceReplaceUrl: 'risu::https://proxy.example.com/v1',
      customProxyRequestModel: 'gpt-on-proxy',
      autofillRequestUrl: false,
      reverseProxyOobaMode: false,
      additionalParams: [],
    } as unknown as Partial<Database>)
    let captured: { init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = { init }
      return new Response(JSON.stringify({ type: 'success', result: 'x' }), { status: 200 })
    })

    const targ = makeTarg({
      aiModel: 'reverse_proxy',
      modelInfo: {
        id: 'reverse_proxy',
        format: LLMFormat.OpenAICompatible,
      } as unknown as RequestDataArgumentExtended['modelInfo'],
    })
    await requestServerCompletion(targ, 'openai', null)
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.options.openai.baseUrl).toBe('https://proxy.example.com/v1')
    expect(sent.options.openai.extraHeaders).toEqual({ 'X-Proxy-Risu': 'RisuAI' })
    expect(sent.options.openai.additionalParams).toBeUndefined()
    expect(sent.options.openai.oobaSystemHoist).toBeUndefined()
  })

  it('autofills a bare reverse_proxy URL (https://host) to the v1 base before stripping /chat/completions', async () => {
    seedDb({
      proxyKey: 'sk-proxy',
      forceReplaceUrl: 'https://proxy.example.com',
      customProxyRequestModel: 'm',
      autofillRequestUrl: true,
      additionalParams: [],
    } as unknown as Partial<Database>)
    let captured: { init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = { init }
      return new Response(JSON.stringify({ type: 'success', result: 'x' }), { status: 200 })
    })

    const targ = makeTarg({
      aiModel: 'reverse_proxy',
      modelInfo: {
        id: 'reverse_proxy',
        format: LLMFormat.OpenAICompatible,
      } as unknown as RequestDataArgumentExtended['modelInfo'],
    })
    await requestServerCompletion(targ, 'openai', null)
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.options.openai.baseUrl).toBe('https://proxy.example.com/v1')
  })

  it('routes xcustom::: through provider "openai" with the entry url/key + parsed additionalParams', async () => {
    seedDb({
      openAIKey: 'sk-not-used',
      customModels: [
        {
          id: 'xcustom:::my-model',
          internalId: 'gpt-on-acme',
          url: 'https://acme.example.com/v1/chat/completions',
          key: 'sk-acme',
          format: LLMFormat.OpenAICompatible,
          params:
            'header::X-Custom=hello\n' +
            'extra.flag=true\n' +
            'extra.count=7\n' +
            'extra.tag="value=with=equals"\n' +
            'extra.payload=json::{"nested": [1, 2]}\n' +
            'temperature={{none}}',
        },
      ],
    } as unknown as Partial<Database>)
    let captured: { init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = { init }
      return new Response(JSON.stringify({ type: 'success', result: 'x' }), { status: 200 })
    })

    const targ = makeTarg({
      aiModel: 'xcustom:::my-model',
      modelInfo: {
        id: 'xcustom:::my-model',
        format: LLMFormat.OpenAICompatible,
      } as unknown as RequestDataArgumentExtended['modelInfo'],
      maxTokens: 128,
      temperature: 0.4,
    })
    await requestServerCompletion(targ, 'openai', null)
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.provider).toBe('openai')
    expect(sent.model).toBe('gpt-on-acme')
    expect(sent.options.openai.apiKey).toBe('sk-acme')
    expect(sent.options.openai.baseUrl).toBe('https://acme.example.com/v1')
    expect(sent.options.openai.additionalParams).toEqual([
      ['header::X-Custom', 'hello'],
      ['extra.flag', 'true'],
      ['extra.count', '7'],
      ['extra.tag', '"value=with=equals"'],
      ['extra.payload', 'json::{"nested": [1, 2]}'],
      ['temperature', '{{none}}'],
    ])
  })

  it('falls back to entry.id when xcustom internalId is empty', async () => {
    seedDb({
      customModels: [
        {
          id: 'xcustom:::no-internal',
          internalId: '',
          url: 'https://example.com/v1/chat/completions',
          key: 'sk-x',
          format: LLMFormat.OpenAICompatible,
          params: '',
        },
      ],
    } as unknown as Partial<Database>)
    let captured: { init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = { init }
      return new Response(JSON.stringify({ type: 'success', result: 'x' }), { status: 200 })
    })

    const targ = makeTarg({
      aiModel: 'xcustom:::no-internal',
      modelInfo: {
        id: 'xcustom:::no-internal',
        format: LLMFormat.OpenAICompatible,
      } as unknown as RequestDataArgumentExtended['modelInfo'],
    })
    await requestServerCompletion(targ, 'openai', null)
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.model).toBe('xcustom:::no-internal')
    expect(sent.options.openai.additionalParams).toBeUndefined()
  })

  it('uses the db.openAIKey path when keyIdentifier is absent (vanilla openai unchanged)', async () => {
    seedDb({
      openAIKey: 'sk-vanilla',
      OaiCompAPIKeys: { deepseek: 'ds' },
    } as unknown as Partial<Database>)
    let captured: { init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = { init }
      return new Response(JSON.stringify({ type: 'success', result: 'x' }), { status: 200 })
    })

    const targ = makeTarg({
      aiModel: 'gpt-4o',
      modelInfo: {
        id: 'gpt-4o',
        format: LLMFormat.OpenAICompatible,
      } as unknown as RequestDataArgumentExtended['modelInfo'],
    })
    await requestServerCompletion(targ, 'openai', null)
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.options.openai.apiKey).toBe('sk-vanilla')
    expect(sent.options.openai.baseUrl).toBeUndefined()
  })

  it('omits maxTokens / temperature from options.openai when targ does not carry them', async () => {
    seedDb({ openAIKey: 'sk-x' } as unknown as Partial<Database>)
    let captured: { init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = { init }
      return new Response(JSON.stringify({ type: 'success', result: 'x' }), {
        status: 200,
      })
    })

    const targ = makeTarg({
      aiModel: 'gpt-4o',
      modelInfo: {
        id: 'gpt-4o',
        format: LLMFormat.OpenAICompatible,
      } as unknown as RequestDataArgumentExtended['modelInfo'],
    })
    await requestServerCompletion(targ, 'openai', null)
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.options.openai).toEqual({ apiKey: 'sk-x' })
  })

  it('emits options.nanogpt and overrides the wire model with db.nanogptRequestModel', async () => {
    seedDb({
      nanogptKey: 'nk-fixture',
      nanogptRequestModel: 'meta-llama/Meta-Llama-3-70B',
      nanogptUseSubscriptionEndpoint: true,
      nanogptProvider: 'meta',
    } as unknown as Partial<Database>)
    let captured: { init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = { init }
      return new Response(JSON.stringify({ type: 'success', result: 'x' }), {
        status: 200,
      })
    })

    const targ = makeTarg({
      aiModel: 'nanogpt',
      modelInfo: {
        id: 'nanogpt',
        format: LLMFormat.NanoGPT,
      } as unknown as RequestDataArgumentExtended['modelInfo'],
      maxTokens: 128,
    })
    await requestServerCompletion(targ, 'nanogpt', null)
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.provider).toBe('nanogpt')
    expect(sent.model).toBe('meta-llama/Meta-Llama-3-70B')
    expect(sent.options.nanogpt).toEqual({
      apiKey: 'nk-fixture',
      useSubscription: true,
      providerHint: 'meta',
      maxTokens: 128,
    })
  })

  it('emits options.anthropic with apiKey + maxTokens; extracts system messages into the system field', async () => {
    seedDb({
      claudeAPIKey: 'sk-ant-fixture',
    } as unknown as Partial<Database>)
    let captured: { init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = { init }
      return new Response(JSON.stringify({ type: 'success', result: 'x' }), {
        status: 200,
      })
    })

    const targ = makeTarg({
      aiModel: 'claude-3-5-sonnet-20241022',
      modelInfo: {
        id: 'claude-3-5-sonnet-20241022',
        format: LLMFormat.Anthropic,
      } as unknown as RequestDataArgumentExtended['modelInfo'],
      maxTokens: 512,
      formated: [
        { role: 'system', content: 'be concise' },
        { role: 'system', content: 'no emoji' },
        { role: 'user', content: 'hi' },
      ],
    })
    await requestServerCompletion(targ, 'anthropic', null)
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.provider).toBe('anthropic')
    expect(sent.model).toBe('claude-3-5-sonnet-20241022')
    expect(sent.messages).toEqual([{ role: 'user', content: 'hi' }])
    expect(sent.options.anthropic).toEqual({
      apiKey: 'sk-ant-fixture',
      maxTokens: 512,
      system: 'be concise\n\nno emoji',
    })
  })

  it('routes reverse_proxy under Anthropic with proxyKey + autofilled baseUrl + db.additionalParams', async () => {
    seedDb({
      proxyKey: 'sk-proxy',
      forceReplaceUrl: 'https://proxy.example.com/v1',
      customProxyRequestModel: 'claude-on-proxy',
      autofillRequestUrl: true,
      additionalParams: [
        ['header::anthropic-beta', 'prompt-caching-2024-07-31'],
        ['extra.knob', '1'],
      ],
    } as unknown as Partial<Database>)
    let captured: { init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = { init }
      return new Response(JSON.stringify({ type: 'success', result: 'x' }), { status: 200 })
    })

    const targ = makeTarg({
      aiModel: 'reverse_proxy',
      modelInfo: {
        id: 'reverse_proxy',
        format: LLMFormat.Anthropic,
      } as unknown as RequestDataArgumentExtended['modelInfo'],
      maxTokens: 512,
      formated: [
        { role: 'system', content: 'be concise' },
        { role: 'user', content: 'hi' },
      ],
    })
    await requestServerCompletion(targ, 'anthropic', null)
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.provider).toBe('anthropic')
    expect(sent.model).toBe('claude-on-proxy')
    expect(sent.messages).toEqual([{ role: 'user', content: 'hi' }])
    expect(sent.options.anthropic.apiKey).toBe('sk-proxy')
    expect(sent.options.anthropic.baseUrl).toBe('https://proxy.example.com/v1')
    expect(sent.options.anthropic.system).toBe('be concise')
    expect(sent.options.anthropic.additionalParams).toEqual([
      ['header::anthropic-beta', 'prompt-caching-2024-07-31'],
      ['extra.knob', '1'],
    ])
  })

  it('autofills a bare reverse_proxy URL (https://host) to the v1 base for Anthropic', async () => {
    seedDb({
      proxyKey: 'sk-proxy',
      forceReplaceUrl: 'https://proxy.example.com',
      customProxyRequestModel: 'claude-on-proxy',
      autofillRequestUrl: true,
      additionalParams: [],
    } as unknown as Partial<Database>)
    let captured: { init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = { init }
      return new Response(JSON.stringify({ type: 'success', result: 'x' }), { status: 200 })
    })

    const targ = makeTarg({
      aiModel: 'reverse_proxy',
      modelInfo: {
        id: 'reverse_proxy',
        format: LLMFormat.Anthropic,
      } as unknown as RequestDataArgumentExtended['modelInfo'],
    })
    await requestServerCompletion(targ, 'anthropic', null)
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.options.anthropic.baseUrl).toBe('https://proxy.example.com/v1')
  })

  it('routes xcustom::: under Anthropic with entry url/key + parsed additionalParams', async () => {
    seedDb({
      claudeAPIKey: 'sk-not-used',
      customModels: [
        {
          id: 'xcustom:::claude-clone',
          internalId: 'claude-acme',
          url: 'https://acme.example.com/v1/messages',
          key: 'sk-acme',
          format: LLMFormat.Anthropic,
          params: 'header::anthropic-beta=cool-beta\nextra.flag=true',
        },
      ],
    } as unknown as Partial<Database>)
    let captured: { init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = { init }
      return new Response(JSON.stringify({ type: 'success', result: 'x' }), { status: 200 })
    })

    const targ = makeTarg({
      aiModel: 'xcustom:::claude-clone',
      modelInfo: {
        id: 'xcustom:::claude-clone',
        format: LLMFormat.Anthropic,
      } as unknown as RequestDataArgumentExtended['modelInfo'],
      maxTokens: 256,
    })
    await requestServerCompletion(targ, 'anthropic', null)
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.provider).toBe('anthropic')
    expect(sent.model).toBe('claude-acme')
    expect(sent.options.anthropic.apiKey).toBe('sk-acme')
    expect(sent.options.anthropic.baseUrl).toBe('https://acme.example.com/v1')
    expect(sent.options.anthropic.additionalParams).toEqual([
      ['header::anthropic-beta', 'cool-beta'],
      ['extra.flag', 'true'],
    ])
  })

  it('emits options.mistral with proxyKey + autofilled baseUrl + additionalParams for reverse_proxy under Mistral', async () => {
    seedDb({
      proxyKey: 'sk-proxy',
      forceReplaceUrl: 'https://proxy.example.com/v1',
      customProxyRequestModel: 'mistral-on-proxy',
      autofillRequestUrl: true,
      additionalParams: [
        ['header::X-Custom', 'cool'],
        ['extra.knob', '1'],
      ],
    } as unknown as Partial<Database>)
    let captured: { init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = { init }
      return new Response(JSON.stringify({ type: 'success', result: 'x' }), { status: 200 })
    })

    const targ = makeTarg({
      aiModel: 'reverse_proxy',
      modelInfo: {
        id: 'reverse_proxy',
        format: LLMFormat.Mistral,
      } as unknown as RequestDataArgumentExtended['modelInfo'],
      maxTokens: 512,
    })
    await requestServerCompletion(targ, 'mistral', null)
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.provider).toBe('mistral')
    expect(sent.model).toBe('mistral-on-proxy')
    expect(sent.options.mistral.apiKey).toBe('sk-proxy')
    expect(sent.options.mistral.baseUrl).toBe('https://proxy.example.com/v1')
    expect(sent.options.mistral.additionalParams).toEqual([
      ['header::X-Custom', 'cool'],
      ['extra.knob', '1'],
    ])
  })

  it('lifts a risu:: prefix into options.mistral.extraHeaders for reverse_proxy under Mistral', async () => {
    seedDb({
      proxyKey: 'sk-proxy',
      forceReplaceUrl: 'risu::https://proxy.example.com/v1',
      customProxyRequestModel: 'mistral-on-proxy',
      autofillRequestUrl: true,
    } as unknown as Partial<Database>)
    let captured: { init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = { init }
      return new Response(JSON.stringify({ type: 'success', result: 'x' }), { status: 200 })
    })

    const targ = makeTarg({
      aiModel: 'reverse_proxy',
      modelInfo: {
        id: 'reverse_proxy',
        format: LLMFormat.Mistral,
      } as unknown as RequestDataArgumentExtended['modelInfo'],
    })
    await requestServerCompletion(targ, 'mistral', null)
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.options.mistral.baseUrl).toBe('https://proxy.example.com/v1')
    expect(sent.options.mistral.extraHeaders).toEqual({ 'X-Proxy-Risu': 'RisuAI' })
  })

  it('routes xcustom::: under Mistral with entry url/key + parsed additionalParams', async () => {
    seedDb({
      mistralKey: 'mk-not-used',
      customModels: [
        {
          id: 'xcustom:::mistral-clone',
          internalId: 'mistral-acme',
          url: 'https://acme.example.com/v1/chat/completions',
          key: 'sk-acme',
          format: LLMFormat.Mistral,
          params: 'header::X-Custom=cool\nextra.flag=true',
        },
      ],
    } as unknown as Partial<Database>)
    let captured: { init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = { init }
      return new Response(JSON.stringify({ type: 'success', result: 'x' }), { status: 200 })
    })

    const targ = makeTarg({
      aiModel: 'xcustom:::mistral-clone',
      modelInfo: {
        id: 'xcustom:::mistral-clone',
        format: LLMFormat.Mistral,
      } as unknown as RequestDataArgumentExtended['modelInfo'],
      maxTokens: 256,
    })
    await requestServerCompletion(targ, 'mistral', null)
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.provider).toBe('mistral')
    expect(sent.model).toBe('mistral-acme')
    expect(sent.options.mistral.apiKey).toBe('sk-acme')
    expect(sent.options.mistral.baseUrl).toBe('https://acme.example.com/v1')
    expect(sent.options.mistral.additionalParams).toEqual([
      ['header::X-Custom', 'cool'],
      ['extra.flag', 'true'],
    ])
  })

  it('emits options.mistral with apiKey + maxTokens + temperature; reformat is NOT done client-side', async () => {
    seedDb({ mistralKey: 'mk-fixture' } as unknown as Partial<Database>)
    let captured: { init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = { init }
      return new Response(JSON.stringify({ type: 'success', result: 'x' }), {
        status: 200,
      })
    })

    const targ = makeTarg({
      aiModel: 'mistral-large-latest',
      modelInfo: {
        id: 'mistral-large-latest',
        format: LLMFormat.Mistral,
      } as unknown as RequestDataArgumentExtended['modelInfo'],
      maxTokens: 256,
      temperature: 0.4,
      // Two consecutive user turns: the SPA payload still carries them as
      // separate rows. The server-side dispatcher is what coalesces them.
      formated: [
        { role: 'user', content: 'a' },
        { role: 'user', content: 'b' },
      ],
    })
    await requestServerCompletion(targ, 'mistral', null)
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.provider).toBe('mistral')
    expect(sent.model).toBe('mistral-large-latest')
    expect(sent.options.mistral).toEqual({
      apiKey: 'mk-fixture',
      maxTokens: 256,
      temperature: 0.4,
    })
    expect(sent.messages).toEqual([
      { role: 'user', content: 'a' },
      { role: 'user', content: 'b' },
    ])
  })

  it('omits maxTokens / temperature from options.mistral when targ does not carry them', async () => {
    seedDb({ mistralKey: 'mk-x' } as unknown as Partial<Database>)
    let captured: { init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = { init }
      return new Response(JSON.stringify({ type: 'success', result: 'x' }), {
        status: 200,
      })
    })

    const targ = makeTarg({
      aiModel: 'mistral-large-latest',
      modelInfo: {
        id: 'mistral-large-latest',
        format: LLMFormat.Mistral,
      } as unknown as RequestDataArgumentExtended['modelInfo'],
    })
    await requestServerCompletion(targ, 'mistral', null)
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.options.mistral).toEqual({ apiKey: 'mk-x' })
  })

  it('emits options.cohere with apiKey + safetyMode=NONE for older command-r variants', async () => {
    seedDb({ cohereAPIKey: 'co-fixture' } as unknown as Partial<Database>)
    let captured: { init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = { init }
      return new Response(JSON.stringify({ type: 'success', result: 'x' }), { status: 200 })
    })

    const targ = makeTarg({
      aiModel: 'cohere-command-r',
      modelInfo: {
        id: 'cohere-command-r',
        format: LLMFormat.Cohere,
      } as unknown as RequestDataArgumentExtended['modelInfo'],
    })
    await requestServerCompletion(targ, 'cohere', null)
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.options.cohere).toEqual({
      apiKey: 'co-fixture',
      safetyMode: 'NONE',
    })
  })

  it('omits safetyMode for the newer command-r-03-2024 / command-r-plus-04-2024 releases', async () => {
    seedDb({ cohereAPIKey: 'co-fixture' } as unknown as Partial<Database>)
    let captured: { init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = { init }
      return new Response(JSON.stringify({ type: 'success', result: 'x' }), { status: 200 })
    })

    const targ = makeTarg({
      aiModel: 'cohere-command-r-plus-04-2024',
      modelInfo: {
        id: 'cohere-command-r-plus-04-2024',
        format: LLMFormat.Cohere,
      } as unknown as RequestDataArgumentExtended['modelInfo'],
    })
    await requestServerCompletion(targ, 'cohere', null)
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.options.cohere).toEqual({ apiKey: 'co-fixture' })
  })

  it('emits options.cohere with proxyKey + autofilled baseUrl + additionalParams for reverse_proxy under Cohere', async () => {
    seedDb({
      proxyKey: 'sk-proxy',
      forceReplaceUrl: 'https://proxy.example.com/v1',
      customProxyRequestModel: 'command-on-proxy',
      autofillRequestUrl: true,
      additionalParams: [
        ['header::X-Custom', 'cool'],
        ['extra.knob', '1'],
      ],
    } as unknown as Partial<Database>)
    let captured: { init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = { init }
      return new Response(JSON.stringify({ type: 'success', result: 'x' }), { status: 200 })
    })

    const targ = makeTarg({
      aiModel: 'reverse_proxy',
      modelInfo: {
        id: 'reverse_proxy',
        format: LLMFormat.Cohere,
      } as unknown as RequestDataArgumentExtended['modelInfo'],
    })
    await requestServerCompletion(targ, 'cohere', null)
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.provider).toBe('cohere')
    expect(sent.options.cohere.apiKey).toBe('sk-proxy')
    expect(sent.options.cohere.baseUrl).toBe('https://proxy.example.com/v1')
    // safetyMode='NONE' is the older-variant default; reverse_proxy aiModel
    // doesn't match the two newer command-r releases, so this stays on.
    expect(sent.options.cohere.safetyMode).toBe('NONE')
    expect(sent.options.cohere.additionalParams).toEqual([
      ['header::X-Custom', 'cool'],
      ['extra.knob', '1'],
    ])
  })

  it('routes xcustom::: under Cohere with entry url/key + parsed additionalParams', async () => {
    seedDb({
      cohereAPIKey: 'co-not-used',
      customModels: [
        {
          id: 'xcustom:::cohere-clone',
          internalId: 'command-acme',
          url: 'https://acme.example.com/v1/chat',
          key: 'sk-acme',
          format: LLMFormat.Cohere,
          params: 'header::X-Custom=cool\nextra.flag=true',
        },
      ],
    } as unknown as Partial<Database>)
    let captured: { init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = { init }
      return new Response(JSON.stringify({ type: 'success', result: 'x' }), { status: 200 })
    })

    const targ = makeTarg({
      aiModel: 'xcustom:::cohere-clone',
      modelInfo: {
        id: 'xcustom:::cohere-clone',
        format: LLMFormat.Cohere,
      } as unknown as RequestDataArgumentExtended['modelInfo'],
    })
    await requestServerCompletion(targ, 'cohere', null)
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.provider).toBe('cohere')
    expect(sent.options.cohere.apiKey).toBe('sk-acme')
    expect(sent.options.cohere.baseUrl).toBe('https://acme.example.com/v1')
    expect(sent.options.cohere.additionalParams).toEqual([
      ['header::X-Custom', 'cool'],
      ['extra.flag', 'true'],
    ])
  })

  it('emits options["openai-responses"] with proxyKey + autofilled baseUrl + additionalParams for reverse_proxy under OpenAIResponseAPI', async () => {
    seedDb({
      proxyKey: 'sk-proxy',
      forceReplaceUrl: 'https://proxy.example.com/v1',
      customProxyRequestModel: 'gpt-on-proxy',
      autofillRequestUrl: true,
      additionalParams: [
        ['header::X-Custom', 'cool'],
        ['extra.knob', '1'],
      ],
    } as unknown as Partial<Database>)
    let captured: { init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = { init }
      return new Response(JSON.stringify({ type: 'success', result: 'x' }), { status: 200 })
    })

    const targ = makeTarg({
      aiModel: 'reverse_proxy',
      modelInfo: {
        id: 'reverse_proxy',
        format: LLMFormat.OpenAIResponseAPI,
      } as unknown as RequestDataArgumentExtended['modelInfo'],
      maxTokens: 512,
    })
    await requestServerCompletion(targ, 'openai-responses', null)
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.provider).toBe('openai-responses')
    expect(sent.model).toBe('gpt-on-proxy')
    expect(sent.options['openai-responses'].apiKey).toBe('sk-proxy')
    expect(sent.options['openai-responses'].baseUrl).toBe('https://proxy.example.com/v1')
    expect(sent.options['openai-responses'].additionalParams).toEqual([
      ['header::X-Custom', 'cool'],
      ['extra.knob', '1'],
    ])
  })

  it('routes xcustom::: under OpenAIResponseAPI with entry url/key + parsed additionalParams', async () => {
    seedDb({
      openAIKey: 'sk-not-used',
      customModels: [
        {
          id: 'xcustom:::resp-clone',
          internalId: 'gpt-acme-responses',
          url: 'https://acme.example.com/v1/responses',
          key: 'sk-acme',
          format: LLMFormat.OpenAIResponseAPI,
          params: 'header::X-Custom=cool\nextra.flag=true',
        },
      ],
    } as unknown as Partial<Database>)
    let captured: { init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = { init }
      return new Response(JSON.stringify({ type: 'success', result: 'x' }), { status: 200 })
    })

    const targ = makeTarg({
      aiModel: 'xcustom:::resp-clone',
      modelInfo: {
        id: 'xcustom:::resp-clone',
        format: LLMFormat.OpenAIResponseAPI,
      } as unknown as RequestDataArgumentExtended['modelInfo'],
    })
    await requestServerCompletion(targ, 'openai-responses', null)
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.provider).toBe('openai-responses')
    expect(sent.model).toBe('gpt-acme-responses')
    expect(sent.options['openai-responses'].apiKey).toBe('sk-acme')
    expect(sent.options['openai-responses'].baseUrl).toBe('https://acme.example.com/v1')
    expect(sent.options['openai-responses'].additionalParams).toEqual([
      ['header::X-Custom', 'cool'],
      ['extra.flag', 'true'],
    ])
  })

  it('emits options.horde.prompt flattened via applyChatTemplate; wire model is the part after horde:::', async () => {
    seedDb({
      instructChatTemplate: 'chatml',
      hordeConfig: { apiKey: 'horde-secret-key', model: '', softPrompt: '' },
      maxContext: 4000,
      top_p: 0.9,
      top_k: 40,
      characters: [{ name: 'Char' } as never],
    } as unknown as Partial<Database>)
    selectedCharID.set(0)
    let captured: { init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = { init }
      return new Response(JSON.stringify({ type: 'success', result: 'x' }), { status: 200 })
    })

    const targ = makeTarg({
      aiModel: 'horde:::koboldcpp/Mistral-7B',
      modelInfo: {
        id: 'horde:::koboldcpp/Mistral-7B',
        format: LLMFormat.Horde,
      } as unknown as RequestDataArgumentExtended['modelInfo'],
      maxTokens: 256,
      temperature: 0.7,
      formated: [
        { role: 'user', content: 'hello' },
      ] as unknown as RequestDataArgumentExtended['formated'],
    })
    await requestServerCompletion(targ, 'horde', null)
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.provider).toBe('horde')
    expect(sent.model).toBe('koboldcpp/Mistral-7B')
    // chatml template wraps each turn in <|im_start|>{role}\n{content}<|im_end|>
    // and appends the assistant generation prompt at the end.
    expect(sent.options.horde.prompt).toContain('<|im_start|>user')
    expect(sent.options.horde.prompt).toContain('hello')
    expect(sent.options.horde.prompt).toContain('<|im_start|>assistant')
    expect(sent.options.horde.apiKey).toBe('horde-secret-key')
    expect(sent.options.horde.maxTokens).toBe(256)
    // db.maxContext + 100 mirrors the local code at request.ts:1442.
    expect(sent.options.horde.maxContextLength).toBe(4100)
    expect(sent.options.horde.temperature).toBe(0.7)
    expect(sent.options.horde.topP).toBe(0.9)
    expect(sent.options.horde.topK).toBe(40)
  })

  it('omits options.horde.apiKey for short / empty keys (anonymous Horde uses 0000000000)', async () => {
    seedDb({
      instructChatTemplate: 'chatml',
      hordeConfig: { apiKey: '', model: '', softPrompt: '' },
      characters: [{ name: 'Char' } as never],
    } as unknown as Partial<Database>)
    selectedCharID.set(0)
    let captured: { init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = { init }
      return new Response(JSON.stringify({ type: 'success', result: 'x' }), { status: 200 })
    })

    const targ = makeTarg({
      aiModel: 'horde:::auto',
      modelInfo: {
        id: 'horde:::auto',
        format: LLMFormat.Horde,
      } as unknown as RequestDataArgumentExtended['modelInfo'],
    })
    await requestServerCompletion(targ, 'horde', null)
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.options.horde.apiKey).toBeUndefined()
  })

  it('emits options.bedrock with parsed credentials + extracts system message; wire model gets us./global. prefix', async () => {
    seedDb({
      claudeAPIKey: 'AKIA:secret:us-east-1',
    } as unknown as Partial<Database>)
    let captured: { init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = { init }
      return new Response(JSON.stringify({ type: 'success', result: 'x' }), { status: 200 })
    })

    const targ = makeTarg({
      aiModel: 'claude-3-5-sonnet-bedrock',
      modelInfo: {
        id: 'claude-3-5-sonnet-bedrock',
        // Date stamp < 20250929 → `us.` prefix per the SPA's heuristic.
        internalID: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
        format: LLMFormat.AWSBedrockClaude,
      } as unknown as RequestDataArgumentExtended['modelInfo'],
      maxTokens: 512,
      formated: [
        { role: 'system', content: 'be brief' },
        { role: 'user', content: 'hi' },
      ],
    })
    await requestServerCompletion(targ, 'bedrock', null)
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.provider).toBe('bedrock')
    expect(sent.model).toBe('us.anthropic.claude-3-5-sonnet-20241022-v2:0')
    expect(sent.messages).toEqual([{ role: 'user', content: 'hi' }])
    expect(sent.options.bedrock.credentials).toEqual({
      accessKeyId: 'AKIA',
      secretAccessKey: 'secret',
      region: 'us-east-1',
    })
    expect(sent.options.bedrock.maxTokens).toBe(512)
    expect(sent.options.bedrock.system).toBe('be brief')
  })

  it('uses the global. prefix for claude 4.5+ Bedrock models', async () => {
    seedDb({
      claudeAPIKey: 'AKIA:secret:us-east-1',
    } as unknown as Partial<Database>)
    let captured: { init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = { init }
      return new Response(JSON.stringify({ type: 'success', result: 'x' }), { status: 200 })
    })

    const targ = makeTarg({
      aiModel: 'claude-sonnet-4-5',
      modelInfo: {
        id: 'claude-sonnet-4-5',
        internalID: 'anthropic.claude-sonnet-4-5-v1:0',
        format: LLMFormat.AWSBedrockClaude,
      } as unknown as RequestDataArgumentExtended['modelInfo'],
    })
    await requestServerCompletion(targ, 'bedrock', null)
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.model).toBe('global.anthropic.claude-sonnet-4-5-v1:0')
  })

  it('uses the global. prefix when the Bedrock internalID date stamp is >= 20250929', async () => {
    seedDb({
      claudeAPIKey: 'AKIA:secret:us-east-1',
    } as unknown as Partial<Database>)
    let captured: { init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = { init }
      return new Response(JSON.stringify({ type: 'success', result: 'x' }), { status: 200 })
    })

    const targ = makeTarg({
      aiModel: 'claude-future',
      modelInfo: {
        id: 'claude-future',
        internalID: 'anthropic.claude-future-20251001-v1:0',
        format: LLMFormat.AWSBedrockClaude,
      } as unknown as RequestDataArgumentExtended['modelInfo'],
    })
    await requestServerCompletion(targ, 'bedrock', null)
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.model).toBe('global.anthropic.claude-future-20251001-v1:0')
  })

  it('emits options.gemini with apiKey from db.google.accessToken; wire model uses internalID (stripped of models/ prefix)', async () => {
    seedDb({
      google: { accessToken: 'goog-fixture' },
    } as unknown as Partial<Database>)
    let captured: { init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = { init }
      return new Response(JSON.stringify({ type: 'success', result: 'x' }), { status: 200 })
    })

    const targ = makeTarg({
      aiModel: 'dynamic_google_gemini-2.5-flash',
      modelInfo: {
        id: 'dynamic_google_gemini-2.5-flash',
        // Dynamic-registered Gemini entries store the upstream API's
        // `name: 'models/<id>'` here; the wire URL is /models/<id> so the
        // adapter must strip the leading `models/` to avoid doubling it.
        internalID: 'models/gemini-2.5-flash',
        format: LLMFormat.GoogleCloud,
      } as unknown as RequestDataArgumentExtended['modelInfo'],
      maxTokens: 200,
      temperature: 0.5,
    })
    await requestServerCompletion(targ, 'gemini', null)
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.provider).toBe('gemini')
    expect(sent.model).toBe('gemini-2.5-flash')
    expect(sent.options.gemini).toEqual({
      apiKey: 'goog-fixture',
      maxOutputTokens: 200,
      temperature: 0.5,
    })
  })

  it('emits options.gemini.vertex (instead of apiKey) when modelInfo.format is VertexAIGemini', async () => {
    seedDb({
      google: { projectId: 'my-project', accessToken: 'should-not-be-used' },
      vertexRegion: 'us-central1',
      vertexClientEmail: 'svc@my-project.iam.gserviceaccount.com',
      vertexPrivateKey: '-----BEGIN PRIVATE KEY-----\nXXXX\n-----END PRIVATE KEY-----',
    } as unknown as Partial<Database>)
    let captured: { init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = { init }
      return new Response(JSON.stringify({ type: 'success', result: 'x' }), { status: 200 })
    })

    const targ = makeTarg({
      aiModel: 'gemini-2.5-pro',
      modelInfo: {
        id: 'gemini-2.5-pro',
        internalID: 'gemini-2.5-pro',
        format: LLMFormat.VertexAIGemini,
      } as unknown as RequestDataArgumentExtended['modelInfo'],
      maxTokens: 200,
      temperature: 0.5,
    })
    await requestServerCompletion(targ, 'gemini', null)
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.provider).toBe('gemini')
    expect(sent.model).toBe('gemini-2.5-pro')
    expect(sent.options.gemini.apiKey).toBeUndefined()
    expect(sent.options.gemini.vertex).toEqual({
      projectId: 'my-project',
      region: 'us-central1',
      clientEmail: 'svc@my-project.iam.gserviceaccount.com',
      privateKey: '-----BEGIN PRIVATE KEY-----\nXXXX\n-----END PRIVATE KEY-----',
    })
    expect(sent.options.gemini.maxOutputTokens).toBe(200)
    expect(sent.options.gemini.temperature).toBe(0.5)
  })

  it('falls back to modelInfo.id for the wire model when internalID is missing', async () => {
    seedDb({ google: { accessToken: 'k' } } as unknown as Partial<Database>)
    let captured: { init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = { init }
      return new Response(JSON.stringify({ type: 'success', result: 'x' }), { status: 200 })
    })

    const targ = makeTarg({
      aiModel: 'gemini-2.5-pro',
      modelInfo: {
        id: 'gemini-2.5-pro',
        format: LLMFormat.GoogleCloud,
      } as unknown as RequestDataArgumentExtended['modelInfo'],
    })
    await requestServerCompletion(targ, 'gemini', null)
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.model).toBe('gemini-2.5-pro')
  })

  it('emits options.openai-legacy-instruct.apiKey from db.openAIKey and a hardcoded model', async () => {
    seedDb({ openAIKey: 'sk-legacy' } as unknown as Partial<Database>)
    let captured: { init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = { init }
      return new Response(JSON.stringify({ type: 'success', result: 'x' }), { status: 200 })
    })

    const targ = makeTarg({
      aiModel: 'gpt-3.5-turbo-instruct',
      modelInfo: {
        id: 'gpt-3.5-turbo-instruct',
        format: LLMFormat.OpenAILegacyInstruct,
      } as unknown as RequestDataArgumentExtended['modelInfo'],
      maxTokens: 128,
    })
    await requestServerCompletion(targ, 'openai-legacy-instruct', null)
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.provider).toBe('openai-legacy-instruct')
    expect(sent.model).toBe('gpt-3.5-turbo-instruct')
    expect(sent.options['openai-legacy-instruct']).toEqual({
      apiKey: 'sk-legacy',
      maxTokens: 128,
    })
  })

  it('emits options["openai-legacy-instruct"] with proxyKey + autofilled baseUrl + additionalParams for reverse_proxy under OpenAILegacyInstruct', async () => {
    seedDb({
      proxyKey: 'sk-proxy',
      forceReplaceUrl: 'https://proxy.example.com/v1',
      customProxyRequestModel: 'gpt-on-proxy',
      autofillRequestUrl: true,
      additionalParams: [
        ['header::X-Custom', 'cool'],
        ['extra.knob', '1'],
      ],
    } as unknown as Partial<Database>)
    let captured: { init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = { init }
      return new Response(JSON.stringify({ type: 'success', result: 'x' }), { status: 200 })
    })

    const targ = makeTarg({
      aiModel: 'reverse_proxy',
      modelInfo: {
        id: 'reverse_proxy',
        format: LLMFormat.OpenAILegacyInstruct,
      } as unknown as RequestDataArgumentExtended['modelInfo'],
      maxTokens: 256,
    })
    await requestServerCompletion(targ, 'openai-legacy-instruct', null)
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.provider).toBe('openai-legacy-instruct')
    expect(sent.model).toBe('gpt-on-proxy')
    expect(sent.options['openai-legacy-instruct'].apiKey).toBe('sk-proxy')
    expect(sent.options['openai-legacy-instruct'].baseUrl).toBe('https://proxy.example.com/v1')
    expect(sent.options['openai-legacy-instruct'].additionalParams).toEqual([
      ['header::X-Custom', 'cool'],
      ['extra.knob', '1'],
    ])
  })

  it('routes xcustom::: under OpenAILegacyInstruct with entry url/key + parsed additionalParams', async () => {
    seedDb({
      openAIKey: 'sk-not-used',
      customModels: [
        {
          id: 'xcustom:::legacy-clone',
          internalId: 'gpt-acme-instruct',
          url: 'https://acme.example.com/v1/completions',
          key: 'sk-acme',
          format: LLMFormat.OpenAILegacyInstruct,
          params: 'header::X-Custom=cool\nextra.flag=true',
        },
      ],
    } as unknown as Partial<Database>)
    let captured: { init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = { init }
      return new Response(JSON.stringify({ type: 'success', result: 'x' }), { status: 200 })
    })

    const targ = makeTarg({
      aiModel: 'xcustom:::legacy-clone',
      modelInfo: {
        id: 'xcustom:::legacy-clone',
        format: LLMFormat.OpenAILegacyInstruct,
      } as unknown as RequestDataArgumentExtended['modelInfo'],
    })
    await requestServerCompletion(targ, 'openai-legacy-instruct', null)
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.provider).toBe('openai-legacy-instruct')
    expect(sent.model).toBe('gpt-acme-instruct')
    expect(sent.options['openai-legacy-instruct'].apiKey).toBe('sk-acme')
    expect(sent.options['openai-legacy-instruct'].baseUrl).toBe('https://acme.example.com/v1')
    expect(sent.options['openai-legacy-instruct'].additionalParams).toEqual([
      ['header::X-Custom', 'cool'],
      ['extra.flag', 'true'],
    ])
  })

  it('routes NanoGPTMessages through provider=anthropic with nano-gpt.com baseUrl + nanogpt key + db.nanogptRequestModel', async () => {
    seedDb({
      nanogptKey: 'nk',
      nanogptRequestModel: 'anthropic/claude-3.5-sonnet',
    } as unknown as Partial<Database>)
    let captured: { init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = { init }
      return new Response(JSON.stringify({ type: 'success', result: 'x' }), { status: 200 })
    })

    const targ = makeTarg({
      aiModel: 'nanogpt-messages',
      modelInfo: {
        id: 'nanogpt-messages',
        format: LLMFormat.NanoGPTMessages,
      } as unknown as RequestDataArgumentExtended['modelInfo'],
    })
    await requestServerCompletion(targ, 'anthropic', null)
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.model).toBe('anthropic/claude-3.5-sonnet')
    expect(sent.options.anthropic.apiKey).toBe('nk')
    expect(sent.options.anthropic.baseUrl).toBe('https://nano-gpt.com/api/v1')
  })

  it('routes NanoGPTLegacy through openai-legacy-instruct with nano-gpt.com baseUrl + nanogpt key + X-Provider', async () => {
    seedDb({
      nanogptKey: 'nk',
      nanogptRequestModel: 'meta-llama/foo',
      nanogptProvider: 'meta',
    } as unknown as Partial<Database>)
    let captured: { init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = { init }
      return new Response(JSON.stringify({ type: 'success', result: 'x' }), { status: 200 })
    })

    const targ = makeTarg({
      aiModel: 'nanogpt-legacy',
      modelInfo: {
        id: 'nanogpt-legacy',
        format: LLMFormat.NanoGPTLegacy,
      } as unknown as RequestDataArgumentExtended['modelInfo'],
    })
    await requestServerCompletion(targ, 'openai-legacy-instruct', null)
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.model).toBe('meta-llama/foo')
    expect(sent.options['openai-legacy-instruct']).toEqual({
      apiKey: 'nk',
      baseUrl: 'https://nano-gpt.com/api/v1',
      extraHeaders: { 'X-Provider': 'meta' },
    })
  })

  it('emits options.ollama with db.ollamaURL + db.ollamaModel as the wire model for native ollama', async () => {
    seedDb({
      ollamaURL: 'http://localhost:11434',
      ollamaModel: 'llama3.1:70b',
    } as unknown as Partial<Database>)
    let captured: { init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = { init }
      return new Response(JSON.stringify({ type: 'success', result: 'x' }), {
        status: 200,
      })
    })

    const targ = makeTarg({
      aiModel: 'ollama-hosted',
      modelInfo: {
        id: 'ollama-hosted',
        format: LLMFormat.Ollama,
      } as unknown as RequestDataArgumentExtended['modelInfo'],
      maxTokens: 128,
      temperature: 0.5,
    })
    await requestServerCompletion(targ, 'ollama', null)
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.provider).toBe('ollama')
    expect(sent.model).toBe('llama3.1:70b')
    expect(sent.options.ollama).toEqual({
      baseUrl: 'http://localhost:11434',
      maxTokens: 128,
      temperature: 0.5,
    })
  })

  it('emits options.openrouter and overrides the wire model with db.openrouterRequestModel', async () => {
    seedDb({
      openrouterKey: 'or-fixture',
      openrouterRequestModel: 'anthropic/claude-3.5-sonnet',
    } as unknown as Partial<Database>)
    let captured: { init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = { init }
      return new Response(JSON.stringify({ type: 'success', result: 'x' }), {
        status: 200,
      })
    })

    const targ = makeTarg({
      aiModel: 'openrouter',
      modelInfo: {
        id: 'openrouter',
        format: LLMFormat.OpenAICompatible,
      } as unknown as RequestDataArgumentExtended['modelInfo'],
      temperature: 0.7,
    })
    await requestServerCompletion(targ, 'openrouter', null)
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.provider).toBe('openrouter')
    expect(sent.model).toBe('anthropic/claude-3.5-sonnet')
    expect(sent.options.openrouter).toEqual({
      apiKey: 'or-fixture',
      temperature: 0.7,
    })
  })
})

describe('requestServerCompletion - non-streaming', () => {
  it('posts the right body + headers and returns success result', async () => {
    let captured: { url: string; init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      captured = { url, init }
      return new Response(JSON.stringify({ type: 'success', result: 'pong' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })

    const r = await requestServerCompletion(makeTarg(), 'echo', null)
    expect(r).toEqual({ type: 'success', result: 'pong' })

    expect(captured!.url).toBe('/api/v1/generate/completion')
    expect((captured!.init.headers as Record<string, string>)['risu-auth']).toBe('test-auth-token')
    expect((captured!.init.headers as Record<string, string>)['content-type']).toBe(
      'application/json',
    )
    const sent = JSON.parse(captured!.init.body as string) as {
      provider: string
      model: string
      stream: boolean
      messages: unknown[]
      options: { echo: { message: string; delayMs: number } }
    }
    expect(sent.provider).toBe('echo')
    expect(sent.model).toBe('echo_model')
    expect(sent.stream).toBe(false)
    expect(sent.messages).toEqual([{ role: 'user', content: 'hi' }])
    expect(sent.options.echo).toEqual({ message: 'Echo Message', delayMs: 0 })
  })

  it('multiplies db.echoDelay (seconds) into delayMs (milliseconds)', async () => {
    seedDb({ echoDelay: 2, echoMessage: 'pong' })
    let captured: { init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = { init }
      return new Response(JSON.stringify({ type: 'success', result: 'pong' }), {
        status: 200,
      })
    })

    await requestServerCompletion(makeTarg(), 'echo', null)
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.options.echo).toEqual({ message: 'pong', delayMs: 2000 })
  })

  it('returns fail when the server returns {type: "fail"}', async () => {
    vi.stubGlobal('fetch', async () => {
      return new Response(JSON.stringify({ type: 'fail', result: 'upstream broke' }), {
        status: 200,
      })
    })
    const r = await requestServerCompletion(makeTarg(), 'echo', null)
    expect(r).toEqual({ type: 'fail', result: 'upstream broke' })
  })

  it('extracts `reason` from a non-2xx JSON body', async () => {
    vi.stubGlobal('fetch', async () => {
      return new Response(
        JSON.stringify({
          reason: 'provider not implemented in Phase 6-1: openai',
        }),
        { status: 501 },
      )
    })
    const r = await requestServerCompletion(makeTarg(), 'openai', null)
    expect(r).toEqual({
      type: 'fail',
      result: 'provider not implemented in Phase 6-1: openai',
    })
  })

  it('extracts `error` from a non-2xx JSON body', async () => {
    vi.stubGlobal('fetch', async () => {
      return new Response(JSON.stringify({ error: 'Auth required' }), {
        status: 401,
      })
    })
    const r = await requestServerCompletion(makeTarg(), 'echo', null)
    expect(r).toEqual({ type: 'fail', result: 'Auth required' })
  })

  it('returns "Network error: ..." when fetch throws', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('connection refused')
    })
    const r = await requestServerCompletion(makeTarg(), 'echo', null)
    expect(r.type).toBe('fail')
    expect((r as { result: string }).result).toContain('Network error')
    expect((r as { result: string }).result).toContain('connection refused')
  })

  it('returns "Aborted" when the signal is aborted before fetch resolves', async () => {
    const c = new AbortController()
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      const sig = init.signal
      throw Object.assign(new Error('aborted'), {
        name: sig?.aborted ? 'AbortError' : 'Error',
      })
    })
    c.abort()
    const r = await requestServerCompletion(makeTarg(), 'echo', c.signal)
    expect(r).toEqual({ type: 'fail', result: 'Aborted' })
  })
})

function makeSseResponse(chunks: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder()
      for (const c of chunks) controller.enqueue(enc.encode(c))
      controller.close()
    },
  })
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

describe('requestServerCompletion - streaming', () => {
  it('parses a single token frame + done into a success result', async () => {
    vi.stubGlobal('fetch', async () => {
      return makeSseResponse([
        `event: chunk\ndata: ${JSON.stringify({ type: 'token', content: 'hello' })}\n\n`,
        `event: done\ndata: ${JSON.stringify({ finishReason: 'stop' })}\n\n`,
      ])
    })
    const r = await requestServerCompletion(makeTarg({ useStreaming: true }), 'echo', null)
    expect(r).toEqual({ type: 'success', result: 'hello' })
  })

  it('concatenates content across multiple chunk frames', async () => {
    vi.stubGlobal('fetch', async () => {
      return makeSseResponse([
        `event: chunk\ndata: ${JSON.stringify({ type: 'token', content: 'foo ' })}\n\n`,
        `event: chunk\ndata: ${JSON.stringify({ type: 'token', content: 'bar' })}\n\n`,
        `event: done\ndata: ${JSON.stringify({ finishReason: 'stop' })}\n\n`,
      ])
    })
    const r = await requestServerCompletion(makeTarg({ useStreaming: true }), 'echo', null)
    expect(r).toEqual({ type: 'success', result: 'foo bar' })
  })

  it('parses events even when a single chunk contains a partial frame', async () => {
    vi.stubGlobal('fetch', async () => {
      return makeSseResponse([
        `event: chunk\ndata: ${JSON.stringify({ type: 'token', content: 'foo' })}`,
        `\n\nevent: chunk\ndata: ${JSON.stringify({ type: 'token', content: 'bar' })}\n\n`,
        `event: done\ndata: ${JSON.stringify({ finishReason: 'stop' })}\n\n`,
      ])
    })
    const r = await requestServerCompletion(makeTarg({ useStreaming: true }), 'echo', null)
    expect(r).toEqual({ type: 'success', result: 'foobar' })
  })

  it('returns Aborted when the signal aborts mid-stream', async () => {
    const c = new AbortController()
    vi.stubGlobal('fetch', async () => {
      // Stream that never finishes — only aborts can close it.
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const enc = new TextEncoder()
          controller.enqueue(
            enc.encode(
              `event: chunk\ndata: ${JSON.stringify({ type: 'token', content: 'partial' })}\n\n`,
            ),
          )
          // Trigger the abort after the consumer reads the first chunk.
          setTimeout(() => {
            c.abort()
            try {
              controller.close()
            } catch {
              // ignore
            }
          }, 5)
        },
      })
      return new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
    })

    const r = await requestServerCompletion(makeTarg({ useStreaming: true }), 'echo', c.signal)
    expect(r).toEqual({ type: 'fail', result: 'Aborted' })
  })

  it('returns fail when the stream emits a provider error event', async () => {
    vi.stubGlobal('fetch', async () => {
      return makeSseResponse([
        `event: chunk\ndata: ${JSON.stringify({ type: 'token', content: 'partial' })}\n\n`,
        `event: error\ndata: ${JSON.stringify({ type: 'provider_error', error: 'upstream broke' })}\n\n`,
      ])
    })
    const r = await requestServerCompletion(makeTarg({ useStreaming: true }), 'echo', null)
    expect(r).toEqual({ type: 'fail', result: 'upstream broke' })
  })

  it('returns fail when streaming response has no body', async () => {
    vi.stubGlobal('fetch', async () => {
      return new Response(null, { status: 200 })
    })
    const r = await requestServerCompletion(makeTarg({ useStreaming: true }), 'echo', null)
    expect(r).toEqual({ type: 'fail', result: 'No streaming body returned' })
  })
})

describe('extractAnthropicSystem', () => {
  it('returns no system field when there are no system messages', () => {
    const r = extractAnthropicSystem([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hi back' },
    ])
    expect(r.system).toBeUndefined()
    expect(r.messages).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hi back' },
    ])
  })

  it('extracts string-content system messages and joins with \\n\\n', () => {
    const r = extractAnthropicSystem([
      { role: 'system', content: 'rule 1' },
      { role: 'user', content: 'hi' },
      { role: 'system', content: 'rule 2' },
    ])
    expect(r.system).toBe('rule 1\n\nrule 2')
    expect(r.messages).toEqual([{ role: 'user', content: 'hi' }])
  })

  it('preserves multimodal-content system messages in the messages array (skip extraction)', () => {
    const multimodal = [{ type: 'text', text: 'hello' }]
    const r = extractAnthropicSystem([
      { role: 'system', content: multimodal },
      { role: 'user', content: 'hi' },
    ])
    expect(r.system).toBeUndefined()
    expect(r.messages).toEqual([
      { role: 'system', content: multimodal },
      { role: 'user', content: 'hi' },
    ])
  })
})
