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
  currentPersonaStateSnapshot,
  deleteSelectedUserPersona,
  flushPendingSelectedPersonaUpdate,
  queueSelectedPersonaUpdate,
  reconcileSelectedPersonaProjectionEpoch,
  reorderUserPersonasByIndices,
  selectedPersonaId,
  updateSelectedPersonaField,
  updateSelectedPersonaLargePortrait,
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

function applySelectedPersonaProjection(
  persona: Record<string, unknown>,
  legacy: Partial<{
    username: string
    userIcon: string
    personaPrompt: string
    userNote: string
  }> = {},
): void {
  DBState.db.personas[DBState.db.selectedPersona] = {
    ...DBState.db.personas[DBState.db.selectedPersona],
    ...persona,
  } as any
  if ('username' in legacy) DBState.db.username = legacy.username as string
  if ('userIcon' in legacy) DBState.db.userIcon = legacy.userIcon as string
  if ('personaPrompt' in legacy) DBState.db.personaPrompt = legacy.personaPrompt as string
  if ('userNote' in legacy) DBState.db.userNote = legacy.userNote as string
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
  it('mirrors selected text fields into the selected persona row immediately', () => {
    seedPersonaState(
      [
        makePersona({
          id: 'persona-a',
          name: 'Old Name',
          icon: 'icon-a.png',
          personaPrompt: 'Old prompt',
          note: 'Old note',
        }),
        makePersona({
          id: 'persona-b',
          name: 'Other Name',
          personaPrompt: 'Other prompt',
          note: 'Other note',
        }),
      ],
      0,
    )

    updateSelectedPersonaField('username', 'Fresh Name')
    updateSelectedPersonaField('userNote', 'Fresh note')
    updateSelectedPersonaField('personaPrompt', 'Fresh prompt')

    expect(DBState.db.username).toBe('Fresh Name')
    expect(DBState.db.userNote).toBe('Fresh note')
    expect(DBState.db.personaPrompt).toBe('Fresh prompt')
    expect(DBState.db.personas[0]).toMatchObject({
      id: 'persona-a',
      name: 'Fresh Name',
      icon: 'icon-a.png',
      personaPrompt: 'Fresh prompt',
      note: 'Fresh note',
    })
    expect(DBState.db.personas[1]).toMatchObject({
      id: 'persona-b',
      name: 'Other Name',
      personaPrompt: 'Other prompt',
      note: 'Other note',
    })
  })

  it('flushes a debounced selected persona save and preserves queued rollback behavior', async () => {
    seedPersonaState(
      [
        makePersona({
          id: 'persona-a',
          name: 'Old Name',
          personaPrompt: 'Old prompt',
          note: 'Old note',
        }),
      ],
      0,
    )
    const previous = currentPersonaStateSnapshot()
    updateSelectedPersonaField('personaPrompt', 'Unsaved prompt')
    const attempted = currentPersonaStateSnapshot()
    queueSelectedPersonaUpdate(previous, attempted)

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ revision: 1 }), {
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'persona save failed' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const result = await flushPendingSelectedPersonaUpdate()

    expect(result).toEqual({ status: 'error', error: 'persona save failed' })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(currentPersonaStateSnapshot()).toEqual(previous)
  })

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

describe('selected persona dirty projection reconciliation', () => {
  it('preserves dirty selected profile fields through a stale projection while clean row fields refresh', () => {
    seedPersonaState(
      [
        makePersona({
          id: 'persona-dirty-profile',
          name: 'Old Name',
          icon: 'old-icon.png',
          personaPrompt: 'Old prompt',
          note: 'Old note',
          largePortrait: false,
        }),
      ],
      0,
    )

    updateSelectedPersonaField('username', 'Local Name')
    updateSelectedPersonaField('personaPrompt', 'Local prompt')
    updateSelectedPersonaField('userNote', 'Local note')

    applySelectedPersonaProjection(
      {
        id: 'persona-dirty-profile',
        name: 'Stale Name',
        icon: 'fresh-icon.png',
        personaPrompt: 'Stale prompt',
        note: 'Stale note',
        largePortrait: true,
      },
      {
        username: 'Stale Name',
        userIcon: 'fresh-icon.png',
        personaPrompt: 'Stale prompt',
        userNote: 'Stale note',
      },
    )

    reconcileSelectedPersonaProjectionEpoch()

    expect(DBState.db.username).toBe('Local Name')
    expect(DBState.db.personaPrompt).toBe('Local prompt')
    expect(DBState.db.userNote).toBe('Local note')
    expect(DBState.db.userIcon).toBe('fresh-icon.png')
    expect(DBState.db.personas[0]).toMatchObject({
      id: 'persona-dirty-profile',
      name: 'Local Name',
      icon: 'fresh-icon.png',
      personaPrompt: 'Local prompt',
      note: 'Local note',
      largePortrait: true,
    })
  })

  it('reasserts still-dirty values into both legacy fields and the selected persona row', () => {
    seedPersonaState(
      [
        makePersona({
          id: 'persona-reassert-profile',
          name: 'Old Name',
          personaPrompt: 'Old prompt',
          note: 'Old note',
        }),
      ],
      0,
    )

    updateSelectedPersonaField('username', 'Local Name')
    updateSelectedPersonaField('personaPrompt', 'Local prompt')
    updateSelectedPersonaField('userNote', 'Local note')
    applySelectedPersonaProjection(
      {
        id: 'persona-reassert-profile',
        name: 'Server Name',
        personaPrompt: 'Server prompt',
        note: 'Server note',
      },
      {
        username: 'Server Name',
        personaPrompt: 'Server prompt',
        userNote: 'Server note',
      },
    )

    reconcileSelectedPersonaProjectionEpoch()

    expect(DBState.db).toMatchObject({
      username: 'Local Name',
      personaPrompt: 'Local prompt',
      userNote: 'Local note',
    })
    expect(DBState.db.personas[0]).toMatchObject({
      name: 'Local Name',
      personaPrompt: 'Local prompt',
      note: 'Local note',
    })
  })

  it('clears dirty profile state once projection matches, then lets later clean projections update normally', () => {
    seedPersonaState(
      [
        makePersona({
          id: 'persona-clear-profile',
          name: 'Old Name',
          personaPrompt: 'Old prompt',
          note: 'Old note',
        }),
      ],
      0,
    )

    updateSelectedPersonaField('username', 'Local Name')
    applySelectedPersonaProjection(
      {
        id: 'persona-clear-profile',
        name: 'Local Name',
      },
      {
        username: 'Local Name',
      },
    )
    reconcileSelectedPersonaProjectionEpoch()

    applySelectedPersonaProjection(
      {
        id: 'persona-clear-profile',
        name: 'Clean Server Name',
      },
      {
        username: 'Clean Server Name',
      },
    )
    reconcileSelectedPersonaProjectionEpoch()

    expect(DBState.db.username).toBe('Clean Server Name')
    expect(DBState.db.personas[0].name).toBe('Clean Server Name')
  })

  it('protects dirty largePortrait as a selected-row-only field and clears after projection catches up', () => {
    seedPersonaState(
      [
        makePersona({
          id: 'persona-large-portrait',
          name: 'Old Name',
          largePortrait: false,
        }),
      ],
      0,
    )

    updateSelectedPersonaLargePortrait(true)
    applySelectedPersonaProjection({
      id: 'persona-large-portrait',
      name: 'Fresh server name',
      largePortrait: false,
    })
    reconcileSelectedPersonaProjectionEpoch()

    expect(DBState.db.personas[0]).toMatchObject({
      name: 'Fresh server name',
      largePortrait: true,
    })

    applySelectedPersonaProjection({
      id: 'persona-large-portrait',
      largePortrait: true,
    })
    reconcileSelectedPersonaProjectionEpoch()
    applySelectedPersonaProjection({
      id: 'persona-large-portrait',
      largePortrait: false,
    })
    reconcileSelectedPersonaProjectionEpoch()

    expect(DBState.db.personas[0].largePortrait).toBe(false)
  })
})
