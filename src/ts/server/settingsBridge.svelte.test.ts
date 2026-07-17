import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushSync } from 'svelte'

const recorded = vi.hoisted(() => ({
  patches: [] as Array<{
    patch: Record<string, unknown>
    acknowledgeOptimistic?: boolean
    optimisticProjectionEpochs?: Record<string, number>
    rollback?: () => void
    keepalive?: boolean
  }>,
  patchResults: [] as Array<unknown | Promise<unknown>>,
  objectPatches: [] as Array<{
    baseRevision: number
    group: string
    key: string
    update: { patch: Record<string, unknown>; deleteKeys?: string[] }
    attemptedObject: Record<string, unknown>
    optimisticProjectionEpoch: number
  }>,
  objectResults: [] as Array<unknown | Promise<unknown>>,
  groupReads: [] as unknown[],
}))
const alertMocks = vi.hoisted(() => ({
  alertError: vi.fn(),
}))
const durabilityMocks = vi.hoisted(() => ({
  acknowledged: [] as Array<{ mutationId: string }>,
  dispatched: [] as Array<{ key: string; mutationId: string; intent: unknown }>,
  nextId: 1,
  retainFailures: false,
  staged: [] as Array<{ key: string; mutationId: string; intent: unknown }>,
}))
const resourceGuardState = vi.hoisted(() => ({ epoch: 0 }))
const presetMocks = vi.hoisted(() => ({
  OAI: {
    mainPrompt: 'default main prompt',
    jailbreak: 'default jailbreak',
  },
  OAI2: {
    apiType: 'preset-api',
    temperature: 0.75,
    mainPrompt: 'preset prompt',
    maxContext: 16000,
    maxResponse: 1000,
  },
  setPreset: vi.fn((db: Record<string, unknown>, preset: Record<string, unknown>) => {
    db.apiType = preset.apiType
    db.temperature = preset.temperature
    db.mainPrompt = preset.mainPrompt
    db.maxContext = preset.maxContext
    db.maxResponse = preset.maxResponse
    return db
  }),
}))

vi.mock('./commands', () => ({
  canUseServerCommands: () => true,
  patchSettingsObjectFieldsCommand: vi.fn(
    async (args: {
      baseRevision: number
      group: string
      key: string
      update: { patch: Record<string, unknown>; deleteKeys?: string[] }
      attemptedObject: Record<string, unknown>
      optimisticProjectionEpoch: number
    }) => {
      recorded.objectPatches.push(args)
      const queued = recorded.objectResults.shift()
      if (queued) return await queued
      return {
        status: 'ok',
        revision: args.baseRevision + 1,
        event: {
          type: 'settings.updated',
          revision: args.baseRevision + 1,
          resource: 'settings',
          id: args.group,
        },
        group: args.group,
        key: args.key,
        certificate: 'settings-object-patch-v1',
        patchedKeys: Object.keys(args.update.patch),
        deletedKeys: args.update.deleteKeys ?? [],
        canonicalValues: {},
        canonicalDeletedKeys: [],
      }
    },
  ),
  patchServerBackedSettings: vi.fn(
    async (args: {
      patch: Record<string, unknown>
      acknowledgeOptimistic?: boolean
      optimisticProjectionEpochs?: Record<string, number>
      rollback?: () => void
      keepalive?: boolean
      failureRollbackDisposition?: (result: { status: string }) => 'retain' | 'rollback'
    }) => {
      recorded.patches.push(args)
      const queued = recorded.patchResults.shift()
      const result = queued ? await queued : { status: 'ok', revision: 1 }
      if (
        (result as { status?: string }).status !== 'ok' &&
        (!args.failureRollbackDisposition ||
          args.failureRollbackDisposition(result as { status: string }) === 'rollback')
      ) {
        args.rollback?.()
      }
      return result
    },
  ),
  runServerCommand: vi.fn(
    async (args: {
      command: (baseRevision: number) => Promise<{ status: string }>
      rollback?: () => void
      failureRollbackDisposition?: (result: { status: string }) => 'retain' | 'rollback'
    }) => {
      const result = await args.command(1)
      if (
        result.status !== 'ok' &&
        (!args.failureRollbackDisposition || args.failureRollbackDisposition(result) === 'rollback')
      ) {
        args.rollback?.()
      }
      return result
    },
  ),
  subscribeServerCommandLocalEffectApplied: () => () => {},
  settingsGroupForKey: (key: string) => {
    if (key === 'NAIImgConfig' || key === 'wavespeedImage') return 'media'
    if (key === 'seperateParameters') return 'runtime'
    if (key === 'notification') return 'display'
    if (key === 'useAutoSuggestions') return 'sidebar'
    return new Set([
      'aiModel',
      'apiType',
      'autoTranslate',
      'banCharacterset',
      'claudeCachingExperimental',
      'customModels',
      'didFirstSetup',
      'globalscript',
      'hypaV3PresetId',
      'hypaV3Presets',
      'maxContext',
      'maxResponse',
      'notification',
      'openrouterRequestModel',
      'sdConfig',
      'subModel',
      'temperature',
      'textTheme',
      'translator',
      'translatorType',
      'useAutoSuggestions',
      'useAutoTranslateInput',
    ]).has(key)
      ? 'test'
      : null
  },
}))

vi.mock('./pendingMutationOutbox', () => ({
  acknowledgePendingMutation: vi.fn(async (handle: { mutationId: string }) => {
    durabilityMocks.acknowledged.push(handle)
    return 'deleted'
  }),
  stagePendingMutation: vi.fn(
    (key: string, intent: unknown, previous?: { mutationId: string; phase: string } | null) => {
      if (previous?.phase === 'staged') previous.phase = 'superseded'
      const sequence = durabilityMocks.nextId++
      const mutationId = `settings-mutation-${sequence}`
      const handle = {
        key,
        mutationId,
        sequence,
        ownerWriterSessionId: 'writer-a',
        writerEpoch: 1,
        databaseLineage: 'database-a',
        phase: 'staged',
        ready: Promise.resolve('persisted'),
      }
      durabilityMocks.staged.push({ key, mutationId, intent })
      return handle
    },
  ),
}))

vi.mock('./durableMutationDispatch', () => ({
  dispatchDurableMutation: vi.fn(
    async (
      handle: { key: string; mutationId: string; phase: string },
      intent: unknown,
      dispatch: (options: Record<string, unknown>) => Promise<unknown>,
    ) => {
      handle.phase = 'dispatching'
      durabilityMocks.dispatched.push({ key: handle.key, mutationId: handle.mutationId, intent })
      return dispatch({
        mutationId: handle.mutationId,
        databaseLineage: 'database-a',
        failureRollbackDisposition: () => (durabilityMocks.retainFailures ? 'retain' : 'rollback'),
      })
    },
  ),
}))

vi.mock('./resourceReads', () => ({
  fetchServerSettingsGroup: vi.fn(async () => recorded.groupReads.shift() ?? { status: 'error', error: 'test' }),
}))

vi.mock('../alert', () => ({
  alertError: alertMocks.alertError,
}))

vi.mock('./resourceWriteGuard.svelte', () => ({
  getServerResourceApplyEpoch: () => resourceGuardState.epoch,
  withServerResourceApply: (fn: () => unknown) => {
    resourceGuardState.epoch += 1
    return fn()
  },
  withTrustedResourceWrite: (fn: () => unknown) => fn(),
}))

vi.mock('../process/templates/templates', () => ({
  prebuiltPresets: {
    OAI: presetMocks.OAI,
    OAI2: presetMocks.OAI2,
  },
}))

import type { HypaV3Preset } from '../process/memory/hypav3'
import { language } from '../../lang'
import {
  applySettingsGroupResource,
  captureSettingsGroupProjectionEpoch,
  getResourceDatabase,
  hasSettingsGroupProjectionEpochChanged,
  replaceResourceDatabase,
} from './resourceState.svelte'
import type { Database } from '../storage/database.svelte'
import '../stores.svelte'
import { notifyServerCommandLocalEffectApplied } from './commandLocalEffectEvents'
import { setSettingsRuntimeProjectionHook } from './settingsRuntimeProjectionHooks'
import {
  applyOnboardingServerBackedSettings,
  applyServerBackedSettingsPatch,
  createServerBackedSettingDraft,
  flushPendingServerBackedSettingsPatch,
  persistServerBackedSettingsPatch,
  type ServerBackedSettingDraft,
  watchServerBackedSettings,
} from './settingsBridge.svelte'

const DELAY = 50

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve']
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

function sparseObjectAcceptedResult(input: (typeof recorded.objectPatches)[number]) {
  return {
    status: 'ok' as const,
    revision: input.baseRevision + 1,
    event: {
      type: 'settings.updated',
      revision: input.baseRevision + 1,
      resource: 'settings',
      id: input.group,
    },
    group: input.group,
    key: input.key,
    certificate: 'settings-object-patch-v1',
    patchedKeys: Object.keys(input.update.patch),
    deletedKeys: input.update.deleteKeys ?? [],
    canonicalValues: {},
    canonicalDeletedKeys: [],
  }
}

const testDatabaseState = {
  get db() {
    return getResourceDatabase()
  },
  set db(value: Database) {
    replaceResourceDatabase(value)
  },
}

function setupSettings(settings: Record<string, unknown>): void {
  ;(testDatabaseState as { db: unknown }).db = { ...settings }
}

function hypaPreset(name: string, settings: Record<string, unknown> = {}): HypaV3Preset {
  return {
    name,
    settings: {
      summarizationPrompt: `${name} prompt`,
      alwaysToggleOn: false,
      ...settings,
    },
  } as unknown as HypaV3Preset
}

async function createSettingDraft<T>(
  key: string,
  fallback: T,
): Promise<{ draft: ServerBackedSettingDraft<T>; stop: () => void }> {
  let draft: ServerBackedSettingDraft<T> | undefined
  const stop = $effect.root(() => {
    draft = createServerBackedSettingDraft(key, fallback, { delayMs: DELAY })
  })
  await flushAndSettle()
  if (!draft) {
    stop()
    throw new Error('setting draft was not initialized')
  }
  return { draft, stop }
}

async function flushAndSettle(): Promise<void> {
  flushSync()
  await Promise.resolve()
}

async function applyProjectionSetting(key: string, value: unknown): Promise<void> {
  resourceGuardState.epoch += 1
  ;(testDatabaseState.db as unknown as Record<string, unknown>)[key] = value
  await flushAndSettle()
}

beforeEach(() => {
  vi.useFakeTimers()
  recorded.patches.length = 0
  recorded.patchResults.length = 0
  recorded.objectPatches.length = 0
  recorded.objectResults.length = 0
  recorded.groupReads.length = 0
  resourceGuardState.epoch = 0
  alertMocks.alertError.mockClear()
  durabilityMocks.acknowledged.length = 0
  durabilityMocks.dispatched.length = 0
  durabilityMocks.nextId = 1
  durabilityMocks.retainFailures = false
  durabilityMocks.staged.length = 0
  presetMocks.setPreset.mockClear()
})

afterEach(() => {
  setSettingsRuntimeProjectionHook(null)
  vi.useRealTimers()
  ;(testDatabaseState as { db: unknown }).db = {}
})

describe('settingsBridge coalescing', () => {
  it('applies onboarding preset/settings and persists the full changed settings patch', async () => {
    const persistence = createDeferred<{ status: 'ok'; revision: number }>()
    recorded.patchResults.push(persistence.promise)
    setupSettings({
      language: 'cn',
      apiType: 'old-api',
      temperature: 0.2,
      mainPrompt: 'old prompt',
      maxContext: 4096,
      maxResponse: 256,
      textTheme: 'default',
      claudeCachingExperimental: false,
      aiModel: 'old-model',
      subModel: 'old-sub-model',
      openrouterRequestModel: 'old/openrouter',
      translator: 'en',
      autoTranslate: false,
      translatorType: 'deepl',
      useAutoTranslateInput: false,
      didFirstSetup: false,
      NAIsettings: {},
      seperateParameters: {
        emotion: {},
        memory: {},
        otherAx: {},
        overrides: {},
        scriptAux: {},
        scriptMain: {},
        translate: {},
      },
    })

    const setupResult = applyOnboardingServerBackedSettings({
      chatMemorySelection: 2,
      provider: 'openrouter',
      chatLang: 1,
    })
    await Promise.resolve()

    expect(testDatabaseState.db).toMatchObject({
      apiType: 'preset-api',
      temperature: 0.75,
      mainPrompt: 'preset prompt',
      maxContext: 12000,
      maxResponse: 800,
      textTheme: 'highcontrast',
      claudeCachingExperimental: true,
      aiModel: 'openrouter',
      subModel: 'openrouter',
      openrouterRequestModel: 'risu/free',
      translator: 'zh',
      autoTranslate: true,
      translatorType: 'google',
      useAutoTranslateInput: true,
      didFirstSetup: true,
    })
    expect(recorded.patches.map((entry) => entry.patch)).toEqual([
      {
        apiType: 'preset-api',
        temperature: 0.75,
        maxContext: 12000,
        maxResponse: 800,
        textTheme: 'highcontrast',
        claudeCachingExperimental: true,
        aiModel: 'openrouter',
        subModel: 'openrouter',
        openrouterRequestModel: 'risu/free',
        translator: 'zh',
        autoTranslate: true,
        translatorType: 'google',
        useAutoTranslateInput: true,
        didFirstSetup: true,
        seperateParameters: {
          emotion: {},
          memory: {},
          otherAx: {},
          overrides: {},
          scriptAux: {},
          scriptMain: {},
          translate: {},
        },
      },
    ])
    expect(recorded.patches[0].patch).not.toHaveProperty('mainPrompt')

    persistence.resolve({ status: 'ok', revision: 1 })
    expect(await setupResult).toBe(true)

    recorded.patches[0].rollback?.()
    expect(testDatabaseState.db).toMatchObject({
      apiType: 'old-api',
      temperature: 0.2,
      maxContext: 4096,
      maxResponse: 256,
      textTheme: 'default',
      claudeCachingExperimental: false,
      aiModel: 'old-model',
      subModel: 'old-sub-model',
      openrouterRequestModel: 'old/openrouter',
      translator: 'en',
      autoTranslate: false,
      translatorType: 'deepl',
      useAutoTranslateInput: false,
      didFirstSetup: false,
    })
  })

  it('keeps the WelcomeRisu component free of direct trusted projection writes', () => {
    const source = readFileSync('src/lib/Others/WelcomeRisu.svelte', 'utf8')

    expect(source).toContain('applyOnboardingServerBackedSettings')
    expect(source).not.toContain('withTrustedResourceWrite')
  })

  it('settles BotSettings prompt drafts through owner-aware applied receipts', () => {
    const source = readFileSync('src/lib/Setting/Pages/BotSettings.svelte', 'utf8')
    const promptDraftStart = source.indexOf('function createPromptFieldDraft')
    const promptOwnerStart = source.indexOf('function promptFieldOwnerSignature', promptDraftStart)
    const promptDraftSource = source.slice(promptDraftStart, promptOwnerStart)

    expect(promptDraftStart).toBeGreaterThanOrEqual(0)
    expect(promptOwnerStart).toBeGreaterThan(promptDraftStart)
    expect(promptDraftSource).toContain('subscribeServerCommandLocalEffectApplied')
    expect(promptDraftSource).toContain('appliedLocalEffectAcknowledgesSettingDraft')
    expect(promptDraftSource).toContain("splitPresetProjection: 'presetRow'")
    expect(promptDraftSource).toContain('currentPromptFieldValue(key, fallback)')
  })

  it('skips immediate patches whose values already match the projection', async () => {
    setupSettings({
      notification: true,
      sdConfig: { steps: 20, sampler: 'euler' },
    })

    applyServerBackedSettingsPatch({
      notification: true,
      sdConfig: { steps: 20, sampler: 'euler' },
    })
    await Promise.resolve()

    expect(recorded.patches).toHaveLength(0)
    expect(testDatabaseState.db).toMatchObject({
      notification: true,
      sdConfig: { steps: 20, sampler: 'euler' },
    })
  })

  it('sends only changed keys from immediate mixed patches', async () => {
    setupSettings({
      notification: true,
      useAutoSuggestions: false,
    })

    applyServerBackedSettingsPatch({
      notification: true,
      useAutoSuggestions: true,
    })
    await Promise.resolve()

    expect(recorded.patches.map((entry) => entry.patch)).toEqual([{ useAutoSuggestions: true }])
    expect(testDatabaseState.db).toMatchObject({
      notification: true,
      useAutoSuggestions: true,
    })
  })

  it('reports an ordinary settings write failure once while preserving rollback', async () => {
    recorded.patchResults.push({ status: 'error', error: 'failed' })
    setupSettings({ notification: false })

    applyServerBackedSettingsPatch({ notification: true })
    await flushAndSettle()
    await flushAndSettle()

    expect(testDatabaseState.db.notification).toBe(false)
    expect(alertMocks.alertError).toHaveBeenCalledTimes(1)
    expect(alertMocks.alertError).toHaveBeenCalledWith(language.errors.settingsSaveFailed)

    recorded.patches[0].rollback?.()
    expect(alertMocks.alertError).toHaveBeenCalledTimes(1)
  })

  it('cancels older same-key debounced patches when an immediate patch supersedes them', async () => {
    setupSettings({ notification: false })
    const stop = watchServerBackedSettings(['notification'], { delayMs: DELAY * 10 })
    flushSync()

    testDatabaseState.db.notification = true
    flushSync()

    applyServerBackedSettingsPatch({ notification: false })
    flushSync()
    await Promise.resolve()

    expect(recorded.patches.map((entry) => entry.patch)).toEqual([{ notification: false }])

    await vi.advanceTimersByTimeAsync(DELAY * 10)
    expect(recorded.patches.map((entry) => entry.patch)).toEqual([{ notification: false }])
    stop()
  })

  it('L23: direct settings patches suppress watcher echoes for optimistic writes and rollback writes', async () => {
    setupSettings({ notification: false })
    const stop = watchServerBackedSettings(['notification'], { delayMs: DELAY })
    flushSync()

    applyServerBackedSettingsPatch({ notification: true })
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(recorded.patches.map((entry) => entry.patch)).toEqual([{ notification: true }])
    expect(testDatabaseState.db.notification).toBe(true)

    recorded.patches[0].rollback?.()
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(testDatabaseState.db.notification).toBe(false)
    expect(recorded.patches.map((entry) => entry.patch)).toEqual([{ notification: true }])
    stop()
  })

  it('skips rollback for a setting after a newer same-key local edit', async () => {
    setupSettings({ textTheme: 'before' })

    applyServerBackedSettingsPatch({ textTheme: 'attempted' })
    await Promise.resolve()

    testDatabaseState.db.textTheme = 'newer local'
    recorded.patches[0].rollback?.()

    expect(testDatabaseState.db.textTheme).toBe('newer local')
  })

  it('restores only still-attempted keys from a multi-key settings rollback', async () => {
    setupSettings({
      notification: false,
      textTheme: 'before',
    })

    applyServerBackedSettingsPatch({
      notification: true,
      textTheme: 'attempted',
    })
    await Promise.resolve()

    testDatabaseState.db.textTheme = 'newer local'
    recorded.patches[0].rollback?.()

    expect(testDatabaseState.db.notification).toBe(false)
    expect(testDatabaseState.db.textTheme).toBe('newer local')
  })

  it('reapplies runtime effects only for setting fields actually rolled back', async () => {
    const projectedKeys: string[][] = []
    setSettingsRuntimeProjectionHook((keys) => projectedKeys.push([...keys]))
    setupSettings({
      notification: false,
      textTheme: 'before',
    })

    applyServerBackedSettingsPatch({
      notification: true,
      textTheme: 'attempted',
    })
    await Promise.resolve()

    testDatabaseState.db.textTheme = 'newer local'
    recorded.patches[0].rollback?.()

    expect(testDatabaseState.db.notification).toBe(false)
    expect(testDatabaseState.db.textTheme).toBe('newer local')
    expect(projectedKeys).toEqual([['notification']])
  })

  it('rebases a later same-key rollback after two immediate settings writes fail', async () => {
    const firstResult = createDeferred<unknown>()
    const secondResult = createDeferred<unknown>()
    recorded.patchResults.push(firstResult.promise, secondResult.promise)
    setupSettings({ textTheme: 'server baseline' })

    applyServerBackedSettingsPatch({ textTheme: 'first attempt' })
    applyServerBackedSettingsPatch({ textTheme: 'second attempt' })
    await flushAndSettle()

    expect(testDatabaseState.db.textTheme).toBe('second attempt')
    expect(recorded.patches.map((entry) => entry.patch)).toEqual([
      { textTheme: 'first attempt' },
      { textTheme: 'second attempt' },
    ])

    firstResult.resolve({ status: 'error', error: 'first failed' })
    await flushAndSettle()
    expect(testDatabaseState.db.textTheme).toBe('second attempt')

    secondResult.resolve({ status: 'error', error: 'second failed' })
    await flushAndSettle()
    expect(testDatabaseState.db.textTheme).toBe('server baseline')
  })

  it('rebases a queued same-key rollback when an in-flight settings write fails', async () => {
    const firstResult = createDeferred<unknown>()
    const secondResult = createDeferred<unknown>()
    recorded.patchResults.push(firstResult.promise, secondResult.promise)
    setupSettings({ textTheme: 'server baseline' })
    const stop = watchServerBackedSettings(['textTheme'], { delayMs: DELAY })
    flushSync()

    applyServerBackedSettingsPatch({ textTheme: 'first attempt' })
    await flushAndSettle()
    testDatabaseState.db.textTheme = 'second attempt'
    flushSync()

    firstResult.resolve({ status: 'error', error: 'first failed' })
    await flushAndSettle()
    expect(testDatabaseState.db.textTheme).toBe('second attempt')

    await vi.advanceTimersByTimeAsync(DELAY)
    expect(recorded.patches.map((entry) => entry.patch)).toEqual([
      { textTheme: 'first attempt' },
      { textTheme: 'second attempt' },
    ])

    secondResult.resolve({ status: 'error', error: 'second failed' })
    await flushAndSettle()
    expect(testDatabaseState.db.textTheme).toBe('server baseline')
    stop()
  })

  it('preserves the existing undefined/no-delete behavior when rolling back an added setting', async () => {
    setupSettings({})

    applyServerBackedSettingsPatch({ textTheme: 'attempted' })
    await Promise.resolve()

    expect(testDatabaseState.db.textTheme).toBe('attempted')

    recorded.patches[0].rollback?.()

    expect(Object.hasOwn(testDatabaseState.db, 'textTheme')).toBe(true)
    expect(testDatabaseState.db.textTheme).toBeUndefined()
  })

  it('awaits the exact durable Hypa import patch before resolving success', async () => {
    const persistence = createDeferred<unknown>()
    recorded.patchResults.push(persistence.promise)
    setupSettings({
      hypaV3Presets: [hypaPreset('Alpha')],
      hypaV3PresetId: 0,
    })

    let settled = false
    const result = persistServerBackedSettingsPatch({
      hypaV3Presets: [hypaPreset('Alpha'), hypaPreset('Imported')],
      hypaV3PresetId: 1,
    }).then((accepted) => {
      settled = true
      return accepted
    })
    await flushAndSettle()

    expect(settled).toBe(false)
    expect(testDatabaseState.db.hypaV3Presets).toEqual([hypaPreset('Alpha'), hypaPreset('Imported')])
    expect(testDatabaseState.db.hypaV3PresetId).toBe(1)
    expect(recorded.patches.map((entry) => entry.patch)).toEqual([
      {
        hypaV3Presets: [hypaPreset('Alpha'), hypaPreset('Imported')],
        hypaV3PresetId: 1,
      },
    ])

    persistence.resolve({ status: 'ok', revision: 1 })
    expect(await result).toBe(true)
  })

  it('rolls back and rejects a terminal durable Hypa import', async () => {
    recorded.patchResults.push({ status: 'error', error: 'failed' })
    setupSettings({
      hypaV3Presets: [hypaPreset('Alpha')],
      hypaV3PresetId: 0,
    })

    const accepted = await persistServerBackedSettingsPatch({
      hypaV3Presets: [hypaPreset('Alpha'), hypaPreset('Imported')],
      hypaV3PresetId: 1,
    })

    expect(accepted).toBe(false)
    expect(testDatabaseState.db.hypaV3Presets).toEqual([hypaPreset('Alpha')])
    expect(testDatabaseState.db.hypaV3PresetId).toBe(0)
    expect(alertMocks.alertError).toHaveBeenCalledTimes(1)
  })

  it('does not claim a retained durable Hypa import was accepted or roll back its pending projection', async () => {
    durabilityMocks.retainFailures = true
    recorded.patchResults.push({ status: 'error', error: 'temporarily unavailable' })
    setupSettings({
      hypaV3Presets: [hypaPreset('Alpha')],
      hypaV3PresetId: 0,
    })

    const accepted = await persistServerBackedSettingsPatch({
      hypaV3Presets: [hypaPreset('Alpha'), hypaPreset('Imported')],
      hypaV3PresetId: 1,
    })

    expect(accepted).toBe(false)
    expect(testDatabaseState.db.hypaV3Presets).toEqual([hypaPreset('Alpha'), hypaPreset('Imported')])
    expect(testDatabaseState.db.hypaV3PresetId).toBe(1)
    expect(alertMocks.alertError).toHaveBeenCalledTimes(1)
  })

  it('removes only the failed Hypa V3 appended preset while preserving sibling edits and later appends', async () => {
    setupSettings({
      hypaV3Presets: [hypaPreset('Alpha'), hypaPreset('Beta')],
    })

    applyServerBackedSettingsPatch({
      hypaV3Presets: [hypaPreset('Alpha'), hypaPreset('Beta'), hypaPreset('Imported')],
    })
    await Promise.resolve()

    testDatabaseState.db.hypaV3Presets = [
      hypaPreset('Alpha', { summarizationPrompt: 'newer alpha prompt' }),
      hypaPreset('Beta'),
      hypaPreset('Imported'),
      hypaPreset('Later local'),
    ]
    recorded.patches[0].rollback?.()

    expect(testDatabaseState.db.hypaV3Presets).toEqual([
      hypaPreset('Alpha', { summarizationPrompt: 'newer alpha prompt' }),
      hypaPreset('Beta'),
      hypaPreset('Later local'),
    ])
  })

  it('keeps a failed Hypa V3 appended preset when that row changed after dispatch', async () => {
    setupSettings({
      hypaV3Presets: [hypaPreset('Alpha')],
    })

    applyServerBackedSettingsPatch({
      hypaV3Presets: [hypaPreset('Alpha'), hypaPreset('Imported')],
    })
    await Promise.resolve()

    testDatabaseState.db.hypaV3Presets = [
      hypaPreset('Alpha'),
      hypaPreset('Imported', { summarizationPrompt: 'edited after dispatch' }),
      hypaPreset('Later local'),
    ]
    recorded.patches[0].rollback?.()

    expect(testDatabaseState.db.hypaV3Presets).toEqual([
      hypaPreset('Alpha'),
      hypaPreset('Imported', { summarizationPrompt: 'edited after dispatch' }),
      hypaPreset('Later local'),
    ])
  })

  it('restores only the failed Hypa V3 renamed row while preserving sibling edits', async () => {
    setupSettings({
      hypaV3Presets: [hypaPreset('Alpha'), hypaPreset('Beta')],
    })
    const renamedAlpha = { ...hypaPreset('Alpha'), name: 'Alpha renamed' }

    applyServerBackedSettingsPatch({
      hypaV3Presets: [renamedAlpha, hypaPreset('Beta')],
    })
    await Promise.resolve()

    testDatabaseState.db.hypaV3Presets = [
      renamedAlpha,
      hypaPreset('Beta', { summarizationPrompt: 'newer beta prompt' }),
      hypaPreset('Later local'),
    ]
    recorded.patches[0].rollback?.()

    expect(testDatabaseState.db.hypaV3Presets).toEqual([
      hypaPreset('Alpha'),
      hypaPreset('Beta', { summarizationPrompt: 'newer beta prompt' }),
      hypaPreset('Later local'),
    ])
  })

  it('reinserts a failed Hypa V3 deleted preset at its prior index and restores attempted-matching selection', async () => {
    setupSettings({
      hypaV3Presets: [hypaPreset('Alpha'), hypaPreset('Beta'), hypaPreset('Gamma')],
      hypaV3PresetId: 1,
    })

    applyServerBackedSettingsPatch({
      hypaV3Presets: [hypaPreset('Alpha'), hypaPreset('Gamma')],
      hypaV3PresetId: 0,
    })
    await Promise.resolve()

    testDatabaseState.db.hypaV3Presets = [
      hypaPreset('Alpha', { summarizationPrompt: 'newer alpha prompt' }),
      hypaPreset('Gamma'),
      hypaPreset('Later local'),
    ]
    testDatabaseState.db.hypaV3PresetId = 0
    recorded.patches[0].rollback?.()

    expect(testDatabaseState.db.hypaV3Presets).toEqual([
      hypaPreset('Alpha', { summarizationPrompt: 'newer alpha prompt' }),
      hypaPreset('Beta'),
      hypaPreset('Gamma'),
      hypaPreset('Later local'),
    ])
    expect(testDatabaseState.db.hypaV3PresetId).toBe(1)
  })

  it('rebases newer live Hypa V3 selection when a failed delete rollback reinserts before it', async () => {
    setupSettings({
      hypaV3Presets: [hypaPreset('Alpha'), hypaPreset('Beta'), hypaPreset('Gamma'), hypaPreset('Delta')],
      hypaV3PresetId: 1,
    })

    applyServerBackedSettingsPatch({
      hypaV3Presets: [hypaPreset('Alpha'), hypaPreset('Gamma'), hypaPreset('Delta')],
      hypaV3PresetId: 0,
    })
    await Promise.resolve()

    testDatabaseState.db.hypaV3PresetId = 2
    recorded.patches[0].rollback?.()

    expect(testDatabaseState.db.hypaV3Presets).toEqual([
      hypaPreset('Alpha'),
      hypaPreset('Beta'),
      hypaPreset('Gamma'),
      hypaPreset('Delta'),
    ])
    expect(testDatabaseState.db.hypaV3PresetId).toBe(3)
  })

  it('does not duplicate a failed Hypa V3 deleted preset when an equivalent row is already live', async () => {
    setupSettings({
      hypaV3Presets: [hypaPreset('Alpha'), hypaPreset('Beta'), hypaPreset('Gamma')],
      hypaV3PresetId: 1,
    })

    applyServerBackedSettingsPatch({
      hypaV3Presets: [hypaPreset('Alpha'), hypaPreset('Gamma')],
      hypaV3PresetId: 0,
    })
    await Promise.resolve()

    testDatabaseState.db.hypaV3Presets = [hypaPreset('Alpha'), hypaPreset('Gamma'), hypaPreset('Beta')]
    testDatabaseState.db.hypaV3PresetId = 0
    recorded.patches[0].rollback?.()

    expect(testDatabaseState.db.hypaV3Presets).toEqual([hypaPreset('Alpha'), hypaPreset('Gamma'), hypaPreset('Beta')])
    expect(testDatabaseState.db.hypaV3PresetId).toBe(0)
  })

  it('keeps selection-only Hypa V3 preset id patches on the generic rollback path', async () => {
    setupSettings({
      hypaV3Presets: [hypaPreset('Alpha'), hypaPreset('Beta')],
      hypaV3PresetId: 0,
    })

    applyServerBackedSettingsPatch({ hypaV3PresetId: 1 })
    await Promise.resolve()

    recorded.patches[0].rollback?.()

    expect(testDatabaseState.db.hypaV3PresetId).toBe(0)
    expect(testDatabaseState.db.hypaV3Presets).toEqual([hypaPreset('Alpha'), hypaPreset('Beta')])
  })

  it('L23: queued settings rollback suppresses watcher echoes for debounced writes', async () => {
    setupSettings({ notification: false })
    const stop = watchServerBackedSettings(['notification'], { delayMs: DELAY })
    flushSync()

    testDatabaseState.db.notification = true
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(recorded.patches.map((entry) => entry.patch)).toEqual([{ notification: true }])

    recorded.patches[0].rollback?.()
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(testDatabaseState.db.notification).toBe(false)
    expect(recorded.patches.map((entry) => entry.patch)).toEqual([{ notification: true }])

    testDatabaseState.db.notification = true
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(recorded.patches.map((entry) => entry.patch)).toEqual([{ notification: true }, { notification: true }])
    stop()
  })

  it('coalesces watched settings into one debounced command', async () => {
    setupSettings({
      notification: false,
      useAutoSuggestions: false,
    })
    const stop = watchServerBackedSettings(['notification', 'useAutoSuggestions'], {
      delayMs: DELAY,
    })
    flushSync()

    testDatabaseState.db.notification = true
    flushSync()
    testDatabaseState.db.useAutoSuggestions = true
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(recorded.patches.map((entry) => entry.patch)).toEqual([{ notification: true, useAutoSuggestions: true }])
    stop()
  })

  it('keeps a scalar correction in the absolute closure while another field remains dirty', async () => {
    setupSettings({
      notification: false,
      useAutoSuggestions: false,
    })
    const stop = watchServerBackedSettings(['notification', 'useAutoSuggestions'], {
      delayMs: DELAY,
    })
    flushSync()

    testDatabaseState.db.notification = true
    flushSync()
    testDatabaseState.db.useAutoSuggestions = true
    flushSync()
    testDatabaseState.db.notification = false
    flushSync()

    const stagedRequests = (durabilityMocks.staged.at(-1)?.intent as { requests?: unknown[] }).requests
    expect(durabilityMocks.staged.at(-1)?.key).toBe('settings:bridge')
    expect(stagedRequests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: '/settings/display', body: { patch: { notification: false } } }),
        expect.objectContaining({
          path: '/settings/sidebar',
          body: { patch: { useAutoSuggestions: true } },
        }),
      ]),
    )

    await vi.advanceTimersByTimeAsync(DELAY)
    expect(recorded.patches.map((entry) => entry.patch)).toEqual([{ notification: false, useAutoSuggestions: true }])
    stop()
  })

  it('merges an immediate setting apply with pending same-field and sibling work', async () => {
    setupSettings({
      notification: false,
      useAutoSuggestions: false,
    })
    const stop = watchServerBackedSettings(['notification', 'useAutoSuggestions'], {
      delayMs: DELAY,
    })
    flushSync()

    testDatabaseState.db.notification = true
    flushSync()
    testDatabaseState.db.useAutoSuggestions = true
    flushSync()
    applyServerBackedSettingsPatch({ notification: false })
    await flushAndSettle()

    expect(recorded.patches.map((entry) => entry.patch)).toEqual([{ notification: false, useAutoSuggestions: true }])
    const dispatchedRequests = (durabilityMocks.dispatched.at(-1)?.intent as { requests?: unknown[] }).requests
    expect(durabilityMocks.dispatched.at(-1)?.key).toBe('settings:bridge')
    expect(dispatchedRequests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: '/settings/display', body: { patch: { notification: false } } }),
        expect.objectContaining({
          path: '/settings/sidebar',
          body: { patch: { useAutoSuggestions: true } },
        }),
      ]),
    )

    await vi.advanceTimersByTimeAsync(DELAY)
    expect(recorded.patches).toHaveLength(1)
    stop()
  })

  it('retains the intent-time group epoch across an authoritative apply before debounce dispatch', async () => {
    setupSettings({ notification: false })
    const stop = watchServerBackedSettings(['notification'], { delayMs: DELAY })
    flushSync()
    const intentEpoch = captureSettingsGroupProjectionEpoch('display')

    testDatabaseState.db.notification = true
    flushSync()
    resourceGuardState.epoch += 1
    expect(
      applySettingsGroupResource(
        {
          revision: 1,
          group: 'display',
          settings: { notification: false },
        },
        ['notification'],
      ),
    ).toBe(true)
    flushSync()
    expect(hasSettingsGroupProjectionEpochChanged('display', intentEpoch)).toBe(true)

    await vi.advanceTimersByTimeAsync(DELAY)

    expect(recorded.patches).toHaveLength(1)
    expect(recorded.patches[0]).toMatchObject({
      patch: { notification: true },
      acknowledgeOptimistic: true,
      optimisticProjectionEpochs: { display: intentEpoch },
    })
    stop()
  })

  it('sends only changed fields from large watched settings objects', async () => {
    const original = {
      width: 512,
      height: 768,
      vibe_data: { thumbnail: 'x'.repeat(20_000) },
    }
    setupSettings({ NAIImgConfig: original })
    const stop = watchServerBackedSettings(['NAIImgConfig'], { delayMs: DELAY })
    flushSync()
    ;(testDatabaseState.db as unknown as Record<string, unknown>).NAIImgConfig = { ...original, width: 832 }
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)
    await flushAndSettle()

    expect(recorded.patches).toHaveLength(0)
    expect(recorded.objectPatches).toHaveLength(1)
    expect(recorded.objectPatches[0]).toMatchObject({
      group: 'media',
      key: 'NAIImgConfig',
      update: { patch: { width: 832 } },
    })
    expect(recorded.objectPatches[0].attemptedObject).toEqual({ ...original, width: 832 })
    stop()
  })

  it('dispatches an immediate sparse correction when the desired object returns to baseline', async () => {
    const original = { width: 512, height: 768 }
    setupSettings({ NAIImgConfig: original })
    const stop = watchServerBackedSettings(['NAIImgConfig'], { delayMs: DELAY })
    flushSync()
    ;(testDatabaseState.db as unknown as Record<string, unknown>).NAIImgConfig = { ...original, width: 832 }
    flushSync()
    ;(testDatabaseState.db as unknown as Record<string, unknown>).NAIImgConfig = original
    flushSync()
    await flushAndSettle()

    expect(recorded.objectPatches).toHaveLength(1)
    expect(recorded.objectPatches[0]).toMatchObject({
      update: { patch: { width: 512 } },
      attemptedObject: original,
    })
    expect(durabilityMocks.dispatched.at(-1)).toMatchObject({
      key: 'settings:bridge',
      intent: {
        requests: [{ body: { patch: { width: 512 } } }],
      },
    })

    await vi.advanceTimersByTimeAsync(DELAY)
    expect(recorded.objectPatches).toHaveLength(1)
    stop()
  })

  it('keeps sparse delete corrections in the absolute closure while fields remain dirty', async () => {
    const original = { width: 512, height: 768 }
    setupSettings({ NAIImgConfig: original })
    const stop = watchServerBackedSettings(['NAIImgConfig'], { delayMs: DELAY })
    flushSync()
    ;(testDatabaseState.db as unknown as Record<string, unknown>).NAIImgConfig = {
      ...original,
      width: 832,
      temporary: 'staged value',
    }
    flushSync()
    ;(testDatabaseState.db as unknown as Record<string, unknown>).NAIImgConfig = {
      ...original,
      width: 832,
      height: 1024,
    }
    flushSync()

    expect(durabilityMocks.staged.at(-1)).toMatchObject({
      key: 'settings:bridge',
      intent: {
        requests: [
          {
            body: {
              patch: { width: 832, height: 1024 },
              deleteKeys: ['temporary'],
            },
          },
        ],
      },
    })

    await vi.advanceTimersByTimeAsync(DELAY)
    await flushAndSettle()
    expect(recorded.objectPatches).toHaveLength(1)
    expect(recorded.objectPatches[0]).toMatchObject({
      update: {
        patch: { width: 832, height: 1024 },
        deleteKeys: ['temporary'],
      },
      attemptedObject: { ...original, width: 832, height: 1024 },
    })
    stop()
  })

  it('retains the sparse-object intent epoch across an authoritative apply before dispatch', async () => {
    const original = { width: 512, height: 768 }
    setupSettings({ NAIImgConfig: original })
    const stop = watchServerBackedSettings(['NAIImgConfig'], { delayMs: DELAY })
    flushSync()
    const intentEpoch = captureSettingsGroupProjectionEpoch('media')

    ;(testDatabaseState.db as unknown as Record<string, unknown>).NAIImgConfig = { ...original, width: 832 }
    flushSync()
    resourceGuardState.epoch += 1
    expect(
      applySettingsGroupResource(
        {
          revision: 1,
          group: 'media',
          settings: { NAIImgConfig: original as never },
        },
        ['NAIImgConfig'],
      ),
    ).toBe(true)
    flushSync()
    expect(hasSettingsGroupProjectionEpochChanged('media', intentEpoch)).toBe(true)

    await vi.advanceTimersByTimeAsync(DELAY)
    await flushAndSettle()

    expect(recorded.objectPatches).toHaveLength(1)
    expect(recorded.objectPatches[0]).toMatchObject({
      group: 'media',
      key: 'NAIImgConfig',
      update: { patch: { width: 832 } },
      optimisticProjectionEpoch: intentEpoch,
    })
    stop()
  })

  it('keeps a durable sparse-object projection visible after a retryable failure', async () => {
    const original = { width: 512, height: 768 }
    const attempted = { width: 832, height: 768 }
    durabilityMocks.retainFailures = true
    recorded.objectResults.push({ status: 'error', error: 'temporarily unavailable' })
    recorded.groupReads.push({
      status: 'ok',
      revision: Number.MAX_SAFE_INTEGER,
      group: 'media',
      settings: { NAIImgConfig: original },
    })
    setupSettings({ NAIImgConfig: original })
    const stop = watchServerBackedSettings(['NAIImgConfig'], { delayMs: DELAY })
    flushSync()
    ;(testDatabaseState.db as unknown as Record<string, unknown>).NAIImgConfig = attempted
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)
    for (let index = 0; index < 4; index += 1) await flushAndSettle()

    expect(recorded.objectPatches).toHaveLength(1)
    expect(testDatabaseState.db.NAIImgConfig).toEqual(attempted)
    expect(recorded.groupReads).toHaveLength(1)
    stop()
  })

  it('rebases a later field edit after an earlier sparse object write fails', async () => {
    const original = {
      width: 512,
      height: 768,
      vibe_data: { thumbnail: 'x'.repeat(20_000) },
    }
    const firstResult = createDeferred<unknown>()
    recorded.objectResults.push(firstResult.promise)
    recorded.groupReads.push({
      status: 'ok',
      revision: Number.MAX_SAFE_INTEGER,
      group: 'media',
      settings: { NAIImgConfig: original },
    })
    setupSettings({ NAIImgConfig: original })
    const stop = watchServerBackedSettings(['NAIImgConfig'], { delayMs: DELAY })
    flushSync()
    ;(testDatabaseState.db as unknown as Record<string, unknown>).NAIImgConfig = { ...original, width: 832 }
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)
    await flushAndSettle()
    expect(recorded.objectPatches).toHaveLength(1)
    ;(testDatabaseState.db as unknown as Record<string, unknown>).NAIImgConfig = {
      ...original,
      width: 832,
      height: 1024,
    }
    flushSync()
    firstResult.resolve({ status: 'error', error: 'failed' })
    for (let index = 0; index < 8; index += 1) await flushAndSettle()

    expect(recorded.objectPatches).toHaveLength(2)
    expect(recorded.objectPatches[1]).toMatchObject({
      group: 'media',
      key: 'NAIImgConfig',
      update: { patch: { height: 1024 } },
      attemptedObject: { ...original, height: 1024 },
    })
    expect(testDatabaseState.db.NAIImgConfig).toEqual({ ...original, height: 1024 })
    stop()
  })

  it('preserves a field deliberately returned to the in-flight sparse value after failure', async () => {
    const original = { width: 512, height: 768 }
    const firstResult = createDeferred<unknown>()
    recorded.objectResults.push(firstResult.promise)
    recorded.groupReads.push({
      status: 'ok',
      revision: Number.MAX_SAFE_INTEGER,
      group: 'media',
      settings: { NAIImgConfig: original },
    })
    setupSettings({ NAIImgConfig: original })
    const stop = watchServerBackedSettings(['NAIImgConfig'], { delayMs: DELAY })
    flushSync()
    ;(testDatabaseState.db as unknown as Record<string, unknown>).NAIImgConfig = { ...original, width: 832 }
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)
    await flushAndSettle()
    ;(testDatabaseState.db as unknown as Record<string, unknown>).NAIImgConfig = { ...original, width: 1024 }
    flushSync()
    ;(testDatabaseState.db as unknown as Record<string, unknown>).NAIImgConfig = {
      ...original,
      width: 832,
      height: 1024,
    }
    flushSync()
    firstResult.resolve({ status: 'error', error: 'failed' })
    for (let index = 0; index < 8; index += 1) await flushAndSettle()

    expect(recorded.objectPatches).toHaveLength(2)
    expect(recorded.objectPatches[1]).toMatchObject({
      update: { patch: { width: 832, height: 1024 } },
      attemptedObject: { ...original, width: 832, height: 1024 },
    })
    expect(testDatabaseState.db.NAIImgConfig).toEqual({ ...original, width: 832, height: 1024 })
    stop()
  })

  it('restages an in-flight sparse successor with the exact desired revert intent', async () => {
    const original = { width: 512, height: 768 }
    const firstResult = createDeferred<unknown>()
    recorded.objectResults.push(firstResult.promise)
    setupSettings({ NAIImgConfig: original })
    const stop = watchServerBackedSettings(['NAIImgConfig'], { delayMs: DELAY })
    flushSync()
    ;(testDatabaseState.db as unknown as Record<string, unknown>).NAIImgConfig = { ...original, width: 832 }
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)
    expect(recorded.objectPatches).toHaveLength(1)
    ;(testDatabaseState.db as unknown as Record<string, unknown>).NAIImgConfig = { ...original, width: 1024 }
    flushSync()
    const staleSuccessor = durabilityMocks.staged.at(-1)
    expect(staleSuccessor?.intent).toMatchObject({
      requests: [{ body: { patch: { width: 1024 } } }],
    })
    ;(testDatabaseState.db as unknown as Record<string, unknown>).NAIImgConfig = original
    flushSync()
    expect(durabilityMocks.staged.at(-1)).toMatchObject({
      key: 'settings:bridge',
      intent: { requests: [{ body: { patch: { width: 512 } } }] },
    })
    expect(durabilityMocks.acknowledged).toHaveLength(0)

    firstResult.resolve(sparseObjectAcceptedResult(recorded.objectPatches[0]))
    for (let index = 0; index < 8; index += 1) await flushAndSettle()

    expect(recorded.objectPatches).toHaveLength(2)
    expect(recorded.objectPatches[1]).toMatchObject({
      group: 'media',
      key: 'NAIImgConfig',
      update: { patch: { width: 512 } },
      attemptedObject: original,
    })
    expect(durabilityMocks.dispatched.at(-1)).toMatchObject({
      intent: {
        requests: [{ body: { patch: { width: 512 } } }],
      },
    })
    stop()
  })

  it('deletes an in-flight sparse successor that rebases to a no-op after failure', async () => {
    const original = { width: 512, height: 768 }
    const firstResult = createDeferred<unknown>()
    recorded.objectResults.push(firstResult.promise)
    recorded.groupReads.push({
      status: 'ok',
      revision: Number.MAX_SAFE_INTEGER,
      group: 'media',
      settings: { NAIImgConfig: original },
    })
    setupSettings({ NAIImgConfig: original })
    const stop = watchServerBackedSettings(['NAIImgConfig'], { delayMs: DELAY })
    flushSync()
    ;(testDatabaseState.db as unknown as Record<string, unknown>).NAIImgConfig = { ...original, width: 832 }
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)
    expect(recorded.objectPatches).toHaveLength(1)
    ;(testDatabaseState.db as unknown as Record<string, unknown>).NAIImgConfig = { ...original, width: 1024 }
    flushSync()
    ;(testDatabaseState.db as unknown as Record<string, unknown>).NAIImgConfig = original
    flushSync()
    const correction = durabilityMocks.staged.at(-1)

    firstResult.resolve({ status: 'error', error: 'failed' })
    for (let index = 0; index < 8; index += 1) await flushAndSettle()

    expect(recorded.objectPatches).toHaveLength(1)
    expect(testDatabaseState.db.NAIImgConfig).toEqual(original)
    expect(durabilityMocks.acknowledged).toEqual(
      expect.arrayContaining([expect.objectContaining({ mutationId: correction?.mutationId })]),
    )
    const replayableStaleSuccessor = durabilityMocks.staged.find(
      (entry) =>
        entry.mutationId === correction?.mutationId &&
        !durabilityMocks.acknowledged.some((acknowledged) => acknowledged.mutationId === entry.mutationId),
    )
    expect(replayableStaleSuccessor).toBeUndefined()
    stop()
  })

  it('reports a sparse-object settings write failure once while reconciling the authoritative value', async () => {
    const original = { width: 512, height: 768 }
    recorded.objectResults.push({ status: 'error', error: 'failed' })
    recorded.groupReads.push({
      status: 'ok',
      revision: Number.MAX_SAFE_INTEGER,
      group: 'media',
      settings: { NAIImgConfig: original },
    })
    setupSettings({ NAIImgConfig: original })
    const stop = watchServerBackedSettings(['NAIImgConfig'], { delayMs: DELAY })
    flushSync()
    ;(testDatabaseState.db as unknown as Record<string, unknown>).NAIImgConfig = { ...original, width: 832 }
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)
    for (let index = 0; index < 8; index += 1) await flushAndSettle()

    expect(testDatabaseState.db.NAIImgConfig).toEqual(original)
    expect(alertMocks.alertError).toHaveBeenCalledTimes(1)
    expect(alertMocks.alertError).toHaveBeenCalledWith(language.errors.settingsSaveFailed)
    stop()
  })

  it('M8: flushes pending watched settings with keepalive and clears the debounce', async () => {
    setupSettings({ notification: false })
    const stop = watchServerBackedSettings(['notification'], { delayMs: DELAY * 10 })
    flushSync()

    testDatabaseState.db.notification = true
    flushSync()
    flushPendingServerBackedSettingsPatch({ keepalive: true })
    await Promise.resolve()

    expect(
      recorded.patches.map((entry) => ({
        patch: entry.patch,
        keepalive: entry.keepalive,
      })),
    ).toEqual([{ patch: { notification: true }, keepalive: true }])
    expect(durabilityMocks.staged).toContainEqual({
      key: 'settings:bridge',
      mutationId: expect.any(String),
      intent: {
        version: 1,
        requests: [{ method: 'PATCH', path: '/settings/display', body: { patch: { notification: true } } }],
      },
    })
    expect(durabilityMocks.dispatched).toEqual([
      expect.objectContaining({ key: 'settings:bridge', intent: durabilityMocks.staged.at(-1)?.intent }),
    ])

    await vi.advanceTimersByTimeAsync(DELAY * 10)
    expect(recorded.patches).toHaveLength(1)
    stop()
  })

  it('M8: watcher teardown flushes pending watched settings and clears the debounce', async () => {
    setupSettings({ notification: false })
    const stop = watchServerBackedSettings(['notification'], { delayMs: DELAY * 10 })
    flushSync()

    testDatabaseState.db.notification = true
    flushSync()
    stop()
    await Promise.resolve()

    expect(recorded.patches.map((entry) => entry.patch)).toEqual([{ notification: true }])
    expect(recorded.patches[0].keepalive).toBeUndefined()

    await vi.advanceTimersByTimeAsync(DELAY * 10)
    expect(recorded.patches).toHaveLength(1)
  })

  it('dispatches an immediate durable correction when a watched setting returns to baseline', async () => {
    setupSettings({ notification: false })
    const stop = watchServerBackedSettings(['notification'], { delayMs: DELAY })
    flushSync()

    testDatabaseState.db.notification = true
    flushSync()
    testDatabaseState.db.notification = false
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(recorded.patches.map((entry) => entry.patch)).toEqual([{ notification: false }])
    expect(durabilityMocks.dispatched.at(-1)).toMatchObject({
      key: 'settings:bridge',
      intent: {
        requests: [{ method: 'PATCH', path: '/settings/display', body: { patch: { notification: false } } }],
      },
    })
    stop()
  })

  it('refreshes watcher baselines for server projection updates before local edits', async () => {
    setupSettings({ notification: false })
    const stop = watchServerBackedSettings(['notification'], { delayMs: DELAY })
    flushSync()

    resourceGuardState.epoch += 1
    testDatabaseState.db.notification = true
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)
    expect(recorded.patches).toHaveLength(0)

    testDatabaseState.db.notification = false
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)
    expect(recorded.patches.map((entry) => entry.patch)).toEqual([{ notification: false }])
    stop()
  })

  it('preserves a dirty setting draft through a stale projection', async () => {
    setupSettings({
      globalscript: [{ id: 'script-a', in: 'server old', out: '', type: 'editinput' }],
    })
    const { draft, stop } = await createSettingDraft('globalscript', [] as Array<Record<string, string>>)

    draft.value = [{ id: 'script-a', in: 'local dirty', out: '', type: 'editinput' }]
    await flushAndSettle()

    await applyProjectionSetting('globalscript', [{ id: 'script-a', in: 'stale server', out: '', type: 'editinput' }])

    expect(draft.value).toEqual([{ id: 'script-a', in: 'local dirty', out: '', type: 'editinput' }])
    await vi.advanceTimersByTimeAsync(DELAY)
    stop()
  })

  it('rebases an ID-addressable draft and its staged patch over an authoritative sibling edit', async () => {
    const baseline = [
      { id: 'model-a', name: 'Model A', url: 'https://old-a.example' },
      { id: 'model-b', name: 'Model B', url: 'https://old-b.example' },
    ]
    setupSettings({ customModels: baseline })
    const { draft, stop } = await createSettingDraft('customModels', [] as Array<Record<string, string>>)

    draft.value = [{ ...baseline[0], url: 'https://local-a.example' }, baseline[1]]
    await flushAndSettle()
    await applyProjectionSetting('customModels', [
      baseline[0],
      { ...baseline[1], url: 'https://authoritative-b.example' },
    ])

    const rebased = [
      { ...baseline[0], url: 'https://local-a.example' },
      { ...baseline[1], url: 'https://authoritative-b.example' },
    ]
    expect(draft.value).toEqual(rebased)
    expect(testDatabaseState.db.customModels).toEqual(rebased)

    await vi.advanceTimersByTimeAsync(DELAY)
    expect(recorded.patches.map((entry) => entry.patch)).toEqual([{ customModels: rebased }])
    expect(durabilityMocks.dispatched.at(-1)?.intent).toMatchObject({
      requests: [{ body: { patch: { customModels: rebased } } }],
    })
    stop()
  })

  it('rebases independent set additions before dispatch', async () => {
    setupSettings({ banCharacterset: ['baseline'] })
    const { draft, stop } = await createSettingDraft('banCharacterset', [] as string[])

    draft.value = ['baseline', 'local addition']
    await flushAndSettle()
    await applyProjectionSetting('banCharacterset', ['baseline', 'authoritative addition'])

    expect(draft.value).toEqual(['baseline', 'authoritative addition', 'local addition'])
    await vi.advanceTimersByTimeAsync(DELAY)
    expect(recorded.patches.map((entry) => entry.patch)).toEqual([
      { banCharacterset: ['baseline', 'authoritative addition', 'local addition'] },
    ])
    stop()
  })

  it('rebases a nested object field over authoritative sibling changes', async () => {
    const baseline = {
      provider: { endpoint: 'old endpoint', timeout: 30 },
      output: { width: 512, height: 768 },
    }
    setupSettings({ sdConfig: baseline })
    const { draft, stop } = await createSettingDraft('sdConfig', {} as Record<string, unknown>)

    draft.value = {
      ...baseline,
      provider: { ...baseline.provider, endpoint: 'local endpoint' },
    }
    await flushAndSettle()
    await applyProjectionSetting('sdConfig', {
      ...baseline,
      output: { width: 1024, height: 768 },
    })

    const rebased = {
      provider: { endpoint: 'local endpoint', timeout: 30 },
      output: { width: 1024, height: 768 },
    }
    expect(draft.value).toEqual(rebased)
    await vi.advanceTimersByTimeAsync(DELAY)
    expect(recorded.patches.map((entry) => entry.patch)).toEqual([{ sdConfig: rebased }])
    stop()
  })

  it('rejects ambiguous concurrent row reorders before dispatch', async () => {
    const rowA = { id: 'a', name: 'A' }
    const rowB = { id: 'b', name: 'B' }
    const rowC = { id: 'c', name: 'C' }
    setupSettings({ customModels: [rowA, rowB, rowC] })
    const { draft, stop } = await createSettingDraft('customModels', [] as Array<Record<string, string>>)

    draft.value = [rowB, rowA, rowC]
    await flushAndSettle()
    await applyProjectionSetting('customModels', [rowA, rowC, rowB])

    expect(draft.value).toEqual([rowA, rowC, rowB])
    expect(testDatabaseState.db.customModels).toEqual([rowA, rowC, rowB])
    expect(alertMocks.alertError).toHaveBeenCalledWith(language.errors.settingsSaveFailed)
    await vi.advanceTimersByTimeAsync(DELAY)
    expect(recorded.patches).toHaveLength(0)
    stop()
  })

  it('adopts a canonical value from the applied local effect for its own setting attempt', async () => {
    setupSettings({ textTheme: 'server initial' })
    const { draft, stop } = await createSettingDraft('textTheme', '')

    draft.value = 'attempted theme'
    await flushAndSettle()
    await vi.advanceTimersByTimeAsync(DELAY)

    resourceGuardState.epoch += 1
    testDatabaseState.db.textTheme = 'canonical theme'
    notifyServerCommandLocalEffectApplied(
      {
        type: 'settings.updated',
        revision: 2,
        resource: 'settings',
        id: 'display',
      },
      {
        kind: 'settingsPatch',
        group: 'display',
        attemptedPatch: { textTheme: 'attempted theme' },
        settings: { textTheme: 'canonical theme' },
        settingsProjectionEpoch: 0,
      },
    )
    await flushAndSettle()

    expect(draft.value).toBe('canonical theme')
    expect(testDatabaseState.db.textTheme).toBe('canonical theme')
    stop()
  })

  it('preserves a dirty draft when an older receipt skipped its canonical field', async () => {
    setupSettings({ textTheme: 'server initial' })
    const { draft, stop } = await createSettingDraft('textTheme', '')

    draft.value = 'attempted theme'
    await flushAndSettle()
    await vi.advanceTimersByTimeAsync(DELAY)

    resourceGuardState.epoch += 1
    testDatabaseState.db.textTheme = 'newer resource value'
    notifyServerCommandLocalEffectApplied(
      {
        type: 'settings.updated',
        revision: 2,
        resource: 'settings',
        id: 'display',
      },
      {
        kind: 'settingsPatch',
        group: 'display',
        attemptedPatch: { textTheme: 'attempted theme' },
        settings: { textTheme: 'canonical theme' },
        settingsProjectionEpoch: 0,
      },
    )
    await flushAndSettle()

    expect(draft.value).toBe('attempted theme')
    expect(testDatabaseState.db.textTheme).toBe('attempted theme')
    stop()
  })

  it('supports a normalized draft whose persistence is owned by a specialized bridge', async () => {
    setupSettings({ globalscript: [{ in: 'old', out: '', type: 'editinput' }] })
    let draft: ServerBackedSettingDraft<Array<Record<string, string>>> | undefined
    const stop = $effect.root(() => {
      draft = createServerBackedSettingDraft('globalscript', [], {
        delayMs: DELAY,
        dispatch: false,
        normalizeDraft: (scripts) => scripts.map((script) => ({ id: script.id ?? 'generated-id', ...script })),
      })
    })
    await flushAndSettle()

    expect(draft?.value).toEqual([{ id: 'generated-id', in: 'old', out: '', type: 'editinput' }])
    draft!.value = [{ id: 'generated-id', in: 'edited', out: '', type: 'editinput' }]
    await flushAndSettle()
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(testDatabaseState.db.globalscript).toEqual([
      { id: 'generated-id', in: 'edited', out: '', type: 'editinput' },
    ])
    expect(recorded.patches).toEqual([])
    stop()
  })

  it('reasserts a dirty setting draft value to testDatabaseState after a stale projection overwrites it', async () => {
    setupSettings({
      globalscript: [{ id: 'script-a', in: 'server old', out: '', type: 'editinput' }],
    })
    const { draft, stop } = await createSettingDraft('globalscript', [] as Array<Record<string, string>>)

    draft.value = [{ id: 'script-a', in: 'local dirty', out: '', type: 'editinput' }]
    await flushAndSettle()

    await applyProjectionSetting('globalscript', [{ id: 'script-a', in: 'stale server', out: '', type: 'editinput' }])

    expect(testDatabaseState.db.globalscript).toEqual([
      { id: 'script-a', in: 'local dirty', out: '', type: 'editinput' },
    ])

    await vi.advanceTimersByTimeAsync(DELAY)
    expect(recorded.patches.map((entry) => entry.patch)).toEqual([
      {
        globalscript: [{ id: 'script-a', in: 'local dirty', out: '', type: 'editinput' }],
      },
    ])
    stop()
  })

  it('does not clear dirty state from projection equality alone', async () => {
    setupSettings({
      globalscript: [{ id: 'script-a', in: 'server old', out: '', type: 'editinput' }],
    })
    const { draft, stop } = await createSettingDraft('globalscript', [] as Array<Record<string, string>>)

    draft.value = [{ id: 'script-a', in: 'local accepted', out: '', type: 'editinput' }]
    await flushAndSettle()

    await applyProjectionSetting('globalscript', [{ id: 'script-a', in: 'local accepted', out: '', type: 'editinput' }])
    await applyProjectionSetting('globalscript', [{ id: 'script-a', in: 'server later', out: '', type: 'editinput' }])

    expect(draft.value).toEqual([{ id: 'script-a', in: 'local accepted', out: '', type: 'editinput' }])
    expect(testDatabaseState.db.globalscript).toEqual([
      { id: 'script-a', in: 'local accepted', out: '', type: 'editinput' },
    ])
    stop()
  })

  it('keeps a newer dirty draft fenced after an older acknowledgement', async () => {
    setupSettings({ textTheme: 'A' })
    const { draft, stop } = await createSettingDraft('textTheme', '')

    draft.value = 'B'
    await flushAndSettle()
    draft.value = 'C'
    await flushAndSettle()

    resourceGuardState.epoch += 1
    notifyServerCommandLocalEffectApplied(
      {
        type: 'settings.updated',
        revision: 2,
        resource: 'settings',
        id: 'test',
      },
      {
        kind: 'settingsPatch',
        group: 'display',
        attemptedPatch: { textTheme: 'B' },
        settings: { textTheme: 'B' },
        settingsProjectionEpoch: 0,
      },
    )
    await flushAndSettle()
    await applyProjectionSetting('textTheme', 'B')

    expect(draft.value).toBe('C')
    expect(testDatabaseState.db.textTheme).toBe('C')
    stop()
  })

  it('reseeds a clean setting draft from a later server projection', async () => {
    setupSettings({
      globalscript: [{ id: 'script-a', in: 'server old', out: '', type: 'editinput' }],
    })
    const { draft, stop } = await createSettingDraft('globalscript', [] as Array<Record<string, string>>)

    await applyProjectionSetting('globalscript', [{ id: 'script-a', in: 'clean server', out: '', type: 'editinput' }])

    expect(draft.value).toEqual([{ id: 'script-a', in: 'clean server', out: '', type: 'editinput' }])
    stop()
  })
})
