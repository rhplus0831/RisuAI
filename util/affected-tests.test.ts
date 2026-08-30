import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ADDITIVE_PROTOCOL_EXPORT_NOTE,
  FINAL_VERIFICATION_REQUIRED_NOTE,
  isAdditiveProtocolExportChange,
  parseNameStatus,
  planAffectedTests,
  type ChangedPath,
} from './affected-tests.js'

const options = { base: 'HEAD~1', bail: true, includeSmoke: false }

function plan(changes: ChangedPath[]) {
  return planAffectedTests(changes, options)
}

describe('affected test planning', () => {
  it('parses NUL-delimited modifications, deletions, and renames', () => {
    expect(parseNameStatus('M\0src/a.ts\0D\0src/old.ts\0R100\0src/before.ts\0src/after.ts\0')).toEqual([
      { path: 'src/a.ts', status: 'M' },
      { path: 'src/old.ts', status: 'D' },
      { path: 'src/before.ts', status: 'D' },
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
      'current compatibility harness',
    ])
    const affectedCommands = result.commands.filter((command) => command.label.startsWith('affected'))
    expect(affectedCommands.every((command) => command.args.includes('--changed'))).toBe(true)
    expect(affectedCommands.every((command) => command.args.includes('HEAD~1'))).toBe(true)
  })

  it('runs the complete Vitest lanes when runner configuration changes', () => {
    const result = plan([{ path: 'vitest.svelte-node.config.ts', status: 'M' }])

    expect(result.commands).toEqual([
      { label: 'frontend tests', args: ['test:frontend:run'] },
      { label: 'frontend performance gates', args: ['test:gates:perf'] },
      { label: 'server tests', args: ['test:server'] },
    ])
  })

  it('defers dependency and CI changes to explicit final verification', () => {
    const result = plan([{ path: 'package.json', status: 'M' }])

    expect(result.commands).toEqual([])
    expect(result.finalVerificationRequired).toBe(true)
    expect(result.notes).toContain(FINAL_VERIFICATION_REQUIRED_NOTE)
  })

  it('routes protocol sources through typecheck and both dependency-aware test lanes', () => {
    const result = plan([{ path: 'packages/protocol/src/generationSse.ts', status: 'M' }])

    expect(result.commands.map((command) => command.label)).toEqual([
      'protocol typecheck',
      'affected frontend tests',
      'affected server tests',
      'current compatibility harness',
    ])
    expect(
      result.commands
        .filter((command) => command.label.startsWith('affected'))
        .every((command) => command.args.includes('--changed')),
    ).toBe(true)
  })

  it('routes shared-core sources through their typecheck and both consumer lanes', () => {
    const result = plan([{ path: 'packages/shared-core/src/chatPage.ts', status: 'M' }])

    expect(result.commands.map((command) => command.label)).toEqual([
      'shared-core typecheck',
      'affected frontend tests',
      'affected server tests',
      'current compatibility harness',
    ])
  })

  it('keeps additive protocol exports targeted and widens every unclassified protocol configuration change', () => {
    const additive = plan([
      { path: 'packages/protocol/package.json', status: 'M', impact: 'protocol-additive-exports' },
    ])

    expect(additive.commands).toEqual([{ label: 'protocol typecheck', args: ['check:protocol'] }])
    expect(additive.finalVerificationRequired).toBe(false)
    expect(additive.notes).toContain(ADDITIVE_PROTOCOL_EXPORT_NOTE)
    for (const file of ['packages/protocol/package.json', 'packages/protocol/tsconfig.json']) {
      const result = plan([{ path: file, status: 'M' }])
      expect(result.commands).toEqual([])
      expect(result.finalVerificationRequired).toBe(true)
    }
    for (const file of ['packages/shared-core/package.json', 'packages/shared-core/tsconfig.json']) {
      const result = plan([{ path: file, status: 'M' }])
      expect(result.commands).toEqual([])
      expect(result.finalVerificationRequired).toBe(true)
    }
  })

  it('runs safe targeted feedback beside a deferred configuration change', () => {
    const result = plan([
      { path: 'package.json', status: 'M' },
      { path: 'src/ts/model/modelProfileResolver.ts', status: 'M' },
    ])

    expect(result.commands.map((command) => command.label)).toEqual([
      'affected frontend tests',
      'affected server tests',
      'current compatibility harness',
    ])
    expect(result.finalVerificationRequired).toBe(true)
    expect(result.commands.some((command) => command.args.includes('test:all'))).toBe(false)
  })

  it('accepts only additive explicit protocol exports to existing local TypeScript files', () => {
    const packageRoot = mkdtempSync(path.join(tmpdir(), 'risu-protocol-exports-'))
    mkdirSync(path.join(packageRoot, 'src'))
    writeFileSync(path.join(packageRoot, 'src', 'newContract.ts'), 'export const value = true\n')
    const before = {
      name: '@risuai/protocol',
      private: true,
      exports: { '.': './src/index.ts', './existing': './src/existing.ts' },
      dependencies: { '@sinclair/typebox': '0.34.52' },
    }
    const after = {
      ...before,
      exports: { ...before.exports, './new-contract': './src/newContract.ts' },
    }

    try {
      expect(isAdditiveProtocolExportChange(JSON.stringify(before), JSON.stringify(after), packageRoot)).toBe(true)
      for (const unsafe of [
        { ...after, private: false },
        { ...after, exports: { '.': './src/other.ts', './new-contract': './src/newContract.ts' } },
        { ...before, exports: { '.': './src/index.ts' } },
        { ...after, exports: { ...before.exports, './new-contract': { import: './src/newContract.ts' } } },
        { ...after, exports: { ...before.exports, './new-contract': '../outside.ts' } },
        { ...after, exports: { ...before.exports, './new-contract': './src/missing.ts' } },
      ]) {
        expect(isAdditiveProtocolExportChange(JSON.stringify(before), JSON.stringify(unsafe), packageRoot)).toBe(false)
      }
      expect(isAdditiveProtocolExportChange('{', JSON.stringify(after), packageRoot)).toBe(false)
    } finally {
      rmSync(packageRoot, { force: true, recursive: true })
    }
  })

  it('selects shared Fastify test support and widens its deletion', () => {
    const helper = 'server/fastify/__tests__/helpers/terminalFrameAssertions.ts'
    const fixture = 'server/fastify/__fixtures__/risuSave/fixtures.ts'

    for (const file of [helper, fixture]) {
      expect(plan([{ path: file, status: 'M' }]).commands).toEqual([
        {
          label: 'affected server tests',
          args: [
            'exec',
            'vitest',
            'run',
            '--config',
            'server/fastify/vitest.config.ts',
            '--changed',
            'HEAD~1',
            '--passWithNoTests',
            '--bail=1',
          ],
        },
      ])
      expect(plan([{ path: file, status: 'D' }]).commands).toEqual([{ label: 'server tests', args: ['test:server'] }])
    }
  })

  it('treats a rename away from a test path as a deletion', () => {
    const changes = parseNameStatus('R100\0src/removed.test.ts\0docs/removed.md\0')

    expect(plan(changes).commands).toEqual([
      { label: 'frontend tests', args: ['test:frontend:run'] },
      { label: 'server tests', args: ['test:server'] },
    ])
  })

  it('runs a complete lane when source or tests were deleted', () => {
    const result = plan([
      { path: 'src/ts/removed.ts', status: 'D' },
      { path: 'server/fastify/__tests__/removed.test.ts', status: 'D' },
    ])

    expect(result.commands).toEqual([
      { label: 'frontend tests', args: ['test:frontend:run'] },
      { label: 'server tests', args: ['test:server'] },
      { label: 'current compatibility harness', args: ['test:compat-current'] },
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

  it('selects current and full pinned compatibility for harness changes', () => {
    const result = plan([{ path: 'test/compat-harness/current.runner.ts', status: 'M' }])

    expect(result.commands).toEqual([
      { label: 'current compatibility harness', args: ['test:compat-current'] },
      { label: 'full pinned compatibility harness', args: ['test:compat-harness'] },
    ])
    expect(result.notes).toEqual([])
  })

  it('selects focused baseline tests plus current and full pinned compatibility', () => {
    for (const file of ['util/compat-baseline.ts', 'util/compat-baseline.test.ts']) {
      expect(plan([{ path: file, status: 'M' }]).commands).toEqual([
        {
          label: 'compatibility baseline tests',
          args: ['exec', 'vitest', 'run', 'util/compat-baseline.test.ts', '--bail=1'],
        },
        { label: 'current compatibility harness', args: ['test:compat-current'] },
        { label: 'full pinned compatibility harness', args: ['test:compat-harness'] },
      ])
    }
  })

  it('selects fail-closed register validation and its focused tests', () => {
    for (const file of [
      '.archived-docs/architecture-and-migration/original-risu-behavioral-compatibility/inventory/upstream-units.schema.json',
      '.archived-docs/architecture-and-migration/original-risu-behavioral-compatibility/findings/findings.json',
      'util/validate-original-risu-compatibility-registers.ts',
      'util/validate-original-risu-compatibility-registers.test.ts',
    ]) {
      expect(plan([{ path: file, status: 'M' }]).commands).toEqual([
        { label: 'compatibility register validation', args: ['validate:compat-registers'] },
        {
          label: 'compatibility register validator tests',
          args: ['exec', 'vitest', 'run', 'util/validate-original-risu-compatibility-registers.test.ts', '--bail=1'],
        },
      ])
    }
  })

  it('adds current compatibility for client, server, and protocol production changes', () => {
    for (const file of [
      'src/ts/process/request/openAI/requests.ts',
      'server/fastify/src/generation/openaiResponses.ts',
      'packages/protocol/src/generationSse.ts',
    ]) {
      expect(plan([{ path: file, status: 'M' }]).commands.at(-1)).toEqual({
        label: 'current compatibility harness',
        args: ['test:compat-current'],
      })
    }

    expect(
      plan([{ path: 'src/docs/client-runtime.md', status: 'M' }]).commands.some(
        (command) => command.label === 'current compatibility harness',
      ),
    ).toBe(false)
  })

  it('defers aggregate and affected-runner changes to explicit final verification', () => {
    for (const file of ['util/test-all.ts', 'util/affected-tests.ts']) {
      const result = plan([{ path: file, status: 'M' }])
      expect(result.commands).toEqual([])
      expect(result.finalVerificationRequired).toBe(true)
    }
  })

  it('retains compatibility feedback when final verification is deferred', () => {
    const result = plan([
      { path: 'util/affected-tests.ts', status: 'M' },
      { path: 'test/compat-harness/normalize.ts', status: 'M' },
    ])

    expect(result.commands).toEqual([
      { label: 'current compatibility harness', args: ['test:compat-current'] },
      { label: 'full pinned compatibility harness', args: ['test:compat-harness'] },
    ])
    expect(result.finalVerificationRequired).toBe(true)
  })
})
