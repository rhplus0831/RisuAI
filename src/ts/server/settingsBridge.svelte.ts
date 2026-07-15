import { untrack } from 'svelte'
import { prebuiltPresets } from '../process/templates/templates'
import {
  mirrorTopLevelPresetField,
  resolveTopLevelPresetFieldMirrorTarget,
  type TopLevelPresetFieldMirrorTarget,
} from '../presetFieldMirror'
import { getDatabase, setPreset } from '../storage/database.svelte'
import {
  canUseServerCommands,
  patchSettingsObjectFieldsCommand,
  patchServerBackedSettings,
  runServerCommand,
  settingsGroupForKey,
  type SettingsPatch,
  type SparseSettingsObjectUpdate,
  type ServerCommandTransportOptions,
} from './commands'
import { fetchServerSettingsGroup } from './resourceReads'
import {
  applySettingsGroupResource,
  captureSettingsGroupProjectionEpoch,
  captureSettingsPatchProjectionEpochs,
  hasSettingsGroupProjectionEpochChanged,
  isSettingsGroupAcknowledgementTainted,
  markSettingsGroupAcknowledgementTainted,
} from './resourceState.svelte'
import { SERVER_SETTINGS_KEYS_BY_GROUP, type SettingsGroup, type SettingsGroupProjectionEpochs } from './settingsGroups'
import {
  getServerResourceApplyEpoch,
  withServerResourceApply,
  withTrustedResourceWrite,
} from './resourceWriteGuard.svelte'
import { applyAttemptedFieldRollback } from './staleStateGuards'
import { subscribeServerCommandLocalEffectApplied } from './commandLocalEffectEvents'
import { applySettingsRuntimeProjectionEffects } from './settingsRuntimeProjectionHooks'
import {
  appliedLocalEffectAcknowledgesSettingDraft,
  serverSettingDraftOwnerKey,
  splitPresetSettingDraftOwnerKey,
} from './settingsDraftAcknowledgement'

interface PendingSettingsPatch {
  patch: SettingsPatch
  previous: SettingsPatch
  attempted: SettingsPatch
  projectionEpochs: SettingsGroupProjectionEpochs
  timer: ReturnType<typeof setTimeout> | null
}

interface PendingSettingsAttempt {
  sequence: number
  previous: SettingsPatch
  attempted: SettingsPatch
}

interface HypaV3PresetRollbackResult {
  rolledBack: boolean
  insertedIndex?: number
}

const pendingSettingsPatch: PendingSettingsPatch = {
  patch: {},
  previous: {},
  attempted: {},
  projectionEpochs: {},
  timer: null,
}
const pendingSettingsAttempts: PendingSettingsAttempt[] = []
let nextSettingsAttemptSequence = 0

interface SparseObjectSettingQueue {
  key: string
  group: SettingsGroup
  baseline: Record<string, unknown>
  queued: SparseSettingsObjectUpdate | null
  queuedProjectionEpoch: number | null
  timer: ReturnType<typeof setTimeout> | null
  running: boolean
  superseded: boolean
}

const SPARSE_OBJECT_SETTING_KEYS = new Set(['NAIImgConfig', 'wavespeedImage', 'seperateParameters'])
const sparseObjectSettingQueues = new Map<string, SparseObjectSettingQueue>()

let suppressRollbackDispatch = false

export interface WatchServerBackedSettingsOptions<T = unknown> {
  delayMs?: number
  dispatch?: boolean
  normalizeDraft?: (value: T) => T
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
  options: WatchServerBackedSettingsOptions<T> = {},
): ServerBackedSettingDraft<T> {
  const initialValue = currentSettingValue(key, fallback)
  const cloneDraftValue = (value: T): T => {
    const cloned = cloneJsonValue(value)
    return options.normalizeDraft ? options.normalizeDraft(cloned) : cloned
  }
  const draft = $state<ServerBackedSettingDraft<T>>({ value: cloneDraftValue(initialValue) })
  const delayMs = options.delayMs ?? 250
  let initialized = false
  let suppressDraftDispatch = false
  let previousServerSnapshot = snapshotJson(initialValue)
  let previousResourceApplyEpoch = getServerResourceApplyEpoch()
  let previousOwnerKey = currentServerBackedSettingDraftOwnerKey(key, options.dispatch)
  let dirty = false
  let dirtyOwnerKey: string | null = null

  $effect(() => {
    const resourceApplyEpoch = getServerResourceApplyEpoch()
    const resourceApplyChanged = resourceApplyEpoch !== previousResourceApplyEpoch
    const ownerKey = currentServerBackedSettingDraftOwnerKey(key, options.dispatch)
    const ownerChanged = ownerKey !== previousOwnerKey
    const serverValue = currentSettingValue(key, fallback)
    const serverSnapshot = snapshotJson(serverValue)
    const draftSnapshot = snapshotJson(draft.value)

    if (ownerChanged) {
      dirty = false
      dirtyOwnerKey = null
      if (serverSnapshot !== draftSnapshot) {
        suppressDraftDispatch = true
        draft.value = cloneDraftValue(serverValue)
        queueMicrotask(() => {
          suppressDraftDispatch = false
        })
      }
    } else {
      if (resourceApplyChanged && dirty && serverSnapshot === draftSnapshot) {
        dirty = false
        dirtyOwnerKey = null
      }

      if (serverSnapshot !== previousServerSnapshot && serverSnapshot !== draftSnapshot) {
        suppressDraftDispatch = true
        if (resourceApplyChanged && dirty) {
          reassertDirtySettingDraftValue(key, draft.value)
        } else {
          dirty = false
          dirtyOwnerKey = null
          draft.value = cloneDraftValue(serverValue)
        }
        queueMicrotask(() => {
          suppressDraftDispatch = false
        })
      }
    }

    previousOwnerKey = ownerKey
    previousResourceApplyEpoch = resourceApplyEpoch
    previousServerSnapshot = dirty ? snapshotJson(draft.value) : serverSnapshot
  })

  $effect(() =>
    subscribeServerCommandLocalEffectApplied((_event, localEffect) => {
      if (
        !dirty ||
        !appliedLocalEffectAcknowledgesSettingDraft({
          localEffect,
          dirtyOwnerKey,
          currentOwnerKey: currentServerBackedSettingDraftOwnerKey(key, options.dispatch),
          rootKey: key,
          attemptedValue: draft.value,
          currentValue: currentSettingValue(key, fallback),
        })
      ) {
        return
      }
      dirty = false
      dirtyOwnerKey = null
    }),
  )

  let previousDraftDispatchSnapshot = snapshotJson(initialValue)
  $effect(() => {
    const snapshot = snapshotJson(draft.value)
    if (!initialized) {
      initialized = true
      previousDraftDispatchSnapshot = snapshot
      return
    }
    if (suppressDraftDispatch) {
      previousDraftDispatchSnapshot = snapshot
      return
    }
    if (snapshot === previousDraftDispatchSnapshot) return

    dirty = true
    previousDraftDispatchSnapshot = snapshot

    untrack(() => {
      if (!settingsGroupForKey(key)) {
        dirtyOwnerKey = `local:${key}`
        return
      }
      const attempted = cloneDraftValue(draft.value)
      const previous = cloneJsonValue((getDatabase() as unknown as Record<string, unknown>)[key])
      const presetTarget = resolveTopLevelPresetFieldMirrorTarget(key)
      withTrustedResourceWrite(() => {
        // Re-read the resource database inside the callback: the trusted write opens a
        // copy-on-write working proxy, so an alias captured earlier still points
        // at the read-only projection and would throw on write.
        const target = getDatabase() as unknown as Record<string, unknown>
        target[key] = attempted
      })
      const mirroredToPreset = mirrorTopLevelPresetField(key, attempted)
      dirtyOwnerKey =
        mirroredToPreset && presetTarget
          ? splitPresetDraftOwnerKey(presetTarget)
          : options.dispatch === false
            ? `local:${key}`
            : serverSettingDraftOwnerKey(key)
      if (!mirroredToPreset && options.dispatch !== false) {
        queueSettingsPatch({ [key]: attempted }, { [key]: previous }, delayMs)
      }
      previousServerSnapshot = snapshot
    })
  })

  return draft
}

function splitPresetDraftOwnerKey(target: TopLevelPresetFieldMirrorTarget): string {
  return splitPresetSettingDraftOwnerKey(target.kind, target.presetId, target.presetKey)
}

function currentServerBackedSettingDraftOwnerKey(key: string, dispatch: boolean | undefined): string {
  const presetTarget = resolveTopLevelPresetFieldMirrorTarget(key)
  if (presetTarget) return splitPresetDraftOwnerKey(presetTarget)
  if (dispatch === false || !settingsGroupForKey(key)) return `local:${key}`
  return serverSettingDraftOwnerKey(key)
}

function reassertDirtySettingDraftValue<T>(key: string, value: T): void {
  if (!settingsGroupForKey(key)) return

  withSuppressedSettingsWatcher(() => {
    withTrustedResourceWrite(() => {
      const target = getDatabase() as unknown as Record<string, unknown>
      target[key] = cloneJsonValue(value)
    })
  })
}

export function applyServerBackedSettingsPatch(patch: SettingsPatch): void {
  const commandPatch: SettingsPatch = {}
  const previous: SettingsPatch = {}
  const attempted: SettingsPatch = {}

  const currentSettings = getDatabase() as unknown as Record<string, unknown>
  for (const [key, value] of Object.entries(patch)) {
    if (!settingsGroupForKey(key) || value === undefined) continue
    const currentValue = currentSettings[key]
    if (snapshotJson(currentValue) === snapshotJson(value)) continue
    previous[key] = cloneJsonValue(currentValue)
    attempted[key] = cloneJsonValue(value)
    commandPatch[key] = cloneJsonValue(value)
  }

  if (Object.keys(commandPatch).length === 0) return
  const optimisticProjectionEpochs = captureSettingsPatchProjectionEpochs(commandPatch)

  dropPendingSettingsPatchKeys(Object.keys(commandPatch))

  withSuppressedSettingsWatcher(() => {
    withTrustedResourceWrite(() => {
      const target = getDatabase() as unknown as Record<string, unknown>
      for (const [key, value] of Object.entries(commandPatch)) {
        target[key] = cloneJsonValue(value)
      }
    })
  })

  dispatchServerBackedSettingsPatch(commandPatch, previous, attempted, optimisticProjectionEpochs)
}

export function applyOnboardingServerBackedSettings(options: ApplyOnboardingServerBackedSettingsOptions): void {
  const patch = buildOnboardingSettingsPatch(options)
  const beforeSetup = snapshotServerBackedSettings(getDatabase() as unknown as Record<string, unknown>)
  let fullPatch: SettingsPatch = {}
  let previous: SettingsPatch = {}
  let attempted: SettingsPatch = {}

  withSuppressedSettingsWatcher(() => {
    withTrustedResourceWrite(() => {
      setPreset(getDatabase(), prebuiltPresets.OAI2)
      Object.assign(getDatabase() as unknown as Record<string, unknown>, patch)

      const diff = diffServerBackedSettingsSnapshot(beforeSetup, getDatabase() as unknown as Record<string, unknown>)
      fullPatch = diff.patch
      previous = diff.previous
      attempted = diff.attempted
    })
  })

  dispatchServerBackedSettingsPatch(fullPatch, previous, attempted, captureSettingsPatchProjectionEpochs(fullPatch))
}

function dispatchServerBackedSettingsPatch(
  commandPatch: SettingsPatch,
  previous: SettingsPatch,
  attempted: SettingsPatch,
  optimisticProjectionEpochs: SettingsGroupProjectionEpochs,
): void {
  if (Object.keys(commandPatch).length === 0) return

  dispatchTrackedServerBackedSettingsPatch({
    patch: commandPatch,
    optimisticProjectionEpochs,
    previous,
    attempted,
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
  let previousResourceApplyEpoch = getServerResourceApplyEpoch()

  const stop = $effect.root(() => {
    $effect(() => {
      const resourceApplyEpoch = getServerResourceApplyEpoch()
      const changed: SettingsPatch = {}
      const before: SettingsPatch = {}

      for (const key of trackedKeys) {
        const value = (getDatabase() as unknown as Record<string, unknown> | undefined)?.[key]
        const snapshot = snapshotJson(value)
        const previousSnapshot = previousSnapshots.get(key)

        if (initialized && snapshot !== previousSnapshot) {
          changed[key] = cloneJsonValue(value)
          before[key] = cloneJsonValue(previousValues.get(key))
        }

        previousSnapshots.set(key, snapshot)
        previousValues.set(key, cloneJsonValue(value))
      }

      if (!initialized || resourceApplyEpoch !== previousResourceApplyEpoch) {
        initialized = true
        previousResourceApplyEpoch = resourceApplyEpoch
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
    if (queueSparseObjectSettingPatch(key, previous[key], value, delay)) continue
    const group = settingsGroupForKey(key)
    if (group && pendingSettingsPatch.projectionEpochs[group] === undefined) {
      pendingSettingsPatch.projectionEpochs[group] = captureSettingsGroupProjectionEpoch(group)
    }
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
  prunePendingSettingsPatchProjectionEpochs()

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
    supersedeSparseObjectSettingQueue(key)
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
  prunePendingSettingsPatchProjectionEpochs()

  if (dropped && pendingSettingsPatch.timer && Object.keys(pendingSettingsPatch.patch).length === 0) {
    clearTimeout(pendingSettingsPatch.timer)
    pendingSettingsPatch.timer = null
  }
}

export function flushPendingServerBackedSettingsPatch(options: ServerCommandTransportOptions = {}): void {
  dispatchPendingSettingsPatch(options)
  for (const state of sparseObjectSettingQueues.values()) {
    if (state.timer) {
      clearTimeout(state.timer)
      state.timer = null
    }
    void dispatchSparseObjectSettingQueue(state, options)
  }
}

function dispatchPendingSettingsPatch(options: ServerCommandTransportOptions = {}): void {
  if (pendingSettingsPatch.timer) {
    clearTimeout(pendingSettingsPatch.timer)
    pendingSettingsPatch.timer = null
  }
  const commandPatch = pendingSettingsPatch.patch
  const commandPrevious = pendingSettingsPatch.previous
  const commandAttempted = pendingSettingsPatch.attempted
  const optimisticProjectionEpochs = pendingSettingsPatch.projectionEpochs
  pendingSettingsPatch.patch = {}
  pendingSettingsPatch.previous = {}
  pendingSettingsPatch.attempted = {}
  pendingSettingsPatch.projectionEpochs = {}

  if (Object.keys(commandPatch).length === 0) return

  dispatchTrackedServerBackedSettingsPatch({
    patch: commandPatch,
    optimisticProjectionEpochs,
    keepalive: options.keepalive,
    signal: options.signal,
    previous: commandPrevious,
    attempted: commandAttempted,
  })
}

function dispatchTrackedServerBackedSettingsPatch(input: {
  patch: SettingsPatch
  optimisticProjectionEpochs: SettingsGroupProjectionEpochs
  previous: SettingsPatch
  attempted: SettingsPatch
  keepalive?: boolean
  signal?: AbortSignal | null
}): void {
  const attempt = registerSettingsAttempt(input.previous, input.attempted)
  const result = patchServerBackedSettings({
    patch: input.patch,
    acknowledgeOptimistic: true,
    optimisticProjectionEpochs: input.optimisticProjectionEpochs,
    keepalive: input.keepalive,
    signal: input.signal,
    rollback: () => rollbackSettingsAttempt(attempt),
  })
  void result.then(
    () => clearSettingsAttempt(attempt),
    () => clearSettingsAttempt(attempt),
  )
}

function registerSettingsAttempt(previous: SettingsPatch, attempted: SettingsPatch): PendingSettingsAttempt {
  const attempt = {
    sequence: ++nextSettingsAttemptSequence,
    previous,
    attempted,
  }
  pendingSettingsAttempts.push(attempt)
  return attempt
}

function rollbackSettingsAttempt(attempt: PendingSettingsAttempt): void {
  rollbackServerBackedSettings(attempt.previous, attempt.attempted)
  rebaseLaterSettingsAttempts(attempt)
  clearSettingsAttempt(attempt)
}

function rebaseLaterSettingsAttempts(failed: PendingSettingsAttempt): void {
  for (const key of Object.keys(failed.attempted)) {
    let rebased = false
    // Settings commands settle in dispatch order. Rebase only the first
    // dependent successor for this key; if it also fails, it propagates the
    // confirmed baseline to the next successor in the chain.
    for (const later of pendingSettingsAttempts) {
      if (later.sequence <= failed.sequence || !hasOwnKey(later.attempted, key)) continue
      if (!hasOwnKey(later.previous, key)) continue
      if (!isJsonSnapshotEqual(later.previous[key], failed.attempted[key])) continue

      if (hasOwnKey(failed.previous, key)) {
        later.previous[key] = cloneJsonValue(failed.previous[key])
      } else {
        delete later.previous[key]
      }
      rebased = true
      break
    }

    if (
      !rebased &&
      hasOwnKey(pendingSettingsPatch.attempted, key) &&
      hasOwnKey(pendingSettingsPatch.previous, key) &&
      isJsonSnapshotEqual(pendingSettingsPatch.previous[key], failed.attempted[key])
    ) {
      if (hasOwnKey(failed.previous, key)) {
        pendingSettingsPatch.previous[key] = cloneJsonValue(failed.previous[key])
      } else {
        delete pendingSettingsPatch.previous[key]
      }
    }
  }
}

function clearSettingsAttempt(attempt: PendingSettingsAttempt): void {
  const index = pendingSettingsAttempts.findIndex((candidate) => candidate.sequence === attempt.sequence)
  if (index !== -1) pendingSettingsAttempts.splice(index, 1)
}

function prunePendingSettingsPatchProjectionEpochs(): void {
  const pendingGroups = new Set(
    Object.keys(pendingSettingsPatch.patch).flatMap((key) => {
      const group = settingsGroupForKey(key)
      return group ? [group] : []
    }),
  )
  for (const group of Object.keys(pendingSettingsPatch.projectionEpochs) as SettingsGroup[]) {
    if (!pendingGroups.has(group)) delete pendingSettingsPatch.projectionEpochs[group]
  }
}

function queueSparseObjectSettingPatch(key: string, previous: unknown, attempted: unknown, delay: number): boolean {
  const group = settingsGroupForKey(key)
  if (!group || !SPARSE_OBJECT_SETTING_KEYS.has(key) || !isPlainJsonObject(previous) || !isPlainJsonObject(attempted)) {
    return false
  }

  const intent = diffSparseObjectSetting(previous, attempted)
  let state = sparseObjectSettingQueues.get(key)
  if (!state) {
    if (!intent) return true
    state = {
      key,
      group,
      baseline: cloneJsonValue(previous),
      queued: intent,
      queuedProjectionEpoch: captureSettingsGroupProjectionEpoch(group),
      timer: null,
      running: false,
      superseded: false,
    }
    sparseObjectSettingQueues.set(key, state)
  } else if (intent) {
    if (!state.queued) state.queuedProjectionEpoch = captureSettingsGroupProjectionEpoch(group)
    state.queued = mergeSparseObjectSettingUpdates(state.queued, intent)
  }

  if (!state.running && state.queued) {
    const desired = applySparseObjectSettingUpdate(state.baseline, state.queued)
    state.queued = diffSparseObjectSetting(state.baseline, desired)
    if (!state.queued) {
      state.queuedProjectionEpoch = null
      if (state.timer) clearTimeout(state.timer)
      sparseObjectSettingQueues.delete(key)
      return true
    }
  }

  if (state.timer) clearTimeout(state.timer)
  state.timer = setTimeout(() => {
    state!.timer = null
    void dispatchSparseObjectSettingQueue(state!)
  }, delay)
  return true
}

function supersedeSparseObjectSettingQueue(key: string): void {
  const state = sparseObjectSettingQueues.get(key)
  if (!state) return
  state.superseded = true
  state.queued = null
  state.queuedProjectionEpoch = null
  if (state.timer) clearTimeout(state.timer)
  state.timer = null
  if (!state.running) sparseObjectSettingQueues.delete(key)
}

async function dispatchSparseObjectSettingQueue(
  state: SparseObjectSettingQueue,
  options: ServerCommandTransportOptions = {},
): Promise<void> {
  if (state.running || state.superseded || !state.queued) return
  const attemptedObject = applySparseObjectSettingUpdate(state.baseline, state.queued)
  const update = diffSparseObjectSetting(state.baseline, attemptedObject)
  const projectionEpoch = state.queuedProjectionEpoch
  state.queued = null
  state.queuedProjectionEpoch = null
  if (!update || projectionEpoch === null) {
    sparseObjectSettingQueues.delete(state.key)
    return
  }

  state.running = true
  let failed = false
  const result = await runServerCommand({
    signal: options.signal,
    keepalive: options.keepalive,
    command: (baseRevision) =>
      patchSettingsObjectFieldsCommand(
        {
          baseRevision,
          group: state.group,
          key: state.key,
          update,
          attemptedObject,
          optimisticProjectionEpoch: projectionEpoch,
        },
        options.signal,
        options.keepalive,
      ),
    rollback: () => {
      failed = true
      markSettingsGroupAcknowledgementTainted(state.group)
    },
  })

  await Promise.resolve()
  let baseline: Record<string, unknown> | null = null
  let usedAuthoritativeBaseline = false
  if (result.status === 'ok') {
    if (hasSettingsGroupProjectionEpochChanged(state.group, projectionEpoch)) {
      const authoritative = currentSettingValue(state.key, null)
      if (isPlainJsonObject(authoritative)) {
        baseline = cloneJsonValue(authoritative)
        usedAuthoritativeBaseline = true
      }
    } else if (!isSettingsGroupAcknowledgementTainted(state.group)) {
      baseline = canonicalSparseObjectSettingResult(result, update, attemptedObject, state.group, state.key)
    }
  }
  if (!baseline) {
    baseline = await refreshSparseObjectSettingBaseline(state.group, state.key, options.signal)
    usedAuthoritativeBaseline = baseline !== null
  }
  if (!baseline) baseline = cloneJsonValue(state.baseline)
  state.baseline = baseline
  state.running = false

  if (state.superseded) {
    sparseObjectSettingQueues.delete(state.key)
    return
  }

  const queued = state.queued
  if (queued) {
    const desired = applySparseObjectSettingUpdate(state.baseline, queued)
    writeSparseObjectSettingProjection(state.key, desired)
    state.queued = diffSparseObjectSetting(state.baseline, desired)
    if (state.queued) {
      queueMicrotask(() => void dispatchSparseObjectSettingQueue(state, options))
      return
    }
    state.queuedProjectionEpoch = null
  } else if (
    (failed || usedAuthoritativeBaseline) &&
    isJsonSnapshotEqual(currentSettingValue(state.key, {}), attemptedObject)
  ) {
    writeSparseObjectSettingProjection(state.key, state.baseline)
  }

  sparseObjectSettingQueues.delete(state.key)
}

async function refreshSparseObjectSettingBaseline(
  group: SettingsGroup,
  key: string,
  signal?: AbortSignal | null,
): Promise<Record<string, unknown> | null> {
  const result = await fetchServerSettingsGroup(group, signal)
  if (result.status !== 'ok') return null
  const applied = withServerResourceApply(() =>
    applySettingsGroupResource(result, SERVER_SETTINGS_KEYS_BY_GROUP[group]),
  )
  if (!applied) return null
  const value = currentSettingValue(key, null)
  return isPlainJsonObject(value) ? cloneJsonValue(value) : null
}

function canonicalSparseObjectSettingResult(
  result: Extract<Awaited<ReturnType<typeof patchSettingsObjectFieldsCommand>>, { status: 'ok' }>,
  update: SparseSettingsObjectUpdate,
  attemptedObject: Record<string, unknown>,
  group: SettingsGroup,
  key: string,
): Record<string, unknown> | null {
  if (
    result.revision !== result.event.revision ||
    result.event.type !== 'settings.updated' ||
    result.event.resource !== 'settings' ||
    result.event.id !== group ||
    result.event.parentId !== undefined ||
    result.certificate !== 'settings-object-patch-v1' ||
    result.group !== group ||
    result.key !== key ||
    !isUniqueNonBlankStrings(result.patchedKeys) ||
    !isUniqueNonBlankStrings(result.deletedKeys) ||
    !isUniqueNonBlankStrings(result.canonicalDeletedKeys) ||
    !isPlainJsonObject(result.canonicalValues) ||
    !Object.values(result.canonicalValues).every((value) => isJsonValue(value)) ||
    !isJsonSnapshotEqual([...result.patchedKeys].sort(), Object.keys(update.patch).sort()) ||
    !isJsonSnapshotEqual([...result.deletedKeys].sort(), [...(update.deleteKeys ?? [])].sort())
  ) {
    return null
  }
  const requestedKeys = new Set([...Object.keys(update.patch), ...(update.deleteKeys ?? [])])
  if (
    Object.keys(result.canonicalValues).some((field) => !requestedKeys.has(field)) ||
    result.canonicalDeletedKeys.some(
      (field) => !requestedKeys.has(field) || Object.prototype.hasOwnProperty.call(result.canonicalValues, field),
    )
  ) {
    return null
  }
  const canonical = cloneJsonValue(attemptedObject)
  for (const [field, value] of Object.entries(result.canonicalValues)) canonical[field] = cloneJsonValue(value)
  for (const field of result.canonicalDeletedKeys) delete canonical[field]
  return canonical
}

function diffSparseObjectSetting(
  previous: Record<string, unknown>,
  attempted: Record<string, unknown>,
): SparseSettingsObjectUpdate | null {
  const patch: Record<string, unknown> = {}
  const deleteKeys: string[] = []
  const keys = new Set([...Object.keys(previous), ...Object.keys(attempted)])
  for (const key of keys) {
    const attemptedPresent = Object.prototype.hasOwnProperty.call(attempted, key) && attempted[key] !== undefined
    if (!attemptedPresent) {
      if (Object.prototype.hasOwnProperty.call(previous, key)) deleteKeys.push(key)
      continue
    }
    if (!Object.prototype.hasOwnProperty.call(previous, key) || !isJsonSnapshotEqual(previous[key], attempted[key])) {
      patch[key] = cloneJsonValue(attempted[key])
    }
  }
  if (Object.keys(patch).length === 0 && deleteKeys.length === 0) return null
  return { patch, ...(deleteKeys.length ? { deleteKeys: deleteKeys.sort() } : {}) }
}

function mergeSparseObjectSettingUpdates(
  current: SparseSettingsObjectUpdate | null,
  next: SparseSettingsObjectUpdate,
): SparseSettingsObjectUpdate {
  const patch = { ...(current?.patch ?? {}) }
  const deleteKeys = new Set(current?.deleteKeys ?? [])
  for (const [key, value] of Object.entries(next.patch)) {
    patch[key] = cloneJsonValue(value)
    deleteKeys.delete(key)
  }
  for (const key of next.deleteKeys ?? []) {
    delete patch[key]
    deleteKeys.add(key)
  }
  return { patch, ...(deleteKeys.size ? { deleteKeys: [...deleteKeys].sort() } : {}) }
}

function applySparseObjectSettingUpdate(
  baseline: Record<string, unknown>,
  update: SparseSettingsObjectUpdate,
): Record<string, unknown> {
  const next = { ...cloneJsonValue(baseline), ...cloneJsonValue(update.patch) }
  for (const key of update.deleteKeys ?? []) delete next[key]
  return next
}

function writeSparseObjectSettingProjection(key: string, value: Record<string, unknown>): void {
  withSuppressedSettingsWatcher(() => {
    withTrustedResourceWrite(() => {
      ;(getDatabase() as unknown as Record<string, unknown>)[key] = cloneJsonValue(value)
    })
  })
}

function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isJsonValue(value: unknown, ancestors = new Set<object>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (!value || typeof value !== 'object' || ancestors.has(value)) return false

  const prototype = Object.getPrototypeOf(value)
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return false

  ancestors.add(value)
  const valid = Array.isArray(value)
    ? value.every((entry, index) => Object.prototype.hasOwnProperty.call(value, index) && isJsonValue(entry, ancestors))
    : Object.values(value).every((entry) => isJsonValue(entry, ancestors))
  ancestors.delete(value)
  return valid
}

function isUniqueNonBlankStrings(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === 'string' && entry.trim() !== '') &&
    new Set(value).size === value.length
  )
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
  let runtimeProjectionKeys: string[] = []
  withTrustedResourceWrite(() => {
    const target = getDatabase() as unknown as Record<string, unknown>
    const genericPrevious: SettingsPatch = { ...previous }
    const genericAttempted: SettingsPatch = { ...attempted }

    rollbackHypaV3Presets(target, genericPrevious, genericAttempted)
    runtimeProjectionKeys = applyAttemptedFieldRollback({
      target,
      previous: genericPrevious,
      attempted: genericAttempted,
    })
  })
  applySettingsRuntimeProjectionEffects(runtimeProjectionKeys)
}

function rollbackHypaV3Presets(
  target: Record<string, unknown>,
  previous: SettingsPatch,
  attempted: SettingsPatch,
): void {
  if (!hasOwnKey(attempted, 'hypaV3Presets')) return

  const rollbackResult = rollbackHypaV3PresetRows({
    target,
    previousPresets: previous.hypaV3Presets,
    attemptedPresets: attempted.hypaV3Presets,
    livePresets: target.hypaV3Presets,
  })

  const shouldRestoreAttemptedSelection =
    rollbackResult.rolledBack &&
    hasOwnKey(attempted, 'hypaV3PresetId') &&
    hasOwnKey(previous, 'hypaV3PresetId') &&
    isJsonSnapshotEqual(target.hypaV3PresetId, attempted.hypaV3PresetId)

  if (!shouldRestoreAttemptedSelection && rollbackResult.insertedIndex !== undefined) {
    rebaseHypaV3PresetIdAfterInsert(target, rollbackResult.insertedIndex)
  }

  if (shouldRestoreAttemptedSelection) {
    target.hypaV3PresetId = cloneJsonValue(previous.hypaV3PresetId)
  }

  delete previous.hypaV3Presets
  delete attempted.hypaV3Presets
  delete previous.hypaV3PresetId
  delete attempted.hypaV3PresetId
}

function rollbackHypaV3PresetRows(input: {
  target: Record<string, unknown>
  previousPresets: unknown
  attemptedPresets: unknown
  livePresets: unknown
}): HypaV3PresetRollbackResult {
  const { target, previousPresets, attemptedPresets, livePresets } = input

  if (!Array.isArray(previousPresets) || !Array.isArray(attemptedPresets) || !Array.isArray(livePresets)) {
    return { rolledBack: false }
  }

  if (attemptedPresets.length === previousPresets.length + 1) {
    return rollbackHypaV3PresetAppend(target, previousPresets, attemptedPresets, livePresets)
  }

  if (attemptedPresets.length === previousPresets.length) {
    return rollbackHypaV3PresetEdits(target, previousPresets, attemptedPresets, livePresets)
  }

  if (attemptedPresets.length === previousPresets.length - 1) {
    return rollbackHypaV3PresetDelete(target, previousPresets, attemptedPresets, livePresets)
  }

  return { rolledBack: false }
}

function rollbackHypaV3PresetAppend(
  target: Record<string, unknown>,
  previousPresets: unknown[],
  attemptedPresets: unknown[],
  livePresets: unknown[],
): HypaV3PresetRollbackResult {
  const appendedIndex = previousPresets.length
  const attemptedRow = attemptedPresets[appendedIndex]

  if (!isJsonSnapshotEqual(livePresets[appendedIndex], attemptedRow)) return { rolledBack: false }

  const nextPresets = [...livePresets]
  nextPresets.splice(appendedIndex, 1)
  target.hypaV3Presets = nextPresets
  return { rolledBack: true }
}

function rollbackHypaV3PresetEdits(
  target: Record<string, unknown>,
  previousPresets: unknown[],
  attemptedPresets: unknown[],
  livePresets: unknown[],
): HypaV3PresetRollbackResult {
  let nextPresets: unknown[] | null = null

  for (let index = 0; index < attemptedPresets.length; index += 1) {
    if (isJsonSnapshotEqual(previousPresets[index], attemptedPresets[index])) continue
    if (!isJsonSnapshotEqual(livePresets[index], attemptedPresets[index])) continue

    nextPresets ??= [...livePresets]
    nextPresets[index] = cloneJsonValue(previousPresets[index])
  }

  if (!nextPresets) return { rolledBack: false }

  target.hypaV3Presets = nextPresets
  return { rolledBack: true }
}

function rollbackHypaV3PresetDelete(
  target: Record<string, unknown>,
  previousPresets: unknown[],
  attemptedPresets: unknown[],
  livePresets: unknown[],
): HypaV3PresetRollbackResult {
  const removedIndex = findHypaV3PresetRemovedIndex(previousPresets, attemptedPresets)
  if (removedIndex === -1) return { rolledBack: false }

  const removedRow = previousPresets[removedIndex]
  if (livePresets.some((preset) => isJsonSnapshotEqual(preset, removedRow))) return { rolledBack: false }

  const nextPresets = [...livePresets]
  const insertedIndex = clampInsertIndex(removedIndex, nextPresets.length)
  nextPresets.splice(insertedIndex, 0, cloneJsonValue(removedRow))
  target.hypaV3Presets = nextPresets
  return { rolledBack: true, insertedIndex }
}

function rebaseHypaV3PresetIdAfterInsert(target: Record<string, unknown>, insertedIndex: number): void {
  const liveId = target.hypaV3PresetId
  if (typeof liveId !== 'number' || !Number.isFinite(liveId)) return
  if (liveId < insertedIndex) return

  target.hypaV3PresetId = liveId + 1
}

function findHypaV3PresetRemovedIndex(previousPresets: unknown[], attemptedPresets: unknown[]): number {
  for (let removedIndex = 0; removedIndex < previousPresets.length; removedIndex += 1) {
    if (hypaV3PresetArraysMatchWithRemovedIndex(previousPresets, attemptedPresets, removedIndex)) {
      return removedIndex
    }
  }

  return -1
}

function hypaV3PresetArraysMatchWithRemovedIndex(
  previousPresets: unknown[],
  attemptedPresets: unknown[],
  removedIndex: number,
): boolean {
  let attemptedIndex = 0

  for (let previousIndex = 0; previousIndex < previousPresets.length; previousIndex += 1) {
    if (previousIndex === removedIndex) continue
    if (!isJsonSnapshotEqual(previousPresets[previousIndex], attemptedPresets[attemptedIndex])) return false
    attemptedIndex += 1
  }

  return attemptedIndex === attemptedPresets.length
}

function clampInsertIndex(index: number, length: number): number {
  if (index < 0) return 0
  if (index > length) return length
  return index
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
    const translator = onboardingTranslatorForLanguage(String(getDatabase().language ?? ''))
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

function isJsonSnapshotEqual(left: unknown, right: unknown): boolean {
  return snapshotJson(left) === snapshotJson(right)
}

function hasOwnKey(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function currentSettingValue<T>(key: string, fallback: T): T {
  const target = getDatabase() as unknown as Record<string, unknown> | undefined
  const value = target?.[key]
  return value === undefined ? fallback : (value as T)
}

function cloneJsonValue<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}
