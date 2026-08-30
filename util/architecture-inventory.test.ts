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
  type CrossRuntimeBaseline,
} from './architecture-inventory.js'

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
    expect(observation.edges.reduce((total, edge) => total + edge.count, 0)).toBe(375)
    expect(
      Object.fromEntries(
        (['production', 'server-test', 'browser-smoke'] as const).map((lane) => [
          lane,
          observation.edges.filter((edge) => edge.lane === lane).reduce((total, edge) => total + edge.count, 0),
        ]),
      ),
    ).toEqual({ production: 260, 'server-test': 107, 'browser-smoke': 8 })
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
