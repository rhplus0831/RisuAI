import { describe, expect, it } from 'vitest'
import {
  analyzeFrontendTestSource,
  analyzeForbiddenDomCapabilityImports,
  createFrontendTestInventoryRow,
  frontendCapabilityOverrideReason,
  formatFrontendTestInventory,
  parseFastifyFilesOnlyOutput,
  parsePlaywrightListFiles,
  parseVitestFilesOnlyOutput,
  validateFrontendCapabilityRouting,
  validateFrontendVitestDiscovery,
  validateResolvedLaneDiscovery,
} from './frontend-test-inventory.js'

describe('frontend test inventory', () => {
  it('parses resolved Vitest project ownership while ignoring unrelated output', () => {
    const projects = parseVitestFilesOnlyOutput(`
Svelte warning
[frontend-node] src/pure.test.ts
[frontend-svelte-node] src/store.svelte.test.ts
[frontend-dom] src/component.svelte.test.ts
[frontend-dom] src/browser.dom.test.ts
`)

    expect([...projects.get('frontend-node')!]).toEqual(['src/pure.test.ts'])
    expect([...projects.get('frontend-svelte-node')!]).toEqual(['src/store.svelte.test.ts'])
    expect([...projects.get('frontend-dom')!]).toEqual(['src/component.svelte.test.ts', 'src/browser.dom.test.ts'])
  })

  it('reports omitted, multiply assigned, and unexpected files independently', () => {
    const problem = validateFrontendVitestDiscovery(
      ['src/missing.test.ts', 'src/shared.test.ts'],
      new Map([
        ['frontend-node', new Set(['src/shared.test.ts'])],
        ['frontend-svelte-node', new Set(['src/shared.test.ts'])],
        ['frontend-dom', new Set(['src/unexpected.test.ts'])],
      ]),
    )

    expect(problem).toEqual({
      duplicates: ['src/shared.test.ts (frontend-node, frontend-svelte-node)'],
      missing: ['src/missing.test.ts'],
      unexpected: ['src/unexpected.test.ts'],
    })
  })

  it('parses resolved Fastify and Playwright file ownership', () => {
    expect(
      parseFastifyFilesOnlyOutput(`
warning
server/fastify/__tests__/auth.test.ts
server/fastify/__tests__/commands.test.ts
`),
    ).toEqual(new Set(['server/fastify/__tests__/auth.test.ts', 'server/fastify/__tests__/commands.test.ts']))
    expect(
      parsePlaywrightListFiles(
        JSON.stringify({
          suites: [
            {
              specs: [{ file: 'first.spec.ts' }],
              suites: [{ specs: [{ file: 'nested.spec.ts' }] }],
            },
          ],
        }),
      ),
    ).toEqual(new Set(['server/fastify/browser-smoke/first.spec.ts', 'server/fastify/browser-smoke/nested.spec.ts']))
  })

  it('reports missing and unexpected resolved lane owners', () => {
    expect(
      validateResolvedLaneDiscovery(
        ['expected.test.ts', 'missing.test.ts'],
        new Set(['expected.test.ts', 'extra.test.ts']),
      ),
    ).toEqual({
      missing: ['missing.test.ts'],
      unexpected: ['extra.test.ts'],
    })
  })

  it('records direct capability and dependency evidence with line numbers', () => {
    const signals = analyzeFrontendTestSource(`
import { mount } from 'svelte'
import Component from './Component.svelte'
import fs from 'node:fs'
document.body.append(mount(Component))
await fetch('/api/value')
vi.useFakeTimers()
`)

    expect(signals.svelte).toMatchObject({ line: 2 })
    expect(signals.domOrMount).toMatchObject({ line: 5 })
    expect(signals.network).toMatchObject({ line: 6 })
    expect(signals.timers).toMatchObject({ line: 7 })
    expect(signals.filesystem).toMatchObject({ line: 4 })
    expect(analyzeFrontendTestSource(`const module = await import('./state.svelte.ts')`).svelte).toMatchObject({
      line: 1,
    })
  })

  it('detects only statically reliable DOM imports and accepts a reviewed override', () => {
    const source = `
import { get, mount as mountComponent } from 'svelte'
import { render } from '@testing-library/svelte'
import { Window } from 'happy-dom'
`

    expect(analyzeForbiddenDomCapabilityImports(source)).toEqual([
      expect.objectContaining({ line: 2, evidence: expect.stringContaining('mount as mountComponent') }),
      expect.objectContaining({ line: 3, evidence: expect.stringContaining('@testing-library/svelte') }),
      expect.objectContaining({ line: 4, evidence: expect.stringContaining('happy-dom') }),
    ])
    expect(
      frontendCapabilityOverrideReason('// @frontend-test-capability-override: dependency-injected fake DOM'),
    ).toBe('dependency-injected fake DOM')
  })

  it('reports filename, registration, project, and forbidden-capability routing gaps', () => {
    const files = [
      'src/pure.test.ts',
      'src/state.svelte-node.test.ts',
      'src/component.svelte.test.ts',
      'src/legacy.test.ts',
      'src/unclassified.spec.ts',
    ]
    const projects = new Map([
      ['frontend-node', new Set(['src/pure.test.ts', 'src/component.svelte.test.ts'])],
      ['frontend-svelte-node', new Set(['src/state.svelte-node.test.ts'])],
      ['frontend-dom', new Set(['src/legacy.test.ts'])],
    ])
    const sources = new Map([
      ['src/pure.test.ts', `import { mount } from 'svelte'`],
      [
        'src/state.svelte-node.test.ts',
        `// @frontend-test-capability-override: injected mount adapter\nimport { mount } from 'svelte'`,
      ],
    ])

    const problem = validateFrontendCapabilityRouting(files, projects, sources, [
      'src/legacy.test.ts',
      'src/legacy.test.ts',
      'src/stale.test.ts',
      'src/component.svelte.test.ts',
    ])

    expect(problem.unclassified).toEqual([expect.stringContaining('src/unclassified.spec.ts')])
    expect(problem.mismatched).toEqual([
      'src/component.svelte.test.ts (filename/registration=frontend-dom, discovered=frontend-node)',
    ])
    expect(problem.duplicateRegistrations).toEqual(['src/legacy.test.ts (2 entries)'])
    expect(problem.staleRegistrations).toEqual(['src/stale.test.ts'])
    expect(problem.redundantRegistrations).toEqual(['src/component.svelte.test.ts'])
    expect(problem.forbiddenCapabilityImports).toEqual([
      expect.stringContaining('src/pure.test.ts:1 imports a DOM capability in frontend-node'),
    ])
  })

  it('records final runtime ownership independently from supplemental static signals', () => {
    const node = createFrontendTestInventoryRow(
      'src/already-node.test.ts',
      'frontend-node',
      `document.createElement('div')`,
    )
    const svelteNode = createFrontendTestInventoryRow(
      'src/store.svelte.test.ts',
      'frontend-dom',
      `import { writable } from 'svelte/store'`,
    )
    const validatedSvelteNode = createFrontendTestInventoryRow(
      'src/validated-store.svelte.test.ts',
      'frontend-svelte-node',
      `import { writable } from 'svelte/store'`,
    )
    const dom = createFrontendTestInventoryRow(
      'src/component.svelte.test.ts',
      'frontend-dom',
      `import Component from './Component.svelte'\ndocument.body.textContent = ''`,
    )

    expect(node.targetClass).toBe('N')
    expect(svelteNode).toMatchObject({
      targetClass: 'D',
      confidence: 'high',
      ambiguityOrBlocker: '',
      reason: 'validated explicit Happy-DOM owner with probe-backed transitive browser requirements',
    })
    expect(validatedSvelteNode).toMatchObject({
      targetClass: 'S',
      confidence: 'high',
      ambiguityOrBlocker: '',
      reason: 'validated by the Svelte+Node project',
    })
    expect(dom).toMatchObject({ targetClass: 'D', confidence: 'high' })
  })

  it('formats a deterministic tab-separated review artifact', () => {
    const row = createFrontendTestInventoryRow('src/pure.test.ts', 'frontend-node', `import { value } from './pure'`)
    const output = formatFrontendTestInventory([row])

    expect(output).toMatch(/^file\tcurrentProject\ttargetClass\t/)
    expect(output).toContain('src/pure.test.ts\tfrontend-node\tN\thigh')
    expect(output.endsWith('\n')).toBe(true)
  })
})
