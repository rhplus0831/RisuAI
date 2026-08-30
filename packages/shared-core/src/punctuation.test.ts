import { describe, expect, it } from 'vitest'
import { isLastCharPunctuation, trimUntilPunctuation } from './punctuation.js'

function isLastCharPunctuationBeforeExtraction(s: string): boolean {
  const lastChar = s.trim().at(-1)
  const punctuation = [
    '.',
    '!',
    '?',
    '。',
    '！',
    '？',
    '…',
    '@',
    '#',
    '$',
    '%',
    '^',
    '&',
    '*',
    '(',
    ')',
    '-',
    '_',
    '+',
    '=',
    '{',
    '}',
    '[',
    ']',
    '|',
    '\\',
    ':',
    ';',
    '<',
    '>',
    ',',
    '/',
    '~',
    '`',
    ' ',
    '¡',
    '¿',
    '‽',
    '⁉',
    "'",
    '"',
  ]
  if (
    lastChar &&
    !(
      punctuation.includes(lastChar) ||
      (lastChar.charCodeAt(0) >= 0x02b0 && lastChar.charCodeAt(0) <= 0x02ff) ||
      (lastChar.charCodeAt(0) >= 0x0300 && lastChar.charCodeAt(0) <= 0x036f) ||
      (lastChar.charCodeAt(0) >= 0x0590 && lastChar.charCodeAt(0) <= 0x05cf) ||
      (lastChar.charCodeAt(0) >= 0x3000 && lastChar.charCodeAt(0) <= 0x303f)
    )
  ) {
    return false
  }
  return true
}

function trimUntilPunctuationBeforeExtraction(s: string): string {
  let result = s
  while (result.length > 0 && !isLastCharPunctuationBeforeExtraction(result)) {
    result = result.slice(0, -1)
  }
  return result
}

describe('punctuation classification and trimming', () => {
  it.each(['', '   ', 'word', 'word.', 'word、', 'word！   ', 'wordʰ', 'word\u0301', 'wordא', 'word。', 'word🙂'])(
    'preserves historical final-character classification for %o',
    (input) => {
      expect(isLastCharPunctuation(input)).toBe(isLastCharPunctuationBeforeExtraction(input))
    },
  )

  it.each([
    '',
    '   ',
    'complete.',
    'complete. trailing',
    'complete. trailing🙂',
    'unicode。trailing',
    'combining\u0301tail',
    'no punctuation',
  ])('preserves historical code-unit suffix trimming for %o', (input) => {
    expect(trimUntilPunctuation(input)).toBe(trimUntilPunctuationBeforeExtraction(input))
  })

  it('preserves the untrimmed prefix when trailing whitespace follows punctuation', () => {
    expect(trimUntilPunctuation('complete. trailing')).toBe('complete. ')
  })
})
