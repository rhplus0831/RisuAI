import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  categoryForTestFile,
  checkTestEffectivenessInventory,
  createTestEffectivenessInventoryRow,
  dependencySignalsForSource,
  discoverTrackedTestFiles,
  documentedCategoryRules,
  formatTestEffectivenessInventory,
  pendingAuditMetadata,
  pendingSupportArtifactLink,
  runTestEffectivenessInventoryCli,
  validateTestEffectivenessInventory,
  writeTestEffectivenessInventory,
  type TestEffectivenessInventoryDocument,
} from './test-effectiveness-inventory.js'
import {
  checkTestSupportInventory,
  createTestSupportInventoryDocument,
  mixedProductionTestSeams,
  writeTestSupportInventory,
} from './test-support-inventory.js'

const temporaryDirectories: string[] = []

afterEach(() => {
  vi.restoreAllMocks()
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

function temporaryGitRepository(files: Readonly<Record<string, string>>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'risu-test-effectiveness-inventory-'))
  temporaryDirectories.push(root)
  const git = spawnSync('git', ['init', '--quiet'], { cwd: root, encoding: 'utf8' })
  if (git.status !== 0) throw new Error(git.stderr)
  for (const [file, source] of Object.entries(files)) {
    const absoluteFile = path.join(root, file)
    fs.mkdirSync(path.dirname(absoluteFile), { recursive: true })
    fs.writeFileSync(absoluteFile, source)
  }
  const add = spawnSync('git', ['add', '.'], { cwd: root, encoding: 'utf8' })
  if (add.status !== 0) throw new Error(add.stderr)
  return root
}

describe('test effectiveness inventory', () => {
  it('uses ordered, documented product-boundary rules to assign exactly one A-L category', () => {
    const examples = new Map<string, string>([
      ['util/test-all.test.ts', 'A'],
      ['src/ts/server/pendingMutationOutbox.test.ts', 'B'],
      ['server/fastify/__tests__/commands.test.ts', 'C'],
      ['src/lib/ChatScreens/ChatBody.svelte.test.ts', 'D'],
      ['src/lib/Setting/CharacterSettings.svelte.test.ts', 'E'],
      ['server/fastify/__tests__/generation.chat.test.ts', 'F'],
      ['server/fastify/__tests__/generation.providerUnits.test.ts', 'G'],
      ['server/fastify/__tests__/embeddingOperations.test.ts', 'H'],
      ['src/ts/process/scripts.regexCache.test.ts', 'I'],
      ['src/ts/process/mcp/mcp.test.ts', 'J'],
      ['server/fastify/__tests__/realmImport.test.ts', 'K'],
      ['server/fastify/__tests__/auth.test.ts', 'L'],
    ])

    for (const [file, category] of examples) expect(categoryForTestFile(file).category, file).toBe(category)

    const documented = documentedCategoryRules()
    expect(new Set(documented.map((rule) => rule.id)).size).toBe(documented.length)
    expect(documented.slice(0, -3).every((rule) => rule.pathPatterns.length > 0)).toBe(true)
    expect(documented.at(-3)?.id).toBe('fallback-browser-or-dom')
  })

  it('reuses lane routing and captures special ownership, kind, seams, and static dependencies', () => {
    const frontend = createTestEffectivenessInventoryRow(
      'src/lib/Others/GridCatalog.svelte.test.ts',
      `import { render } from '@testing-library/svelte'\nvi.mock('./catalog')\nawait fetch('/api/catalog')`,
    )
    expect(frontend).toMatchObject({
      lane: 'frontend-dom',
      capability: 'D',
      primaryCategory: 'E',
      kind: 'component/DOM',
      specializedOwnership: expect.arrayContaining(['ordinary-frontend', 'ui-map-coverage']),
      seamTags: expect.arrayContaining(['coverage-gate', 'dom-component']),
      dependencySignals: ['mocks', 'network', 'browser'],
    })

    const server = createTestEffectivenessInventoryRow(
      'server/fastify/__tests__/commands.test.ts',
      `import Database from 'better-sqlite3'\nimport { readFile } from 'node:fs/promises'\nvi.useFakeTimers()\nawait app.inject({ url: '/commands' })`,
    )
    expect(server).toMatchObject({
      lane: 'fastify-node',
      capability: 'Fastify Node',
      primaryCategory: 'C',
      kind: 'storage integration',
      specializedOwnership: ['server'],
      dependencySignals: ['timers', 'network', 'filesystem', 'database'],
    })

    const browser = createTestEffectivenessInventoryRow(
      'server/fastify/browser-smoke/startupRecoveryIntegrationMatrix.spec.ts',
      `import { test } from '@playwright/test'\nawait page.reload()`,
    )
    expect(browser).toMatchObject({
      lane: 'built-browser',
      capability: 'B',
      primaryCategory: 'B',
      kind: 'browser journey',
      specializedOwnership: ['browser-smoke'],
      seamTags: ['browser-client-fastify-sqlite'],
      dependencySignals: ['browser'],
    })

    expect(dependencySignalsForSource(`globalThis.fetch = vi.fn(); setTimeout(run); indexedDB.open('db')`)).toEqual([
      'mocks',
      'timers',
      'globals',
      'browser',
    ])
  })

  it('discovers only tracked TypeScript test/spec files with deterministic ordering', () => {
    const root = temporaryGitRepository({
      'src/zeta.test.ts': 'export {}',
      'server/fastify/browser-smoke/journey.spec.ts': 'export {}',
      'src/ignored.test.tsx': 'export {}',
      'src/ignored.spec.js': 'export {}',
      'src/production.ts': 'export {}',
    })
    fs.writeFileSync(path.join(root, 'src/untracked.test.ts'), 'export {}')

    expect(discoverTrackedTestFiles(root)).toEqual(['server/fastify/browser-smoke/journey.spec.ts', 'src/zeta.test.ts'])
  })

  it('writes deterministic JSON, preserves reviewed audit fields, and rejects stale generated signals', () => {
    const root = temporaryGitRepository({
      'src/pure.test.ts': `export const answer = 42`,
      'server/fastify/__tests__/auth.test.ts': `vi.mock('./auth')`,
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})

    fs.writeFileSync(
      path.join(root, 'case-counts.json'),
      JSON.stringify({
        schemaVersion: 1,
        source: 'vitest collection 2026-08-29',
        files: {
          'server/fastify/__tests__/auth.test.ts': { cases: 7, skipped: 1, parameterizedRows: 4 },
        },
      }),
    )
    expect(
      runTestEffectivenessInventoryCli(['--write', 'inventory.json', '--case-counts', 'case-counts.json'], root),
    ).toBe(0)
    const firstText = fs.readFileSync(path.join(root, 'inventory.json'), 'utf8')
    const first = JSON.parse(firstText) as TestEffectivenessInventoryDocument
    expect(first.trackedFileCount).toBe(2)
    expect(first.rows.map((row) => row.file)).toEqual(['server/fastify/__tests__/auth.test.ts', 'src/pure.test.ts'])
    expect(first.rows[0].caseCounts).toEqual({
      cases: 7,
      skipped: 1,
      parameterizedRows: 4,
      source: 'vitest collection 2026-08-29',
    })
    expect(first.rows[1].caseCounts.source).toBe('pending')
    expect(firstText).toBe(formatTestEffectivenessInventory(first))

    first.rows[0].audit = {
      ...pendingAuditMetadata(),
      caseOrMatrixOwner: 'auth matrix',
      valueClasses: ['security and safety'],
      productionOwnerOrContract: 'buildAuthPlugin',
      plausibleDefect: 'Unauthenticated access is accepted.',
      risk: 'Credential-protected data is exposed.',
      companionEvidence: 'browser auth bootstrap',
      decision: 'Keep',
      confidence: 'high',
      rationale: 'Distinct route-level authorization evidence.',
      findingId: 'TSE-L-001',
      severity: 'High',
      action: 'none',
      validation: 'pnpm test:server',
      state: 'reviewed',
    }
    first.supportArtifacts = {
      manifest: 'support-artifacts.json',
      standaloneArtifactCount: 247,
      mixedProductionSeamCount: 64,
      state: 'linked',
    }
    fs.writeFileSync(path.join(root, 'support-artifacts.json'), '{}')
    fs.writeFileSync(path.join(root, 'inventory.json'), formatTestEffectivenessInventory(first))

    const rewritten = writeTestEffectivenessInventory(root, 'inventory.json')
    expect(rewritten.rows[0].audit).toEqual(first.rows[0].audit)
    expect(checkTestEffectivenessInventory(root, 'inventory.json').rows[0].audit.decision).toBe('Keep')

    fs.appendFileSync(path.join(root, 'src/pure.test.ts'), `\nawait fetch('/api/value')`)
    expect(() => checkTestEffectivenessInventory(root, 'inventory.json')).toThrow(/inventory is stale/)
  })

  it('validates exhaustive row shape, sorting, uniqueness, and review enums', () => {
    const row = createTestEffectivenessInventoryRow('src/pure.test.ts', 'export {}')
    const document: TestEffectivenessInventoryDocument = {
      schemaVersion: 1,
      trackedFileCount: 2,
      categoryRules: documentedCategoryRules(),
      supportArtifacts: pendingSupportArtifactLink(),
      rows: [row, { ...row, audit: { ...row.audit, valueClasses: ['pending', 'architecture policy'] } }],
    }

    expect(validateTestEffectivenessInventory(document)).toEqual(
      expect.arrayContaining([
        'rows[1].audit.valueClasses cannot combine pending with reviewed values',
        'rows contain duplicate file paths',
        'rows must be strictly sorted by file',
      ]),
    )
  })

  it('keeps standalone support owners disjoint from tests and verifies linked manifests', () => {
    const root = temporaryGitRepository({
      ...Object.fromEntries(
        [
          '.archived-docs/performance-and-stability/frontend-test-architecture/phase-0-inventory.tsv',
          '.github/workflows/quality.yml',
          'docs/plan/test-suite-effectiveness-audit/inventory.json',
          'docs/plan/test-suite-effectiveness-audit/support-artifacts.json',
          'package.json',
          'playwright.fastify-smoke.config.ts',
          'server/fastify/tsconfig.json',
          'server/fastify/vitest.config.ts',
          'tsconfig.browser-smoke.json',
          'tsconfig.client-lib.json',
          'util/affected-tests.ts',
          'util/check-server.ts',
          'util/frontend-test-inventory.ts',
          'util/test-all.ts',
          'util/test-effectiveness-inventory.ts',
          'util/test-support-inventory.ts',
          'vite.config.ts',
          'vitest.config.ts',
          'vitest.dom.config.ts',
          'vitest.dom.setup.ts',
          'vitest.fetchGuard.ts',
          'vitest.frontend-routing.ts',
          'vitest.node.config.ts',
          'vitest.performance-tests.ts',
          'vitest.setup.ts',
          'vitest.svelte-node.config.ts',
          'vitest.svelte-node.environment.ts',
          'vitest.ui-coverage-tests.ts',
          'util/bundle-boundary-report.ts',
          'util/fast-bootstrap-boundaries.ts',
          'util/initial-preload-budgets.json',
          'util/initial-preload-report.ts',
          'server/fastify/__fixtures__/risuSave/fixtures.ts',
          'server/fastify/src/risuSave/fixtureHarness.ts',
          'server/fastify/browser-smoke/auth.ts',
          'server/fastify/browser-smoke/fastBootstrapHarness.ts',
          'server/fastify/browser-smoke/globals.d.ts',
          'src/lib/ChatScreens/Chat.parserDependenciesHarness.svelte',
          'src/lib/ChatScreens/DefaultChatScreen.shellGreetingStub.svelte',
          'src/lib/_audit/domStateOracle.ts',
          'src/ts/parser/tests/cbs/lib.ts',
          ...mixedProductionTestSeams,
        ].map((file) => [file, 'export {}']),
      ),
      'test/compat-harness/run.ts': 'export {}',
      'src/ts/process/__fixtures__/db/input.json': '{}',
      'src/ts/__tests__/helper.ts': 'export {}',
      'src/lib/Thing.testHost.svelte': '<div />',
      'server/fastify/browser-smoke/example.spec.ts-snapshots/example.png': 'png',
    })

    const document = createTestSupportInventoryDocument(root)
    expect(document.standaloneCount).toBeGreaterThan(30)
    expect(document.mixedProductionCount).toBe(64)
    expect(document.groups.flatMap((group) => group.files)).not.toContain('src/example.test.ts')

    writeTestSupportInventory(root, 'docs/plan/test-suite-effectiveness-audit/support-artifacts.json')
    expect(checkTestSupportInventory(root, 'docs/plan/test-suite-effectiveness-audit/support-artifacts.json')).toEqual(
      document,
    )
  })
})
