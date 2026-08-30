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
export const TEST_WATCH_SUPERVISOR_SCHEMA_VERSION = 1
export const TEST_WATCH_DIRECTORY = '.test-watch'
export const TEST_WATCH_STATUS_FILE = 'status.json'
export const TEST_WATCH_LOG_FILE = 'latest.log'
export const TEST_WATCH_SUPERVISOR_FILE = 'supervisor.json'
export const TEST_WATCH_SUPERVISOR_LOCK = 'supervisor.lock'
export const TEST_WATCH_HEARTBEAT_MS = 5_000
export const TEST_WATCH_HEARTBEAT_STALE_MS = 20_000

const FRONTEND_CHECK_COMMAND: TestCommand = { label: 'frontend check', args: ['check:watch'] }

const SNAPSHOT_RETRIES = 5
const DEFAULT_DEBOUNCE_MS = 400
const DEFAULT_AWAIT_TIMEOUT_MS = 10 * 60_000
const DEFAULT_AWAIT_POLL_MS = 1_000
const SUPERVISOR_LOCK_INITIALIZATION_GRACE_MS = 1_000
const SUPERVISOR_MAX_RAPID_RESTARTS = 3
const SUPERVISOR_RESTART_STABLE_MS = 10_000
const SUPERVISOR_SHUTDOWN_GRACE_MS = 5_000
const SUPERVISOR_WORKER_WATCHDOG_GRACE_MS = 30_000
const SUPERVISOR_WORKER_STALL_MS = 5 * 60_000
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

export interface SvelteCheckWatchResult {
  durationMs: number
  errors: number
  failure?: string
  output: string
  passed: boolean
  sequence: number
  version: number
  warnings: number
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
  rerunPending: boolean
  supervisorId?: string
  watcherId: string
}

export type TestWatchSupervisorState = 'starting' | 'running' | 'recovering' | 'stopping' | 'stopped' | 'error'

export interface TestWatchSupervisorStatus {
  base: string
  failure?: string
  heartbeatAt: string
  includeSmoke: boolean
  pid: number
  projectRoot: string
  recoveryCount: number
  schemaVersion: typeof TEST_WATCH_SUPERVISOR_SCHEMA_VERSION
  startedAt: string
  state: TestWatchSupervisorState
  supervisorId: string
  workerId?: string
  workerPid?: number
}

export interface TestWatchStatusEvaluation {
  currentFingerprint?: string
  exitCode: 0 | 1 | 2 | 3
  message: string
  verdict: 'passed' | 'failed' | 'pending' | 'stale' | 'unavailable'
}

export interface TestWatchCliOptions {
  awaitResult: boolean
  base: string
  debounceMs: number
  help: boolean
  includeSmoke: boolean
  json: boolean
  once: boolean
  statusOnly: boolean
  waitTimeoutMs: number
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

export function requiresFrontendCheckTopologyRestart(changes: readonly ChangedPath[]): boolean {
  return changes.some(
    (change) =>
      change.status !== 'M' && isPotentialSourceAddition(change.path.replaceAll('\\', '/').replace(/^\.\//, '')),
  )
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

export function testWatchPaths(repoRoot: string): {
  directory: string
  lock: string
  log: string
  status: string
  supervisor: string
} {
  const directory = path.join(repoRoot, TEST_WATCH_DIRECTORY)
  return {
    directory,
    lock: path.join(directory, TEST_WATCH_SUPERVISOR_LOCK),
    log: path.join(directory, TEST_WATCH_LOG_FILE),
    status: path.join(directory, TEST_WATCH_STATUS_FILE),
    supervisor: path.join(directory, TEST_WATCH_SUPERVISOR_FILE),
  }
}

function writeJsonAtomically(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true })
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  )
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    renameSync(temporaryPath, filePath)
  } finally {
    rmSync(temporaryPath, { force: true })
  }
}

export function writeTestWatchStatus(statusPath: string, status: TestWatchStatus): void {
  writeJsonAtomically(statusPath, status)
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
      rerunPending: false,
      schemaVersion: TEST_WATCH_SCHEMA_VERSION,
    } as TestWatchStatus
  }
  return {
    ...parsed,
    rerunPending: parsed.rerunPending ?? false,
    schemaVersion: TEST_WATCH_SCHEMA_VERSION,
  } as TestWatchStatus
}

export function writeTestWatchSupervisorStatus(supervisorPath: string, status: TestWatchSupervisorStatus): void {
  writeJsonAtomically(supervisorPath, status)
}

export function readTestWatchSupervisorStatus(supervisorPath: string): TestWatchSupervisorStatus | undefined {
  if (!existsSync(supervisorPath)) return undefined
  const parsed = JSON.parse(readFileSync(supervisorPath, 'utf8')) as Partial<TestWatchSupervisorStatus>
  if (
    parsed.schemaVersion !== TEST_WATCH_SUPERVISOR_SCHEMA_VERSION ||
    typeof parsed.supervisorId !== 'string' ||
    typeof parsed.pid !== 'number'
  ) {
    throw new Error(`unsupported test watcher supervisor schema in ${supervisorPath}`)
  }
  return parsed as TestWatchSupervisorStatus
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
    heartbeatStaleMs?: number
    includeSmoke?: boolean
    nowMs?: number
    processAlive?: boolean
    projectRoot?: string
    supervisor?: TestWatchSupervisorStatus
    supervisorAlive?: boolean
  } = {},
): TestWatchStatusEvaluation {
  const nowMs = options.nowMs ?? Date.now()
  const heartbeatStaleMs = options.heartbeatStaleMs ?? TEST_WATCH_HEARTBEAT_STALE_MS
  const owner = options.supervisor ?? status
  if (!owner) {
    return { exitCode: 3, message: 'no test watcher status is available', verdict: 'unavailable' }
  }
  if (options.projectRoot && path.resolve(owner.projectRoot) !== path.resolve(options.projectRoot)) {
    return {
      currentFingerprint,
      exitCode: 3,
      message: 'the test watcher status belongs to a different worktree',
      verdict: 'unavailable',
    }
  }
  if (options.base && owner.base !== options.base) {
    return {
      currentFingerprint,
      exitCode: 3,
      message: `the test watcher uses base ${owner.base}, not ${options.base}`,
      verdict: 'unavailable',
    }
  }
  if (options.includeSmoke && !owner.includeSmoke) {
    return {
      currentFingerprint,
      exitCode: 3,
      message: 'the test watcher result does not include browser smoke',
      verdict: 'unavailable',
    }
  }

  if (options.supervisor) {
    const supervisorAlive = options.supervisorAlive ?? isProcessAlive(options.supervisor.pid)
    const supervisorHeartbeatAge = nowMs - Date.parse(options.supervisor.heartbeatAt)
    if (
      !supervisorAlive ||
      !Number.isFinite(supervisorHeartbeatAge) ||
      supervisorHeartbeatAge < -heartbeatStaleMs ||
      supervisorHeartbeatAge > heartbeatStaleMs ||
      options.supervisor.state === 'error' ||
      options.supervisor.state === 'stopped' ||
      options.supervisor.state === 'stopping'
    ) {
      return {
        currentFingerprint,
        exitCode: 3,
        message: options.supervisor.failure || 'the test watcher supervisor is unavailable',
        verdict: 'unavailable',
      }
    }
    if (options.supervisor.state === 'starting' || options.supervisor.state === 'recovering') {
      return {
        currentFingerprint,
        exitCode: 2,
        message: `the test watcher supervisor is ${options.supervisor.state}`,
        verdict: 'pending',
      }
    }
    if (
      !status ||
      status.supervisorId !== options.supervisor.supervisorId ||
      status.watcherId !== options.supervisor.workerId
    ) {
      return {
        currentFingerprint,
        exitCode: 2,
        message: 'the supervised test worker is starting',
        verdict: 'pending',
      }
    }
  } else {
    if (!status) {
      return { exitCode: 3, message: 'no test watcher status is available', verdict: 'unavailable' }
    }
    if (status.supervisorId) {
      return {
        currentFingerprint,
        exitCode: 3,
        message: 'the test watcher supervisor status is unavailable',
        verdict: 'unavailable',
      }
    }
    const processAlive = options.processAlive ?? isProcessAlive(status.pid)
    const heartbeatAge = nowMs - Date.parse(status.heartbeatAt)
    if (
      !processAlive ||
      !Number.isFinite(heartbeatAge) ||
      heartbeatAge < -heartbeatStaleMs ||
      heartbeatAge > heartbeatStaleMs
    ) {
      return {
        currentFingerprint,
        exitCode: 3,
        message: 'the test watcher is not running or its heartbeat is stale',
        verdict: 'unavailable',
      }
    }
  }

  if (!status) {
    return {
      currentFingerprint,
      exitCode: 2,
      message: 'the supervised test worker is starting',
      verdict: 'pending',
    }
  }
  if (status.state === 'starting') {
    return {
      currentFingerprint,
      exitCode: 2,
      message: 'the test worker is starting its first generation',
      verdict: 'pending',
    }
  }
  if (status.state === 'running') {
    const superseded = Boolean(
      status.rerunPending ||
      (currentFingerprint && status.targetFingerprint && status.targetFingerprint !== currentFingerprint),
    )
    return {
      currentFingerprint,
      exitCode: 2,
      message: superseded
        ? `generation ${status.generation} is finishing and a rerun is queued`
        : `generation ${status.generation} is still running`,
      verdict: 'pending',
    }
  }
  if (status.state === 'waiting-for-commit') {
    return {
      currentFingerprint,
      exitCode: 2,
      message: `generation ${status.generation} is waiting for a commit`,
      verdict: 'pending',
    }
  }
  if (status.rerunPending) {
    return {
      currentFingerprint,
      exitCode: 2,
      message: 'the watcher has queued the current worktree for testing',
      verdict: 'pending',
    }
  }
  if (!currentFingerprint || status.testedFingerprint !== currentFingerprint) {
    if (options.supervisor) {
      return {
        currentFingerprint,
        exitCode: 2,
        message: 'the live watcher has not completed the current worktree yet',
        verdict: 'pending',
      }
    }
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
  if (options.supervisor && (status.state === 'stopped' || status.state === 'error')) {
    return {
      currentFingerprint,
      exitCode: 2,
      message: 'the supervisor is replacing an unavailable test worker',
      verdict: 'pending',
    }
  }
  return {
    currentFingerprint,
    exitCode: status.state === 'stopped' || status.state === 'error' ? 3 : 2,
    message: `the latest test watcher state is ${status.state}`,
    verdict: status.state === 'stale' ? 'stale' : 'unavailable',
  }
}

function parsePositiveInteger(value: string, option: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${option} requires a positive integer`)
  return parsed
}

function configuredHeartbeatMs(): number {
  const value = process.env.RISU_TEST_WATCH_HEARTBEAT_MS?.trim()
  return value ? parsePositiveInteger(value, 'RISU_TEST_WATCH_HEARTBEAT_MS') : TEST_WATCH_HEARTBEAT_MS
}

function configuredShutdownGraceMs(): number {
  const value = process.env.RISU_TEST_WATCH_SHUTDOWN_GRACE_MS?.trim()
  return value ? parsePositiveInteger(value, 'RISU_TEST_WATCH_SHUTDOWN_GRACE_MS') : SUPERVISOR_SHUTDOWN_GRACE_MS
}

function configuredWorkerStallMs(): number {
  const value = process.env.RISU_TEST_WATCH_WORKER_STALL_MS?.trim()
  return value ? parsePositiveInteger(value, 'RISU_TEST_WATCH_WORKER_STALL_MS') : SUPERVISOR_WORKER_STALL_MS
}

function configuredWorkerWatchdogGraceMs(): number {
  const value = process.env.RISU_TEST_WATCH_WORKER_WATCHDOG_GRACE_MS?.trim()
  return value
    ? parsePositiveInteger(value, 'RISU_TEST_WATCH_WORKER_WATCHDOG_GRACE_MS')
    : SUPERVISOR_WORKER_WATCHDOG_GRACE_MS
}

export function parseTestWatchCli(args: string[]): TestWatchCliOptions {
  const options: TestWatchCliOptions = {
    awaitResult: false,
    base: process.env.RISU_TEST_BASE?.trim() || 'HEAD',
    debounceMs: DEFAULT_DEBOUNCE_MS,
    help: false,
    includeSmoke: false,
    json: false,
    once: false,
    statusOnly: false,
    waitTimeoutMs: DEFAULT_AWAIT_TIMEOUT_MS,
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
    } else if (arg === '--await') {
      options.awaitResult = true
    } else if (arg === '--once') {
      options.once = true
    } else if (arg === '--status') {
      options.statusOnly = true
    } else if (arg === '--timeout-ms') {
      const value = args[index + 1]
      if (!value) throw new Error('--timeout-ms requires a value')
      options.waitTimeoutMs = parsePositiveInteger(value, '--timeout-ms')
      index += 1
    } else if (arg.startsWith('--timeout-ms=')) {
      options.waitTimeoutMs = parsePositiveInteger(arg.slice('--timeout-ms='.length), '--timeout-ms')
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

interface PendingSvelteCheckCycle {
  lines: string[]
  startedAt: number
  version: number
}

export class SvelteCheckWatchOutputParser {
  private buffer = ''
  private readonly cycles: PendingSvelteCheckCycle[] = []
  private sequence = 0

  push(chunk: string | Buffer, version: number): SvelteCheckWatchResult[] {
    this.buffer += String(chunk)
    const results: SvelteCheckWatchResult[] = []
    while (true) {
      const newline = this.buffer.indexOf('\n')
      if (newline < 0) break
      const line = this.buffer.slice(0, newline).replace(/\r$/, '')
      this.buffer = this.buffer.slice(newline + 1)
      const result = this.pushLine(line, version)
      if (result) results.push(result)
    }
    return results
  }

  private pushLine(line: string, version: number): SvelteCheckWatchResult | undefined {
    const machineLine = /^(\d+)\s+(.+)$/.exec(line)
    if (!machineLine) return undefined
    const timestamp = Number(machineLine[1])
    const message = machineLine[2]
    if (message.startsWith('START ')) {
      this.cycles.push({ lines: [line], startedAt: timestamp, version })
      return undefined
    }
    for (const cycle of this.cycles) cycle.lines.push(line)

    const completed =
      /^COMPLETED\s+(\d+)\s+FILES\s+(\d+)\s+ERRORS\s+(\d+)\s+WARNINGS\s+(\d+)\s+FILES_WITH_PROBLEMS$/.exec(message)
    if (completed) {
      const cycle = this.cycles.shift()
      if (!cycle) return undefined
      this.sequence += 1
      const errors = Number(completed[2])
      return {
        durationMs: Math.max(0, timestamp - cycle.startedAt),
        errors,
        output: `${cycle.lines.join('\n')}\n`,
        passed: errors === 0,
        sequence: this.sequence,
        version: cycle.version,
        warnings: Number(completed[3]),
      }
    }

    const failed = /^FAILURE\s+(.+)$/.exec(message)
    if (failed) {
      const cycle = this.cycles.shift()
      if (!cycle) return undefined
      this.sequence += 1
      let detail = failed[1]
      try {
        const parsed = JSON.parse(detail)
        if (typeof parsed === 'string') detail = parsed
      } catch {
        // Keep the machine output when the checker did not emit JSON.
      }
      return {
        durationMs: Math.max(0, timestamp - cycle.startedAt),
        errors: 1,
        failure: detail,
        output: `${cycle.lines.join('\n')}\n`,
        passed: false,
        sequence: this.sequence,
        version: cycle.version,
        warnings: 0,
      }
    }
    return undefined
  }
}

export function isFrontendCheckWatchPath(filename: string | null): boolean {
  if (!filename) return true
  const normalized = filename.replaceAll('\\', '/').replace(/^\.\//, '')
  if (['.npmrc', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'].includes(normalized)) return true
  if (normalized === 'tsconfig.json' || normalized === 'tsconfig.node.json' || normalized === 'vite.config.ts') {
    return true
  }
  if (normalized === 'version.json' || (/^src\//.test(normalized) && normalized.endsWith('.json'))) return true
  if (normalized === 'public/service-worker.js') return true
  if (/^packages\/protocol\/src\/.+\.ts$/.test(normalized)) return true
  if (!/^src\//.test(normalized) || !/\.(?:svelte|d\.ts|[cm]?[jt]sx?)$/.test(normalized)) return false
  return !/^src\/(?:.*\/)?web\/.*\.ts$/.test(normalized)
}

class WarmSvelteCheckLane {
  private child?: ChildProcess
  private closed = false
  private closing = false
  private latest?: SvelteCheckWatchResult
  private lastReportedSequence = 0
  private parser = new SvelteCheckWatchOutputParser()
  private recoveryTimer?: NodeJS.Timeout
  private restartAfterClose = false
  private stderr = ''
  private version = 0
  private readonly waiters = new Set<(result: SvelteCheckWatchResult) => void>()

  constructor(
    private readonly repoRoot: string,
    private readonly log: TestWatchLog,
  ) {}

  invalidate(filename: string | null): void {
    if (!isFrontendCheckWatchPath(filename)) return
    this.version += 1
    if (!filename || requiresFrontendCheckRestart(filename)) {
      this.restart()
    }
  }

  warm(): void {
    this.start()
  }

  async close(): Promise<void> {
    this.closed = true
    this.closing = true
    this.restartAfterClose = false
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer)
    this.recoveryTimer = undefined
    if (this.waiters.size > 0) {
      this.publish(
        {
          durationMs: 0,
          errors: 1,
          failure: 'frontend check watch is stopping',
          output: '',
          passed: false,
          sequence: (this.latest?.sequence ?? 0) + 1,
          version: this.version,
          warnings: 0,
        },
        false,
      )
    }
    const child = this.child
    this.child = undefined
    if (!child || child.exitCode !== null || child.signalCode !== null) return
    await new Promise<void>((resolve) => {
      child.once('close', () => resolve())
      if (child.exitCode !== null || child.signalCode !== null) resolve()
      else child.kill('SIGTERM')
    })
  }

  async run(restartForSourceTopology = false): Promise<{ failure?: string; passed: boolean }> {
    if (restartForSourceTopology) this.restart()
    this.start()
    const cached = this.latest?.version === this.version ? this.latest : undefined
    const result = cached ?? (await new Promise<SvelteCheckWatchResult>((resolve) => this.waiters.add(resolve)))
    if (result.sequence === this.lastReportedSequence) {
      this.log.stdout.write(
        `[test:watch] frontend check reused warm diagnostic cycle ${result.sequence} (${result.errors} error(s), ${result.warnings} warning(s))\n`,
      )
    } else {
      this.lastReportedSequence = result.sequence
      if (result.output) this.log.stdout.write(result.output)
    }
    return {
      failure: result.failure ?? (result.errors > 0 ? `frontend check found ${result.errors} error(s)` : undefined),
      passed: result.passed,
    }
  }

  private start(): void {
    if (this.child || this.closed) return
    this.closing = false
    this.stderr = ''
    this.lastReportedSequence = 0
    this.parser = new SvelteCheckWatchOutputParser()
    const executable = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      `../node_modules/.bin/svelte-check${process.platform === 'win32' ? '.cmd' : ''}`,
    )
    const child = spawn(executable, ['--tsconfig', './tsconfig.json', '--watch', '--output', 'machine'], {
      cwd: this.repoRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    this.child = child
    child.stdout?.on('data', (chunk) => {
      for (const result of this.parser.push(chunk, this.version)) this.publish(result)
    })
    child.stderr?.on('data', (chunk) => {
      this.stderr += String(chunk)
    })
    let spawnFailure: string | undefined
    child.once('error', (error) => {
      spawnFailure = error.message
    })
    child.once('close', (code, signal) => {
      if (this.child === child) this.child = undefined
      if (this.restartAfterClose && !this.closed) {
        this.restartAfterClose = false
        this.closing = false
        this.start()
        return
      }
      if (this.closing) return
      const detail =
        spawnFailure ||
        this.stderr.trim() ||
        (signal ? `frontend check watch terminated by ${signal}` : `frontend check watch exited with code ${code ?? 1}`)
      this.publish(
        {
          durationMs: 0,
          errors: 1,
          failure: detail,
          output: this.stderr,
          passed: false,
          sequence: (this.latest?.sequence ?? 0) + 1,
          version: this.version,
          warnings: 0,
        },
        false,
      )
      if (!this.closed) {
        this.recoveryTimer = setTimeout(
          () => {
            this.recoveryTimer = undefined
            this.start()
          },
          Math.min(DEFAULT_DEBOUNCE_MS, 250),
        )
      }
    })
  }

  private publish(result: SvelteCheckWatchResult, cache = true): void {
    if (result.version !== this.version) return
    this.latest = cache ? result : undefined
    for (const resolve of this.waiters) resolve(result)
    this.waiters.clear()
  }

  private restart(): void {
    this.latest = undefined
    const child = this.child
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      return
    }
    this.restartAfterClose = true
    this.closing = true
    child.kill('SIGTERM')
  }
}

function requiresFrontendCheckRestart(filename: string): boolean {
  const normalized = filename.replaceAll('\\', '/').replace(/^\.\//, '')
  return (
    ['.npmrc', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'vite.config.ts'].includes(normalized) ||
    normalized.endsWith('.json')
  )
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
  private recycleBeforeNextRun = false

  constructor(
    private readonly repoRoot: string,
    private readonly config: string,
    private readonly log: TestWatchLog,
    private readonly label: string,
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
        try {
          await context.standalone()
          return context
        } catch (error) {
          await context.close().catch(() => undefined)
          throw error
        }
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
    this.recycleBeforeNextRun = false
    await this.close()
    await this.context()
  }

  private async prepare(changes: readonly ChangedPath[]): Promise<Vitest> {
    if (this.recycleBeforeNextRun) {
      this.recycleBeforeNextRun = false
      this.log.stderr.write(`[test:watch] recycling the ${this.label} Vitest context after a runner exception\n`)
      await this.close().catch((error) => {
        const detail = error instanceof Error ? error.message : String(error)
        this.log.stderr.write(`[test:watch] failed to close a poisoned Vitest context: ${detail}\n`)
      })
    }
    const context = await this.context()
    prepareVitestContext(context, this.repoRoot, changes)
    return context
  }

  private async recoverAfterThrownRun<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      this.recycleBeforeNextRun = true
      throw error
    }
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
    return this.recoverAfterThrownRun(async () => {
      const context = await this.prepare(changes)
      context.config.related = undefined
      const specifications = await context.globTestSpecifications()
      return this.runSpecifications(context, specifications, true)
    })
  }

  async runDirect(filters: readonly string[], changes: readonly ChangedPath[]): Promise<VitestCommandResult> {
    return this.recoverAfterThrownRun(async () => {
      const context = await this.prepare(changes)
      context.config.related = undefined
      const absoluteFilters = filters.map((filter) => path.resolve(this.repoRoot, filter))
      const specifications = await context.getRelevantTestSpecifications(absoluteFilters)
      return this.runSpecifications(context, specifications)
    })
  }

  async runRelated(changes: readonly ChangedPath[]): Promise<VitestCommandResult> {
    return this.recoverAfterThrownRun(async () => {
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
    })
  }
}

class TestCommandRunner {
  private activeChild?: ChildProcess
  private readonly frontend: WarmVitestLane
  private readonly server: WarmVitestLane
  private readonly svelte: WarmSvelteCheckLane

  constructor(
    private readonly repoRoot: string,
    private readonly log: TestWatchLog,
  ) {
    this.frontend = new WarmVitestLane(repoRoot, 'vitest.config.ts', log, 'frontend')
    this.server = new WarmVitestLane(repoRoot, 'server/fastify/vitest.config.ts', log, 'server')
    this.svelte = new WarmSvelteCheckLane(repoRoot, log)
  }

  async close(): Promise<void> {
    if (this.activeChild && this.activeChild.exitCode === null) this.activeChild.kill('SIGTERM')
    await Promise.all([this.frontend.close(), this.server.close(), this.svelte.close()])
  }

  invalidate(filename: string | null): void {
    this.svelte.invalidate(filename)
  }

  async warm(): Promise<boolean> {
    this.svelte.warm()
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

    if (command.label === FRONTEND_CHECK_COMMAND.label) {
      outcome = await this.svelte.run(requiresFrontendCheckTopologyRestart(changes))
    } else if (command.label === 'affected frontend tests') {
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
  const frontendCheckCommands = affectedPlan.notes.includes(FULL_QUALITY_CHANGE_NOTE) ? [] : [FRONTEND_CHECK_COMMAND]
  return {
    ...current,
    affectedCommands: [...frontendCheckCommands, ...affectedPlan.commands].map((command) => ({
      command: displayTestCommand(command),
      label: command.label,
    })),
    changedPaths: snapshot.changes,
    commandResults: [],
    commands: [...frontendCheckCommands, ...executionPlan.commands].map((command) => ({
      command: displayTestCommand(command),
      label: command.label,
    })),
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
    rerunPending: false,
    state: 'running',
    targetFingerprint: snapshot.fingerprint,
  }
}

interface TestWatchInspection {
  evaluation: TestWatchStatusEvaluation
  status?: TestWatchStatus
  supervisor?: TestWatchSupervisorStatus
}

async function inspectTestWatch(repoRoot: string, options: TestWatchCliOptions): Promise<TestWatchInspection> {
  const paths = testWatchPaths(repoRoot)
  let status: TestWatchStatus | undefined
  let supervisor: TestWatchSupervisorStatus | undefined
  try {
    status = readTestWatchStatus(paths.status)
    supervisor = readTestWatchSupervisorStatus(paths.supervisor)
  } catch (error) {
    const evaluation: TestWatchStatusEvaluation = {
      exitCode: 3,
      message: error instanceof Error ? error.message : String(error),
      verdict: 'unavailable',
    }
    return { evaluation, status, supervisor }
  }

  let snapshot: WorktreeSnapshot | undefined
  let snapshotError: string | undefined
  const snapshotBase = supervisor?.base ?? status?.base
  if (snapshotBase) {
    try {
      snapshot = await createWorktreeSnapshot(repoRoot, snapshotBase)
      const latestStatus = readTestWatchStatus(paths.status)
      const latestSupervisor = readTestWatchSupervisorStatus(paths.supervisor)
      if (
        !status ||
        latestStatus?.watcherId === status.watcherId ||
        latestStatus?.supervisorId === supervisor?.supervisorId
      ) {
        status = latestStatus
      }
      if (!supervisor || latestSupervisor?.supervisorId === supervisor.supervisorId) supervisor = latestSupervisor
    } catch (error) {
      snapshotError = error instanceof Error ? error.message : String(error)
    }
  }
  const evaluation = snapshotError
    ? ({ exitCode: 3, message: snapshotError, verdict: 'unavailable' } satisfies TestWatchStatusEvaluation)
    : evaluateTestWatchStatus(status, snapshot?.fingerprint, {
        base: options.base,
        includeSmoke: options.includeSmoke,
        projectRoot: repoRoot,
        supervisor,
      })
  return { evaluation, status, supervisor }
}

function printTestWatchInspection(prefix: 'await' | 'status', inspection: TestWatchInspection, json: boolean): void {
  const { evaluation, status, supervisor } = inspection
  if (json) {
    console.log(JSON.stringify({ evaluation, status, supervisor }, null, 2))
    return
  }
  console.log(`[test:watch:${prefix}] ${evaluation.verdict.toUpperCase()}: ${evaluation.message}`)
  if (status?.notes.length) for (const note of status.notes) console.log(`[test:watch:${prefix}] note: ${note}`)
  if (status?.failure) console.log(`[test:watch:${prefix}] ${status.failure}`)
  else if (supervisor?.failure) console.log(`[test:watch:${prefix}] ${supervisor.failure}`)
  if (status) console.log(`[test:watch:${prefix}] log: ${path.join(status.projectRoot, status.logPath)}`)
}

async function runStatusCommand(repoRoot: string, options: TestWatchCliOptions): Promise<number> {
  const inspection = await inspectTestWatch(repoRoot, options)
  printTestWatchInspection('status', inspection, options.json)
  return inspection.evaluation.exitCode
}

async function runAwaitCommand(repoRoot: string, options: TestWatchCliOptions): Promise<number> {
  const deadline = Date.now() + options.waitTimeoutMs
  let inspection = await inspectTestWatch(repoRoot, options)
  while (inspection.evaluation.exitCode === 2 && Date.now() < deadline) {
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(DEFAULT_AWAIT_POLL_MS, Math.max(1, deadline - Date.now()))),
    )
    inspection = await inspectTestWatch(repoRoot, options)
  }
  if (inspection.evaluation.exitCode === 2) {
    inspection = {
      ...inspection,
      evaluation: {
        ...inspection.evaluation,
        message: `timed out after ${options.waitTimeoutMs}ms: ${inspection.evaluation.message}`,
      },
    }
  }
  printTestWatchInspection('await', inspection, options.json)
  return inspection.evaluation.exitCode
}

interface TestWatchSupervisorLockOwner {
  pid: number
  projectRoot: string
  startedAt: string
  supervisorId: string
}

function readSupervisorLockOwner(lockPath: string): TestWatchSupervisorLockOwner | undefined {
  try {
    return JSON.parse(readFileSync(path.join(lockPath, 'owner.json'), 'utf8')) as TestWatchSupervisorLockOwner
  } catch {
    return undefined
  }
}

async function acquireSupervisorLock(lockPath: string, owner: TestWatchSupervisorLockOwner): Promise<() => void> {
  mkdirSync(path.dirname(lockPath), { recursive: true })
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      mkdirSync(lockPath)
      writeFileSync(path.join(lockPath, 'owner.json'), `${JSON.stringify(owner, null, 2)}\n`, 'utf8')
      return () => {
        const current = readSupervisorLockOwner(lockPath)
        if (current?.supervisorId !== owner.supervisorId) return
        const releasedPath = `${lockPath}.released.${owner.supervisorId}`
        try {
          renameSync(lockPath, releasedPath)
          rmSync(releasedPath, { force: true, recursive: true })
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }

    const current = readSupervisorLockOwner(lockPath)
    if (current && isProcessAlive(current.pid)) {
      throw new Error(`test watcher supervisor ${current.pid} is already running for this worktree`)
    }
    let lockAge = 0
    try {
      lockAge = Date.now() - lstatSync(lockPath).mtimeMs
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    if (!current && lockAge < SUPERVISOR_LOCK_INITIALIZATION_GRACE_MS) {
      await new Promise((resolve) => setTimeout(resolve, 25))
      continue
    }
    const stalePath = `${lockPath}.stale.${randomUUID()}`
    try {
      renameSync(lockPath, stalePath)
      rmSync(stalePath, { force: true, recursive: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  throw new Error('could not acquire the test watcher supervisor lock')
}

function watcherWorkerArgs(options: TestWatchCliOptions): string[] {
  return [
    '--base',
    options.base,
    '--debounce-ms',
    String(options.debounceMs),
    ...(options.includeSmoke ? ['--include-smoke'] : []),
  ]
}

function signalProcessTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid) return
  try {
    if (process.platform === 'win32') child.kill(signal)
    else process.kill(-child.pid, signal)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
  }
}

async function stopWorkerProcess(
  child: ChildProcess,
  closed: Promise<{ code: number | null; signal: NodeJS.Signals | null }>,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  const closedGracefully = await Promise.race([
    closed.then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), configuredShutdownGraceMs())),
  ])
  if (closedGracefully || child.exitCode !== null || child.signalCode !== null) return
  signalProcessTree(child, 'SIGKILL')
  await closed
}

async function stopOrphanedWorker(pid: number): Promise<void> {
  try {
    if (process.platform === 'win32') process.kill(pid, 'SIGTERM')
    else process.kill(-pid, 'SIGTERM')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    return
  }
  const deadline = Date.now() + 1_000
  while (isProcessAlive(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  if (!isProcessAlive(pid)) return
  try {
    if (process.platform === 'win32') process.kill(pid, 'SIGKILL')
    else process.kill(-pid, 'SIGKILL')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
  }
}

async function runSupervisor(repoRoot: string, options: TestWatchCliOptions): Promise<number> {
  const paths = testWatchPaths(repoRoot)
  mkdirSync(paths.directory, { recursive: true })
  const legacyStatus = readTestWatchStatus(paths.status)
  if (legacyStatus && !legacyStatus.supervisorId && isProcessAlive(legacyStatus.pid)) {
    throw new Error(`test watcher ${legacyStatus.pid} is already running for this worktree`)
  }

  const supervisorId = randomUUID()
  const startedAt = new Date().toISOString()
  const releaseLock = await acquireSupervisorLock(paths.lock, {
    pid: process.pid,
    projectRoot: repoRoot,
    startedAt,
    supervisorId,
  })
  if (legacyStatus?.supervisorId && isProcessAlive(legacyStatus.pid)) {
    try {
      await stopOrphanedWorker(legacyStatus.pid)
    } catch (error) {
      releaseLock()
      throw error
    }
  }
  let supervisor: TestWatchSupervisorStatus = {
    base: options.base,
    heartbeatAt: startedAt,
    includeSmoke: options.includeSmoke,
    pid: process.pid,
    projectRoot: repoRoot,
    recoveryCount: 0,
    schemaVersion: TEST_WATCH_SUPERVISOR_SCHEMA_VERSION,
    startedAt,
    state: 'starting',
    supervisorId,
  }
  const persistSupervisor = (next: TestWatchSupervisorStatus): void => {
    supervisor = { ...next, heartbeatAt: new Date().toISOString() }
    writeTestWatchSupervisorStatus(paths.supervisor, supervisor)
  }
  try {
    persistSupervisor(supervisor)
  } catch (error) {
    releaseLock()
    throw error
  }

  let shutdownRequested = false
  let shutdownSignal: NodeJS.Signals | undefined
  let supervisorFailure: string | undefined
  let resolveShutdown!: () => void
  const shutdownPromise = new Promise<void>((resolve) => {
    resolveShutdown = resolve
  })
  const requestShutdown = (signal?: NodeJS.Signals, failure?: string): void => {
    if (shutdownRequested) return
    shutdownRequested = true
    shutdownSignal = signal
    supervisorFailure = failure
    resolveShutdown()
  }
  const onSigint = (): void => requestShutdown('SIGINT')
  const onSigterm = (): void => requestShutdown('SIGTERM')
  process.once('SIGINT', onSigint)
  process.once('SIGTERM', onSigterm)
  let activeWorker: ChildProcess | undefined
  let activeWorkerFailure: string | undefined
  let activeWorkerId: string | undefined
  let activeWorkerStartedAt = 0
  const heartbeat = setInterval(() => {
    try {
      if (activeWorker && activeWorkerId && supervisor.state === 'running') {
        const workerStatus = readTestWatchStatus(paths.status)
        const workerHeartbeatAge = workerStatus ? Date.now() - Date.parse(workerStatus.heartbeatAt) : 0
        if (
          workerStatus?.supervisorId === supervisorId &&
          workerStatus.watcherId === activeWorkerId &&
          Date.now() - activeWorkerStartedAt > configuredWorkerWatchdogGraceMs() &&
          Number.isFinite(workerHeartbeatAge) &&
          workerHeartbeatAge > configuredWorkerStallMs()
        ) {
          activeWorkerFailure = `test worker made no coordinator progress for ${workerHeartbeatAge}ms`
          persistSupervisor({ ...supervisor, failure: activeWorkerFailure, state: 'recovering' })
          signalProcessTree(activeWorker, 'SIGTERM')
          return
        }
      }
      persistSupervisor(supervisor)
    } catch (error) {
      requestShutdown(undefined, error instanceof Error ? error.message : String(error))
    }
  }, configuredHeartbeatMs())

  const workerExecutable = process.execPath
  const workerLoader = import.meta.resolve('tsx')
  let rapidRestarts = 0
  try {
    while (!shutdownRequested) {
      const workerId = randomUUID()
      const workerStartedAt = Date.now()
      activeWorkerStartedAt = workerStartedAt
      activeWorkerFailure = undefined
      const child = spawn(
        workerExecutable,
        ['--import', workerLoader, fileURLToPath(import.meta.url), ...watcherWorkerArgs(options)],
        {
          cwd: repoRoot,
          detached: process.platform !== 'win32',
          env: {
            ...process.env,
            RISU_TEST_WATCH_SUPERVISOR_ID: supervisorId,
            RISU_TEST_WATCH_SUPERVISOR_PID: String(process.pid),
            RISU_TEST_WATCH_WORKER: '1',
            RISU_TEST_WATCH_WORKER_ID: workerId,
          },
          stdio: 'inherit',
        },
      )
      let spawnFailure: string | undefined
      const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
        child.once('error', (error) => {
          spawnFailure = error.message
        })
        child.once('close', (code, signal) => {
          resolve({ code, signal })
        })
      })
      activeWorker = child
      activeWorkerId = workerId
      persistSupervisor({
        ...supervisor,
        failure: undefined,
        state: 'running',
        workerId,
        workerPid: child.pid,
      })

      const outcome = await Promise.race([
        closed.then((result) => ({ kind: 'closed' as const, result })),
        shutdownPromise.then(() => ({ kind: 'shutdown' as const })),
      ])
      if (outcome.kind === 'shutdown') {
        persistSupervisor({ ...supervisor, state: 'stopping' })
        await stopWorkerProcess(child, closed)
        break
      }

      activeWorker = undefined
      activeWorkerId = undefined
      signalProcessTree(child, 'SIGTERM')

      const runtimeMs = Date.now() - workerStartedAt
      rapidRestarts = runtimeMs >= SUPERVISOR_RESTART_STABLE_MS ? 0 : rapidRestarts + 1
      supervisor.recoveryCount += 1
      const detail =
        activeWorkerFailure ||
        spawnFailure ||
        (outcome.result.signal
          ? `test worker terminated by ${outcome.result.signal}`
          : `test worker exited with code ${outcome.result.code ?? 1}`)
      if (rapidRestarts > SUPERVISOR_MAX_RAPID_RESTARTS) {
        supervisorFailure = `${detail}; automatic recovery was exhausted`
        persistSupervisor({
          ...supervisor,
          failure: supervisorFailure,
          state: 'error',
          workerId: undefined,
          workerPid: undefined,
        })
        break
      }
      const backoffMs = Math.min(2_000, 250 * 2 ** Math.max(0, rapidRestarts - 1))
      persistSupervisor({
        ...supervisor,
        failure: `${detail}; restarting in ${backoffMs}ms`,
        state: 'recovering',
        workerId: undefined,
        workerPid: undefined,
      })
      await Promise.race([new Promise((resolve) => setTimeout(resolve, backoffMs)), shutdownPromise])
    }
  } finally {
    clearInterval(heartbeat)
    process.removeListener('SIGINT', onSigint)
    process.removeListener('SIGTERM', onSigterm)
    try {
      persistSupervisor({
        ...supervisor,
        failure: supervisorFailure,
        state: supervisorFailure ? 'error' : 'stopped',
        workerId: undefined,
        workerPid: undefined,
      })
    } finally {
      releaseLock()
    }
  }

  if (supervisorFailure) {
    console.error(`[test:watch] ${supervisorFailure}`)
    return 1
  }
  console.log('[test:watch] supervisor stopped')
  if (shutdownSignal === 'SIGINT') return 130
  if (shutdownSignal === 'SIGTERM') return 143
  return 0
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
  if (existing && existing.watcherId !== process.env.RISU_TEST_WATCH_WORKER_ID && isProcessAlive(existing.pid)) {
    throw new Error(`test watcher ${existing.pid} is already running for this worktree`)
  }

  const watcherId = process.env.RISU_TEST_WATCH_WORKER_ID?.trim() || randomUUID()
  const supervisorId = process.env.RISU_TEST_WATCH_SUPERVISOR_ID?.trim() || undefined
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
    rerunPending: false,
    schemaVersion: TEST_WATCH_SCHEMA_VERSION,
    state: 'starting',
    supervisorId,
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
  let runnerClosePromise: Promise<void> | undefined
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
    runnerClosePromise ??= runner.close()
    resolveShutdown()
  }

  const runGeneration = async (): Promise<'completed' | 'waiting-for-commit'> => {
    let snapshot: WorktreeSnapshot
    try {
      snapshot = await createWorktreeSnapshot(repoRoot, options.base)
    } catch (error) {
      const failure = error instanceof Error ? error.message : String(error)
      persist({
        ...status,
        failure,
        state: 'error',
      })
      throw new Error(failure, { cause: error })
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
      for (const command of [FRONTEND_CHECK_COMMAND, ...executionPlan.commands]) {
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
        rerunPending: true,
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
        rerunPending: true,
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
      rerunPending: false,
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
    if (status.state === 'running') {
      persist({ ...status, rerunPending: true })
    } else if (status.state !== 'starting' && status.state !== 'stale' && status.state !== 'waiting-for-commit') {
      persist({ ...status, rerunPending: true, state: 'stale' })
    }
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined
      if (!drainPromise) {
        drainPromise = drain()
          .catch((error) => {
            requestShutdown(undefined, error instanceof Error ? error.stack || error.message : String(error))
          })
          .finally(() => {
            drainPromise = undefined
            if (rerunRequested && !shutdownRequested) scheduleRun(Math.max(0, nextRunAt - Date.now()))
          })
      }
    }, delayMs)
  }

  filesystemWatcher = watch(repoRoot, { encoding: 'utf8', recursive: true }, (_eventType, filename) => {
    if (shouldIgnoreWatchEvent(filename)) return
    runner.invalidate(filename)
    scheduleRun(options.debounceMs)
  })
  filesystemWatcher.on('error', (error) => requestShutdown(undefined, error.message))
  heartbeat = setInterval(() => {
    try {
      persist(status)
    } catch (error) {
      requestShutdown(undefined, error instanceof Error ? error.message : String(error))
    }
  }, configuredHeartbeatMs())

  const onSigint = (): void => requestShutdown('SIGINT')
  const onSigterm = (): void => requestShutdown('SIGTERM')
  process.once('SIGINT', onSigint)
  process.once('SIGTERM', onSigterm)
  console.log(
    `[test:watch] watching ${repoRoot} (base ${options.base}, debounce ${options.debounceMs}ms${options.includeSmoke ? ', smoke enabled' : ''})`,
  )
  if (!options.once) {
    log.stdout.write('[test:watch] warming Svelte diagnostics and frontend/server Vitest contexts\n')
    void runner
      .warm()
      .then((warmed) => {
        if (warmed && !shutdownRequested) {
          log.stdout.write('[test:watch] frontend and server Vitest contexts are warm\n')
        }
      })
      .catch((error) => {
        log.stderr.write(
          `[test:watch] background warm-up failed; initialization will retry when selected: ${error instanceof Error ? error.message : String(error)}\n`,
        )
      })
  }
  scheduleRun(0)

  await shutdownRequestedPromise
  if (debounceTimer) clearTimeout(debounceTimer)
  if (heartbeat) clearInterval(heartbeat)
  await drainPromise?.catch((error) => {
    watcherFailure ||= error instanceof Error ? error.message : String(error)
  })
  runnerClosePromise ??= runner.close()
  await runnerClosePromise.catch((error) => {
    watcherFailure ||= error instanceof Error ? error.message : String(error)
  })
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

Continuously validates warm Svelte diagnostics and the affected test plan with incremental reruns.

Options:
  --base <git-ref>       Compare branch changes with this ref (default: HEAD)
  --debounce-ms <ms>     Wait for an edit burst to settle (default: ${DEFAULT_DEBOUNCE_MS})
  --include-smoke        Include browser smoke when the affected plan requires it
  --status               Validate the latest watched result against the worktree
  --await                Wait for the exact current worktree to finish
  --timeout-ms <ms>      Bound --await (default: ${DEFAULT_AWAIT_TIMEOUT_MS})
  --json                 Emit machine-readable output with --status or --await
  --once                 Run one generation and stop (diagnostic use)
  -h, --help             Show this help`)
}

export async function runTestWatchCli(args = process.argv.slice(2), repoRoot = process.cwd()): Promise<number> {
  const options = parseTestWatchCli(args)
  if (options.help) {
    printHelp()
    return 0
  }
  if (options.statusOnly && options.awaitResult) throw new Error('--status and --await cannot be combined')
  if (options.once && (options.statusOnly || options.awaitResult)) {
    throw new Error('--once cannot be combined with --status or --await')
  }
  if (options.json && !options.statusOnly && !options.awaitResult) {
    throw new Error('--json requires --status or --await')
  }
  if (options.statusOnly) return runStatusCommand(repoRoot, options)
  if (options.awaitResult) return runAwaitCommand(repoRoot, options)
  if (options.once || process.env.RISU_TEST_WATCH_WORKER === '1') return runWatcher(repoRoot, options)
  return runSupervisor(repoRoot, options)
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath && existsSync(invokedPath)) {
  try {
    const exitCode = await runTestWatchCli()
    if (process.env.RISU_TEST_WATCH_WORKER === '1') process.exit(exitCode)
    process.exitCode = exitCode
  } catch (error) {
    console.error(`[test:watch] ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
