import { describe, expect, it } from 'vitest'
import {
  validateConfiguredTestFiles,
  validateTestTopology,
  type ListedTestFile,
  type TestTopologySnapshot,
} from './test-topology.js'

function listed(file: string, projectName?: string): ListedTestFile {
  return { file, projectName }
}

function healthySnapshot(): TestTopologySnapshot {
  const plain = 'src/plain.test.ts'
  const dom = 'src/view.svelte.test.ts'
  const performance = 'src/ts/__tests__/renderCostHarness.test.ts'
  const uiMap = 'src/lib/Others/GridCatalog.svelte.test.ts'
  const isolated = 'test/compat-harness/phase9CbsBaseline.test.ts'
  const server = 'server/fastify/__tests__/app.test.ts'

  return {
    trackedTests: [plain, dom, performance, uiMap, isolated, server],
    defaultFrontend: [listed(plain, 'frontend-node'), listed(dom, 'frontend-dom'), listed(uiMap, 'frontend-dom')],
    gatesFrontend: [
      listed(plain, 'frontend-node'),
      listed(dom, 'frontend-dom'),
      listed(performance, 'frontend-dom'),
      listed(uiMap, 'frontend-dom'),
    ],
    uiExcludedFrontend: [listed(plain, 'frontend-node'), listed(dom, 'frontend-dom')],
    server: [listed(server)],
  }
}

describe('test topology validation', () => {
  it('accepts disjoint project routing and the specialized exclusion modes', () => {
    expect(validateTestTopology(healthySnapshot())).toEqual([])
  })

  it('reports missing, duplicate, unexpected, and misrouted tests', () => {
    const snapshot = healthySnapshot()
    snapshot.defaultFrontend = [
      listed('src/plain.test.ts', 'frontend-dom'),
      listed('src/plain.test.ts', 'frontend-dom'),
      listed('src/untracked.test.ts', 'frontend-node'),
    ]

    expect(validateTestTopology(snapshot)).toEqual(
      expect.arrayContaining([
        'frontend default: duplicate test discovery for src/plain.test.ts',
        'frontend default: src/plain.test.ts routed to frontend-dom; expected frontend-node',
        'frontend default: missing tracked test src/view.svelte.test.ts',
        'frontend default: missing tracked test src/lib/Others/GridCatalog.svelte.test.ts',
        'frontend default: unexpected test discovery for src/untracked.test.ts',
      ]),
    )
  })

  it('fails when a configured owner points to a missing test', () => {
    expect(
      validateConfiguredTestFiles(
        ['src/present.test.ts'],
        [{ label: 'focused tests', files: ['src/present.test.ts', 'src/missing.test.ts'] }],
      ),
    ).toEqual(['focused tests: configured test is missing: src/missing.test.ts'])
  })
})
