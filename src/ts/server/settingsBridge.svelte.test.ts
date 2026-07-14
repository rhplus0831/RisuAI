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
    }) => {
      recorded.patches.push(args)
      return { status: 'ok', revision: 1 }
    },
  ),
  runServerCommand: vi.fn(
    async (args: { command: (baseRevision: number) => Promise<{ status: string }>; rollback?: () => void }) => {
      const result = await args.command(1)
      if (result.status !== 'ok') args.rollback?.()
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
      'claudeCachingExperimental',
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

vi.mock('./resourceReads', () => ({
  fetchServerSettingsGroup: vi.fn(async () => recorded.groupReads.shift() ?? { status: 'error', error: 'test' }),
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
import {
  applySettingsGroupResource,
  captureSettingsGroupProjectionEpoch,
  getResourceDatabase,
  hasSettingsGroupProjectionEpochChanged,
  replaceResourceDatabase,
} from './resourceState.svelte'
import type { Database } from '../storage/database.svelte'
import '../stores.svelte'
import {
  applyOnboardingServerBackedSettings,
  applyServerBackedSettingsPatch,
  createServerBackedSettingDraft,
  flushPendingServerBackedSettingsPatch,
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
  recorded.objectPatches.length = 0
  recorded.objectResults.length = 0
  recorded.groupReads.length = 0
  resourceGuardState.epoch = 0
  presetMocks.setPreset.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
  ;(testDatabaseState as { db: unknown }).db = {}
})

describe('settingsBridge coalescing', () => {
  it('applies onboarding preset/settings and persists the full changed settings patch', async () => {
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

    applyOnboardingServerBackedSettings({
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

  it('preserves the existing undefined/no-delete behavior when rolling back an added setting', async () => {
    setupSettings({})

    applyServerBackedSettingsPatch({ textTheme: 'attempted' })
    await Promise.resolve()

    expect(testDatabaseState.db.textTheme).toBe('attempted')

    recorded.patches[0].rollback?.()

    expect(Object.hasOwn(testDatabaseState.db, 'textTheme')).toBe(true)
    expect(testDatabaseState.db.textTheme).toBeUndefined()
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

  it('drops watched settings when the final value returns to the original baseline', async () => {
    setupSettings({ notification: false })
    const stop = watchServerBackedSettings(['notification'], { delayMs: DELAY })
    flushSync()

    testDatabaseState.db.notification = true
    flushSync()
    testDatabaseState.db.notification = false
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(recorded.patches).toHaveLength(0)
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

  it('clears dirty state when projection matches the setting draft value', async () => {
    setupSettings({
      globalscript: [{ id: 'script-a', in: 'server old', out: '', type: 'editinput' }],
    })
    const { draft, stop } = await createSettingDraft('globalscript', [] as Array<Record<string, string>>)

    draft.value = [{ id: 'script-a', in: 'local accepted', out: '', type: 'editinput' }]
    await flushAndSettle()

    await applyProjectionSetting('globalscript', [{ id: 'script-a', in: 'local accepted', out: '', type: 'editinput' }])
    await applyProjectionSetting('globalscript', [{ id: 'script-a', in: 'server later', out: '', type: 'editinput' }])

    expect(draft.value).toEqual([{ id: 'script-a', in: 'server later', out: '', type: 'editinput' }])
    expect(testDatabaseState.db.globalscript).toEqual([
      { id: 'script-a', in: 'server later', out: '', type: 'editinput' },
    ])
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
