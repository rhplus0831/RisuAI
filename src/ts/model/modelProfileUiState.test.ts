import { describe, expect, it } from 'vitest'
import type { Database } from '../storage/database.svelte'
import { LLMFlags, LLMFormat, LLMProvider, LLMTokenizer, OpenAIParameters, type LLMModel } from './types'
import { MODEL_ROLES, type ModelRole } from './modelRoles'
import {
  getModelProfileRoleStatus,
  getModelProfileRolesByStatus,
  modelProfileRoleHasStatus,
  resolveModelProfileUiState,
} from './modelProfileUiState'

function db(overrides: Partial<Database> = {}): Database {
  return {
    aiModel: 'main-model',
    subModel: 'aux-model',
    modelRoles: {},
    seperateModelsForAxModels: false,
    seperateModels: {},
    fallbackModels: {},
    customModels: [],
    modelTools: [],
    OaiCompAPIKeys: {},
    openrouterProvider: { order: [], only: [], ignore: [] },
    ...overrides,
  } as unknown as Database
}

function modelInfo(id: string, overrides: Partial<LLMModel> = {}): LLMModel {
  return {
    id,
    name: id,
    internalID: id,
    provider: LLMProvider.AsIs,
    format: LLMFormat.OpenAICompatible,
    flags: [],
    parameters: OpenAIParameters,
    tokenizer: LLMTokenizer.Unknown,
    ...overrides,
  }
}

describe('resolveModelProfileUiState', () => {
  it('resolves every canonical model role through the profile resolver contract', () => {
    const seenModelIds: string[] = []
    const state = resolveModelProfileUiState({
      database: db({
        aiModel: 'chat-main',
        subModel: 'chat-aux',
        modelRoles: {
          memory: 'memory-role',
          emotion: 'emotion-role',
          translate: 'translate-role',
          otherAx: 'other-role',
          scriptMain: 'script-main-role',
          scriptAux: 'script-aux-role',
        } as Database['modelRoles'],
      }),
      lookupModelInfo: (_database, modelId) => {
        seenModelIds.push(modelId)
        return modelInfo(modelId)
      },
    })

    expect(Object.keys(state.resolvedProfiles)).toEqual([...MODEL_ROLES])
    expect(MODEL_ROLES.every((role) => state.resolvedProfiles[role].role === role)).toBe(true)
    expect(seenModelIds).toEqual([
      'chat-main',
      'chat-aux',
      'memory-role',
      'emotion-role',
      'translate-role',
      'other-role',
      'script-main-role',
      'script-aux-role',
    ])
  })

  it('derives provider-family visibility from resolved profile model info', () => {
    const state = resolveModelProfileUiState({
      database: db({
        aiModel: 'provider-inferred-google',
        subModel: 'provider-inferred-claude',
        modelRoles: {
          memory: 'provider-inferred-vertex',
          emotion: 'provider-inferred-mistral',
          translate: 'provider-inferred-openai',
          otherAx: 'provider-inferred-cohere',
          scriptMain: 'provider-inferred-novelai',
          scriptAux: 'provider-inferred-novellist',
        } as Database['modelRoles'],
      }),
      lookupModelInfo: (_database, modelId) =>
        modelInfo(modelId, {
          provider:
            {
              'provider-inferred-google': LLMProvider.GoogleCloud,
              'provider-inferred-claude': LLMProvider.Anthropic,
              'provider-inferred-vertex': LLMProvider.VertexAI,
              'provider-inferred-mistral': LLMProvider.Mistral,
              'provider-inferred-openai': LLMProvider.OpenAI,
              'provider-inferred-cohere': LLMProvider.Cohere,
              'provider-inferred-novelai': LLMProvider.NovelAI,
              'provider-inferred-novellist': LLMProvider.NovelList,
            }[modelId] ?? LLMProvider.AsIs,
        }),
    })

    expect(state).toMatchObject({
      usesGoogleCloudProvider: true,
      usesVertexAIProvider: true,
      usesNovelListProvider: true,
      usesAnthropicProvider: true,
      usesMistralProvider: true,
      usesNovelAIProvider: true,
      usesCohereProvider: true,
      usesOpenAIProvider: true,
    })
  })

  it('does not expose legacy provider credentials for durable-profile roles', () => {
    const durableRoleBindings = Object.fromEntries(
      MODEL_ROLES.map((role) => [
        role,
        role === 'chatMain' || role === 'chatAux'
          ? { mode: 'profile', profileId: 'durable-anthropic' }
          : { mode: 'inherit' },
      ]),
    ) as Database['modelRoleProfiles']
    const state = resolveModelProfileUiState({
      database: db({
        providerCredentials: [{ id: 'credential-anthropic', name: 'Anthropic', type: 'apiKey', apiKey: 'profile-key' }],
        modelProfiles: [
          {
            id: 'durable-anthropic',
            name: 'Durable Anthropic',
            providerId: 'anthropic',
            modelId: 'claude-3-5-sonnet-latest',
            providerOptions: { credentialId: 'credential-anthropic' },
          },
        ],
        modelRoleProfiles: durableRoleBindings,
      } as Partial<Database>),
    })

    expect(MODEL_ROLES.every((role) => state.resolvedProfiles[role].source.kind === 'durable-profile')).toBe(true)
    expect(state.usesAnthropicProvider).toBe(false)
  })

  it('keeps legacy provider credentials visible when a matching legacy role remains', () => {
    const mixedRoleBindings = Object.fromEntries(
      MODEL_ROLES.map((role) => [
        role,
        role === 'chatAux' ? { mode: 'legacy' } : { mode: 'profile', profileId: 'durable-anthropic' },
      ]),
    ) as Database['modelRoleProfiles']
    const state = resolveModelProfileUiState({
      database: db({
        subModel: 'legacy-anthropic',
        providerCredentials: [{ id: 'credential-anthropic', name: 'Anthropic', type: 'apiKey', apiKey: 'profile-key' }],
        modelProfiles: [
          {
            id: 'durable-anthropic',
            name: 'Durable Anthropic',
            providerId: 'anthropic',
            modelId: 'claude-3-5-sonnet-latest',
            providerOptions: { credentialId: 'credential-anthropic' },
          },
        ],
        modelRoleProfiles: mixedRoleBindings,
      } as Partial<Database>),
      lookupModelInfo: (_database, modelId) =>
        modelInfo(modelId, {
          provider: modelId === 'legacy-anthropic' ? LLMProvider.Anthropic : LLMProvider.AsIs,
        }),
    })

    expect(state.resolvedProfiles.chatMain.source.kind).toBe('durable-profile')
    expect(state.resolvedProfiles.chatAux.source.kind).not.toBe('durable-profile')
    expect(state.usesAnthropicProvider).toBe(true)
  })

  it('keeps legacy special panels tied to resolved model ids instead of provider inference', () => {
    const providerOnlyState = resolveModelProfileUiState({
      database: db({
        aiModel: 'provider-only-ollama',
        subModel: 'provider-only-nanogpt',
        modelRoles: {
          memory: 'provider-only-horde',
          emotion: 'provider-only-echo',
        } as Database['modelRoles'],
      }),
      lookupModelInfo: (_database, modelId) =>
        modelInfo(modelId, {
          provider:
            {
              'provider-only-ollama': LLMProvider.Ollama,
              'provider-only-nanogpt': LLMProvider.NanoGPT,
              'provider-only-horde': LLMProvider.Horde,
              'provider-only-echo': LLMProvider.Echo,
            }[modelId] ?? LLMProvider.AsIs,
        }),
    })

    expect(providerOnlyState).toMatchObject({
      usesOllamaLocal: false,
      usesOllamaCloud: false,
      usesNanoGPTModel: false,
      usesHordeModel: false,
      usesEchoModel: false,
    })

    const legacyIdState = resolveModelProfileUiState({
      database: db({
        aiModel: 'reverse_proxy',
        subModel: 'ollama-cloud',
        modelRoles: {
          memory: 'ollama-hosted',
          emotion: 'kobold',
          translate: 'ooba',
          otherAx: 'horde:::stable',
          scriptMain: 'nanogpt',
          scriptAux: 'openrouter',
        } as Database['modelRoles'],
      }),
      lookupModelInfo: (_database, modelId) => modelInfo(modelId),
    })

    expect(legacyIdState).toMatchObject({
      usesReverseProxyModel: true,
      usesOllamaCloud: true,
      usesOllamaLocal: true,
      usesKoboldModel: true,
      usesOobaModel: true,
      usesHordeModel: true,
      usesNanoGPTModel: true,
      usesOpenRouterModel: true,
    })
  })

  it('deduplicates key-identifier API models while preserving first resolved names', () => {
    const state = resolveModelProfileUiState({
      database: db({
        aiModel: 'deepseek-a',
        subModel: 'deepseek-b',
        modelRoles: {
          memory: 'deepinfra-a',
        } as Database['modelRoles'],
      }),
      lookupModelInfo: (_database, modelId) =>
        modelInfo(modelId, {
          name: `${modelId} name`,
          keyIdentifier: modelId.startsWith('deepseek') ? 'deepseek' : 'deepinfra',
          flags: modelId === 'deepseek-a' ? [LLMFlags.hasStreaming, LLMFlags.geminiThinking] : [],
        }),
    })

    expect(state.apiKeyModels).toEqual([
      { keyIdentifier: 'deepseek', name: 'deepseek-a name' },
      { keyIdentifier: 'deepinfra', name: 'deepinfra-a name' },
    ])
    expect(state.usesStreamingModel).toBe(true)
    expect(state.usesGeminiThinkingModel).toBe(true)
  })

  it('exposes role status maps and helpers without changing resolved profile access', () => {
    const state = resolveModelProfileUiState({
      database: db({
        providerCredentials: [{ id: 'credential-openai', name: 'OpenAI', type: 'apiKey', apiKey: 'profile-key' }],
        modelProfiles: [
          {
            id: 'ready-openai',
            name: 'Ready OpenAI',
            providerId: 'openai',
            modelId: 'gpt-5',
            providerOptions: { credentialId: 'credential-openai' },
          },
          {
            id: 'broken-profile',
            name: 'Broken Profile',
          },
        ],
        modelRoleProfiles: {
          chatMain: { mode: 'profile', profileId: 'ready-openai' },
          chatAux: { mode: 'profile', profileId: 'broken-profile' },
        },
      } as Partial<Database>),
    })

    expect(state.resolvedProfiles.chatMain.status.bucket).toBe('ready')
    expect(getModelProfileRoleStatus(state, 'chatMain').bucket).toBe('ready')
    expect(modelProfileRoleHasStatus(state, 'chatAux', 'incomplete')).toBe(true)
    expect(getModelProfileRolesByStatus(state, 'ready')).toContain('chatMain')
    expect(state.roleStatuses.chatAux).toMatchObject({
      bucket: 'incomplete',
      reasons: ['profile-model-missing'],
    })
    expect(state.rolesByStatus.compatibility).toEqual(
      MODEL_ROLES.filter((role) => role !== 'chatMain' && role !== 'chatAux'),
    )
  })

  it('marks a generally routable Anthropic memory profile unsupported', () => {
    const state = resolveModelProfileUiState({
      database: db({
        providerCredentials: [{ id: 'credential-anthropic', name: 'Anthropic', type: 'apiKey', apiKey: 'profile-key' }],
        modelProfiles: [
          {
            id: 'anthropic-memory',
            name: 'Anthropic Memory',
            providerId: 'anthropic',
            modelId: 'claude-3-5-sonnet-latest',
            providerOptions: { credentialId: 'credential-anthropic' },
          },
        ],
        modelRoleProfiles: { memory: { mode: 'profile', profileId: 'anthropic-memory' } },
      } as Partial<Database>),
    })

    expect(state.resolvedProfiles.memory.status.bucket).toBe('ready')
    expect(state.roleStatuses.memory).toMatchObject({
      bucket: 'unsupported',
      reasons: ['provider-capability-unsupported'],
    })
  })

  it('reports when every role resolves through durable profiles or profile inheritance', () => {
    const state = resolveModelProfileUiState({
      database: db({
        aiModel: 'legacy-main-kept-for-compatibility',
        subModel: 'legacy-aux-kept-for-compatibility',
        modelProfiles: [{ id: 'durable-profile', name: 'Durable Profile', modelId: 'durable-model' }],
        modelRoleProfiles: {
          chatMain: { mode: 'profile', profileId: 'durable-profile' },
          chatAux: { mode: 'profile', profileId: 'durable-profile' },
          memory: { mode: 'inherit' },
          emotion: { mode: 'inherit' },
          translate: { mode: 'inherit' },
          otherAx: { mode: 'inherit' },
          scriptMain: { mode: 'inherit' },
          scriptAux: { mode: 'inherit' },
        },
      } as Partial<Database>),
      lookupModelInfo: (_database, id) => modelInfo(id),
    })

    expect(state.allRolesUseDurableProfiles).toBe(true)
    expect(MODEL_ROLES.every((role) => state.resolvedProfiles[role].source.kind === 'durable-profile')).toBe(true)
  })

  it('keeps legacy settings visible when any role still falls back to legacy resolution', () => {
    const state = resolveModelProfileUiState({
      database: db({
        modelProfiles: [{ id: 'main-profile', name: 'Main Profile', modelId: 'main-profile-model' }],
        modelRoleProfiles: {
          chatMain: { mode: 'profile', profileId: 'main-profile' },
          chatAux: { mode: 'legacy' },
          memory: { mode: 'inherit' },
        },
      } as Partial<Database>),
      lookupModelInfo: (_database, id) => modelInfo(id),
    })

    expect(state.allRolesUseDurableProfiles).toBe(false)
    expect(state.resolvedProfiles.chatAux.source.kind).not.toBe('durable-profile')
    expect(state.resolvedProfiles.memory.source.kind).not.toBe('durable-profile')
  })

  it.each([
    ['custom' as const, 'usesCustomModel' as const],
    ['pluginmodel:::test' as const, 'usesCustomModel' as const],
    ['mancer-plus' as const, 'usesMancerModel' as const],
    ['textgen_webui' as const, 'usesTextgenWebUIModel' as const],
  ])('reveals %s legacy controls from the resolved model id', (modelId, key) => {
    const state = resolveModelProfileUiState({
      database: db({ aiModel: modelId, subModel: '' }),
      lookupModelInfo: (_database, id) => modelInfo(id),
    })

    expect(state[key]).toBe(true)
  })
})
