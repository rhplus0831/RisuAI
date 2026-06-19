import { describe, expect, it } from 'vitest'
import { LLMFormat } from '../../../src/ts/model/types'
import type { Database } from '../../../src/ts/storage/database.svelte'
import { resolveModelProfile } from '../../../src/ts/model/modelProfileResolver'

function db(overrides: Partial<Database> = {}): Database {
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
    const profile = resolveModelProfile({ database: db() })

    expect(profile.modelId).toBe('reverse_proxy')
    expect(profile.requestModel).toBe('server-safe-model')
    expect(profile.providerCapability).toEqual({ routable: true, provider: 'openai' })
  })
})
