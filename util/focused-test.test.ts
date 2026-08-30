import { describe, expect, it } from 'vitest'
import { parseFocusedTestArgument, planFocusedTest, resolveFocusedTestFile } from './focused-test.js'

describe('focused test runner', () => {
  it('requires exactly one file without runner flags or globs', () => {
    expect(parseFocusedTestArgument(['--', 'src/ts/router.test.ts'])).toBe('src/ts/router.test.ts')
    expect(() => parseFocusedTestArgument([])).toThrow('exactly one')
    expect(() => parseFocusedTestArgument(['one.test.ts', 'two.test.ts'])).toThrow('exactly one')
    expect(() => parseFocusedTestArgument(['--changed'])).toThrow('not a runner option')
    expect(() => parseFocusedTestArgument(['src/**/*.test.ts'])).toThrow('globs are not supported')
  })

  it('requires an existing repository file rather than a directory or escaping path', () => {
    expect(resolveFocusedTestFile('./util/focused-test.ts')).toBe('util/focused-test.ts')
    expect(() => resolveFocusedTestFile('src')).toThrow('not a file')
    expect(() => resolveFocusedTestFile('../Risuai/package.json')).toThrow('inside the repository')
    expect(() => resolveFocusedTestFile('util/missing-focused-test.ts')).toThrow('does not exist')
  })

  it('routes exact frontend tests through their configured project', () => {
    expect(planFocusedTest('util/focused-test.test.ts').commands).toEqual([
      {
        label: 'focused frontend-node test',
        args: ['exec', 'vitest', 'run', 'util/focused-test.test.ts', '--bail=1'],
        env: undefined,
      },
    ])
    expect(planFocusedTest('src/lib/Others/GridCatalog.svelte.test.ts').commands[0]?.label).toBe(
      'focused frontend-dom test',
    )
    expect(planFocusedTest('src/ts/pluginCommands.svelte-node.test.ts').commands[0]?.label).toBe(
      'focused frontend-svelte-node test',
    )
  })

  it('keeps a selected performance contract isolated', () => {
    expect(planFocusedTest('src/ts/__tests__/renderCostHarness.test.ts').commands).toEqual([
      {
        label: 'focused frontend-dom test',
        args: [
          'exec',
          'vitest',
          'run',
          'src/ts/__tests__/renderCostHarness.test.ts',
          '--bail=1',
          '--no-file-parallelism',
          '--maxWorkers=1',
        ],
        env: { RISU_TEST_INCLUDE_GATES: 'true' },
      },
    ])
  })

  it('routes exact server tests through the Fastify config', () => {
    expect(planFocusedTest('server/fastify/__tests__/auth.test.ts').commands).toEqual([
      {
        label: 'focused server test',
        args: [
          'exec',
          'vitest',
          'run',
          '--config',
          'server/fastify/vitest.config.ts',
          'server/fastify/__tests__/auth.test.ts',
          '--bail=1',
        ],
      },
    ])
  })

  it('uses related selection for frontend, server, and shared source files', () => {
    expect(planFocusedTest('src/ts/router.ts').commands.map((command) => command.label)).toEqual([
      'frontend tests related to source',
    ])
    expect(planFocusedTest('server/fastify/src/app.ts').commands.map((command) => command.label)).toEqual([
      'server tests related to source',
    ])
    expect(planFocusedTest('packages/protocol/src/routeOperation.ts').commands.map((command) => command.label)).toEqual(
      ['frontend tests related to source', 'server tests related to source'],
    )
  })

  it('builds once and runs only the selected browser-smoke spec', () => {
    expect(planFocusedTest('server/fastify/browser-smoke/acceptedSendProtocol.spec.ts').commands).toEqual([
      { label: 'browser-smoke build', args: ['build:smoke'] },
      {
        label: 'focused browser-smoke spec',
        args: [
          'exec',
          'playwright',
          'test',
          '-c',
          'playwright.fastify-smoke.config.ts',
          'server/fastify/browser-smoke/acceptedSendProtocol.spec.ts',
        ],
        env: { VITE_FASTIFY_BROWSER_SMOKE: 'TRUE' },
      },
    ])
  })

  it('rejects user-owned compatibility tests, runner files, and unsupported targets', () => {
    expect(() => planFocusedTest('test/compat-harness/phase9CbsBaseline.test.ts')).toThrow('user-owned')
    expect(() => planFocusedTest('vitest.config.ts')).toThrow('user/CI full suite')
    expect(() => planFocusedTest('server/fastify/browser-smoke/fixture.ts')).toThrow('owning .spec.ts')
    expect(() => planFocusedTest('docs/tests/README.md')).toThrow('unsupported')
  })
})
