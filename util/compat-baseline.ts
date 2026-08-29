import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const COMPAT_BASELINE_COMMIT = '71c476e9c86263fe907105b011ca4dde0a619d66'
export const COMPAT_BASELINE_ROOT = '/home/codex/risu-baseline-71c476e9c'
export const COMPAT_SOURCE_ROOT = path.resolve(import.meta.dirname, '..')

const PREPARE_COMMAND = 'pnpm exec tsx util/compat-baseline.ts --prepare'

type BaselineMode = 'check' | 'prepare'

interface CommandOptions {
  cwd: string
}

export type BaselineCommandRunner = (file: string, args: string[], options: CommandOptions) => string

export interface CompatibilityBaselineOptions {
  mode?: BaselineMode
  baselineRoot?: string
  sourceRoot?: string
  baselineCommit?: string
  runCommand?: BaselineCommandRunner
}

export interface CompatibilityBaselineResult {
  baselineRoot: string
  baselineCommit: string
  created: boolean
  dependenciesInstalled: boolean
}

function defaultRunCommand(file: string, args: string[], options: CommandOptions): string {
  return execFileSync(file, args, { cwd: options.cwd, encoding: 'utf8' })
}

function git(runCommand: BaselineCommandRunner, cwd: string, args: string[]): string {
  return runCommand('git', args, { cwd }).trim()
}

function assertPinnedBaseline(runCommand: BaselineCommandRunner, baselineRoot: string, baselineCommit: string): void {
  let actualCommit: string
  try {
    actualCommit = git(runCommand, baselineRoot, ['rev-parse', '--verify', 'HEAD^{commit}'])
  } catch (error) {
    throw new Error(`Compatibility baseline is not a Git worktree: ${baselineRoot}`, { cause: error })
  }
  if (actualCommit !== baselineCommit) {
    throw new Error(`Compatibility baseline is at ${actualCommit}; expected ${baselineCommit}: ${baselineRoot}`)
  }

  const branch = git(runCommand, baselineRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])
  if (branch !== 'HEAD') {
    throw new Error(`Compatibility baseline must be detached, but HEAD is attached to ${branch}: ${baselineRoot}`)
  }

  const status = git(runCommand, baselineRoot, ['status', '--porcelain=v1', '--untracked-files=all'])
  if (status) {
    throw new Error(`Compatibility baseline is dirty; refusing to continue: ${baselineRoot}\n${status}`)
  }
}

function assertSourceCommit(runCommand: BaselineCommandRunner, sourceRoot: string, baselineCommit: string): void {
  let resolvedCommit: string
  try {
    resolvedCommit = git(runCommand, sourceRoot, ['rev-parse', '--verify', `${baselineCommit}^{commit}`])
  } catch (error) {
    throw new Error(`Pinned compatibility commit ${baselineCommit} is unavailable in ${sourceRoot}`, { cause: error })
  }
  if (resolvedCommit !== baselineCommit) {
    throw new Error(`Pinned compatibility commit resolved to ${resolvedCommit}; expected ${baselineCommit}`)
  }
}

function dependenciesReady(baselineRoot: string): boolean {
  return existsSync(path.resolve(baselineRoot, 'node_modules/.modules.yaml'))
}

export function checkCompatibilityBaseline(
  options: Omit<CompatibilityBaselineOptions, 'mode'> = {},
): CompatibilityBaselineResult {
  return prepareCompatibilityBaseline({ ...options, mode: 'check' })
}

export function prepareCompatibilityBaseline(options: CompatibilityBaselineOptions = {}): CompatibilityBaselineResult {
  const mode = options.mode ?? 'prepare'
  const baselineRoot = options.baselineRoot ?? COMPAT_BASELINE_ROOT
  const sourceRoot = options.sourceRoot ?? COMPAT_SOURCE_ROOT
  const baselineCommit = options.baselineCommit ?? COMPAT_BASELINE_COMMIT
  const runCommand = options.runCommand ?? defaultRunCommand
  let created = false
  let dependenciesInstalled = false

  if (!existsSync(baselineRoot)) {
    if (mode === 'check') {
      throw new Error(`Pinned compatibility baseline is missing: ${baselineRoot}\nPrepare it with: ${PREPARE_COMMAND}`)
    }
    assertSourceCommit(runCommand, sourceRoot, baselineCommit)
    mkdirSync(path.dirname(baselineRoot), { recursive: true })
    runCommand('git', ['worktree', 'add', '--detach', baselineRoot, baselineCommit], { cwd: sourceRoot })
    created = true
  }

  assertPinnedBaseline(runCommand, baselineRoot, baselineCommit)

  if (!dependenciesReady(baselineRoot)) {
    if (mode === 'check') {
      throw new Error(
        `Compatibility baseline dependencies are missing: ${baselineRoot}\nPrepare them with: ${PREPARE_COMMAND}`,
      )
    }
    runCommand('pnpm', ['install', '--frozen-lockfile', '--ignore-scripts'], { cwd: baselineRoot })
    dependenciesInstalled = true
    if (!dependenciesReady(baselineRoot)) {
      throw new Error(`pnpm completed without preparing baseline dependencies: ${baselineRoot}`)
    }
    assertPinnedBaseline(runCommand, baselineRoot, baselineCommit)
  }

  return { baselineRoot, baselineCommit, created, dependenciesInstalled }
}

function parseMode(args: string[]): BaselineMode {
  if (args.length === 1 && args[0] === '--check') return 'check'
  if (args.length === 0 || (args.length === 1 && args[0] === '--prepare')) return 'prepare'
  throw new Error(`Usage: tsx util/compat-baseline.ts [--check|--prepare]`)
}

export function runCompatibilityBaselineCli(args = process.argv.slice(2)): number {
  const result = prepareCompatibilityBaseline({ mode: parseMode(args) })
  const action = result.created || result.dependenciesInstalled ? 'prepared' : 'verified'
  console.log(`Compatibility baseline ${action}: ${result.baselineRoot} @ ${result.baselineCommit} (detached, clean)`)
  return 0
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath && existsSync(invokedPath)) {
  process.exitCode = runCompatibilityBaselineCli()
}
