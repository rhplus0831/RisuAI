import { describe, expect, it } from 'vitest'
import { serializePersonaCollectionDigestInput } from './personaMutationCertificate'

describe('persona mutation certificate serialization', () => {
  it('canonicalizes object key order recursively', () => {
    const left = [{ id: 'persona-a', nested: { z: 1, a: 2 }, name: 'A' }]
    const right = [{ name: 'A', nested: { a: 2, z: 1 }, id: 'persona-a' }]

    expect(serializePersonaCollectionDigestInput(left)).toBe(serializePersonaCollectionDigestInput(right))
  })

  it('preserves own __proto__ keys in the canonical digest input', () => {
    const left = JSON.parse('[{"id":"persona-a","__proto__":{"value":"left"},"nested":{"__proto__":"nested-left"}}]')
    const right = JSON.parse('[{"id":"persona-a","__proto__":{"value":"right"},"nested":{"__proto__":"nested-right"}}]')

    expect(serializePersonaCollectionDigestInput(left)).not.toBe(serializePersonaCollectionDigestInput(right))
    expect(serializePersonaCollectionDigestInput(left)).toContain('"__proto__"')
  })
})
