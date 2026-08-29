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
  TestWatchLog,
  canRunIncrementally,
  createWorktreeSnapshot,
  diffWorktreeSnapshots,
  evaluateTestWatchStatus,
  extractVitestFileFilters,
  parseTestWatchCli,
  prepareVitestContext,
  readTestWatchStatus,
  runTestWatchCli,
  testWatchPaths,
  writeTestWatchStatus,
  type TestWatchStatus,
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
  writeFileSync(path.join(repoRoot, 'tracked.ts'), 'export const value = 1\n')
  git(repoRoot, ['add', '.gitignore', 'tracked.ts'])
  git(repoRoot, ['commit', '-m', 'initial'])
  return repoRoot
}

async function waitForWatcherStatus(
  repoRoot: string,
  predicate: (status: TestWatchStatus) => boolean,
  timeoutMs = 15_000,
): Promise<TestWatchStatus> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const watched = readTestWatchStatus(testWatchPaths(repoRoot).status)
    if (watched && predicate(watched)) return watched
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('test watcher did not reach the expected status')
}

async function waitForWatcherState(
  repoRoot: string,
  expectedState: TestWatchStatus['state'],
  timeoutMs = 15_000,
): Promise<TestWatchStatus> {
  return waitForWatcherStatus(repoRoot, (watched) => watched.state === expectedState, timeoutMs)
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
    schemaVersion: TEST_WATCH_SCHEMA_VERSION,
    state: 'passed',
    targetFingerprint: 'current',
    testedFingerprint: 'current',
    watcherId: 'watcher-id',
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
    ).toMatchObject({ exitCode: 2, verdict: 'unavailable' })
    expect(evaluateTestWatchStatus(status(), 'current', { nowMs: 10_001, processAlive: false })).toMatchObject({
      exitCode: 2,
      verdict: 'unavailable',
    })
  })

  it('distinguishes a current run and a current failure', () => {
    expect(
      evaluateTestWatchStatus(status({ state: 'running', testedFingerprint: 'previous' }), 'current', {
        nowMs: 10_001,
        processAlive: true,
      }),
    ).toMatchObject({ exitCode: 2, verdict: 'running' })
    expect(
      evaluateTestWatchStatus(status({ state: 'failed' }), 'current', { nowMs: 10_001, processAlive: true }),
    ).toMatchObject({ exitCode: 1, verdict: 'failed' })
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
      verdict: 'running',
    })
  })

  it('rejects results from a different base, worktree, or required smoke scope', () => {
    expect(
      evaluateTestWatchStatus(status(), 'current', {
        base: 'main',
        nowMs: 10_001,
        processAlive: true,
      }),
    ).toMatchObject({ exitCode: 2, verdict: 'unavailable' })
    expect(
      evaluateTestWatchStatus(status(), 'current', {
        nowMs: 10_001,
        processAlive: true,
        projectRoot: '/another-repo',
      }),
    ).toMatchObject({ exitCode: 2, verdict: 'unavailable' })
    expect(
      evaluateTestWatchStatus(status(), 'current', {
        includeSmoke: true,
        nowMs: 10_001,
        processAlive: true,
      }),
    ).toMatchObject({ exitCode: 2, verdict: 'unavailable' })
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
    writeFileSync(statusPath, `${JSON.stringify(legacy)}\n`)

    expect(readTestWatchStatus(statusPath)).toMatchObject({
      affectedCommands: [],
      executionChangedPaths: [{ path: 'tracked.ts', status: 'M' }],
      executionMode: 'full',
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

    const child = spawn(
      path.resolve('node_modules/.bin/tsx'),
      [path.resolve('util/test-watch.ts'), '--debounce-ms=10'],
      {
        cwd: repoRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    watcherProcesses.push(child)

    try {
      await Promise.all([waitForFile(frontendMarker), waitForFile(serverMarker)])
      expect(await waitForWatcherState(repoRoot, 'passed')).toMatchObject({
        changedPaths: [],
        commandResults: [],
        generation: 1,
      })
    } finally {
      await stopWatcherProcess(child)
      watcherProcesses.splice(watcherProcesses.indexOf(child), 1)
    }
  }, 20_000)

  it('reuses a passing baseline for newly added tests and modified test cases', async () => {
    const repoRoot = initializedRepository()
    writeFileSync(
      path.join(repoRoot, 'vitest.config.ts'),
      "export default { test: { globals: true, include: ['**/*.test.ts'] } }\n",
    )
    writeFileSync(path.join(repoRoot, 'first.test.ts'), "test('first baseline', () => {})\n")
    git(repoRoot, ['add', 'vitest.config.ts', 'first.test.ts'])
    git(repoRoot, ['commit', '-m', 'add test fixture'])
    writeFileSync(path.join(repoRoot, 'first.test.ts'), "test('first changed baseline', () => {})\n")

    const child = spawn(
      path.resolve('node_modules/.bin/tsx'),
      [path.resolve('util/test-watch.ts'), '--debounce-ms=10'],
      {
        cwd: repoRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    watcherProcesses.push(child)
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

      writeFileSync(path.join(repoRoot, 'second.test.ts'), "test('new delta', () => {})\n")
      const incremental = await waitForWatcherStatus(
        repoRoot,
        (watched) => watched.generation >= 2 && watched.state === 'passed',
      )

      expect(incremental).toMatchObject({
        affectedCommands: [
          {
            command: expect.stringContaining('first.test.ts'),
            label: 'changed frontend tests',
          },
        ],
        commandResults: [{ status: 'passed', testFiles: 1 }],
        commands: [
          {
            command: expect.not.stringContaining('first.test.ts'),
            label: 'changed frontend tests',
          },
        ],
        executionChangedPaths: [{ path: 'second.test.ts', status: 'A' }],
        executionMode: 'incremental',
        reusedTestedFingerprint: baseline.testedFingerprint,
      })
      expect(incremental.affectedCommands[0]?.command).toContain('second.test.ts')
      expect(incremental.commands[0]?.command).toContain('second.test.ts')
      expect(incremental.testedFingerprint).toBe(incremental.targetFingerprint)

      writeFileSync(
        path.join(repoRoot, 'first.test.ts'),
        "test('first changed baseline', () => {})\ntest('new failing case', () => { throw new Error('case ran') })\n",
      )
      const failedCase = await waitForWatcherStatus(
        repoRoot,
        (watched) => watched.generation > incremental.generation && watched.state === 'failed',
      )
      expect(failedCase).toMatchObject({
        commandResults: [{ status: 'failed', testFiles: 1 }],
        executionChangedPaths: [{ path: 'first.test.ts', status: 'M' }],
        executionMode: 'incremental',
        reusedTestedFingerprint: incremental.testedFingerprint,
      })

      writeFileSync(
        path.join(repoRoot, 'first.test.ts'),
        "test('first changed baseline', () => {})\ntest('new passing case', () => {})\n",
      )
      const recovered = await waitForWatcherStatus(
        repoRoot,
        (watched) => watched.generation > failedCase.generation && watched.state === 'passed',
      )
      expect(recovered).toMatchObject({
        commandResults: [{ status: 'passed', testFiles: 2 }],
        executionMode: 'full',
      })
      expect(recovered.reusedTestedFingerprint).toBeUndefined()
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}\n${output}`)
    } finally {
      await stopWatcherProcess(child)
      watcherProcesses.splice(watcherProcesses.indexOf(child), 1)
    }
  }, 20_000)

  it('runs one complete watcher generation and leaves an untrusted stopped marker', async () => {
    const repoRoot = initializedRepository()
    const exitCode = await runTestWatchCli(['--once', '--debounce-ms=10'], repoRoot)
    const watched = readTestWatchStatus(testWatchPaths(repoRoot).status)

    expect(exitCode).toBe(0)
    expect(watched).toMatchObject({
      changedPaths: [],
      commandResults: [],
      generation: 1,
      state: 'stopped',
    })
    expect(watched?.testedFingerprint).toMatch(/^[a-f0-9]{64}$/)
  })

  it('waits for configuration changes to be committed instead of running test:all', async () => {
    const repoRoot = initializedRepository()
    writeFileSync(path.join(repoRoot, 'package.json'), '{}\n')

    const watcherPromise = runTestWatchCli(['--once', '--debounce-ms=10'], repoRoot)
    const waiting = await waitForWatcherState(repoRoot, 'waiting-for-commit')

    expect(waiting).toMatchObject({
      changedPaths: [{ path: 'package.json', status: 'A' }],
      commandResults: [],
      commands: [{ command: 'pnpm "test:all"', label: 'full quality suite' }],
      generation: 1,
      state: 'waiting-for-commit',
    })

    git(repoRoot, ['add', 'package.json'])
    git(repoRoot, ['commit', '-m', 'resolve configuration change'])

    expect(await watcherPromise).toBe(0)
    expect(readTestWatchStatus(testWatchPaths(repoRoot).status)).toMatchObject({
      changedPaths: [],
      commandResults: [],
      generation: 2,
      state: 'stopped',
    })
  })
})
