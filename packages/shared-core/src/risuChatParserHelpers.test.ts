import { describe, expect, it } from 'vitest'
import {
  dateTimeFormat,
  legacyBlockMatcher,
  makeArray,
  parseArray,
  parseDict,
  risuEscape,
  risuUnescape,
  trimLines,
} from './risuChatParserHelpers.js'

describe('RisuChat parser helpers', () => {
  it('round-trips the historical brace and parenthesis escapes', () => {
    const input = '{a}(b)'
    expect(risuEscape(input)).toBe('\uE9B8a\uE9B9\uE9BAb\uE9BB')
    expect(risuUnescape(risuEscape(input))).toBe(input)
  })

  it('preserves date format prefix handling and bounds', () => {
    expect(dateTimeFormat('', 1)).toBe('')
    expect(dateTimeFormat(':X|x', 1)).toBe('0|1')
    expect(dateTimeFormat('x'.repeat(301), 1)).toBe('')
  })

  it('preserves legacy block truthiness and trimming', () => {
    expect(legacyBlockMatcher('if 1\n kept ', undefined)).toBe('kept')
    expect(legacyBlockMatcher('if 0\n dropped ', undefined)).toBe('')
    expect(legacyBlockMatcher('missing newline', undefined)).toBeNull()
  })

  it('preserves array and dictionary fallbacks', () => {
    expect(parseArray('[1,"two"]')).toEqual([1, 'two'])
    expect(parseArray('one§two')).toEqual(['one', 'two'])
    expect(parseDict('{"key":1}')).toEqual({ key: 1 })
    expect(parseDict('invalid')).toEqual({})
    expect(makeArray(['a::b', 2])).toBe('["a\\\\u003A\\\\u003Ab",2]')
  })

  it('trims leading indentation per line and outer whitespace', () => {
    expect(trimLines('  first\n    second  \n')).toBe('first\nsecond')
  })
})
