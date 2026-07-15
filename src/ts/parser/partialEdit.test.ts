import { describe, expect, it } from 'vitest'
import { findAllOriginalRangesFromText, replaceRange } from './partialEdit'

describe('partial-edit normalized source mapping', () => {
  it('maps an expanded ellipsis without consuming the following character', () => {
    const original = 'A…B'
    const [range] = findAllOriginalRangesFromText(original, '...')

    expect(range).toMatchObject({ start: 1, end: 2, method: 'exact' })
    expect(replaceRange(original, range, 'X')).toBe('AXB')
  })
})
