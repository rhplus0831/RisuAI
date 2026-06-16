import { untrack } from 'svelte'
import { prebuiltPresets } from '../process/templates/templates'
import { mirrorTopLevelPresetField } from '../presetFieldMirror'
import { setPreset } from '../storage/database.svelte'
import { DBState } from '../stores.svelte'
import {
  canUseServerCommands,
  patchServerBackedSettings,
  settingsGroupForKey,
  type SettingsPatch,
  type ServerCommandTransportOptions,
} from './commands'
import { getServerProjectionApplyEpoch, withTrustedServerProjectionWrite } from './projectionWriteGuard.svelte'
import { applyAttemptedFieldRollback } from './staleStateGuards'

interface PendingSettingsPatch {
  patch: SettingsPatch
  previous: SettingsPatch
  attempted: SettingsPatch
  timer: ReturnType<typeof setTimeout> | null
}

const pendingSettingsPatch: PendingSettingsPatch = {
  patch: {},
  previous: {},
  attempted: {},
  timer: null,
}

let suppressRollbackDispatch = false

export interface WatchServerBackedSettingsOptions {
  delayMs?: number
}

export interface ServerBackedSettingDraft<T> {
  value: T
}

export interface ApplyOnboardingServerBackedSettingsOptions {
  chatMemorySelection: number
  provider: string
  chatLang: number
}

export function applyServerBackedSetting(key: string, value: unknown): void {
  applyServerBackedSettingsPatch({ [key]: value })
}

export function createServerBackedSettingDraft<T>(
  key: string,
  fallback: T,
  options: WatchServerBackedSettingsOptions = {},
): ServerBackedSettingDraft<T> {
  const initialValue = currentSettingValue(key, fallback)
  const draft = $state<ServerBackedSettingDraft<T>>({ value: cloneJsonValue(initialValue) })
  const delayMs = options.delayMs ?? 250
  let initialized = false
  let suppressDraftDispatch = false
  let previousServerSnapshot = snapshotJson(initialValue)

  $effect(() => {
    const serverValue = currentSettingValue(key, fallback)
    const serverSnapshot = snapshotJson(serverValue)
    const draftSnapshot = snapshotJson(draft.value)

    if (serverSnapshot !== previousServerSnapshot && serverSnapshot !== draftSnapshot) {
      suppressDraftDispatch = true
      draft.value = cloneJsonValue(serverValue)
      queueMicrotask(() => {
        suppressDraftDispatch = false
      })
    }

    previousServerSnapshot = serverSnapshot
  })

  $effect(() => {
    const snapshot = snapshotJson(draft.value)
    if (!initialized) {
      initialized = true
      return
    }
    if (suppressDraftDispatch) return

    untrack(() => {
      if (!settingsGroupForKey(key)) return
      const attempted = cloneJsonValue(draft.value)
      const previous = cloneJsonValue((DBState.db as unknown as Record<string, unknown>)[key])
      withTrustedServerProjectionWrite(() => {
        // Re-read DBState.db inside the callback: the trusted write swaps it to
        // a mutable clone, so an alias captured earlier still points at the
        // read-only projection and would throw on write.
        const target = DBState.db as unknown as Record<string, unknown>
        target[key] = attempted
      })
      const mirroredToPreset = mirrorTopLevelPresetField(key, attempted)
      if (!mirroredToPreset) {
        queueSettingsPatch({ [key]: attempted }, { [key]: previous }, delayMs)
      }
      previousServerSnapshot = snapshot
    })
  })

  return draft
}

export function applyServerBackedSettingsPatch(patch: SettingsPatch): void {
  const commandPatch: SettingsPatch = {}
  const previous: SettingsPatch = {}
  const attempted: SettingsPatch = {}

  const currentSettings = DBState.db as unknown as Record<string, unknown>
  for (const [key, value] of Object.entries(patch)) {
    if (!settingsGroupForKey(key) || value === undefined) continue
    const currentValue = currentSettings[key]
    if (snapshotJson(currentValue) === snapshotJson(value)) continue
    previous[key] = cloneJsonValue(currentValue)
    attempted[key] = cloneJsonValue(value)
    commandPatch[key] = cloneJsonValue(value)
  }

  if (Object.keys(commandPatch).length === 0) return

  dropPendingSettingsPatchKeys(Object.keys(commandPatch))

  withSuppressedSettingsWatcher(() => {
    withTrustedServerProjectionWrite(() => {
      const target = DBState.db as unknown as Record<string, unknown>
      for (const [key, value] of Object.entries(commandPatch)) {
        target[key] = cloneJsonValue(value)
      }
    })
  })

  dispatchServerBackedSettingsPatch(commandPatch, previous, attempted)
}

export function applyOnboardingServerBackedSettings(options: ApplyOnboardingServerBackedSettingsOptions): void {
  const patch = buildOnboardingSettingsPatch(options)
  const beforeSetup = snapshotServerBackedSettings(DBState.db as unknown as Record<string, unknown>)
  let fullPatch: SettingsPatch = {}
  let previous: SettingsPatch = {}
  let attempted: SettingsPatch = {}

  withSuppressedSettingsWatcher(() => {
    withTrustedServerProjectionWrite(() => {
      DBState.db = setPreset(DBState.db, prebuiltPresets.OAI2)
      Object.assign(DBState.db as unknown as Record<string, unknown>, patch)

      const diff = diffServerBackedSettingsSnapshot(beforeSetup, DBState.db as unknown as Record<string, unknown>)
      fullPatch = diff.patch
      previous = diff.previous
      attempted = diff.attempted
    })
  })

  dispatchServerBackedSettingsPatch(fullPatch, previous, attempted)
}

function dispatchServerBackedSettingsPatch(
  commandPatch: SettingsPatch,
  previous: SettingsPatch,
  attempted: SettingsPatch,
): void {
  if (Object.keys(commandPatch).length === 0) return

  void patchServerBackedSettings({
    patch: commandPatch,
    rollback: () => rollbackServerBackedSettings(previous, attempted),
  })
}

export function watchServerBackedSettings(
  keys: readonly string[],
  options: WatchServerBackedSettingsOptions = {},
): () => void {
  if (!canUseServerCommands()) return () => {}

  const trackedKeys = Array.from(new Set(keys)).filter((key) => settingsGroupForKey(key))
  if (trackedKeys.length === 0) return () => {}

  const delayMs = options.delayMs ?? 250
  const previousSnapshots = new Map<string, string>()
  const previousValues = new Map<string, unknown>()
  let initialized = false
  let previousProjectionApplyEpoch = getServerProjectionApplyEpoch()

  const stop = $effect.root(() => {
    $effect(() => {
      const projectionApplyEpoch = getServerProjectionApplyEpoch()
      const changed: SettingsPatch = {}
      const before: SettingsPatch = {}

      for (const key of trackedKeys) {
        const value = (DBState.db as unknown as Record<string, unknown> | undefined)?.[key]
        const snapshot = snapshotJson(value)
        const previousSnapshot = previousSnapshots.get(key)

        if (initialized && snapshot !== previousSnapshot) {
          changed[key] = cloneJsonValue(value)
          before[key] = cloneJsonValue(previousValues.get(key))
        }

        previousSnapshots.set(key, snapshot)
        previousValues.set(key, cloneJsonValue(value))
      }

      if (!initialized || projectionApplyEpoch !== previousProjectionApplyEpoch) {
        initialized = true
        previousProjectionApplyEpoch = projectionApplyEpoch
        return
      }
      if (suppressRollbackDispatch || Object.keys(changed).length === 0) return

      untrack(() => queueSettingsPatch(changed, before, delayMs))
    })
  })

  return () => {
    flushPendingServerBackedSettingsPatch()
    stop()
  }
}

function queueSettingsPatch(patch: SettingsPatch, previous: SettingsPatch, delay: number): void {
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in pendingSettingsPatch.previous)) {
      pendingSettingsPatch.previous[key] = previous[key]
    }
    if (snapshotJson(value) === snapshotJson(pendingSettingsPatch.previous[key])) {
      delete pendingSettingsPatch.patch[key]
      delete pendingSettingsPatch.previous[key]
      delete pendingSettingsPatch.attempted[key]
      continue
    }
    pendingSettingsPatch.patch[key] = value
    pendingSettingsPatch.attempted[key] = value
  }

  if (pendingSettingsPatch.timer) clearTimeout(pendingSettingsPatch.timer)
  if (Object.keys(pendingSettingsPatch.patch).length === 0) {
    pendingSettingsPatch.timer = null
    return
  }
  pendingSettingsPatch.timer = setTimeout(() => {
    dispatchPendingSettingsPatch()
  }, delay)
}

function dropPendingSettingsPatchKeys(keys: readonly string[]): void {
  let dropped = false
  for (const key of keys) {
    if (
      key in pendingSettingsPatch.patch ||
      key in pendingSettingsPatch.previous ||
      key in pendingSettingsPatch.attempted
    ) {
      dropped = true
    }
    delete pendingSettingsPatch.patch[key]
    delete pendingSettingsPatch.previous[key]
    delete pendingSettingsPatch.attempted[key]
  }

  if (dropped && pendingSettingsPatch.timer && Object.keys(pendingSettingsPatch.patch).length === 0) {
    clearTimeout(pendingSettingsPatch.timer)
    pendingSettingsPatch.timer = null
  }
}

export function flushPendingServerBackedSettingsPatch(options: ServerCommandTransportOptions = {}): void {
  dispatchPendingSettingsPatch(options)
}

function dispatchPendingSettingsPatch(options: ServerCommandTransportOptions = {}): void {
  if (pendingSettingsPatch.timer) {
    clearTimeout(pendingSettingsPatch.timer)
    pendingSettingsPatch.timer = null
  }
  const commandPatch = pendingSettingsPatch.patch
  const commandPrevious = pendingSettingsPatch.previous
  const commandAttempted = pendingSettingsPatch.attempted
  pendingSettingsPatch.patch = {}
  pendingSettingsPatch.previous = {}
  pendingSettingsPatch.attempted = {}

  if (Object.keys(commandPatch).length === 0) return

  void patchServerBackedSettings({
    patch: commandPatch,
    keepalive: options.keepalive,
    signal: options.signal,
    rollback: () => rollbackServerBackedSettings(commandPrevious, commandAttempted),
  })
}

function rollbackServerBackedSettings(previous: SettingsPatch, attempted: SettingsPatch): void {
  withSuppressedSettingsWatcher(() => {
    rollbackSettings(previous, attempted)
  })
}

function withSuppressedSettingsWatcher(fn: () => void): void {
  suppressRollbackDispatch = true
  try {
    fn()
  } finally {
    queueMicrotask(() => {
      suppressRollbackDispatch = false
    })
  }
}

function rollbackSettings(previous: SettingsPatch, attempted: SettingsPatch): void {
  withTrustedServerProjectionWrite(() => {
    const target = DBState.db as unknown as Record<string, unknown>
    applyAttemptedFieldRollback({
      target,
      previous,
      attempted,
    })
  })
}

function buildOnboardingSettingsPatch(options: ApplyOnboardingServerBackedSettingsOptions): SettingsPatch {
  const patch: SettingsPatch = {
    textTheme: 'highcontrast',
    claudeCachingExperimental: true,
  }

  switch (options.chatMemorySelection) {
    case 0: {
      patch.maxContext = 16000
      patch.maxResponse = 1000
      break
    }
    case 1: {
      patch.maxContext = 8000
      patch.maxResponse = 500
      break
    }
    case 2: {
      patch.maxContext = 12000
      patch.maxResponse = 800
      break
    }
    case 3: {
      patch.maxContext = 100000
      patch.maxResponse = 1000
      break
    }
  }

  if (options.provider === 'claude') {
    patch.aiModel = 'claude-3-5-sonnet-20241022'
    patch.subModel = 'claude-3-5-sonnet-20241022'
  }

  if (options.provider === 'openai') {
    patch.aiModel = 'gpt4o-chatgpt'
    patch.subModel = 'gpt4o-chatgpt'
  }

  if (options.provider === 'openrouter') {
    patch.aiModel = 'openrouter'
    patch.subModel = 'openrouter'
    patch.openrouterRequestModel = 'risu/free'
  }

  if (options.provider === 'horde') {
    patch.aiModel = 'horde:::auto'
    patch.subModel = 'horde:::auto'
  }

  if (options.chatLang !== 0) {
    const translator = onboardingTranslatorForLanguage(String(DBState.db.language ?? ''))
    if (translator) patch.translator = translator
  }

  if (options.chatLang === 1) {
    patch.autoTranslate = true
    patch.translatorType = 'google'
    patch.useAutoTranslateInput = true
  }

  patch.didFirstSetup = true
  return patch
}

function onboardingTranslatorForLanguage(language: string): string | null {
  switch (language) {
    case 'de':
      return 'de'
    case 'en':
      return 'en'
    case 'ko':
      return 'ko'
    case 'cn':
      return 'zh'
    case 'vi':
      return 'vi'
    case 'zh-Hant':
      return 'zh-TW'
    default:
      return null
  }
}

interface ServerBackedSettingsSnapshotEntry {
  snapshot: string
  value: unknown
}

function snapshotServerBackedSettings(
  settings: Record<string, unknown>,
): Map<string, ServerBackedSettingsSnapshotEntry> {
  const snapshot = new Map<string, ServerBackedSettingsSnapshotEntry>()
  for (const [key, value] of Object.entries(settings)) {
    if (!settingsGroupForKey(key) || value === undefined) continue
    snapshot.set(key, {
      snapshot: snapshotJson(value),
      value: cloneJsonValue(value),
    })
  }
  return snapshot
}

function diffServerBackedSettingsSnapshot(
  before: Map<string, ServerBackedSettingsSnapshotEntry>,
  after: Record<string, unknown>,
): { patch: SettingsPatch; previous: SettingsPatch; attempted: SettingsPatch } {
  const patch: SettingsPatch = {}
  const previous: SettingsPatch = {}
  const attempted: SettingsPatch = {}
  const keys = new Set([...before.keys(), ...Object.keys(after)])

  for (const key of keys) {
    if (!settingsGroupForKey(key)) continue
    const value = after[key]
    if (value === undefined) continue

    const previousEntry = before.get(key)
    if (previousEntry?.snapshot === snapshotJson(value)) continue

    patch[key] = cloneJsonValue(value)
    previous[key] = cloneJsonValue(previousEntry?.value)
    attempted[key] = cloneJsonValue(value)
  }

  return { patch, previous, attempted }
}

function snapshotJson(value: unknown): string {
  const snapshot = JSON.stringify(value)
  return snapshot === undefined ? '__undefined__' : snapshot
}

function currentSettingValue<T>(key: string, fallback: T): T {
  const target = DBState.db as unknown as Record<string, unknown> | undefined
  const value = target?.[key]
  return value === undefined ? fallback : (value as T)
}

function cloneJsonValue<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}
