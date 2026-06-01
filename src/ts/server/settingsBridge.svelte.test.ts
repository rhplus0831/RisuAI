import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushSync } from 'svelte'

const recorded = vi.hoisted(() => ({
  patches: [] as Array<{ patch: Record<string, unknown>; rollback?: () => void }>,
}))
const projectionGuardState = vi.hoisted(() => ({ epoch: 0 }))

vi.mock('./commands', () => ({
  canUseServerCommands: () => true,
  patchServerBackedSettings: vi.fn(
    async (args: { patch: Record<string, unknown>; rollback?: () => void }) => {
      recorded.patches.push(args)
      return { status: 'ok', revision: 1 }
    },
  ),
  settingsGroupForKey: (key: string) =>
    new Set(['notification', 'useAutoSuggestions', 'sdConfig']).has(key) ? 'test' : null,
}))

vi.mock('./projectionWriteGuard.svelte', () => ({
  getServerProjectionApplyEpoch: () => projectionGuardState.epoch,
  withTrustedServerProjectionWrite: (fn: () => unknown) => fn(),
}))

import { DBState } from '../stores.svelte'
import {
  applyServerBackedSettingsPatch,
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
})

afterEach(() => {
  vi.useRealTimers()
  ;(DBState as { db: unknown }).db = {}
})

describe('settingsBridge coalescing', () => {
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

    expect(recorded.patches.map((entry) => entry.patch)).toEqual([
      { useAutoSuggestions: true },
    ])
    expect(DBState.db).toMatchObject({
      notification: true,
      useAutoSuggestions: true,
    })
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

    expect(recorded.patches.map((entry) => entry.patch)).toEqual([
      { notification: true, useAutoSuggestions: true },
    ])
    stop()
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
