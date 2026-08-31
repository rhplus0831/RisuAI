import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../serverCompletion', async (importActual) => {
  const actual = await importActual<typeof import('../serverCompletion')>()
  return {
    ...actual,
    resolveServerCompletionRoute: () => ({ type: 'local' as const }),
  }
})

vi.mock('../../modules', async (importActual) => {
  const actual = await importActual<typeof import('../../modules')>()
  return { ...actual, moduleUpdate: () => {}, getModuleToggles: () => '', getModuleTriggers: () => [] }
})

import { customV3ProviderMetaStore } from '../../../plugins/apiV3/v3.svelte'
import { _setPluginRuntimePhaseForTesting, pluginV2 } from '../../../plugins/plugins.svelte'
import { setDatabase, type Database } from '../../../storage/database.svelte'
import { createDefaultModelRoleProfiles } from '../../../model/modelProfileRecords'
import { LLMFlags, LLMFormat, LLMProvider, LLMTokenizer } from '../../../model/types'
import { requestChatData, requestChatDataMain } from '../request'

const pluginModelId = 'pluginmodel:::provider-a'

function seedDb(overrides: Partial<Database> = {}): void {
  const aiModel = overrides.aiModel ?? pluginModelId
  const modelProfiles = overrides.modelProfiles ?? [{ id: 'active-profile', name: 'Active', modelId: aiModel }]
  const modelRoleProfiles =
    overrides.modelRoleProfiles ??
    ({
      ...createDefaultModelRoleProfiles(),
      chatMain: { mode: 'profile', profileId: 'active-profile' },
    } as Database['modelRoleProfiles'])
  setDatabase({
    aiModel,
    subModel: pluginModelId,
    modelRoles: {},
    modelProfiles,
    modelRoleProfiles,
    characters: [],
    customModels: [],
    maxResponse: 64,
    temperature: 50,
    useStreaming: false,
    genTime: 1,
    extractJson: '',
    requestRetrys: 0,
    fallbackModels: {
      model: [],
      memory: [],
      emotion: [],
      translate: [],
      otherAx: [],
      scriptMain: [],
      scriptAux: [],
    },
    ...overrides,
  } as unknown as Database)
}

beforeEach(() => {
  _setPluginRuntimePhaseForTesting('ready')
  pluginV2.providers.clear()
  pluginV2.providerOptions.clear()
  customV3ProviderMetaStore.splice(0, customV3ProviderMetaStore.length, {
    id: pluginModelId,
    name: 'Provider A',
    shortName: 'Provider A',
    fullName: 'Provider A',
    internalID: pluginModelId,
    provider: LLMProvider.AsIs,
    format: LLMFormat.Plugin,
    flags: [LLMFlags.hasFullSystemPrompt],
    parameters: [],
    tokenizer: LLMTokenizer.Unknown,
  })
  seedDb()
})

afterEach(() => {
  _setPluginRuntimePhaseForTesting('idle')
  pluginV2.providers.clear()
  pluginV2.providerOptions.clear()
  customV3ProviderMetaStore.splice(0, customV3ProviderMetaStore.length)
  vi.restoreAllMocks()
})

describe('V3 plugin provider response model ids', () => {
  it('does not execute a provider from an incoherent plugin runtime', async () => {
    const provider = vi.fn(async () => ({ success: true, content: 'must not run' }))
    pluginV2.providers.set('provider-a', provider)
    _setPluginRuntimePhaseForTesting('loading')

    const result = await requestChatDataMain({ formated: [{ role: 'user', content: 'hello' }], bias: {} }, 'model')

    expect(result).toMatchObject({ type: 'fail', model: pluginModelId })
    expect(provider).not.toHaveBeenCalled()
  })

  it.each([
    ['success', { success: true, content: 'complete' }, 'success'],
    ['failure', { success: false, content: 'rejected' }, 'fail'],
  ] as const)('preserves the V3 id for a %s response', async (_case, providerResult, expectedType) => {
    pluginV2.providers.set(
      'provider-a',
      vi.fn(async () => providerResult),
    )

    const result = await requestChatDataMain({ formated: [{ role: 'user', content: 'hello' }], bias: {} }, 'model')

    expect(result.type).toBe(expectedType)
    expect(result.model).toBe(pluginModelId)
  })

  it('preserves the V3 id for a streaming response', async () => {
    pluginV2.providers.set(
      'provider-a',
      vi.fn(async () => ({
        success: true,
        content: new ReadableStream<string>({
          start(controller) {
            controller.enqueue('chunk')
            controller.close()
          },
        }),
      })),
    )

    const result = await requestChatDataMain(
      { formated: [{ role: 'user', content: 'hello' }], bias: {}, useStreaming: true },
      'model',
    )

    expect(result.type).toBe('streaming')
    expect(result.model).toBe(pluginModelId)
  })

  it('keeps legacy provider responses classified as custom', async () => {
    seedDb({ aiModel: 'custom', subModel: 'custom', currentPluginProvider: 'legacy-provider' })
    pluginV2.providers.set(
      'legacy-provider',
      vi.fn(async () => ({ success: true, content: 'legacy' })),
    )

    const result = await requestChatDataMain({ formated: [{ role: 'user', content: 'hello' }], bias: {} }, 'model')

    expect(result).toMatchObject({ type: 'success', result: 'legacy', model: 'custom' })
  })

  it('treats a failed V3 fallback as a plugin response instead of falling through to the primary model', async () => {
    seedDb({
      aiModel: 'echo_model',
      subModel: 'echo_model',
      modelProfiles: [
        {
          id: 'active-profile',
          name: 'Active',
          modelId: 'echo_model',
          fallbacks: [{ mode: 'model', modelId: pluginModelId }],
        },
      ],
      fallbackModels: {
        model: [pluginModelId],
        memory: [],
        emotion: [],
        translate: [],
        otherAx: [],
        scriptMain: [],
        scriptAux: [],
      },
    })
    const provider = vi.fn(async () => ({ success: false, content: 'plugin failed' }))
    pluginV2.providers.set('provider-a', provider)

    const result = await requestChatData({ formated: [{ role: 'user', content: 'hello' }], bias: {} }, 'model')

    expect(result).toEqual({ type: 'fail', result: 'plugin failed', model: pluginModelId })
    expect(provider).toHaveBeenCalledOnce()
  })
})
