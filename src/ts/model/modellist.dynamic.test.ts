import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const providerOperations = vi.hoisted(() => ({
  credential: vi.fn((apiKey: string) => ({ source: 'provided', apiKey })),
  request: vi.fn(),
}))
const database = vi.hoisted(() => ({
  value: {} as Record<string, any>,
}))

vi.mock('../server/providerOperations', () => ({
  providerOperationCredential: providerOperations.credential,
  requestProviderOperation: providerOperations.request,
}))

vi.mock('../storage/database.svelte', () => ({
  getDatabase: () => database.value,
}))

vi.mock('../plugins/plugins.svelte', () => ({
  customProviderStore: {},
  pluginV2: {},
}))

vi.mock('../plugins/apiV3/v3.svelte', () => ({
  customV3ProviderMetaStore: [],
}))

import { LLMModels, registerModelDynamic } from './modellist'

const dynamicIds = ['dynamic_google_audit-google-model', 'dynamic_anthropic_audit-anthropic-model']

function removeAuditModels(): void {
  for (const id of dynamicIds) {
    const index = LLMModels.findIndex((model) => model.id === id)
    if (index !== -1) LLMModels.splice(index, 1)
  }
}

beforeEach(() => {
  removeAuditModels()
  providerOperations.credential.mockClear()
  providerOperations.request.mockReset()
  database.value = {
    dynamicModelRegistry: true,
    google: { accessToken: 'google-catalog-key' },
    claudeAPIKey: 'anthropic-catalog-key',
  }
})

afterEach(() => {
  removeAuditModels()
  database.value = {}
})

describe('registerModelDynamic provider operations', () => {
  it('registers Google and Anthropic models without exposing catalog credentials cross-origin', async () => {
    providerOperations.request.mockImplementation(async (operation: string) => {
      if (operation === 'google.models') {
        return {
          models: [
            {
              name: 'models/audit-google-model',
              displayName: 'Audit Google Model',
              supportedGenerationMethods: ['generateContent'],
            },
            {
              name: 'models/audit-embedding-model',
              displayName: 'Audit Embedding Model',
              supportedGenerationMethods: ['embedContent'],
            },
          ],
        }
      }
      if (operation === 'anthropic.models') {
        return { data: [{ id: 'audit-anthropic-model', display_name: 'Audit Anthropic Model' }] }
      }
      throw new Error(`unexpected operation: ${operation}`)
    })

    await registerModelDynamic()

    expect(providerOperations.request.mock.calls.map(([operation]) => operation)).toEqual([
      'google.models',
      'anthropic.models',
    ])
    expect(providerOperations.credential.mock.calls.map(([apiKey]) => apiKey)).toEqual([
      'google-catalog-key',
      'anthropic-catalog-key',
    ])
    expect(LLMModels.find((model) => model.id === 'dynamic_google_audit-google-model')).toMatchObject({
      name: 'Audit Google Model',
      internalID: 'models/audit-google-model',
    })
    expect(LLMModels.find((model) => model.id === 'dynamic_anthropic_audit-anthropic-model')).toMatchObject({
      name: 'Audit Anthropic Model',
      internalID: 'audit-anthropic-model',
    })
    expect(LLMModels.some((model) => model.id === 'dynamic_google_audit-embedding-model')).toBe(false)
  })

  it('preserves newer persisted model choices when late discovery completes', async () => {
    let releaseGoogle!: (value: { models: any[] }) => void
    const googleModels = new Promise<{ models: any[] }>((resolve) => {
      releaseGoogle = resolve
    })
    database.value.aiModel = 'persisted-model'
    database.value.subModel = 'persisted-submodel'
    providerOperations.request.mockImplementation(async (operation: string) => {
      if (operation === 'google.models') return googleModels
      if (operation === 'anthropic.models') return { data: [] }
      throw new Error(`unexpected operation: ${operation}`)
    })

    const discovery = registerModelDynamic()
    await vi.waitFor(() => expect(providerOperations.request).toHaveBeenCalledWith('google.models', expect.any(Object)))

    database.value.aiModel = 'newer-model'
    database.value.subModel = 'newer-submodel'
    releaseGoogle({ models: [] })
    await discovery

    expect(database.value.aiModel).toBe('newer-model')
    expect(database.value.subModel).toBe('newer-submodel')
  })
})
