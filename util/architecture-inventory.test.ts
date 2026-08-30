import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  collectCrossRuntimeObservation,
  collectSourceFileModuleEdges,
  compareCrossRuntimeBaseline,
  createCrossRuntimeBaseline,
  refreshCompatibilityBaseline,
  validateCompatibilityBaseline,
  type CompatibilityBaseline,
  type CrossRuntimeBaseline,
} from './architecture-inventory.js'
import {
  collectClientResourceObservation,
  compareClientResourceBaseline,
  createClientResourceBaseline,
  type ClientResourceBaseline,
} from './client-resource-inventory.js'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

function fixtureRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'risu-architecture-inventory-'))
  temporaryDirectories.push(root)
  fs.mkdirSync(path.join(root, 'src'), { recursive: true })
  fs.mkdirSync(path.join(root, 'server/fastify/src'), { recursive: true })
  fs.writeFileSync(path.join(root, 'src/contracts.ts'), 'export type Contract = string\nexport const value = 1\n')
  return root
}

describe('architecture inventory AST collector', () => {
  it('classifies static, mixed, re-export, dynamic, require, and import-type edges', () => {
    const root = fixtureRoot()
    const importer = path.join(root, 'server/fastify/src/consumer.ts')
    fs.writeFileSync(
      importer,
      `
        import type { Contract } from '../../../src/contracts.js'
        import value, { type Contract as OtherContract, value as runtimeValue } from '../../../src/contracts.js'
        export type { Contract as ExportedContract } from '../../../src/contracts.js'
        const dynamicValue = import('../../../src/contracts.js')
        const requiredValue = require('../../../src/contracts.js')
        type Imported = import('../../../src/contracts.js').Contract
        void value
        void runtimeValue
        void dynamicValue
        void requiredValue
      `,
    )

    const observed = collectSourceFileModuleEdges(root, 'production', importer)

    expect(observed.nonLiteralModuleReferences).toEqual([])
    expect(observed.edges.map(({ kind, usage, symbols }) => ({ kind, usage, symbols }))).toEqual([
      { kind: 'dynamic', usage: 'runtime', symbols: ['*'] },
      { kind: 'import-type', usage: 'type-only', symbols: ['*'] },
      { kind: 're-export', usage: 'type-only', symbols: ['Contract'] },
      { kind: 'require', usage: 'runtime', symbols: ['*'] },
      { kind: 'static', usage: 'mixed', symbols: ['Contract', 'default', 'value'] },
      { kind: 'static', usage: 'type-only', symbols: ['Contract'] },
    ])
  })

  it('ignores comments and strings while recording non-literal module selection', () => {
    const root = fixtureRoot()
    const importer = path.join(root, 'server/fastify/src/consumer.ts')
    fs.writeFileSync(
      importer,
      `
        const comment = "import('../../../src/contracts.js')"
        // require('../../../src/contracts.js')
        const target = '../../../src/contracts.js'
        const dynamicValue = import(target)
        void comment
        void dynamicValue
      `,
    )

    const observed = collectSourceFileModuleEdges(root, 'production', importer)

    expect(observed.edges).toEqual([])
    expect(observed.nonLiteralModuleReferences).toEqual([
      {
        lane: 'production',
        importer: 'server/fastify/src/consumer.ts',
        kind: 'dynamic',
        count: 1,
      },
    ])
  })
})

describe('cross-runtime baseline gate', () => {
  it('matches the reviewed repository baseline and records every current lane', () => {
    const observation = collectCrossRuntimeObservation(REPO_ROOT)
    const baseline = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, 'docs/plan/cross-runtime-boundaries/baseline.json'), 'utf8'),
    ) as CrossRuntimeBaseline

    expect(compareCrossRuntimeBaseline(observation, baseline)).toEqual([])
    expect(observation.edges.reduce((total, edge) => total + edge.count, 0)).toBe(341)
    expect(
      Object.fromEntries(
        (['production', 'server-test', 'browser-smoke'] as const).map((lane) => [
          lane,
          observation.edges.filter((edge) => edge.lane === lane).reduce((total, edge) => total + edge.count, 0),
        ]),
      ),
    ).toEqual({ production: 238, 'server-test': 95, 'browser-smoke': 8 })
  })

  it('rejects inventory drift and incomplete policy ownership', () => {
    const observation = {
      edges: [],
      nonLiteralModuleReferences: [],
      projectReferences: [],
      metadata: [],
    }
    const baseline = createCrossRuntimeBaseline(observation, 'test-anchor')
    baseline.edges.push({
      lane: 'production',
      importer: 'server/fastify/src/example.ts',
      specifier: '../../../src/example.js',
      target: 'src/example.ts',
      kind: 'static',
      usage: 'runtime',
      symbols: ['example'],
      count: 1,
      policy: 'missing-policy',
    })

    expect(compareCrossRuntimeBaseline(observation, baseline)).toEqual([
      'edge server/fastify/src/example.ts -> src/example.ts uses unknown policy missing-policy',
      expect.stringContaining('cross-runtime architecture inventory drifted'),
    ])
  })
})

describe('compatibility disposition gate', () => {
  it('validates the reviewed repository matrix and fixture provenance', () => {
    const baseline = JSON.parse(
      fs.readFileSync(
        path.join(REPO_ROOT, 'docs/plan/canonical-state-and-compatibility/compatibility-baseline.json'),
        'utf8',
      ),
    ) as CompatibilityBaseline

    expect(validateCompatibilityBaseline(REPO_ROOT, baseline)).toEqual([])
    expect(baseline.surfaces).toHaveLength(19)
    expect(new Set(baseline.surfaces.map((surface) => surface.id)).size).toBe(19)
    expect(new Set(baseline.surfaces.map((surface) => surface.disposition))).toEqual(
      new Set(['canonical', 'migrate', 'import-only', 'explicit-compatibility', 'remove']),
    )
  })

  it('rejects probe drift and missing fixtures', () => {
    const root = fixtureRoot()
    const fixture = path.join(root, 'fixture.ts')
    const source = path.join(root, 'src/compatibility.ts')
    fs.writeFileSync(fixture, 'export const fixture = true\n')
    fs.writeFileSync(source, 'export const legacyMirror = true\n')
    const baseline = refreshCompatibilityBaseline(root, {
      schemaVersion: 1,
      openingAnchor: 'test-anchor',
      conventionRelease: 'test-release',
      decisionPolicy: 'Test policy.',
      surfaces: [
        {
          id: 'legacy-mirror',
          family: 'repair',
          surface: 'legacyMirror',
          currentOwner: 'test owner',
          roles: ['repair'],
          currentPrecedence: 'Test precedence.',
          missingBehavior: 'Test missing behavior.',
          malformedBehavior: 'Test malformed behavior.',
          damagedDatabaseBehavior: 'Test damaged behavior.',
          historicalFixture: 'fixture.ts',
          provenance: 'Test provenance.',
          disposition: 'migrate',
          targetOwner: 'test target',
          migrationPhase: 'test phase',
          oldReaderOrExporter: 'test old reader',
          rollbackProof: 'test rollback',
          workstream3Cursor: 'test hold',
          probes: [{ path: 'src/compatibility.ts', kind: 'identifier', value: 'legacyMirror', expectedCount: 0 }],
        },
      ],
    })

    expect(validateCompatibilityBaseline(root, baseline)).toEqual([])
    fs.writeFileSync(source, 'export const legacyMirror = true\nexport const next = legacyMirror\n')
    fs.rmSync(fixture)
    expect(validateCompatibilityBaseline(root, baseline)).toEqual([
      'compatibility surface legacy-mirror fixture does not exist: fixture.ts',
      'compatibility surface legacy-mirror probe drifted: src/compatibility.ts identifier "legacyMirror" expected 1, observed 2',
    ])
  })
})

describe('client resource ownership gate', () => {
  it('matches every reviewed consumer, bridge family, and temporary seam', () => {
    const observation = collectClientResourceObservation(REPO_ROOT)
    const baseline = JSON.parse(
      fs.readFileSync(
        path.join(REPO_ROOT, 'docs/plan/client-resource-ownership/client-resource-baseline.json'),
        'utf8',
      ),
    ) as ClientResourceBaseline

    expect(compareClientResourceBaseline(observation, baseline)).toEqual([])
    expect(observation.consumers.reduce((total, consumer) => total + consumer.count, 0)).toBe(9917)
    expect(observation.consumers).toHaveLength(1168)
    expect(baseline.consumers).toHaveLength(325)
    expect(observation.bridgeFamilies.map((bridge) => bridge.family)).toEqual([
      'character',
      'chat',
      'lorebook',
      'promptTemplate',
      'scriptDefinition',
      'settings',
    ])
    expect(observation.temporarySeams).toHaveLength(20)
  })

  it('parses Svelte scripts and rejects a new aggregate consumer or bridge family', () => {
    const root = fixtureRoot()
    fs.writeFileSync(
      path.join(root, 'src/Panel.svelte'),
      `<script lang="ts">
        const current = getDatabase()
      </script>
      <p>{current.version}</p>`,
    )
    fs.mkdirSync(path.join(root, 'src/ts/server'), { recursive: true })
    fs.writeFileSync(
      path.join(root, 'src/ts/server/exampleBridge.svelte.ts'),
      'export function watchServerBackedExample() {}\nexport function flushPendingServerBackedExamplePatches() {}\n',
    )
    const observation = collectClientResourceObservation(root)
    const baseline = createClientResourceBaseline(observation, 'test-anchor', 'test-release')

    expect(compareClientResourceBaseline(observation, baseline)).toEqual([])
    expect(observation.consumers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ file: 'src/Panel.svelte', detector: 'aggregate-read', symbol: 'getDatabase' }),
      ]),
    )
    expect(observation.bridgeFamilies).toEqual([
      {
        file: 'src/ts/server/exampleBridge.svelte.ts',
        family: 'example',
        exportedWatchers: ['watchServerBackedExample'],
        exportedFlushers: ['flushPendingServerBackedExamplePatches'],
      },
    ])

    fs.writeFileSync(
      path.join(root, 'src/Panel.svelte'),
      `<script lang="ts">
        const current = getDatabase()
        const second = getDatabase()
      </script>`,
    )
    expect(compareClientResourceBaseline(collectClientResourceObservation(root), baseline)).toContain(
      'client resource ownership inventory drifted; regenerate and review the baseline',
    )
  })
})
