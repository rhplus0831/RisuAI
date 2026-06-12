import { describe, expect, it } from 'vitest'
import { flushSync } from 'svelte'

import { readModuleUpdateSignals, type ModuleUpdateSignalSource } from './stores.svelte'
import { withCloneInstrumentation } from './__tests__/cloneCostHarness'

// Module update signals read only the fields consumed by moduleUpdate().

interface TestModule extends ModuleUpdateSignalSource {
  name: string
  lorebook: { key: string; content: string }[]
}

function makeModules(): TestModule[] {
  return [
    {
      id: 'mod-a',
      name: 'Module A',
      hideIcon: false,
      backgroundEmbedding: '',
      lorebook: [{ key: 'a', content: 'A'.repeat(2000) }],
    },
    {
      id: 'mod-b',
      name: 'Module B',
      hideIcon: false,
      backgroundEmbedding: '',
      lorebook: [{ key: 'b', content: 'B'.repeat(2000) }],
    },
  ]
}

describe('L33 modules $effect dependency read', () => {
  it('L33: reading the update signals performs zero clone-primitive calls', () => {
    const modules = makeModules()
    const instrumented = withCloneInstrumentation(() => readModuleUpdateSignals(modules))
    // `$state.snapshot` cloned the whole array here before; the signal read
    // allocates nothing and never serializes the modules graph.
    expect(instrumented.totalCloneCount).toBe(0)
  })

  it('L33: the effect re-runs on consumed fields but NOT on unrelated deep edits', () => {
    const state = $state({ modules: makeModules() })
    let runs = 0
    const stop = $effect.root(() => {
      $effect(() => {
        readModuleUpdateSignals(state.modules)
        runs += 1
      })
    })
    flushSync()
    expect(runs).toBe(1)

    // An unrelated deep edit (a lorebook entry) used to re-run the effect via
    // the $state.snapshot deep read; the narrowed signal read ignores it.
    state.modules[0].lorebook[0].content = 'changed'
    flushSync()
    expect(runs).toBe(1)

    // The fields moduleUpdate() actually consumes still re-run the effect.
    state.modules[0].hideIcon = true
    flushSync()
    expect(runs).toBe(2)

    state.modules[1].backgroundEmbedding = '<style>x</style>'
    flushSync()
    expect(runs).toBe(3)

    // Adds/removes re-run via the length read.
    state.modules.push({
      id: 'mod-c',
      name: 'Module C',
      hideIcon: false,
      backgroundEmbedding: '',
      lorebook: [],
    })
    flushSync()
    expect(runs).toBe(4)

    // A module id swap (enable/replace) re-runs via the id read.
    state.modules[2].id = 'mod-c2'
    flushSync()
    expect(runs).toBe(5)

    stop()
  })

  it('L33: tolerates an absent modules array', () => {
    expect(() => readModuleUpdateSignals(undefined)).not.toThrow()
  })
})
