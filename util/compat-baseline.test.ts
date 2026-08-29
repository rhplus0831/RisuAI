import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { checkCompatibilityBaseline, prepareCompatibilityBaseline, type BaselineCommandRunner } from './compat-baseline'

function run(file: string, args: string[], cwd: string): string {
  return execFileSync(file, args, { cwd, encoding: 'utf8' }).trim()
}

interface Fixture {
  root: string
  sourceRoot: string
  baselineRoot: string
  baselineCommit: string
}

function createFixture(): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'risu-compat-baseline-test-'))
  const sourceRoot = path.resolve(root, 'source')
  const baselineRoot = path.resolve(root, 'baseline')
  fs.mkdirSync(sourceRoot)
  run('git', ['init', '--initial-branch=main'], sourceRoot)
  run('git', ['config', 'user.email', 'compat-test@example.invalid'], sourceRoot)
  run('git', ['config', 'user.name', 'Compatibility Test'], sourceRoot)
  fs.writeFileSync(path.resolve(sourceRoot, '.gitignore'), 'node_modules/\n', 'utf8')
  fs.writeFileSync(path.resolve(sourceRoot, 'package.json'), '{"private":true}\n', 'utf8')
  fs.writeFileSync(path.resolve(sourceRoot, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n", 'utf8')
  run('git', ['add', '.'], sourceRoot)
  run('git', ['commit', '-m', 'baseline'], sourceRoot)
  return {
    root,
    sourceRoot,
    baselineRoot,
    baselineCommit: run('git', ['rev-parse', 'HEAD'], sourceRoot),
  }
}

function pnpmStub(calls: Array<{ file: string; args: string[]; cwd: string }>): BaselineCommandRunner {
  return (file, args, options) => {
    calls.push({ file, args, cwd: options.cwd })
    if (file === 'pnpm') {
      fs.mkdirSync(path.resolve(options.cwd, 'node_modules'), { recursive: true })
      fs.writeFileSync(path.resolve(options.cwd, 'node_modules/.modules.yaml'), 'prepared: true\n', 'utf8')
      return ''
    }
    return execFileSync(file, args, { cwd: options.cwd, encoding: 'utf8' })
  }
}

let fixture: Fixture

beforeEach(() => {
  fixture = createFixture()
})

afterEach(() => {
  fs.rmSync(fixture.root, { recursive: true, force: true })
})

describe('compatibility baseline preparation', () => {
  it('creates a detached baseline, installs immutably, and is idempotent without changing the source checkout', () => {
    fs.writeFileSync(path.resolve(fixture.sourceRoot, 'moving-checkout-note'), 'preserve me\n', 'utf8')
    const sourceHead = run('git', ['rev-parse', 'HEAD'], fixture.sourceRoot)
    const sourceStatus = run('git', ['status', '--porcelain=v1'], fixture.sourceRoot)
    const calls: Array<{ file: string; args: string[]; cwd: string }> = []
    const options = {
      baselineRoot: fixture.baselineRoot,
      sourceRoot: fixture.sourceRoot,
      baselineCommit: fixture.baselineCommit,
      runCommand: pnpmStub(calls),
    }

    expect(prepareCompatibilityBaseline(options)).toMatchObject({ created: true, dependenciesInstalled: true })
    expect(run('git', ['rev-parse', 'HEAD'], fixture.baselineRoot)).toBe(fixture.baselineCommit)
    expect(run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], fixture.baselineRoot)).toBe('HEAD')
    expect(run('git', ['status', '--porcelain=v1'], fixture.baselineRoot)).toBe('')
    expect(run('git', ['rev-parse', 'HEAD'], fixture.sourceRoot)).toBe(sourceHead)
    expect(run('git', ['status', '--porcelain=v1'], fixture.sourceRoot)).toBe(sourceStatus)
    expect(calls.filter((call) => call.file === 'pnpm')).toEqual([
      {
        file: 'pnpm',
        args: ['install', '--frozen-lockfile', '--ignore-scripts'],
        cwd: fixture.baselineRoot,
      },
    ])

    calls.length = 0
    expect(prepareCompatibilityBaseline(options)).toMatchObject({ created: false, dependenciesInstalled: false })
    expect(calls.some((call) => call.file === 'pnpm')).toBe(false)
  })

  it('keeps check mode read-only and reports a missing baseline', () => {
    expect(() =>
      checkCompatibilityBaseline({
        baselineRoot: fixture.baselineRoot,
        sourceRoot: fixture.sourceRoot,
        baselineCommit: fixture.baselineCommit,
      }),
    ).toThrow(/Pinned compatibility baseline is missing/)
    expect(fs.existsSync(fixture.baselineRoot)).toBe(false)
  })

  it('keeps check mode read-only when dependencies are missing', () => {
    run('git', ['worktree', 'add', '--detach', fixture.baselineRoot, fixture.baselineCommit], fixture.sourceRoot)

    expect(() =>
      checkCompatibilityBaseline({
        baselineRoot: fixture.baselineRoot,
        sourceRoot: fixture.sourceRoot,
        baselineCommit: fixture.baselineCommit,
      }),
    ).toThrow(/baseline dependencies are missing/)
    expect(fs.existsSync(path.resolve(fixture.baselineRoot, 'node_modules'))).toBe(false)
  })

  it('rejects an existing worktree at the wrong commit', () => {
    fs.writeFileSync(path.resolve(fixture.sourceRoot, 'next'), 'next\n', 'utf8')
    run('git', ['add', 'next'], fixture.sourceRoot)
    run('git', ['commit', '-m', 'next'], fixture.sourceRoot)
    run('git', ['worktree', 'add', '--detach', fixture.baselineRoot, 'HEAD'], fixture.sourceRoot)

    expect(() =>
      prepareCompatibilityBaseline({
        baselineRoot: fixture.baselineRoot,
        sourceRoot: fixture.sourceRoot,
        baselineCommit: fixture.baselineCommit,
      }),
    ).toThrow(/expected/)
    expect(run('git', ['rev-parse', 'HEAD'], fixture.baselineRoot)).not.toBe(fixture.baselineCommit)
  })

  it('rejects dirty and attached baselines', () => {
    run('git', ['worktree', 'add', '--detach', fixture.baselineRoot, fixture.baselineCommit], fixture.sourceRoot)
    fs.writeFileSync(path.resolve(fixture.baselineRoot, 'dirty'), 'dirty\n', 'utf8')
    expect(() =>
      prepareCompatibilityBaseline({
        baselineRoot: fixture.baselineRoot,
        sourceRoot: fixture.sourceRoot,
        baselineCommit: fixture.baselineCommit,
      }),
    ).toThrow(/baseline is dirty/)

    expect(() =>
      prepareCompatibilityBaseline({
        baselineRoot: fixture.sourceRoot,
        sourceRoot: fixture.sourceRoot,
        baselineCommit: run('git', ['rev-parse', 'HEAD'], fixture.sourceRoot),
      }),
    ).toThrow(/must be detached/)
  })

  it('rechecks cleanliness after dependency installation', () => {
    run('git', ['worktree', 'add', '--detach', fixture.baselineRoot, fixture.baselineCommit], fixture.sourceRoot)
    const dirtyInstaller: BaselineCommandRunner = (file, args, options) => {
      if (file === 'pnpm') {
        fs.mkdirSync(path.resolve(options.cwd, 'node_modules'), { recursive: true })
        fs.writeFileSync(path.resolve(options.cwd, 'node_modules/.modules.yaml'), 'prepared: true\n', 'utf8')
        fs.writeFileSync(path.resolve(options.cwd, 'pnpm-lock.yaml'), 'changed\n', 'utf8')
        return ''
      }
      return execFileSync(file, args, { cwd: options.cwd, encoding: 'utf8' })
    }

    expect(() =>
      prepareCompatibilityBaseline({
        baselineRoot: fixture.baselineRoot,
        sourceRoot: fixture.sourceRoot,
        baselineCommit: fixture.baselineCommit,
        runCommand: dirtyInstaller,
      }),
    ).toThrow(/baseline is dirty/)
  })
})
