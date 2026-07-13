import { beforeEach, describe, expect, it, vi } from 'vitest'

const testState = vi.hoisted(() => ({
  globalFetch: vi.fn(),
}))

vi.mock('../globalApi.svelte', () => ({
  globalFetch: testState.globalFetch,
}))

import { clearOllamaCloudModelRequestCacheForTests, getOllamaModels } from './ollama'

function cloudResponse(name: string) {
  return {
    ok: true,
    data: {
      models: [{ name }],
    },
  }
}

describe('getOllamaModels cloud request reuse', () => {
  beforeEach(() => {
    clearOllamaCloudModelRequestCacheForTests()
    testState.globalFetch.mockReset()
  })

  it('shares rapid same-key requests and briefly reuses a successful catalog', async () => {
    let resolveResponse!: (response: ReturnType<typeof cloudResponse>) => void
    testState.globalFetch.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveResponse = resolve
      }),
    )

    const first = getOllamaModels('', 'cloud', 'same-key')
    const second = getOllamaModels('', 'cloud', 'same-key')
    await Promise.resolve()

    expect(testState.globalFetch).toHaveBeenCalledTimes(1)
    resolveResponse(cloudResponse('cloud-model'))
    const [firstModels, secondModels] = await Promise.all([first, second])
    const cachedModels = await getOllamaModels('', 'cloud', 'same-key')

    expect(firstModels).toEqual(secondModels)
    expect(cachedModels).toEqual(firstModels)
    expect(testState.globalFetch).toHaveBeenCalledTimes(1)
  })

  it('uses the changed key for a separate request and result', async () => {
    testState.globalFetch.mockImplementation(async (_url: string, options: { headers: Record<string, string> }) => {
      const suffix = options.headers.Authorization.endsWith('first-key') ? 'first' : 'second'
      return cloudResponse(`${suffix}-model`)
    })

    const firstModels = await getOllamaModels('', 'cloud', 'first-key')
    const secondModels = await getOllamaModels('', 'cloud', 'second-key')

    expect(firstModels[0].id).toBe('first-model')
    expect(secondModels[0].id).toBe('second-model')
    expect(testState.globalFetch).toHaveBeenCalledTimes(2)
    expect(testState.globalFetch.mock.calls[0][1].headers).toEqual({ Authorization: 'Bearer first-key' })
    expect(testState.globalFetch.mock.calls[1][1].headers).toEqual({ Authorization: 'Bearer second-key' })
  })
})
