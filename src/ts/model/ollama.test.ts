import { beforeEach, describe, expect, it, vi } from 'vitest'

const testState = vi.hoisted(() => ({
  globalFetch: vi.fn(),
  credential: vi.fn((apiKey: string | null | undefined) =>
    apiKey === '__RISU_SECRET_MASKED__'
      ? { source: 'stored' }
      : apiKey
        ? { source: 'provided', apiKey }
        : { source: 'none' },
  ),
  providerOperation: vi.fn(),
}))

vi.mock('../globalApi.svelte', () => ({
  globalFetch: testState.globalFetch,
}))

vi.mock('../server/providerOperations', () => ({
  providerOperationCredential: testState.credential,
  requestProviderOperation: testState.providerOperation,
}))

import { clearOllamaCloudModelRequestCacheForTests, getOllamaModels } from './ollama'

function cloudResponse(name: string) {
  return {
    models: [{ name }],
  }
}

describe('getOllamaModels cloud request reuse', () => {
  beforeEach(() => {
    clearOllamaCloudModelRequestCacheForTests()
    testState.globalFetch.mockReset()
    testState.credential.mockClear()
    testState.providerOperation.mockReset()
  })

  it('shares rapid same-key requests and briefly reuses a successful catalog', async () => {
    let resolveResponse!: (response: ReturnType<typeof cloudResponse>) => void
    testState.providerOperation.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveResponse = resolve
      }),
    )

    const first = getOllamaModels('', 'cloud', 'same-key')
    const second = getOllamaModels('', 'cloud', 'same-key')
    await Promise.resolve()

    expect(testState.providerOperation).toHaveBeenCalledTimes(1)
    resolveResponse(cloudResponse('cloud-model'))
    const [firstModels, secondModels] = await Promise.all([first, second])
    const cachedModels = await getOllamaModels('', 'cloud', 'same-key')

    expect(firstModels).toEqual(secondModels)
    expect(cachedModels).toEqual(firstModels)
    expect(testState.providerOperation).toHaveBeenCalledTimes(1)
    expect(testState.providerOperation).toHaveBeenCalledWith('ollama.cloud-models', {
      credential: expect.objectContaining({ apiKey: 'same-key' }),
    })
  })

  it('uses the changed key for a separate request and result', async () => {
    testState.providerOperation.mockImplementation(async (_operation, options) => {
      const suffix = options.credential.apiKey.endsWith('first-key') ? 'first' : 'second'
      return cloudResponse(`${suffix}-model`)
    })

    const firstModels = await getOllamaModels('', 'cloud', 'first-key')
    const secondModels = await getOllamaModels('', 'cloud', 'second-key')

    expect(firstModels[0].id).toBe('first-model')
    expect(secondModels[0].id).toBe('second-model')
    expect(testState.providerOperation).toHaveBeenCalledTimes(2)
  })

  it('does not reuse a completed catalog for an opaque stored credential', async () => {
    testState.providerOperation.mockResolvedValue(cloudResponse('cloud-model'))

    await getOllamaModels('', 'cloud', '__RISU_SECRET_MASKED__')
    await getOllamaModels('', 'cloud', '__RISU_SECRET_MASKED__')

    expect(testState.providerOperation).toHaveBeenCalledTimes(2)
  })

  it('keeps local Ollama discovery on the local-network interceptor', async () => {
    testState.globalFetch.mockResolvedValueOnce({ ok: true, data: cloudResponse('local-model') })

    const models = await getOllamaModels('http://127.0.0.1:11434/', 'local')

    expect(models[0]).toMatchObject({ id: 'local-model', providerName: 'Local' })
    expect(testState.globalFetch).toHaveBeenCalledWith('http://127.0.0.1:11434/api/tags', {
      method: 'GET',
      headers: {},
      interceptor: 'ollama_models',
    })
    expect(testState.providerOperation).not.toHaveBeenCalled()
  })
})
