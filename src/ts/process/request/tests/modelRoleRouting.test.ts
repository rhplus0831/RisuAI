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
import { setDatabase, type Database } from '../../../storage/database.svelte'
import { requestChatData, requestChatDataMain } from '../request'
import { applyParameters } from '../shared'

function seedDb(overrides: Partial<Database> = {}): void {
  setDatabase({
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
  } as unknown as Database)
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
  vi.stubGlobal('safeStructuredClone', (value: unknown) =>
    value === undefined ? undefined : JSON.parse(JSON.stringify(value)),
  )
  vi.mocked(resolveModelProfile).mockClear()
  seedDb()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('requestChatDataMain model-role routing', () => {
  it('resolves scriptAux through the profile resolver before plugin blocking', async () => {
    seedDb({
      modelRoles: { scriptAux: 'pluginmodel:::blocked' } as Database['modelRoles'],
    })
    const fetchSpy = installSuccessFetch()

    const result = await requestChatDataMain(
      {
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

  it('sends legacy fallback model ids as staticModel attempts', async () => {
    seedDb({
      modelRoles: { memory: 'role-memory-model' } as Database['modelRoles'],
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

  it('sends durable fallback profile refs as profile fallback attempts', async () => {
    seedDb({
      aiModel: 'gpt-5',
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
            requestModel: 'fallback/provider-model',
            apiKey: 'fallback-key',
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

  it('keeps the primary model as the final empty staticModel attempt after resolver fallbacks fail', async () => {
    seedDb({
      modelRoles: { memory: 'role-memory-model' } as Database['modelRoles'],
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

  it('does not read a fallback bucket for the legacy submodel mode', async () => {
    seedDb({
      subModel: 'role-submodel',
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

    expect(applyParameters({}, ['temperature'], {}, 'scriptMain', { modelId: 'echo_model' })).toEqual({
      temperature: 0.6,
    })
    expect(applyParameters({}, ['temperature'], {}, 'scriptAux', { modelId: 'echo_model' })).toEqual({
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

    expect(applyParameters({}, ['temperature'], {}, 'scriptMain', { modelId: 'echo_model' })).toEqual({
      temperature: 0.3,
    })
    expect(applyParameters({}, ['temperature'], {}, 'scriptAux', { modelId: 'echo_model' })).toEqual({
      temperature: 0.2,
    })
  })
})
