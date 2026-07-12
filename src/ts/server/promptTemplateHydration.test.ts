import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PromptItem } from '../process/prompt'
import { testDatabaseState } from '../__tests__/resourceDatabaseState'

const projectionState = vi.hoisted(() => ({
  fetchResource: vi.fn(),
  canUse: true,
}))

vi.mock('./hydrationReads', () => ({
  fetchServerPromptPresetTemplate: projectionState.fetchResource,
}))

vi.mock('../process/modules', async (importActual) => {
  const actual = await importActual<typeof import('../process/modules')>()
  return { ...actual, moduleUpdate: vi.fn() }
})

import { mergeServerProjectionFields, setServerProjectionWriteGuardEnabled } from '../storage/database.svelte'
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
  ;(testDatabaseState as { db: unknown }).db = { characters: [], modules: [], enabledModules: [] }
  clearCachedServerCommandRevision()
  resetPromptTemplateHydration()
  projectionState.canUse = true
  projectionState.fetchResource.mockReset()
})

afterEach(() => {
  const database = JSON.parse(JSON.stringify(testDatabaseState.db))
  setServerProjectionWriteGuardEnabled(false)
  testDatabaseState.db = database
})

describe('promptTemplate hydration', () => {
  it('uses the top-level prompt template already loaded with settings', async () => {
    testDatabaseState.db.promptTemplate = [item('p-1', 'settings template')]
    setCachedServerCommandRevision(7)

    await expect(ensurePromptTemplateHydrated()).resolves.toBe(true)

    expect(projectionState.fetchResource).not.toHaveBeenCalled()
    expect(testDatabaseState.db.promptTemplate).toEqual([item('p-1', 'settings template')])
    expect(isPromptTemplateHydrated()).toBe(true)
    expect(peekCachedServerCommandRevision()).toBe(7)
  })

  it('does not invent a top-level template when settings omit it', async () => {
    setCachedServerCommandRevision(0)

    await expect(ensurePromptTemplateHydrated()).resolves.toBe(false)

    expect(projectionState.fetchResource).not.toHaveBeenCalled()
    expect(testDatabaseState.db.promptTemplate).toBeUndefined()
    expect(isPromptTemplateHydrated()).toBe(false)
  })

  it('coalesces concurrent hydration requests', async () => {
    ;(testDatabaseState as { db: unknown }).db = {
      promptPresetsId: 0,
      promptPresets: [{ id: 'preset-a', name: 'Preset A' }],
    }
    setCachedServerCommandRevision(1)
    const response = deferred<{
      status: 'ok'
      revision: number
      promptPresetId: string
      promptTemplate: PromptItem[]
    }>()
    projectionState.fetchResource.mockReturnValue(response.promise)

    const first = ensurePromptTemplateHydrated()
    const second = ensurePromptTemplateHydrated()
    response.resolve({
      status: 'ok',
      revision: 1,
      promptPresetId: 'preset-a',
      promptTemplate: [item('p-1', 'once')],
    })

    await expect(Promise.all([first, second])).resolves.toEqual([true, true])

    expect(projectionState.fetchResource).toHaveBeenCalledTimes(1)
    expect(testDatabaseState.db.promptTemplate).toEqual([item('p-1', 'once')])
  })

  it('accepts a hydration response after an unrelated projection advances the known revision', async () => {
    ;(testDatabaseState as { db: unknown }).db = {
      promptPresetsId: 0,
      promptPresets: [{ id: 'preset-a', name: 'Preset A' }],
    }
    setCachedServerCommandRevision(5)
    setServerProjectionWriteGuardEnabled(true)
    const response = deferred<{
      status: 'ok'
      revision: number
      promptPresetId: string
      promptTemplate: PromptItem[]
    }>()
    projectionState.fetchResource.mockReturnValue(response.promise)

    const pending = ensurePromptTemplateHydrated()
    setCachedServerCommandRevision(6)
    mergeServerProjectionFields({ language: 'ko' } as any)
    response.resolve({
      status: 'ok',
      revision: 5,
      promptPresetId: 'preset-a',
      promptTemplate: [item('p-current', 'current template')],
    })

    await expect(pending).resolves.toBe(true)

    expect(testDatabaseState.db.promptTemplate).toEqual([item('p-current', 'current template')])
    expect(testDatabaseState.db.language).toBe('ko')
    expect(isPromptTemplateHydrated()).toBe(true)
    expect(peekCachedServerCommandRevision()).toBe(6)
  })

  it('rejects a hydration response after the same prompt owner changes', async () => {
    setCachedServerCommandRevision(5)
    ;(testDatabaseState as { db: unknown }).db = {
      characters: [],
      modules: [],
      enabledModules: [],
      promptPresetsId: 0,
      promptPresets: [{ id: 'preset-a', name: 'Preset A' }],
    }
    setServerProjectionWriteGuardEnabled(true)
    const response = deferred<{
      status: 'ok'
      revision: number
      promptPresetId: string
      promptTemplate: PromptItem[]
    }>()
    projectionState.fetchResource.mockReturnValue(response.promise)

    const pending = ensurePromptTemplateHydrated()
    setCachedServerCommandRevision(6)
    mergeServerProjectionFields({
      promptPresets: [
        {
          id: 'preset-a',
          name: 'Preset A',
          promptTemplate: [item('p-newer', 'newer owner template')],
        },
      ],
    } as any)
    response.resolve({
      status: 'ok',
      revision: 5,
      promptPresetId: 'preset-a',
      promptTemplate: [item('p-stale', 'stale owner template')],
    })

    await expect(pending).resolves.toBe(false)

    expect(testDatabaseState.db.promptPresets[0].promptTemplate).toEqual([item('p-newer', 'newer owner template')])
    expect(testDatabaseState.db).not.toHaveProperty('promptTemplate')
  })

  it('rejects a hydration response older than the request-start revision', async () => {
    ;(testDatabaseState as { db: unknown }).db = {
      promptPresetsId: 0,
      promptPresets: [{ id: 'preset-a', name: 'Preset A' }],
    }
    setCachedServerCommandRevision(6)
    projectionState.fetchResource.mockResolvedValue({
      status: 'ok',
      revision: 5,
      promptPresetId: 'preset-a',
      promptTemplate: [item('p-old', 'older than request')],
    })

    await expect(ensurePromptTemplateHydrated()).resolves.toBe(false)

    expect(testDatabaseState.db).not.toHaveProperty('promptTemplate')
    expect(isPromptTemplateHydrated()).toBe(false)
  })

  it('fetches promptItem for the selected prompt preset owner', async () => {
    setCachedServerCommandRevision(7)
    ;(testDatabaseState as { db: unknown }).db = {
      promptPresetsId: 0,
      promptPresets: [{ id: 'preset-a', name: 'Preset A' }],
    }
    projectionState.fetchResource.mockResolvedValue({
      status: 'ok',
      revision: 7,
      promptPresetId: 'preset-a',
      promptTemplate: [item('preset-row', 'preset body')],
    })

    await expect(ensurePromptTemplateHydrated()).resolves.toBe(true)

    expect(projectionState.fetchResource).toHaveBeenCalledWith('preset-a')
    expect(testDatabaseState.db.promptTemplate).toEqual([item('preset-row', 'preset body')])
    expect(testDatabaseState.db.promptPresets[0].promptTemplate).toEqual([item('preset-row', 'preset body')])
  })

  it('hydrates an explicit non-current prompt preset owner without overwriting the visible projection', async () => {
    setCachedServerCommandRevision(7)
    ;(testDatabaseState as { db: unknown }).db = {
      promptTemplate: [item('global-row', 'global visible body')],
      promptPresetsId: 0,
      promptPresets: [
        { id: 'preset-global', name: 'Global Preset', promptTemplate: [item('global-row', 'global visible body')] },
        { id: 'preset-chat', name: 'Chat Preset' },
      ],
    }
    projectionState.fetchResource.mockResolvedValue({
      status: 'ok',
      revision: 7,
      promptPresetId: 'preset-chat',
      promptTemplate: [item('chat-row', 'chat body')],
    })

    await expect(ensurePromptTemplateHydrated({ promptPresetId: 'preset-chat', applyProjection: false })).resolves.toBe(
      true,
    )

    expect(projectionState.fetchResource).toHaveBeenCalledWith('preset-chat')
    expect(testDatabaseState.db.promptPresets[1].promptTemplate).toEqual([item('chat-row', 'chat body')])
    expect(testDatabaseState.db.promptTemplate).toEqual([item('global-row', 'global visible body')])
    expect(isPromptTemplateHydrated('preset-chat')).toBe(true)
    expect(isPromptTemplateHydrated('preset-global')).toBe(false)
  })

  it('ignores a selected-owner hydration response after the selection changes', async () => {
    setCachedServerCommandRevision(7)
    ;(testDatabaseState as { db: unknown }).db = {
      promptPresetsId: 0,
      promptPresets: [
        { id: 'preset-a', name: 'Preset A' },
        { id: 'preset-b', name: 'Preset B' },
      ],
    }
    const response = deferred<{
      status: 'ok'
      revision: number
      promptPresetId: string
      promptTemplate: PromptItem[]
    }>()
    projectionState.fetchResource.mockReturnValue(response.promise)

    const pending = ensurePromptTemplateHydrated()
    testDatabaseState.db.promptPresetsId = 1
    response.resolve({
      status: 'ok',
      revision: 7,
      promptPresetId: 'preset-a',
      promptTemplate: [item('preset-a-row', 'stale owner')],
    })

    await expect(pending).resolves.toBe(false)
    expect(testDatabaseState.db).not.toHaveProperty('promptTemplate')
  })

  it('clears stale compatibility promptTemplate when the selected preset has no promptTemplate', async () => {
    setCachedServerCommandRevision(7)
    ;(testDatabaseState as { db: unknown }).db = {
      characters: [],
      promptTemplate: [item('stale', 'stale compatibility body')],
      promptPresetsId: 0,
      promptPresets: [{ id: 'preset-a', name: 'Preset A' }],
    }
    projectionState.fetchResource.mockResolvedValue({
      status: 'ok',
      revision: 7,
      promptPresetId: 'preset-a',
      promptTemplate: null,
    })

    setServerProjectionWriteGuardEnabled(true)
    try {
      await expect(ensurePromptTemplateHydrated({ force: true })).resolves.toBe(true)

      expect(testDatabaseState.db.promptTemplate).toBeUndefined()
      expect(isPromptTemplateHydrated()).toBe(true)
      expect(() => {
        testDatabaseState.db.promptTemplate = []
      }).toThrow('The resource database compatibility view is read-only')
      expect(() => {
        delete testDatabaseState.db.promptTemplate
      }).toThrow('The resource database compatibility view is read-only')
    } finally {
      setServerProjectionWriteGuardEnabled(false)
    }
  })
})
