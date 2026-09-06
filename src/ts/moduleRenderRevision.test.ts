import { get } from 'svelte/store'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  captureModuleRenderRevision,
  invalidateModuleRenderRevision,
  moduleRenderRevision,
  resetModuleRenderRevisionForTests,
} from './moduleRenderRevision'

beforeEach(() => {
  resetModuleRenderRevisionForTests()
})

describe('module render revision', () => {
  it('advances one compact reactive revision for each invalidation', () => {
    expect(captureModuleRenderRevision()).toBe(0)
    expect(get(moduleRenderRevision)).toBe(0)

    expect(invalidateModuleRenderRevision()).toBe(1)
    expect(captureModuleRenderRevision()).toBe(1)
    expect(get(moduleRenderRevision)).toBe(1)

    expect(invalidateModuleRenderRevision()).toBe(2)
    expect(captureModuleRenderRevision()).toBe(2)
    expect(get(moduleRenderRevision)).toBe(2)
  })
})
