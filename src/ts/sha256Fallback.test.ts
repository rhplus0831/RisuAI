import { afterEach, describe, expect, it, vi } from 'vitest'

import { sha256Bytes, sha256Hex } from './sha256Fallback'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SHA-256 fallback', () => {
  it('passes ArrayBuffer-backed byte views to WebCrypto without copying them', async () => {
    const input = new Uint8Array([1, 2, 3, 4])
    const digest = vi.fn(async () => new ArrayBuffer(32))
    vi.stubGlobal('crypto', { subtle: { digest } })

    await sha256Bytes(input)

    expect(digest).toHaveBeenCalledWith('SHA-256', input)
  })

  it.each([
    ['string', 'RisuAI insecure-origin digest'],
    ['Uint8Array', new Uint8Array([0, 1, 2, 127, 128, 254, 255])],
  ] as const)('matches WebCrypto for %s input', async (_label, input) => {
    const cryptoApi = globalThis.crypto
    const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input
    const expectedBytes = new Uint8Array(await cryptoApi.subtle.digest('SHA-256', bytes))
    const expectedHex = Array.from(expectedBytes, (byte) => byte.toString(16).padStart(2, '0')).join('')

    vi.stubGlobal('crypto', {
      getRandomValues: cryptoApi.getRandomValues.bind(cryptoApi),
      randomUUID: cryptoApi.randomUUID.bind(cryptoApi),
    })

    await expect(sha256Bytes(input)).resolves.toEqual(expectedBytes)
    await expect(sha256Hex(input)).resolves.toBe(expectedHex)
  })
})
