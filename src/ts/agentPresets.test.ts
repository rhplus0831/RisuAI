import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'test-auth-token',
}))
vi.mock('./process/modules', () => ({
  applyModule: vi.fn(),
  exportModule: vi.fn(),
  getModuleAssets: vi.fn(() => []),
  getModuleLorebooks: vi.fn(() => []),
  getModuleRegexScripts: vi.fn(() => []),
  getModules: vi.fn(() => []),
  importModule: vi.fn(),
  moduleUpdate: vi.fn(),
  readModule: vi.fn(),
  refreshModules: vi.fn(),
}))

import {
  deleteAgentPreset,
  deleteAgentPresetStep,
  reorderAgentPresets,
  reorderAgentPresetSteps,
  setAgentPresetDefault,
  updateAgentPreset,
  updateAgentPresetStep,
} from './agentPresets'
import type { AgentPresetRecord, AgentPresetStepRecord } from './agentPresetRecords'
import {
  clearAppliedServerResourceRevision,
  clearCachedServerCommandRevision,
  setCachedServerCommandRevision,
  setServerCommandSuccessReconciler,
} from './server/commands'
import { isSettingsGroupAcknowledgementTainted, resetServerResourceState } from './server/resourceState.svelte'
import {
  getDatabase,
  setDatabaseLite,
  setResourceWriteGuardEnabled,
  withTrustedResourceWrite,
} from './storage/database.svelte'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve']
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

function response(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function step(overrides: Partial<AgentPresetStepRecord> = {}): AgentPresetStepRecord {
  return {
    id: 'aps_a',
    name: 'Step A',
    enabled: true,
    phase: 'beforeMain',
    dependencies: [],
    instruction: 'Original instruction',
    model: { mode: 'inheritMain' },
    runtime: {},
    inputScopes: [],
    outputKey: 'step_a',
    outputFormat: 'text',
    destination: 'promptOutput',
    failurePolicy: { mode: 'required' },
    ...overrides,
  }
}

function preset(overrides: Partial<AgentPresetRecord> = {}): AgentPresetRecord {
  return {
    id: 'ap_a',
    name: 'Preset A',
    enabled: true,
    version: 1,
    steps: [step()],
    ...overrides,
  }
}

function seedAgentPresetDeleteReferences(): void {
  setResourceWriteGuardEnabled(false)
  setDatabaseLite(
    {
      agentPresets: [preset(), preset({ id: 'ap_b', name: 'Preset B', steps: [] })],
      agentPresetDefaultId: 'ap_a',
      characters: [
        {
          chaId: 'char_a',
          name: 'Character A',
          chats: [
            {
              id: 'chat_a',
              name: 'Chat A',
              message: [],
              note: '',
              localLore: [],
              generationSettings: { agentPresetId: 'ap_a', configured: false },
            },
          ],
        },
      ],
      loadouts: [
        {
          id: 'loadout_a',
          name: 'Loadout A',
          lastUsed: 100,
          favorite: false,
          characterIds: ['char_a'],
          modules: [],
          globalVariables: { mood: 'initial' },
          presetName: '',
          agentPresetId: 'ap_a',
          agentPresetName: 'Preset A',
          personaId: '',
        },
      ],
    } as never,
    1,
  )
  setResourceWriteGuardEnabled(true)
}

beforeEach(() => {
  setResourceWriteGuardEnabled(false)
  resetServerResourceState()
  setDatabaseLite({ agentPresets: [preset()], characters: [] } as never, 1)
  setResourceWriteGuardEnabled(true)
  clearCachedServerCommandRevision()
  clearAppliedServerResourceRevision()
  setCachedServerCommandRevision(1)
  setServerCommandSuccessReconciler(null)
})

afterEach(() => {
  setResourceWriteGuardEnabled(false)
  setServerCommandSuccessReconciler(null)
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Agent Preset optimistic field rollback', () => {
  it('emits exact local effects for response-confirmed optimistic reorder/default writes', async () => {
    setResourceWriteGuardEnabled(false)
    resetServerResourceState()
    setDatabaseLite(
      {
        agentPresets: [preset(), preset({ id: 'ap_b', name: 'Preset B', steps: [] })],
        agentPresetDefaultId: 'ap_a',
        characters: [],
      } as never,
      1,
    )
    setResourceWriteGuardEnabled(true)
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input)
      if (url.endsWith('/agent-presets/reorder')) {
        return response(
          {
            revision: 2,
            event: { type: 'agentPreset.reordered', revision: 2, resource: 'agentPreset' },
            agentPresetDefaultId: 'ap_a',
            certificate: 'agent-preset-collection-v1',
            agentPresetIds: ['ap_b', 'ap_a'],
          },
          200,
        )
      }
      if (url.endsWith('/agent-presets/default')) {
        return response(
          {
            revision: 3,
            event: {
              type: 'agentPreset.default.updated',
              revision: 3,
              resource: 'agentPreset',
              id: 'ap_b',
            },
            agentPresetDefaultId: 'ap_b',
            certificate: 'agent-preset-collection-v1',
            agentPresetIds: ['ap_b', 'ap_a'],
          },
          200,
        )
      }
      throw new Error(`Unexpected command URL: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const observedEffects: unknown[] = []
    setServerCommandSuccessReconciler((_event, _events, localEffects) => {
      observedEffects.push(...localEffects.values())
    })

    await reorderAgentPresets(['ap_b', 'ap_a'])
    await setAgentPresetDefault('ap_b')

    expect(observedEffects).toEqual([
      {
        kind: 'agentPresetCollectionMutation',
        operation: 'reorder',
        settingsProjectionEpoch: expect.any(Number),
        presetIds: ['ap_b', 'ap_a'],
        agentPresetDefaultId: 'ap_a',
      },
      {
        kind: 'agentPresetCollectionMutation',
        operation: 'default',
        settingsProjectionEpoch: expect.any(Number),
        presetIds: ['ap_b', 'ap_a'],
        agentPresetDefaultId: 'ap_b',
      },
    ])
    expect(getDatabase().agentPresets.map((candidate) => candidate.id)).toEqual(['ap_b', 'ap_a'])
    expect(getDatabase().agentPresetDefaultId).toBe('ap_b')
    expect(fetchMock.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)))).toEqual([
      { baseRevision: 1, presetIds: ['ap_b', 'ap_a'] },
      { baseRevision: 2, agentPresetId: 'ap_b' },
    ])
  })

  it('withholds local effects for missing or contradictory collection receipts', async () => {
    setResourceWriteGuardEnabled(false)
    resetServerResourceState()
    setDatabaseLite(
      {
        agentPresets: [preset(), preset({ id: 'ap_b', name: 'Preset B', steps: [] })],
        agentPresetDefaultId: 'ap_a',
        characters: [],
      } as never,
      1,
    )
    setResourceWriteGuardEnabled(true)
    let responseIndex = 0
    const bodies = [
      {
        revision: 2,
        event: { type: 'agentPreset.reordered', revision: 2, resource: 'agentPreset' },
        agentPresetDefaultId: 'ap_a',
        agentPresetIds: ['ap_b', 'ap_a'],
      },
      {
        revision: 3,
        event: {
          type: 'agentPreset.default.updated',
          revision: 3,
          resource: 'agentPreset',
          id: 'ap_b',
        },
        agentPresetDefaultId: 'ap_b',
        certificate: 'agent-preset-collection-v1',
        agentPresetIds: ['ap_a', 'ap_b'],
      },
    ]
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(bodies[responseIndex++], 200)),
    )
    const observedEffectCounts: number[] = []
    setServerCommandSuccessReconciler((_event, _events, localEffects) => {
      observedEffectCounts.push(localEffects.size)
    })

    await reorderAgentPresets(['ap_b', 'ap_a'])
    await setAgentPresetDefault('ap_b')

    expect(observedEffectCounts).toEqual([0, 0])
  })

  it('restores failed delete references by stable id while preserving concurrent chat and loadout edits', async () => {
    seedAgentPresetDeleteReferences()
    const pendingResponse = deferred<Response>()
    vi.stubGlobal(
      'fetch',
      vi.fn(() => pendingResponse.promise),
    )

    const resultPromise = deleteAgentPreset('ap_a')
    expect(getDatabase().agentPresets.map((candidate) => candidate.id)).toEqual(['ap_b'])
    expect(getDatabase()).not.toHaveProperty('agentPresetDefaultId')
    expect(getDatabase().characters[0].chats[0].generationSettings?.agentPresetId).toBeUndefined()
    expect(getDatabase().loadouts[0].agentPresetId).toBeUndefined()
    expect(getDatabase().loadouts[0].agentPresetName).toBeUndefined()

    withTrustedResourceWrite(() => {
      const chat = getDatabase().characters[0].chats[0]
      getDatabase().characters[0].chats[0] = {
        ...chat,
        name: 'Edited Chat A',
        generationSettings: {
          ...chat.generationSettings,
          configured: true,
        },
      }
      const loadout = getDatabase().loadouts[0]
      getDatabase().loadouts[0] = {
        ...loadout,
        name: 'Edited Loadout A',
        globalVariables: { ...loadout.globalVariables, mood: 'edited' },
      }
    })
    pendingResponse.resolve(response({ error: 'rejected' }, 400))

    await expect(resultPromise).resolves.toEqual({ status: 'error', error: 'rejected' })
    expect(getDatabase().agentPresets.map((candidate) => candidate.id)).toEqual(['ap_a', 'ap_b'])
    expect(getDatabase().agentPresetDefaultId).toBe('ap_a')
    expect(getDatabase().characters[0].chats[0]).toMatchObject({
      name: 'Edited Chat A',
      generationSettings: { agentPresetId: 'ap_a', configured: true },
    })
    expect(getDatabase().loadouts[0]).toMatchObject({
      name: 'Edited Loadout A',
      globalVariables: { mood: 'edited' },
      agentPresetId: 'ap_a',
      agentPresetName: 'Preset A',
    })
    expect(isSettingsGroupAcknowledgementTainted('agents')).toBe(true)
  })

  it('preserves newer chat and loadout Agent Preset selections when a delete fails', async () => {
    seedAgentPresetDeleteReferences()
    const pendingResponse = deferred<Response>()
    vi.stubGlobal(
      'fetch',
      vi.fn(() => pendingResponse.promise),
    )

    const resultPromise = deleteAgentPreset('ap_a')
    withTrustedResourceWrite(() => {
      getDatabase().characters[0].chats[0].generationSettings!.agentPresetId = 'ap_b'
      getDatabase().loadouts[0].agentPresetId = 'ap_b'
      getDatabase().loadouts[0].agentPresetName = 'Preset B'
    })
    pendingResponse.resolve(response({ error: 'revision_conflict', currentRevision: 2 }, 409))

    await expect(resultPromise).resolves.toEqual({ status: 'conflict', currentRevision: 2 })
    expect(getDatabase().characters[0].chats[0].generationSettings?.agentPresetId).toBe('ap_b')
    expect(getDatabase().loadouts[0]).toMatchObject({
      agentPresetId: 'ap_b',
      agentPresetName: 'Preset B',
    })
    expect(isSettingsGroupAcknowledgementTainted('agents')).toBe(true)
  })

  it('does not recreate or mutate delete-reference targets superseded by structural edits', async () => {
    seedAgentPresetDeleteReferences()
    const pendingResponse = deferred<Response>()
    vi.stubGlobal(
      'fetch',
      vi.fn(() => pendingResponse.promise),
    )

    const resultPromise = deleteAgentPreset('ap_a')
    withTrustedResourceWrite(() => {
      getDatabase().characters[0].chats = []
      getDatabase().loadouts = []
    })
    pendingResponse.resolve(response({ error: 'rejected' }, 400))

    await expect(resultPromise).resolves.toEqual({ status: 'error', error: 'rejected' })
    expect(getDatabase().characters[0].chats).toEqual([])
    expect(getDatabase().loadouts).toEqual([])
    expect(isSettingsGroupAcknowledgementTainted('agents')).toBe(true)
  })

  it('taints before rolling back failed metadata fields and preserves a later edit', async () => {
    const pendingResponse = deferred<Response>()
    vi.stubGlobal(
      'fetch',
      vi.fn(() => pendingResponse.promise),
    )

    const resultPromise = updateAgentPreset('ap_a', { name: 'Failed name', enabled: false })
    expect(getDatabase().agentPresets[0]).toMatchObject({ name: 'Failed name', enabled: false })
    withTrustedResourceWrite(() => {
      getDatabase().agentPresets[0].name = 'Newer local name'
    })
    pendingResponse.resolve(response({ error: 'revision_conflict', currentRevision: 2 }, 409))

    await expect(resultPromise).resolves.toEqual({ status: 'conflict', currentRevision: 2 })
    expect(getDatabase().agentPresets[0]).toMatchObject({
      name: 'Newer local name',
      enabled: true,
    })
    expect(isSettingsGroupAcknowledgementTainted('agents')).toBe(true)
  })

  it('rolls back only matching failed step fields while retaining a later step edit', async () => {
    const pendingResponse = deferred<Response>()
    vi.stubGlobal(
      'fetch',
      vi.fn(() => pendingResponse.promise),
    )

    const resultPromise = updateAgentPresetStep('ap_a', 'aps_a', {
      outputKey: 'failed_key',
      instruction: 'Failed instruction',
    })
    expect(getDatabase().agentPresets[0].steps[0]).toMatchObject({
      outputKey: 'failed_key',
      instruction: 'Failed instruction',
    })
    withTrustedResourceWrite(() => {
      getDatabase().agentPresets[0].steps[0].instruction = 'Newer local instruction'
    })
    pendingResponse.resolve(response({ error: 'rejected' }, 400))

    await expect(resultPromise).resolves.toEqual({ status: 'error', error: 'rejected' })
    expect(getDatabase().agentPresets[0].steps[0]).toMatchObject({
      outputKey: 'step_a',
      instruction: 'Newer local instruction',
    })
    expect(isSettingsGroupAcknowledgementTainted('agents')).toBe(true)
  })

  it.each([
    ['preset delete', () => deleteAgentPreset('ap_a')],
    ['preset reorder', () => reorderAgentPresets(['ap_b', 'ap_a'])],
    ['default selection', () => setAgentPresetDefault('ap_b')],
    ['step delete', () => deleteAgentPresetStep('ap_a', 'aps_a')],
    ['step reorder', () => reorderAgentPresetSteps('ap_a', ['aps_b', 'aps_a'])],
  ])('taints the agents projection before a failed optimistic %s rollback', async (_label, runCommand) => {
    setResourceWriteGuardEnabled(false)
    resetServerResourceState()
    setDatabaseLite(
      {
        agentPresets: [
          preset({ steps: [step(), step({ id: 'aps_b', name: 'Step B', outputKey: 'step_b' })] }),
          preset({ id: 'ap_b', name: 'Preset B', steps: [] }),
        ],
        characters: [],
      } as never,
      1,
    )
    setResourceWriteGuardEnabled(true)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response({ error: 'rejected' }, 400)),
    )

    await expect(runCommand()).resolves.toEqual({ status: 'error', error: 'rejected' })

    expect(isSettingsGroupAcknowledgementTainted('agents')).toBe(true)
  })

  it('keeps a failed step reorder tainted when a later accepted field patch prevents whole-array rollback', async () => {
    setResourceWriteGuardEnabled(false)
    resetServerResourceState()
    setDatabaseLite(
      {
        agentPresets: [preset({ steps: [step(), step({ id: 'aps_b', name: 'Step B', outputKey: 'step_b' })] })],
        characters: [],
      } as never,
      1,
    )
    setResourceWriteGuardEnabled(true)
    const pendingReorder = deferred<Response>()
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/agent-presets/ap_a/steps/reorder')) return pendingReorder.promise
      if (url.endsWith('/agent-presets/ap_a/steps/aps_b')) {
        return Promise.resolve(
          response(
            {
              revision: 3,
              event: {
                type: 'agentPreset.step.updated',
                revision: 3,
                resource: 'agentPreset',
                id: 'aps_b',
                parentId: 'ap_a',
              },
              presetId: 'ap_a',
              stepId: 'aps_b',
              acknowledgedKeys: ['instruction'],
              canonicalValues: { instruction: 'Accepted instruction' },
              canonicalDeletedKeys: [],
              updatedAt: 300,
            },
            200,
          ),
        )
      }
      throw new Error(`Unexpected command URL: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const authoritativeAgentsRead = vi.fn()
    const localRevisionFence = vi.fn()
    setServerCommandSuccessReconciler((_event, events, localEffects) => {
      const localEffect = [...localEffects.values()][0]
      if (localEffect?.kind === 'agentPresetStepPatch' && isSettingsGroupAcknowledgementTainted('agents')) {
        authoritativeAgentsRead(events)
        return
      }
      localRevisionFence()
    })

    const reorderResult = reorderAgentPresetSteps('ap_a', ['aps_b', 'aps_a'])
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const updateResult = updateAgentPresetStep('ap_a', 'aps_b', { instruction: 'Accepted instruction' })
    expect(getDatabase().agentPresets[0].steps.map((candidate) => candidate.id)).toEqual(['aps_b', 'aps_a'])
    expect(getDatabase().agentPresets[0].steps[0].instruction).toBe('Accepted instruction')

    pendingReorder.resolve(response({ error: 'revision_conflict', currentRevision: 2 }, 409))

    await expect(Promise.all([reorderResult, updateResult])).resolves.toEqual([
      { status: 'conflict', currentRevision: 2 },
      expect.objectContaining({ status: 'ok', revision: 3 }),
    ])
    expect(getDatabase().agentPresets[0].steps.map((candidate) => candidate.id)).toEqual(['aps_b', 'aps_a'])
    expect(getDatabase().agentPresets[0].steps[0].instruction).toBe('Accepted instruction')
    expect(isSettingsGroupAcknowledgementTainted('agents')).toBe(true)
    expect(authoritativeAgentsRead).toHaveBeenCalledOnce()
    expect(localRevisionFence).not.toHaveBeenCalled()
  })
})
