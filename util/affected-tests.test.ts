import { describe, expect, it } from 'vitest'
import { parseNameStatus, planAffectedTests, type ChangedPath } from './affected-tests.js'

const options = { base: 'HEAD~1', bail: true, includeSmoke: false }

function plan(changes: ChangedPath[]) {
  return planAffectedTests(changes, options)
}

describe('affected test planning', () => {
  it('parses NUL-delimited modifications, deletions, and renames', () => {
    expect(parseNameStatus('M\0src/a.ts\0D\0src/old.ts\0R100\0src/before.ts\0src/after.ts\0')).toEqual([
      { path: 'src/a.ts', status: 'M' },
      { path: 'src/old.ts', status: 'D' },
      { path: 'src/after.ts', status: 'R' },
    ])
  })

  it('runs changed test files directly without scanning unrelated tests', () => {
    const result = plan([
      { path: 'src/ts/model/modelProfileResolver.test.ts', status: 'M' },
      { path: 'server/fastify/__tests__/providerMessages.test.ts', status: 'M' },
    ])

    expect(result.commands).toEqual([
      {
        label: 'changed frontend tests',
        args: ['exec', 'vitest', 'run', 'src/ts/model/modelProfileResolver.test.ts', '--bail=1'],
      },
      {
        label: 'changed server tests',
        args: [
          'exec',
          'vitest',
          'run',
          '--config',
          'server/fastify/vitest.config.ts',
          'server/fastify/__tests__/providerMessages.test.ts',
          '--bail=1',
        ],
      },
    ])
  })

  it('runs UI audit tests in the ordinary frontend lane', () => {
    const result = plan([{ path: 'src/lib/_audit/optimisticTogglePaint.dom.test.ts', status: 'M' }])

    expect(result.commands).toEqual([
      {
        label: 'changed frontend tests',
        args: ['exec', 'vitest', 'run', 'src/lib/_audit/optimisticTogglePaint.dom.test.ts', '--bail=1'],
      },
    ])
  })

  it('uses dependency-aware selection in both lanes for shared source changes', () => {
    const result = plan([{ path: 'src/ts/model/modelProfileResolver.ts', status: 'M' }])

    expect(result.commands.map((command) => command.label)).toEqual([
      'affected frontend tests',
      'affected server tests',
    ])
    expect(result.commands.every((command) => command.args.includes('--changed'))).toBe(true)
    expect(result.commands.every((command) => command.args.includes('HEAD~1'))).toBe(true)
  })

  it('runs the complete Vitest lanes when runner configuration changes', () => {
    const result = plan([{ path: 'vitest.config.ts', status: 'M' }])

    expect(result.commands).toEqual([
      { label: 'frontend tests', args: ['test:frontend'] },
      { label: 'frontend performance gates', args: ['test:gates:perf'] },
      { label: 'server tests', args: ['test:server'] },
    ])
  })

  it('escalates dependency and CI changes to the full quality suite', () => {
    const result = plan([{ path: 'package.json', status: 'M' }])

    expect(result.commands).toEqual([{ label: 'full quality suite', args: ['test:all'] }])
  })

  it('runs a complete lane when source or tests were deleted', () => {
    const result = plan([
      { path: 'src/ts/removed.ts', status: 'D' },
      { path: 'server/fastify/__tests__/removed.test.ts', status: 'D' },
    ])

    expect(result.commands).toEqual([
      { label: 'frontend tests', args: ['test:frontend'] },
      { label: 'server tests', args: ['test:server'] },
    ])
  })

  it('keeps browser smoke opt-in for the quick feedback loop', () => {
    const change = [{ path: 'server/fastify/browser-smoke/fastifyBrowserSmoke.spec.ts', status: 'M' as const }]
    const quick = plan(change)
    const withSmoke = planAffectedTests(change, { ...options, includeSmoke: true })

    expect(quick.commands).toEqual([])
    expect(quick.notes).toContain('Browser-smoke changes detected; rerun with --include-smoke before handoff.')
    expect(withSmoke.commands).toEqual([{ label: 'browser smoke tests', args: ['test:smoke'] }])
  })

  it('does not run tests for documentation-only changes', () => {
    const result = plan([{ path: 'docs/tests/README.md', status: 'M' }])

    expect(result.commands).toEqual([])
    expect(result.notes).toContain('No affected automated test lane was found for the changed paths.')
  })

  it('selects the opt-in compatibility harness independently', () => {
    const result = plan([{ path: 'test/compat-harness/current.runner.ts', status: 'M' }])

    expect(result.commands).toEqual([{ label: 'compatibility harness', args: ['test:compat-harness'] }])
  })
})
