import { describe, expect, it } from 'vitest'
import {
  frontendVitestProjectForFile,
  isolatedCompatibilityTestFiles,
  legacyDomTestFiles,
} from './vitest.frontend-routing.js'

describe('frontend Vitest filename routing', () => {
  it('makes plain tests Node-default and keeps every explicit suffix disjoint', () => {
    expect(frontendVitestProjectForFile('src/pure.test.ts', new Set())).toBe('frontend-node')
    expect(frontendVitestProjectForFile('src/state.svelte-node.test.ts', new Set())).toBe('frontend-svelte-node')
    expect(frontendVitestProjectForFile('src/Component.svelte.test.ts', new Set())).toBe('frontend-dom')
    expect(frontendVitestProjectForFile('src/browser.dom.test.ts', new Set())).toBe('frontend-dom')
    expect(frontendVitestProjectForFile('src/unclassified.spec.ts', new Set())).toBeUndefined()
  })

  it('routes reviewed pre-suffix DOM owners through the explicit registration', () => {
    const registered = legacyDomTestFiles[0]

    expect(frontendVitestProjectForFile(registered)).toBe('frontend-dom')
    expect(frontendVitestProjectForFile(registered, new Set())).toBe('frontend-node')
  })

  it('leaves baseline-only compatibility suites to their pinned custom project', () => {
    expect(frontendVitestProjectForFile(isolatedCompatibilityTestFiles[0])).toBeUndefined()
  })
})
