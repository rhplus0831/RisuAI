import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PromptItem } from '../process/prompt'

const projectionState = vi.hoisted(() => ({
  fetchResource: vi.fn(),
  canUse: true,
}))

vi.mock('./projection', () => ({
  canUseServerProjection: () => projectionState.canUse,
  fetchServerProjectionResource: projectionState.fetchResource,
}))

import { DBState } from '../stores.svelte'
import { setServerProjectionWriteGuardEnabled } from '../storage/database.svelte'
import {
  clearCachedServerCommandRevision,
  peekCachedServerCommandRevision,
  setCachedServerCommandRevision,
} from './commands'
import {
  ensurePromptTemplateHydrated,
  isPromptTemplateHydrated,
  resetPromptTemplateHydration,
} from './promptTemplateHydration'

function item(id: string, text: string): PromptItem {
  return { id, type: 'plain', type2: 'normal', role: 'system', text } as PromptItem
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve
  })
  return { promise, resolve }
}

beforeEach(() => {
  setServerProjectionWriteGuardEnabled(false)
  ;(DBState as { db: unknown }).db = {}
  clearCachedServerCommandRevision()
  resetPromptTemplateHydration()
  projectionState.canUse = true
  projectionState.fetchResource.mockReset()
})

describe('promptTemplate hydration', () => {
  it('fetches promptItem, merges promptTemplate, and leaves the cached command revision unchanged', async () => {
    setCachedServerCommandRevision(7)
    projectionState.fetchResource.mockResolvedValue({
      status: 'ok',
      revision: 9,
      mode: 'fields',
      fields: { promptTemplate: [item('p-1', 'hydrated template')] },
    })

    await expect(ensurePromptTemplateHydrated()).resolves.toBe(true)

    expect(projectionState.fetchResource).toHaveBeenCalledWith('promptItem')
    expect(DBState.db.promptTemplate).toEqual([item('p-1', 'hydrated template')])
    expect(isPromptTemplateHydrated()).toBe(true)
    expect(peekCachedServerCommandRevision()).toBe(7)
  })

  it('marks an absent promptTemplate projection as hydrated without creating an empty template', async () => {
    setCachedServerCommandRevision(0)
    projectionState.fetchResource.mockResolvedValue({
      status: 'ok',
      revision: 0,
      mode: 'fields',
      fields: {},
    })

    await expect(ensurePromptTemplateHydrated()).resolves.toBe(true)

    expect(DBState.db).not.toHaveProperty('promptTemplate')
    expect(isPromptTemplateHydrated()).toBe(true)
  })

  it('coalesces concurrent hydration requests', async () => {
    setCachedServerCommandRevision(1)
    const response = deferred<{
      status: 'ok'
      revision: number
      mode: 'fields'
      fields: { promptTemplate: PromptItem[] }
    }>()
    projectionState.fetchResource.mockReturnValue(response.promise)

    const first = ensurePromptTemplateHydrated()
    const second = ensurePromptTemplateHydrated()
    response.resolve({
      status: 'ok',
      revision: 1,
      mode: 'fields',
      fields: { promptTemplate: [item('p-1', 'once')] },
    })

    await expect(Promise.all([first, second])).resolves.toEqual([true, true])

    expect(projectionState.fetchResource).toHaveBeenCalledTimes(1)
    expect(DBState.db.promptTemplate).toEqual([item('p-1', 'once')])
  })

  it('ignores a hydration response older than the current cached command revision', async () => {
    setCachedServerCommandRevision(5)
    const response = deferred<{
      status: 'ok'
      revision: number
      mode: 'fields'
      fields: { promptTemplate: PromptItem[] }
    }>()
    projectionState.fetchResource.mockReturnValue(response.promise)

    const pending = ensurePromptTemplateHydrated()
    setCachedServerCommandRevision(6)
    response.resolve({
      status: 'ok',
      revision: 5,
      mode: 'fields',
      fields: { promptTemplate: [item('p-old', 'old template')] },
    })

    await expect(pending).resolves.toBe(false)

    expect(DBState.db).not.toHaveProperty('promptTemplate')
    expect(isPromptTemplateHydrated()).toBe(false)
  })
})
