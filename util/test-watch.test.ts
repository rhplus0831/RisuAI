import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  TEST_WATCH_HEARTBEAT_STALE_MS,
  TEST_WATCH_SCHEMA_VERSION,
  createWorktreeSnapshot,
  evaluateTestWatchStatus,
  extractVitestFileFilters,
  parseTestWatchCli,
  readTestWatchStatus,
  runTestWatchCli,
  testWatchPaths,
  writeTestWatchStatus,
  type TestWatchStatus,
} from './test-watch.js'

const temporaryDirectories: string[] = []

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
  writeFileSync(path.join(repoRoot, '.gitignore'), '/.test-watch/\n')
  writeFileSync(path.join(repoRoot, 'tracked.ts'), 'export const value = 1\n')
  git(repoRoot, ['add', '.gitignore', 'tracked.ts'])
  git(repoRoot, ['commit', '-m', 'initial'])
  return repoRoot
}

async function waitForWatcherState(
  repoRoot: string,
  expectedState: TestWatchStatus['state'],
  timeoutMs = 5_000,
): Promise<TestWatchStatus> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const watched = readTestWatchStatus(testWatchPaths(repoRoot).status)
    if (watched?.state === expectedState) return watched
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`test watcher did not reach ${expectedState}`)
}

function status(overrides: Partial<TestWatchStatus> = {}): TestWatchStatus {
  return {
    base: 'HEAD',
    changedPaths: [{ path: 'tracked.ts', status: 'M' }],
    commandResults: [],
    commands: [],
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

afterEach(() => {
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

  it('creates status parents when needed', () => {
    const directory = temporaryDirectory('risu-test-watch-status-parent-')
    const statusPath = path.join(directory, 'nested', 'status.json')
    writeTestWatchStatus(statusPath, status())
    expect(readTestWatchStatus(statusPath)?.watcherId).toBe('watcher-id')
  })

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
