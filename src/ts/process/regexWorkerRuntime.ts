export const CLIENT_REGEX_LIMITS = {
  pattern: 4_096,
  haystack: 128 * 1024,
  replacement: 64 * 1024,
  output: 128 * 1024,
} as const

interface RegexWorkerBaseRequest {
  pattern: string
  flags: string
  source: string
}

export type RegexWorkerRequest =
  | (RegexWorkerBaseRequest & { operation: 'test' })
  | (RegexWorkerBaseRequest & { operation: 'replace'; replacement: string })
  | (RegexWorkerBaseRequest & { operation: 'testReplace'; replacement: string })
  | (RegexWorkerBaseRequest & { operation: 'testMove'; replacement: string; toTop: boolean })
  | (RegexWorkerBaseRequest & { operation: 'matchFirst' })

export type RegexWorkerResult =
  | { operation: 'test'; matched: boolean }
  | { operation: 'replace'; result: string }
  | { operation: 'testReplace'; matched: boolean; result: string }
  | { operation: 'testMove'; matched: boolean; result: string }
  | { operation: 'matchFirst'; match: string | null }

function assertLength(value: string, limit: number, label: string): void {
  if (value.length > limit) throw new Error(`${label} length ${value.length} exceeds cap ${limit}`)
}

function assertRequest(request: RegexWorkerRequest): void {
  assertLength(request.pattern, CLIENT_REGEX_LIMITS.pattern, 'pattern')
  assertLength(request.source, CLIENT_REGEX_LIMITS.haystack, 'haystack')
  if ('replacement' in request) {
    assertLength(request.replacement, CLIENT_REGEX_LIMITS.replacement, 'replacement')
  }
}

function assertOutput(output: string): string {
  assertLength(output, CLIENT_REGEX_LIMITS.output, 'output')
  return output
}

type ReplacementCallback = (
  match: string,
  captures: Array<string | undefined>,
  offset: number,
  source: string,
  groups: Record<string, string | undefined> | undefined,
) => string

function replaceCallbackBounded(source: string, regex: RegExp, replacement: ReplacementCallback): string {
  const chunks: string[] = []
  let cursor = 0
  let outputLength = 0
  const append = (value: string): void => {
    outputLength += value.length
    if (outputLength > CLIENT_REGEX_LIMITS.output) {
      throw new Error(`output length ${outputLength} exceeds cap ${CLIENT_REGEX_LIMITS.output}`)
    }
    chunks.push(value)
  }
  source.replace(regex, (...args: unknown[]) => {
    const match = args[0] as string
    const possibleGroups = args.at(-1)
    const groups =
      typeof possibleGroups === 'object' && possibleGroups !== null
        ? (possibleGroups as Record<string, string | undefined>)
        : undefined
    const offsetIndex = groups ? args.length - 3 : args.length - 2
    const offset = args[offsetIndex] as number
    append(source.slice(cursor, offset))
    append(replacement(match, args.slice(1, offsetIndex) as Array<string | undefined>, offset, source, groups))
    cursor = offset + match.length
    return ''
  })
  append(source.slice(cursor))
  return chunks.join('')
}

function expandNativeReplacement(
  template: string,
  match: string,
  captures: Array<string | undefined>,
  offset: number,
  source: string,
  groups: Record<string, string | undefined> | undefined,
): string {
  return replaceCallbackBounded(template, /\$(\$|&|`|'|<[^>]*>|\d{1,2})/g, (placeholder, tokens) => {
    const token = tokens[0] ?? ''
    if (token === '$') return '$'
    if (token === '&') return match
    if (token === '`') return source.slice(0, offset)
    if (token === "'") return source.slice(offset + match.length)
    if (token.startsWith('<')) return groups ? (groups[token.slice(1, -1)] ?? '') : placeholder
    const index = Number(token)
    if (index > 0 && index <= captures.length) return captures[index - 1] ?? ''
    if (token.length === 2) {
      const firstIndex = Number(token[0])
      if (firstIndex > 0 && firstIndex <= captures.length) return `${captures[firstIndex - 1] ?? ''}${token[1]}`
    }
    return placeholder
  })
}

function replaceNativeBounded(source: string, regex: RegExp, replacement: string): string {
  return replaceCallbackBounded(source, regex, (match, captures, offset, input, groups) =>
    expandNativeReplacement(replacement, match, captures, offset, input, groups),
  )
}

function substituteMoveMatch(template: string, matched: RegExpMatchArray): string {
  const numbered = replaceCallbackBounded(template, /(?<!\$)\$[0-9]+/g, (value) => {
    const index = Number.parseInt(value.slice(1))
    return index < matched.length ? (matched[index] ?? value) : value
  })
  const wholeMatch = replaceCallbackBounded(numbered, /\$&/g, () => matched[0])
  return replaceCallbackBounded(wholeMatch, /(?<!\$)\$<([^>]+)>/g, (value) => {
    const groupName = Number.parseInt(value.slice(2, -1))
    return matched.groups?.[groupName as unknown as string] ?? value
  })
}

function testAndMove(
  regex: RegExp,
  source: string,
  replacement: string,
  toTop: boolean,
): { matched: boolean; result: string } {
  const matched = regex.test(source)
  if (!matched) return { matched: false, result: source }

  const isGlobal = regex.flags.includes('g')
  const matches = isGlobal ? Array.from(source.matchAll(regex)) : [source.match(regex)]
  let result = replaceNativeBounded(source, regex, '')
  for (const match of matches) {
    if (!match) continue
    const template = replacement.replace('@@move_top ', '').replace('@@move_bottom ', '')
    const output = substituteMoveMatch(template, match)
    result = toTop ? `${output}\n${result}` : `${result}\n${output}`
    assertOutput(result)
  }
  return { matched: true, result }
}

export function executeRegexWorkerRequest(request: RegexWorkerRequest): RegexWorkerResult {
  assertRequest(request)
  const regex = new RegExp(request.pattern, request.flags)

  switch (request.operation) {
    case 'test':
      return { operation: 'test', matched: regex.test(request.source) }
    case 'replace':
      return {
        operation: 'replace',
        result: replaceNativeBounded(request.source, regex, request.replacement),
      }
    case 'testReplace': {
      const matched = regex.test(request.source)
      return {
        operation: 'testReplace',
        matched,
        result: matched ? replaceNativeBounded(request.source, regex, request.replacement) : request.source,
      }
    }
    case 'testMove': {
      const moved = testAndMove(regex, request.source, request.replacement, request.toTop)
      return { operation: 'testMove', ...moved }
    }
    case 'matchFirst':
      return { operation: 'matchFirst', match: request.source.match(regex)?.[0] ?? null }
  }
}
