import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'persona-command-token',
}))

import { clearCachedServerCommandRevision } from './server/commands'
import { setResourceWriteGuardEnabled } from './server/resourceWriteGuard.svelte'
import './stores.svelte'
import { getDatabase, setDatabaseLite } from './storage/database.svelte'
import {
  beginPersonaReorder,
  changeUserPersona,
  createNewUserPersona,
  currentPersonaStateSnapshot,
  deleteSelectedUserPersona,
  flushPendingSelectedPersonaUpdate,
  queueSelectedPersonaUpdate,
  reconcileSelectedPersonaProjectionEpoch,
  reorderUserPersonasByIndices,
  saveUserPersona,
  selectedPersonaId,
  setSelectedPersonaPromptFromTrigger,
  updateSelectedPersonaDisplayName,
  updateSelectedPersonaField,
  updateSelectedPersonaLargePortrait,
} from './persona'

function cloneJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (error?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
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
  setDatabaseLite({
    characters: [],
    personas,
    selectedPersona,
    username: 'Unsaved User Name',
    userIcon: 'unsaved-user-icon.png',
    personaPrompt: 'Unsaved persona prompt',
    userNote: 'Unsaved user note',
  } as any)
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
  getDatabase().personas[getDatabase().selectedPersona] = {
    ...getDatabase().personas[getDatabase().selectedPersona],
    ...persona,
  } as any
  if ('username' in legacy) getDatabase().username = legacy.username as string
  if ('userIcon' in legacy) getDatabase().userIcon = legacy.userIcon as string
  if ('personaPrompt' in legacy) getDatabase().personaPrompt = legacy.personaPrompt as string
  if ('userNote' in legacy) getDatabase().userNote = legacy.userNote as string
}

async function flushCommandEffects(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function mockNextCommandFailure(error = 'persona command failed'): void {
  vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ revision: 1 }))
  vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ error }, 500))
}

function mockNextDeferredCommandFailure(error = 'persona command failed') {
  const command = deferred<Response>()
  vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ revision: 1 }))
  vi.mocked(fetch).mockReturnValueOnce(command.promise)
  return {
    resolve: () => command.resolve(jsonResponse({ error }, 500)),
  }
}

beforeEach(() => {
  clearCachedServerCommandRevision()
  setResourceWriteGuardEnabled(false)
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
  setResourceWriteGuardEnabled(false)
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

    expect(getDatabase().username).toBe('Fresh Name')
    expect(getDatabase().userNote).toBe('Fresh note')
    expect(getDatabase().personaPrompt).toBe('Fresh prompt')
    expect(getDatabase().personas[0]).toMatchObject({
      id: 'persona-a',
      name: 'Fresh Name',
      icon: 'icon-a.png',
      personaPrompt: 'Fresh prompt',
      note: 'Fresh note',
    })
    expect(getDatabase().personas[1]).toMatchObject({
      id: 'persona-b',
      name: 'Other Name',
      personaPrompt: 'Other prompt',
      note: 'Other note',
    })
  })

  it('updates display name as a selected persona row field without changing the internal username', () => {
    seedPersonaState(
      [
        makePersona({
          id: 'persona-a',
          name: 'Internal Name',
          displayName: '',
          personaPrompt: 'Prompt',
          note: 'Note',
        }),
      ],
      0,
    )
    getDatabase().username = 'Internal Name'

    updateSelectedPersonaDisplayName('Visible Name')

    expect(getDatabase().username).toBe('Internal Name')
    expect(getDatabase().personas[0]).toMatchObject({
      id: 'persona-a',
      name: 'Internal Name',
      displayName: 'Visible Name',
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
    updateSelectedPersonaDisplayName('Unsaved display name')
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
    const updateBody = JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body))

    expect(result).toEqual({ status: 'error', error: 'persona save failed' })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(updateBody.patch).toEqual({
      displayName: 'Unsaved display name',
      personaPrompt: 'Unsaved prompt',
    })
    expect(currentPersonaStateSnapshot()).toEqual(previous)
  })

  it('drops a coalesced persona edit that returns to its baseline before dispatch', async () => {
    seedPersonaState(
      [
        makePersona({
          id: 'persona-a',
          name: 'Persona A',
          personaPrompt: 'Baseline prompt',
        }),
      ],
      0,
    )
    getDatabase().personaPrompt = 'Baseline prompt'
    const previous = currentPersonaStateSnapshot()

    updateSelectedPersonaField('personaPrompt', 'Temporary prompt')
    queueSelectedPersonaUpdate(previous, currentPersonaStateSnapshot())
    updateSelectedPersonaField('personaPrompt', 'Baseline prompt')
    queueSelectedPersonaUpdate(previous, currentPersonaStateSnapshot())

    await flushPendingSelectedPersonaUpdate()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('failed queued selected persona save preserves newer sibling edits and selection/profile changes', async () => {
    seedPersonaState(
      [
        makePersona({
          id: 'persona-a',
          name: 'Persona A',
          icon: 'a.png',
          personaPrompt: 'Old prompt',
          note: 'Old note',
        }),
        makePersona({
          id: 'persona-b',
          name: 'Persona B',
          icon: 'b.png',
          personaPrompt: 'B prompt',
          note: 'B note',
        }),
      ],
      0,
    )
    getDatabase().username = 'Persona A'
    getDatabase().userIcon = 'a.png'
    getDatabase().personaPrompt = 'Old prompt'
    getDatabase().userNote = 'Old note'
    const previous = currentPersonaStateSnapshot()
    updateSelectedPersonaField('personaPrompt', 'Attempted prompt')
    const attempted = currentPersonaStateSnapshot()
    queueSelectedPersonaUpdate(previous, attempted)
    const failure = mockNextDeferredCommandFailure()

    const resultPromise = flushPendingSelectedPersonaUpdate()
    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(2)
    })

    getDatabase().personas[0] = {
      ...getDatabase().personas[0],
      name: 'Persona A edited after dispatch',
    } as any
    getDatabase().personas[1] = {
      ...getDatabase().personas[1],
      name: 'Persona B edited after dispatch',
    } as any
    getDatabase().selectedPersona = 1
    getDatabase().username = 'Persona B live name'
    getDatabase().userIcon = 'b-live.png'
    getDatabase().personaPrompt = 'Persona B live prompt'
    getDatabase().userNote = 'Persona B live note'
    failure.resolve()

    expect(await resultPromise).toEqual({ status: 'error', error: 'persona command failed' })
    expect(getDatabase().personas[0]).toMatchObject({
      id: 'persona-a',
      name: 'Persona A edited after dispatch',
      personaPrompt: 'Old prompt',
    })
    expect(getDatabase().personas[1]).toMatchObject({
      id: 'persona-b',
      name: 'Persona B edited after dispatch',
    })
    expect(getDatabase()).toMatchObject({
      selectedPersona: 1,
      username: 'Persona B live name',
      userIcon: 'b-live.png',
      personaPrompt: 'Persona B live prompt',
      userNote: 'Persona B live note',
    })
  })

  it('failed direct profile save rolls back only attempted selected-row fields', async () => {
    seedPersonaState(
      [
        makePersona({
          id: 'persona-a',
          name: 'Persona A row',
          icon: 'a-row.png',
          personaPrompt: 'A row prompt',
          note: 'A row note',
        }),
        makePersona({
          id: 'persona-b',
          name: 'Persona B',
          icon: 'b.png',
          personaPrompt: 'B prompt',
          note: 'B note',
        }),
      ],
      0,
    )
    getDatabase().username = 'Persona A draft'
    getDatabase().userIcon = 'a-draft.png'
    getDatabase().personaPrompt = 'A draft prompt'
    getDatabase().userNote = 'A draft note'
    const failure = mockNextDeferredCommandFailure()

    saveUserPersona()
    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(2)
    })

    getDatabase().personas[0] = {
      ...getDatabase().personas[0],
      note: 'Persona A newer note',
    } as any
    getDatabase().personas[1] = {
      ...getDatabase().personas[1],
      name: 'Persona B edited after dispatch',
    } as any
    getDatabase().selectedPersona = 1
    getDatabase().username = 'Persona B live name'
    getDatabase().userIcon = 'b-live.png'
    getDatabase().personaPrompt = 'Persona B live prompt'
    getDatabase().userNote = 'Persona B live note'
    failure.resolve()
    await flushCommandEffects()

    expect(getDatabase().personas[0]).toMatchObject({
      id: 'persona-a',
      name: 'Persona A row',
      icon: 'a-row.png',
      personaPrompt: 'A row prompt',
      note: 'Persona A newer note',
    })
    expect(getDatabase().personas[1]).toMatchObject({
      id: 'persona-b',
      name: 'Persona B edited after dispatch',
    })
    expect(getDatabase()).toMatchObject({
      selectedPersona: 1,
      username: 'Persona B live name',
      userIcon: 'b-live.png',
      personaPrompt: 'Persona B live prompt',
      userNote: 'Persona B live note',
    })
  })

  it('failed trigger prompt save preserves newer same-row profile edits', async () => {
    seedPersonaState(
      [
        makePersona({
          id: 'persona-a',
          name: 'Persona A',
          icon: 'a.png',
          personaPrompt: 'Old prompt',
          note: 'Old note',
        }),
      ],
      0,
    )
    getDatabase().username = 'Persona A'
    getDatabase().userIcon = 'a.png'
    getDatabase().personaPrompt = 'Old prompt'
    getDatabase().userNote = 'Old note'
    const failure = mockNextDeferredCommandFailure()

    setSelectedPersonaPromptFromTrigger('Trigger prompt')
    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(2)
    })

    updateSelectedPersonaField('username', 'Newer Persona A name')
    failure.resolve()
    await flushCommandEffects()

    expect(getDatabase()).toMatchObject({
      selectedPersona: 0,
      username: 'Newer Persona A name',
      userIcon: 'a.png',
      personaPrompt: 'Old prompt',
      userNote: 'Old note',
    })
    expect(getDatabase().personas[0]).toMatchObject({
      id: 'persona-a',
      name: 'Newer Persona A name',
      icon: 'a.png',
      personaPrompt: 'Old prompt',
      note: 'Old note',
    })
  })

  it('failed select preserves newer selection/profile changes while rolling back only the attempted save-current row', async () => {
    seedPersonaState(
      [
        makePersona({
          id: 'persona-a',
          name: 'Persona A row',
          icon: 'a-row.png',
          personaPrompt: 'A row prompt',
          note: 'A row note',
        }),
        makePersona({
          id: 'persona-b',
          name: 'Persona B',
          icon: 'b.png',
          personaPrompt: 'B prompt',
          note: 'B note',
        }),
        makePersona({
          id: 'persona-c',
          name: 'Persona C',
          icon: 'c.png',
          personaPrompt: 'C prompt',
          note: 'C note',
        }),
      ],
      0,
    )
    getDatabase().username = 'Persona A draft'
    getDatabase().userIcon = 'a-draft.png'
    getDatabase().personaPrompt = 'A draft prompt'
    getDatabase().userNote = 'A draft note'
    const failure = mockNextDeferredCommandFailure()

    changeUserPersona(1)
    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(2)
    })

    getDatabase().personas[1] = {
      ...getDatabase().personas[1],
      name: 'Persona B edited after dispatch',
    } as any
    getDatabase().selectedPersona = 2
    getDatabase().username = 'Persona C live name'
    getDatabase().userIcon = 'c-live.png'
    getDatabase().personaPrompt = 'Persona C live prompt'
    getDatabase().userNote = 'Persona C live note'
    failure.resolve()
    await flushCommandEffects()

    expect(getDatabase().personas[0]).toMatchObject({
      id: 'persona-a',
      name: 'Persona A row',
      icon: 'a-row.png',
      personaPrompt: 'A row prompt',
      note: 'A row note',
    })
    expect(getDatabase().personas[1]).toMatchObject({
      id: 'persona-b',
      name: 'Persona B edited after dispatch',
    })
    expect(getDatabase()).toMatchObject({
      selectedPersona: 2,
      username: 'Persona C live name',
      userIcon: 'c-live.png',
      personaPrompt: 'Persona C live prompt',
      userNote: 'Persona C live note',
    })
  })

  it('selectedPersonaId returns null for missing and duplicate IDs without mutating the projection', () => {
    seedPersonaState([makePersona({ name: 'Missing ID' }), makePersona({ id: 'persona-b', name: 'B' })], 0)
    const missingBefore = cloneJsonValue(getDatabase())

    expect(selectedPersonaId()).toBeNull()
    expect(getDatabase({ snapshot: true })).toEqual(missingBefore)

    seedPersonaState(
      [
        makePersona({ id: 'duplicate-persona', name: 'Duplicate A' }),
        makePersona({ id: 'duplicate-persona', name: 'Duplicate B' }),
      ],
      1,
    )
    const duplicateBefore = cloneJsonValue(getDatabase())

    expect(selectedPersonaId()).toBeNull()
    expect(getDatabase({ snapshot: true })).toEqual(duplicateBefore)
  })

  it('does not assign IDs or save profile fields while preparing an invalid reorder', async () => {
    seedPersonaState([makePersona({ name: 'Missing ID' }), makePersona({ id: 'persona-b', name: 'B' })], 0)
    const before = cloneJsonValue(getDatabase())

    expect(beginPersonaReorder()).toBeNull()
    expect(reorderUserPersonasByIndices([1, 0], null)).toBe(false)
    await flushCommandEffects()

    expect(getDatabase({ snapshot: true })).toEqual(before)
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
    const before = cloneJsonValue(getDatabase())

    expect(deleteSelectedUserPersona()).toBe(false)
    await flushCommandEffects()

    expect(getDatabase({ snapshot: true })).toEqual(before)
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
    const before = cloneJsonValue(getDatabase())

    changeUserPersona(1)
    await flushCommandEffects()

    expect(getDatabase({ snapshot: true })).toEqual(before)
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('persona collection rollback guards', () => {
  it('failed create removes only the still-attempted new persona and preserves newer sibling edit', async () => {
    seedPersonaState(
      [
        makePersona({
          id: 'persona-a',
          name: 'Persona A',
          icon: 'a.png',
          personaPrompt: 'Prompt A',
          note: 'Note A',
        }),
      ],
      0,
    )
    mockNextCommandFailure()

    createNewUserPersona()
    getDatabase().personas[0] = {
      ...getDatabase().personas[0],
      name: 'Persona A edited after dispatch',
    } as any
    await flushCommandEffects()

    expect(getDatabase().personas.map((persona) => persona.id)).toEqual(['persona-a'])
    expect(getDatabase().personas[0]).toMatchObject({
      id: 'persona-a',
      name: 'Persona A edited after dispatch',
    })
    expect(getDatabase()).toMatchObject({
      selectedPersona: 0,
      username: 'Unsaved User Name',
      userIcon: 'unsaved-user-icon.png',
      personaPrompt: 'Unsaved persona prompt',
      userNote: 'Unsaved user note',
    })
  })

  it('failed create does not remove the new persona if the row changed after dispatch', async () => {
    seedPersonaState(
      [
        makePersona({
          id: 'persona-a',
          name: 'Persona A',
        }),
      ],
      0,
    )
    mockNextCommandFailure()

    const created = createNewUserPersona()
    const createdIndex = getDatabase().personas.findIndex((persona) => persona.id === created.id)
    getDatabase().personas[createdIndex] = {
      ...getDatabase().personas[createdIndex],
      name: 'Edited New Persona',
    } as any
    await flushCommandEffects()

    expect(getDatabase().personas.map((persona) => persona.id)).toEqual(['persona-a', created.id])
    expect(getDatabase().personas[1]).toMatchObject({
      id: created.id,
      name: 'Edited New Persona',
    })
  })

  it('failed delete reinserts only the deleted persona while preserving newer remaining edits and appended personas', async () => {
    seedPersonaState(
      [
        makePersona({
          id: 'persona-a',
          name: 'Persona A',
          icon: 'a.png',
          personaPrompt: 'Prompt A',
          note: 'Note A',
        }),
        makePersona({
          id: 'persona-b',
          name: 'Persona B',
          icon: 'b.png',
          personaPrompt: 'Prompt B',
          note: 'Note B',
        }),
        makePersona({
          id: 'persona-c',
          name: 'Persona C',
          icon: 'c.png',
          personaPrompt: 'Prompt C',
          note: 'Note C',
        }),
      ],
      1,
    )
    getDatabase().username = 'Persona B'
    getDatabase().userIcon = 'b.png'
    getDatabase().personaPrompt = 'Prompt B'
    getDatabase().userNote = 'Note B'
    mockNextCommandFailure()

    expect(deleteSelectedUserPersona()).toBe(true)
    getDatabase().personas[1] = {
      ...getDatabase().personas[1],
      name: 'Persona C edited after dispatch',
    } as any
    getDatabase().personas.push(
      makePersona({
        id: 'persona-d',
        name: 'Persona D appended after dispatch',
      }) as any,
    )
    await flushCommandEffects()

    expect(getDatabase().personas.map((persona) => persona.id)).toEqual([
      'persona-a',
      'persona-b',
      'persona-c',
      'persona-d',
    ])
    expect(getDatabase().personas[1]).toMatchObject({
      id: 'persona-b',
      name: 'Persona B',
    })
    expect(getDatabase().personas[2]).toMatchObject({
      id: 'persona-c',
      name: 'Persona C edited after dispatch',
    })
    expect(getDatabase().personas[3]).toMatchObject({
      id: 'persona-d',
      name: 'Persona D appended after dispatch',
    })
    expect(getDatabase()).toMatchObject({
      selectedPersona: 1,
      username: 'Persona B',
      userIcon: 'b.png',
      personaPrompt: 'Prompt B',
      userNote: 'Note B',
    })
  })

  it('failed reorder restores the previous ID order while preserving newer row field edits', async () => {
    seedPersonaState(
      [
        makePersona({ id: 'persona-a', name: 'Persona A' }),
        makePersona({ id: 'persona-b', name: 'Persona B' }),
        makePersona({ id: 'persona-c', name: 'Persona C' }),
      ],
      1,
    )
    mockNextCommandFailure()

    expect(reorderUserPersonasByIndices([2, 0, 1], 'persona-b')).toBe(true)
    getDatabase().personas[0] = {
      ...getDatabase().personas[0],
      name: 'Persona C edited after dispatch',
    } as any
    await flushCommandEffects()

    expect(getDatabase().personas.map((persona) => persona.id)).toEqual(['persona-a', 'persona-b', 'persona-c'])
    expect(getDatabase().personas[2]).toMatchObject({
      id: 'persona-c',
      name: 'Persona C edited after dispatch',
    })
    expect(getDatabase().selectedPersona).toBe(1)
  })

  it('failed older reorder skips rollback when a newer reorder changed the live ID order', async () => {
    seedPersonaState(
      [
        makePersona({ id: 'persona-a', name: 'Persona A' }),
        makePersona({ id: 'persona-b', name: 'Persona B' }),
        makePersona({ id: 'persona-c', name: 'Persona C' }),
      ],
      1,
    )
    mockNextCommandFailure()

    expect(reorderUserPersonasByIndices([2, 0, 1], 'persona-b')).toBe(true)
    getDatabase().personas = [getDatabase().personas[2], getDatabase().personas[0], getDatabase().personas[1]]
    getDatabase().selectedPersona = 0
    await flushCommandEffects()

    expect(getDatabase().personas.map((persona) => persona.id)).toEqual(['persona-b', 'persona-c', 'persona-a'])
    expect(getDatabase().selectedPersona).toBe(0)
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

    expect(getDatabase().username).toBe('Local Name')
    expect(getDatabase().personaPrompt).toBe('Local prompt')
    expect(getDatabase().userNote).toBe('Local note')
    expect(getDatabase().userIcon).toBe('fresh-icon.png')
    expect(getDatabase().personas[0]).toMatchObject({
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

    expect(getDatabase()).toMatchObject({
      username: 'Local Name',
      personaPrompt: 'Local prompt',
      userNote: 'Local note',
    })
    expect(getDatabase().personas[0]).toMatchObject({
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

    expect(getDatabase().username).toBe('Clean Server Name')
    expect(getDatabase().personas[0].name).toBe('Clean Server Name')
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

    expect(getDatabase().personas[0]).toMatchObject({
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

    expect(getDatabase().personas[0].largePortrait).toBe(false)
  })
})
