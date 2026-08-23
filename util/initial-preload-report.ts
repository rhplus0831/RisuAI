import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { gzipSync } from 'node:zlib'
import { pathToFileURL } from 'node:url'

export interface InitialPreloadBudgetValues {
  totalGzipBytes: number
  largestChunkGzipBytes: number
}

export interface InitialPreloadBudgets {
  schemaVersion: 1
  regressionCeilings: InitialPreloadBudgetValues
  milestoneTargets: InitialPreloadBudgetValues
}

export interface InitialPreloadFileReport {
  path: string
  role: 'entry' | 'modulepreload'
  rawBytes: number
  gzipBytes: number
}

export interface InitialPreloadBudgetComparison extends InitialPreloadBudgetValues {
  passes: boolean
}

export interface InitialPreloadReport {
  schemaVersion: 1
  sourceHtml: 'index.html'
  fileCount: number
  rawBytes: number
  gzipBytes: number
  largestInitialChunk: InitialPreloadFileReport
  files: InitialPreloadFileReport[]
  budgets?: {
    regressionCeilings: InitialPreloadBudgetComparison
    milestoneTargets: InitialPreloadBudgetComparison
  }
}

interface InitialReference {
  reference: string
  role: InitialPreloadFileReport['role']
}

interface CliOptions {
  distDir: string
  jsonOutput?: string
  textOutput?: string
  budgetFile?: string
}

const REPORT_BASE_URL = new URL('https://risu-initial-preload.invalid/')

function parseTagAttributes(tag: string): Map<string, string> {
  const attributes = new Map<string, string>()
  const source = tag.replace(/^<\/?[a-z][^\s/>]*/i, '').replace(/\/?\s*>$/, '')
  const attributePattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
  for (const match of source.matchAll(attributePattern)) {
    attributes.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? '')
  }
  return attributes
}

function initialReferences(html: string): InitialReference[] {
  const entries: InitialReference[] = []
  const preloads: InitialReference[] = []

  for (const match of html.matchAll(/<(script|link)\b[^>]*>/gi)) {
    const tagName = match[1].toLowerCase()
    const attributes = parseTagAttributes(match[0])
    if (tagName === 'script') {
      const src = attributes.get('src')
      if (attributes.get('type')?.toLowerCase() === 'module' && src) {
        entries.push({ reference: src, role: 'entry' })
      }
      continue
    }

    const rel = attributes.get('rel')?.toLowerCase().split(/\s+/) ?? []
    const href = attributes.get('href')
    if (rel.includes('modulepreload') && href) preloads.push({ reference: href, role: 'modulepreload' })
  }

  if (entries.length !== 1) {
    throw new Error(`Expected exactly one JavaScript module entry in dist/index.html, found ${entries.length}`)
  }
  return [...entries, ...preloads]
}

function resolveInitialReference(distDir: string, reference: string): { absolutePath: string; reportPath: string } {
  const rawPath = reference.split(/[?#]/, 1)[0]
  for (const rawSegment of rawPath.split('/')) {
    let decodedSegment: string
    try {
      decodedSegment = decodeURIComponent(rawSegment)
    } catch {
      throw new Error(`Invalid encoded initial JavaScript path: ${reference}`)
    }
    if (
      decodedSegment === '.' ||
      decodedSegment === '..' ||
      decodedSegment.includes('/') ||
      decodedSegment.includes('\\')
    ) {
      throw new Error(`Initial JavaScript path escapes dist: ${reference}`)
    }
  }

  let url: URL
  try {
    url = new URL(reference, REPORT_BASE_URL)
  } catch {
    throw new Error(`Invalid initial JavaScript URL: ${reference}`)
  }
  if (url.origin !== REPORT_BASE_URL.origin) {
    throw new Error(`Initial JavaScript URL must stay within dist: ${reference}`)
  }

  let decodedPath: string
  try {
    decodedPath = decodeURIComponent(url.pathname)
  } catch {
    throw new Error(`Invalid encoded initial JavaScript path: ${reference}`)
  }
  if (decodedPath.includes('\0') || decodedPath.includes('\\')) {
    throw new Error(`Unsafe initial JavaScript path: ${reference}`)
  }
  if (!decodedPath.toLowerCase().endsWith('.js')) {
    throw new Error(`Initial module reference is not JavaScript: ${reference}`)
  }

  const distRoot = path.resolve(distDir)
  const absolutePath = path.resolve(distRoot, decodedPath.replace(/^\/+/, ''))
  const relativePath = path.relative(distRoot, absolutePath)
  if (
    relativePath === '' ||
    relativePath === '..' ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(`Initial JavaScript path escapes dist: ${reference}`)
  }
  return { absolutePath, reportPath: relativePath.split(path.sep).join('/') }
}

function compareBudget(
  report: Pick<InitialPreloadReport, 'gzipBytes' | 'largestInitialChunk'>,
  values: InitialPreloadBudgetValues,
): InitialPreloadBudgetComparison {
  return {
    ...values,
    passes:
      report.gzipBytes <= values.totalGzipBytes && report.largestInitialChunk.gzipBytes <= values.largestChunkGzipBytes,
  }
}

export function readInitialPreloadBudgets(budgetFile: string): InitialPreloadBudgets {
  const parsed = JSON.parse(fs.readFileSync(budgetFile, 'utf8')) as Partial<InitialPreloadBudgets>
  if (
    parsed.schemaVersion !== 1 ||
    !validBudgetValues(parsed.regressionCeilings) ||
    !validBudgetValues(parsed.milestoneTargets)
  ) {
    throw new Error(`Invalid initial preload budget file: ${budgetFile}`)
  }
  return parsed as InitialPreloadBudgets
}

function validBudgetValues(value: unknown): value is InitialPreloadBudgetValues {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<InitialPreloadBudgetValues>
  return (
    Number.isSafeInteger(candidate.totalGzipBytes) &&
    candidate.totalGzipBytes! > 0 &&
    Number.isSafeInteger(candidate.largestChunkGzipBytes) &&
    candidate.largestChunkGzipBytes! > 0
  )
}

export function createInitialPreloadReport(distDir: string, budgets?: InitialPreloadBudgets): InitialPreloadReport {
  const htmlPath = path.join(distDir, 'index.html')
  const html = fs.readFileSync(htmlPath, 'utf8')
  const uniqueFiles = new Map<string, InitialPreloadFileReport>()

  for (const item of initialReferences(html)) {
    const resolved = resolveInitialReference(distDir, item.reference)
    const existing = uniqueFiles.get(resolved.reportPath)
    if (existing) {
      if (item.role === 'entry') existing.role = 'entry'
      continue
    }
    let contents: Buffer
    try {
      contents = fs.readFileSync(resolved.absolutePath)
    } catch {
      throw new Error(`Missing initial JavaScript file: ${resolved.reportPath}`)
    }
    uniqueFiles.set(resolved.reportPath, {
      path: resolved.reportPath,
      role: item.role,
      rawBytes: contents.byteLength,
      gzipBytes: gzipSync(contents, { level: 9 }).byteLength,
    })
  }

  const files = [...uniqueFiles.values()]
  if (files.length === 0) throw new Error('No initial JavaScript files were found in dist/index.html')
  const rawBytes = files.reduce((total, file) => total + file.rawBytes, 0)
  const gzipBytes = files.reduce((total, file) => total + file.gzipBytes, 0)
  const largestInitialChunk = files.reduce((largest, file) => (file.gzipBytes > largest.gzipBytes ? file : largest))
  const report: InitialPreloadReport = {
    schemaVersion: 1,
    sourceHtml: 'index.html',
    fileCount: files.length,
    rawBytes,
    gzipBytes,
    largestInitialChunk: { ...largestInitialChunk },
    files,
  }
  if (budgets) {
    report.budgets = {
      regressionCeilings: compareBudget(report, budgets.regressionCeilings),
      milestoneTargets: compareBudget(report, budgets.milestoneTargets),
    }
  }
  return report
}

function kibibytes(bytes: number): string {
  return `${(bytes / 1024).toFixed(2)} KiB`
}

export function formatInitialPreloadReport(report: InitialPreloadReport): string {
  const lines = [
    'Initial JavaScript preload report',
    `Files: ${report.fileCount}`,
    `Raw: ${report.rawBytes} bytes (${kibibytes(report.rawBytes)})`,
    `Gzip: ${report.gzipBytes} bytes (${kibibytes(report.gzipBytes)})`,
    `Largest: ${report.largestInitialChunk.path} — ${report.largestInitialChunk.gzipBytes} bytes gzip (${kibibytes(report.largestInitialChunk.gzipBytes)})`,
  ]
  if (report.budgets) {
    lines.push(
      `Regression ceilings: ${report.budgets.regressionCeilings.passes ? 'PASS' : 'FAIL'} — ${report.budgets.regressionCeilings.totalGzipBytes} total / ${report.budgets.regressionCeilings.largestChunkGzipBytes} largest`,
      `Milestone targets: ${report.budgets.milestoneTargets.passes ? 'PASS' : 'NOT YET'} — ${report.budgets.milestoneTargets.totalGzipBytes} total / ${report.budgets.milestoneTargets.largestChunkGzipBytes} largest`,
    )
  }
  lines.push('', ...report.files.map((file) => `${file.role}\t${file.rawBytes}\t${file.gzipBytes}\t${file.path}`))
  return `${lines.join('\n')}\n`
}

function parseCliOptions(argv: string[]): CliOptions {
  const options: CliOptions = { distDir: 'dist' }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`)
    if (flag === '--dist') options.distDir = value
    else if (flag === '--json') options.jsonOutput = value
    else if (flag === '--text') options.textOutput = value
    else if (flag === '--budget') options.budgetFile = value
    else throw new Error(`Unknown option: ${flag}`)
    index += 1
  }
  return options
}

function writeOutput(file: string, contents: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, contents)
}

export function runInitialPreloadReportCli(argv = process.argv.slice(2)): number {
  const options = parseCliOptions(argv)
  const budgets = options.budgetFile ? readInitialPreloadBudgets(options.budgetFile) : undefined
  const report = createInitialPreloadReport(options.distDir, budgets)
  const human = formatInitialPreloadReport(report)
  process.stdout.write(human)
  if (options.jsonOutput) writeOutput(options.jsonOutput, `${JSON.stringify(report, null, 2)}\n`)
  if (options.textOutput) writeOutput(options.textOutput, human)
  return report.budgets?.regressionCeilings.passes === false ? 1 : 0
}

const executedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ''
if (import.meta.url === executedPath) {
  try {
    process.exitCode = runInitialPreloadReportCli()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
