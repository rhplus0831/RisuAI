import { describe, expect, it, vi } from 'vitest'
import { readServerAssetBytes, serverAssetIdFromReference, serverAssetUrl } from './assets'

describe('Fastify server asset helpers', () => {
  it('resolves raw server asset ids and legacy asset paths', () => {
    const rawId = 'a'.repeat(64)
    const legacyId = 'b'.repeat(64)

    expect(serverAssetIdFromReference(rawId)).toBe(rawId)
    expect(serverAssetIdFromReference(`assets/${legacyId}.wav`)).toBe(legacyId)
    expect(serverAssetIdFromReference('assets/not-a-sha.wav')).toBeNull()
    expect(serverAssetUrl(rawId)).toBe(`/api/v1/assets/${rawId}`)
    expect(serverAssetUrl(`assets/${legacyId}.png`)).toBe(`/api/v1/assets/${legacyId}`)
  })

  it('reads server asset bytes with auth headers', async () => {
    const assetId = 'c'.repeat(64)
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }))

    await expect(readServerAssetBytes(assetId, { auth: 'asset-auth', fetchImpl })).resolves.toEqual(
      new Uint8Array([1, 2, 3]),
    )

    expect(fetchImpl).toHaveBeenCalledWith(`/api/v1/assets/${assetId}`, {
      headers: { 'risu-auth': 'asset-auth' },
    })
  })

  it('surfaces server asset read failures', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 404 }))

    await expect(
      readServerAssetBytes('https://example.invalid/missing.png', {
        auth: 'asset-auth',
        fetchImpl,
      }),
    ).rejects.toThrow('Failed to read server asset: 404')
  })
})
