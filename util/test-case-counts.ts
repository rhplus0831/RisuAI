import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import type { CollectedCaseCountMetadata } from './test-effectiveness-inventory.js'

interface VitestListEntry {
  name: string
  file: string
  projectName?: string
}

interface CaseCountInput {
  frontendList: string
  serverList: string
  browserList: string
  frontendResults?: string
  serverResults?: string
  browserResults?: string
  output: string
}

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as unknown
}

function normalizeFile(rootDir: string, file: string): string {
  return path.relative(rootDir, path.resolve(rootDir, file)).replaceAll('\\', '/')
}

function addCount(counts: Map<string, number>, file: string, amount = 1): void {
  counts.set(file, (counts.get(file) ?? 0) + amount)
}

function vitestListCounts(rootDir: string, file: string): Map<string, number> {
  const value = readJson(file)
  if (!Array.isArray(value)) throw new Error(`Vitest list report is not an array: ${file}`)
  const counts = new Map<string, number>()
  for (const entry of value as VitestListEntry[]) {
    if (typeof entry.file !== 'string' || typeof entry.name !== 'string') {
      throw new Error(`Vitest list report has a malformed entry: ${file}`)
    }
    addCount(counts, normalizeFile(rootDir, entry.file))
  }
  return counts
}

function browserSpecCounts(value: unknown, counts: Map<string, number>): void {
  if (!value || typeof value !== 'object') return
  const record = value as Record<string, unknown>
  if (Array.isArray(record.specs)) {
    for (const spec of record.specs) {
      if (!spec || typeof spec !== 'object') continue
      const specRecord = spec as Record<string, unknown>
      if (typeof specRecord.file === 'string') addCount(counts, `server/fastify/browser-smoke/${specRecord.file}`)
    }
  }
  if (Array.isArray(record.suites)) {
    for (const suite of record.suites) browserSpecCounts(suite, counts)
  }
}

function playwrightListCounts(file: string): Map<string, number> {
  const counts = new Map<string, number>()
  browserSpecCounts(readJson(file), counts)
  return counts
}

function vitestSkippedCounts(rootDir: string, file: string | undefined): Map<string, number> {
  const skipped = new Map<string, number>()
  if (!file) return skipped
  const value = readJson(file) as { testResults?: Array<Record<string, unknown>> }
  for (const result of value.testResults ?? []) {
    if (typeof result.name !== 'string' || !Array.isArray(result.assertionResults)) continue
    const count = result.assertionResults.filter(
      (entry) =>
        entry &&
        typeof entry === 'object' &&
        ['pending', 'skipped', 'todo'].includes(String((entry as Record<string, unknown>).status)),
    ).length
    if (count > 0) skipped.set(normalizeFile(rootDir, result.name), count)
  }
  return skipped
}

function vitestResultCounts(rootDir: string, file: string | undefined): Map<string, number> {
  const counts = new Map<string, number>()
  if (!file) return counts
  const value = readJson(file) as { testResults?: Array<Record<string, unknown>> }
  for (const result of value.testResults ?? []) {
    if (typeof result.name !== 'string' || !Array.isArray(result.assertionResults)) continue
    counts.set(normalizeFile(rootDir, result.name), result.assertionResults.length)
  }
  return counts
}

function playwrightSkippedCounts(file: string | undefined): Map<string, number> {
  const skipped = new Map<string, number>()
  if (!file) return skipped
  function visit(value: unknown): void {
    if (!value || typeof value !== 'object') return
    const record = value as Record<string, unknown>
    if (Array.isArray(record.specs)) {
      for (const spec of record.specs) {
        if (!spec || typeof spec !== 'object') continue
        const specRecord = spec as Record<string, unknown>
        if (typeof specRecord.file !== 'string' || !Array.isArray(specRecord.tests)) continue
        const count = specRecord.tests.filter(
          (test) => test && typeof test === 'object' && (test as Record<string, unknown>).status === 'skipped',
        ).length
        if (count > 0) addCount(skipped, `server/fastify/browser-smoke/${specRecord.file}`, count)
      }
    }
    if (Array.isArray(record.suites)) for (const suite of record.suites) visit(suite)
  }
  visit(readJson(file))
  return skipped
}

function rootTestIdentifier(expression: ts.Expression): 'it' | 'test' | undefined {
  if (ts.isIdentifier(expression) && (expression.text === 'it' || expression.text === 'test')) return expression.text
  if (ts.isPropertyAccessExpression(expression)) return rootTestIdentifier(expression.expression)
  if (ts.isCallExpression(expression)) return rootTestIdentifier(expression.expression)
  if (ts.isTaggedTemplateExpression(expression)) return rootTestIdentifier(expression.tag)
  return undefined
}

function expressionUsesEach(expression: ts.Expression): boolean {
  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text === 'each' || expressionUsesEach(expression.expression)
  }
  if (ts.isCallExpression(expression)) return expressionUsesEach(expression.expression)
  if (ts.isTaggedTemplateExpression(expression)) return expressionUsesEach(expression.tag)
  return false
}

function looksLikeRegistration(call: ts.CallExpression): boolean {
  const first = call.arguments[0]
  return Boolean(
    first &&
    (ts.isStringLiteralLike(first) || ts.isNoSubstitutionTemplateLiteral(first) || ts.isTemplateExpression(first)),
  )
}

export function countParameterizedRows(source: string, collectedCases: number): number {
  const sourceFile = ts.createSourceFile('test.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  let nonParameterizedRegistrations = 0
  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      rootTestIdentifier(node.expression) &&
      looksLikeRegistration(node) &&
      !expressionUsesEach(node.expression)
    ) {
      nonParameterizedRegistrations += 1
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return Math.max(0, collectedCases - nonParameterizedRegistrations)
}

export function createCaseCountMetadata(rootDir: string, input: CaseCountInput): CollectedCaseCountMetadata {
  const collected = new Map<string, number>()
  for (const [file, count] of [
    ...vitestListCounts(rootDir, input.frontendList),
    ...vitestListCounts(rootDir, input.serverList),
    ...playwrightListCounts(input.browserList),
  ]) {
    if (collected.has(file)) throw new Error(`Case collection assigned a file more than once: ${file}`)
    collected.set(file, count)
  }
  for (const [file, count] of [
    ...vitestResultCounts(rootDir, input.frontendResults),
    ...vitestResultCounts(rootDir, input.serverResults),
  ]) {
    collected.set(file, Math.max(collected.get(file) ?? 0, count))
  }
  const skipped = new Map<string, number>([
    ...vitestSkippedCounts(rootDir, input.frontendResults),
    ...vitestSkippedCounts(rootDir, input.serverResults),
    ...playwrightSkippedCounts(input.browserResults),
  ])
  const files = Object.fromEntries(
    [...collected]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([file, cases]) => [
        file,
        {
          cases,
          skipped: skipped.get(file) ?? 0,
          parameterizedRows: countParameterizedRows(fs.readFileSync(path.join(rootDir, file), 'utf8'), cases),
        },
      ]),
  )
  return {
    schemaVersion: 1,
    source:
      'Vitest 4 list JSON plus Playwright 1.62 list JSON; skips from measured JSON results; parameterizedRows are collected cases beyond non-.each source registrations',
    files,
  }
}

export function writeCaseCountMetadata(rootDir: string, input: CaseCountInput): void {
  const output = path.resolve(rootDir, input.output)
  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.writeFileSync(output, `${JSON.stringify(createCaseCountMetadata(rootDir, input), null, 2)}\n`)
}

function parseCli(argv: readonly string[]): CaseCountInput {
  const values = new Map<string, string>()
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith('--') || !argv[index + 1])
      throw new Error('Case-count arguments must be flag/value pairs')
    values.set(argv[index].slice(2), argv[index + 1])
  }
  for (const required of ['frontend-list', 'server-list', 'browser-list', 'output']) {
    if (!values.has(required)) throw new Error(`Missing --${required}`)
  }
  return {
    frontendList: values.get('frontend-list')!,
    serverList: values.get('server-list')!,
    browserList: values.get('browser-list')!,
    frontendResults: values.get('frontend-results'),
    serverResults: values.get('server-results'),
    browserResults: values.get('browser-results'),
    output: values.get('output')!,
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath && fs.existsSync(invokedPath)) {
  try {
    writeCaseCountMetadata(process.cwd(), parseCli(process.argv.slice(2)))
  } catch (error) {
    console.error(`[test-case-counts] ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
