import { Worker } from 'node:worker_threads'
import type { Database } from '../../../../src/ts/storage/database.svelte'

export const BOUNDED_REGEX_LIMITS = {
  pattern: 4_096,
  haystack: 128 * 1024,
  replacement: 64 * 1024,
  output: 128 * 1024,
} as const

export const DEFAULT_COMPLEX_REGEX_TIMEOUT_MS = 15_000

const MAX_COMPLEX_REGEX_TIMEOUT_MS = 10 * 60 * 1000

export type BoundedRegexStage = 'input' | 'output' | 'display'

export interface BoundedRegexCompatibilityOptions {
  enabled: boolean
  stage: BoundedRegexStage
  timeoutMs: number
}

export interface ComplexBoundedRegex {
  kind: 'complex-bounded-regex'
  pattern: string
  flags: string
  context: string
}

export type BoundedRegexLike = RegExp | ComplexBoundedRegex

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

export function isBoundedRegexComplexityError(err: unknown): boolean {
  return isBoundedRegexError(err) && err.message.includes('complexity screen rejected')
}

function reject(context: string, message: string): never {
  throw new BoundedRegexError(`${context}: ${message}`)
}

function assertLength(
  value: string,
  limit: number,
  label: 'pattern' | 'haystack' | 'replacement' | 'output',
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

export function assertBoundedRegexOutput(output: string, context: string): void {
  assertLength(output, BOUNDED_REGEX_LIMITS.output, 'output', context)
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

function assertNoOverlappingQuantifiedAlternatives(pattern: string, context: string): void {
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
    if (start === undefined) continue
    const outerQuantifier = isUnboundedQuantifier(pattern, index + 1)
    if (!outerQuantifier.matched) continue

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
            if (sequencesOverlap(left, right)) {
              reject(context, 'complexity screen rejected overlapping quantified alternatives')
            }
          }
        }
      }
    }
  }
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

  assertNoOverlappingQuantifiedAlternatives(pattern, context)
}

export function compileBoundedRegex(pattern: string, flags: string, context: string): RegExp {
  assertBoundedRegexPattern(pattern, context)
  const regex = new RegExp(pattern, flags)
  assertSafeRegexComplexity(pattern, context)
  return regex
}

export function isComplexBoundedRegex(regex: BoundedRegexLike): regex is ComplexBoundedRegex {
  return !(regex instanceof RegExp) && regex.kind === 'complex-bounded-regex'
}

export function complexRegexCompatibilityOptions(
  database: Database,
  stage: BoundedRegexStage,
): BoundedRegexCompatibilityOptions {
  const timeoutKey =
    stage === 'output'
      ? 'complexRegexOutputTimeoutMs'
      : stage === 'display'
        ? 'complexRegexDisplayTimeoutMs'
        : 'complexRegexInputTimeoutMs'
  const rawTimeout = database[timeoutKey]
  const timeoutMs =
    typeof rawTimeout === 'number' && Number.isFinite(rawTimeout)
      ? Math.max(0, Math.min(MAX_COMPLEX_REGEX_TIMEOUT_MS, Math.floor(rawTimeout)))
      : DEFAULT_COMPLEX_REGEX_TIMEOUT_MS
  return {
    enabled: database.complexRegexCompatibilityMode === 'worker' && timeoutMs > 0,
    stage,
    timeoutMs,
  }
}

export function compileBoundedRegexWithCompatibility(
  pattern: string,
  flags: string,
  context: string,
  options: BoundedRegexCompatibilityOptions,
): BoundedRegexLike {
  try {
    return compileBoundedRegex(pattern, flags, context)
  } catch (err) {
    if (options.enabled && isBoundedRegexComplexityError(err)) {
      return {
        kind: 'complex-bounded-regex',
        pattern,
        flags,
        context,
      }
    }
    throw err
  }
}

export function testBoundedRegex(regex: RegExp, haystack: string, context: string): boolean {
  assertBoundedRegexHaystack(haystack, context)
  regex.lastIndex = 0
  return regex.test(haystack)
}

type ComplexRegexWorkerRequest =
  | { operation: 'test'; pattern: string; flags: string; haystack: string }
  | { operation: 'replace'; pattern: string; flags: string; haystack: string; replacement: string }
  | { operation: 'split'; pattern: string; flags: string; haystack: string }
  | { operation: 'matchFirst'; pattern: string; flags: string; haystack: string }
  | {
      operation: 'move'
      pattern: string
      flags: string
      haystack: string
      replacement: string
      toTop: boolean
    }
  | {
      operation: 'triggerReplace'
      pattern: string
      flags: string
      haystack: string
      resultFormat: string
      replacement: string
    }

type ComplexRegexWorkerValue = boolean | string | string[] | null

type BoundedReplacement = (
  match: string,
  captures: Array<string | undefined>,
  offset: number,
  source: string,
  groups: Record<string, string | undefined> | undefined,
) => string

function expandReplacementTemplate(
  template: string,
  match: string,
  captures: Array<string | undefined>,
  offset: number,
  source: string,
  groups: Record<string, string | undefined> | undefined,
  context: string,
): string {
  const tokenRegex = /\$(\$|&|`|'|<[^>]*>|\d{1,2})/g
  const chunks: string[] = []
  let outputLength = 0
  let cursor = 0
  const append = (value: string): void => {
    outputLength += value.length
    if (outputLength > BOUNDED_REGEX_LIMITS.output) {
      reject(context, `output length ${outputLength} exceeds cap ${BOUNDED_REGEX_LIMITS.output}`)
    }
    chunks.push(value)
  }
  let tokenMatch: RegExpExecArray | null
  while ((tokenMatch = tokenRegex.exec(template)) !== null) {
    const placeholder = tokenMatch[0]
    const token = tokenMatch[1]
    append(template.slice(cursor, tokenMatch.index))
    let expanded: string
    if (token === '$') expanded = '$'
    else if (token === '&') expanded = match
    else if (token === '`') expanded = source.slice(0, offset)
    else if (token === "'") expanded = source.slice(offset + match.length)
    else if (token.startsWith('<')) expanded = groups ? (groups[token.slice(1, -1)] ?? '') : placeholder
    else {
      const captureIndex = Number(token)
      if (captureIndex > 0 && captureIndex <= captures.length) expanded = captures[captureIndex - 1] ?? ''
      else if (token.length === 2) {
        const firstCaptureIndex = Number(token[0])
        expanded =
          firstCaptureIndex > 0 && firstCaptureIndex <= captures.length
            ? `${captures[firstCaptureIndex - 1] ?? ''}${token[1]}`
            : placeholder
      } else {
        expanded = placeholder
      }
    }
    append(expanded)
    cursor = tokenRegex.lastIndex
  }
  append(template.slice(cursor))
  return chunks.join('')
}

function replaceWithCallbackBounded(
  haystack: string,
  regex: RegExp,
  replacement: BoundedReplacement,
  context: string,
): string {
  const chunks: string[] = []
  let outputLength = 0
  let cursor = 0
  const append = (value: string): void => {
    outputLength += value.length
    if (outputLength > BOUNDED_REGEX_LIMITS.output) {
      reject(context, `output length ${outputLength} exceeds cap ${BOUNDED_REGEX_LIMITS.output}`)
    }
    chunks.push(value)
  }

  haystack.replace(regex, (...rawArgs: unknown[]) => {
    const match = rawArgs[0] as string
    const possibleGroups = rawArgs.at(-1)
    const groups =
      typeof possibleGroups === 'object' && possibleGroups !== null
        ? (possibleGroups as Record<string, string | undefined>)
        : undefined
    const offsetIndex = groups ? rawArgs.length - 3 : rawArgs.length - 2
    const offset = rawArgs[offsetIndex] as number
    const captures = rawArgs.slice(1, offsetIndex) as Array<string | undefined>
    append(haystack.slice(cursor, offset))
    append(replacement(match, captures, offset, haystack, groups))
    cursor = offset + match.length
    return ''
  })
  append(haystack.slice(cursor))
  return chunks.join('')
}

function replaceStringBounded(haystack: string, regex: RegExp, replacement: string, context: string): string {
  return replaceWithCallbackBounded(
    haystack,
    regex,
    (match, captures, offset, source, groups) =>
      expandReplacementTemplate(replacement, match, captures, offset, source, groups, context),
    context,
  )
}

function replaceFirstStringBounded(source: string, target: string, replacement: string, context: string): string {
  const offset = source.indexOf(target)
  if (offset < 0) return source
  const expanded = expandReplacementTemplate(replacement, target, [], offset, source, undefined, context)
  const outputLength = source.length - target.length + expanded.length
  if (outputLength > BOUNDED_REGEX_LIMITS.output) {
    reject(context, `output length ${outputLength} exceeds cap ${BOUNDED_REGEX_LIMITS.output}`)
  }
  return source.slice(0, offset) + expanded + source.slice(offset + target.length)
}

function expandTriggerResultFormat(
  resultFormat: string,
  match: string,
  captures: Array<string | undefined>,
  context: string,
): string {
  const chunks: string[] = []
  const tokenRegex = /\$\d+|\$&|\$\$/g
  let outputLength = 0
  let cursor = 0
  const append = (value: string): void => {
    outputLength += value.length
    if (outputLength > BOUNDED_REGEX_LIMITS.output) {
      reject(context, `output length ${outputLength} exceeds cap ${BOUNDED_REGEX_LIMITS.output}`)
    }
    chunks.push(value)
  }
  let tokenMatch: RegExpExecArray | null
  while ((tokenMatch = tokenRegex.exec(resultFormat)) !== null) {
    const token = tokenMatch[0]
    append(resultFormat.slice(cursor, tokenMatch.index))
    if (token === '$&') append(match)
    else if (token === '$$') append('$')
    else {
      const index = Number(token.slice(1))
      append(index === 0 ? match : (captures[index - 1] ?? ''))
    }
    cursor = tokenRegex.lastIndex
  }
  append(resultFormat.slice(cursor))
  return chunks.join('')
}

function assertTemplateExpansionBound(template: string, maximumExpansion: number, context: string): void {
  let dollarCount = 0
  for (const character of template) {
    if (character === '$') dollarCount++
  }
  const projectedLength = template.length + dollarCount * maximumExpansion
  if (projectedLength > BOUNDED_REGEX_LIMITS.output) {
    reject(context, `output length ${projectedLength} exceeds cap ${BOUNDED_REGEX_LIMITS.output}`)
  }
}

function advanceStringIndex(value: string, index: number, unicode: boolean): number {
  if (!unicode || index + 1 >= value.length) return index + 1
  const first = value.charCodeAt(index)
  if (first < 0xd800 || first > 0xdbff) return index + 1
  const second = value.charCodeAt(index + 1)
  return second >= 0xdc00 && second <= 0xdfff ? index + 2 : index + 1
}

function splitStringBounded(haystack: string, regex: RegExp, context: string): string[] {
  const flags = `${regex.flags.replace(/[gy]/g, '')}g`
  const scanner = new RegExp(regex.source, flags)
  let projectedLength = 0
  let projectedItems = 0
  let previousEnd = 0
  let match: RegExpExecArray | null

  while ((match = scanner.exec(haystack)) !== null) {
    const matchEnd = match.index + match[0].length
    if (matchEnd !== previousEnd) {
      projectedItems += match.length
      if (projectedItems > BOUNDED_REGEX_LIMITS.output + 1) {
        reject(context, `output item count ${projectedItems} exceeds cap ${BOUNDED_REGEX_LIMITS.output}`)
      }
      projectedLength += match.index - previousEnd
      for (let index = 1; index < match.length; index++) {
        projectedLength += match[index]?.length ?? 0
      }
      if (projectedLength > BOUNDED_REGEX_LIMITS.output) {
        reject(context, `output length ${projectedLength} exceeds cap ${BOUNDED_REGEX_LIMITS.output}`)
      }
      previousEnd = matchEnd
    }
    if (match[0].length === 0) {
      scanner.lastIndex = advanceStringIndex(haystack, scanner.lastIndex, scanner.unicode)
    }
  }
  projectedItems++
  projectedLength += haystack.length - previousEnd
  if (projectedItems > BOUNDED_REGEX_LIMITS.output + 1) {
    reject(context, `output item count ${projectedItems} exceeds cap ${BOUNDED_REGEX_LIMITS.output}`)
  }
  if (projectedLength > BOUNDED_REGEX_LIMITS.output) {
    reject(context, `output length ${projectedLength} exceeds cap ${BOUNDED_REGEX_LIMITS.output}`)
  }

  const output = haystack.split(regex)
  if (output.length > BOUNDED_REGEX_LIMITS.output) {
    reject(context, `output item count ${output.length} exceeds cap ${BOUNDED_REGEX_LIMITS.output}`)
  }
  const outputLength = output.reduce((total, value) => total + value.length, 0)
  if (outputLength > BOUNDED_REGEX_LIMITS.output) {
    reject(context, `output length ${outputLength} exceeds cap ${BOUNDED_REGEX_LIMITS.output}`)
  }
  return output
}

const COMPLEX_REGEX_WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads')

const limits = ${JSON.stringify(BOUNDED_REGEX_LIMITS)}

function assertLength(value, limit, label) {
  if (typeof value !== 'string') throw new Error(label + ' must be a string')
  if (value.length > limit) throw new Error(label + ' length ' + value.length + ' exceeds cap ' + limit)
}

function assertTemplateExpansionBound(template, maximumExpansion) {
  let dollarCount = 0
  for (const character of template) {
    if (character === '$') dollarCount++
  }
  const projectedLength = template.length + dollarCount * maximumExpansion
  if (projectedLength > limits.output) {
    throw new Error('output length ' + projectedLength + ' exceeds cap ' + limits.output)
  }
}

function expandReplacementTemplate(template, match, captures, offset, source, groups) {
  return template.replace(/\\$(\\$|&|\\x60|'|<[^>]*>|\\d{1,2})/g, (placeholder, token) => {
    if (token === '$') return '$'
    if (token === '&') return match
    if (token === '\x60') return source.slice(0, offset)
    if (token === "'") return source.slice(offset + match.length)
    if (token.startsWith('<')) {
      if (!groups) return placeholder
      return groups[token.slice(1, -1)] ?? ''
    }
    const captureIndex = Number(token)
    if (captureIndex > 0 && captureIndex <= captures.length) return captures[captureIndex - 1] ?? ''
    if (token.length === 2) {
      const firstCaptureIndex = Number(token[0])
      if (firstCaptureIndex > 0 && firstCaptureIndex <= captures.length) {
        return (captures[firstCaptureIndex - 1] ?? '') + token[1]
      }
    }
    return placeholder
  })
}

function replaceWithCallbackBounded(haystack, regex, replacement) {
  const chunks = []
  let outputLength = 0
  let cursor = 0
  const append = (value) => {
    outputLength += value.length
    if (outputLength > limits.output) {
      throw new Error('output length ' + outputLength + ' exceeds cap ' + limits.output)
    }
    chunks.push(value)
  }
  haystack.replace(regex, (...rawArgs) => {
    const match = rawArgs[0]
    const possibleGroups = rawArgs.at(-1)
    const groups = typeof possibleGroups === 'object' && possibleGroups !== null ? possibleGroups : undefined
    const offsetIndex = groups ? rawArgs.length - 3 : rawArgs.length - 2
    const offset = rawArgs[offsetIndex]
    const captures = rawArgs.slice(1, offsetIndex)
    append(haystack.slice(cursor, offset))
    append(replacement(match, captures, offset, haystack, groups))
    cursor = offset + match.length
    return ''
  })
  append(haystack.slice(cursor))
  return chunks.join('')
}

function replaceStringBounded(haystack, regex, replacement) {
  return replaceWithCallbackBounded(haystack, regex, (match, captures, offset, source, groups) => {
    assertTemplateExpansionBound(replacement, source.length)
    return expandReplacementTemplate(replacement, match, captures, offset, source, groups)
  })
}

function advanceStringIndex(value, index, unicode) {
  if (!unicode || index + 1 >= value.length) return index + 1
  const first = value.charCodeAt(index)
  if (first < 0xd800 || first > 0xdbff) return index + 1
  const second = value.charCodeAt(index + 1)
  return second >= 0xdc00 && second <= 0xdfff ? index + 2 : index + 1
}

function splitStringBounded(haystack, regex) {
  const flags = regex.flags.replace(/[gy]/g, '') + 'g'
  const scanner = new RegExp(regex.source, flags)
  let projectedLength = 0
  let projectedItems = 0
  let previousEnd = 0
  let match
  while ((match = scanner.exec(haystack)) !== null) {
    const matchEnd = match.index + match[0].length
    if (matchEnd !== previousEnd) {
      projectedItems += match.length
      if (projectedItems > limits.output + 1) {
        throw new Error('output item count ' + projectedItems + ' exceeds cap ' + limits.output)
      }
      projectedLength += match.index - previousEnd
      for (let index = 1; index < match.length; index++) {
        projectedLength += match[index]?.length ?? 0
      }
      if (projectedLength > limits.output) {
        throw new Error('output length ' + projectedLength + ' exceeds cap ' + limits.output)
      }
      previousEnd = matchEnd
    }
    if (match[0].length === 0) {
      scanner.lastIndex = advanceStringIndex(haystack, scanner.lastIndex, scanner.unicode)
    }
  }
  projectedItems++
  projectedLength += haystack.length - previousEnd
  if (projectedItems > limits.output + 1) {
    throw new Error('output item count ' + projectedItems + ' exceeds cap ' + limits.output)
  }
  if (projectedLength > limits.output) {
    throw new Error('output length ' + projectedLength + ' exceeds cap ' + limits.output)
  }
  const output = haystack.split(regex)
  if (output.length > limits.output) {
    throw new Error('output item count ' + output.length + ' exceeds cap ' + limits.output)
  }
  const outputLength = output.reduce((total, value) => total + value.length, 0)
  if (outputLength > limits.output) {
    throw new Error('output length ' + outputLength + ' exceeds cap ' + limits.output)
  }
  return output
}

function substituteMoveMatch(template, matched) {
  return template
    .replace(/(?<!\\$)\\$[0-9]+/g, (v) => {
      const index = parseInt(v.substring(1))
      if (index < matched.length) return matched[index] ?? v
      return v
    })
    .replace(/\\$\\&/g, matched[0])
    .replace(/(?<!\\$)\\$<([^>]+)>/g, (v) => {
      const groupName = parseInt(v.substring(2, v.length - 1))
      if (matched.groups && matched.groups[groupName]) return matched.groups[groupName]
      return v
    })
}

function triggerReplaceValue(source, regex, resultFormat, replacement) {
  return replaceWithCallbackBounded(source, regex, (match, groups) => {
    assertTemplateExpansionBound(resultFormat, match.length)
    const targetGroupMatch = resultFormat.match(/^\\$(\\d+)$/)
    if (targetGroupMatch) {
      const targetIndex = Number(targetGroupMatch[1])
      if (targetIndex === 0) return replacement
      const targetGroup = groups[targetIndex - 1]
      if (targetGroup) {
        assertTemplateExpansionBound(replacement, match.length)
        return match.replace(targetGroup, replacement)
      }
    }
    return resultFormat
      .replace(/\\$[0-9]+/g, (placeholder) => {
        const index = Number(placeholder.slice(1))
        return index === 0 ? match : groups[index - 1] || ''
      })
      .replace(/\\$&/g, match)
      .replace(/\\$\\$/g, '$')
  })
}

try {
  const request = workerData
  assertLength(request.pattern, limits.pattern, 'pattern')
  assertLength(request.haystack, limits.haystack, 'haystack')
  const regex = new RegExp(request.pattern, request.flags)
  let value
  if (request.operation === 'test') {
    value = regex.test(request.haystack)
  } else if (request.operation === 'replace') {
    assertLength(request.replacement, limits.replacement, 'replacement')
    value = replaceStringBounded(request.haystack, regex, request.replacement)
  } else if (request.operation === 'split') {
    value = splitStringBounded(request.haystack, regex)
  } else if (request.operation === 'matchFirst') {
    const match = request.haystack.match(regex)
    value = match ? match[0] : null
  } else if (request.operation === 'move') {
    assertLength(request.replacement, limits.replacement, 'replacement')
    const isGlobal = request.flags.includes('g')
    const matches = isGlobal ? Array.from(request.haystack.matchAll(regex)) : [request.haystack.match(regex)]
    value = replaceStringBounded(request.haystack, regex, '')
    for (const matched of matches) {
      if (!matched) continue
      const template = request.replacement.replace('@@move_top ', '').replace('@@move_bottom ', '')
      assertTemplateExpansionBound(template, matched[0].length)
      const out = substituteMoveMatch(template, matched)
      value = request.toTop ? out + '\\n' + value : value + '\\n' + out
      assertLength(value, limits.output, 'output')
    }
  } else if (request.operation === 'triggerReplace') {
    assertLength(request.resultFormat, limits.replacement, 'result template')
    assertLength(request.replacement, limits.replacement, 'replacement')
    value = triggerReplaceValue(request.haystack, regex, request.resultFormat, request.replacement)
  } else {
    throw new Error('unsupported operation: ' + request.operation)
  }
  parentPort.postMessage({ ok: true, value })
} catch (err) {
  parentPort.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) })
}
`

function runComplexRegexWorker<T extends ComplexRegexWorkerValue>(
  request: ComplexRegexWorkerRequest,
  context: string,
  options: BoundedRegexCompatibilityOptions,
): Promise<T> {
  if (!options.enabled || options.timeoutMs <= 0) {
    reject(context, 'complexity screen rejected nested unbounded quantifiers')
  }

  return new Promise<T>((resolve, rejectPromise) => {
    const worker = new Worker(COMPLEX_REGEX_WORKER_SOURCE, {
      eval: true,
      workerData: request,
    })
    let settled = false
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      void worker.terminate()
      rejectPromise(
        new BoundedRegexError(
          `${context}: complex regex worker timed out after ${options.timeoutMs}ms during ${options.stage} stage`,
        ),
      )
    }, options.timeoutMs)

    worker.once('message', (message: { ok?: boolean; value?: T; error?: string }) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      void worker.terminate()
      if (message?.ok) {
        resolve(message.value as T)
      } else {
        rejectPromise(new BoundedRegexError(`${context}: complex regex worker failed: ${message?.error ?? 'unknown'}`))
      }
    })

    worker.once('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      void worker.terminate()
      rejectPromise(new BoundedRegexError(`${context}: complex regex worker failed: ${err.message}`))
    })
  })
}

export async function testBoundedRegexWithCompatibility(
  regex: BoundedRegexLike,
  haystack: string,
  context: string,
  options: BoundedRegexCompatibilityOptions,
): Promise<boolean> {
  assertBoundedRegexHaystack(haystack, context)
  if (!isComplexBoundedRegex(regex)) {
    return testBoundedRegex(regex, haystack, context)
  }
  return runComplexRegexWorker<boolean>(
    { operation: 'test', pattern: regex.pattern, flags: regex.flags, haystack },
    context,
    options,
  )
}

export async function replaceBoundedRegexWithCompatibility(
  regex: BoundedRegexLike,
  haystack: string,
  replacement: string,
  context: string,
  replacementContext: string,
  options: BoundedRegexCompatibilityOptions,
): Promise<string> {
  assertBoundedRegexHaystack(haystack, context)
  assertBoundedRegexReplacement(replacement, replacementContext)
  if (!isComplexBoundedRegex(regex)) {
    regex.lastIndex = 0
    return replaceStringBounded(haystack, regex, replacement, context)
  }
  return runComplexRegexWorker<string>(
    { operation: 'replace', pattern: regex.pattern, flags: regex.flags, haystack, replacement },
    context,
    options,
  )
}

export async function splitBoundedRegexWithCompatibility(
  regex: BoundedRegexLike,
  haystack: string,
  context: string,
  options: BoundedRegexCompatibilityOptions,
): Promise<string[]> {
  assertBoundedRegexHaystack(haystack, context)
  if (!isComplexBoundedRegex(regex)) {
    regex.lastIndex = 0
    return splitStringBounded(haystack, regex, context)
  }
  return runComplexRegexWorker<string[]>(
    { operation: 'split', pattern: regex.pattern, flags: regex.flags, haystack },
    context,
    options,
  )
}

export async function matchFirstBoundedRegexWithCompatibility(
  regex: BoundedRegexLike,
  haystack: string,
  context: string,
  options: BoundedRegexCompatibilityOptions,
): Promise<string | null> {
  assertBoundedRegexHaystack(haystack, context)
  if (!isComplexBoundedRegex(regex)) {
    regex.lastIndex = 0
    return haystack.match(regex)?.[0] ?? null
  }
  return runComplexRegexWorker<string | null>(
    { operation: 'matchFirst', pattern: regex.pattern, flags: regex.flags, haystack },
    context,
    options,
  )
}

export async function moveBoundedRegexWithCompatibility(
  regex: BoundedRegexLike,
  haystack: string,
  replacement: string,
  toTop: boolean,
  context: string,
  replacementContext: string,
  options: BoundedRegexCompatibilityOptions,
): Promise<string> {
  assertBoundedRegexHaystack(haystack, context)
  assertBoundedRegexReplacement(replacement, replacementContext)
  if (!isComplexBoundedRegex(regex)) {
    regex.lastIndex = 0
    const isGlobal = regex.flags.includes('g')
    const matchAll = isGlobal ? Array.from(haystack.matchAll(regex)) : [haystack.match(regex)]
    let next = replaceStringBounded(haystack, regex, '', context)
    for (const matched of matchAll) {
      if (!matched) continue
      const template = replacement.replace('@@move_top ', '').replace('@@move_bottom ', '')
      assertTemplateExpansionBound(template, matched[0].length, context)
      const out = substituteWorkerCompatibleMatch(template, matched as RegExpMatchArray)
      next = toTop ? out + '\n' + next : next + '\n' + out
      assertBoundedRegexOutput(next, context)
    }
    return next
  }
  return runComplexRegexWorker<string>(
    {
      operation: 'move',
      pattern: regex.pattern,
      flags: regex.flags,
      haystack,
      replacement,
      toTop,
    },
    context,
    options,
  )
}

export async function triggerReplaceBoundedRegexWithCompatibility(
  regex: BoundedRegexLike,
  haystack: string,
  resultFormat: string,
  replacement: string,
  context: string,
  resultContext: string,
  replacementContext: string,
  options: BoundedRegexCompatibilityOptions,
): Promise<string> {
  assertBoundedRegexHaystack(haystack, context)
  assertBoundedRegexReplacement(resultFormat, resultContext)
  assertBoundedRegexReplacement(replacement, replacementContext)
  if (!isComplexBoundedRegex(regex)) {
    regex.lastIndex = 0
    return replaceWithCallbackBounded(
      haystack,
      regex,
      (match, groups) => {
        const targetGroupMatch = resultFormat.match(/^\$(\d+)$/)
        if (targetGroupMatch) {
          const targetIndex = Number(targetGroupMatch[1])
          if (targetIndex === 0) {
            return replacement
          }
          const targetGroup = groups[targetIndex - 1]
          if (targetGroup) {
            return replaceFirstStringBounded(match, targetGroup, replacement, context)
          }
        }
        return expandTriggerResultFormat(resultFormat, match, groups, context)
      },
      context,
    )
  }
  return runComplexRegexWorker<string>(
    {
      operation: 'triggerReplace',
      pattern: regex.pattern,
      flags: regex.flags,
      haystack,
      resultFormat,
      replacement,
    },
    context,
    options,
  )
}

function substituteWorkerCompatibleMatch(template: string, matched: RegExpMatchArray): string {
  return template
    .replace(/(?<!\$)\$[0-9]+/g, (v) => {
      const index = parseInt(v.substring(1))
      if (index < matched.length) return matched[index] ?? v
      return v
    })
    .replace(/\$\&/g, matched[0])
    .replace(/(?<!\$)\$<([^>]+)>/g, (v) => {
      const groupName = parseInt(v.substring(2, v.length - 1))
      if (matched.groups && (matched.groups as Record<string, string>)[groupName as unknown as string]) {
        return (matched.groups as Record<string, string>)[groupName as unknown as string]
      }
      return v
    })
}
