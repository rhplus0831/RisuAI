import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const validModels = [
  {
    performance: 4.2,
    queued: 0,
    jobs: 1,
    eta: 2,
    type: 'text',
    name: 'worker/model',
    count: 1,
  },
]

async function loadGetHordeModels() {
  return (await import('./getModels')).getHordeModels
}

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Horde model loading', () => {
  it('does not cache a non-success response', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(validModels), { status: 503 }))
      .mockResolvedValueOnce(Response.json(validModels))
    vi.stubGlobal('fetch', fetchMock)
    const getHordeModels = await loadGetHordeModels()

    await expect(getHordeModels()).resolves.toEqual([])
    await expect(getHordeModels()).resolves.toEqual(validModels)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not cache malformed model payloads that would crash rendering', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json([{ name: 'broken', performance: 'fast' }]))
      .mockResolvedValueOnce(Response.json(validModels))
    vi.stubGlobal('fetch', fetchMock)
    const getHordeModels = await loadGetHordeModels()

    await expect(getHordeModels()).resolves.toEqual([])
    await expect(getHordeModels()).resolves.toEqual(validModels)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('shares one in-flight request between concurrent model pickers', async () => {
    let resolveResponse!: (response: Response) => void
    const response = new Promise<Response>((resolve) => {
      resolveResponse = resolve
    })
    const fetchMock = vi.fn(() => response)
    vi.stubGlobal('fetch', fetchMock)
    const getHordeModels = await loadGetHordeModels()

    const first = getHordeModels()
    const second = getHordeModels()
    resolveResponse(Response.json(validModels))

    await expect(first).resolves.toEqual(validModels)
    await expect(second).resolves.toEqual(validModels)
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})
