import { describe, expect, it } from 'vitest'
import { LLMFormat } from '@risuai/shared-core/model-types'
import type { Database } from '../../../src/ts/storage/database.svelte'
import {
  resolveModelProfile,
  resolveModelProfileWithLegacyCompatibility,
} from '../../../src/ts/model/modelProfileResolver'
import { migrateLegacyFlatModelConfiguration, normalizeDatabaseDefaults } from '../src/databaseDefaults'

const MODEL_ROLES = [
  'chatMain',
  'chatAux',
  'memory',
  'emotion',
  'translate',
  'otherAx',
  'scriptMain',
  'scriptAux',
] as const

function db(overrides: Record<string, unknown> = {}): Database {
  return {
    aiModel: 'reverse_proxy',
    subModel: 'echo_model',
    modelRoles: {},
    customModels: [],
    modelTools: [],
    customProxyRequestModel: 'server-safe-model',
    customAPIFormat: LLMFormat.OpenAICompatible,
    forceReplaceUrl: 'https://proxy.example.test/v1',
    proxyKey: 'proxy-key',
    OaiCompAPIKeys: {},
    fallbackModels: {},
    ...overrides,
  } as unknown as Database
}

describe('model profile resolver server import', () => {
  it('resolves provider capability without importing the browser model registry', () => {
    const profile = resolveModelProfileWithLegacyCompatibility({ database: db() })

    expect(profile.modelId).toBe('reverse_proxy')
    expect(profile.requestModel).toBe('server-safe-model')
    expect(profile.providerCapability).toEqual({ routable: true, provider: 'openai' })
  })

  it('preserves generation-visible legacy resolution across durable migration', () => {
    const legacy = normalizeDatabaseDefaults(
      db({
        aiModel: 'reverse_proxy',
        subModel: 'claude-sonnet-4-5',
        modelRoles: { memory: 'reverse_proxy' },
        maxContext: 12000,
        maxResponse: 700,
        temperature: 63,
        top_p: 0.84,
        frequencyPenalty: 55,
        PresensePenalty: 65,
        fallbackModels: {
          model: ['fallback-main'],
          memory: ['fallback-memory'],
        },
        additionalParams: [['trace', 'enabled']],
        autofillRequestUrl: true,
        reverseProxyOobaMode: true,
        reverseProxyOobaArgs: { mode: 'instruct' },
        modelProfiles: [],
        modelRoleProfiles: {},
        modelRuntimeDefaults: {},
        providerCredentials: [
          {
            id: 'cred-proxy',
            name: 'Proxy',
            type: 'apiKey',
            apiKey: 'proxy-key',
          },
        ],
      }) as unknown as Record<string, unknown>,
      { providerDefaults: false },
    ) as unknown as Database
    const expected = Object.fromEntries(
      MODEL_ROLES.map((role) => [
        role,
        comparableResolution(resolveModelProfileWithLegacyCompatibility({ database: legacy, role })),
      ]),
    )
    const migrated = structuredClone(legacy) as unknown as Record<string, unknown>

    expect(migrateLegacyFlatModelConfiguration(migrated)).toBe(true)

    for (const role of MODEL_ROLES) {
      expect(comparableResolution(resolveModelProfile({ database: migrated as unknown as Database, role }))).toEqual(
        expected[role],
      )
    }
    expect(JSON.stringify(migrated.modelProfiles)).not.toContain('proxy-key')
  })
})

function comparableResolution(profile: ReturnType<typeof resolveModelProfile>) {
  const runtime = profile.runtimeOptions
  return {
    modelId: profile.modelId,
    requestModel: profile.requestModel,
    modelInfo: profile.modelInfo,
    providerOptions: profile.providerOptions,
    runtimeOptions: {
      maxContext: runtime.maxContext,
      maxResponse: runtime.maxResponse,
      temperature: runtime.temperature,
      rawTemperature: runtime.rawTemperature,
      topP: runtime.topP,
      frequencyPenalty: runtime.frequencyPenalty,
      presencePenalty: runtime.presencePenalty,
      modelTools: runtime.modelTools,
    },
    fallbacks: profile.fallbacks,
    providerCapability: profile.providerCapability,
  }
}
