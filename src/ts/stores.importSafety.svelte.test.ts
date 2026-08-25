import { describe, expect, it, vi } from 'vitest'

const forbiddenEvaluations = vi.hoisted(() => [] as string[])

function forbiddenModule(name: string) {
  return () => {
    forbiddenEvaluations.push(name)
    return {}
  }
}

vi.mock('./storage/database.svelte', forbiddenModule('database'))
vi.mock('./process/scripts', forbiddenModule('scripts'))
vi.mock('./process/modules', forbiddenModule('modules'))
vi.mock('./characterCards', forbiddenModule('characterCards'))
vi.mock('./chatCommands', forbiddenModule('chatCommands'))
vi.mock('./server/resourceState.svelte', forbiddenModule('resourceState'))

describe('shell-safe store imports', () => {
  it('do not evaluate feature or persistence implementations', async () => {
    const [coreStores, compatibilityStores] = await Promise.all([
      import('./stores/coreStores.svelte'),
      import('./stores.svelte'),
    ])

    expect(forbiddenEvaluations).toEqual([])
    expect(compatibilityStores.LoadingStatusState).toBe(coreStores.LoadingStatusState)
    expect(compatibilityStores.selectedCharID).toBe(coreStores.selectedCharID)
    expect(compatibilityStores.selIdState).toBe(coreStores.selIdState)
    expect(compatibilityStores.alertStore).toBe(coreStores.alertStore)
  })
})
