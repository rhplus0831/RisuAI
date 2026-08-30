import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Writable } from 'node:stream'
import type { Vitest } from 'vitest/node'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  TEST_WATCH_HEARTBEAT_STALE_MS,
  TEST_WATCH_SCHEMA_VERSION,
  SvelteCheckWatchOutputParser,
  TestWatchLog,
  canRunIncrementally,
  createWorktreeSnapshot,
  diffWorktreeSnapshots,
  evaluateTestWatchStatus,
  extractVitestFileFilters,
  isFrontendCheckWatchPath,
  parseTestWatchCli,
  prepareVitestContext,
  readTestWatchSupervisorStatus,
  readTestWatchStatus,
  requiresFrontendCheckTopologyRestart,
  runTestWatchCli,
  testWatchPaths,
  writeTestWatchStatus,
  type TestWatchStatus,
  type TestWatchSupervisorStatus,
  type WorktreeSnapshot,
} from './test-watch.js'
import type { AffectedTestPlan } from './affected-tests.js'

const temporaryDirectories: string[] = []
const watcherProcesses: ChildProcess[] = []

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(path.join(tmpdir(), prefix))
  temporaryDirectories.push(directory)
  return directory
}

function git(repoRoot: string, args: string[]): void {
  execFileSync('git', args, { cwd: repoRoot, stdio: 'ignore' })
}

function initializedRepository(): string {
  const repoRoot = temporaryDirectory('risu-test-watch-')
  git(repoRoot, ['init'])
  git(repoRoot, ['config', 'user.name', 'Test User'])
  git(repoRoot, ['config', 'user.email', 'test@example.com'])
  writeFileSync(path.join(repoRoot, '.gitignore'), '/.test-watch/\n/node_modules/\n/.vite/\n')
  writeFileSync(
    path.join(repoRoot, 'package.json'),
    `${JSON.stringify(
      {
        private: true,
        scripts: {
          'check:watch': 'svelte-check --tsconfig ./tsconfig.json --watch --output machine',
          'test:compat-current': 'true',
          'test:all': 'true',
        },
      },
      null,
      2,
    )}\n`,
  )
  writeFileSync(
    path.join(repoRoot, 'tsconfig.json'),
    `${JSON.stringify({ compilerOptions: { skipLibCheck: true }, include: ['globals.d.ts', 'tracked.ts', 'src/**/*.ts'] }, null, 2)}\n`,
  )
  writeFileSync(
    path.join(repoRoot, 'globals.d.ts'),
    'declare function test(name: string, callback: () => void): void\n',
  )
  writeFileSync(path.join(repoRoot, 'tracked.ts'), 'export const value = 1\n')
  git(repoRoot, ['add', '.gitignore', 'globals.d.ts', 'package.json', 'tracked.ts', 'tsconfig.json'])
  git(repoRoot, ['commit', '-m', 'initial'])
  return repoRoot
}

async function waitForWatcherStatus(
  repoRoot: string,
  predicate: (status: TestWatchStatus) => boolean,
  timeoutMs = 15_000,
): Promise<TestWatchStatus> {
  const deadline = Date.now() + timeoutMs
  let latest: TestWatchStatus | undefined
  while (Date.now() < deadline) {
    latest = readTestWatchStatus(testWatchPaths(repoRoot).status)
    if (latest && predicate(latest)) return latest
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  const logPath = testWatchPaths(repoRoot).log
  const log = existsSync(logPath) ? readFileSync(logPath, 'utf8') : '(no watcher log)'
  throw new Error(`test watcher did not reach the expected status\n${JSON.stringify(latest, null, 2)}\n${log}`)
}

async function waitForWatcherState(
  repoRoot: string,
  expectedState: TestWatchStatus['state'],
  timeoutMs = 15_000,
): Promise<TestWatchStatus> {
  return waitForWatcherStatus(repoRoot, (watched) => watched.state === expectedState, timeoutMs)
}

async function waitForSupervisorStatus(
  repoRoot: string,
  predicate: (status: TestWatchSupervisorStatus) => boolean,
  timeoutMs = 15_000,
): Promise<TestWatchSupervisorStatus> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const supervised = readTestWatchSupervisorStatus(testWatchPaths(repoRoot).supervisor)
    if (supervised && predicate(supervised)) return supervised
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('test watcher supervisor did not reach the expected status')
}

async function waitForFile(file: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (existsSync(file)) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`file was not created: ${file}`)
}

async function stopWatcherProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  await once(child, 'exit')
}

function startWatcherProcess(repoRoot: string, env: NodeJS.ProcessEnv = process.env): ChildProcess {
  const child = spawn(
    process.execPath,
    ['--import', import.meta.resolve('tsx'), path.resolve('util/test-watch.ts'), '--debounce-ms=10'],
    {
      cwd: repoRoot,
      env: { ...env, RISU_TEST_WATCH_SHUTDOWN_GRACE_MS: env.RISU_TEST_WATCH_SHUTDOWN_GRACE_MS ?? '250' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  watcherProcesses.push(child)
  return child
}

function status(overrides: Partial<TestWatchStatus> = {}): TestWatchStatus {
  return {
    affectedCommands: [],
    base: 'HEAD',
    changedPaths: [{ path: 'tracked.ts', status: 'M' }],
    commandResults: [],
    commands: [],
    executionChangedPaths: [{ path: 'tracked.ts', status: 'M' }],
    executionMode: 'full',
    generation: 3,
    heartbeatAt: new Date(10_000).toISOString(),
    includeSmoke: false,
    logPath: '.test-watch/latest.log',
    notes: [],
    pid: 123,
    projectRoot: '/repo',
    qualityCommands: [],
    qualityRequired: false,
    rerunPending: false,
    schemaVersion: TEST_WATCH_SCHEMA_VERSION,
    state: 'passed',
    targetFingerprint: 'current',
    testedFingerprint: 'current',
    watcherId: 'watcher-id',
    ...overrides,
  }
}

function supervisorStatus(overrides: Partial<TestWatchSupervisorStatus> = {}): TestWatchSupervisorStatus {
  return {
    base: 'HEAD',
    heartbeatAt: new Date(10_000).toISOString(),
    includeSmoke: false,
    pid: 456,
    projectRoot: '/repo',
    recoveryCount: 0,
    schemaVersion: 1,
    startedAt: new Date(9_000).toISOString(),
    state: 'running',
    supervisorId: 'supervisor-id',
    workerId: 'watcher-id',
    workerPid: 123,
    ...overrides,
  }
}

function snapshot(
  fingerprint: string,
  paths: Array<{ fingerprint: string; path: string; status: 'A' | 'M' | 'D' | 'R' }>,
  overrides: Partial<Pick<WorktreeSnapshot, 'baseCommit' | 'headCommit'>> = {},
): WorktreeSnapshot {
  return {
    baseCommit: 'base',
    changes: paths.map(({ path: file, status: changeStatus }) => ({ path: file, status: changeStatus })),
    fingerprint,
    headCommit: 'head',
    pathFingerprints: new Map(paths.map(({ fingerprint: pathFingerprint, path: file }) => [file, pathFingerprint])),
    ...overrides,
  }
}

function affectedPlan(labels: string[], files: string[] = []): AffectedTestPlan {
  return {
    commands: labels.map((label) => ({
      args: ['exec', 'vitest', 'run', ...files],
      label,
    })),
    notes: [],
  }
}

afterEach(async () => {
  await Promise.all(watcherProcesses.splice(0).map((child) => stopWatcherProcess(child)))
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { force: true, recursive: true })
})

describe('test watcher CLI', () => {
  it('parses watcher and status options', () => {
    expect(parseTestWatchCli(['--base=main', '--debounce-ms', '750', '--include-smoke', '--once'])).toMatchObject({
      base: 'main',
      debounceMs: 750,
      includeSmoke: true,
      once: true,
      statusOnly: false,
    })
    expect(parseTestWatchCli(['--status', '--json'])).toMatchObject({ json: true, statusOnly: true })
    expect(parseTestWatchCli(['--await', '--timeout-ms=2500', '--json'])).toMatchObject({
      awaitResult: true,
      json: true,
      waitTimeoutMs: 2500,
    })
  })

  it('rejects invalid debounce values and unknown options', () => {
    expect(() => parseTestWatchCli(['--debounce-ms=0'])).toThrow('--debounce-ms requires a positive integer')
    expect(() => parseTestWatchCli(['--unknown'])).toThrow('unknown option: --unknown')
  })

  it('extracts only positional Vitest filters', () => {
    expect(
      extractVitestFileFilters({
        args: [
          'exec',
          'vitest',
          'run',
          '--config',
          'server/fastify/vitest.config.ts',
          'server/fastify/__tests__/app.test.ts',
          '--bail=1',
        ],
        label: 'changed server tests',
      }),
    ).toEqual(['server/fastify/__tests__/app.test.ts'])
  })
})

describe('warm Svelte checker', () => {
  it('parses chunked machine output and keeps overlapping cycles tied to their start version', () => {
    const parser = new SvelteCheckWatchOutputParser()

    expect(parser.push('100 START "/repo"\n101 ERR', 1)).toEqual([])
    expect(parser.push('OR "src/App.svelte" 1:1 "bad"\n102 START "/repo"\n', 2)).toEqual([])
    expect(parser.push('103 COMPLETED 10 FILES 1 ERRORS 0 WARNINGS 1 FILES_WITH_PROBLEMS\n', 2)).toEqual([
      expect.objectContaining({ errors: 1, passed: false, sequence: 1, version: 1 }),
    ])
    expect(parser.push('104 COMPLETED 10 FILES 0 ERRORS 2 WARNINGS 2 FILES_WITH_PROBLEMS\n', 2)).toEqual([
      expect.objectContaining({ errors: 0, passed: true, sequence: 2, version: 2, warnings: 2 }),
    ])
  })

  it('invalidates only paths covered by the frontend Svelte project', () => {
    expect(isFrontendCheckWatchPath('src/App.svelte')).toBe(true)
    expect(isFrontendCheckWatchPath('packages/protocol/src/index.ts')).toBe(true)
    expect(isFrontendCheckWatchPath('public/service-worker.js')).toBe(true)
    expect(isFrontendCheckWatchPath('version.json')).toBe(true)
    expect(isFrontendCheckWatchPath('src/etc/o200k_base.json')).toBe(true)
    expect(isFrontendCheckWatchPath('package.json')).toBe(true)
    expect(isFrontendCheckWatchPath('src/ts/web/legacy.ts')).toBe(false)
    expect(isFrontendCheckWatchPath('server/fastify/src/app.ts')).toBe(false)
    expect(isFrontendCheckWatchPath('docs/README.md')).toBe(false)
  })

  it('restarts diagnostics when changed paths alter source topology', () => {
    expect(requiresFrontendCheckTopologyRestart([{ path: 'src/new.test.ts', status: 'A' }])).toBe(true)
    expect(
      requiresFrontendCheckTopologyRestart([
        { path: 'server/fastify/src/new-handler.ts', status: 'A' },
        { path: 'server/fastify/src/app.ts', status: 'M' },
      ]),
    ).toBe(true)
    expect(requiresFrontendCheckTopologyRestart([{ path: 'src/removed.ts', status: 'D' }])).toBe(true)
    expect(requiresFrontendCheckTopologyRestart([{ path: 'src/existing.ts', status: 'M' }])).toBe(false)
    expect(
      requiresFrontendCheckTopologyRestart([{ path: 'server/fastify/__tests__/new-handler.test.ts', status: 'A' }]),
    ).toBe(false)
  })
})

describe('test watcher logging', () => {
  it('keeps terminal forwarding outside later Vitest stream interception', () => {
    const directory = temporaryDirectory('risu-test-watch-log-')
    const logPath = path.join(directory, 'latest.log')
    const terminalOutput: string[] = []
    const terminal = new Writable({
      write(chunk, _encoding, callback) {
        terminalOutput.push(String(chunk))
        callback()
      },
    })
    const log = new TestWatchLog(logPath, terminal as NodeJS.WriteStream, terminal as NodeJS.WriteStream)
    const interceptedWrite = vi.fn(() => true)
    terminal.write = interceptedWrite as typeof terminal.write

    log.stdout.write('lane output\n')
    log.reset('next generation')

    expect(interceptedWrite).not.toHaveBeenCalled()
    expect(terminalOutput).toEqual(['lane output\n', 'next generation\n'])
    expect(readFileSync(logPath, 'utf8')).toBe('next generation\n')
  })
})

describe('worktree fingerprinting', () => {
  it('changes with tracked and untracked contents while preserving the affected path list', async () => {
    const repoRoot = initializedRepository()
    const clean = await createWorktreeSnapshot(repoRoot, 'HEAD')
    expect(clean.changes).toEqual([])

    writeFileSync(path.join(repoRoot, 'tracked.ts'), 'export const value = 2\n')
    const firstEdit = await createWorktreeSnapshot(repoRoot, 'HEAD')
    expect(firstEdit.changes).toEqual([{ path: 'tracked.ts', status: 'M' }])
    expect(firstEdit.fingerprint).not.toBe(clean.fingerprint)

    writeFileSync(path.join(repoRoot, 'tracked.ts'), 'export const value = 3\n')
    const secondEdit = await createWorktreeSnapshot(repoRoot, 'HEAD')
    expect(secondEdit.changes).toEqual(firstEdit.changes)
    expect(secondEdit.fingerprint).not.toBe(firstEdit.fingerprint)

    writeFileSync(path.join(repoRoot, 'untracked.ts'), 'export const added = true\n')
    const withUntracked = await createWorktreeSnapshot(repoRoot, 'HEAD')
    expect(withUntracked.changes).toContainEqual({ path: 'untracked.ts', status: 'A' })
    expect(withUntracked.fingerprint).not.toBe(secondEdit.fingerprint)
  })
})

describe('incremental watcher planning', () => {
  it('derives only paths whose status or contents changed since the passing snapshot', () => {
    const previous = snapshot('previous', [
      { fingerprint: 'one', path: 'src/one.ts', status: 'M' },
      { fingerprint: 'two', path: 'src/two.ts', status: 'M' },
    ])
    const current = snapshot('current', [
      { fingerprint: 'one-next', path: 'src/one.ts', status: 'M' },
      { fingerprint: 'two', path: 'src/two.ts', status: 'M' },
      { fingerprint: 'test', path: 'src/one.test.ts', status: 'A' },
    ])

    expect(diffWorktreeSnapshots(previous, current)).toEqual({
      changes: [
        { path: 'src/one.ts', status: 'M' },
        { path: 'src/one.test.ts', status: 'A' },
      ],
      removedPaths: [],
    })
  })

  it('accepts added tests and changed direct-test filters without accepting source additions', () => {
    const previous = snapshot('previous', [{ fingerprint: 'one', path: 'src/one.test.ts', status: 'M' }])
    const addedTest = snapshot('added-test', [
      { fingerprint: 'one', path: 'src/one.test.ts', status: 'M' },
      { fingerprint: 'two', path: 'src/two.test.ts', status: 'A' },
    ])
    const previousPlan = affectedPlan(['changed frontend tests'], ['src/one.test.ts'])
    const addedTestPlan = affectedPlan(['changed frontend tests'], ['src/one.test.ts', 'src/two.test.ts'])
    const testDelta = diffWorktreeSnapshots(previous, addedTest)

    expect(canRunIncrementally(previous, addedTest, previousPlan, addedTestPlan, testDelta)).toBe(true)

    const addedSource = snapshot('added-source', [
      { fingerprint: 'one', path: 'src/one.test.ts', status: 'M' },
      { fingerprint: 'source', path: 'src/new-source.ts', status: 'A' },
    ])
    expect(
      canRunIncrementally(
        previous,
        addedSource,
        affectedPlan(['affected frontend tests']),
        affectedPlan(['affected frontend tests']),
        diffWorktreeSnapshots(previous, addedSource),
      ),
    ).toBe(false)

    const sourceBaseline = snapshot('source-baseline', [
      { fingerprint: 'one', path: 'src/one.test.ts', status: 'M' },
      { fingerprint: 'source-one', path: 'src/new-source.ts', status: 'A' },
    ])
    const changedUntrackedSource = snapshot('source-next', [
      { fingerprint: 'one', path: 'src/one.test.ts', status: 'M' },
      { fingerprint: 'source-two', path: 'src/new-source.ts', status: 'A' },
    ])
    const sourcePlan = affectedPlan(['affected frontend tests'])
    expect(
      canRunIncrementally(
        sourceBaseline,
        changedUntrackedSource,
        sourcePlan,
        sourcePlan,
        diffWorktreeSnapshots(sourceBaseline, changedUntrackedSource),
      ),
    ).toBe(true)
  })

  it('rejects removed paths, HEAD movement, and affected-lane shape changes', () => {
    const previous = snapshot('previous', [{ fingerprint: 'one', path: 'src/one.ts', status: 'M' }])
    const removed = snapshot('removed', [])
    const changedHead = snapshot('changed-head', [{ fingerprint: 'two', path: 'src/one.ts', status: 'M' }], {
      headCommit: 'next-head',
    })
    const plan = affectedPlan(['affected frontend tests'])

    expect(
      canRunIncrementally(previous, removed, plan, affectedPlan([]), diffWorktreeSnapshots(previous, removed)),
    ).toBe(false)
    expect(canRunIncrementally(previous, changedHead, plan, plan, diffWorktreeSnapshots(previous, changedHead))).toBe(
      false,
    )
    expect(
      canRunIncrementally(
        previous,
        snapshot('server', [{ fingerprint: 'two', path: 'src/one.ts', status: 'M' }]),
        plan,
        affectedPlan(['affected frontend tests', 'affected server tests']),
        { changes: [{ path: 'src/one.ts', status: 'M' }], removedPaths: [] },
      ),
    ).toBe(false)
  })

  it('preserves discovery caches while registering and invalidating changed tests by module', () => {
    const matchesTestGlob = vi.fn((file: string) => file.endsWith('.test.ts'))
    const clearSpecificationsCache = vi.fn()
    const invalidateFile = vi.fn()
    const invalidates = new Set<string>()
    const context = {
      clearSpecificationsCache,
      invalidateFile,
      projects: [{ matchesTestGlob }],
      watcher: { invalidates },
    } as unknown as Vitest

    prepareVitestContext(context, '/repo', [
      { path: 'src/feature.ts', status: 'M' },
      { path: 'src/feature.test.ts', status: 'A' },
    ])

    expect(clearSpecificationsCache).toHaveBeenCalledTimes(1)
    expect(clearSpecificationsCache).toHaveBeenCalledWith('/repo/src/feature.test.ts')
    expect(invalidateFile.mock.calls).toEqual([['/repo/src/feature.ts'], ['/repo/src/feature.test.ts']])
    expect(invalidates).toEqual(new Set(['/repo/src/feature.ts', '/repo/src/feature.test.ts']))
    expect(clearSpecificationsCache).not.toHaveBeenCalledWith()
  })
})

describe('watched result validation', () => {
  it('accepts only a live, fresh pass for the same fingerprint', () => {
    expect(
      evaluateTestWatchStatus(status(), 'current', {
        nowMs: 10_000 + TEST_WATCH_HEARTBEAT_STALE_MS - 1,
        processAlive: true,
      }),
    ).toMatchObject({ exitCode: 0, verdict: 'passed' })

    expect(evaluateTestWatchStatus(status(), 'different', { nowMs: 10_001, processAlive: true })).toMatchObject({
      exitCode: 2,
      verdict: 'stale',
    })
    expect(
      evaluateTestWatchStatus(status(), 'current', {
        nowMs: 10_000 + TEST_WATCH_HEARTBEAT_STALE_MS + 1,
        processAlive: true,
      }),
    ).toMatchObject({ exitCode: 3, verdict: 'unavailable' })
    expect(evaluateTestWatchStatus(status(), 'current', { nowMs: 10_001, processAlive: false })).toMatchObject({
      exitCode: 3,
      verdict: 'unavailable',
    })
  })

  it('distinguishes a current run and a current failure', () => {
    expect(
      evaluateTestWatchStatus(status({ state: 'running', testedFingerprint: 'previous' }), 'current', {
        nowMs: 10_001,
        processAlive: true,
      }),
    ).toMatchObject({ exitCode: 2, verdict: 'pending' })
    expect(
      evaluateTestWatchStatus(status({ state: 'failed' }), 'current', { nowMs: 10_001, processAlive: true }),
    ).toMatchObject({ exitCode: 1, verdict: 'failed' })
  })

  it('keeps supervised active, superseded, and recovering work pending', () => {
    const running = status({
      rerunPending: true,
      state: 'running',
      supervisorId: 'supervisor-id',
      targetFingerprint: 'previous',
    })
    expect(
      evaluateTestWatchStatus(running, 'current', {
        nowMs: 10_001,
        projectRoot: '/repo',
        supervisor: supervisorStatus(),
        supervisorAlive: true,
      }),
    ).toMatchObject({
      exitCode: 2,
      message: 'generation 3 is finishing and a rerun is queued',
      verdict: 'pending',
    })
    expect(
      evaluateTestWatchStatus(undefined, 'current', {
        nowMs: 10_001,
        supervisor: supervisorStatus({ state: 'recovering', workerId: undefined, workerPid: undefined }),
        supervisorAlive: true,
      }),
    ).toMatchObject({ exitCode: 2, verdict: 'pending' })
  })

  it('reports waiting-for-commit as a current running generation', () => {
    expect(
      evaluateTestWatchStatus(status({ state: 'waiting-for-commit' }), 'current', {
        nowMs: 10_001,
        processAlive: true,
      }),
    ).toMatchObject({
      exitCode: 2,
      message: 'generation 3 is waiting for a commit',
      verdict: 'pending',
    })
  })

  it('reports current targeted feedback without treating it as the final quality gate', () => {
    expect(
      evaluateTestWatchStatus(
        status({
          feedbackFingerprint: 'current',
          qualityCommands: [{ label: 'full quality suite', args: ['test:all'] }],
          qualityRequired: true,
          state: 'waiting-for-commit',
          testedFingerprint: undefined,
        }),
        'current',
        { nowMs: 10_001, processAlive: true },
      ),
    ).toMatchObject({
      exitCode: 2,
      verdict: 'full-required',
    })
  })

  it('rejects results from a different base, worktree, or required smoke scope', () => {
    expect(
      evaluateTestWatchStatus(status(), 'current', {
        base: 'main',
        nowMs: 10_001,
        processAlive: true,
      }),
    ).toMatchObject({ exitCode: 3, verdict: 'unavailable' })
    expect(
      evaluateTestWatchStatus(status(), 'current', {
        nowMs: 10_001,
        processAlive: true,
        projectRoot: '/another-repo',
      }),
    ).toMatchObject({ exitCode: 3, verdict: 'unavailable' })
    expect(
      evaluateTestWatchStatus(status(), 'current', {
        includeSmoke: true,
        nowMs: 10_001,
        processAlive: true,
      }),
    ).toMatchObject({ exitCode: 3, verdict: 'unavailable' })
  })

  it('writes status atomically without leaving temporary files', () => {
    const directory = temporaryDirectory('risu-test-watch-status-')
    const statusPath = path.join(directory, 'status.json')
    writeTestWatchStatus(statusPath, status())

    expect(readTestWatchStatus(statusPath)).toEqual(status())
    expect(readdirSync(directory)).toEqual(['status.json'])
  })

  it('reads version-one status safely so a live older watcher still prevents a duplicate', () => {
    const directory = temporaryDirectory('risu-test-watch-legacy-status-')
    const statusPath = path.join(directory, 'status.json')
    const legacy: Record<string, unknown> = { ...status(), schemaVersion: 1 }
    delete legacy.affectedCommands
    delete legacy.executionChangedPaths
    delete legacy.executionMode
    delete legacy.qualityCommands
    delete legacy.qualityRequired
    writeFileSync(statusPath, `${JSON.stringify(legacy)}\n`)

    expect(readTestWatchStatus(statusPath)).toMatchObject({
      affectedCommands: [],
      executionChangedPaths: [{ path: 'tracked.ts', status: 'M' }],
      executionMode: 'full',
      qualityCommands: [],
      qualityRequired: false,
      schemaVersion: TEST_WATCH_SCHEMA_VERSION,
    })

    const versionTwoPath = path.join(directory, 'version-two.json')
    const versionTwo: Record<string, unknown> = { ...status(), schemaVersion: 2 }
    delete versionTwo.qualityCommands
    delete versionTwo.qualityRequired
    writeFileSync(versionTwoPath, `${JSON.stringify(versionTwo)}\n`)
    expect(readTestWatchStatus(versionTwoPath)).toMatchObject({
      qualityCommands: [],
      qualityRequired: false,
      schemaVersion: TEST_WATCH_SCHEMA_VERSION,
    })
  })

  it('creates status parents when needed', () => {
    const directory = temporaryDirectory('risu-test-watch-status-parent-')
    const statusPath = path.join(directory, 'nested', 'status.json')
    writeTestWatchStatus(statusPath, status())
    expect(readTestWatchStatus(statusPath)?.watcherId).toBe('watcher-id')
  })

  it('warms both Vitest contexts before the first edit', async () => {
    const repoRoot = initializedRepository()
    const frontendMarker = path.join(temporaryDirectory('risu-test-watch-marker-'), 'frontend')
    const serverMarker = path.join(temporaryDirectory('risu-test-watch-marker-'), 'server')
    mkdirSync(path.join(repoRoot, 'server/fastify'), { recursive: true })
    writeFileSync(
      path.join(repoRoot, 'vitest.config.ts'),
      `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(frontendMarker)}, 'ready')\nexport default { test: { passWithNoTests: true } }\n`,
    )
    writeFileSync(
      path.join(repoRoot, 'server/fastify/vitest.config.ts'),
      `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(serverMarker)}, 'ready')\nexport default { test: { passWithNoTests: true } }\n`,
    )
    git(repoRoot, ['add', 'vitest.config.ts', 'server/fastify/vitest.config.ts'])
    git(repoRoot, ['commit', '-m', 'add Vitest configs'])

    const child = startWatcherProcess(repoRoot)

    try {
      await Promise.all([waitForFile(frontendMarker), waitForFile(serverMarker)])
      expect(await waitForWatcherState(repoRoot, 'passed')).toMatchObject({
        changedPaths: [],
        commandResults: [{ label: 'frontend check', status: 'passed' }],
        generation: 1,
      })
      const supervisor = readTestWatchSupervisorStatus(testWatchPaths(repoRoot).supervisor)
      const worker = readTestWatchStatus(testWatchPaths(repoRoot).status)
      expect(supervisor).toMatchObject({
        state: 'running',
        supervisorId: worker?.supervisorId,
        workerId: worker?.watcherId,
        workerPid: expect.any(Number),
      })
      expect(supervisor?.pid).not.toBe(worker?.pid)
    } finally {
      await stopWatcherProcess(child)
      watcherProcesses.splice(watcherProcesses.indexOf(child), 1)
    }
  }, 20_000)

  it('keeps the supervisor heartbeat live while the test worker event loop is blocked', async () => {
    const repoRoot = initializedRepository()
    const blockMarker = path.join(temporaryDirectory('risu-test-watch-block-'), 'started')
    mkdirSync(path.join(repoRoot, 'server/fastify'), { recursive: true })
    writeFileSync(
      path.join(repoRoot, 'vitest.config.ts'),
      `import { writeFileSync } from 'node:fs'
writeFileSync(${JSON.stringify(blockMarker)}, 'started')
const deadline = Date.now() + 500
while (Date.now() < deadline) {}
export default { test: { passWithNoTests: true } }
`,
    )
    writeFileSync(
      path.join(repoRoot, 'server/fastify/vitest.config.ts'),
      'export default { test: { passWithNoTests: true } }\n',
    )
    git(repoRoot, ['add', 'vitest.config.ts', 'server/fastify/vitest.config.ts'])
    git(repoRoot, ['commit', '-m', 'add blocking Vitest config'])

    const child = startWatcherProcess(repoRoot, { ...process.env, RISU_TEST_WATCH_HEARTBEAT_MS: '20' })

    try {
      await waitForFile(blockMarker)
      const before = await waitForSupervisorStatus(repoRoot, (supervised) => supervised.state === 'running')
      const workerHeartbeat = readTestWatchStatus(testWatchPaths(repoRoot).status)?.heartbeatAt
      const after = await waitForSupervisorStatus(
        repoRoot,
        (supervised) => supervised.heartbeatAt !== before.heartbeatAt,
      )
      expect(Date.parse(after.heartbeatAt)).toBeGreaterThan(Date.parse(before.heartbeatAt))
      expect(readTestWatchStatus(testWatchPaths(repoRoot).status)?.heartbeatAt).toBe(workerHeartbeat)
      await waitForWatcherState(repoRoot, 'passed')
    } finally {
      await stopWatcherProcess(child)
      watcherProcesses.splice(watcherProcesses.indexOf(child), 1)
    }
  }, 20_000)

  it('restarts a crashed test worker and runs a fresh baseline', async () => {
    const repoRoot = initializedRepository()
    const crashMarker = path.join(temporaryDirectory('risu-test-watch-crash-'), 'crashed')
    mkdirSync(path.join(repoRoot, 'server/fastify'), { recursive: true })
    writeFileSync(
      path.join(repoRoot, 'vitest.config.ts'),
      `import { existsSync, writeFileSync } from 'node:fs'
if (!existsSync(${JSON.stringify(crashMarker)})) {
  writeFileSync(${JSON.stringify(crashMarker)}, 'crashed')
  process.exit(17)
}
export default { test: { passWithNoTests: true } }
`,
    )
    writeFileSync(
      path.join(repoRoot, 'server/fastify/vitest.config.ts'),
      'export default { test: { passWithNoTests: true } }\n',
    )
    git(repoRoot, ['add', 'vitest.config.ts', 'server/fastify/vitest.config.ts'])
    git(repoRoot, ['commit', '-m', 'add crash-once Vitest config'])

    const child = startWatcherProcess(repoRoot)

    try {
      await waitForFile(crashMarker)
      const recovered = await waitForSupervisorStatus(
        repoRoot,
        (supervised) => supervised.recoveryCount >= 1 && supervised.state === 'running',
      )
      const watched = await waitForWatcherStatus(
        repoRoot,
        (status) => status.watcherId === recovered.workerId && status.state === 'passed',
      )
      expect(watched).toMatchObject({ executionMode: 'full', generation: 1 })
      expect(recovered.workerId).toBe(watched.watcherId)
      expect(watched.supervisorId).toBe(recovered.supervisorId)
    } finally {
      await stopWatcherProcess(child)
      watcherProcesses.splice(watcherProcesses.indexOf(child), 1)
    }
  }, 25_000)

  it('replaces a worker whose coordinator heartbeat stalls', async () => {
    const repoRoot = initializedRepository()
    const stallMarker = path.join(temporaryDirectory('risu-test-watch-stall-'), 'stalled')
    mkdirSync(path.join(repoRoot, 'server/fastify'), { recursive: true })
    writeFileSync(
      path.join(repoRoot, 'vitest.config.ts'),
      `import { existsSync, writeFileSync } from 'node:fs'
if (!existsSync(${JSON.stringify(stallMarker)})) {
  writeFileSync(${JSON.stringify(stallMarker)}, 'stalled')
  const deadline = Date.now() + 3_000
  while (Date.now() < deadline) {}
}
export default { test: { passWithNoTests: true } }
`,
    )
    writeFileSync(
      path.join(repoRoot, 'server/fastify/vitest.config.ts'),
      'export default { test: { passWithNoTests: true } }\n',
    )
    git(repoRoot, ['add', 'vitest.config.ts', 'server/fastify/vitest.config.ts'])
    git(repoRoot, ['commit', '-m', 'add stalled-worker fixture'])

    const child = startWatcherProcess(repoRoot, {
      ...process.env,
      RISU_TEST_WATCH_HEARTBEAT_MS: '20',
      RISU_TEST_WATCH_WORKER_STALL_MS: '150',
      RISU_TEST_WATCH_WORKER_WATCHDOG_GRACE_MS: '1000',
    })
    try {
      await waitForFile(stallMarker)
      const recovered = await waitForSupervisorStatus(
        repoRoot,
        (supervised) => supervised.recoveryCount >= 1 && supervised.state === 'running',
      )
      const watched = await waitForWatcherStatus(
        repoRoot,
        (status) => status.watcherId === recovered.workerId && status.state === 'passed',
      )
      expect(recovered.workerId).toBe(watched.watcherId)
      expect(watched).toMatchObject({ executionMode: 'full', generation: 1 })
    } finally {
      await stopWatcherProcess(child)
      watcherProcesses.splice(watcherProcesses.indexOf(child), 1)
    }
  }, 25_000)

  it('allows only one supervisor to own a worktree', async () => {
    const repoRoot = initializedRepository()
    mkdirSync(path.join(repoRoot, 'server/fastify'), { recursive: true })
    writeFileSync(path.join(repoRoot, 'vitest.config.ts'), 'export default { test: { passWithNoTests: true } }\n')
    writeFileSync(
      path.join(repoRoot, 'server/fastify/vitest.config.ts'),
      'export default { test: { passWithNoTests: true } }\n',
    )
    git(repoRoot, ['add', 'vitest.config.ts', 'server/fastify/vitest.config.ts'])
    git(repoRoot, ['commit', '-m', 'add supervisor lock fixture'])

    const owner = startWatcherProcess(repoRoot)
    try {
      await waitForSupervisorStatus(repoRoot, (supervised) => supervised.state === 'running')
      const contender = startWatcherProcess(repoRoot)
      let output = ''
      contender.stdout?.on('data', (chunk) => {
        output += String(chunk)
      })
      contender.stderr?.on('data', (chunk) => {
        output += String(chunk)
      })
      const [exitCode] = (await once(contender, 'exit')) as [number | null]
      watcherProcesses.splice(watcherProcesses.indexOf(contender), 1)
      expect(exitCode).not.toBe(0)
      expect(output).toMatch(/supervisor \d+ is already running/)
    } finally {
      await stopWatcherProcess(owner)
      watcherProcesses.splice(watcherProcesses.indexOf(owner), 1)
    }
  }, 20_000)

  it('reuses a passing baseline for newly added tests and modified test cases', async () => {
    const repoRoot = initializedRepository()
    writeFileSync(
      path.join(repoRoot, 'vitest.config.ts'),
      "export default { test: { globals: true, include: ['**/*.test.ts'] } }\n",
    )
    mkdirSync(path.join(repoRoot, 'src'), { recursive: true })
    writeFileSync(path.join(repoRoot, 'src/first.test.ts'), "test('first baseline', () => {})\n")
    git(repoRoot, ['add', 'vitest.config.ts', 'src/first.test.ts'])
    git(repoRoot, ['commit', '-m', 'add test fixture'])
    writeFileSync(path.join(repoRoot, 'src/first.test.ts'), "test('first changed baseline', () => {})\n")

    const child = startWatcherProcess(repoRoot)
    let output = ''
    child.stdout?.on('data', (chunk) => {
      output += String(chunk)
    })
    child.stderr?.on('data', (chunk) => {
      output += String(chunk)
    })

    try {
      const baseline = await waitForWatcherStatus(
        repoRoot,
        (watched) => watched.generation === 1 && watched.state === 'passed',
      )
      expect(baseline).toMatchObject({ executionMode: 'full' })

      writeFileSync(path.join(repoRoot, 'src/second.test.ts'), "test('new delta', () => {})\n")
      const incremental = await waitForWatcherStatus(
        repoRoot,
        (watched) => watched.generation >= 2 && watched.state === 'passed',
      )

      expect(incremental).toMatchObject({
        affectedCommands: [
          {
            label: 'frontend check',
          },
          {
            command: expect.stringContaining('first.test.ts'),
            label: 'changed frontend tests',
          },
        ],
        commandResults: [
          { label: 'frontend check', status: 'passed' },
          { status: 'passed', testFiles: 1 },
        ],
        commands: [
          {
            label: 'frontend check',
          },
          {
            command: expect.not.stringContaining('first.test.ts'),
            label: 'changed frontend tests',
          },
        ],
        executionChangedPaths: [{ path: 'src/second.test.ts', status: 'A' }],
        executionMode: 'incremental',
        reusedTestedFingerprint: baseline.testedFingerprint,
      })
      expect(incremental.affectedCommands[1]?.command).toContain('second.test.ts')
      expect(incremental.commands[1]?.command).toContain('second.test.ts')
      expect(incremental.testedFingerprint).toBe(incremental.targetFingerprint)

      writeFileSync(
        path.join(repoRoot, 'src/second.test.ts'),
        "const invalid: string = 1\ntest('typecheck failure', () => invalid)\n",
      )
      const checkFailure = await waitForWatcherStatus(
        repoRoot,
        (watched) => watched.generation > incremental.generation && watched.state === 'failed',
      )
      expect(checkFailure).toMatchObject({
        commandResults: [{ label: 'frontend check', status: 'failed' }],
        executionChangedPaths: [{ path: 'src/second.test.ts', status: 'A' }],
        executionMode: 'incremental',
      })

      writeFileSync(path.join(repoRoot, 'src/second.test.ts'), "test('new delta', () => {})\n")
      const checkRecovered = await waitForWatcherStatus(
        repoRoot,
        (watched) => watched.generation > checkFailure.generation && watched.state === 'passed',
      )
      expect(checkRecovered).toMatchObject({
        commandResults: [
          { label: 'frontend check', status: 'passed' },
          { status: 'passed', testFiles: 2 },
        ],
        executionMode: 'full',
      })

      writeFileSync(
        path.join(repoRoot, 'src/first.test.ts'),
        "test('first changed baseline', () => {})\ntest('new failing case', () => { throw new Error('case ran') })\n",
      )
      const failedCase = await waitForWatcherStatus(
        repoRoot,
        (watched) => watched.generation > checkRecovered.generation && watched.state === 'failed',
      )
      expect(failedCase).toMatchObject({
        commandResults: [
          { label: 'frontend check', status: 'passed' },
          { status: 'failed', testFiles: 1 },
        ],
        executionChangedPaths: [{ path: 'src/first.test.ts', status: 'M' }],
        executionMode: 'incremental',
        reusedTestedFingerprint: checkRecovered.testedFingerprint,
      })

      writeFileSync(
        path.join(repoRoot, 'src/first.test.ts'),
        "test('first changed baseline', () => {})\ntest('new passing case', () => {})\n",
      )
      const recovered = await waitForWatcherStatus(
        repoRoot,
        (watched) => watched.generation > failedCase.generation && watched.state === 'passed',
      )
      expect(recovered).toMatchObject({
        commandResults: [
          { label: 'frontend check', status: 'passed' },
          { status: 'passed', testFiles: 2 },
        ],
        executionMode: 'full',
      })
      expect(recovered.reusedTestedFingerprint).toBeUndefined()
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}\n${output}`)
    } finally {
      await stopWatcherProcess(child)
      watcherProcesses.splice(watcherProcesses.indexOf(child), 1)
    }
  }, 30_000)

  it('keeps an active superseded generation pending and awaits its queued rerun', async () => {
    const repoRoot = initializedRepository()
    mkdirSync(path.join(repoRoot, 'src'), { recursive: true })
    mkdirSync(path.join(repoRoot, 'server/fastify'), { recursive: true })
    writeFileSync(
      path.join(repoRoot, 'vitest.config.ts'),
      "export default { test: { globals: true, include: ['src/**/*.test.ts'] } }\n",
    )
    writeFileSync(
      path.join(repoRoot, 'server/fastify/vitest.config.ts'),
      "export default { test: { globals: true, include: ['server/fastify/**/*.test.ts'], passWithNoTests: true } }\n",
    )
    writeFileSync(path.join(repoRoot, 'src/active.test.ts'), "test('baseline', () => {})\n")
    git(repoRoot, ['add', 'vitest.config.ts', 'server/fastify/vitest.config.ts', 'src/active.test.ts'])
    git(repoRoot, ['commit', '-m', 'add active generation fixture'])

    const child = startWatcherProcess(repoRoot)

    try {
      const baseline = await waitForWatcherState(repoRoot, 'passed')
      writeFileSync(
        path.join(repoRoot, 'src/active.test.ts'),
        "test('slow generation', async () => { await new Promise((resolve) => setTimeout(resolve, 750)) })\n",
      )
      const active = await waitForWatcherStatus(
        repoRoot,
        (watched) => watched.generation > baseline.generation && watched.state === 'running',
      )
      writeFileSync(path.join(repoRoot, 'src/active.test.ts'), "test('queued rerun', () => {})\n")
      const superseded = await waitForWatcherStatus(
        repoRoot,
        (watched) => watched.generation === active.generation && watched.state === 'running' && watched.rerunPending,
      )
      expect(
        evaluateTestWatchStatus(superseded, 'new-fingerprint', {
          nowMs: Date.now(),
          supervisor: readTestWatchSupervisorStatus(testWatchPaths(repoRoot).supervisor),
          supervisorAlive: true,
        }),
      ).toMatchObject({ exitCode: 2, verdict: 'pending' })

      expect(await runTestWatchCli(['--await', '--timeout-ms=15000'], repoRoot)).toBe(0)
      expect(await waitForWatcherStatus(repoRoot, (watched) => watched.state === 'passed')).toMatchObject({
        rerunPending: false,
        testedFingerprint: expect.any(String),
      })
    } finally {
      await stopWatcherProcess(child)
      watcherProcesses.splice(watcherProcesses.indexOf(child), 1)
    }
  }, 30_000)

  it('recreates a Vitest context after a thrown transform failure', async () => {
    const repoRoot = initializedRepository()
    const contextMarker = path.join(temporaryDirectory('risu-test-watch-context-'), 'count')
    mkdirSync(path.join(repoRoot, 'src/web'), { recursive: true })
    mkdirSync(path.join(repoRoot, 'server/fastify'), { recursive: true })
    writeFileSync(
      path.join(repoRoot, 'vitest.config.ts'),
      `import { existsSync, readFileSync, writeFileSync } from 'node:fs'
const marker = ${JSON.stringify(contextMarker)}
const count = existsSync(marker) ? Number(readFileSync(marker, 'utf8')) : 0
writeFileSync(marker, String(count + 1))
export default { test: { globals: true, include: ['src/**/*.test.ts'] } }
`,
    )
    writeFileSync(
      path.join(repoRoot, 'server/fastify/vitest.config.ts'),
      "export default { test: { globals: true, include: ['server/fastify/**/*.test.ts'], passWithNoTests: true } }\n",
    )
    writeFileSync(path.join(repoRoot, 'src/web/value.js'), 'export const value = 1\n')
    writeFileSync(
      path.join(repoRoot, 'src/context.test.ts'),
      "import { value } from './web/value.js'\ntest('uses transformed source', () => { if (value < 1) throw new Error('bad value') })\n",
    )
    git(repoRoot, [
      'add',
      'vitest.config.ts',
      'server/fastify/vitest.config.ts',
      'src/web/value.js',
      'src/context.test.ts',
    ])
    git(repoRoot, ['commit', '-m', 'add context recovery fixture'])

    const child = startWatcherProcess(repoRoot)

    try {
      const baseline = await waitForWatcherState(repoRoot, 'passed')
      expect(readFileSync(contextMarker, 'utf8')).toBe('1')
      writeFileSync(path.join(repoRoot, 'src/web/value.js'), 'export const value =\n')
      const failed = await waitForWatcherStatus(
        repoRoot,
        (watched) => watched.generation > baseline.generation && watched.state === 'failed',
      )
      expect(failed.failure).toMatch(/parse (?:source|failure)|invalid JS syntax/i)

      writeFileSync(path.join(repoRoot, 'src/web/value.js'), 'export const value = 2\n')
      const recovered = await waitForWatcherStatus(
        repoRoot,
        (watched) => watched.generation > failed.generation && watched.state === 'passed',
      )
      expect(recovered.executionMode).toBe('full')
      expect(readFileSync(testWatchPaths(repoRoot).log, 'utf8')).toMatch(
        /recycling the frontend Vitest context after a runner exception/,
      )
    } finally {
      await stopWatcherProcess(child)
      watcherProcesses.splice(watcherProcesses.indexOf(child), 1)
    }
  }, 30_000)

  it('waits for final diagnostics when a transitive server module is completed after creation', async () => {
    const repoRoot = initializedRepository()
    mkdirSync(path.join(repoRoot, 'server/fastify/src'), { recursive: true })
    mkdirSync(path.join(repoRoot, 'src'), { recursive: true })
    writeFileSync(
      path.join(repoRoot, 'vitest.config.ts'),
      "export default { test: { globals: true, include: ['src/**/*.test.ts'] } }\n",
    )
    writeFileSync(
      path.join(repoRoot, 'server/fastify/vitest.config.ts'),
      "export default { test: { globals: true, include: ['server/fastify/__tests__/**/*.test.ts'], passWithNoTests: true } }\n",
    )
    writeFileSync(
      path.join(repoRoot, 'tsconfig.json'),
      `${JSON.stringify({ compilerOptions: { skipLibCheck: true }, include: ['globals.d.ts', 'tracked.ts', 'src/**/*.ts', 'src/**/*.svelte'] }, null, 2)}\n`,
    )
    writeFileSync(path.join(repoRoot, 'src/App.svelte'), '<p>server bridge fixture</p>\n')
    writeFileSync(path.join(repoRoot, 'server/fastify/src/existing.ts'), 'export const serverValue = 1\n')
    writeFileSync(
      path.join(repoRoot, 'src/serverBridge.ts'),
      "export { serverValue } from '../server/fastify/src/existing.js'\n",
    )
    git(repoRoot, [
      'add',
      'vitest.config.ts',
      'server/fastify/vitest.config.ts',
      'tsconfig.json',
      'src/App.svelte',
      'server/fastify/src/existing.ts',
      'src/serverBridge.ts',
    ])
    git(repoRoot, ['commit', '-m', 'add transitive server fixture'])

    const child = startWatcherProcess(repoRoot)
    let output = ''
    child.stdout?.on('data', (chunk) => {
      output += String(chunk)
    })
    child.stderr?.on('data', (chunk) => {
      output += String(chunk)
    })

    try {
      const baseline = await waitForWatcherStatus(
        repoRoot,
        (watched) => watched.generation === 1 && watched.state === 'passed',
      )

      writeFileSync(path.join(repoRoot, 'server/fastify/src/new-module.ts'), '')
      writeFileSync(
        path.join(repoRoot, 'src/serverBridge.ts'),
        "export { serverValue } from '../server/fastify/src/new-module.js'\n",
      )
      const diagnosticDeadline = Date.now() + 15_000
      while (!/is not a module/.test(output) && Date.now() < diagnosticDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      expect(output).toMatch(/is not a module/)
      const transientGeneration =
        readTestWatchStatus(testWatchPaths(repoRoot).status)?.generation ?? baseline.generation

      writeFileSync(path.join(repoRoot, 'server/fastify/src/new-module.ts'), 'export const serverValue = 2\n')
      const recovered = await waitForWatcherStatus(
        repoRoot,
        (watched) => watched.generation > transientGeneration && watched.state === 'passed',
      )

      expect(recovered).toMatchObject({
        commandResults: [
          { label: 'frontend check', status: 'passed' },
          { label: 'affected frontend tests', status: 'passed' },
          { label: 'affected server tests', status: 'passed' },
          { label: 'current compatibility harness', status: 'passed' },
        ],
        executionMode: 'full',
        testedFingerprint: recovered.targetFingerprint,
      })
      expect(readFileSync(testWatchPaths(repoRoot).log, 'utf8')).not.toMatch(/is not a module/)
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}\n${output}`)
    } finally {
      await stopWatcherProcess(child)
      watcherProcesses.splice(watcherProcesses.indexOf(child), 1)
    }
  }, 45_000)

  it('runs one complete watcher generation and leaves an untrusted stopped marker', async () => {
    const repoRoot = initializedRepository()
    const exitCode = await runTestWatchCli(['--once', '--debounce-ms=10'], repoRoot)
    const watched = readTestWatchStatus(testWatchPaths(repoRoot).status)

    expect(exitCode).toBe(0)
    expect(watched).toMatchObject({
      changedPaths: [],
      commandResults: [{ label: 'frontend check', status: 'passed' }],
      generation: 1,
      state: 'stopped',
    })
    expect(watched?.testedFingerprint).toMatch(/^[a-f0-9]{64}$/)
  })

  it('runs targeted feedback before a commit and the deferred full suite after it', async () => {
    const repoRoot = initializedRepository()
    const packageJson = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as Record<string, unknown>
    writeFileSync(
      path.join(repoRoot, 'package.json'),
      `${JSON.stringify({ ...packageJson, description: 'changed' }, null, 2)}\n`,
    )

    const watcherPromise = runTestWatchCli(['--once', '--debounce-ms=10'], repoRoot)
    const waiting = await waitForWatcherState(repoRoot, 'waiting-for-commit')

    expect(waiting).toMatchObject({
      changedPaths: [{ path: 'package.json', status: 'M' }],
      commandResults: [{ label: 'frontend check', status: 'passed' }],
      commands: [{ command: 'pnpm "check:watch"', label: 'frontend check' }],
      executionMode: 'feedback',
      qualityCommands: [{ args: ['test:all'], label: 'full quality suite' }],
      qualityRequired: true,
      generation: 1,
      state: 'waiting-for-commit',
    })

    git(repoRoot, ['add', 'package.json'])
    git(repoRoot, ['commit', '-m', 'resolve configuration change'])

    expect(await watcherPromise).toBe(0)
    expect(readTestWatchStatus(testWatchPaths(repoRoot).status)).toMatchObject({
      changedPaths: [],
      commandResults: [{ label: 'full quality suite', status: 'passed' }],
      generation: 2,
      qualityRequired: false,
      state: 'stopped',
    })
  })
})
