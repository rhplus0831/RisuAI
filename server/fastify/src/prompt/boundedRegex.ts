export const BOUNDED_REGEX_LIMITS = {
  pattern: 4_096,
  haystack: 128 * 1024,
  replacement: 64 * 1024,
} as const

export class BoundedRegexError extends Error {
  readonly code = 'RISU_BOUNDED_REGEX'

  constructor(message: string) {
    super(`bounded regex rejected: ${message}`)
    this.name = 'BoundedRegexError'
  }
}

export function isBoundedRegexError(err: unknown): err is BoundedRegexError {
  return (
    err instanceof BoundedRegexError ||
    (typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code?: unknown }).code === 'RISU_BOUNDED_REGEX')
  )
}

function reject(context: string, message: string): never {
  throw new BoundedRegexError(`${context}: ${message}`)
}

function assertLength(
  value: string,
  limit: number,
  label: 'pattern' | 'haystack' | 'replacement',
  context: string,
): void {
  if (value.length > limit) {
    reject(context, `${label} length ${value.length} exceeds cap ${limit}`)
  }
}

export function assertBoundedRegexPattern(pattern: string, context: string): void {
  assertLength(pattern, BOUNDED_REGEX_LIMITS.pattern, 'pattern', context)
}

export function assertBoundedRegexHaystack(haystack: string, context: string): void {
  assertLength(haystack, BOUNDED_REGEX_LIMITS.haystack, 'haystack', context)
}

export function assertBoundedRegexReplacement(replacement: string, context: string): void {
  assertLength(replacement, BOUNDED_REGEX_LIMITS.replacement, 'replacement', context)
}

function isUnboundedQuantifier(source: string, index: number): { matched: boolean; end: number } {
  const ch = source[index]
  if (ch === '*' || ch === '+') {
    return { matched: true, end: index + 1 }
  }
  if (ch !== '{') {
    return { matched: false, end: index }
  }
  const match = /^\{\d+,\}/.exec(source.slice(index))
  if (!match) {
    return { matched: false, end: index }
  }
  return { matched: true, end: index + match[0].length }
}

interface GroupState {
  hasInnerUnboundedQuantifier: boolean
}

interface LastToken {
  kind: 'group' | 'atom'
  hasInnerUnboundedQuantifier: boolean
}

function assertSafeRegexComplexity(pattern: string, context: string): void {
  const stack: GroupState[] = []
  let inClass = false
  let lastToken: LastToken | null = null

  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]

    if (ch === '\\') {
      i++
      lastToken = { kind: 'atom', hasInnerUnboundedQuantifier: false }
      continue
    }

    if (inClass) {
      if (ch === ']') inClass = false
      continue
    }
    if (ch === '[') {
      inClass = true
      lastToken = { kind: 'atom', hasInnerUnboundedQuantifier: false }
      continue
    }

    if (ch === '(') {
      stack.push({ hasInnerUnboundedQuantifier: false })
      lastToken = null
      continue
    }

    if (ch === ')') {
      const group = stack.pop()
      lastToken = {
        kind: 'group',
        hasInnerUnboundedQuantifier: group?.hasInnerUnboundedQuantifier ?? false,
      }
      continue
    }

    const quantifier = isUnboundedQuantifier(pattern, i)
    if (quantifier.matched) {
      if (lastToken?.kind === 'group' && lastToken.hasInnerUnboundedQuantifier) {
        reject(context, 'complexity screen rejected nested unbounded quantifiers')
      }
      const currentGroup = stack.at(-1)
      if (currentGroup) currentGroup.hasInnerUnboundedQuantifier = true
      lastToken = null
      i = quantifier.end - 1
      continue
    }

    if (ch === '|' || ch === '^' || ch === '$') {
      lastToken = null
      continue
    }

    lastToken = { kind: 'atom', hasInnerUnboundedQuantifier: false }
  }
}

export function compileBoundedRegex(pattern: string, flags: string, context: string): RegExp {
  assertBoundedRegexPattern(pattern, context)
  const regex = new RegExp(pattern, flags)
  assertSafeRegexComplexity(pattern, context)
  return regex
}

export function testBoundedRegex(regex: RegExp, haystack: string, context: string): boolean {
  assertBoundedRegexHaystack(haystack, context)
  regex.lastIndex = 0
  return regex.test(haystack)
}
