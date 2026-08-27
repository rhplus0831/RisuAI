import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { uiCoverageTestFiles } from '../vitest.ui-coverage-tests.js'

export type FrontendCapability = 'N' | 'S' | 'D' | 'B'
export type FrontendTestProject = 'frontend-node' | 'frontend-dom' | 'browser-smoke'

export interface SourceSignal {
  line: number
  evidence: string
}

export interface FrontendTestSignals {
  svelte?: SourceSignal
  domOrMount?: SourceSignal
  storage?: SourceSignal
  network?: SourceSignal
  timers?: SourceSignal
  filesystem?: SourceSignal
  fastifyHarness?: SourceSignal
}

export interface FrontendTestInventoryRow {
  file: string
  currentProject: FrontendTestProject
  targetClass: FrontendCapability
  confidence: 'high' | 'medium'
  svelte: string
  domOrMount: string
  storage: string
  network: string
  timers: string
  filesystem: string
  fastifyHarness: string
  coverageAndGateOwnership: string
  ambiguityOrBlocker: string
  domain: string
  suggestedSlice: string
  reason: string
}

export interface DiscoveryProblem {
  duplicates: string[]
  missing: string[]
  unexpected: string[]
}

const vitestProjectNames = ['frontend-node', 'frontend-dom'] as const
const independentVitestRoots = ['packages', 'src', 'util'] as const
const ignoredDirectoryNames = new Set(['.git', 'coverage', 'dist', 'node_modules'])
const frontendTestPattern = /\.(?:test|spec)\.[cm]?[jt]sx?$/
const browserSmokePattern = /\.spec\.[cm]?[jt]sx?$/

const performanceGateFiles = new Set([
  'src/ts/__tests__/renderCostHarness.test.ts',
  'src/ts/__tests__/sendCloneCountProbe.test.ts',
])
const uiCoverageFileSet = new Set<string>(uiCoverageTestFiles)

const signalPatterns: Record<keyof FrontendTestSignals, readonly RegExp[]> = {
  svelte: [
    /(?:(?:from|import)\s*['"]|import\s*\(\s*['"])[^'"]*\.svelte(?:\.[cm]?[jt]s)?['"]|from\s*['"]svelte(?:\/[^'"]*)?['"]/,
    /\$(?:state|derived|effect|props|bindable|inspect)\b/,
  ],
  domOrMount: [
    /@testing-library\/svelte|\b(?:mount|hydrate)\s*\(/,
    /\b(?:document|window|HTMLElement|SVGElement|customElements|MutationObserver|ResizeObserver|IntersectionObserver)\b/,
    /\b(?:localStorage|sessionStorage|navigator|history)\b|\blocation\.(?:href|assign|replace|reload)\b/,
    /\b(?:querySelector|dispatchEvent|activeElement|getComputedStyle|requestAnimationFrame)\b/,
  ],
  storage: [
    /\b(?:indexedDB|localStorage|sessionStorage|IDBDatabase|fake-indexeddb)\b/,
    /(?:from|import\s*)\s*['"][^'"]*(?:\/storage\/|database(?:\.svelte)?|resourceCache)[^'"]*['"]/,
  ],
  network: [
    /\b(?:fetch|WebSocket|EventSource|XMLHttpRequest)\s*(?:\.|\()/,
    /(?:from|import\s*)\s*['"][^'"]*(?:\/network\/|\/request\/|serverApi)[^'"]*['"]/,
  ],
  timers: [
    /\b(?:setTimeout|setInterval|requestAnimationFrame)\s*\(/,
    /\bvi\.(?:useFakeTimers|advanceTimersByTime|advanceTimersToNextTimer|runAllTimers|runOnlyPendingTimers)\b/,
  ],
  filesystem: [
    /from\s*['"]node:(?:fs|fs\/promises|path|os)['"]|require\s*\(\s*['"]node:(?:fs|fs\/promises|path|os)['"]\s*\)/,
    /\b(?:mkdtemp|readFile|writeFile|rmSync|mkdirSync)\b/,
  ],
  fastifyHarness: [
    /from\s*['"]fastify['"]|from\s*['"][^'"]*server\/fastify[^'"]*['"]/,
    /\b(?:buildApp|FastifyInstance|app\.inject)\b/,
  ],
}

function normalizeRepoPath(file: string): string {
  return file.replaceAll('\\', '/').replace(/^\.\//, '')
}

function firstSignal(lines: readonly string[], patterns: readonly RegExp[]): SourceSignal | undefined {
  for (let index = 0; index < lines.length; index += 1) {
    for (const pattern of patterns) {
      pattern.lastIndex = 0
      if (pattern.test(lines[index])) return { line: index + 1, evidence: lines[index].trim() }
    }
  }
  return undefined
}

export function analyzeFrontendTestSource(source: string): FrontendTestSignals {
  const lines = source.split(/\r?\n/)
  return Object.fromEntries(
    Object.entries(signalPatterns)
      .map(([name, patterns]) => [name, firstSignal(lines, patterns)])
      .filter((entry) => entry[1] !== undefined),
  ) as FrontendTestSignals
}

function signalText(signal: SourceSignal | undefined): string {
  if (!signal) return ''
  const compactEvidence = signal.evidence.replaceAll('\t', ' ').replace(/\s+/g, ' ').slice(0, 120)
  return `L${signal.line}: ${compactEvidence}`
}

function targetCapability(project: FrontendTestProject, signals: FrontendTestSignals): FrontendCapability {
  if (project === 'browser-smoke') return 'B'
  if (project === 'frontend-node') return 'N'
  if (signals.domOrMount) return 'D'
  if (signals.svelte) return 'S'
  return 'N'
}

function coverageAndGateOwnership(file: string, project: FrontendTestProject): string {
  if (project === 'browser-smoke') return 'browser-smoke'
  const owners = ['ordinary-frontend', 'broad-frontend-coverage']
  if (uiCoverageFileSet.has(file)) owners.push('ui-map-coverage')
  if (performanceGateFiles.has(file)) owners.push('performance-gate')
  if (file.startsWith('src/lib/_audit/')) owners.push('ui-audit-gate')
  return owners.join('+')
}

function owningDomain(file: string): string {
  const segments = file.split('/')
  if (file.startsWith('server/fastify/browser-smoke/')) return 'browser-smoke'
  if (file.startsWith('packages/protocol/')) return 'protocol'
  if (file.startsWith('util/')) return 'test-tooling'
  if (file.startsWith('src/lib/')) return `ui-${segments.length > 3 ? segments[2].toLowerCase() : 'shared'}`
  if (file.startsWith('src/lang/')) return 'localization'
  if (file.startsWith('src/ts/')) return `client-${segments.length > 3 ? segments[2].toLowerCase() : 'core'}`
  return 'test-infrastructure'
}

function targetReason(project: FrontendTestProject, target: FrontendCapability, signals: FrontendTestSignals): string {
  if (target === 'B') return 'built-browser/Fastify lifecycle contract'
  if (project === 'frontend-node') return 'already validated by the Node project'
  if (target === 'D') return 'direct mounted-component or DOM/browser evidence'
  if (target === 'S') return 'direct Svelte transform/store/rune evidence without direct DOM evidence'
  if (signals.storage || signals.network || signals.timers || signals.filesystem || signals.fastifyHarness) {
    return 'no direct Svelte/DOM evidence; non-DOM dependency must remain explicitly faked or Node-safe'
  }
  return 'no direct Svelte transformation or DOM/browser evidence'
}

export function createFrontendTestInventoryRow(
  file: string,
  currentProject: FrontendTestProject,
  source: string,
): FrontendTestInventoryRow {
  const signals = analyzeFrontendTestSource(source)
  const targetClass = targetCapability(currentProject, signals)
  const domain = owningDomain(file)
  const requiresProbe = currentProject === 'frontend-dom' && (targetClass === 'N' || targetClass === 'S')

  return {
    file,
    currentProject,
    targetClass,
    confidence: requiresProbe ? 'medium' : 'high',
    svelte: signalText(signals.svelte),
    domOrMount: signalText(signals.domOrMount),
    storage: signalText(signals.storage),
    network: signalText(signals.network),
    timers: signalText(signals.timers),
    filesystem: signalText(signals.filesystem),
    fastifyHarness: signalText(signals.fastifyHarness),
    coverageAndGateOwnership: coverageAndGateOwnership(file, currentProject),
    ambiguityOrBlocker: requiresProbe
      ? `target-${targetClass.toLowerCase()} probe required; direct-file scan cannot prove transitive runtime needs`
      : '',
    domain,
    suggestedSlice:
      targetClass === 'N'
        ? `phase-2/${domain}`
        : targetClass === 'S'
          ? `phase-3/${domain}`
          : `retain-${targetClass.toLowerCase()}/${domain}`,
    reason: targetReason(currentProject, targetClass, signals),
  }
}

function walkFiles(root: string): string[] {
  if (!fs.existsSync(root)) return []
  const files: string[] = []
  const pending = [root]
  while (pending.length > 0) {
    const directory = pending.pop()!
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!ignoredDirectoryNames.has(entry.name)) pending.push(path.join(directory, entry.name))
      } else if (entry.isFile()) {
        files.push(path.join(directory, entry.name))
      }
    }
  }
  return files
}

export function discoverIndependentFrontendVitestFiles(rootDir: string): string[] {
  const nestedFiles = independentVitestRoots.flatMap((root) => walkFiles(path.join(rootDir, root)))
  const rootFiles = fs
    .readdirSync(rootDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(rootDir, entry.name))

  return [...nestedFiles, ...rootFiles]
    .map((file) => normalizeRepoPath(path.relative(rootDir, file)))
    .filter((file) => frontendTestPattern.test(file))
    .sort()
}

export function discoverBrowserSmokeSpecs(rootDir: string): string[] {
  return walkFiles(path.join(rootDir, 'server/fastify/browser-smoke'))
    .map((file) => normalizeRepoPath(path.relative(rootDir, file)))
    .filter((file) => browserSmokePattern.test(file))
    .sort()
}

export function parseVitestFilesOnlyOutput(output: string): Map<string, Set<string>> {
  const projects = new Map<string, Set<string>>()
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\[([^\]]+)]\s+(.+)$/)
    if (!match) continue
    const [, project, rawFile] = match
    const files = projects.get(project) ?? new Set<string>()
    files.add(normalizeRepoPath(rawFile.trim()))
    projects.set(project, files)
  }
  return projects
}

export function validateFrontendVitestDiscovery(
  expectedFiles: readonly string[],
  projects: ReadonlyMap<string, ReadonlySet<string>>,
): DiscoveryProblem {
  const ownership = new Map<string, string[]>()
  for (const [project, files] of projects) {
    for (const file of files) {
      const owners = ownership.get(file) ?? []
      owners.push(project)
      ownership.set(file, owners)
    }
  }

  const expected = new Set(expectedFiles)
  return {
    duplicates: [...ownership]
      .filter(([, owners]) => owners.length > 1)
      .map(([file, owners]) => `${file} (${owners.sort().join(', ')})`)
      .sort(),
    missing: expectedFiles.filter((file) => !ownership.has(file)).sort(),
    unexpected: [...ownership.keys()].filter((file) => !expected.has(file)).sort(),
  }
}

interface VitestDiscoveryMode {
  includePerformanceGates: boolean
  excludeUiCoverage: boolean
}

function collectConfiguredVitestProjects(rootDir: string, mode: VitestDiscoveryMode): Map<string, Set<string>> {
  const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  const result = spawnSync(command, ['exec', 'vitest', 'list', '--filesOnly'], {
    cwd: rootDir,
    encoding: 'utf8',
    env: {
      ...process.env,
      NO_COLOR: '1',
      RISU_TEST_EXCLUDE_UI_MAP: String(mode.excludeUiCoverage),
      RISU_TEST_INCLUDE_GATES: String(mode.includePerformanceGates),
    },
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || 'Vitest discovery failed')
  }

  const parsed = parseVitestFilesOnlyOutput(result.stdout)
  const projects = new Map<string, Set<string>>()
  for (const project of vitestProjectNames) {
    const files = parsed.get(project)
    if (!files) throw new Error(`Vitest discovery did not report project ${project}`)
    projects.set(project, files)
  }
  return projects
}

function assertDiscoveryVariant(
  label: string,
  expectedFiles: readonly string[],
  projects: ReadonlyMap<string, ReadonlySet<string>>,
): void {
  const problem = validateFrontendVitestDiscovery(expectedFiles, projects)
  if (problem.duplicates.length || problem.missing.length || problem.unexpected.length) {
    throw new Error(
      [
        `${label} discovery is not exhaustive and disjoint`,
        problem.duplicates.length ? `multiply assigned: ${problem.duplicates.join(', ')}` : '',
        problem.missing.length ? `missing: ${problem.missing.join(', ')}` : '',
        problem.unexpected.length ? `unexpected: ${problem.unexpected.join(', ')}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    )
  }
}

interface InventoryResult {
  rows: FrontendTestInventoryRow[]
  fullProjects: Map<string, Set<string>>
  ordinaryProjects: Map<string, Set<string>>
  aggregateOrdinaryProjects: Map<string, Set<string>>
}

function inventoryRows(rootDir: string): InventoryResult {
  const independentFiles = discoverIndependentFrontendVitestFiles(rootDir)
  const fullProjects = collectConfiguredVitestProjects(rootDir, {
    includePerformanceGates: true,
    excludeUiCoverage: false,
  })
  const ordinaryProjects = collectConfiguredVitestProjects(rootDir, {
    includePerformanceGates: false,
    excludeUiCoverage: false,
  })
  const aggregateOrdinaryProjects = collectConfiguredVitestProjects(rootDir, {
    includePerformanceGates: false,
    excludeUiCoverage: true,
  })

  assertDiscoveryVariant('full frontend', independentFiles, fullProjects)
  assertDiscoveryVariant(
    'standalone ordinary frontend',
    independentFiles.filter((file) => !performanceGateFiles.has(file)),
    ordinaryProjects,
  )
  assertDiscoveryVariant(
    'test:all ordinary frontend',
    independentFiles.filter((file) => !performanceGateFiles.has(file) && !uiCoverageFileSet.has(file)),
    aggregateOrdinaryProjects,
  )

  const rows: FrontendTestInventoryRow[] = []
  for (const [project, files] of fullProjects) {
    for (const file of files) {
      rows.push(
        createFrontendTestInventoryRow(
          file,
          project as FrontendTestProject,
          fs.readFileSync(path.join(rootDir, file), 'utf8'),
        ),
      )
    }
  }
  for (const file of discoverBrowserSmokeSpecs(rootDir)) {
    rows.push(createFrontendTestInventoryRow(file, 'browser-smoke', fs.readFileSync(path.join(rootDir, file), 'utf8')))
  }
  rows.sort((left, right) => left.file.localeCompare(right.file))
  return { rows, fullProjects, ordinaryProjects, aggregateOrdinaryProjects }
}

const inventoryColumns = [
  'file',
  'currentProject',
  'targetClass',
  'confidence',
  'svelte',
  'domOrMount',
  'storage',
  'network',
  'timers',
  'filesystem',
  'fastifyHarness',
  'coverageAndGateOwnership',
  'ambiguityOrBlocker',
  'domain',
  'suggestedSlice',
  'reason',
] as const satisfies readonly (keyof FrontendTestInventoryRow)[]

export function formatFrontendTestInventory(rows: readonly FrontendTestInventoryRow[]): string {
  const lines = [inventoryColumns.join('\t')]
  for (const row of rows) {
    lines.push(
      inventoryColumns.map((column) => String(row[column]).replaceAll('\t', ' ').replaceAll('\n', ' ')).join('\t'),
    )
  }
  return `${lines.join('\n')}\n`
}

function inventorySummary(
  rows: readonly FrontendTestInventoryRow[],
  fullProjects: ReadonlyMap<string, ReadonlySet<string>>,
  ordinaryProjects: ReadonlyMap<string, ReadonlySet<string>>,
  aggregateOrdinaryProjects: ReadonlyMap<string, ReadonlySet<string>>,
): string {
  const targetCounts = new Map<FrontendCapability, number>([
    ['N', 0],
    ['S', 0],
    ['D', 0],
    ['B', 0],
  ])
  for (const row of rows) targetCounts.set(row.targetClass, (targetCounts.get(row.targetClass) ?? 0) + 1)
  const projectSummary = (projects: ReadonlyMap<string, ReadonlySet<string>>): string => {
    const total = [...projects.values()].reduce((sum, files) => sum + files.size, 0)
    return `${total} files (${vitestProjectNames.map((name) => `${name}=${projects.get(name)?.size ?? 0}`).join(', ')})`
  }
  return [
    `Full Vitest discovery: ${projectSummary(fullProjects)}`,
    `Standalone ordinary discovery: ${projectSummary(ordinaryProjects)}`,
    `test:all ordinary discovery: ${projectSummary(aggregateOrdinaryProjects)}`,
    `Browser smoke discovery: ${rows.filter((row) => row.currentProject === 'browser-smoke').length} files`,
    `Target candidates: ${[...targetCounts].map(([target, count]) => `${target}=${count}`).join(', ')}`,
    `Migration probes required: ${rows.filter((row) => row.ambiguityOrBlocker).length}`,
  ].join('\n')
}

interface CliOptions {
  mode: 'check' | 'write'
  file: string
}

function parseCliOptions(argv: readonly string[]): CliOptions {
  if (argv.length !== 2 || (argv[0] !== '--check' && argv[0] !== '--write')) {
    throw new Error('Usage: tsx util/frontend-test-inventory.ts (--check|--write) <inventory.tsv>')
  }
  return { mode: argv[0] === '--check' ? 'check' : 'write', file: argv[1] }
}

export function runFrontendTestInventoryCli(argv: readonly string[], rootDir = process.cwd()): number {
  const options = parseCliOptions(argv)
  const { rows, fullProjects, ordinaryProjects, aggregateOrdinaryProjects } = inventoryRows(rootDir)
  const output = formatFrontendTestInventory(rows)
  const outputFile = path.resolve(rootDir, options.file)

  if (options.mode === 'write') {
    fs.mkdirSync(path.dirname(outputFile), { recursive: true })
    fs.writeFileSync(outputFile, output)
  } else {
    if (!fs.existsSync(outputFile)) throw new Error(`Missing inventory: ${options.file}`)
    if (fs.readFileSync(outputFile, 'utf8') !== output) {
      throw new Error(`Frontend test inventory is stale; run pnpm update:frontend-test-inventory`)
    }
  }

  console.log(inventorySummary(rows, fullProjects, ordinaryProjects, aggregateOrdinaryProjects))
  console.log(`${options.mode === 'write' ? 'Wrote' : 'Verified'} ${options.file}`)
  return 0
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath && fs.existsSync(invokedPath)) {
  try {
    process.exitCode = runFrontendTestInventoryCli(process.argv.slice(2))
  } catch (error) {
    console.error(`[frontend-test-inventory] ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
