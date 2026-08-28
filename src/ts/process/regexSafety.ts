export const CLIENT_REGEX_PATTERN_LIMIT = 4_096

export class ClientRegexSafetyError extends Error {
  constructor(message: string) {
    super(`client regex rejected: ${message}`)
    this.name = 'ClientRegexSafetyError'
  }
}

function reject(message: string): never {
  throw new ClientRegexSafetyError(message)
}

function isUnboundedQuantifier(source: string, index: number): { matched: boolean; end: number } {
  const ch = source[index]
  if (ch === '*' || ch === '+') return { matched: true, end: index + 1 }
  if (ch !== '{') return { matched: false, end: index }
  const match = /^\{\d+,\}/.exec(source.slice(index))
  return match ? { matched: true, end: index + match[0].length } : { matched: false, end: index }
}

interface GroupState {
  hasInnerUnboundedQuantifier: boolean
}

interface LastToken {
  kind: 'group' | 'atom'
  hasInnerUnboundedQuantifier: boolean
}

interface SimpleRegexAtom {
  key: string
  matchesAny: boolean
}

type SimpleRegexSequence = SimpleRegexAtom[]

function atomsOverlap(left: SimpleRegexAtom, right: SimpleRegexAtom): boolean {
  return left.matchesAny || right.matchesAny || left.key === right.key
}

function sequencesOverlap(left: SimpleRegexSequence, right: SimpleRegexSequence): boolean {
  const sharedLength = Math.min(left.length, right.length)
  for (let index = 0; index < sharedLength; index++) {
    if (!atomsOverlap(left[index], right[index])) return false
  }
  return true
}

function splitTopLevelAlternatives(source: string): string[] | null {
  const alternatives: string[] = []
  let start = 0
  let depth = 0
  let inClass = false
  for (let index = 0; index < source.length; index++) {
    const ch = source[index]
    if (ch === '\\') {
      index++
      continue
    }
    if (inClass) {
      if (ch === ']') inClass = false
      continue
    }
    if (ch === '[') {
      inClass = true
      continue
    }
    if (ch === '(') depth++
    else if (ch === ')') {
      if (depth === 0) return null
      depth--
    } else if (ch === '|' && depth === 0) {
      alternatives.push(source.slice(start, index))
      start = index + 1
    }
  }
  if (depth !== 0 || inClass) return null
  alternatives.push(source.slice(start))
  return alternatives.length > 1 ? alternatives : null
}

function appendSimpleAtom(
  variants: SimpleRegexSequence[],
  atom: SimpleRegexAtom,
  minimum: number,
  maximum: number,
): SimpleRegexSequence[] | null {
  if (maximum > 8) return null
  const next: SimpleRegexSequence[] = []
  for (const variant of variants) {
    for (let count = minimum; count <= maximum; count++) {
      next.push([...variant, ...Array.from({ length: count }, () => atom)])
      if (next.length > 64) return null
    }
  }
  return next
}

function simpleAlternativeVariants(source: string): SimpleRegexSequence[] | null {
  let variants: SimpleRegexSequence[] = [[]]
  for (let index = 0; index < source.length; index++) {
    const start = index
    const ch = source[index]
    let atom: SimpleRegexAtom
    if (ch === '\\') {
      if (index + 1 >= source.length) return null
      atom = { key: source.slice(index, index + 2), matchesAny: false }
      index++
    } else if (ch === '[') {
      index++
      while (index < source.length && source[index] !== ']') {
        if (source[index] === '\\') index++
        index++
      }
      if (index >= source.length) return null
      atom = { key: source.slice(start, index + 1), matchesAny: false }
    } else if (ch === '(') {
      let depth = 1
      index++
      let inClass = false
      while (index < source.length && depth > 0) {
        if (source[index] === '\\') index++
        else if (inClass) {
          if (source[index] === ']') inClass = false
        } else if (source[index] === '[') inClass = true
        else if (source[index] === '(') depth++
        else if (source[index] === ')') depth--
        index++
      }
      if (depth !== 0) return null
      atom = { key: source.slice(start, index), matchesAny: false }
      index--
    } else if (ch === '.' || (!'|^$*+?{}'.includes(ch) && ch !== ')')) {
      atom = { key: ch, matchesAny: ch === '.' }
    } else {
      return null
    }

    let minimum = 1
    let maximum = 1
    const quantifierIndex = index + 1
    if (source[quantifierIndex] === '?') {
      minimum = 0
      index = quantifierIndex
    } else if (source[quantifierIndex] === '{') {
      const match = /^\{(\d+)(?:,(\d+))?\}/.exec(source.slice(quantifierIndex))
      if (match) {
        minimum = Number(match[1])
        maximum = match[2] === undefined ? minimum : Number(match[2])
        index = quantifierIndex + match[0].length - 1
      }
    }
    const expanded = appendSimpleAtom(variants, atom, minimum, maximum)
    if (!expanded) return null
    variants = expanded
  }
  return variants
}

function normalizedGroupBody(rawBody: string): string | null {
  if (!rawBody.startsWith('?')) return rawBody
  if (rawBody.startsWith('?:')) return rawBody.slice(2)
  const namedCapture = /^\?<[^>]+>/.exec(rawBody)
  return namedCapture ? rawBody.slice(namedCapture[0].length) : null
}

function assertNoOverlappingQuantifiedAlternatives(pattern: string): void {
  const groupStarts: number[] = []
  let inClass = false
  for (let index = 0; index < pattern.length; index++) {
    const ch = pattern[index]
    if (ch === '\\') {
      index++
      continue
    }
    if (inClass) {
      if (ch === ']') inClass = false
      continue
    }
    if (ch === '[') {
      inClass = true
      continue
    }
    if (ch === '(') {
      groupStarts.push(index)
      continue
    }
    if (ch !== ')') continue
    const start = groupStarts.pop()
    if (start === undefined || !isUnboundedQuantifier(pattern, index + 1).matched) continue
    const body = normalizedGroupBody(pattern.slice(start + 1, index))
    if (body === null) continue
    const alternatives = splitTopLevelAlternatives(body)
    if (!alternatives) continue
    const variants = alternatives.map(simpleAlternativeVariants)
    if (variants.some((value) => value === null)) continue
    for (let leftIndex = 0; leftIndex < variants.length; leftIndex++) {
      for (let rightIndex = leftIndex + 1; rightIndex < variants.length; rightIndex++) {
        for (const left of variants[leftIndex] ?? []) {
          for (const right of variants[rightIndex] ?? []) {
            if (sequencesOverlap(left, right)) reject('overlapping quantified alternatives')
          }
        }
      }
    }
  }
}

function assertSafeRegexComplexity(pattern: string): void {
  const stack: GroupState[] = []
  let inClass = false
  let lastToken: LastToken | null = null
  for (let index = 0; index < pattern.length; index++) {
    const ch = pattern[index]
    if (ch === '\\') {
      index++
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
      lastToken = { kind: 'group', hasInnerUnboundedQuantifier: group?.hasInnerUnboundedQuantifier ?? false }
      continue
    }
    const quantifier = isUnboundedQuantifier(pattern, index)
    if (quantifier.matched) {
      if (lastToken?.kind === 'group' && lastToken.hasInnerUnboundedQuantifier) reject('nested unbounded quantifiers')
      const currentGroup = stack.at(-1)
      if (currentGroup) currentGroup.hasInnerUnboundedQuantifier = true
      lastToken = null
      index = quantifier.end - 1
      continue
    }
    if (ch === '|' || ch === '^' || ch === '$') {
      lastToken = null
      continue
    }
    lastToken = { kind: 'atom', hasInnerUnboundedQuantifier: false }
  }
  assertNoOverlappingQuantifiedAlternatives(pattern)
}

export function assertClientRegexPatternSafe(pattern: string): void {
  if (pattern.length > CLIENT_REGEX_PATTERN_LIMIT) {
    reject(`pattern length ${pattern.length} exceeds cap ${CLIENT_REGEX_PATTERN_LIMIT}`)
  }
  assertSafeRegexComplexity(pattern)
}
