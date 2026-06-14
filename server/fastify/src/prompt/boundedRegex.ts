import { Worker } from 'node:worker_threads'
import type { Database } from '../../../../src/ts/storage/database.svelte'

export const BOUNDED_REGEX_LIMITS = {
  pattern: 4_096,
  haystack: 128 * 1024,
  replacement: 64 * 1024,
} as const

export const DEFAULT_COMPLEX_REGEX_TIMEOUT_MS = 10_000

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

const COMPLEX_REGEX_WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads')

const limits = ${JSON.stringify(BOUNDED_REGEX_LIMITS)}

function assertLength(value, limit, label) {
  if (typeof value !== 'string') throw new Error(label + ' must be a string')
  if (value.length > limit) throw new Error(label + ' length ' + value.length + ' exceeds cap ' + limit)
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
  return source.replace(regex, (...args) => {
    const match = args[0]
    const groups = args.slice(1, -2)
    const targetGroupMatch = resultFormat.match(/^\\$(\\d+)$/)
    if (targetGroupMatch) {
      const targetIndex = Number(targetGroupMatch[1])
      if (targetIndex === 0) return replacement
      const targetGroup = groups[targetIndex - 1]
      if (targetGroup) return match.replace(targetGroup, replacement)
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
    value = request.haystack.replace(regex, request.replacement)
  } else if (request.operation === 'split') {
    value = request.haystack.split(regex)
  } else if (request.operation === 'matchFirst') {
    const match = request.haystack.match(regex)
    value = match ? match[0] : null
  } else if (request.operation === 'move') {
    assertLength(request.replacement, limits.replacement, 'replacement')
    const isGlobal = request.flags.includes('g')
    const matches = isGlobal ? Array.from(request.haystack.matchAll(regex)) : [request.haystack.match(regex)]
    value = request.haystack.replace(regex, '')
    for (const matched of matches) {
      if (!matched) continue
      const template = request.replacement.replace('@@move_top ', '').replace('@@move_bottom ', '')
      const out = substituteMoveMatch(template, matched)
      value = request.toTop ? out + '\\n' + value : value + '\\n' + out
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
    return haystack.replace(regex, replacement)
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
    return haystack.split(regex)
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
    let next = haystack.replace(regex, '')
    for (const matched of matchAll) {
      if (!matched) continue
      const template = replacement.replace('@@move_top ', '').replace('@@move_bottom ', '')
      const out = substituteWorkerCompatibleMatch(template, matched as RegExpMatchArray)
      next = toTop ? out + '\n' + next : next + '\n' + out
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
    return haystack.replace(regex, (...args) => {
      const match = args[0] as string
      const groups = args.slice(1, -2) as string[]
      const targetGroupMatch = resultFormat.match(/^\$(\d+)$/)
      if (targetGroupMatch) {
        const targetIndex = Number(targetGroupMatch[1])
        if (targetIndex === 0) {
          return replacement
        }
        const targetGroup = groups[targetIndex - 1]
        if (targetGroup) {
          return match.replace(targetGroup, replacement)
        }
      }
      return resultFormat
        .replace(/\$[0-9]+/g, (placeholder) => {
          const index = Number(placeholder.slice(1))
          return index === 0 ? match : groups[index - 1] || ''
        })
        .replace(/\$&/g, match)
        .replace(/\$\$/g, '$')
    })
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
