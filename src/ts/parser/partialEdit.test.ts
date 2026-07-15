import { describe, expect, it } from 'vitest'
import { findAllOriginalRangesFromText, replaceRange } from './partialEdit'

describe('partial-edit normalized source mapping', () => {
  it('maps an expanded ellipsis without consuming the following character', () => {
    const original = 'A…B'
    const [range] = findAllOriginalRangesFromText(original, '...')

    expect(range).toMatchObject({ start: 1, end: 2, method: 'exact' })
    expect(replaceRange(original, range, 'X')).toBe('AXB')
  })

  it('does not run the expensive bigram fallback beyond its configured length cap', () => {
    const plainText = `${'A'.repeat(8)}${'B'.repeat(24)}${'C'.repeat(8)}`
    const original = `${'X'.repeat(8)}${'B'.repeat(24)}${'Y'.repeat(8)}`

    expect(
      findAllOriginalRangesFromText(original, plainText, {
        fuzzyMaxLen: 10,
        bigramMaxLen: 20,
        bigramThreshold: 0.3,
      }),
    ).toEqual([])
  })
})
