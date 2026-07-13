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

import { updateAgentPreset, updateAgentPresetStep } from './agentPresets'
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
})
