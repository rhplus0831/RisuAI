import { afterEach, describe, expect, it, vi } from 'vitest'

import { createNonSecurityUuid } from './nonSecurityUuid'

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('createNonSecurityUuid', () => {
  it('prefers crypto.randomUUID when available', () => {
    const randomUUID = vi.fn(() => '11111111-2222-4333-8444-555555555555')
    const getRandomValues = vi.fn()
    vi.stubGlobal('crypto', { randomUUID, getRandomValues })

    expect(createNonSecurityUuid()).toBe('11111111-2222-4333-8444-555555555555')
    expect(randomUUID).toHaveBeenCalledOnce()
    expect(getRandomValues).not.toHaveBeenCalled()
  })

  it('uses crypto.getRandomValues and sets the UUID version and variant bits', () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      bytes.forEach((_value, index) => {
        bytes[index] = index
      })
      return bytes
    })
    vi.stubGlobal('crypto', { getRandomValues })

    expect(createNonSecurityUuid()).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f')
    expect(getRandomValues).toHaveBeenCalledOnce()
  })

  it('keeps fallback IDs unique and RFC4122-shaped without WebCrypto UUID methods', () => {
    vi.stubGlobal('crypto', {})
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    vi.spyOn(Math, 'random').mockReturnValue(0)

    const ids = Array.from({ length: 1_000 }, () => createNonSecurityUuid())

    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every((id) => UUID_V4_PATTERN.test(id))).toBe(true)
  })
})
