export function isLastCharPunctuation(s: string): boolean {
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

export function trimUntilPunctuation(s: string): string {
  let result = s
  while (result.length > 0 && !isLastCharPunctuation(result)) {
    result = result.slice(0, -1)
  }
  return result
}
