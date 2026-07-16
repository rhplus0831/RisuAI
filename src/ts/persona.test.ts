import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { IDBFactory } from 'fake-indexeddb'

vi.mock('./storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'persona-command-token',
}))

import {
  clearCachedServerCommandRevision,
  notifyServerCommandLocalEffectApplied,
  runServerCommand,
  setCachedServerCommandRevision,
  setServerCommandSuccessReconciler,
  type ServerCommandLocalEffect,
} from './server/commands'
import { serializePersonaCollectionDigestInput, serializePersonaProfileDigestInput } from './personaMutationCertificate'
import { setResourceWriteGuardEnabled } from './server/resourceWriteGuard.svelte'
import { flushRegisteredPendingBridgePatches } from './server/pendingBridgeFlushRegistry'
import {
  beginPendingMutationDispatch,
  clearPendingMutationOutbox,
  listPendingMutations,
  preparePendingMutationOutbox,
  resetPendingMutationOutboxForTests,
} from './server/pendingMutationOutbox'
import { replayPendingMutations } from './server/pendingMutationReplay'
import {
  applyCollectionsResource,
  applySettingsResource,
  captureCollectionProjectionEpoch,
  captureSettingsProjectionEpoch,
  hasCollectionProjectionEpochChanged,
  hasSettingsProjectionEpochChanged,
  isCollectionAcknowledgementTainted,
  isSettingsAcknowledgementTainted,
} from './server/resourceState.svelte'
import './stores.svelte'
import { getDatabase, setDatabaseLite } from './storage/database.svelte'
import {
  beginPersonaReorder,
  changeUserPersona,
  createNewUserPersona,
  currentPersonaStateSnapshot,
  deleteSelectedUserPersona,
  flushPendingSelectedPersonaUpdate,
  personaMutationOptimisticAcknowledgement,
  queueSelectedPersonaUpdate,
  reconcileSelectedPersonaProjectionEpoch,
  reorderUserPersonasByIndices,
  saveUserPersona,
  selectedPersonaId,
  settleAcceptedPersonaPatchDirtyFields,
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

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
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
  // A queued no-op settles only after earlier fire-and-forget commands and their
  // reconciliation batch, avoiding timer-based guesses about async completion.
  await runServerCommand({
    command: async () => ({ status: 'unavailable' as const }),
  })
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
  setServerCommandSuccessReconciler(null)
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
  setServerCommandSuccessReconciler(null)
  setResourceWriteGuardEnabled(false)
  vi.unstubAllGlobals()
})

describe('persona ID read and command preparation', () => {
  it('builds exact optimistic proofs for structural persona mutations', () => {
    const personaA = makePersona({
      id: 'persona-a',
      name: 'A row',
      icon: 'a-row.png',
      personaPrompt: 'A row prompt',
      note: 'A row note',
    })
    const personaB = makePersona({
      id: 'persona-b',
      name: 'B',
      icon: 'b.png',
      personaPrompt: 'B prompt',
      note: 'B note',
    })
    const previous = {
      personas: [personaA, personaB],
      selectedPersona: 0,
      username: 'Edited A',
      userIcon: 'edited-a.png',
      personaPrompt: 'Edited A prompt',
      userNote: 'Edited A note',
    } as any
    const attempted = {
      personas: [
        {
          ...personaA,
          name: 'Edited A',
          icon: 'edited-a.png',
          personaPrompt: 'Edited A prompt',
          note: 'Edited A note',
        },
        personaB,
      ],
      selectedPersona: 1,
      username: 'B',
      userIcon: 'b.png',
      personaPrompt: 'B prompt',
      userNote: 'B note',
    } as any

    expect(
      personaMutationOptimisticAcknowledgement({
        operation: 'select',
        previous,
        attempted,
        mirrorLegacyProfile: true,
        saveCurrent: true,
        collectionProjectionEpoch: 7,
        settingsProjectionEpoch: 9,
      }),
    ).toEqual({
      operation: 'select',
      collectionProjectionEpoch: 7,
      settingsProjectionEpoch: 9,
      beforePersonaIds: ['persona-a', 'persona-b'],
      attemptedPersonaIds: ['persona-a', 'persona-b'],
      attemptedPersonas: attempted.personas,
      beforeSelectedPersonaId: 'persona-a',
      attemptedSelectedPersonaId: 'persona-b',
      collectionWritten: true,
      settingsWritten: true,
      legacyProfileProjectionExpected: true,
      attemptedLegacyProfile: {
        name: 'B',
        icon: 'b.png',
        personaPrompt: 'B prompt',
        note: 'B note',
      },
    })

    expect(
      personaMutationOptimisticAcknowledgement({
        operation: 'reorder',
        previous: { ...attempted, selectedPersona: 1 },
        attempted: { ...attempted, personas: [personaB, attempted.personas[0]], selectedPersona: 0 },
        mirrorLegacyProfile: false,
        saveCurrent: false,
        collectionProjectionEpoch: 8,
        settingsProjectionEpoch: 10,
      }),
    ).toMatchObject({
      operation: 'reorder',
      beforePersonaIds: ['persona-a', 'persona-b'],
      attemptedPersonaIds: ['persona-b', 'persona-a'],
      beforeSelectedPersonaId: 'persona-b',
      attemptedSelectedPersonaId: 'persona-b',
      collectionWritten: true,
      settingsWritten: true,
      legacyProfileProjectionExpected: false,
      attemptedLegacyProfile: null,
    })
  })

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
    expect(isCollectionAcknowledgementTainted('personas')).toBe(true)
    expect(isSettingsAcknowledgementTainted()).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(updateBody.patch).toEqual({
      displayName: 'Unsaved display name',
      personaPrompt: 'Unsaved prompt',
    })
    expect(currentPersonaStateSnapshot()).toEqual(previous)
  })

  it('flushes a debounced selected persona save with keepalive through the lifecycle registry', async () => {
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
    updateSelectedPersonaField('personaPrompt', 'Draft before pagehide')
    queueSelectedPersonaUpdate(previous, currentPersonaStateSnapshot())

    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ revision: 1 }))
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        revision: 2,
        event: { type: 'persona.updated', revision: 2, resource: 'persona', id: 'persona-a' },
        personaId: 'persona-a',
        acknowledgedKeys: ['personaPrompt'],
        legacyProfileProjectionApplied: true,
      }),
    )

    flushRegisteredPendingBridgePatches({ keepalive: true })
    await flushPendingSelectedPersonaUpdate()

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(vi.mocked(fetch).mock.calls[0]?.[1]).toMatchObject({ keepalive: true })
    expect(vi.mocked(fetch).mock.calls[1]?.[1]).toMatchObject({ keepalive: true })
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1]?.[1]?.body))).toMatchObject({
      patch: { personaPrompt: 'Draft before pagehide' },
    })
  })

  it('stages the exact persona PATCH and binds the request to its durable database lineage', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-persona',
      writerEpoch: 3,
      databaseLineage: 'lineage-persona',
      requestedWriterWasActive: true,
    })
    seedPersonaState(
      [
        makePersona({
          id: 'persona-durable',
          name: 'Durable Persona',
          personaPrompt: 'Old prompt',
          note: 'Old note',
        }),
      ],
      0,
    )
    const previous = currentPersonaStateSnapshot()
    updateSelectedPersonaField('personaPrompt', 'Crash-safe prompt')
    queueSelectedPersonaUpdate(previous, currentPersonaStateSnapshot())

    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input)
      if (url === '/api/v1/bootstrap') return jsonResponse({ revision: 1 })
      if (url === '/api/v1/commands/personas/persona-durable') {
        return jsonResponse({
          revision: 2,
          event: { type: 'persona.updated', revision: 2, resource: 'persona', id: 'persona-durable' },
          personaId: 'persona-durable',
          acknowledgedKeys: ['personaPrompt'],
          legacyProfileProjectionApplied: true,
        })
      }
      if (url === '/api/v1/commands/mutation-receipts/ack') return jsonResponse({ acknowledged: true })
      return jsonResponse({ error: `unexpected ${url}` }, 404)
    })

    try {
      await expect(flushPendingSelectedPersonaUpdate()).resolves.toMatchObject({ status: 'ok' })

      const commandCall = vi
        .mocked(fetch)
        .mock.calls.find(([input]) => String(input) === '/api/v1/commands/personas/persona-durable')
      const headers = commandCall?.[1]?.headers as Record<string, string>
      expect(headers['risu-mutation-id']).toMatch(/^[a-zA-Z0-9._:-]+$/)
      expect(headers['risu-database-lineage']).toBe('lineage-persona')
      expect(JSON.parse(String(commandCall?.[1]?.body))).toEqual({
        baseRevision: 1,
        patch: { personaPrompt: 'Crash-safe prompt' },
        mirrorLegacyProfile: true,
      })
    } finally {
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
    }
  })

  it('enqueues a debounced persona PATCH before a structural selection', async () => {
    seedPersonaState(
      [
        makePersona({
          id: 'persona-a',
          name: 'Persona A',
          icon: 'a.png',
          personaPrompt: 'A prompt',
          note: 'A note',
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
    getDatabase().personaPrompt = 'A prompt'
    getDatabase().userNote = 'A note'
    const previous = currentPersonaStateSnapshot()
    updateSelectedPersonaField('personaPrompt', 'Edited A prompt')
    queueSelectedPersonaUpdate(previous, currentPersonaStateSnapshot())

    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input)
      if (url === '/api/v1/bootstrap') return jsonResponse({ revision: 1 })
      if (url === '/api/v1/commands/personas/persona-a') {
        return jsonResponse({
          revision: 2,
          event: { type: 'persona.updated', revision: 2, resource: 'persona', id: 'persona-a' },
          personaId: 'persona-a',
          acknowledgedKeys: ['personaPrompt'],
          legacyProfileProjectionApplied: true,
        })
      }
      if (url === '/api/v1/commands/personas/select') {
        return jsonResponse({
          revision: 3,
          event: { type: 'persona.selected', revision: 3, resource: 'persona', id: 'persona-b' },
          personaId: 'persona-b',
        })
      }
      return jsonResponse({ error: `unexpected ${url}` }, 404)
    })

    changeUserPersona(1)

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3))
    expect(vi.mocked(fetch).mock.calls.map(([input]) => String(input))).toEqual([
      '/api/v1/bootstrap',
      '/api/v1/commands/personas/persona-a',
      '/api/v1/commands/personas/select',
    ])
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body))).toMatchObject({
      baseRevision: 1,
      patch: { personaPrompt: 'Edited A prompt' },
    })
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[2][1]?.body))).toMatchObject({
      baseRevision: 2,
      personaId: 'persona-b',
      saveCurrent: true,
    })
    await flushCommandEffects()
  })

  it('orders a pending persona PATCH before deletion and settles the accepted dirty edit', async () => {
    const personaA = makePersona({
      id: 'persona-delete-a',
      name: 'Persona A',
      icon: 'a.png',
      personaPrompt: 'A prompt',
      note: 'A note',
    })
    const personaB = makePersona({
      id: 'persona-delete-b',
      name: 'Persona B',
      icon: 'b.png',
      personaPrompt: 'B prompt',
      note: 'B note',
    })
    seedPersonaState([personaA, personaB], 0)
    getDatabase().username = 'Persona A'
    getDatabase().userIcon = 'a.png'
    getDatabase().personaPrompt = 'A prompt'
    getDatabase().userNote = 'A note'
    const previous = currentPersonaStateSnapshot()
    updateSelectedPersonaField('personaPrompt', 'Edited A prompt')
    queueSelectedPersonaUpdate(previous, currentPersonaStateSnapshot())

    const observedEffects: ServerCommandLocalEffect[] = []
    setServerCommandSuccessReconciler((_event, events, localEffects) => {
      for (const event of events) {
        const localEffect = localEffects.get(event.revision)
        if (!localEffect) continue
        observedEffects.push(localEffect)
        notifyServerCommandLocalEffectApplied(event, localEffect)
      }
    })
    const collectionDigest = sha256Hex(serializePersonaCollectionDigestInput([personaB]))
    const legacyProfileDigest = sha256Hex(
      serializePersonaProfileDigestInput({
        name: 'Persona B',
        icon: 'b.png',
        personaPrompt: 'B prompt',
        note: 'B note',
      }),
    )
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input)
      if (url === '/api/v1/bootstrap') return jsonResponse({ revision: 1 })
      if (url === '/api/v1/commands/personas/persona-delete-a' && init?.method === 'PATCH') {
        return jsonResponse({
          revision: 2,
          event: {
            type: 'persona.updated',
            revision: 2,
            resource: 'persona',
            id: 'persona-delete-a',
          },
          personaId: 'persona-delete-a',
          acknowledgedKeys: ['personaPrompt'],
          legacyProfileProjectionApplied: true,
        })
      }
      if (url === '/api/v1/commands/personas/persona-delete-a' && init?.method === 'DELETE') {
        return jsonResponse({
          revision: 3,
          event: {
            type: 'persona.deleted',
            revision: 3,
            resource: 'persona',
            id: 'persona-delete-a',
          },
          personaId: 'persona-delete-a',
          personaMutationCertificate: 'persona-mutation-v1',
          operation: 'delete',
          personaProjectionDigest: collectionDigest,
          selectedPersonaId: 'persona-delete-b',
          collectionWritten: true,
          settingsWritten: true,
          legacyProfileProjectionApplied: true,
          legacyProfileDigest,
        })
      }
      return jsonResponse({ error: `unexpected ${url}` }, 404)
    })

    expect(deleteSelectedUserPersona()).toBe(true)
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3))
    await flushCommandEffects()

    expect(vi.mocked(fetch).mock.calls.map(([input, init]) => [String(input), init?.method ?? 'GET'])).toEqual([
      ['/api/v1/bootstrap', 'GET'],
      ['/api/v1/commands/personas/persona-delete-a', 'PATCH'],
      ['/api/v1/commands/personas/persona-delete-a', 'DELETE'],
    ])
    expect(observedEffects.map((effect) => effect.kind)).toEqual(['personaPatch', 'personaMutation'])
    expect(getDatabase().personas).toEqual([personaB])

    getDatabase().personas.push(
      makePersona({
        id: 'persona-delete-a',
        name: 'Server Persona A',
        icon: 'server-a.png',
        personaPrompt: 'Server A prompt',
        note: 'Server A note',
      }) as any,
    )
    getDatabase().selectedPersona = 1
    getDatabase().username = 'Server Persona A'
    getDatabase().userIcon = 'server-a.png'
    getDatabase().personaPrompt = 'Server A prompt'
    getDatabase().userNote = 'Server A note'
    reconcileSelectedPersonaProjectionEpoch()

    expect(getDatabase().personaPrompt).toBe('Server A prompt')
    expect(getDatabase().personas[1].personaPrompt).toBe('Server A prompt')
  })

  it('holds persona DELETE behind a transient profile PATCH and recovers without a late request', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-persona-delete',
      writerEpoch: 6,
      databaseLineage: 'lineage-persona-delete',
      requestedWriterWasActive: true,
    })
    setCachedServerCommandRevision(10)
    const personaA = makePersona({
      id: 'persona-transient-delete-a',
      name: 'Persona A',
      icon: 'a.png',
      personaPrompt: 'A prompt',
      note: 'A note',
    })
    const personaB = makePersona({
      id: 'persona-transient-delete-b',
      name: 'Persona B',
      icon: 'b.png',
      personaPrompt: 'B prompt',
      note: 'B note',
    })
    seedPersonaState([personaA, personaB], 0)
    getDatabase().username = 'Persona A'
    getDatabase().userIcon = 'a.png'
    getDatabase().personaPrompt = 'A prompt'
    getDatabase().userNote = 'A note'

    const baseline = currentPersonaStateSnapshot()
    updateSelectedPersonaField('personaPrompt', 'Latest optimistic A prompt')
    queueSelectedPersonaUpdate(baseline, currentPersonaStateSnapshot())

    const collectionDigest = sha256Hex(serializePersonaCollectionDigestInput([personaB]))
    const legacyProfileDigest = sha256Hex(
      serializePersonaProfileDigestInput({
        name: 'Persona B',
        icon: 'b.png',
        personaPrompt: 'B prompt',
        note: 'B note',
      }),
    )
    let recover = false
    let revision = 10
    const transientPatch = deferred<Response>()
    const commands: Array<{ method: string; body: Record<string, unknown> }> = []
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input)
      if (url === '/api/v1/commands/mutation-receipts/ack') return jsonResponse({ acknowledged: true })
      if (url === '/api/v1/commands/personas/persona-transient-delete-a') {
        const method = init?.method ?? 'GET'
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {}
        commands.push({ method, body })
        if (!recover && method === 'PATCH') return transientPatch.promise
        if (!recover) throw new Error('DELETE overtook its profile predecessor')
        revision += 1
        if (method === 'PATCH') {
          return jsonResponse({
            revision,
            event: {
              type: 'persona.updated',
              revision,
              resource: 'persona',
              id: 'persona-transient-delete-a',
            },
            personaId: 'persona-transient-delete-a',
            acknowledgedKeys: ['personaPrompt'],
            legacyProfileProjectionApplied: true,
          })
        }
        return jsonResponse({
          revision,
          event: {
            type: 'persona.deleted',
            revision,
            resource: 'persona',
            id: 'persona-transient-delete-a',
          },
          personaId: 'persona-transient-delete-a',
          personaMutationCertificate: 'persona-mutation-v1',
          operation: 'delete',
          personaProjectionDigest: collectionDigest,
          selectedPersonaId: 'persona-transient-delete-b',
          collectionWritten: true,
          settingsWritten: true,
          legacyProfileProjectionApplied: true,
          legacyProfileDigest,
        })
      }
      return jsonResponse({ error: `unexpected ${url}` }, 404)
    })

    try {
      expect(deleteSelectedUserPersona()).toBe(true)
      await vi.waitFor(() => expect(commands.map(({ method }) => method)).toEqual(['PATCH']))
      const pendingPatchResult = flushPendingSelectedPersonaUpdate()
      transientPatch.resolve(jsonResponse({ error: 'temporarily unavailable' }, 500))
      await expect(pendingPatchResult).resolves.toMatchObject({ status: 'error' })
      expect(
        (await listPendingMutations()).map((entry) => ({
          key: entry.handle.key,
          method: entry.intent.requests[0].method,
        })),
      ).toEqual([
        { key: 'persona-profile:persona-transient-delete-a', method: 'PATCH' },
        { key: 'persona:selection', method: 'DELETE' },
      ])
      const retainedDelete = (await listPendingMutations())[1]
      expect(retainedDelete.intent.dependencyKeys).toEqual(['persona-profile:persona-transient-delete-a'])
      expect(retainedDelete.intent.requests[0].body).toEqual({
        selectPersonaId: 'persona-transient-delete-b',
        mirrorLegacyProfile: true,
        saveCurrent: true,
      })

      recover = true
      const recoveryStart = commands.length
      await expect(replayPendingMutations()).resolves.toMatchObject({ succeeded: 2 })
      expect(commands.slice(recoveryStart).map(({ method }) => method)).toEqual(['PATCH', 'DELETE'])
      expect(await listPendingMutations()).toEqual([])

      const commandCount = commands.length
      await expect(replayPendingMutations()).resolves.toMatchObject({ succeeded: 0 })
      await expect(flushPendingSelectedPersonaUpdate()).resolves.toBeNull()
      expect(commands).toHaveLength(commandCount)
      expect(getDatabase()).toMatchObject({
        selectedPersona: 0,
        username: 'Persona B',
        userIcon: 'b.png',
        personaPrompt: 'B prompt',
        userNote: 'B note',
      })
      expect(getDatabase().personas).toEqual([personaB])
    } finally {
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
    }
  })

  it('holds persona selection behind retained outgoing and target row owners', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-persona-select-dependencies',
      writerEpoch: 7,
      databaseLineage: 'lineage-persona-select-dependencies',
      requestedWriterWasActive: true,
    })
    setCachedServerCommandRevision(20)
    seedPersonaState(
      [
        makePersona({ id: 'persona-select-owner-a', name: 'Persona A', personaPrompt: 'A prompt' }),
        makePersona({ id: 'persona-select-owner-b', name: 'Persona B', personaPrompt: 'B prompt' }),
      ],
      0,
    )
    getDatabase().username = 'Persona A'
    getDatabase().personaPrompt = 'A prompt'

    const baseline = currentPersonaStateSnapshot()
    updateSelectedPersonaField('personaPrompt', 'Newest A prompt')
    queueSelectedPersonaUpdate(baseline, currentPersonaStateSnapshot())

    let recover = false
    let revision = 20
    const requests: Array<{ method: string; url: string }> = []
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url === '/api/v1/commands/mutation-receipts/ack') return jsonResponse({ acknowledged: true })
      if (url === '/api/v1/commands/personas/persona-select-owner-a' && method === 'PATCH') {
        requests.push({ method, url })
        if (!recover) return jsonResponse({ error: 'temporarily unavailable' }, 500)
        revision += 1
        return jsonResponse({
          revision,
          event: {
            type: 'persona.updated',
            revision,
            resource: 'persona',
            id: 'persona-select-owner-a',
          },
          personaId: 'persona-select-owner-a',
          acknowledgedKeys: ['personaPrompt'],
          legacyProfileProjectionApplied: true,
        })
      }
      if (url === '/api/v1/commands/personas/select' && method === 'POST') {
        requests.push({ method, url })
        if (!recover) throw new Error('persona selection overtook its row dependency')
        revision += 1
        return jsonResponse({
          revision,
          event: {
            type: 'persona.selected',
            revision,
            resource: 'persona',
            id: 'persona-select-owner-b',
          },
          personaId: 'persona-select-owner-b',
        })
      }
      return jsonResponse({ error: `unexpected ${method} ${url}` }, 404)
    })

    try {
      await expect(flushPendingSelectedPersonaUpdate()).resolves.toMatchObject({ status: 'error' })
      changeUserPersona(1)
      await flushCommandEffects()

      expect(requests).toEqual([
        { method: 'PATCH', url: '/api/v1/commands/personas/persona-select-owner-a' },
        { method: 'PATCH', url: '/api/v1/commands/personas/persona-select-owner-a' },
      ])
      const retained = await listPendingMutations()
      expect(retained.map((entry) => entry.handle.key)).toEqual([
        'persona-profile:persona-select-owner-a',
        'persona:selection',
      ])
      expect(retained[1].intent.dependencyKeys).toEqual([
        'persona-profile:persona-select-owner-a',
        'persona-profile:persona-select-owner-b',
      ])

      recover = true
      const recoveryStart = requests.length
      await expect(replayPendingMutations()).resolves.toMatchObject({ succeeded: 2 })
      expect(requests.slice(recoveryStart)).toEqual([
        { method: 'PATCH', url: '/api/v1/commands/personas/persona-select-owner-a' },
        { method: 'POST', url: '/api/v1/commands/personas/select' },
      ])
      expect(await listPendingMutations()).toEqual([])
    } finally {
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
    }
  })

  it('keeps a later persona selection behind a retained delete fallback', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-persona-delete-select',
      writerEpoch: 8,
      databaseLineage: 'lineage-persona-delete-select',
      requestedWriterWasActive: true,
    })
    setCachedServerCommandRevision(30)
    seedPersonaState(
      [
        makePersona({ id: 'persona-delete-select-a', name: 'Persona A' }),
        makePersona({ id: 'persona-delete-select-b', name: 'Persona B' }),
        makePersona({ id: 'persona-delete-select-c', name: 'Persona C' }),
      ],
      0,
    )

    let recover = false
    let revision = 30
    let serverSelectedPersonaId = 'persona-delete-select-a'
    const requests: Array<{ method: string; url: string }> = []
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url === '/api/v1/commands/mutation-receipts/ack') return jsonResponse({ acknowledged: true })
      if (url === '/api/v1/commands/personas/persona-delete-select-a' && method === 'DELETE') {
        requests.push({ method, url })
        if (!recover) return jsonResponse({ error: 'temporarily unavailable' }, 500)
        const body = JSON.parse(String(init?.body)) as { selectPersonaId?: string }
        serverSelectedPersonaId = body.selectPersonaId ?? 'persona-delete-select-b'
        revision += 1
        return jsonResponse({
          revision,
          event: {
            type: 'persona.deleted',
            revision,
            resource: 'persona',
            id: 'persona-delete-select-a',
          },
          personaId: 'persona-delete-select-a',
          selectedPersonaId: serverSelectedPersonaId,
        })
      }
      if (url === '/api/v1/commands/personas/select' && method === 'POST') {
        requests.push({ method, url })
        if (!recover) throw new Error('later persona selection overtook retained delete')
        const body = JSON.parse(String(init?.body)) as { personaId: string }
        serverSelectedPersonaId = body.personaId
        revision += 1
        return jsonResponse({
          revision,
          event: {
            type: 'persona.selected',
            revision,
            resource: 'persona',
            id: serverSelectedPersonaId,
          },
          personaId: serverSelectedPersonaId,
        })
      }
      return jsonResponse({ error: `unexpected ${method} ${url}` }, 404)
    })

    try {
      expect(deleteSelectedUserPersona()).toBe(true)
      await flushCommandEffects()
      const personaCIndex = getDatabase().personas.findIndex((persona) => persona.id === 'persona-delete-select-c')
      expect(personaCIndex).toBeGreaterThanOrEqual(0)
      changeUserPersona(personaCIndex)
      await flushCommandEffects()

      expect(requests).toEqual([
        { method: 'DELETE', url: '/api/v1/commands/personas/persona-delete-select-a' },
        { method: 'DELETE', url: '/api/v1/commands/personas/persona-delete-select-a' },
      ])
      const retained = await listPendingMutations()
      expect(retained.map((entry) => [entry.handle.key, entry.intent.requests[0].method])).toEqual([
        ['persona:selection', 'DELETE'],
        ['persona:selection', 'POST'],
      ])

      recover = true
      const recoveryStart = requests.length
      await expect(replayPendingMutations()).resolves.toMatchObject({ succeeded: 2 })
      expect(requests.slice(recoveryStart)).toEqual([
        { method: 'DELETE', url: '/api/v1/commands/personas/persona-delete-select-a' },
        { method: 'POST', url: '/api/v1/commands/personas/select' },
      ])
      expect(serverSelectedPersonaId).toBe('persona-delete-select-c')
      expect(await listPendingMutations()).toEqual([])
    } finally {
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
    }
  })

  it('keeps reverted fields in a partially reverted persona PATCH closure', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-persona-partial-revert',
      writerEpoch: 4,
      databaseLineage: 'lineage-persona-partial-revert',
      requestedWriterWasActive: true,
    })
    seedPersonaState(
      [
        makePersona({
          id: 'persona-partial-revert',
          name: 'Persona A',
          personaPrompt: 'Baseline prompt',
          note: 'Baseline note',
        }),
      ],
      0,
    )
    getDatabase().personaPrompt = 'Baseline prompt'
    getDatabase().userNote = 'Baseline note'
    const previous = currentPersonaStateSnapshot()
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input)
      if (url === '/api/v1/bootstrap') return jsonResponse({ revision: 1 })
      if (url === '/api/v1/commands/mutation-receipts/ack') return jsonResponse({ acknowledged: true })
      if (url === '/api/v1/commands/personas/persona-partial-revert') {
        return jsonResponse({
          revision: 2,
          event: {
            type: 'persona.updated',
            revision: 2,
            resource: 'persona',
            id: 'persona-partial-revert',
          },
          personaId: 'persona-partial-revert',
          acknowledgedKeys: ['personaPrompt', 'note'],
          legacyProfileProjectionApplied: true,
        })
      }
      return jsonResponse({ error: `unexpected ${url}` }, 404)
    })

    updateSelectedPersonaField('personaPrompt', 'Temporary prompt')
    updateSelectedPersonaField('userNote', 'Temporary note')
    queueSelectedPersonaUpdate(previous, currentPersonaStateSnapshot())
    const priorDurableAttempt = currentPersonaStateSnapshot()
    updateSelectedPersonaField('userNote', 'Baseline note')
    queueSelectedPersonaUpdate(priorDurableAttempt, currentPersonaStateSnapshot())

    try {
      await vi.waitFor(async () => expect(await listPendingMutations()).toHaveLength(1))
      expect((await listPendingMutations())[0].intent.requests[0].body).toEqual({
        patch: {
          personaPrompt: 'Temporary prompt',
          note: 'Baseline note',
        },
        mirrorLegacyProfile: true,
      })
      await expect(flushPendingSelectedPersonaUpdate()).resolves.toMatchObject({ status: 'ok' })
    } finally {
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
    }
  })

  it('treats a selected-persona identity change as terminal invalidation', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-persona-identity-change',
      writerEpoch: 5,
      databaseLineage: 'lineage-persona-identity-change',
      requestedWriterWasActive: true,
    })
    seedPersonaState(
      [
        makePersona({ id: 'persona-identity-a', name: 'Persona A', personaPrompt: 'A prompt' }),
        makePersona({ id: 'persona-identity-b', name: 'Persona B', personaPrompt: 'B prompt' }),
      ],
      0,
    )
    getDatabase().username = 'Persona A'
    getDatabase().personaPrompt = 'A prompt'
    const baseline = currentPersonaStateSnapshot()
    updateSelectedPersonaField('personaPrompt', 'Queued A prompt')
    queueSelectedPersonaUpdate(baseline, currentPersonaStateSnapshot())

    try {
      await vi.waitFor(async () => expect(await listPendingMutations()).toHaveLength(1))
      getDatabase().selectedPersona = 1
      getDatabase().username = 'Persona B'
      getDatabase().userIcon = ''
      getDatabase().personaPrompt = 'B prompt'
      getDatabase().userNote = ''
      const selectedB = currentPersonaStateSnapshot()
      queueSelectedPersonaUpdate(selectedB, selectedB)

      await vi.waitFor(async () => expect(await listPendingMutations()).toEqual([]))
      expect(fetch).not.toHaveBeenCalled()
    } finally {
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
    }
  })

  it('persists and immediately dispatches an absolute persona correction after a remote marker wins', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-persona-total-revert',
      writerEpoch: 5,
      databaseLineage: 'lineage-persona-total-revert',
      requestedWriterWasActive: true,
    })
    seedPersonaState(
      [
        makePersona({
          id: 'persona-total-revert',
          name: 'Persona A',
          personaPrompt: 'Baseline prompt',
        }),
      ],
      0,
    )
    getDatabase().username = 'Persona A'
    getDatabase().personaPrompt = 'Baseline prompt'
    const baseline = currentPersonaStateSnapshot()

    updateSelectedPersonaField('personaPrompt', 'Temporary prompt')
    queueSelectedPersonaUpdate(baseline, currentPersonaStateSnapshot())
    await vi.waitFor(async () => expect(await listPendingMutations()).toHaveLength(1))
    const remoteHandle = (await listPendingMutations())[0].handle
    await expect(beginPendingMutationDispatch(remoteHandle)).resolves.toBe('persisted')

    const firstPatch = deferred<Response>()
    let revision = 1
    const patchBodies: Array<Record<string, unknown>> = []
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input)
      if (url === '/api/v1/bootstrap') return jsonResponse({ revision })
      if (url === '/api/v1/commands/mutation-receipts/ack') return jsonResponse({ acknowledged: true })
      if (url === '/api/v1/commands/personas/persona-total-revert' && init?.method === 'PATCH') {
        patchBodies.push(JSON.parse(String(init.body)))
        if (patchBodies.length === 1) return firstPatch.promise
        revision += 1
        return jsonResponse({
          revision,
          event: {
            type: 'persona.updated',
            revision,
            resource: 'persona',
            id: 'persona-total-revert',
          },
          personaId: 'persona-total-revert',
          acknowledgedKeys: ['personaPrompt'],
          legacyProfileProjectionApplied: true,
        })
      }
      return jsonResponse({ error: `unexpected ${url}` }, 404)
    })

    const priorDurableAttempt = currentPersonaStateSnapshot()
    updateSelectedPersonaField('personaPrompt', 'Baseline prompt')
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    try {
      queueSelectedPersonaUpdate(priorDurableAttempt, currentPersonaStateSnapshot())
      expect(timeoutSpy.mock.calls.some(([, delay]) => delay === 250)).toBe(false)
    } finally {
      timeoutSpy.mockRestore()
    }

    try {
      await vi.waitFor(() => expect(patchBodies).toHaveLength(1))
      expect(
        (await listPendingMutations()).map((entry) => ({
          key: entry.handle.key,
          body: entry.intent.requests[0].body,
        })),
      ).toEqual([
        {
          key: 'persona-profile:persona-total-revert',
          body: { patch: { personaPrompt: 'Temporary prompt' }, mirrorLegacyProfile: true },
        },
        {
          key: 'persona-profile:persona-total-revert',
          body: { patch: { personaPrompt: 'Baseline prompt' }, mirrorLegacyProfile: true },
        },
      ])

      revision += 1
      firstPatch.resolve(
        jsonResponse({
          revision,
          event: {
            type: 'persona.updated',
            revision,
            resource: 'persona',
            id: 'persona-total-revert',
          },
          personaId: 'persona-total-revert',
          acknowledgedKeys: ['personaPrompt'],
          legacyProfileProjectionApplied: true,
        }),
      )
      await expect(flushPendingSelectedPersonaUpdate()).resolves.toMatchObject({ status: 'ok' })
      expect(patchBodies.map((body) => body.patch)).toEqual([
        { personaPrompt: 'Temporary prompt' },
        { personaPrompt: 'Baseline prompt' },
      ])
      expect(await listPendingMutations()).toEqual([])
    } finally {
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
    }
  })

  it('retains the first debounce projection epochs when an authoritative apply races the flush', async () => {
    seedPersonaState(
      [
        makePersona({
          id: 'persona-debounce-epoch',
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
    const collectionProjectionEpoch = captureCollectionProjectionEpoch('personas')
    const settingsProjectionEpoch = captureSettingsProjectionEpoch()
    const previous = currentPersonaStateSnapshot()
    updateSelectedPersonaField('personaPrompt', 'Attempted prompt')
    queueSelectedPersonaUpdate(previous, currentPersonaStateSnapshot())

    applyCollectionsResource(
      {
        revision: 1,
        collections: { personas: cloneJsonValue(getDatabase().personas) },
      },
      'personas',
    )
    applySettingsResource({
      revision: 1,
      settings: {
        selectedPersona: 0,
        username: 'Persona A',
        userIcon: 'a.png',
        personaPrompt: 'Attempted prompt',
        userNote: 'Old note',
      },
    })
    expect(hasCollectionProjectionEpochChanged('personas', collectionProjectionEpoch)).toBe(true)
    expect(hasSettingsProjectionEpochChanged(settingsProjectionEpoch)).toBe(true)

    const observedEffects: ServerCommandLocalEffect[] = []
    setServerCommandSuccessReconciler((_event, _events, localEffects) => {
      observedEffects.push(...localEffects.values())
    })
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ revision: 1 }))
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        revision: 2,
        event: {
          type: 'persona.updated',
          revision: 2,
          resource: 'persona',
          id: 'persona-debounce-epoch',
        },
        personaId: 'persona-debounce-epoch',
        acknowledgedKeys: ['personaPrompt'],
        legacyProfileProjectionApplied: true,
      }),
    )

    await flushPendingSelectedPersonaUpdate()

    expect(observedEffects).toEqual([
      expect.objectContaining({
        kind: 'personaPatch',
        collectionProjectionEpoch,
        settingsProjectionEpoch,
      }),
    ])
  })

  it('keeps a dirty value when a successful response does not validate as an applied acknowledgement', async () => {
    seedPersonaState(
      [
        makePersona({
          id: 'persona-rejected-ack',
          name: 'Baseline',
          icon: '',
          personaPrompt: '',
          note: '',
        }),
      ],
      0,
    )
    getDatabase().username = 'Baseline'
    getDatabase().userIcon = ''
    getDatabase().personaPrompt = ''
    getDatabase().userNote = ''
    const previous = currentPersonaStateSnapshot()
    updateSelectedPersonaField('username', 'Optimistic name')
    queueSelectedPersonaUpdate(previous, currentPersonaStateSnapshot())

    const observedEffects: ServerCommandLocalEffect[] = []
    setServerCommandSuccessReconciler((_event, _events, localEffects) => {
      observedEffects.push(...localEffects.values())
    })
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ revision: 1 }))
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        revision: 2,
        event: {
          type: 'persona.updated',
          revision: 2,
          resource: 'persona',
          id: 'persona-rejected-ack',
        },
        personaId: 'persona-rejected-ack',
        acknowledgedKeys: ['name'],
        legacyProfileProjectionApplied: false,
      }),
    )

    expect(await flushPendingSelectedPersonaUpdate()).toMatchObject({ status: 'ok' })
    expect(observedEffects).toEqual([])

    applySelectedPersonaProjection({ id: 'persona-rejected-ack', name: 'Baseline' }, { username: 'Baseline' })
    reconcileSelectedPersonaProjectionEpoch()

    expect(getDatabase().username).toBe('Optimistic name')
    expect(getDatabase().personas[0].name).toBe('Optimistic name')
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

    expect(isCollectionAcknowledgementTainted('personas')).toBe(true)
    expect(isSettingsAcknowledgementTainted()).toBe(true)

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

  it('sends only fields changed by a direct profile save and skips a repeated no-op', async () => {
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
    getDatabase().userNote = 'New note'
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ revision: 1 }))
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        revision: 2,
        event: {
          type: 'persona.updated',
          revision: 2,
          resource: 'persona',
          id: 'persona-a',
        },
        personaId: 'persona-a',
        acknowledgedKeys: ['note'],
        legacyProfileProjectionApplied: true,
      }),
    )

    saveUserPersona()
    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(2)
    })

    const updateBody = JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body))
    expect(updateBody.patch).toEqual({ note: 'New note' })

    saveUserPersona()
    await flushCommandEffects()
    expect(fetch).toHaveBeenCalledTimes(2)
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
    const updateBody = JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body))
    expect(updateBody.patch).toEqual({ personaPrompt: 'Trigger prompt' })

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

  it('skips a trigger prompt write when the selected profile is unchanged', () => {
    seedPersonaState(
      [
        makePersona({
          id: 'persona-a',
          name: 'Persona A',
          icon: 'a.png',
          personaPrompt: 'Current prompt',
          note: 'Current note',
        }),
      ],
      0,
    )
    getDatabase().username = 'Persona A'
    getDatabase().userIcon = 'a.png'
    getDatabase().personaPrompt = 'Current prompt'
    getDatabase().userNote = 'Current note'

    setSelectedPersonaPromptFromTrigger('Current prompt')

    expect(fetch).not.toHaveBeenCalled()
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

    expect(isCollectionAcknowledgementTainted('personas')).toBe(true)
    expect(isSettingsAcknowledgementTainted()).toBe(true)

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

  it('taints only settings when a no-save persona selection fails', async () => {
    seedPersonaState(
      [
        makePersona({ id: 'persona-select-a', name: 'A', icon: '', personaPrompt: 'A prompt', note: '' }),
        makePersona({ id: 'persona-select-b', name: 'B', icon: '', personaPrompt: 'B prompt', note: '' }),
      ],
      0,
    )
    getDatabase().username = 'A'
    getDatabase().userIcon = ''
    getDatabase().personaPrompt = 'A prompt'
    getDatabase().userNote = ''
    mockNextCommandFailure()

    changeUserPersona(1, 'noSave')
    await flushCommandEffects()

    expect(isCollectionAcknowledgementTainted('personas')).toBe(false)
    expect(isSettingsAcknowledgementTainted()).toBe(true)
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

  it('does not assign IDs or save profile fields while preparing an invalid reorder', () => {
    seedPersonaState([makePersona({ name: 'Missing ID' }), makePersona({ id: 'persona-b', name: 'B' })], 0)
    const before = cloneJsonValue(getDatabase())

    expect(beginPersonaReorder()).toBeNull()
    expect(reorderUserPersonasByIndices([1, 0], null)).toBe(false)

    expect(getDatabase({ snapshot: true })).toEqual(before)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not assign duplicate IDs or delete locally when delete preparation cannot form command IDs', () => {
    seedPersonaState(
      [
        makePersona({ id: 'duplicate-persona', name: 'Duplicate A' }),
        makePersona({ id: 'duplicate-persona', name: 'Duplicate B' }),
      ],
      0,
    )
    const before = cloneJsonValue(getDatabase())

    expect(deleteSelectedUserPersona()).toBe(false)

    expect(getDatabase({ snapshot: true })).toEqual(before)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not delete a newly selected persona after confirmation began for another persona', () => {
    seedPersonaState(
      [makePersona({ id: 'persona-a', name: 'Persona A' }), makePersona({ id: 'persona-b', name: 'Persona B' })],
      0,
    )
    const confirmedPersonaId = selectedPersonaId()
    getDatabase().selectedPersona = 1
    const before = cloneJsonValue(getDatabase())

    expect(confirmedPersonaId).toBe('persona-a')
    expect(deleteSelectedUserPersona(confirmedPersonaId!)).toBe(false)

    expect(getDatabase({ snapshot: true })).toEqual(before)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not assign duplicate IDs or change selection when select preparation cannot form command IDs', () => {
    seedPersonaState(
      [
        makePersona({ id: 'duplicate-persona', name: 'Duplicate A' }),
        makePersona({ id: 'duplicate-persona', name: 'Duplicate B' }),
      ],
      0,
    )
    const before = cloneJsonValue(getDatabase())

    changeUserPersona(1)

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

    expect(isCollectionAcknowledgementTainted('personas')).toBe(true)
    expect(isSettingsAcknowledgementTainted()).toBe(true)

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
    updateSelectedPersonaField('username', 'Latest optimistic Persona B')
    updateSelectedPersonaField('personaPrompt', 'Latest optimistic Prompt B')
    updateSelectedPersonaField('userNote', 'Latest optimistic Note B')
    getDatabase().userIcon = 'latest-b.png'
    getDatabase().personas[1].icon = 'latest-b.png'
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

    expect(isCollectionAcknowledgementTainted('personas')).toBe(true)
    expect(isSettingsAcknowledgementTainted()).toBe(true)

    expect(getDatabase().personas.map((persona) => persona.id)).toEqual([
      'persona-a',
      'persona-b',
      'persona-c',
      'persona-d',
    ])
    expect(getDatabase().personas[1]).toMatchObject({
      id: 'persona-b',
      name: 'Latest optimistic Persona B',
      icon: 'latest-b.png',
      personaPrompt: 'Latest optimistic Prompt B',
      note: 'Latest optimistic Note B',
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
      username: 'Latest optimistic Persona B',
      userIcon: 'latest-b.png',
      personaPrompt: 'Latest optimistic Prompt B',
      userNote: 'Latest optimistic Note B',
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

    expect(isCollectionAcknowledgementTainted('personas')).toBe(true)
    expect(isSettingsAcknowledgementTainted()).toBe(true)

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
  it('settles an accepted dirty value without clearing a later edit to the same field', () => {
    seedPersonaState(
      [
        makePersona({
          id: 'persona-overlap-settlement',
          name: 'Baseline',
          icon: '',
          personaPrompt: '',
          note: '',
        }),
      ],
      0,
    )
    getDatabase().username = 'Baseline'
    getDatabase().userIcon = ''
    getDatabase().personaPrompt = ''
    getDatabase().userNote = ''

    updateSelectedPersonaField('username', 'First accepted value')
    const firstAttempt = cloneJsonValue(getDatabase().personas[0])
    updateSelectedPersonaField('username', 'Later queued value')
    const laterAttempt = cloneJsonValue(getDatabase().personas[0])

    settleAcceptedPersonaPatchDirtyFields(
      'persona-overlap-settlement',
      { name: 'First accepted value' },
      firstAttempt,
      true,
    )
    applySelectedPersonaProjection(
      { id: 'persona-overlap-settlement', name: 'First accepted value' },
      { username: 'First accepted value' },
    )
    reconcileSelectedPersonaProjectionEpoch()
    expect(getDatabase().username).toBe('Later queued value')
    expect(getDatabase().personas[0].name).toBe('Later queued value')

    settleAcceptedPersonaPatchDirtyFields(
      'persona-overlap-settlement',
      { name: 'Later queued value' },
      laterAttempt,
      true,
    )
    applySelectedPersonaProjection(
      { id: 'persona-overlap-settlement', name: 'Future authoritative value' },
      { username: 'Future authoritative value' },
    )
    reconcileSelectedPersonaProjectionEpoch()
    expect(getDatabase().username).toBe('Future authoritative value')
    expect(getDatabase().personas[0].name).toBe('Future authoritative value')
  })

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
