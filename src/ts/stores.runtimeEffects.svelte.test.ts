import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushSync } from 'svelte'

const runtimeEffectState = vi.hoisted(() => ({
  database: {
    characters: [] as unknown[],
    modules: [] as unknown[],
    enabledModules: [] as string[],
    promptPresets: [] as unknown[],
    agentPresets: [] as unknown[],
    agentPresetDefaultId: '',
    moduleIntergration: '',
  },
  moduleUpdate: vi.fn(),
}))

vi.mock('./process/modules', () => ({
  moduleUpdate: runtimeEffectState.moduleUpdate,
}))

vi.mock('./server/resourceState.svelte', () => ({
  getResourceDatabase: () => runtimeEffectState.database,
}))

import { selectedCharID, selIdState } from './stores/coreStores.svelte'
import { installStoreRuntimeEffects } from './stores/runtimeEffects.svelte'

let dispose: (() => void) | undefined

beforeEach(() => {
  runtimeEffectState.moduleUpdate.mockClear()
  selectedCharID.set(-1)
  selIdState.selId = -1
})

afterEach(() => {
  dispose?.()
  dispose = undefined
})

describe('store runtime effects', () => {
  it('install once, synchronize selection, and dispose cleanly', () => {
    dispose = installStoreRuntimeEffects()
    expect(installStoreRuntimeEffects()).toBe(dispose)

    flushSync()
    expect(runtimeEffectState.moduleUpdate).toHaveBeenCalledTimes(1)

    selectedCharID.set(2)
    flushSync()
    expect(selIdState.selId).toBe(2)
    expect(runtimeEffectState.moduleUpdate).toHaveBeenCalledTimes(2)

    dispose()
    runtimeEffectState.moduleUpdate.mockClear()
    selectedCharID.set(3)
    flushSync()
    expect(selIdState.selId).toBe(3)
    expect(runtimeEffectState.moduleUpdate).not.toHaveBeenCalled()

    dispose = installStoreRuntimeEffects()
    flushSync()
    expect(selIdState.selId).toBe(3)
    expect(runtimeEffectState.moduleUpdate).toHaveBeenCalledTimes(1)
  })
})
