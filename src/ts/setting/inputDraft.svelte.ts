import { untrack } from 'svelte'
import { subscribeServerCommandLocalEffectApplied } from '../server/commandLocalEffectEvents'
import {
  appliedLocalEffectAcknowledgesSettingDraft,
  type SplitPresetDraftProjection,
} from '../server/settingsDraftAcknowledgement'
import type { SettingContext, SettingItem } from './types'
import {
  UNINITIALIZED,
  getSettingOwnerProjectionToken,
  getSettingValue,
  getSettingWriteOwnerKey,
  reassertSettingValue,
  setDeferredSettingValue,
} from './utils'

export interface SettingInputDraft<T> {
  value: T
}

export interface SettingInputDraftOptions {
  delayMs?: number
}

/**
 * Local state for continuous SettingRenderer controls. A dirty draft survives
 * authoritative projections until that same owner/root projects the draft
 * back, while ordinary external changes still update an idle control.
 */
export function createSettingInputDraft<T>(
  getItem: () => SettingItem,
  getContext: () => SettingContext,
  options: SettingInputDraftOptions = {},
): SettingInputDraft<T> {
  const initialValue = untrack(() => getSettingValue(getItem(), getContext())) as T
  const draft = $state<SettingInputDraft<T>>({ value: cloneJsonValue(initialValue) })
  let initialized = false
  let dirty = false
  let suppressDraftDispatch = false
  let previousDraftDispatchSnapshot = snapshotJson(initialValue)
  let previousServerSnapshot = snapshotJson(initialValue)
  let previousOwnerToken = untrack(() => getSettingOwnerProjectionToken(getItem(), getContext()))
  let dirtyResourceEpoch: number | null = null
  let dirtyOwnerKey: string | null = null
  let dirtyRootKey: string | null = null
  let dirtyPath: string[] = []
  let dirtySplitPresetProjection: SplitPresetDraftProjection = 'selectedSettings'

  $effect(() => {
    const item = getItem()
    const context = getContext()
    const ownerKey = getSettingWriteOwnerKey(item, context)
    const ownerToken = getSettingOwnerProjectionToken(item, context)
    const ownerProjectionChanged = ownerToken.projectionEpoch !== previousOwnerToken.projectionEpoch
    const ownerReset = ownerToken.resetEpoch !== previousOwnerToken.resetEpoch
    const ownerChanged = ownerKey !== previousOwnerToken.ownerKey
    const serverValue = getSettingValue(item, context) as T
    const serverSnapshot = snapshotJson(serverValue)
    const draftSnapshot = snapshotJson(draft.value)

    if (ownerReset || ownerChanged) {
      clearDirty()
      if (serverSnapshot !== draftSnapshot) replaceDraftValue(serverValue)
    } else if (serverSnapshot === draftSnapshot) {
      // Equality can come from this draft's own optimistic write. Only the
      // owner/value-specific local-effect listener can acknowledge it.
      dirtyResourceEpoch = null
    } else if (ownerProjectionChanged && dirty) {
      dirtyResourceEpoch = ownerToken.projectionEpoch
      untrack(() => reassertSettingValue(item, draft.value, context))
    } else if (dirty && dirtyResourceEpoch === ownerToken.projectionEpoch) {
      // Some effective values live in a selected preset row. Reasserting their
      // DB fallback does not change that getter, so keep the control draft until
      // the preset mirror or a newer projection settles it.
    } else if (serverSnapshot !== previousServerSnapshot) {
      clearDirty()
      replaceDraftValue(serverValue)
    }

    previousOwnerToken = ownerToken
    previousServerSnapshot = serverSnapshot
  })

  $effect(() =>
    subscribeServerCommandLocalEffectApplied((_event, localEffect) => {
      if (!dirty || !dirtyRootKey) return
      const currentOwnerKey = getSettingWriteOwnerKey(getItem(), getContext())
      if (
        !appliedLocalEffectAcknowledgesSettingDraft({
          localEffect,
          dirtyOwnerKey,
          currentOwnerKey,
          rootKey: dirtyRootKey,
          path: dirtyPath,
          attemptedValue: draft.value,
          currentValue: getSettingValue(getItem(), getContext()),
          splitPresetProjection: dirtySplitPresetProjection,
        })
      ) {
        return
      }
      clearDirty()
    }),
  )

  $effect(() => {
    const value = draft.value
    const snapshot = snapshotJson(value)
    if (!initialized) {
      initialized = true
      previousDraftDispatchSnapshot = snapshot
      return
    }
    if (suppressDraftDispatch) {
      previousDraftDispatchSnapshot = snapshot
      return
    }
    if (snapshot === previousDraftDispatchSnapshot || value === (UNINITIALIZED as T)) return
    previousDraftDispatchSnapshot = snapshot

    untrack(() => {
      const item = getItem()
      const context = getContext()
      if (snapshotJson(getSettingValue(item, context)) === snapshot) return
      const result = setDeferredSettingValue(item, cloneJsonValue(value), context, options)
      dirty = result.queued
      dirtyOwnerKey = result.queued ? result.ownerKey : null
      dirtyRootKey = result.queued ? result.rootKey : null
      dirtyPath = result.queued ? result.path : []
      dirtySplitPresetProjection = result.splitPresetProjection
      previousOwnerToken = getSettingOwnerProjectionToken(item, context)
      previousServerSnapshot = snapshotJson(getSettingValue(item, context))
    })
  })

  return draft

  function replaceDraftValue(value: T): void {
    const snapshot = snapshotJson(value)
    suppressDraftDispatch = true
    previousDraftDispatchSnapshot = snapshot
    draft.value = cloneJsonValue(value)
    queueMicrotask(() => {
      suppressDraftDispatch = false
    })
  }

  function clearDirty(): void {
    dirty = false
    dirtyResourceEpoch = null
    dirtyOwnerKey = null
    dirtyRootKey = null
    dirtyPath = []
    dirtySplitPresetProjection = 'selectedSettings'
  }
}

function snapshotJson(value: unknown): string {
  const snapshot = JSON.stringify(value)
  return snapshot === undefined ? '__undefined__' : snapshot
}

function cloneJsonValue<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}
