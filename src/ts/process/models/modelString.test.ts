import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  database: {} as Record<string, unknown>,
  settingsStatus: 'ready' as 'idle' | 'loading' | 'ready' | 'error',
  providerStatus: 'ready' as 'idle' | 'loading' | 'ready' | 'error',
  profile: {} as Record<string, any>,
}))

vi.mock('src/ts/server/resourceState.svelte', () => ({
  settingsResourceState: {
    get status() {
      return state.settingsStatus
    },
    get value() {
      return state.database
    },
    groupStatuses: {
      get providers() {
        return state.providerStatus
      },
    },
  },
}))

vi.mock('src/ts/model/modelProfileResolver', () => ({
  resolveModelProfile: () => state.profile,
}))

import { getGenerationModelString } from './modelString'

beforeEach(() => {
  state.settingsStatus = 'ready'
  state.providerStatus = 'ready'
  state.database = {
    aiModel: 'flat-main',
    customProxyRequestModel: 'flat-proxy-wire',
    reverseProxyOobaMode: false,
    openrouterRequestModel: 'flat/openrouter',
    nanogptRequestModel: 'flat/nanogpt',
    nanogptRequestModelName: 'Flat NanoGPT',
    nanogptUseSubscriptionEndpoint: false,
    ollamaModel: 'flat-ollama-local',
    ollamaModelName: 'Flat Ollama Local',
    ollamaCloudModel: 'flat-ollama-cloud',
    ollamaCloudModelName: 'Flat Ollama Cloud',
  }
  state.profile = {
    source: { kind: 'durable-profile' },
    modelId: 'gpt-5',
    requestModel: 'gpt-5-wire',
    providerOptions: {},
  }
})

describe('generation model labels', () => {
  it('uses durable OpenRouter request identity over conflicting flat fields', () => {
    state.profile = {
      source: { kind: 'durable-profile' },
      modelId: 'openrouter',
      requestModel: 'profile/openrouter',
      providerOptions: {},
    }

    expect(getGenerationModelString()).toBe('openrouter-profile/openrouter')
  })

  it('uses durable provider options for proxy, NanoGPT, and Ollama labels', () => {
    state.profile = {
      source: { kind: 'durable-profile' },
      modelId: 'reverse_proxy',
      requestModel: 'profile-proxy-wire',
      providerOptions: { reverseProxy: { oobaSystemHoist: true } },
    }
    expect(getGenerationModelString()).toBe('custom-ooba')

    state.profile = {
      source: { kind: 'durable-profile' },
      modelId: 'nanogpt',
      requestModel: 'profile/nanogpt',
      providerOptions: { nanogpt: { useSubscriptionEndpoint: true } },
    }
    expect(getGenerationModelString()).toBe('NanoGPT profile/nanogpt [SUB]')

    state.profile = {
      source: { kind: 'durable-profile' },
      modelId: 'ollama-cloud',
      requestModel: 'profile-ollama',
      providerOptions: { ollama: { cloud: true } },
    }
    expect(getGenerationModelString()).toBe('Ollama Cloud profile-ollama')
  })

  it('preserves explicit provider-reported and legacy selection formatting', () => {
    expect(getGenerationModelString('openrouter')).toBe('openrouter-flat/openrouter')

    state.profile = { source: { kind: 'legacy-aiModel' } }
    state.database.aiModel = 'nanogpt'
    expect(getGenerationModelString()).toBe('NanoGPT Flat NanoGPT')
  })

  it.each(['idle', 'loading', 'error'] as const)('rejects a %s provider settings owner', (status) => {
    state.providerStatus = status

    expect(() => getGenerationModelString()).toThrow('Generation model settings owner unavailable')
  })

  it('rejects the provider owner when the settings resource has failed', () => {
    state.settingsStatus = 'error'

    expect(() => getGenerationModelString()).toThrow('Generation model settings owner unavailable')
  })
})
