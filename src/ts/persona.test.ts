import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'persona-command-token',
}))

import { clearCachedServerCommandRevision } from './server/commands'
import { setServerProjectionWriteGuardEnabled } from './server/projectionWriteGuard.svelte'
import { DBState } from './stores.svelte'
import {
  beginPersonaReorder,
  changeUserPersona,
  deleteSelectedUserPersona,
  reorderUserPersonasByIndices,
  selectedPersonaId,
} from './persona'

function cloneJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function makePersona(patch: Record<string, unknown>): Record<string, unknown> {
  return {
    name: 'Persona',
    icon: '',
    personaPrompt: '',
    note: '',
    ...patch,
  }
}

function seedPersonaState(personas: Array<Record<string, unknown>>, selectedPersona = 0): void {
  DBState.db = {
    characters: [],
    personas,
    selectedPersona,
    username: 'Unsaved User Name',
    userIcon: 'unsaved-user-icon.png',
    personaPrompt: 'Unsaved persona prompt',
    userNote: 'Unsaved user note',
  } as any
}

async function flushCommandEffects(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  clearCachedServerCommandRevision()
  setServerProjectionWriteGuardEnabled(false)
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      return new Response(JSON.stringify({ revision: 1, status: 'ok' }), {
        headers: { 'content-type': 'application/json' },
      })
    }),
  )
})

afterEach(() => {
  setServerProjectionWriteGuardEnabled(false)
  vi.unstubAllGlobals()
})

describe('persona ID read and command preparation', () => {
  it('selectedPersonaId returns null for missing and duplicate IDs without mutating the projection', () => {
    seedPersonaState([makePersona({ name: 'Missing ID' }), makePersona({ id: 'persona-b', name: 'B' })], 0)
    const missingBefore = cloneJsonValue(DBState.db)

    expect(selectedPersonaId()).toBeNull()
    expect(DBState.db).toEqual(missingBefore)

    seedPersonaState(
      [
        makePersona({ id: 'duplicate-persona', name: 'Duplicate A' }),
        makePersona({ id: 'duplicate-persona', name: 'Duplicate B' }),
      ],
      1,
    )
    const duplicateBefore = cloneJsonValue(DBState.db)

    expect(selectedPersonaId()).toBeNull()
    expect(DBState.db).toEqual(duplicateBefore)
  })

  it('does not assign IDs or save profile fields while preparing an invalid reorder', async () => {
    seedPersonaState([makePersona({ name: 'Missing ID' }), makePersona({ id: 'persona-b', name: 'B' })], 0)
    const before = cloneJsonValue(DBState.db)

    expect(beginPersonaReorder()).toBeNull()
    expect(reorderUserPersonasByIndices([1, 0], null)).toBe(false)
    await flushCommandEffects()

    expect(DBState.db).toEqual(before)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not assign duplicate IDs or delete locally when delete preparation cannot form command IDs', async () => {
    seedPersonaState(
      [
        makePersona({ id: 'duplicate-persona', name: 'Duplicate A' }),
        makePersona({ id: 'duplicate-persona', name: 'Duplicate B' }),
      ],
      0,
    )
    const before = cloneJsonValue(DBState.db)

    expect(deleteSelectedUserPersona()).toBe(false)
    await flushCommandEffects()

    expect(DBState.db).toEqual(before)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not assign duplicate IDs or change selection when select preparation cannot form command IDs', async () => {
    seedPersonaState(
      [
        makePersona({ id: 'duplicate-persona', name: 'Duplicate A' }),
        makePersona({ id: 'duplicate-persona', name: 'Duplicate B' }),
      ],
      0,
    )
    const before = cloneJsonValue(DBState.db)

    changeUserPersona(1)
    await flushCommandEffects()

    expect(DBState.db).toEqual(before)
    expect(fetch).not.toHaveBeenCalled()
  })
})
