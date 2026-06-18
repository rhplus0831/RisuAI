import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'test-auth-token',
}))

vi.mock('../../modules', async (importActual) => {
  const actual = await importActual<typeof import('../../modules')>()
  return { ...actual, moduleUpdate: () => {}, getModuleToggles: () => '', getModuleTriggers: () => [] }
})

import { setDatabase, type Database } from '../../../storage/database.svelte'
import { requestChatDataMain } from '../request'
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
  seedDb()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('requestChatDataMain model-role routing', () => {
  it('resolves scriptAux through model role overrides before plugin blocking', async () => {
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
  })

  it('lets staticModel bypass role overrides', async () => {
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
