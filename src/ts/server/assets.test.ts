import { describe, expect, it, vi } from 'vitest'
import { readServerAsset, readServerAssetBytes, serverAssetIdFromReference, serverAssetUrl } from './assets'
import { getProtocolDiagnosticsSnapshot } from './protocolDiagnostics'

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

  it('rejects unsupported references before attaching auth', async () => {
    const fetchImpl = vi.fn()

    await expect(
      readServerAssetBytes('https://example.invalid/missing.png', {
        auth: 'asset-auth',
        fetchImpl,
      }),
    ).rejects.toThrow('Unsupported server asset reference')

    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('surfaces server asset read failures', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 404 }))

    await expect(
      readServerAssetBytes('d'.repeat(64), {
        auth: 'asset-auth',
        fetchImpl,
      }),
    ).rejects.toThrow('Failed to read server asset: 404')
  })
})

// Asset-byte fanout diagnostics count JS-driven reads and repeated ids without
// changing read behavior.
describe('asset byte read fanout diagnostics', () => {
  it('counts requests, unique ids, and repeated-id fanout', async () => {
    const idA = 'a'.repeat(64)
    const idB = 'b'.repeat(64)
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([1]), { status: 200 }))

    const before = getProtocolDiagnosticsSnapshot().assetByteReads

    // Two reads of A (one repeat) and one of B: 3 requests, 2 unique ids, 1
    // repeated read, worst single-id read count is 2.
    await readServerAsset(idA, { auth: 'asset-auth', fetchImpl })
    await readServerAsset(idA, { auth: 'asset-auth', fetchImpl })
    await readServerAsset(`assets/${idB}.png`, { auth: 'asset-auth', fetchImpl })

    const after = getProtocolDiagnosticsSnapshot().assetByteReads
    expect(after.requests - before.requests).toBe(3)
    expect(after.uniqueIds - before.uniqueIds).toBe(2)
    expect(after.repeatedReads - before.repeatedReads).toBe(1)
    expect(after.maxReadsForSingleId).toBeGreaterThanOrEqual(2)
  })

  it('does not record a byte read for an unsupported reference', async () => {
    const fetchImpl = vi.fn()
    const before = getProtocolDiagnosticsSnapshot().assetByteReads

    await expect(
      readServerAsset('https://example.invalid/missing.png', { auth: 'asset-auth', fetchImpl }),
    ).rejects.toThrow('Unsupported server asset reference')

    const after = getProtocolDiagnosticsSnapshot().assetByteReads
    expect(after.requests - before.requests).toBe(0)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
