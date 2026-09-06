import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'test-auth-token',
}))

vi.mock('../../modules', async (importActual) => {
  const actual = await importActual<typeof import('../../modules')>()
  return { ...actual, moduleUpdate: () => {}, getModuleToggles: () => '', getModuleTriggers: () => [] }
})

vi.mock('../../../model/modelProfileResolver', async (importActual) => {
  const actual = await importActual<typeof import('../../../model/modelProfileResolver')>()
  return {
    ...actual,
    resolveModelProfile: vi.fn(actual.resolveModelProfile),
  }
})

import { resolveModelProfile } from '../../../model/modelProfileResolver'
import { createDefaultModelRoleProfiles } from '../../../model/modelProfileRecords'
import { settingsResourceState } from '../../../server/resourceState.svelte'
import { language } from '../../../../lang'
import { setDatabase, type Database } from '../../../storage/database.svelte'
import { requestChatData, requestChatDataMain } from '../request'
import { applyParameters } from '../shared'

let databaseOwner: Database

function seedDb(overrides: Partial<Database> = {}): Database {
  databaseOwner = {
    aiModel: 'echo_model',
    subModel: 'echo_model',
    modelRoles: {},
    characters: [],
    customModels: [],
    maxResponse: 64,
    temperature: 50,
    useStreaming: false,
    genTime: 1,
    extractJson: '',
    ...overrides,
  } as unknown as Database
  setDatabase(databaseOwner)
  return databaseOwner
}

function applyOwnedParameters(
  data: Parameters<typeof applyParameters>[0],
  parameters: Parameters<typeof applyParameters>[1],
  rename: Parameters<typeof applyParameters>[2],
  mode: Parameters<typeof applyParameters>[3],
  options: Omit<Parameters<typeof applyParameters>[4], 'database'>,
) {
  return applyParameters(data, parameters, rename, mode, { ...options, database: databaseOwner })
}

function durableRoleProfiles(
  role: keyof Database['modelRoleProfiles'],
  profileId: string,
): Database['modelRoleProfiles'] {
  return {
    ...createDefaultModelRoleProfiles(),
    [role]: { mode: 'profile', profileId },
  }
}

function installSuccessFetch(): ReturnType<typeof vi.fn> {
  const fetchSpy = vi.fn(async () => {
    return new Response(JSON.stringify({ type: 'success', result: 'ok' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  })
  vi.stubGlobal('fetch', fetchSpy)
  return fetchSpy
}

beforeEach(() => {
  vi.mocked(resolveModelProfile).mockClear()
  seedDb()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('requestChatDataMain model-role routing', () => {
  it('fails closed while the implicit settings owner is incomplete', async () => {
    settingsResourceState.groupStatuses.providers = 'loading'
    const fetchSpy = installSuccessFetch()

    const result = await requestChatDataMain(
      {
        formated: [{ role: 'user', content: 'hi' }],
        bias: {},
      },
      'model',
    )

    expect(result).toEqual({ type: 'fail', result: 'Request settings are not ready.' })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(vi.mocked(resolveModelProfile)).not.toHaveBeenCalled()
  })

  it('uses an explicit request snapshot while the live settings owner reloads', async () => {
    const database = databaseOwner
    settingsResourceState.groupStatuses.providers = 'loading'
    const fetchSpy = installSuccessFetch()

    const result = await requestChatDataMain(
      {
        database,
        formated: [{ role: 'user', content: 'hi' }],
        bias: {},
        staticModel: 'echo_model',
      },
      'model',
    )

    expect(result).toEqual({ type: 'success', result: 'ok' })
    expect(fetchSpy).toHaveBeenCalledOnce()
  })

  it('resolves scriptAux through the profile resolver before plugin blocking', async () => {
    const database = seedDb({
      modelProfiles: [{ id: 'script-aux-profile', name: 'Script aux', modelId: 'pluginmodel:::blocked' }],
      modelRoleProfiles: durableRoleProfiles('scriptAux', 'script-aux-profile'),
    })
    const fetchSpy = installSuccessFetch()

    const result = await requestChatDataMain(
      {
        database,
        formated: [{ role: 'user', content: 'hi' }],
        bias: {},
        blockPlugins: true,
      },
      'scriptAux',
    )

    expect(result).toEqual({ type: 'fail', result: 'Plugin calls are blocked by the caller.' })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(vi.mocked(resolveModelProfile)).toHaveBeenCalledWith({
      database: expect.any(Object),
      role: 'scriptAux',
      staticModel: undefined,
    })
  })

  it('lets staticModel bypass role overrides through the resolver', async () => {
    seedDb({
      modelRoles: { scriptAux: 'pluginmodel:::blocked' } as Database['modelRoles'],
    })
    const fetchSpy = installSuccessFetch()

    const result = await requestChatDataMain(
      {
        formated: [{ role: 'user', content: 'hi' }],
        bias: {},
        staticModel: 'echo_model',
        blockPlugins: true,
      },
      'scriptAux',
    )

    expect(result).toEqual({ type: 'success', result: 'ok' })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const payload = JSON.parse(fetchSpy.mock.calls[0][1].body as string)
    expect(payload).toMatchObject({ mode: 'scriptAux', staticModel: 'echo_model' })
    expect(vi.mocked(resolveModelProfile)).toHaveBeenCalledWith({
      database: expect.any(Object),
      role: 'scriptAux',
      staticModel: 'echo_model',
    })
  })

  it('rejects a bad active durable profile before fetch', async () => {
    seedDb({
      modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'missing-profile' } },
    } as Partial<Database>)
    const fetchSpy = installSuccessFetch()

    const result = await requestChatDataMain(
      {
        formated: [{ role: 'user', content: 'hi' }],
        bias: {},
      },
      'model',
    )

    expect(result).toMatchObject({ type: 'fail' })
    expect(result.result).toContain('profile-not-found')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('lets a staticModel compatibility attempt bypass a bad active durable profile', async () => {
    seedDb({
      modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'missing-profile' } },
    } as Partial<Database>)
    const fetchSpy = installSuccessFetch()

    const result = await requestChatDataMain(
      {
        formated: [{ role: 'user', content: 'hi' }],
        bias: {},
        staticModel: 'echo_model',
      },
      'model',
    )

    expect(result).toEqual({ type: 'success', result: 'ok' })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body as string)).toMatchObject({
      mode: 'model',
      staticModel: 'echo_model',
    })
  })

  it('sends legacy fallback model ids as staticModel attempts', async () => {
    const database = seedDb({
      modelRoles: { memory: 'role-memory-model' } as Database['modelRoles'],
      modelProfiles: [
        {
          id: 'memory-profile',
          name: 'Memory',
          modelId: 'role-memory-model',
          fallbacks: [{ mode: 'model', modelId: 'fallback-memory-model' }],
        },
      ],
      modelRoleProfiles: durableRoleProfiles('memory', 'memory-profile'),
      fallbackModels: {
        model: [],
        memory: ['fallback-memory-model'],
        emotion: [],
        translate: [],
        otherAx: [],
        scriptMain: [],
        scriptAux: [],
      } as Database['fallbackModels'],
      requestRetrys: 0,
    })
    const payloads: Array<Record<string, unknown>> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init: RequestInit = {}) => {
        payloads.push(JSON.parse(init.body as string))
        return new Response(JSON.stringify({ type: 'success', result: 'ok', model: 'role-memory-model' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }),
    )

    const result = await requestChatData(
      {
        database,
        formated: [{ role: 'user', content: 'hi' }],
        bias: {},
      },
      'memory',
    )

    expect(result).toEqual({ type: 'success', result: 'ok', model: 'fallback-memory-model' })
    expect(payloads.map((payload) => payload.mode)).toEqual(['memory'])
    expect(payloads.map((payload) => payload.staticModel)).toEqual(['fallback-memory-model'])
    expect(vi.mocked(resolveModelProfile)).toHaveBeenNthCalledWith(1, {
      database: expect.any(Object),
      role: 'memory',
    })
    expect(vi.mocked(resolveModelProfile)).toHaveBeenNthCalledWith(2, {
      database: expect.any(Object),
      role: 'memory',
      staticModel: 'fallback-memory-model',
    })
  })

  it('does not discard a tool-call-only success as a blank fallback response', async () => {
    const tool = {
      name: 'risu-get-character-info',
      description: 'Get character information.',
      inputSchema: { type: 'object' },
    }
    const database = seedDb({
      modelProfiles: [
        {
          id: 'chat-main-profile',
          name: 'Chat main',
          modelId: 'echo_model',
          fallbacks: [{ mode: 'model', modelId: 'fallback-model' }],
        },
      ],
      modelRoleProfiles: durableRoleProfiles('chatMain', 'chat-main-profile'),
      fallbackModels: {
        model: ['fallback-model'],
        memory: [],
        emotion: [],
        translate: [],
        otherAx: [],
        scriptMain: [],
        scriptAux: [],
      } as Database['fallbackModels'],
      fallbackWhenBlankResponse: true,
      requestRetrys: 0,
    })
    const fetchSpy = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            type: 'success',
            result: '',
            toolCalls: [{ id: 'call-1', name: tool.name, arguments: {} }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    )
    vi.stubGlobal('fetch', fetchSpy)

    await expect(
      requestChatData(
        {
          database,
          formated: [{ role: 'user', content: 'hi' }],
          bias: {},
          tools: [tool],
        },
        'model',
      ),
    ).resolves.toEqual({
      type: 'success',
      result: '',
      toolCalls: [{ id: 'call-1', name: tool.name, arguments: {} }],
      model: 'fallback-model',
    })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('sends durable fallback profile refs as profile fallback attempts', async () => {
    seedDb({
      aiModel: 'gpt-5',
      providerCredentials: [{ id: 'credential-fallback', name: 'Fallback', type: 'apiKey', apiKey: 'fallback-key' }],
      modelProfiles: [
        {
          id: 'primary-profile',
          name: 'Primary Profile',
          modelId: 'gpt-5',
          fallbacks: [
            { mode: 'profile', profileId: 'fallback-profile' },
            { mode: 'profile', profileId: 'missing-profile' },
          ],
        },
        {
          id: 'fallback-profile',
          name: 'Fallback Profile',
          modelId: 'openrouter',
          providerOptions: {
            credentialId: 'credential-fallback',
            requestModel: 'fallback/provider-model',
          },
          runtimeOptions: {
            maxResponse: 123,
            temperature: 25,
          },
        },
      ],
      modelRoleProfiles: {
        chatMain: { mode: 'profile', profileId: 'primary-profile' },
      },
      requestRetrys: 0,
    } as Partial<Database>)
    const payloads: Array<Record<string, unknown>> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init: RequestInit = {}) => {
        payloads.push(JSON.parse(init.body as string))
        return new Response(JSON.stringify({ type: 'success', result: 'ok', model: 'openrouter' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }),
    )

    const result = await requestChatData(
      {
        formated: [{ role: 'user', content: 'hi' }],
        bias: {},
      },
      'model',
    )

    expect(result).toEqual({ type: 'success', result: 'ok', model: 'openrouter' })
    expect(payloads).toHaveLength(1)
    expect(payloads[0]).toMatchObject({
      mode: 'model',
      staticModel: '',
      fallbackProfileId: 'fallback-profile',
      maxTokens: 123,
      temperature: 0.25,
    })
  })

  it('uses a first-class profile override as the primary request target', async () => {
    seedDb({
      aiModel: 'echo_model',
      providerCredentials: [{ id: 'credential-translator', name: 'Translator', type: 'apiKey', apiKey: 'step-key' }],
      modelProfiles: [
        {
          id: 'translator-step-profile',
          name: 'Translator Step',
          modelId: 'openrouter',
          providerOptions: { requestModel: 'step/provider-model', credentialId: 'credential-translator' },
        },
      ],
      fallbackModels: {
        model: [],
        memory: [],
        emotion: [],
        translate: ['role-fallback-model'],
        otherAx: [],
        scriptMain: [],
        scriptAux: [],
      } as Database['fallbackModels'],
      requestRetrys: 0,
    } as Partial<Database>)
    const fetchSpy = installSuccessFetch()

    const result = await requestChatData(
      {
        formated: [{ role: 'user', content: 'hi' }],
        bias: {},
        profileIdOverride: 'translator-step-profile',
      },
      'translate',
    )

    expect(result).toEqual({ type: 'success', result: 'ok', model: 'openrouter' })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body as string)).toMatchObject({
      mode: 'translate',
      staticModel: '',
      fallbackProfileId: 'translator-step-profile',
    })
  })

  it('does not silently fall back when a strict profile override is missing', async () => {
    const fetchSpy = installSuccessFetch()

    const result = await requestChatData(
      {
        formated: [{ role: 'user', content: 'hi' }],
        bias: {},
        profileIdOverride: 'missing-script-profile',
        strictProfileIdOverride: true,
      },
      'scriptMain',
    )

    expect(result).toEqual({
      type: 'fail',
      result: 'Model profile not found or unavailable: missing-script-profile',
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('continues to raw model fallbacks when the active durable profile config is incomplete', async () => {
    seedDb({
      modelProfiles: [
        {
          id: 'primary-profile',
          name: 'Primary Profile',
          providerId: 'openai',
          modelId: 'gpt-5',
          fallbacks: [{ mode: 'model', modelId: 'echo_model' }],
        },
      ],
      modelRoleProfiles: {
        chatMain: { mode: 'profile', profileId: 'primary-profile' },
      },
      requestRetrys: 0,
    } as Partial<Database>)
    const fetchSpy = installSuccessFetch()

    const result = await requestChatData(
      {
        formated: [{ role: 'user', content: 'hi' }],
        bias: {},
      },
      'model',
    )

    expect(result).toEqual({ type: 'success', result: 'ok', model: 'echo_model' })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body as string)).toMatchObject({
      staticModel: 'echo_model',
    })
  })

  it('keeps the primary model as the final empty staticModel attempt after resolver fallbacks fail', async () => {
    const database = seedDb({
      modelRoles: { memory: 'role-memory-model' } as Database['modelRoles'],
      modelProfiles: [
        {
          id: 'memory-primary-profile',
          name: 'Memory primary',
          modelId: 'role-memory-model',
          fallbacks: [{ mode: 'model', modelId: 'fallback-memory-model' }],
        },
      ],
      modelRoleProfiles: durableRoleProfiles('memory', 'memory-primary-profile'),
      fallbackModels: {
        model: [],
        memory: ['fallback-memory-model'],
        emotion: [],
        translate: [],
        otherAx: [],
        scriptMain: [],
        scriptAux: [],
      } as Database['fallbackModels'],
      requestRetrys: 0,
    })
    const payloads: Array<Record<string, unknown>> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init: RequestInit = {}) => {
        const payload = JSON.parse(init.body as string)
        payloads.push(payload)
        const body =
          payload.staticModel === 'fallback-memory-model'
            ? { type: 'fail', result: 'fallback failed' }
            : { type: 'success', result: 'ok', model: 'role-memory-model' }
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }),
    )

    const result = await requestChatData(
      {
        database,
        formated: [{ role: 'user', content: 'hi' }],
        bias: {},
      },
      'memory',
    )

    expect(result).toEqual({ type: 'success', result: 'ok', model: 'role-memory-model' })
    expect(payloads.map((payload) => payload.staticModel)).toEqual(['fallback-memory-model', ''])
    expect(vi.mocked(resolveModelProfile)).toHaveBeenNthCalledWith(3, {
      database: expect.any(Object),
      role: 'memory',
      staticModel: '',
    })
  })

  it('stops retrying responses that contain a banned character set at the configured limit', async () => {
    const database = seedDb({
      banCharacterset: ['Han'],
      modelProfiles: [{ id: 'chat-main-profile', name: 'Chat main', modelId: 'echo_model' }],
      modelRoleProfiles: durableRoleProfiles('chatMain', 'chat-main-profile'),
      requestRetrys: 2,
    })
    const fetchSpy = vi.fn(async () => {
      return new Response(JSON.stringify({ type: 'success', result: '禁止' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchSpy)

    const result = await requestChatData(
      {
        database,
        formated: [{ role: 'user', content: 'hi' }],
        bias: {},
      },
      'model',
    )

    expect(result).toEqual({ type: 'fail', result: language.errors.bannedCharacterSet('Han') })
    expect(fetchSpy).toHaveBeenCalledTimes(3)
  })

  it('moves to the next fallback after banned responses exhaust their retries', async () => {
    const database = seedDb({
      modelProfiles: [
        {
          id: 'chat-main-profile',
          name: 'Chat main',
          modelId: 'echo_model',
          fallbacks: [{ mode: 'model', modelId: 'fallback-model' }],
        },
      ],
      modelRoleProfiles: durableRoleProfiles('chatMain', 'chat-main-profile'),
      fallbackModels: {
        model: ['fallback-model'],
        memory: [],
        emotion: [],
        translate: [],
        otherAx: [],
        scriptMain: [],
        scriptAux: [],
      } as Database['fallbackModels'],
      banCharacterset: ['Han'],
      requestRetrys: 1,
    })
    const attemptedModels: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init: RequestInit = {}) => {
        const payload = JSON.parse(init.body as string)
        attemptedModels.push(payload.staticModel)
        const result = payload.staticModel === 'fallback-model' ? '禁止' : 'allowed response'
        return new Response(JSON.stringify({ type: 'success', result }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }),
    )

    const result = await requestChatData(
      {
        database,
        formated: [{ role: 'user', content: 'hi' }],
        bias: {},
      },
      'model',
    )

    expect(result).toEqual({ type: 'success', result: 'allowed response' })
    expect(attemptedModels).toEqual(['fallback-model', 'fallback-model', ''])
  })

  it('does not read a fallback bucket for the legacy submodel mode', async () => {
    const database = seedDb({
      subModel: 'role-submodel',
      modelProfiles: [{ id: 'chat-aux-profile', name: 'Chat aux', modelId: 'role-submodel' }],
      modelRoleProfiles: durableRoleProfiles('chatAux', 'chat-aux-profile'),
      fallbackModels: {
        model: ['main-fallback-model'],
        submodel: ['submodel-fallback-model'],
      } as unknown as Database['fallbackModels'],
      requestRetrys: 0,
    })
    const payloads: Array<Record<string, unknown>> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init: RequestInit = {}) => {
        payloads.push(JSON.parse(init.body as string))
        return new Response(JSON.stringify({ type: 'success', result: 'ok', model: 'role-submodel' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }),
    )

    const result = await requestChatData(
      {
        database,
        formated: [{ role: 'user', content: 'hi' }],
        bias: {},
      },
      'submodel',
    )

    expect(result).toEqual({ type: 'success', result: 'ok', model: 'role-submodel' })
    expect(payloads).toHaveLength(1)
    expect(payloads[0]).toMatchObject({ mode: 'submodel', staticModel: '' })
    expect(vi.mocked(resolveModelProfile)).toHaveBeenNthCalledWith(1, {
      database: expect.any(Object),
      role: 'submodel',
    })
    expect(vi.mocked(resolveModelProfile)).toHaveBeenNthCalledWith(2, {
      database: expect.any(Object),
      role: 'submodel',
      staticModel: '',
    })
  })

  it('inherits legacy script parameter buckets until script-specific parameters are configured', () => {
    seedDb({
      temperature: 60,
      seperateParametersEnabled: true,
      seperateParameters: {
        memory: {},
        emotion: {},
        translate: {},
        otherAx: { temperature: 80 },
        scriptMain: {},
        scriptAux: {},
        overrides: {},
      },
    })

    expect(applyOwnedParameters({}, ['temperature'], {}, 'scriptMain', { modelId: 'echo_model' })).toEqual({
      temperature: 0.6,
    })
    expect(applyOwnedParameters({}, ['temperature'], {}, 'scriptAux', { modelId: 'echo_model' })).toEqual({
      temperature: 0.8,
    })

    seedDb({
      temperature: 60,
      seperateParametersEnabled: true,
      seperateParameters: {
        memory: {},
        emotion: {},
        translate: {},
        otherAx: { temperature: 80 },
        scriptMain: { temperature: 30 },
        scriptAux: { temperature: 20 },
        overrides: {},
      },
    })

    expect(applyOwnedParameters({}, ['temperature'], {}, 'scriptMain', { modelId: 'echo_model' })).toEqual({
      temperature: 0.3,
    })
    expect(applyOwnedParameters({}, ['temperature'], {}, 'scriptAux', { modelId: 'echo_model' })).toEqual({
      temperature: 0.2,
    })
  })

  it('uses resolved profile samplers instead of conflicting flat parameters', () => {
    seedDb({
      temperature: 91,
      top_k: 91,
      top_p: 0.91,
      frequencyPenalty: 91,
      PresensePenalty: 91,
      reasoningEffort: 0,
      thinkingTokens: 91,
      verbosity: 0,
    })

    expect(
      applyOwnedParameters(
        {},
        [
          'temperature',
          'top_k',
          'top_p',
          'frequency_penalty',
          'presence_penalty',
          'reasoning_effort',
          'reasoning_effort_xhigh',
          'thinking_tokens',
          'verbosity',
        ],
        {},
        'model',
        {
          modelId: 'gpt-5.5',
          runtimeOptions: {
            temperature: 0.42,
            topK: 17,
            topP: 0.43,
            frequencyPenalty: 0.25,
            presencePenalty: -0.5,
            reasoningEffort: 3,
            thinkingTokens: 2048,
            verbosity: 2,
          },
        },
      ),
    ).toEqual({
      temperature: 0.42,
      top_k: 17,
      top_p: 0.43,
      frequency_penalty: 0.25,
      presence_penalty: -0.5,
      reasoning_effort: 'xhigh',
      thinking_tokens: 2048,
      verbosity: 'high',
    })
  })

  it('keeps configured separate parameters ahead of resolved profile samplers', () => {
    seedDb({
      seperateParametersEnabled: true,
      seperateParameters: {
        memory: { temperature: 65, top_p: 0.66 },
        emotion: {},
        translate: {},
        otherAx: {},
        scriptMain: {},
        scriptAux: {},
        overrides: {},
      },
    })

    expect(
      applyOwnedParameters({}, ['temperature', 'top_p'], {}, 'memory', {
        modelId: 'profile-memory',
        runtimeOptions: { temperature: 0.42, topP: 0.43 },
      }),
    ).toEqual({ temperature: 0.65, top_p: 0.66 })
  })

  it('maps reasoning effort through none, min-medium, and xhigh capability tiers', () => {
    seedDb({ reasoningEffort: -1 })
    expect(
      applyOwnedParameters({}, ['reasoning_effort', 'reasoning_effort_none'], {}, 'model', { modelId: 'gpt-5.1' }),
    ).toEqual({ reasoning_effort: 'none' })

    seedDb({ reasoningEffort: 0 })
    expect(
      applyOwnedParameters({}, ['reasoning_effort', 'reasoning_effort_min_medium'], {}, 'model', {
        modelId: 'gpt-5.4-pro',
      }),
    ).toEqual({ reasoning_effort: 'medium' })

    seedDb({ reasoningEffort: 3 })
    expect(
      applyOwnedParameters({}, ['reasoning_effort', 'reasoning_effort_xhigh'], {}, 'model', { modelId: 'gpt-5.5' }),
    ).toEqual({ reasoning_effort: 'xhigh' })
    expect(applyOwnedParameters({}, ['reasoning_effort'], {}, 'model', { modelId: 'gpt-5' })).toEqual({
      reasoning_effort: 'high',
    })
  })

  it('skips reasoning capability pseudo-parameters for separate-by-model values', () => {
    seedDb({
      seperateParametersEnabled: true,
      seperateParametersByModel: true,
      seperateParameters: {
        memory: {},
        emotion: {},
        translate: {},
        otherAx: {},
        scriptMain: {},
        scriptAux: {},
        overrides: { 'gpt-5.5': { reasoning_effort: 3 } },
      },
    })

    expect(
      applyOwnedParameters({}, ['reasoning_effort', 'reasoning_effort_none', 'reasoning_effort_xhigh'], {}, 'model', {
        modelId: 'gpt-5.5',
      }),
    ).toEqual({ reasoning_effort: 'xhigh' })
  })
})
