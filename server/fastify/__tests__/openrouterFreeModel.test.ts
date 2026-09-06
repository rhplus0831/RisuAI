import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearOpenRouterFreeModelCacheForTests,
  OPENROUTER_FREE_MODEL_CACHE_TTL_MS,
  resolveOpenRouterFreeModel,
  selectFreeOpenRouterModel,
} from '../src/generation/openrouterFreeModel.js'

function catalogModel(
  id: string,
  contextLength: number,
  promptPrice = '0',
  completionPrice = '0',
): Record<string, unknown> {
  return {
    id,
    name: `Provider: ${id}`,
    context_length: contextLength,
    pricing: { prompt: promptPrice, completion: completionPrice },
  }
}

function catalogResponse(models: Record<string, unknown>[]): Response {
  return new Response(JSON.stringify({ data: models }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('OpenRouter risu/free resolution', () => {
  beforeEach(() => {
    clearOpenRouterFreeModelCacheForTests()
  })

  it('ports the baseline free-price filter and keeps catalog order for the largest-context tie', () => {
    expect(
      selectFreeOpenRouterModel({
        data: [
          catalogModel('paid/largest', 1_000_000, '0.01', '0.01'),
          catalogModel('free/smaller:free', 32_000),
          catalogModel('free/first-tie:free', 128_000),
          catalogModel('free/second-tie:free', 128_000),
          catalogModel('invalid/negative', 2_000_000, '-1', '-1'),
        ],
      }),
    ).toBe('free/first-tie:free')
  })

  it('fetches only the fixed catalog endpoint and reuses the credential-scoped value for the TTL', async () => {
    let now = 1_000
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(catalogResponse([catalogModel('free/initial:free', 64_000)]))
      .mockResolvedValueOnce(catalogResponse([catalogModel('free/refreshed:free', 128_000)]))

    await expect(
      resolveOpenRouterFreeModel('risu/free', {
        apiKey: 'sk-openrouter-cache',
        fetchImpl: fetchImpl as typeof fetch,
        now: () => now,
      }),
    ).resolves.toBe('free/initial:free')

    now += OPENROUTER_FREE_MODEL_CACHE_TTL_MS - 1
    await expect(
      resolveOpenRouterFreeModel('risu/free', {
        apiKey: 'sk-openrouter-cache',
        fetchImpl: fetchImpl as typeof fetch,
        now: () => now,
      }),
    ).resolves.toBe('free/initial:free')
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    now += 1
    await expect(
      resolveOpenRouterFreeModel('risu/free', {
        apiKey: 'sk-openrouter-cache',
        fetchImpl: fetchImpl as typeof fetch,
        now: () => now,
      }),
    ).resolves.toBe('free/refreshed:free')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://openrouter.ai/api/v1/models')
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({
      method: 'GET',
      headers: expect.objectContaining({ Authorization: 'Bearer sk-openrouter-cache' }),
      signal: expect.any(AbortSignal),
    })
  })

  it('uses a stale cached model when a refresh fetch fails', async () => {
    let now = 5_000
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(catalogResponse([catalogModel('free/stale:free', 64_000)]))
      .mockRejectedValueOnce(new Error('catalog offline'))

    await resolveOpenRouterFreeModel('risu/free', {
      apiKey: 'sk-openrouter-stale',
      fetchImpl: fetchImpl as typeof fetch,
      now: () => now,
    })
    now += OPENROUTER_FREE_MODEL_CACHE_TTL_MS

    await expect(
      resolveOpenRouterFreeModel('risu/free', {
        apiKey: 'sk-openrouter-stale',
        fetchImpl: fetchImpl as typeof fetch,
        now: () => now,
      }),
    ).resolves.toBe('free/stale:free')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('fails clearly when the catalog cannot be fetched without a cache or has no eligible free model', async () => {
    await expect(
      resolveOpenRouterFreeModel('risu/free', {
        apiKey: 'sk-openrouter-offline',
        fetchImpl: vi.fn().mockRejectedValue(new Error('offline')) as typeof fetch,
      }),
    ).rejects.toThrow(
      'Unable to resolve OpenRouter model "risu/free": the model catalog request failed and no cached free model is available.',
    )

    await expect(
      resolveOpenRouterFreeModel('risu/free', {
        apiKey: 'sk-openrouter-paid-only',
        fetchImpl: vi
          .fn()
          .mockResolvedValue(catalogResponse([catalogModel('paid/only', 128_000, '0.01', '0.02')])) as typeof fetch,
      }),
    ).rejects.toThrow(
      'Unable to resolve OpenRouter model "risu/free": the model catalog contains no eligible free model.',
    )
  })
})
