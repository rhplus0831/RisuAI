import { describe, expect, it } from 'vitest'
import { prefersMinimalResponse } from '../src/http.js'

describe('Prefer header parsing', () => {
  it('recognizes return=minimal across combined headers, casing, and parameters', () => {
    expect(prefersMinimalResponse('respond-async, RETURN=MINIMAL; wait=10')).toBe(true)
    expect(prefersMinimalResponse(['respond-async', 'return=minimal'])).toBe(true)
  })

  it('does not match absent or partial preference tokens', () => {
    expect(prefersMinimalResponse(undefined)).toBe(false)
    expect(prefersMinimalResponse('return=representation')).toBe(false)
    expect(prefersMinimalResponse('x-return=minimal')).toBe(false)
  })
})
