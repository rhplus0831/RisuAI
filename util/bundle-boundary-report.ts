import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { gzipSync } from 'node:zlib'
import { pathToFileURL } from 'node:url'
import type { Plugin } from 'vite'
import { phase1ProtectedInitialModuleFragments, phase1ProtectedInitialModules } from './fast-bootstrap-boundaries.js'
import { readInitialPreloadFilePaths } from './initial-preload-report.js'

interface BundleModuleInput {
  renderedLength?: number
}

interface BundleChunkInput {
  type: 'chunk'
  code: string
  dynamicImports: string[]
  facadeModuleId: string | null
  fileName: string
  imports: string[]
  isDynamicEntry: boolean
  isEntry: boolean
  modules: Record<string, BundleModuleInput>
  name: string
}

interface BundleAssetInput {
  type: 'asset'
}

export type BundleOutputInput = Record<string, BundleChunkInput | BundleAssetInput>

export interface BundleBoundaryChunkReport {
  file: string
  name: string
  facadeModule: string | null
  isEntry: boolean
  isDynamicEntry: boolean
  imports: string[]
  dynamicImports: string[]
  rawBytes: number
  gzipBytes: number
  renderedModuleBytes: number
  modules: string[]
}

export interface BundleBoundaryViolation {
  boundary: 'database-implementation' | 'export-implementation' | 'optional-surface'
  chunk: string
  module: string
}

export interface BundleBoundaryClosureReport {
  chunkFiles: string[]
  gzipBytes: number
  moduleCount: number
  rawBytes: number
}

export interface BundleBoundaryReport {
  schemaVersion: 1
  entryModule: string
  startupModule: string
  initial: BundleBoundaryClosureReport & {
    htmlChunkFiles?: string[]
    htmlMatchesEntryClosure?: boolean
    passes: boolean
    violations: BundleBoundaryViolation[]
  }
  immediateStartup: BundleBoundaryClosureReport
  chunks: BundleBoundaryChunkReport[]
}

interface CliOptions {
  distDir: string
  input: string
  jsonOutput?: string
  textOutput?: string
}

const ENTRY_MODULE = 'index.html'
const STARTUP_MODULE = 'src/appStartup.ts'

function normalizeSlashes(value: string): string {
  return value.replaceAll('\\', '/')
}

export function normalizeBundleModuleId(rootDir: string, moduleId: string): string {
  const withoutQuery = moduleId.split('?', 1)[0]
  if (withoutQuery.startsWith('\0')) return withoutQuery

  const normalized = normalizeSlashes(withoutQuery)
  const normalizedRoot = normalizeSlashes(path.resolve(rootDir)).replace(/\/$/, '')
  if (normalized.startsWith(`${normalizedRoot}/`)) return normalized.slice(normalizedRoot.length + 1)
  return normalized.replace(/^\/+/, '')
}

function staticClosure(rootFile: string, chunksByFile: Map<string, BundleBoundaryChunkReport>): string[] {
  const pending = [rootFile]
  const visited = new Set<string>()
  while (pending.length > 0) {
    const file = pending.pop()!
    if (visited.has(file)) continue
    const chunk = chunksByFile.get(file)
    if (!chunk) continue
    visited.add(file)
    pending.push(...chunk.imports)
  }
  return [...visited].sort()
}

function closureReport(
  chunkFiles: string[],
  chunksByFile: Map<string, BundleBoundaryChunkReport>,
): BundleBoundaryClosureReport {
  const chunks = chunkFiles.map((file) => chunksByFile.get(file)).filter((chunk) => chunk !== undefined)
  return {
    chunkFiles,
    rawBytes: chunks.reduce((total, chunk) => total + chunk.rawBytes, 0),
    gzipBytes: chunks.reduce((total, chunk) => total + chunk.gzipBytes, 0),
    moduleCount: new Set(chunks.flatMap((chunk) => chunk.modules)).size,
  }
}

function protectedBoundary(moduleId: string): BundleBoundaryViolation['boundary'] | null {
  if ((phase1ProtectedInitialModules.optionalSurface as readonly string[]).includes(moduleId)) {
    return 'optional-surface'
  }
  if ((phase1ProtectedInitialModules.databaseImplementation as readonly string[]).includes(moduleId)) {
    return 'database-implementation'
  }
  if (
    (phase1ProtectedInitialModules.exportImplementation as readonly string[]).includes(moduleId) ||
    phase1ProtectedInitialModuleFragments.exportImplementation.some((fragment) => moduleId.includes(fragment))
  ) {
    return 'export-implementation'
  }
  return null
}

function initialViolations(
  chunkFiles: string[],
  chunksByFile: Map<string, BundleBoundaryChunkReport>,
): BundleBoundaryViolation[] {
  const violations: BundleBoundaryViolation[] = []
  for (const file of chunkFiles) {
    const chunk = chunksByFile.get(file)
    if (!chunk) continue
    for (const moduleId of chunk.modules) {
      const boundary = protectedBoundary(moduleId)
      if (boundary) violations.push({ boundary, chunk: file, module: moduleId })
    }
  }
  return violations.sort((left, right) =>
    `${left.boundary}\0${left.module}\0${left.chunk}`.localeCompare(
      `${right.boundary}\0${right.module}\0${right.chunk}`,
    ),
  )
}

export function createBundleBoundaryReport(bundle: BundleOutputInput, rootDir: string): BundleBoundaryReport {
  const chunks = Object.values(bundle)
    .filter((output): output is BundleChunkInput => output.type === 'chunk')
    .map<BundleBoundaryChunkReport>((chunk) => ({
      file: chunk.fileName,
      name: chunk.name,
      facadeModule: chunk.facadeModuleId ? normalizeBundleModuleId(rootDir, chunk.facadeModuleId) : null,
      isEntry: chunk.isEntry,
      isDynamicEntry: chunk.isDynamicEntry,
      imports: [...chunk.imports].sort(),
      dynamicImports: [...chunk.dynamicImports].sort(),
      rawBytes: Buffer.byteLength(chunk.code),
      gzipBytes: gzipSync(chunk.code, { level: 9 }).byteLength,
      renderedModuleBytes: Object.values(chunk.modules).reduce(
        (total, module) => total + (module.renderedLength ?? 0),
        0,
      ),
      modules: Object.keys(chunk.modules)
        .map((moduleId) => normalizeBundleModuleId(rootDir, moduleId))
        .sort(),
    }))
    .sort((left, right) => left.file.localeCompare(right.file))

  const entryChunks = chunks.filter((chunk) => chunk.isEntry)
  if (entryChunks.length !== 1) throw new Error(`Expected exactly one bundle entry chunk, found ${entryChunks.length}`)
  const entryChunk = entryChunks[0]
  if (entryChunk.facadeModule !== ENTRY_MODULE) {
    throw new Error(`Expected ${ENTRY_MODULE} as the bundle entry, found ${entryChunk.facadeModule ?? 'no facade'}`)
  }

  const startupChunk = chunks.find((chunk) => chunk.facadeModule === STARTUP_MODULE)
  if (!startupChunk) throw new Error(`Missing startup chunk for ${STARTUP_MODULE}`)

  const chunksByFile = new Map(chunks.map((chunk) => [chunk.file, chunk]))
  const initialChunkFiles = staticClosure(entryChunk.file, chunksByFile)
  const startupChunkFiles = staticClosure(startupChunk.file, chunksByFile)
  const violations = initialViolations(initialChunkFiles, chunksByFile)

  return {
    schemaVersion: 1,
    entryModule: ENTRY_MODULE,
    startupModule: STARTUP_MODULE,
    initial: {
      ...closureReport(initialChunkFiles, chunksByFile),
      passes: violations.length === 0,
      violations,
    },
    immediateStartup: closureReport(startupChunkFiles, chunksByFile),
    chunks,
  }
}

export function attachHtmlPreloadValidation(
  report: BundleBoundaryReport,
  htmlChunkFiles: readonly string[],
): BundleBoundaryReport {
  const normalizedHtmlFiles = [...new Set(htmlChunkFiles)].sort()
  const htmlMatchesEntryClosure =
    normalizedHtmlFiles.length === report.initial.chunkFiles.length &&
    normalizedHtmlFiles.every((file, index) => file === report.initial.chunkFiles[index])
  return {
    ...report,
    initial: {
      ...report.initial,
      htmlChunkFiles: normalizedHtmlFiles,
      htmlMatchesEntryClosure,
      passes: report.initial.passes && htmlMatchesEntryClosure,
    },
  }
}

export function attachEmittedFileSizes(report: BundleBoundaryReport, distDir: string): BundleBoundaryReport {
  const chunks = report.chunks.map((chunk) => {
    const contents = fs.readFileSync(path.join(distDir, chunk.file))
    return {
      ...chunk,
      rawBytes: contents.byteLength,
      gzipBytes: gzipSync(contents, { level: 9 }).byteLength,
    }
  })
  const chunksByFile = new Map(chunks.map((chunk) => [chunk.file, chunk]))
  return {
    ...report,
    initial: {
      ...report.initial,
      ...closureReport(report.initial.chunkFiles, chunksByFile),
    },
    immediateStartup: closureReport(report.immediateStartup.chunkFiles, chunksByFile),
    chunks,
  }
}

function kibibytes(bytes: number): string {
  return `${(bytes / 1024).toFixed(2)} KiB`
}

export function formatBundleBoundaryReport(report: BundleBoundaryReport): string {
  const largestChunks = [...report.chunks].sort((left, right) => right.gzipBytes - left.gzipBytes).slice(0, 40)
  const lines = [
    'Bundle boundary report',
    `Chunks: ${report.chunks.length}`,
    `Initial static closure: ${report.initial.chunkFiles.length} files / ${report.initial.moduleCount} modules / ${kibibytes(report.initial.gzipBytes)} gzip`,
    `Immediate appStartup closure: ${report.immediateStartup.chunkFiles.length} files / ${report.immediateStartup.moduleCount} modules / ${kibibytes(report.immediateStartup.gzipBytes)} gzip`,
    `HTML preload closure: ${report.initial.htmlMatchesEntryClosure === undefined ? 'NOT CHECKED' : report.initial.htmlMatchesEntryClosure ? 'PASS' : 'FAIL'}`,
    `Protected initial boundaries: ${report.initial.violations.length === 0 ? 'PASS' : 'FAIL'}`,
  ]

  for (const violation of report.initial.violations) {
    lines.push(`violation\t${violation.boundary}\t${violation.module}\t${violation.chunk}`)
  }
  lines.push(
    '',
    'initial files',
    ...report.initial.chunkFiles,
    '',
    'immediate appStartup files',
    ...report.immediateStartup.chunkFiles,
    '',
    `largest chunks (${largestChunks.length})`,
    ...largestChunks.map(
      (chunk) =>
        `${chunk.rawBytes}\t${chunk.gzipBytes}\t${chunk.isEntry ? 'entry' : chunk.isDynamicEntry ? 'dynamic' : 'shared'}\t${chunk.modules.length}\t${chunk.file}\t${chunk.facadeModule ?? ''}`,
    ),
  )
  return `${lines.join('\n')}\n`
}

export function createBundleBoundaryReportPlugin(rootDir: string): Plugin {
  return {
    name: 'risu-bundle-boundary-report',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const report = createBundleBoundaryReport(bundle as unknown as BundleOutputInput, rootDir)
      this.emitFile({
        type: 'asset',
        fileName: 'bundle-boundary-report.json',
        source: `${JSON.stringify(report, null, 2)}\n`,
      })
    },
  }
}

function parseCliOptions(argv: string[]): CliOptions {
  const options: CliOptions = { distDir: 'dist', input: 'dist/bundle-boundary-report.json' }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`)
    if (flag === '--dist') options.distDir = value
    else if (flag === '--input') options.input = value
    else if (flag === '--json') options.jsonOutput = value
    else if (flag === '--text') options.textOutput = value
    else throw new Error(`Unknown option: ${flag}`)
    index += 1
  }
  return options
}

function writeOutput(file: string, contents: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, contents)
}

export function runBundleBoundaryReportCli(argv = process.argv.slice(2)): number {
  const options = parseCliOptions(argv)
  const parsed = JSON.parse(fs.readFileSync(options.input, 'utf8')) as BundleBoundaryReport
  if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.chunks) || !Array.isArray(parsed.initial?.chunkFiles)) {
    throw new Error(`Invalid bundle boundary report: ${options.input}`)
  }

  const report = attachHtmlPreloadValidation(
    attachEmittedFileSizes(parsed, options.distDir),
    readInitialPreloadFilePaths(options.distDir),
  )
  const human = formatBundleBoundaryReport(report)
  process.stdout.write(human)
  if (options.jsonOutput) writeOutput(options.jsonOutput, `${JSON.stringify(report, null, 2)}\n`)
  if (options.textOutput) writeOutput(options.textOutput, human)
  return report.initial.passes ? 0 : 1
}

const executedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ''
if (import.meta.url === executedPath) {
  try {
    process.exitCode = runBundleBoundaryReportCli()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
