import { untrack } from 'svelte'
import { language } from '../../lang'
import { alertError } from '../alert'
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
  type ServerCommandResult,
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
import { dispatchDurableMutation, registerDurableMutationSettlementListener } from './durableMutationDispatch'
import { SETTINGS_BRIDGE_MUTATION_KEY } from './settingsMutationKey'
import {
  acknowledgePendingMutation,
  stagePendingMutation,
  type DurableMutationIntent,
  type PendingMutationHandle,
} from './pendingMutationOutbox'
import { registerPendingBridgePatchFlusher } from './pendingBridgeFlushRegistry'
import { registerPendingSettingsProjectionOverlay } from './settingsPendingProjection'

interface PendingSettingsPatch {
  patch: SettingsPatch
  previous: SettingsPatch
  attempted: SettingsPatch
  durableAttempted: SettingsPatch
  projectionEpochs: SettingsGroupProjectionEpochs
  timer: ReturnType<typeof setTimeout> | null
  outbox: PendingMutationHandle | null
}

interface PendingSettingsAttempt {
  sequence: number
  previous: SettingsPatch
  attempted: SettingsPatch
  mutationId?: string
  phase: 'dispatching' | 'queued' | 'accepted-replay'
  acceptedReplayPendingKeys?: Set<string>
  settlementCleanup?: () => void
}

interface HypaV3PresetRollbackResult {
  rolledBack: boolean
  insertedIndex?: number
}

const pendingSettingsPatch: PendingSettingsPatch = {
  patch: {},
  previous: {},
  attempted: {},
  durableAttempted: {},
  projectionEpochs: {},
  timer: null,
  outbox: null,
}
const pendingSettingsAttempts: PendingSettingsAttempt[] = []
let nextSettingsAttemptSequence = 0

interface SparseObjectSettingQueue {
  key: string
  group: SettingsGroup
  baseline: Record<string, unknown>
  desired: Record<string, unknown> | null
  stagedUpdate: SparseSettingsObjectUpdate | null
  intent: DurableMutationIntent | null
  durableAttempted: Record<string, unknown> | null
  desiredTouchedKeys: Set<string>
  queuedProjectionEpoch: number | null
  timer: ReturnType<typeof setTimeout> | null
  running: boolean
  outbox: PendingMutationHandle | null
  settlementCleanup?: () => void
  settlementMutationId?: string
  settlementPhase?: 'dispatching' | 'queued' | 'accepted-replay'
}

const SPARSE_OBJECT_SETTING_KEYS = new Set(['NAIImgConfig', 'wavespeedImage', 'seperateParameters'])
const sparseObjectSettingQueues = new Map<string, SparseObjectSettingQueue>()

registerPendingSettingsProjectionOverlay((target, allowedKeys) => {
  const settledAttempts: PendingSettingsAttempt[] = []
  for (const attempt of [...pendingSettingsAttempts]) {
    for (const [key, value] of Object.entries(attempt.attempted)) {
      if (allowedKeys && !allowedKeys.has(key)) continue
      if (attempt.phase === 'accepted-replay') {
        attempt.acceptedReplayPendingKeys?.delete(key)
        continue
      }
      target[key] = cloneJsonValue(value)
    }
    if (attempt.phase === 'accepted-replay' && attempt.acceptedReplayPendingKeys?.size === 0) {
      settledAttempts.push(attempt)
    }
  }

  for (const [key, value] of Object.entries(pendingSettingsPatch.attempted)) {
    if (allowedKeys && !allowedKeys.has(key)) continue
    target[key] = cloneJsonValue(value)
  }

  for (const state of sparseObjectSettingQueues.values()) {
    if (allowedKeys && !allowedKeys.has(state.key)) continue
    if (state.settlementPhase === 'accepted-replay') {
      clearSparseObjectSettingSettlement(state)
      if (!state.running && !state.desired && !state.outbox) {
        state.durableAttempted = null
        sparseObjectSettingQueues.delete(state.key)
      }
      continue
    }
    if (state.settlementPhase && state.durableAttempted) {
      target[state.key] = cloneJsonValue(state.durableAttempted)
    }
    if (state.desired) target[state.key] = cloneJsonValue(state.desired)
  }

  for (const attempt of settledAttempts) clearSettingsAttempt(attempt)
})

let suppressRollbackDispatch = false

function createSettingsSaveFailureReporter(): () => void {
  let reported = false
  return () => {
    if (reported) return
    reported = true
    alertError(language.errors.settingsSaveFailed)
  }
}

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
  let dirtyBaseline = cloneDraftValue(initialValue)

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
      dirtyBaseline = cloneDraftValue(serverValue)
      if (serverSnapshot !== draftSnapshot) {
        suppressDraftDispatch = true
        draft.value = cloneDraftValue(serverValue)
        queueMicrotask(() => {
          suppressDraftDispatch = false
        })
      }
    } else {
      if (serverSnapshot !== previousServerSnapshot && serverSnapshot !== draftSnapshot) {
        suppressDraftDispatch = true
        if (resourceApplyChanged && dirty) {
          const normalizedServerValue = cloneDraftValue(serverValue)
          if (snapshotJson(dirtyBaseline) === snapshotJson(normalizedServerValue)) {
            reassertDirtySettingDraftValue(key, draft.value)
          } else {
            const rebased = mergeSettingDraftValues(dirtyBaseline, draft.value, normalizedServerValue)
            if (rebased.ambiguous && discardPendingSettingsPatchKey(key, delayMs)) {
              dirty = false
              dirtyOwnerKey = null
              dirtyBaseline = cloneDraftValue(normalizedServerValue)
              draft.value = cloneDraftValue(normalizedServerValue)
              alertError(language.errors.settingsSaveFailed)
            } else {
              const rebasedValue = cloneDraftValue(rebased.value)
              dirtyBaseline = cloneDraftValue(normalizedServerValue)
              draft.value = rebasedValue
              reassertDirtySettingDraftValue(key, rebasedValue)
              rebasePendingSettingsPatchKey(key, normalizedServerValue, rebasedValue, delayMs)
            }
          }
        } else {
          dirty = false
          dirtyOwnerKey = null
          dirtyBaseline = cloneDraftValue(serverValue)
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
      dirtyBaseline = cloneDraftValue(currentSettingValue(key, fallback))
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

    const wasDirty = dirty
    dirty = true
    previousDraftDispatchSnapshot = snapshot

    untrack(() => {
      if (!settingsGroupForKey(key)) {
        dirtyOwnerKey = `local:${key}`
        return
      }
      const attempted = cloneDraftValue(draft.value)
      const previous = cloneJsonValue((getDatabase() as unknown as Record<string, unknown>)[key])
      if (!wasDirty) dirtyBaseline = cloneDraftValue(currentSettingValue(key, fallback))
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

interface SettingDraftMergeResult<T> {
  value: T
  ambiguous: boolean
}

interface SettingDraftMergeNode {
  present: boolean
  value?: unknown
  ambiguous: boolean
}

const missingSettingDraftNode: SettingDraftMergeNode = { present: false, ambiguous: false }

/**
 * Reapply only the locally changed portions of a draft to a newer authoritative
 * value. Stable record arrays are merged by ID (or name for legacy rows),
 * primitive arrays use add/remove semantics, and objects recurse by field.
 */
function mergeSettingDraftValues<T>(baseline: T, local: T, authoritative: T): SettingDraftMergeResult<T> {
  const merged = mergeSettingDraftNode(
    { present: true, value: baseline, ambiguous: false },
    { present: true, value: local, ambiguous: false },
    { present: true, value: authoritative, ambiguous: false },
  )
  return {
    value: cloneJsonValue((merged.present ? merged.value : authoritative) as T),
    ambiguous: merged.ambiguous,
  }
}

function mergeSettingDraftNode(
  baseline: SettingDraftMergeNode,
  local: SettingDraftMergeNode,
  authoritative: SettingDraftMergeNode,
): SettingDraftMergeNode {
  if (settingDraftNodesEqual(local, baseline)) return cloneSettingDraftNode(authoritative)
  if (settingDraftNodesEqual(authoritative, baseline)) return cloneSettingDraftNode(local)
  if (settingDraftNodesEqual(local, authoritative)) return cloneSettingDraftNode(local)

  if (local.present && authoritative.present) {
    if (isPlainJsonObject(local.value) && isPlainJsonObject(authoritative.value)) {
      const baselineObject = baseline.present && isPlainJsonObject(baseline.value) ? baseline.value : {}
      return mergeSettingDraftObjects(baselineObject, local.value, authoritative.value)
    }
    if (Array.isArray(local.value) && Array.isArray(authoritative.value)) {
      const baselineArray = baseline.present && Array.isArray(baseline.value) ? baseline.value : []
      return mergeSettingDraftArrays(baselineArray, local.value, authoritative.value)
    }
  }

  if (local.present !== authoritative.present) {
    return {
      ...cloneSettingDraftNode(local),
      ambiguous: true,
    }
  }

  // Concurrent scalar changes target the same leaf. Preserve the user's later
  // local value; the structural cases above still retain authoritative siblings.
  return cloneSettingDraftNode(local)
}

function mergeSettingDraftObjects(
  baseline: Record<string, unknown>,
  local: Record<string, unknown>,
  authoritative: Record<string, unknown>,
): SettingDraftMergeNode {
  const value: Record<string, unknown> = {}
  let ambiguous = false
  for (const key of new Set([...Object.keys(baseline), ...Object.keys(local), ...Object.keys(authoritative)])) {
    const merged = mergeSettingDraftNode(
      settingDraftObjectNode(baseline, key),
      settingDraftObjectNode(local, key),
      settingDraftObjectNode(authoritative, key),
    )
    ambiguous ||= merged.ambiguous
    if (merged.present) value[key] = cloneJsonValue(merged.value)
  }
  return { present: true, value, ambiguous }
}

function mergeSettingDraftArrays(
  baseline: unknown[],
  local: unknown[],
  authoritative: unknown[],
): SettingDraftMergeNode {
  const rowKey = stableSettingDraftRowKey(baseline, local, authoritative)
  if (rowKey) return mergeKeyedSettingDraftArrays(baseline, local, authoritative, rowKey)

  if (settingDraftArrayHasUniqueValues(baseline, local, authoritative)) {
    const baselineSnapshots = new Set(baseline.map(snapshotJson))
    const localSnapshots = new Set(local.map(snapshotJson))
    const locallyRemoved = new Set([...baselineSnapshots].filter((snapshot) => !localSnapshots.has(snapshot)))
    const value = authoritative
      .filter((entry) => !locallyRemoved.has(snapshotJson(entry)))
      .map((entry) => cloneJsonValue(entry))
    const valueSnapshots = new Set(value.map(snapshotJson))
    for (const entry of local) {
      const snapshot = snapshotJson(entry)
      if (baselineSnapshots.has(snapshot) || valueSnapshots.has(snapshot)) continue
      value.push(cloneJsonValue(entry))
      valueSnapshots.add(snapshot)
    }
    return { present: true, value, ambiguous: false }
  }

  if (baseline.length === local.length && baseline.length === authoritative.length) {
    const value: unknown[] = []
    let ambiguous = false
    for (let index = 0; index < baseline.length; index += 1) {
      const merged = mergeSettingDraftNode(
        { present: true, value: baseline[index], ambiguous: false },
        { present: true, value: local[index], ambiguous: false },
        { present: true, value: authoritative[index], ambiguous: false },
      )
      ambiguous ||= merged.ambiguous
      if (merged.present) value.push(cloneJsonValue(merged.value))
    }
    return { present: true, value, ambiguous }
  }

  return { present: true, value: cloneJsonValue(local), ambiguous: true }
}

function mergeKeyedSettingDraftArrays(
  baseline: unknown[],
  local: unknown[],
  authoritative: unknown[],
  rowKey: string,
): SettingDraftMergeNode {
  const baselineRows = keyedSettingDraftRows(baseline, rowKey)
  const localRows = keyedSettingDraftRows(local, rowKey)
  const authoritativeRows = keyedSettingDraftRows(authoritative, rowKey)
  const localReordered = settingDraftRowsReordered(baselineRows.order, localRows.order)
  const authoritativeReordered = settingDraftRowsReordered(baselineRows.order, authoritativeRows.order)
  let ambiguous =
    localReordered &&
    authoritativeReordered &&
    snapshotJson(localRows.order.filter((id) => baselineRows.values.has(id))) !==
      snapshotJson(authoritativeRows.order.filter((id) => baselineRows.values.has(id)))

  const mergedRows = new Map<string, unknown>()
  const allRowIds = new Set([...baselineRows.order, ...localRows.order, ...authoritativeRows.order])
  for (const id of allRowIds) {
    const merged = mergeSettingDraftNode(
      settingDraftMapNode(baselineRows.values, id),
      settingDraftMapNode(localRows.values, id),
      settingDraftMapNode(authoritativeRows.values, id),
    )
    ambiguous ||= merged.ambiguous
    if (merged.present) mergedRows.set(id, cloneJsonValue(merged.value))
  }

  const preferredOrder = localReordered && !authoritativeReordered ? localRows.order : authoritativeRows.order
  const order = [...preferredOrder, ...localRows.order, ...authoritativeRows.order]
  const seen = new Set<string>()
  const value: unknown[] = []
  for (const id of order) {
    if (seen.has(id) || !mergedRows.has(id)) continue
    seen.add(id)
    value.push(cloneJsonValue(mergedRows.get(id)))
  }
  return { present: true, value, ambiguous }
}

function stableSettingDraftRowKey(...arrays: unknown[][]): string | null {
  for (const key of ['id', 'name']) {
    let foundRow = false
    let valid = true
    for (const rows of arrays) {
      const seen = new Set<string>()
      for (const row of rows) {
        if (!isPlainJsonObject(row) || (typeof row[key] !== 'string' && typeof row[key] !== 'number')) {
          valid = false
          break
        }
        foundRow = true
        const id = `${typeof row[key]}:${String(row[key])}`
        if (seen.has(id)) {
          valid = false
          break
        }
        seen.add(id)
      }
      if (!valid) break
    }
    if (valid && foundRow) return key
  }
  return null
}

function keyedSettingDraftRows(rows: unknown[], key: string): { order: string[]; values: Map<string, unknown> } {
  const order: string[] = []
  const values = new Map<string, unknown>()
  for (const row of rows) {
    const rowValue = row as Record<string, unknown>
    const id = `${typeof rowValue[key]}:${String(rowValue[key])}`
    order.push(id)
    values.set(id, row)
  }
  return { order, values }
}

function settingDraftRowsReordered(baselineOrder: string[], order: string[]): boolean {
  const present = new Set(order)
  const baselineCommonOrder = baselineOrder.filter((id) => present.has(id))
  const baselineIds = new Set(baselineOrder)
  const currentCommonOrder = order.filter((id) => baselineIds.has(id))
  return snapshotJson(baselineCommonOrder) !== snapshotJson(currentCommonOrder)
}

function settingDraftArrayHasUniqueValues(...arrays: unknown[][]): boolean {
  return arrays.every((array) => {
    const snapshots = array.map(snapshotJson)
    return new Set(snapshots).size === snapshots.length
  })
}

function settingDraftNodesEqual(left: SettingDraftMergeNode, right: SettingDraftMergeNode): boolean {
  return left.present === right.present && (!left.present || isJsonSnapshotEqual(left.value, right.value))
}

function cloneSettingDraftNode(node: SettingDraftMergeNode): SettingDraftMergeNode {
  return node.present
    ? { present: true, value: cloneJsonValue(node.value), ambiguous: node.ambiguous }
    : { ...missingSettingDraftNode, ambiguous: node.ambiguous }
}

function settingDraftObjectNode(object: Record<string, unknown>, key: string): SettingDraftMergeNode {
  return hasOwnKey(object, key) ? { present: true, value: object[key], ambiguous: false } : missingSettingDraftNode
}

function settingDraftMapNode(map: ReadonlyMap<string, unknown>, key: string): SettingDraftMergeNode {
  return map.has(key) ? { present: true, value: map.get(key), ambiguous: false } : missingSettingDraftNode
}

interface PreparedServerBackedSettingsPatch {
  commandPatch: SettingsPatch
  previous: SettingsPatch
  attempted: SettingsPatch
}

function prepareServerBackedSettingsPatch(patch: SettingsPatch): PreparedServerBackedSettingsPatch | null {
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

  if (Object.keys(commandPatch).length === 0) return null
  return { commandPatch, previous, attempted }
}

function applyOptimisticServerBackedSettingsPatch(commandPatch: SettingsPatch): void {
  withSuppressedSettingsWatcher(() => {
    withTrustedResourceWrite(() => {
      const target = getDatabase() as unknown as Record<string, unknown>
      for (const [key, value] of Object.entries(commandPatch)) {
        target[key] = cloneJsonValue(value)
      }
    })
  })
}

export function applyServerBackedSettingsPatch(patch: SettingsPatch): void {
  const prepared = prepareServerBackedSettingsPatch(patch)
  if (!prepared) return
  applyOptimisticServerBackedSettingsPatch(prepared.commandPatch)

  // Fold an immediate write into any same-field debounce. This stages one
  // absolute successor before reserving the command queue, so a remotely
  // started predecessor cannot land after the immediate value.
  queueSettingsPatch(prepared.commandPatch, prepared.previous, 0)
  flushPendingServerBackedSettingsPatch()
}

/**
 * Optimistically apply and durably persist one exact settings operation. The
 * returned promise settles only with this patch's command receipt.
 */
export async function persistServerBackedSettingsPatch(patch: SettingsPatch): Promise<boolean> {
  const prepared = prepareServerBackedSettingsPatch(patch)
  if (!prepared) return true
  const projectionEpochs = captureSettingsPatchProjectionEpochs(prepared.commandPatch)
  applyOptimisticServerBackedSettingsPatch(prepared.commandPatch)

  const reportFailure = createSettingsSaveFailureReporter()
  const intent = settingsPatchDurableIntent(prepared.commandPatch)
  if (intent.requests.length === 0) {
    rollbackServerBackedSettings(prepared.previous, prepared.attempted)
    reportFailure()
    return false
  }

  let outbox: PendingMutationHandle
  try {
    outbox = stagePendingMutation(SETTINGS_BRIDGE_MUTATION_KEY, intent)
  } catch (error) {
    console.error('Durable settings patch could not be staged:', error)
    rollbackServerBackedSettings(prepared.previous, prepared.attempted)
    reportFailure()
    return false
  }

  try {
    const result = await dispatchDurableMutation(outbox, intent, (transport) =>
      dispatchTrackedServerBackedSettingsPatch({
        patch: prepared.commandPatch,
        optimisticProjectionEpochs: projectionEpochs,
        previous: prepared.previous,
        attempted: prepared.attempted,
        mutationId: transport.mutationId,
        databaseLineage: transport.databaseLineage,
        executionWrapper: transport.executionWrapper,
        failureRollbackDisposition: transport.failureRollbackDisposition,
        reportFailure,
      }),
    )
    if (result.status !== 'ok') reportFailure()
    return result.status === 'ok'
  } catch (error) {
    console.error('Durable settings patch rejected:', error)
    reportFailure()
    return false
  }
}

/**
 * Dispatch a caller-owned optimistic settings patch through the encrypted
 * outbox while preserving its field-specific rollback semantics.
 */
export function dispatchDurableServerBackedSettingsPatch(
  input: Parameters<typeof patchServerBackedSettings>[0],
): Promise<ServerCommandResult> {
  const intent = settingsPatchDurableIntent(input.patch)
  if (intent.requests.length === 0) return Promise.resolve({ status: 'unavailable' })
  const outbox = stagePendingMutation(SETTINGS_BRIDGE_MUTATION_KEY, intent)
  return dispatchDurableMutation(outbox, intent, (transport) =>
    patchServerBackedSettings({
      ...input,
      mutationId: transport.mutationId,
      databaseLineage: transport.databaseLineage,
      executionWrapper: transport.executionWrapper,
      failureRollbackDisposition: transport.failureRollbackDisposition,
    }),
  )
}

export async function applyOnboardingServerBackedSettings(
  options: ApplyOnboardingServerBackedSettingsOptions,
): Promise<boolean> {
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

  const result = dispatchServerBackedSettingsPatch(
    fullPatch,
    previous,
    attempted,
    captureSettingsPatchProjectionEpochs(fullPatch),
  )
  if (!result) return true

  try {
    return (await result).status === 'ok'
  } catch {
    return false
  }
}

function dispatchServerBackedSettingsPatch(
  commandPatch: SettingsPatch,
  previous: SettingsPatch,
  attempted: SettingsPatch,
  optimisticProjectionEpochs: SettingsGroupProjectionEpochs,
): Promise<ServerCommandResult> | null {
  if (Object.keys(commandPatch).length === 0) return null

  return dispatchTrackedServerBackedSettingsPatch({
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
      pendingSettingsPatch.previous[key] = cloneJsonValue(previous[key])
    }
    pendingSettingsPatch.attempted[key] = cloneJsonValue(value)
  }
  refreshPendingSettingsPatch(delay)
}

function rebasePendingSettingsPatchKey(key: string, authoritative: unknown, rebased: unknown, delay: number): boolean {
  if (!hasOwnKey(pendingSettingsPatch.attempted, key)) return false
  pendingSettingsPatch.previous[key] = cloneJsonValue(authoritative)
  pendingSettingsPatch.attempted[key] = cloneJsonValue(rebased)
  const group = settingsGroupForKey(key)
  if (group) pendingSettingsPatch.projectionEpochs[group] = captureSettingsGroupProjectionEpoch(group)
  refreshPendingSettingsPatch(delay)
  return true
}

function discardPendingSettingsPatchKey(key: string, delay: number): boolean {
  if (!hasOwnKey(pendingSettingsPatch.attempted, key)) return false
  if (pendingSettingsPatch.timer) {
    clearTimeout(pendingSettingsPatch.timer)
    pendingSettingsPatch.timer = null
  }
  const stagedOutbox = pendingSettingsPatch.outbox
  delete pendingSettingsPatch.patch[key]
  delete pendingSettingsPatch.previous[key]
  delete pendingSettingsPatch.attempted[key]
  pendingSettingsPatch.durableAttempted = {}
  pendingSettingsPatch.outbox = null
  if (stagedOutbox) void acknowledgePendingMutation(stagedOutbox)
  refreshPendingSettingsPatch(delay)
  return true
}

function refreshPendingSettingsPatch(delay: number): void {
  const netChangedKeys = changedSettingsPatchKeys(pendingSettingsPatch.previous, pendingSettingsPatch.attempted)
  pendingSettingsPatch.patch = pendingSettingsDurableClosure(netChangedKeys)
  prunePendingSettingsPatchProjectionEpochs()

  if (pendingSettingsPatch.timer) clearTimeout(pendingSettingsPatch.timer)
  if (Object.keys(pendingSettingsPatch.patch).length === 0) {
    pendingSettingsPatch.timer = null
    if (pendingSettingsPatch.outbox) void acknowledgePendingMutation(pendingSettingsPatch.outbox)
    resetPendingSettingsPatch()
    return
  }
  const intent = settingsPatchDurableIntent(pendingSettingsPatch.patch)
  pendingSettingsPatch.outbox = stagePendingMutation(SETTINGS_BRIDGE_MUTATION_KEY, intent, pendingSettingsPatch.outbox)
  pendingSettingsPatch.durableAttempted = cloneJsonValue(pendingSettingsPatch.attempted)
  if (netChangedKeys.size === 0) {
    // The only remaining fields correct a prior durable target back to its
    // baseline. Reserve that correction immediately; another command must not
    // overtake it while the old receipt may already be in flight in another tab.
    dispatchPendingSettingsPatch()
    return
  }
  pendingSettingsPatch.timer = setTimeout(() => {
    dispatchPendingSettingsPatch()
  }, delay)
}

function pendingSettingsDurableClosure(netChangedKeys: ReadonlySet<string>): SettingsPatch {
  const changedFromDurable = pendingSettingsPatch.outbox
    ? changedSettingsPatchKeys(pendingSettingsPatch.durableAttempted, pendingSettingsPatch.attempted)
    : new Set<string>()
  const patch: SettingsPatch = {}
  for (const key of new Set([...netChangedKeys, ...changedFromDurable])) {
    if (!hasOwnKey(pendingSettingsPatch.attempted, key) || pendingSettingsPatch.attempted[key] === undefined) {
      continue
    }
    patch[key] = cloneJsonValue(pendingSettingsPatch.attempted[key])
  }
  return patch
}

function changedSettingsPatchKeys(left: SettingsPatch, right: SettingsPatch): Set<string> {
  const changed = new Set<string>()
  for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
    if (hasOwnKey(left, key) !== hasOwnKey(right, key) || !isJsonSnapshotEqual(left[key], right[key])) {
      changed.add(key)
    }
  }
  return changed
}

function resetPendingSettingsPatch(): void {
  pendingSettingsPatch.patch = {}
  pendingSettingsPatch.previous = {}
  pendingSettingsPatch.attempted = {}
  pendingSettingsPatch.durableAttempted = {}
  pendingSettingsPatch.projectionEpochs = {}
  pendingSettingsPatch.outbox = null
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

registerPendingBridgePatchFlusher('settings', flushPendingServerBackedSettingsPatch)

function dispatchPendingSettingsPatch(options: ServerCommandTransportOptions = {}): void {
  if (pendingSettingsPatch.timer) {
    clearTimeout(pendingSettingsPatch.timer)
    pendingSettingsPatch.timer = null
  }
  const commandPatch = pendingSettingsPatch.patch
  const commandPrevious = pendingSettingsPatch.previous
  const commandAttempted = pendingSettingsPatch.attempted
  const optimisticProjectionEpochs = pendingSettingsPatch.projectionEpochs
  const stagedOutbox = pendingSettingsPatch.outbox
  resetPendingSettingsPatch()

  if (Object.keys(commandPatch).length === 0) {
    if (stagedOutbox) void acknowledgePendingMutation(stagedOutbox)
    return
  }

  const intent = settingsPatchDurableIntent(commandPatch)
  const outbox = stagedOutbox ?? stagePendingMutation(SETTINGS_BRIDGE_MUTATION_KEY, intent)
  void dispatchDurableMutation(outbox, intent, (transport) =>
    dispatchTrackedServerBackedSettingsPatch({
      patch: commandPatch,
      optimisticProjectionEpochs,
      keepalive: options.keepalive,
      signal: options.signal,
      mutationId: transport.mutationId,
      databaseLineage: transport.databaseLineage,
      executionWrapper: transport.executionWrapper,
      failureRollbackDisposition: transport.failureRollbackDisposition,
      previous: commandPrevious,
      attempted: commandAttempted,
    }),
  )
}

function dispatchTrackedServerBackedSettingsPatch(input: {
  patch: SettingsPatch
  optimisticProjectionEpochs: SettingsGroupProjectionEpochs
  previous: SettingsPatch
  attempted: SettingsPatch
  keepalive?: boolean
  signal?: AbortSignal | null
  mutationId?: string
  databaseLineage?: string
  executionWrapper?: ServerCommandTransportOptions['executionWrapper']
  failureRollbackDisposition?: ServerCommandTransportOptions['failureRollbackDisposition']
  reportFailure?: () => void
}): Promise<ServerCommandResult> {
  const reportFailure = input.reportFailure ?? createSettingsSaveFailureReporter()
  const attempt = registerSettingsAttempt(input.previous, input.attempted, input.mutationId)
  if (input.mutationId) {
    attempt.settlementCleanup = registerDurableMutationSettlementListener(input.mutationId, (settlement) => {
      if (!isSettingsAttemptCurrent(attempt)) return
      if (settlement === 'accepted') {
        attempt.phase = 'accepted-replay'
        attempt.acceptedReplayPendingKeys = new Set(Object.keys(attempt.attempted))
        return
      }
      rollbackSettingsAttempt(attempt)
      reportFailure()
    })
  }
  const result = patchServerBackedSettings({
    patch: input.patch,
    acknowledgeOptimistic: true,
    optimisticProjectionEpochs: input.optimisticProjectionEpochs,
    keepalive: input.keepalive,
    signal: input.signal,
    mutationId: input.mutationId,
    databaseLineage: input.databaseLineage,
    executionWrapper: input.executionWrapper,
    failureRollbackDisposition: input.failureRollbackDisposition,
    rollback: () => {
      rollbackSettingsAttempt(attempt)
      reportFailure()
    },
  })
  void result.then(
    (settled) => {
      if (!isSettingsAttemptCurrent(attempt)) return
      if (settled.status === 'ok') {
        clearSettingsAttempt(attempt)
        return
      }
      if (input.failureRollbackDisposition?.(settled) === 'retain') {
        attempt.phase = 'queued'
        reportFailure()
        return
      }
      clearSettingsAttempt(attempt)
      reportFailure()
    },
    () => {
      if (!isSettingsAttemptCurrent(attempt)) return
      if (input.failureRollbackDisposition?.({ status: 'unavailable' }) === 'retain') {
        attempt.phase = 'queued'
        reportFailure()
        return
      }
      clearSettingsAttempt(attempt)
      reportFailure()
    },
  )
  return result
}

function registerSettingsAttempt(
  previous: SettingsPatch,
  attempted: SettingsPatch,
  mutationId?: string,
): PendingSettingsAttempt {
  const attempt = {
    sequence: ++nextSettingsAttemptSequence,
    previous,
    attempted,
    mutationId,
    phase: 'dispatching' as const,
  }
  pendingSettingsAttempts.push(attempt)
  return attempt
}

function isSettingsAttemptCurrent(attempt: PendingSettingsAttempt): boolean {
  return pendingSettingsAttempts.some(
    (candidate) => candidate.sequence === attempt.sequence && candidate.mutationId === attempt.mutationId,
  )
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
  attempt.settlementCleanup?.()
  attempt.settlementCleanup = undefined
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

  const netUpdate = diffSparseObjectSetting(previous, attempted)
  let state = sparseObjectSettingQueues.get(key)
  if (!state) {
    if (!netUpdate) return true
    state = {
      key,
      group,
      baseline: cloneJsonValue(previous),
      desired: cloneJsonValue(attempted),
      stagedUpdate: null,
      intent: null,
      durableAttempted: null,
      desiredTouchedKeys: new Set(),
      queuedProjectionEpoch: captureSettingsGroupProjectionEpoch(group),
      timer: null,
      running: false,
      outbox: null,
      settlementPhase: undefined,
    }
    sparseObjectSettingQueues.set(key, state)
  } else {
    if (!state.desired) state.queuedProjectionEpoch = captureSettingsGroupProjectionEpoch(group)
    if (state.running && netUpdate) {
      for (const field of [...Object.keys(netUpdate.patch), ...(netUpdate.deleteKeys ?? [])]) {
        state.desiredTouchedKeys.add(field)
      }
    }
    state.desired = cloneJsonValue(attempted)
  }

  if (state.timer) clearTimeout(state.timer)
  state.timer = null
  const correctionOnly = refreshSparseObjectSettingOutbox(state)
  if (!state.stagedUpdate || !state.intent || !state.outbox) {
    if (!state.running) sparseObjectSettingQueues.delete(key)
    return true
  }
  if (correctionOnly && !state.running) {
    void dispatchSparseObjectSettingQueue(state)
    return true
  }
  state.timer = setTimeout(() => {
    state!.timer = null
    void dispatchSparseObjectSettingQueue(state!)
  }, delay)
  return true
}

async function dispatchSparseObjectSettingQueue(
  state: SparseObjectSettingQueue,
  options: ServerCommandTransportOptions = {},
): Promise<void> {
  if (state.running || !state.desired || !state.stagedUpdate || !state.intent || !state.outbox) {
    return
  }
  const previousBaseline = cloneJsonValue(state.baseline)
  const attemptedObject = cloneJsonValue(state.desired)
  const update = cloneJsonValue(state.stagedUpdate)
  const projectionEpoch = state.queuedProjectionEpoch
  const intent = state.intent
  const outbox = state.outbox
  state.outbox = null
  state.desired = null
  state.stagedUpdate = null
  state.intent = null
  state.queuedProjectionEpoch = null
  state.desiredTouchedKeys.clear()
  if (projectionEpoch === null) {
    void acknowledgePendingMutation(outbox)
    sparseObjectSettingQueues.delete(state.key)
    return
  }

  state.running = true
  let failed = false
  let failureRollbackDisposition: ServerCommandTransportOptions['failureRollbackDisposition']
  const reportFailure = createSettingsSaveFailureReporter()
  let result: Awaited<ReturnType<typeof patchSettingsObjectFieldsCommand>>
  try {
    clearSparseObjectSettingSettlement(state)
    state.settlementMutationId = outbox.mutationId
    state.settlementPhase = 'dispatching'
    state.settlementCleanup = registerDurableMutationSettlementListener(outbox.mutationId, (settlement) => {
      if (state.settlementMutationId !== outbox.mutationId) return
      if (settlement === 'accepted') {
        state.settlementPhase = 'accepted-replay'
        state.outbox = null
        return
      }
      if (state.desired && state.stagedUpdate && state.intent && state.outbox) {
        // A later absolute successor already covers the visible desired value.
        // Retire only the discarded predecessor and let that successor run.
        state.running = false
        clearSparseObjectSettingSettlement(state)
        reportFailure()
        queueMicrotask(() => void dispatchSparseObjectSettingQueue(state, options))
        return
      }
      const current = currentSettingValue(state.key, null)
      if (!state.desired && state.durableAttempted && isJsonSnapshotEqual(current, state.durableAttempted)) {
        writeSparseObjectSettingProjection(state.key, state.baseline)
      }
      state.outbox = null
      state.durableAttempted = null
      state.running = false
      clearSparseObjectSettingSettlement(state)
      sparseObjectSettingQueues.delete(state.key)
      reportFailure()
    })
    result = await dispatchDurableMutation(outbox!, intent!, (transport) => {
      failureRollbackDisposition = transport.failureRollbackDisposition
      return runServerCommand({
        signal: options.signal,
        keepalive: options.keepalive,
        mutationId: transport.mutationId,
        databaseLineage: transport.databaseLineage,
        executionWrapper: transport.executionWrapper,
        failureRollbackDisposition,
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
          reportFailure()
        },
      })
    })
  } catch (error) {
    console.error('Sparse settings command rejected:', error)
    result = { status: 'unavailable' }
  }
  if (result.status !== 'ok') reportFailure()
  if (result.status !== 'ok' && failureRollbackDisposition?.(result) === 'retain') {
    // The exact attempted object is still represented by a durable row. Keep
    // both its visible projection and its queue baseline; a later edit stages
    // an ordered correction instead of silently exposing stale server state.
    state.running = false
    state.settlementPhase = 'queued'
    state.outbox ??= outbox
    if (state.desired && state.stagedUpdate && state.intent && state.outbox) {
      queueMicrotask(() => void dispatchSparseObjectSettingQueue(state, options))
    }
    return
  }

  clearSparseObjectSettingSettlement(state)

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

  const desired = state.desired
  if (desired) {
    state.desired = rebaseSparseObjectSettingDesired(
      desired,
      previousBaseline,
      attemptedObject,
      state.baseline,
      state.desiredTouchedKeys,
    )
    writeSparseObjectSettingProjection(state.key, state.desired)
    refreshSparseObjectSettingOutbox(state)
    if (state.stagedUpdate && state.intent && state.outbox) {
      if (state.timer) clearTimeout(state.timer)
      state.timer = null
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

  state.durableAttempted = null
  sparseObjectSettingQueues.delete(state.key)
}

function clearSparseObjectSettingSettlement(state: SparseObjectSettingQueue): void {
  state.settlementCleanup?.()
  state.settlementCleanup = undefined
  state.settlementMutationId = undefined
  state.settlementPhase = undefined
}

function rebaseSparseObjectSettingDesired(
  desired: Record<string, unknown>,
  previousBaseline: Record<string, unknown>,
  attempted: Record<string, unknown>,
  settledBaseline: Record<string, unknown>,
  desiredTouchedKeys: ReadonlySet<string>,
): Record<string, unknown> {
  const rebased = cloneJsonValue(desired)
  for (const key of new Set([...Object.keys(previousBaseline), ...Object.keys(attempted)])) {
    const previousPresent = hasDefinedOwnKey(previousBaseline, key)
    const attemptedPresent = hasDefinedOwnKey(attempted, key)
    const desiredPresent = hasDefinedOwnKey(desired, key)
    if (
      desiredTouchedKeys.has(key) ||
      (previousPresent === attemptedPresent &&
        (!previousPresent || isJsonSnapshotEqual(previousBaseline[key], attempted[key]))) ||
      desiredPresent !== attemptedPresent ||
      (attemptedPresent && !isJsonSnapshotEqual(desired[key], attempted[key]))
    ) {
      continue
    }

    if (hasDefinedOwnKey(settledBaseline, key)) {
      rebased[key] = cloneJsonValue(settledBaseline[key])
    } else {
      delete rebased[key]
    }
  }
  return rebased
}

function refreshSparseObjectSettingOutbox(state: SparseObjectSettingQueue): boolean {
  const desired = state.desired
  if (!desired) {
    state.stagedUpdate = null
    state.intent = null
    return false
  }
  const netUpdate = diffSparseObjectSetting(state.baseline, desired)
  const correctiveUpdate = state.durableAttempted ? diffSparseObjectSetting(state.durableAttempted, desired) : null
  const update = mergeSparseObjectSettingUpdatePair(netUpdate, correctiveUpdate)
  if (!update) {
    if (state.outbox) void acknowledgePendingMutation(state.outbox)
    state.outbox = null
    state.stagedUpdate = null
    state.intent = null
    return false
  }

  const intent = sparseObjectSettingDurableIntent(state.group, state.key, update)
  state.outbox = stagePendingMutation(SETTINGS_BRIDGE_MUTATION_KEY, intent, state.outbox)
  state.stagedUpdate = cloneJsonValue(update)
  state.intent = intent
  state.durableAttempted = cloneJsonValue(desired)
  return netUpdate === null && correctiveUpdate !== null
}

async function refreshSparseObjectSettingBaseline(
  group: SettingsGroup,
  key: string,
  signal?: AbortSignal | null,
): Promise<Record<string, unknown> | null> {
  const result = await fetchServerSettingsGroup(group, signal)
  if (result.status !== 'ok') return null
  const authoritative = result.settings[key]
  const applied = withServerResourceApply(() =>
    applySettingsGroupResource(result, SERVER_SETTINGS_KEYS_BY_GROUP[group]),
  )
  if (!applied) return null
  return isPlainJsonObject(authoritative) ? cloneJsonValue(authoritative) : null
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

function hasDefinedOwnKey(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key) && value[key] !== undefined
}

function mergeSparseObjectSettingUpdatePair(
  first: SparseSettingsObjectUpdate | null,
  second: SparseSettingsObjectUpdate | null,
): SparseSettingsObjectUpdate | null {
  if (!first && !second) return null
  const patch: Record<string, unknown> = {}
  const deleteKeys = new Set<string>()
  for (const update of [first, second]) {
    if (!update) continue
    for (const [key, value] of Object.entries(update.patch)) {
      patch[key] = cloneJsonValue(value)
      deleteKeys.delete(key)
    }
    for (const key of update.deleteKeys ?? []) {
      delete patch[key]
      deleteKeys.add(key)
    }
  }
  return { patch, ...(deleteKeys.size ? { deleteKeys: [...deleteKeys].sort() } : {}) }
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

function settingsPatchDurableIntent(patch: SettingsPatch): DurableMutationIntent {
  const groups = new Map<SettingsGroup, SettingsPatch>()
  for (const [key, value] of Object.entries(patch)) {
    const group = settingsGroupForKey(key)
    if (!group || value === undefined) continue
    const groupPatch = groups.get(group) ?? {}
    groupPatch[key] = cloneJsonValue(value)
    groups.set(group, groupPatch)
  }
  return {
    version: 1,
    requests: Array.from(groups, ([group, groupPatch]) => ({
      method: 'PATCH' as const,
      path: `/settings/${encodeURIComponent(group)}`,
      body: { patch: groupPatch },
    })),
  }
}

function sparseObjectSettingDurableIntent(
  group: SettingsGroup,
  key: string,
  update: SparseSettingsObjectUpdate,
): DurableMutationIntent {
  return {
    version: 1,
    requests: [
      {
        method: 'PATCH',
        path: `/settings/${encodeURIComponent(group)}/objects/${encodeURIComponent(key)}`,
        body: {
          patch: cloneJsonValue(update.patch),
          ...(update.deleteKeys?.length ? { deleteKeys: [...update.deleteKeys] } : {}),
        },
      },
    ],
  }
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
