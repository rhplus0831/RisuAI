import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { performanceTestFiles } from '../vitest.performance-tests.js'

export type ChangeStatus = 'A' | 'M' | 'D' | 'R'

export interface ChangedPath {
  path: string
  status: ChangeStatus
}

export interface AffectedTestOptions {
  base: string
  bail: boolean
  includeSmoke: boolean
}

export interface TestCommand {
  label: string
  args: string[]
  env?: Record<string, string>
}

export interface AffectedTestPlan {
  commands: TestCommand[]
  notes: string[]
}

interface CliOptions extends AffectedTestOptions {
  all: boolean
  dryRun: boolean
}

const frontendTestPattern = /(?:^|\/).+\.test\.[cm]?[jt]sx?$/
const browserSmokePattern = /^server\/fastify\/browser-smoke\/.+\.spec\.ts$/
const performanceTestFileSet = new Set<string>(performanceTestFiles)
const rootRunnerFiles = new Set([
  '.archived-docs/performance-and-stability/test-suite-effectiveness-audit/frontend-routing-inventory.tsv',
  '.archived-docs/performance-and-stability/test-suite-effectiveness-audit/case-counts.json',
  '.archived-docs/performance-and-stability/test-suite-effectiveness-audit/inventory.json',
  '.archived-docs/performance-and-stability/test-suite-effectiveness-audit/support-artifacts.json',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'vite.config.ts',
  'vitest.config.ts',
  'vitest.setup.ts',
  'vitest.setup.test.ts',
  'util/frontend-test-inventory.ts',
  'util/test-case-counts.ts',
  'util/test-effectiveness-inventory.ts',
  'util/test-support-inventory.ts',
])
const fullQualityRunnerFiles = new Set(['util/affected-tests.ts', 'util/test-all.ts', 'util/test-watch.ts'])

function normalizeRepoPath(file: string): string {
  return file.replaceAll('\\', '/').replace(/^\.\//, '')
}

function isServerTest(file: string): boolean {
  return /^server\/fastify\/__tests__\/.+\.test\.[cm]?[jt]sx?$/.test(file)
}

function isFrontendTest(file: string): boolean {
  return frontendTestPattern.test(file) && !file.startsWith('server/')
}

function isExplicitGate(file: string): boolean {
  return performanceTestFileSet.has(file)
}

function isProtocolSource(file: string): boolean {
  return /^packages\/protocol\/src\/.+\.ts$/.test(file) && !isFrontendTest(file)
}

function isServerTestSupport(file: string): boolean {
  return /^server\/fastify\/(?:__tests__|__fixtures__)\/.+\.[cm]?[jt]sx?$/.test(file) && !isServerTest(file)
}

function isRootRunnerFile(file: string): boolean {
  return rootRunnerFiles.has(file) || /^vitest(?:\.[^/]+)?\.ts$/.test(file) || /^tsconfig(?:\.[^/]+)?\.json$/.test(file)
}

function commandArgs(args: string[], bail: boolean): string[] {
  return bail ? [...args, '--bail=1'] : args
}

function uniqueSorted(files: Iterable<string>): string[] {
  return [...new Set(files)].sort()
}

export function planAffectedTests(changes: readonly ChangedPath[], options: AffectedTestOptions): AffectedTestPlan {
  const normalized = changes.map((change) => ({ ...change, path: normalizeRepoPath(change.path) }))
  const notes: string[] = []
  const commands: TestCommand[] = []
  const existing = normalized.filter((change) => change.status !== 'D')
  const deleted = normalized.filter((change) => change.status === 'D')
  const directFrontendTests = uniqueSorted(
    existing.map((change) => change.path).filter((file) => isFrontendTest(file) && !isExplicitGate(file)),
  )
  const directGateTests = uniqueSorted(
    existing.map((change) => change.path).filter((file) => isFrontendTest(file) && isExplicitGate(file)),
  )
  const directServerTests = uniqueSorted(existing.map((change) => change.path).filter(isServerTest))
  const directSmokeTests = uniqueSorted(
    existing.map((change) => change.path).filter((file) => browserSmokePattern.test(file)),
  )

  const changedFiles = normalized.map((change) => change.path)
  const fullQualityChanged = changedFiles.some(
    (file) =>
      file === 'package.json' ||
      file === 'pnpm-lock.yaml' ||
      file === 'pnpm-workspace.yaml' ||
      file === '.npmrc' ||
      file === 'index.html' ||
      file === 'vite.config.ts' ||
      file === 'packages/protocol/package.json' ||
      file === 'packages/protocol/tsconfig.json' ||
      fullQualityRunnerFiles.has(file) ||
      file.startsWith('.github/'),
  )
  if (fullQualityChanged) {
    return {
      commands: [{ label: 'full quality suite', args: ['test:all'] }],
      notes: ['Build, dependency, or CI configuration changed; targeted test selection is unsafe.'],
    }
  }
  const rootRunnerChanged = changedFiles.some(isRootRunnerFile)
  const serverRunnerChanged = changedFiles.some(
    (file) => file === 'server/fastify/vitest.config.ts' || file === 'server/fastify/tsconfig.json',
  )
  const smokeRunnerChanged = changedFiles.some(
    (file) =>
      file === 'playwright.fastify-smoke.config.ts' ||
      file === 'tsconfig.browser-smoke.json' ||
      file.startsWith('server/fastify/browser-smoke/') ||
      file.startsWith('public/'),
  )
  const compatHarnessChanged = changedFiles.some((file) => file.startsWith('test/compat-harness/'))
  const protocolSourceChanged = existing.some(({ path: file }) => isProtocolSource(file))
  const deletedProtocolSource = deleted.some(({ path: file }) => isProtocolSource(file))
  const frontendSourceChanged = existing.some(
    ({ path: file }) =>
      (/^(?:src|util|server\/fastify\/src)\//.test(file) || isProtocolSource(file)) &&
      !isFrontendTest(file) &&
      !isServerTest(file),
  )
  const serverSourceChanged = existing.some(
    ({ path: file }) =>
      (/^(?:server\/fastify\/src|src)\//.test(file) || isProtocolSource(file) || isServerTestSupport(file)) &&
      !isFrontendTest(file) &&
      !isServerTest(file),
  )
  const deletedFrontendSource = deleted.some(({ path: file }) => /^(?:src|util|server\/fastify\/src)\//.test(file))
  const deletedServerSource = deleted.some(({ path: file }) => /^(?:server\/fastify\/src|src)\//.test(file))
  const deletedServerTestSupport = deleted.some(({ path: file }) => isServerTestSupport(file))
  const deletedFrontendTest = deleted.some(({ path: file }) => isFrontendTest(file))
  const deletedServerTest = deleted.some(({ path: file }) => isServerTest(file))

  const runFullFrontend = rootRunnerChanged || deletedFrontendSource || deletedProtocolSource || deletedFrontendTest
  const runFullServer =
    rootRunnerChanged ||
    serverRunnerChanged ||
    deletedServerSource ||
    deletedProtocolSource ||
    deletedServerTestSupport ||
    deletedServerTest
  const runFullGates = rootRunnerChanged
  const frontendRoutingRelevant =
    runFullFrontend ||
    frontendSourceChanged ||
    directFrontendTests.length > 0 ||
    runFullGates ||
    directGateTests.length > 0

  if (frontendRoutingRelevant) {
    commands.push({ label: 'test inventory and routing', args: ['check:test-inventories'] })
  }

  if (protocolSourceChanged || deletedProtocolSource) {
    commands.push({ label: 'protocol typecheck', args: ['check:protocol'] })
  }

  if (runFullFrontend) {
    commands.push({ label: 'frontend tests', args: ['test:frontend:run'] })
  } else if (frontendSourceChanged) {
    commands.push({
      label: 'affected frontend tests',
      args: commandArgs(['exec', 'vitest', 'run', '--changed', options.base, '--passWithNoTests'], options.bail),
    })
  } else if (directFrontendTests.length > 0) {
    commands.push({
      label: 'changed frontend tests',
      args: commandArgs(['exec', 'vitest', 'run', ...directFrontendTests], options.bail),
    })
  }

  if (runFullGates) {
    commands.push({ label: 'frontend performance gates', args: ['test:gates:perf'] })
  } else if (directGateTests.length > 0) {
    commands.push({
      label: 'changed frontend gates',
      args: commandArgs(['exec', 'vitest', 'run', ...directGateTests], options.bail),
      env: { RISU_TEST_INCLUDE_GATES: 'true' },
    })
  }

  if (runFullServer) {
    commands.push({ label: 'server tests', args: ['test:server'] })
  } else if (serverSourceChanged) {
    commands.push({
      label: 'affected server tests',
      args: commandArgs(
        [
          'exec',
          'vitest',
          'run',
          '--config',
          'server/fastify/vitest.config.ts',
          '--changed',
          options.base,
          '--passWithNoTests',
        ],
        options.bail,
      ),
    })
  } else if (directServerTests.length > 0) {
    commands.push({
      label: 'changed server tests',
      args: commandArgs(
        ['exec', 'vitest', 'run', '--config', 'server/fastify/vitest.config.ts', ...directServerTests],
        options.bail,
      ),
    })
  }

  const smokeRelevant = smokeRunnerChanged || directSmokeTests.length > 0
  if (smokeRelevant && options.includeSmoke) {
    commands.push({ label: 'browser smoke tests', args: ['test:smoke'] })
  } else if (smokeRelevant) {
    notes.push('Browser-smoke changes detected; rerun with --include-smoke before handoff.')
  }

  if (compatHarnessChanged) {
    commands.push({ label: 'current compatibility harness', args: ['test:compat-current'] })
    notes.push('Run the full pinned compatibility harness when its external baseline worktree is available.')
  }

  if (commands.length === 0) {
    notes.push('No affected automated test lane was found for the changed paths.')
  }

  return { commands, notes }
}

function gitOutput(args: string[], cwd = process.cwd()): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `git ${args.join(' ')} failed`
    throw new Error(detail)
  }
  return result.stdout
}

export function parseNameStatus(output: string): ChangedPath[] {
  const fields = output.split('\0').filter(Boolean)
  const changes: ChangedPath[] = []
  for (let index = 0; index < fields.length; ) {
    const rawStatus = fields[index++]
    const status = rawStatus[0] as ChangeStatus
    if (status === 'R') {
      const previousPath = fields[index++]
      const renamedPath = fields[index++]
      changes.push({ path: previousPath, status: 'D' })
      changes.push({ path: renamedPath, status })
      continue
    }
    const file = fields[index++]
    if (status === 'A' || status === 'M' || status === 'D') {
      changes.push({ path: file, status })
    }
  }
  return changes
}

export function collectChangedPaths(base: string, cwd = process.cwd()): ChangedPath[] {
  gitOutput(['rev-parse', '--verify', `${base}^{commit}`], cwd)
  const byPath = new Map<string, ChangedPath>()
  const record = (change: ChangedPath): void => {
    byPath.set(normalizeRepoPath(change.path), { ...change, path: normalizeRepoPath(change.path) })
  }

  for (const change of parseNameStatus(
    gitOutput(['diff', '--name-status', '-z', '--find-renames', `${base}...HEAD`], cwd),
  )) {
    record(change)
  }
  for (const change of parseNameStatus(gitOutput(['diff', '--name-status', '-z', '--find-renames', 'HEAD'], cwd))) {
    record(change)
  }
  for (const file of gitOutput(['ls-files', '--others', '--exclude-standard', '-z'], cwd).split('\0').filter(Boolean)) {
    record({ path: file, status: 'A' })
  }

  return [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path))
}

function parseCli(args: string[]): CliOptions {
  let base = process.env.RISU_TEST_BASE?.trim() || 'HEAD'
  let bail = true
  let includeSmoke = false
  let all = false
  let dryRun = false

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--base') {
      const value = args[index + 1]
      if (!value) throw new Error('--base requires a git revision')
      base = value
      index += 1
    } else if (arg.startsWith('--base=')) {
      base = arg.slice('--base='.length)
    } else if (arg === '--no-bail') {
      bail = false
    } else if (arg === '--include-smoke') {
      includeSmoke = true
    } else if (arg === '--all') {
      all = true
    } else if (arg === '--dry-run') {
      dryRun = true
    } else if (arg === '--') {
      continue
    } else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: pnpm test:affected [--base <git-ref>] [--no-bail] [--include-smoke] [--all] [--dry-run]

Runs changed test files directly and uses Vitest's dependency-aware --changed mode
for changed source files. The default base is HEAD, which targets uncommitted work.`)
      process.exit(0)
    } else {
      throw new Error(`unknown option: ${arg}`)
    }
  }

  return { base, bail, includeSmoke, all, dryRun }
}

function displayCommand(command: TestCommand): string {
  const env = command.env
    ? `${Object.entries(command.env)
        .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
        .join(' ')} `
    : ''
  return `${env}pnpm ${command.args.map((arg) => JSON.stringify(arg)).join(' ')}`
}

function run(): void {
  const options = parseCli(process.argv.slice(2))
  if (options.all) {
    const command = { label: 'full quality suite', args: ['test:all'] }
    console.log(`[test:affected] ${command.label}: ${displayCommand(command)}`)
    if (options.dryRun) return
    const result = spawnSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', command.args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
    })
    if (result.error) throw result.error
    process.exit(result.status ?? 1)
  }
  const changes = collectChangedPaths(options.base)
  if (changes.length === 0) {
    console.log(`[test:affected] no changes found relative to ${options.base}`)
    return
  }

  console.log(`[test:affected] ${changes.length} changed path(s) relative to ${options.base}`)
  for (const change of changes) console.log(`  ${change.status} ${change.path}`)

  const plan = planAffectedTests(changes, options)
  for (const note of plan.notes) console.log(`[test:affected] ${note}`)
  for (const command of plan.commands) console.log(`[test:affected] ${command.label}: ${displayCommand(command)}`)
  if (options.dryRun) return

  for (const command of plan.commands) {
    const result = spawnSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', command.args, {
      cwd: process.cwd(),
      env: { ...process.env, ...command.env },
      stdio: 'inherit',
    })
    if (result.error) throw result.error
    if (result.status !== 0) process.exit(result.status ?? 1)
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath && existsSync(invokedPath)) {
  try {
    run()
  } catch (error) {
    console.error(`[test:affected] ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}
