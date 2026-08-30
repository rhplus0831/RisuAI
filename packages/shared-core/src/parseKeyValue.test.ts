import { describe, expect, it } from 'vitest'
import { parseKeyValue } from './parseKeyValue.js'

describe('key/value template parsing', () => {
  it.each([
    ['', []],
    [
      'a=1\nb=2',
      [
        ['a', '1'],
        ['b', '2'],
      ],
    ],
    ['a=first=ignored', [['a', 'first']]],
    ['=missing-key\nmissing-value=', []],
    [' spaced = value ', [[' spaced ', ' value ']]],
  ] as const)('preserves historical parsing for %o', (input, expected) => {
    expect(parseKeyValue(input)).toEqual(expected)
  })
})
