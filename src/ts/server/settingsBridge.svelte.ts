import { untrack } from 'svelte'
import { DBState } from '../stores.svelte'
import {
  canUseServerCommands,
  patchServerBackedSettings,
  settingsGroupForKey,
  type SettingsPatch,
} from './commands'
import {
  getServerProjectionApplyEpoch,
  withTrustedServerProjectionWrite,
} from './projectionWriteGuard.svelte'

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
      const previous = cloneJsonValue(
        (DBState.db as unknown as Record<string, unknown>)[key],
      )
      withTrustedServerProjectionWrite(() => {
        // Re-read DBState.db inside the callback: the trusted write swaps it to
        // a mutable clone, so an alias captured earlier still points at the
        // read-only projection and would throw on write.
        const target = DBState.db as unknown as Record<string, unknown>
        target[key] = attempted
      })
      queueSettingsPatch({ [key]: attempted }, { [key]: previous }, delayMs)
      previousServerSnapshot = snapshot
    })
  })

  return draft
}

export function applyServerBackedSettingsPatch(patch: SettingsPatch): void {
  const commandPatch: SettingsPatch = {}
  const previous: SettingsPatch = {}
  const attempted: SettingsPatch = {}

  withTrustedServerProjectionWrite(() => {
    const target = DBState.db as unknown as Record<string, unknown>
    for (const [key, value] of Object.entries(patch)) {
      if (!settingsGroupForKey(key) || value === undefined) continue
      const currentValue = target[key]
      if (snapshotJson(currentValue) === snapshotJson(value)) continue
      previous[key] = cloneJsonValue(currentValue)
      attempted[key] = cloneJsonValue(value)
      commandPatch[key] = cloneJsonValue(value)
      target[key] = cloneJsonValue(value)
    }
  })

  if (Object.keys(commandPatch).length === 0) return

  void patchServerBackedSettings({
    patch: commandPatch,
    rollback: () => {
      withTrustedServerProjectionWrite(() => {
        rollbackSettings(previous, attempted)
      })
    },
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

  return stop
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
    pendingSettingsPatch.timer = null
    const commandPatch = pendingSettingsPatch.patch
    const commandPrevious = pendingSettingsPatch.previous
    const commandAttempted = pendingSettingsPatch.attempted
    pendingSettingsPatch.patch = {}
    pendingSettingsPatch.previous = {}
    pendingSettingsPatch.attempted = {}

    if (Object.keys(commandPatch).length === 0) return

    void patchServerBackedSettings({
      patch: commandPatch,
      rollback: () => {
        suppressRollbackDispatch = true
        try {
          rollbackSettings(commandPrevious, commandAttempted)
        } finally {
          queueMicrotask(() => {
            suppressRollbackDispatch = false
          })
        }
      },
    })
  }, delay)
}

function rollbackSettings(previous: SettingsPatch, attempted: SettingsPatch): void {
  withTrustedServerProjectionWrite(() => {
    const target = DBState.db as unknown as Record<string, unknown>
    for (const [key, previousValue] of Object.entries(previous)) {
      if (snapshotJson(target[key]) === snapshotJson(attempted[key])) {
        target[key] = cloneJsonValue(previousValue)
      }
    }
  })
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
