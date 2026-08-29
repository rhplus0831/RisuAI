import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  appendFileSync,
  createReadStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  truncateSync,
  watch,
  writeFileSync,
  type FSWatcher,
} from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { Writable } from 'node:stream'
import type { TestRunResult, TestSpecification, Vitest } from 'vitest/node'
import {
  FULL_QUALITY_CHANGE_NOTE,
  collectChangedPaths,
  planAffectedTests,
  type AffectedTestPlan,
  type ChangedPath,
  type TestCommand,
} from './affected-tests.js'

export const TEST_WATCH_SCHEMA_VERSION = 2
export const TEST_WATCH_DIRECTORY = '.test-watch'
export const TEST_WATCH_STATUS_FILE = 'status.json'
export const TEST_WATCH_LOG_FILE = 'latest.log'
export const TEST_WATCH_HEARTBEAT_MS = 5_000
export const TEST_WATCH_HEARTBEAT_STALE_MS = 20_000

const SNAPSHOT_RETRIES = 5
const DEFAULT_DEBOUNCE_MS = 400
const IGNORED_WATCH_DIRECTORIES = new Set([
  '.git',
  TEST_WATCH_DIRECTORY,
  'coverage',
  'data',
  'data-agent',
  'dist',
  'fast-bootstrap-results',
  'node_modules',
  'save',
  'test-results',
])

export type TestWatchState =
  | 'starting'
  | 'running'
  | 'waiting-for-commit'
  | 'passed'
  | 'failed'
  | 'stale'
  | 'error'
  | 'stopped'

export interface WorktreeSnapshot {
  baseCommit: string
  changes: ChangedPath[]
  fingerprint: string
  headCommit: string
  pathFingerprints: ReadonlyMap<string, string>
}

export interface WorktreeDelta {
  changes: ChangedPath[]
  removedPaths: string[]
}

export interface TestWatchCommandResult {
  command: string
  durationMs: number
  failure?: string
  label: string
  status: 'passed' | 'failed'
  testFiles?: number
}

export interface TestWatchStatus {
  affectedCommands: Array<{ command: string; label: string }>
  base: string
  changedPaths: ChangedPath[]
  commandResults: TestWatchCommandResult[]
  commands: Array<{ command: string; label: string }>
  executionChangedPaths: ChangedPath[]
  executionMode: 'full' | 'incremental'
  durationMs?: number
  failure?: string
  generation: number
  heartbeatAt: string
  includeSmoke: boolean
  logPath: string
  notes: string[]
  pid: number
  projectRoot: string
  runFinishedAt?: string
  runStartedAt?: string
  schemaVersion: typeof TEST_WATCH_SCHEMA_VERSION
  state: TestWatchState
  targetFingerprint?: string
  testedFingerprint?: string
  reusedTestedFingerprint?: string
  watcherId: string
}

export interface TestWatchStatusEvaluation {
  currentFingerprint?: string
  exitCode: 0 | 1 | 2
  message: string
  verdict: 'passed' | 'failed' | 'running' | 'stale' | 'unavailable'
}

export interface TestWatchCliOptions {
  base: string
  debounceMs: number
  help: boolean
  includeSmoke: boolean
  json: boolean
  once: boolean
  statusOnly: boolean
}

class SnapshotChangedError extends Error {}

function gitOutput(repoRoot: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' })
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `git ${args.join(' ')} failed`
    throw new Error(detail)
  }
  return result.stdout.trim()
}

function changeListKey(changes: readonly ChangedPath[]): string {
  return changes.map((change) => `${change.status}\0${change.path}`).join('\0')
}

function assertInsideRepo(repoRoot: string, relativePath: string): string {
  const absolutePath = path.resolve(repoRoot, relativePath)
  const relative = path.relative(repoRoot, absolutePath)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`changed path escapes the repository: ${relativePath}`)
  }
  return absolutePath
}

function sameStat(left: ReturnType<typeof lstatSync>, right: ReturnType<typeof lstatSync>): boolean {
  return (
    left.ctimeMs === right.ctimeMs &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.mtimeMs === right.mtimeMs &&
    left.size === right.size
  )
}

async function fingerprintChangedPath(repoRoot: string, change: ChangedPath): Promise<string> {
  const hash = createHash('sha256')
  hash.update(`change\0${change.status}\0${change.path}\0`)
  if (change.status === 'D') return hash.digest('hex')

  const absolutePath = assertInsideRepo(repoRoot, change.path)
  let before: ReturnType<typeof lstatSync>
  try {
    before = lstatSync(absolutePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new SnapshotChangedError()
    throw error
  }
  hash.update(`stat\0${before.mode}\0${before.size}\0`)
  if (before.isSymbolicLink()) {
    hash.update(`link\0${readlinkSync(absolutePath)}\0`)
  } else if (before.isFile()) {
    for await (const chunk of createReadStream(absolutePath)) hash.update(chunk as Buffer)
  } else {
    hash.update(`non-file\0${before.mode}\0`)
  }

  let after: ReturnType<typeof lstatSync>
  try {
    after = lstatSync(absolutePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new SnapshotChangedError()
    throw error
  }
  if (!sameStat(before, after)) throw new SnapshotChangedError()
  return hash.digest('hex')
}

async function createWorktreeSnapshotOnce(repoRoot: string, base: string): Promise<WorktreeSnapshot> {
  const baseCommit = gitOutput(repoRoot, ['rev-parse', '--verify', `${base}^{commit}`])
  const headCommit = gitOutput(repoRoot, ['rev-parse', '--verify', 'HEAD^{commit}'])
  const changes = collectChangedPaths(base, repoRoot)
  const hash = createHash('sha256')
  const pathFingerprints = new Map<string, string>()
  hash.update(`risu-test-watch-v2\0${baseCommit}\0${headCommit}\0`)
  for (const change of changes) {
    const pathFingerprint = await fingerprintChangedPath(repoRoot, change)
    pathFingerprints.set(change.path, pathFingerprint)
    hash.update(`path\0${pathFingerprint}\0`)
  }

  const finalHeadCommit = gitOutput(repoRoot, ['rev-parse', '--verify', 'HEAD^{commit}'])
  const finalChanges = collectChangedPaths(base, repoRoot)
  if (headCommit !== finalHeadCommit || changeListKey(changes) !== changeListKey(finalChanges)) {
    throw new SnapshotChangedError()
  }

  return { baseCommit, changes, fingerprint: hash.digest('hex'), headCommit, pathFingerprints }
}

export async function createWorktreeSnapshot(repoRoot: string, base: string): Promise<WorktreeSnapshot> {
  for (let attempt = 0; attempt < SNAPSHOT_RETRIES; attempt += 1) {
    try {
      return await createWorktreeSnapshotOnce(repoRoot, base)
    } catch (error) {
      if (!(error instanceof SnapshotChangedError) || attempt === SNAPSHOT_RETRIES - 1) throw error
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }
  throw new Error('could not capture a stable worktree snapshot')
}

export function diffWorktreeSnapshots(previous: WorktreeSnapshot, current: WorktreeSnapshot): WorktreeDelta {
  const changes = current.changes.filter(
    (change) => previous.pathFingerprints.get(change.path) !== current.pathFingerprints.get(change.path),
  )
  const removedPaths = [...previous.pathFingerprints.keys()]
    .filter((file) => !current.pathFingerprints.has(file))
    .sort()
  return { changes, removedPaths }
}

function affectedPlanShape(plan: AffectedTestPlan): string {
  return JSON.stringify({
    commands: plan.commands.map((command) => ({ env: command.env ?? {}, label: command.label })),
    notes: plan.notes,
  })
}

function isAddedVitestTest(file: string): boolean {
  return /(?:^|\/).+\.test\.[cm]?[jt]sx?$/.test(file)
}

function isPotentialSourceAddition(file: string): boolean {
  return /^(?:packages\/protocol\/src|server\/fastify\/(?:__fixtures__|src)|src|util)\//.test(file)
}

export function canRunIncrementally(
  previousSnapshot: WorktreeSnapshot,
  currentSnapshot: WorktreeSnapshot,
  previousPlan: AffectedTestPlan,
  currentPlan: AffectedTestPlan,
  delta: WorktreeDelta,
): boolean {
  if (
    previousSnapshot.baseCommit !== currentSnapshot.baseCommit ||
    previousSnapshot.headCommit !== currentSnapshot.headCommit ||
    delta.removedPaths.length > 0 ||
    affectedPlanShape(previousPlan) !== affectedPlanShape(currentPlan)
  ) {
    return false
  }
  return !delta.changes.some(
    (change) =>
      change.status === 'D' ||
      change.status === 'R' ||
      (change.status === 'A' &&
        !previousSnapshot.pathFingerprints.has(change.path) &&
        isPotentialSourceAddition(change.path) &&
        !isAddedVitestTest(change.path)),
  )
}

export function testWatchPaths(repoRoot: string): { directory: string; log: string; status: string } {
  const directory = path.join(repoRoot, TEST_WATCH_DIRECTORY)
  return {
    directory,
    log: path.join(directory, TEST_WATCH_LOG_FILE),
    status: path.join(directory, TEST_WATCH_STATUS_FILE),
  }
}

export function writeTestWatchStatus(statusPath: string, status: TestWatchStatus): void {
  mkdirSync(path.dirname(statusPath), { recursive: true })
  const temporaryPath = path.join(
    path.dirname(statusPath),
    `.${path.basename(statusPath)}.${process.pid}.${randomUUID()}.tmp`,
  )
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(status, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    renameSync(temporaryPath, statusPath)
  } finally {
    rmSync(temporaryPath, { force: true })
  }
}

export function readTestWatchStatus(statusPath: string): TestWatchStatus | undefined {
  if (!existsSync(statusPath)) return undefined
  const parsed = JSON.parse(readFileSync(statusPath, 'utf8')) as Partial<Omit<TestWatchStatus, 'schemaVersion'>> & {
    schemaVersion?: number
  }
  if (typeof parsed.watcherId !== 'string' || (parsed.schemaVersion !== 1 && parsed.schemaVersion !== 2)) {
    throw new Error(`unsupported test watcher status schema in ${statusPath}`)
  }
  if (parsed.schemaVersion === 1) {
    return {
      ...parsed,
      affectedCommands: parsed.commands ?? [],
      executionChangedPaths: parsed.changedPaths ?? [],
      executionMode: 'full',
      schemaVersion: TEST_WATCH_SCHEMA_VERSION,
    } as TestWatchStatus
  }
  return parsed as TestWatchStatus
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export function evaluateTestWatchStatus(
  status: TestWatchStatus | undefined,
  currentFingerprint: string | undefined,
  options: {
    base?: string
    includeSmoke?: boolean
    nowMs?: number
    processAlive?: boolean
    projectRoot?: string
  } = {},
): TestWatchStatusEvaluation {
  if (!status) {
    return { exitCode: 2, message: 'no test watcher status is available', verdict: 'unavailable' }
  }
  const nowMs = options.nowMs ?? Date.now()
  const processAlive = options.processAlive ?? isProcessAlive(status.pid)
  const heartbeatAge = nowMs - Date.parse(status.heartbeatAt)
  if (options.projectRoot && path.resolve(status.projectRoot) !== path.resolve(options.projectRoot)) {
    return {
      currentFingerprint,
      exitCode: 2,
      message: 'the test watcher status belongs to a different worktree',
      verdict: 'unavailable',
    }
  }
  if (options.base && status.base !== options.base) {
    return {
      currentFingerprint,
      exitCode: 2,
      message: `the test watcher uses base ${status.base}, not ${options.base}`,
      verdict: 'unavailable',
    }
  }
  if (options.includeSmoke && !status.includeSmoke) {
    return {
      currentFingerprint,
      exitCode: 2,
      message: 'the test watcher result does not include browser smoke',
      verdict: 'unavailable',
    }
  }
  if (!processAlive || !Number.isFinite(heartbeatAge) || heartbeatAge > TEST_WATCH_HEARTBEAT_STALE_MS) {
    return {
      currentFingerprint,
      exitCode: 2,
      message: 'the test watcher is not running or its heartbeat is stale',
      verdict: 'unavailable',
    }
  }
  if (
    (status.state === 'running' || status.state === 'starting') &&
    currentFingerprint &&
    status.targetFingerprint === currentFingerprint
  ) {
    return {
      currentFingerprint,
      exitCode: 2,
      message: `generation ${status.generation} is still running`,
      verdict: 'running',
    }
  }
  if (status.state === 'waiting-for-commit' && currentFingerprint && status.targetFingerprint === currentFingerprint) {
    return {
      currentFingerprint,
      exitCode: 2,
      message: `generation ${status.generation} is waiting for a commit`,
      verdict: 'running',
    }
  }
  if (!currentFingerprint || status.testedFingerprint !== currentFingerprint) {
    return {
      currentFingerprint,
      exitCode: 2,
      message: 'the latest test result does not match the current worktree',
      verdict: 'stale',
    }
  }
  if (status.state === 'passed') {
    return {
      currentFingerprint,
      exitCode: 0,
      message: `generation ${status.generation} passed for the current worktree`,
      verdict: 'passed',
    }
  }
  if (status.state === 'failed') {
    return {
      currentFingerprint,
      exitCode: 1,
      message: `generation ${status.generation} failed for the current worktree`,
      verdict: 'failed',
    }
  }
  return {
    currentFingerprint,
    exitCode: 2,
    message: `the latest test watcher state is ${status.state}`,
    verdict: status.state === 'stale' ? 'stale' : 'unavailable',
  }
}

function parsePositiveInteger(value: string, option: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${option} requires a positive integer`)
  return parsed
}

export function parseTestWatchCli(args: string[]): TestWatchCliOptions {
  const options: TestWatchCliOptions = {
    base: process.env.RISU_TEST_BASE?.trim() || 'HEAD',
    debounceMs: DEFAULT_DEBOUNCE_MS,
    help: false,
    includeSmoke: false,
    json: false,
    once: false,
    statusOnly: false,
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--base') {
      const value = args[index + 1]
      if (!value) throw new Error('--base requires a git revision')
      options.base = value
      index += 1
    } else if (arg.startsWith('--base=')) {
      options.base = arg.slice('--base='.length)
    } else if (arg === '--debounce-ms') {
      const value = args[index + 1]
      if (!value) throw new Error('--debounce-ms requires a value')
      options.debounceMs = parsePositiveInteger(value, '--debounce-ms')
      index += 1
    } else if (arg.startsWith('--debounce-ms=')) {
      options.debounceMs = parsePositiveInteger(arg.slice('--debounce-ms='.length), '--debounce-ms')
    } else if (arg === '--include-smoke') {
      options.includeSmoke = true
    } else if (arg === '--json') {
      options.json = true
    } else if (arg === '--once') {
      options.once = true
    } else if (arg === '--status') {
      options.statusOnly = true
    } else if (arg === '--help' || arg === '-h') {
      options.help = true
    } else if (arg === '--') {
      continue
    } else {
      throw new Error(`unknown option: ${arg}`)
    }
  }
  return options
}

export function displayTestCommand(command: TestCommand): string {
  const env = command.env
    ? `${Object.entries(command.env)
        .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
        .join(' ')} `
    : ''
  return `${env}pnpm ${command.args.map((arg) => JSON.stringify(arg)).join(' ')}`
}

export function extractVitestFileFilters(command: TestCommand): string[] {
  const runIndex = command.args.indexOf('run')
  if (runIndex < 0) return []
  const filters: string[] = []
  for (let index = runIndex + 1; index < command.args.length; index += 1) {
    const arg = command.args[index]
    if (arg === '--config') {
      index += 1
    } else if (!arg.startsWith('-')) {
      filters.push(arg)
    }
  }
  return filters
}

export class TestWatchLog {
  readonly stderr: Writable
  readonly stdout: Writable
  private logPath: string
  private writeTerminalStdout: (content: string | Uint8Array) => boolean

  constructor(logPath: string, stdout = process.stdout, stderr = process.stderr) {
    this.logPath = logPath
    const writeTerminalStdout = stdout.write.bind(stdout)
    const writeTerminalStderr = stderr.write.bind(stderr)
    this.writeTerminalStdout = writeTerminalStdout
    const createWriter = (writeTerminal: (content: string | Uint8Array) => boolean) =>
      new Writable({
        write: (chunk, encoding, callback) => {
          try {
            const content = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding as BufferEncoding)
            writeTerminal(content)
            appendFileSync(this.logPath, content)
            callback()
          } catch (error) {
            callback(error as Error)
          }
        },
      })
    this.stdout = createWriter(writeTerminalStdout)
    this.stderr = createWriter(writeTerminalStderr)
  }

  reset(header: string): void {
    mkdirSync(path.dirname(this.logPath), { recursive: true })
    if (!existsSync(this.logPath)) writeFileSync(this.logPath, '')
    truncateSync(this.logPath)
    appendFileSync(this.logPath, `${header}\n`)
    this.writeTerminalStdout(`${header}\n`)
  }
}

interface VitestCommandResult {
  failure?: string
  passed: boolean
  testFiles: number
}

export function prepareVitestContext(context: Vitest, repoRoot: string, changes: readonly ChangedPath[]): void {
  const prepared = new Set<string>()
  for (const change of changes) {
    const absolutePath = path.resolve(repoRoot, change.path)
    if (prepared.has(absolutePath)) continue
    prepared.add(absolutePath)

    if (change.status !== 'D') {
      let source: string | undefined
      const matchesTest = context.projects.some((project) =>
        project.matchesTestGlob(absolutePath, () => (source ??= readFileSync(absolutePath, 'utf8'))),
      )
      if (matchesTest) context.clearSpecificationsCache(absolutePath)
    }
    context.invalidateFile(absolutePath)
    context.watcher.invalidates.add(absolutePath)
  }
}

class WarmVitestLane {
  private contextPromise?: Promise<Vitest>

  constructor(
    private readonly repoRoot: string,
    private readonly config: string,
    private readonly log: TestWatchLog,
  ) {}

  private async context(): Promise<Vitest> {
    if (!this.contextPromise) {
      this.contextPromise = (async () => {
        const { createVitest } = await import('vitest/node')
        const context = await createVitest(
          'test',
          {
            bail: 1,
            clearScreen: false,
            config: this.config,
            passWithNoTests: true,
            root: this.repoRoot,
            run: true,
            watch: false,
          },
          undefined,
          { stderr: this.log.stderr, stdout: this.log.stdout },
        )
        await context.standalone()
        return context
      })().catch((error) => {
        this.contextPromise = undefined
        throw error
      })
    }
    return this.contextPromise
  }

  async close(): Promise<void> {
    if (!this.contextPromise) return
    const context = await this.contextPromise.catch(() => undefined)
    this.contextPromise = undefined
    await context?.close()
  }

  async warm(): Promise<void> {
    await this.context()
  }

  async recycle(): Promise<void> {
    await this.close()
    await this.context()
  }

  private async prepare(changes: readonly ChangedPath[]): Promise<Vitest> {
    const context = await this.context()
    prepareVitestContext(context, this.repoRoot, changes)
    return context
  }

  private async runSpecifications(
    context: Vitest,
    specifications: TestSpecification[],
    allTestsRun = false,
  ): Promise<VitestCommandResult> {
    if (specifications.length === 0) {
      context.watcher.invalidates.clear()
      this.log.stdout.write('[test:watch] no related test files found\n')
      return { passed: true, testFiles: 0 }
    }

    let result: TestRunResult
    try {
      result = await context.runTestSpecifications(specifications, allTestsRun)
    } finally {
      process.exitCode = undefined
    }
    const incomplete = specifications.filter((specification) => !specification.testModule?.ok())
    const passed = incomplete.length === 0 && result.unhandledErrors.length === 0
    const failureParts = [
      ...incomplete.map((specification) => `${path.relative(this.repoRoot, specification.moduleId)} did not pass`),
      ...result.unhandledErrors.map((error) => (error instanceof Error ? error.message : String(error))),
    ]
    return {
      failure: failureParts.length > 0 ? failureParts.join('; ') : undefined,
      passed,
      testFiles: specifications.length,
    }
  }

  async runAll(changes: readonly ChangedPath[]): Promise<VitestCommandResult> {
    const context = await this.prepare(changes)
    context.config.related = undefined
    const specifications = await context.globTestSpecifications()
    return this.runSpecifications(context, specifications, true)
  }

  async runDirect(filters: readonly string[], changes: readonly ChangedPath[]): Promise<VitestCommandResult> {
    const context = await this.prepare(changes)
    context.config.related = undefined
    const absoluteFilters = filters.map((filter) => path.resolve(this.repoRoot, filter))
    const specifications = await context.getRelevantTestSpecifications(absoluteFilters)
    return this.runSpecifications(context, specifications)
  }

  async runRelated(changes: readonly ChangedPath[]): Promise<VitestCommandResult> {
    const context = await this.prepare(changes)
    context.config.related = changes
      .filter((change) => change.status !== 'D')
      .map((change) => path.resolve(this.repoRoot, change.path))
    try {
      const specifications = await context.getRelevantTestSpecifications()
      return await this.runSpecifications(context, specifications)
    } finally {
      context.config.related = undefined
    }
  }
}

class TestCommandRunner {
  private activeChild?: ChildProcess
  private readonly frontend: WarmVitestLane
  private readonly server: WarmVitestLane

  constructor(
    private readonly repoRoot: string,
    private readonly log: TestWatchLog,
  ) {
    this.frontend = new WarmVitestLane(repoRoot, 'vitest.config.ts', log)
    this.server = new WarmVitestLane(repoRoot, 'server/fastify/vitest.config.ts', log)
  }

  async close(): Promise<void> {
    if (this.activeChild && this.activeChild.exitCode === null) this.activeChild.kill('SIGTERM')
    await Promise.all([this.frontend.close(), this.server.close()])
  }

  async warm(): Promise<boolean> {
    const results = await Promise.allSettled([this.frontend.warm(), this.server.warm()])
    const labels = ['frontend', 'server']
    let warmed = true
    for (const [index, result] of results.entries()) {
      if (result.status === 'fulfilled') continue
      warmed = false
      const failure = result.reason instanceof Error ? result.reason.message : String(result.reason)
      this.log.stderr.write(
        `[test:watch] ${labels[index]} Vitest warm-up failed; initialization will retry when selected: ${failure}\n`,
      )
    }
    return warmed
  }

  private async runShell(command: TestCommand): Promise<{ failure?: string; passed: boolean }> {
    const executable = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
    const child = spawn(executable, command.args, {
      cwd: this.repoRoot,
      env: { ...process.env, ...command.env },
      stdio: ['inherit', 'pipe', 'pipe'],
    })
    this.activeChild = child
    child.stdout?.on('data', (chunk) => this.log.stdout.write(chunk))
    child.stderr?.on('data', (chunk) => this.log.stderr.write(chunk))
    const result = await new Promise<{ code: number | null; error?: Error; signal: NodeJS.Signals | null }>(
      (resolve) => {
        let spawnError: Error | undefined
        child.once('error', (error) => {
          spawnError = error
        })
        child.once('close', (code, signal) => resolve({ code, error: spawnError, signal }))
      },
    )
    this.activeChild = undefined
    if (result.error) return { failure: result.error.message, passed: false }
    if (result.code === 0) return { passed: true }
    const detail = result.signal ? `terminated by ${result.signal}` : `exited with code ${result.code ?? 1}`
    return { failure: `${command.label} ${detail}`, passed: false }
  }

  async run(command: TestCommand, changes: readonly ChangedPath[]): Promise<TestWatchCommandResult> {
    const startedAt = Date.now()
    let outcome: { failure?: string; passed: boolean; testFiles?: number }
    const filters = extractVitestFileFilters(command)

    if (command.label === 'affected frontend tests') {
      outcome = await this.frontend.runRelated(changes)
    } else if (command.label === 'changed frontend tests') {
      outcome = await this.frontend.runDirect(filters, changes)
    } else if (command.label === 'frontend tests') {
      await this.frontend.recycle()
      outcome = await this.frontend.runAll(changes)
    } else if (command.label === 'affected server tests') {
      outcome = await this.server.runRelated(changes)
    } else if (
      command.label === 'changed server tests' &&
      !filters.some((filter) => filter.endsWith('server/fastify/__tests__/realmImport.test.ts'))
    ) {
      outcome = await this.server.runDirect(filters, changes)
    } else if (command.label === 'server tests') {
      await this.server.recycle()
      outcome = await this.server.runAll(changes)
    } else {
      if (command.label === 'full quality suite') await Promise.all([this.frontend.close(), this.server.close()])
      outcome = await this.runShell(command)
    }

    return {
      command: displayTestCommand(command),
      durationMs: Date.now() - startedAt,
      failure: outcome.failure,
      label: command.label,
      status: outcome.passed ? 'passed' : 'failed',
      testFiles: outcome.testFiles,
    }
  }
}

function shouldIgnoreWatchEvent(filename: string | null): boolean {
  if (!filename) return false
  const normalized = filename.replaceAll('\\', '/').replace(/^\.\//, '')
  if (
    normalized === '.git/HEAD' ||
    normalized === '.git/index' ||
    normalized === '.git/packed-refs' ||
    normalized.startsWith('.git/refs/')
  ) {
    return false
  }
  const firstSegment = normalized.split('/')[0]
  return IGNORED_WATCH_DIRECTORIES.has(firstSegment)
}

function statusFromPlan(
  current: TestWatchStatus,
  generation: number,
  snapshot: WorktreeSnapshot,
  affectedPlan: AffectedTestPlan,
  executionPlan: AffectedTestPlan,
  executionChangedPaths: ChangedPath[],
  executionMode: TestWatchStatus['executionMode'],
  reusedTestedFingerprint?: string,
): TestWatchStatus {
  return {
    ...current,
    affectedCommands: affectedPlan.commands.map((command) => ({
      command: displayTestCommand(command),
      label: command.label,
    })),
    changedPaths: snapshot.changes,
    commandResults: [],
    commands: executionPlan.commands.map((command) => ({ command: displayTestCommand(command), label: command.label })),
    durationMs: undefined,
    executionChangedPaths,
    executionMode,
    failure: undefined,
    generation,
    heartbeatAt: new Date().toISOString(),
    notes: affectedPlan.notes,
    reusedTestedFingerprint,
    runFinishedAt: undefined,
    runStartedAt: new Date().toISOString(),
    state: 'running',
    targetFingerprint: snapshot.fingerprint,
  }
}

async function runStatusCommand(repoRoot: string, options: TestWatchCliOptions): Promise<number> {
  const paths = testWatchPaths(repoRoot)
  let status: TestWatchStatus | undefined
  try {
    status = readTestWatchStatus(paths.status)
  } catch (error) {
    const evaluation: TestWatchStatusEvaluation = {
      exitCode: 2,
      message: error instanceof Error ? error.message : String(error),
      verdict: 'unavailable',
    }
    if (options.json) console.log(JSON.stringify({ evaluation }, null, 2))
    else console.log(`[test:watch:status] UNAVAILABLE: ${evaluation.message}`)
    return evaluation.exitCode
  }

  let snapshot: WorktreeSnapshot | undefined
  let snapshotError: string | undefined
  if (status) {
    try {
      snapshot = await createWorktreeSnapshot(repoRoot, status.base)
      const latestStatus = readTestWatchStatus(paths.status)
      if (latestStatus?.watcherId === status.watcherId) status = latestStatus
    } catch (error) {
      snapshotError = error instanceof Error ? error.message : String(error)
    }
  }
  const evaluation = snapshotError
    ? ({ exitCode: 2, message: snapshotError, verdict: 'unavailable' } satisfies TestWatchStatusEvaluation)
    : evaluateTestWatchStatus(status, snapshot?.fingerprint, {
        base: options.base,
        includeSmoke: options.includeSmoke,
        projectRoot: repoRoot,
      })

  if (options.json) {
    console.log(JSON.stringify({ evaluation, status }, null, 2))
  } else {
    console.log(`[test:watch:status] ${evaluation.verdict.toUpperCase()}: ${evaluation.message}`)
    if (status?.notes.length) for (const note of status.notes) console.log(`[test:watch:status] note: ${note}`)
    if (status?.failure) console.log(`[test:watch:status] ${status.failure}`)
    if (status) console.log(`[test:watch:status] log: ${path.join(repoRoot, status.logPath)}`)
  }
  return evaluation.exitCode
}

async function runWatcher(repoRoot: string, options: TestWatchCliOptions): Promise<number> {
  const paths = testWatchPaths(repoRoot)
  mkdirSync(paths.directory, { recursive: true })
  let existing: TestWatchStatus | undefined
  try {
    existing = readTestWatchStatus(paths.status)
  } catch {
    existing = undefined
  }
  if (
    existing &&
    isProcessAlive(existing.pid) &&
    Date.now() - Date.parse(existing.heartbeatAt) <= TEST_WATCH_HEARTBEAT_STALE_MS
  ) {
    throw new Error(`test watcher ${existing.pid} is already running for this worktree`)
  }

  const watcherId = randomUUID()
  let status: TestWatchStatus = {
    affectedCommands: [],
    base: options.base,
    changedPaths: [],
    commandResults: [],
    commands: [],
    executionChangedPaths: [],
    executionMode: 'full',
    generation: 0,
    heartbeatAt: new Date().toISOString(),
    includeSmoke: options.includeSmoke,
    logPath: path.relative(repoRoot, paths.log),
    notes: [],
    pid: process.pid,
    projectRoot: repoRoot,
    schemaVersion: TEST_WATCH_SCHEMA_VERSION,
    state: 'starting',
    watcherId,
  }
  writeTestWatchStatus(paths.status, status)

  const log = new TestWatchLog(paths.log)
  const runner = new TestCommandRunner(repoRoot, log)
  let filesystemWatcher: FSWatcher | undefined
  let heartbeat: NodeJS.Timeout | undefined
  let debounceTimer: NodeJS.Timeout | undefined
  let drainPromise: Promise<void> | undefined
  let generation = 0
  let lastCompleted: TestWatchStatus | undefined
  let lastPassingPlan: AffectedTestPlan | undefined
  let lastPassingSnapshot: WorktreeSnapshot | undefined
  let waitingForHeadCommit: string | undefined
  let nextRunAt = 0
  let rerunRequested = false
  let shutdownRequested = false
  let shutdownSignal: NodeJS.Signals | undefined
  let watcherFailure: string | undefined
  let resolveShutdown!: () => void
  const shutdownRequestedPromise = new Promise<void>((resolve) => {
    resolveShutdown = resolve
  })

  const persist = (next: TestWatchStatus): void => {
    status = { ...next, heartbeatAt: new Date().toISOString() }
    writeTestWatchStatus(paths.status, status)
  }

  const requestShutdown = (signal?: NodeJS.Signals, failure?: string): void => {
    if (shutdownRequested) return
    shutdownRequested = true
    shutdownSignal = signal
    watcherFailure = failure
    filesystemWatcher?.close()
    if (debounceTimer) clearTimeout(debounceTimer)
    resolveShutdown()
  }

  const runGeneration = async (): Promise<'completed' | 'waiting-for-commit'> => {
    let snapshot: WorktreeSnapshot
    try {
      snapshot = await createWorktreeSnapshot(repoRoot, options.base)
    } catch (error) {
      persist({
        ...status,
        failure: error instanceof Error ? error.message : String(error),
        state: 'error',
      })
      return 'completed'
    }

    if (waitingForHeadCommit === snapshot.headCommit) {
      persist({
        ...status,
        changedPaths: snapshot.changes,
        state: 'waiting-for-commit',
        targetFingerprint: snapshot.fingerprint,
      })
      return 'waiting-for-commit'
    }
    waitingForHeadCommit = undefined

    if (lastCompleted?.testedFingerprint === snapshot.fingerprint) {
      persist({ ...lastCompleted, heartbeatAt: new Date().toISOString() })
      return 'completed'
    }

    generation += 1
    const affectedPlan = planAffectedTests(snapshot.changes, {
      bail: true,
      base: options.base,
      includeSmoke: options.includeSmoke,
    })
    let executionChangedPaths = snapshot.changes
    let executionMode: TestWatchStatus['executionMode'] = 'full'
    let executionPlan = affectedPlan
    let reusedTestedFingerprint: string | undefined
    if (
      lastCompleted?.state === 'passed' &&
      lastCompleted.testedFingerprint &&
      lastPassingPlan &&
      lastPassingSnapshot
    ) {
      const delta = diffWorktreeSnapshots(lastPassingSnapshot, snapshot)
      if (canRunIncrementally(lastPassingSnapshot, snapshot, lastPassingPlan, affectedPlan, delta)) {
        executionChangedPaths = delta.changes
        executionMode = 'incremental'
        executionPlan = planAffectedTests(delta.changes, {
          bail: true,
          base: options.base,
          includeSmoke: options.includeSmoke,
        })
        reusedTestedFingerprint = lastCompleted.testedFingerprint
      }
    }
    status = statusFromPlan(
      status,
      generation,
      snapshot,
      affectedPlan,
      executionPlan,
      executionChangedPaths,
      executionMode,
      reusedTestedFingerprint,
    )
    if (executionMode === 'incremental') {
      status.notes = [
        ...status.notes,
        `Reused passing coverage for ${reusedTestedFingerprint!.slice(0, 12)} and executed ${executionChangedPaths.length} changed path(s).`,
      ]
    }
    persist(status)
    const startedAt = Date.now()
    log.reset(
      `[test:watch] generation ${generation} for ${snapshot.fingerprint.slice(0, 12)} (${snapshot.changes.length} affected path(s), ${executionMode}, ${executionChangedPaths.length} executed path(s))`,
    )
    for (const note of status.notes) log.stdout.write(`[test:watch] ${note}\n`)

    if (affectedPlan.notes.includes(FULL_QUALITY_CHANGE_NOTE)) {
      waitingForHeadCommit = snapshot.headCommit
      status = {
        ...status,
        runStartedAt: undefined,
        state: 'waiting-for-commit',
      }
      persist(status)
      log.stdout.write('[test:watch] waiting for HEAD to advance; pnpm test:all was not started\n')
      return 'waiting-for-commit'
    }

    const commandResults: TestWatchCommandResult[] = []
    let passed = true
    let failure: string | undefined
    try {
      for (const command of executionPlan.commands) {
        log.stdout.write(`[test:watch] ${command.label}: ${displayTestCommand(command)}\n`)
        const result = await runner.run(command, executionChangedPaths)
        commandResults.push(result)
        if (result.status === 'failed') {
          passed = false
          failure = result.failure || `${result.label} failed`
          break
        }
      }
    } catch (error) {
      passed = false
      failure = error instanceof Error ? error.stack || error.message : String(error)
    }

    let finalSnapshot: WorktreeSnapshot
    try {
      finalSnapshot = await createWorktreeSnapshot(repoRoot, options.base)
    } catch (error) {
      persist({
        ...status,
        commandResults,
        durationMs: Date.now() - startedAt,
        failure: error instanceof Error ? error.message : String(error),
        state: 'stale',
      })
      rerunRequested = true
      nextRunAt = Date.now() + options.debounceMs
      return 'completed'
    }

    if (finalSnapshot.fingerprint !== snapshot.fingerprint) {
      persist({
        ...status,
        commandResults,
        durationMs: Date.now() - startedAt,
        failure: undefined,
        state: 'stale',
      })
      rerunRequested = true
      nextRunAt = Date.now() + options.debounceMs
      return 'completed'
    }

    const completed: TestWatchStatus = {
      ...status,
      commandResults,
      durationMs: Date.now() - startedAt,
      failure,
      heartbeatAt: new Date().toISOString(),
      runFinishedAt: new Date().toISOString(),
      state: passed ? 'passed' : 'failed',
      testedFingerprint: snapshot.fingerprint,
    }
    lastCompleted = completed
    if (passed) {
      lastPassingPlan = affectedPlan
      lastPassingSnapshot = snapshot
    }
    persist(completed)
    log.stdout.write(`[test:watch] generation ${generation} ${passed ? 'passed' : 'failed'}\n`)
    return 'completed'
  }

  const drain = async (): Promise<void> => {
    while (rerunRequested && !shutdownRequested) {
      const waitMs = Math.max(0, nextRunAt - Date.now())
      if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs))
      if (Date.now() < nextRunAt) continue
      rerunRequested = false
      const result = await runGeneration()
      if (options.once && result === 'completed') {
        requestShutdown()
        return
      }
    }
  }

  const scheduleRun = (delayMs: number): void => {
    if (shutdownRequested) return
    rerunRequested = true
    nextRunAt = Date.now() + delayMs
    if (status.state !== 'starting' && status.state !== 'stale' && status.state !== 'waiting-for-commit') {
      persist({ ...status, state: 'stale' })
    }
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined
      if (!drainPromise) {
        drainPromise = drain().finally(() => {
          drainPromise = undefined
          if (rerunRequested && !shutdownRequested) scheduleRun(Math.max(0, nextRunAt - Date.now()))
        })
      }
    }, delayMs)
  }

  filesystemWatcher = watch(repoRoot, { encoding: 'utf8', recursive: true }, (_eventType, filename) => {
    if (shouldIgnoreWatchEvent(filename)) return
    scheduleRun(options.debounceMs)
  })
  filesystemWatcher.on('error', (error) => requestShutdown(undefined, error.message))
  heartbeat = setInterval(() => persist(status), TEST_WATCH_HEARTBEAT_MS)

  const onSigint = (): void => requestShutdown('SIGINT')
  const onSigterm = (): void => requestShutdown('SIGTERM')
  process.once('SIGINT', onSigint)
  process.once('SIGTERM', onSigterm)
  console.log(
    `[test:watch] watching ${repoRoot} (base ${options.base}, debounce ${options.debounceMs}ms${options.includeSmoke ? ', smoke enabled' : ''})`,
  )
  if (!options.once) {
    log.stdout.write('[test:watch] warming frontend and server Vitest contexts\n')
    void runner.warm().then((warmed) => {
      if (warmed && !shutdownRequested) log.stdout.write('[test:watch] frontend and server Vitest contexts are warm\n')
    })
  }
  scheduleRun(0)

  await shutdownRequestedPromise
  if (debounceTimer) clearTimeout(debounceTimer)
  if (heartbeat) clearInterval(heartbeat)
  await drainPromise?.catch((error) => {
    watcherFailure ||= error instanceof Error ? error.message : String(error)
  })
  await runner.close()
  process.removeListener('SIGINT', onSigint)
  process.removeListener('SIGTERM', onSigterm)
  persist({
    ...status,
    failure: watcherFailure || status.failure,
    state: watcherFailure ? 'error' : 'stopped',
  })
  if (watcherFailure) {
    console.error(`[test:watch] ${watcherFailure}`)
    return 1
  }
  console.log('[test:watch] stopped')
  if (shutdownSignal === 'SIGINT') return 130
  if (shutdownSignal === 'SIGTERM') return 143
  return 0
}

function printHelp(): void {
  console.log(`Usage: pnpm test:watch:agent [options]

Continuously validates the affected test plan with passing-baseline incremental reruns.

Options:
  --base <git-ref>       Compare branch changes with this ref (default: HEAD)
  --debounce-ms <ms>     Wait for an edit burst to settle (default: ${DEFAULT_DEBOUNCE_MS})
  --include-smoke        Include browser smoke when the affected plan requires it
  --status               Validate the latest watched result against the worktree
  --json                 Emit machine-readable output with --status
  --once                 Run one generation and stop (diagnostic use)
  -h, --help             Show this help`)
}

export async function runTestWatchCli(args = process.argv.slice(2), repoRoot = process.cwd()): Promise<number> {
  const options = parseTestWatchCli(args)
  if (options.help) {
    printHelp()
    return 0
  }
  if (options.json && !options.statusOnly) throw new Error('--json requires --status')
  if (options.statusOnly) return runStatusCommand(repoRoot, options)
  return runWatcher(repoRoot, options)
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath && existsSync(invokedPath)) {
  try {
    process.exitCode = await runTestWatchCli()
  } catch (error) {
    console.error(`[test:watch] ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
