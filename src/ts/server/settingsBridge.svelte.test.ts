import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushSync } from 'svelte'

const recorded = vi.hoisted(() => ({
  patches: [] as Array<{
    patch: Record<string, unknown>
    rollback?: () => void
    keepalive?: boolean
  }>,
}))
const projectionGuardState = vi.hoisted(() => ({ epoch: 0 }))
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
  patchServerBackedSettings: vi.fn(
    async (args: { patch: Record<string, unknown>; rollback?: () => void; keepalive?: boolean }) => {
      recorded.patches.push(args)
      return { status: 'ok', revision: 1 }
    },
  ),
  settingsGroupForKey: (key: string) =>
    new Set([
      'aiModel',
      'apiType',
      'autoTranslate',
      'claudeCachingExperimental',
      'didFirstSetup',
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
      : null,
}))

vi.mock('./projectionWriteGuard.svelte', () => ({
  getServerProjectionApplyEpoch: () => projectionGuardState.epoch,
  withTrustedServerProjectionWrite: (fn: () => unknown) => fn(),
}))

vi.mock('../process/templates/templates', () => ({
  prebuiltPresets: {
    OAI: presetMocks.OAI,
    OAI2: presetMocks.OAI2,
  },
}))

vi.mock('../storage/database.svelte', () => ({
  appVer: 'test',
  defaultSdDataFunc: () => ({}),
  getCurrentCharacter: () => null,
  getCurrentChat: () => null,
  getDatabase: () => ({}),
  setDatabase: vi.fn(),
  setPreset: presetMocks.setPreset,
}))

import { DBState } from '../stores.svelte'
import {
  applyOnboardingServerBackedSettings,
  applyServerBackedSettingsPatch,
  flushPendingServerBackedSettingsPatch,
  watchServerBackedSettings,
} from './settingsBridge.svelte'

const DELAY = 50

function setupSettings(settings: Record<string, unknown>): void {
  ;(DBState as { db: unknown }).db = { ...settings }
}

beforeEach(() => {
  vi.useFakeTimers()
  recorded.patches.length = 0
  projectionGuardState.epoch = 0
  presetMocks.setPreset.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
  ;(DBState as { db: unknown }).db = {}
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
    })

    applyOnboardingServerBackedSettings({
      chatMemorySelection: 2,
      provider: 'openrouter',
      chatLang: 1,
    })
    await Promise.resolve()

    expect(presetMocks.setPreset).toHaveBeenCalledWith(expect.any(Object), presetMocks.OAI2)
    expect(DBState.db).toMatchObject({
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
      },
    ])
    expect(recorded.patches[0].patch).not.toHaveProperty('mainPrompt')

    recorded.patches[0].rollback?.()
    expect(DBState.db).toMatchObject({
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
    expect(source).not.toContain('withTrustedServerProjectionWrite')
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
    expect(DBState.db).toMatchObject({
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
    expect(DBState.db).toMatchObject({
      notification: true,
      useAutoSuggestions: true,
    })
  })

  it('cancels older same-key debounced patches when an immediate patch supersedes them', async () => {
    setupSettings({ notification: false })
    const stop = watchServerBackedSettings(['notification'], { delayMs: DELAY * 10 })
    flushSync()

    DBState.db.notification = true
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
    expect(DBState.db.notification).toBe(true)

    recorded.patches[0].rollback?.()
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(DBState.db.notification).toBe(false)
    expect(recorded.patches.map((entry) => entry.patch)).toEqual([{ notification: true }])
    stop()
  })

  it('skips rollback for a setting after a newer same-key local edit', async () => {
    setupSettings({ textTheme: 'before' })

    applyServerBackedSettingsPatch({ textTheme: 'attempted' })
    await Promise.resolve()

    DBState.db.textTheme = 'newer local'
    recorded.patches[0].rollback?.()

    expect(DBState.db.textTheme).toBe('newer local')
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

    DBState.db.textTheme = 'newer local'
    recorded.patches[0].rollback?.()

    expect(DBState.db.notification).toBe(false)
    expect(DBState.db.textTheme).toBe('newer local')
  })

  it('preserves the existing undefined/no-delete behavior when rolling back an added setting', async () => {
    setupSettings({})

    applyServerBackedSettingsPatch({ textTheme: 'attempted' })
    await Promise.resolve()

    expect(DBState.db.textTheme).toBe('attempted')

    recorded.patches[0].rollback?.()

    expect(Object.hasOwn(DBState.db, 'textTheme')).toBe(true)
    expect(DBState.db.textTheme).toBeUndefined()
  })

  it('L23: queued settings rollback suppresses watcher echoes for debounced writes', async () => {
    setupSettings({ notification: false })
    const stop = watchServerBackedSettings(['notification'], { delayMs: DELAY })
    flushSync()

    DBState.db.notification = true
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(recorded.patches.map((entry) => entry.patch)).toEqual([{ notification: true }])

    recorded.patches[0].rollback?.()
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(DBState.db.notification).toBe(false)
    expect(recorded.patches.map((entry) => entry.patch)).toEqual([{ notification: true }])

    DBState.db.notification = true
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

    DBState.db.notification = true
    flushSync()
    DBState.db.useAutoSuggestions = true
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(recorded.patches.map((entry) => entry.patch)).toEqual([{ notification: true, useAutoSuggestions: true }])
    stop()
  })

  it('M8: flushes pending watched settings with keepalive and clears the debounce', async () => {
    setupSettings({ notification: false })
    const stop = watchServerBackedSettings(['notification'], { delayMs: DELAY * 10 })
    flushSync()

    DBState.db.notification = true
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

    DBState.db.notification = true
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

    DBState.db.notification = true
    flushSync()
    DBState.db.notification = false
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(recorded.patches).toHaveLength(0)
    stop()
  })

  it('refreshes watcher baselines for server projection updates before local edits', async () => {
    setupSettings({ notification: false })
    const stop = watchServerBackedSettings(['notification'], { delayMs: DELAY })
    flushSync()

    projectionGuardState.epoch += 1
    DBState.db.notification = true
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)
    expect(recorded.patches).toHaveLength(0)

    DBState.db.notification = false
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)
    expect(recorded.patches.map((entry) => entry.patch)).toEqual([{ notification: false }])
    stop()
  })
})
